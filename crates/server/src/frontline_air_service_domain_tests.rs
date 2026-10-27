//! Service acceptance through the real Hub, original aircraft and native clock.
use super::*;
use crate::flight_runtime::FlightSpawn;
use crate::frontline_air::AirUnitView;

fn data() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

fn accepted(out: &[(u32, Update)], action: &str) {
    assert!(
        !out.iter().any(|(_, m)| matches!(m, Update::Error { .. })),
        "{action}: {out:?}"
    );
}

fn rejected(out: &[(u32, Update)], expected: &str) {
    assert!(
        out.iter()
            .any(|(_, m)| matches!(m, Update::Error { code, .. } if code == expected)),
        "expected {expected}: {out:?}"
    );
}

fn ammo(v: &AirUnitView) -> u32 {
    v.guns.iter().map(|g| g.ammo).sum()
}
fn remaining(v: &AirUnitView, id: &str) -> u64 {
    v.stores
        .iter()
        .filter(|s| s["id"] == id && s["gone"] != true)
        .map(|s| s["count"].as_u64().unwrap())
        .sum()
}

fn resources(v: &AirUnitView) -> Value {
    json!({"ammo":v.guns.iter().map(|g|g.ammo).collect::<Vec<_>>(),
        "fuel":v.fuel,"stores":v.stores,"damage":v.damage,"loadout":v.loadout})
}

struct Fixture {
    h: FrontlineHub,
    unit: UnitRef,
    epoch: u64,
    seq: u64,
    now: f64,
    pristine: AirUnitView,
    company: Option<u64>,
}

impl Fixture {
    fn spent_airborne(company: bool) -> Self {
        let mut h = FrontlineHub::new(&data()).unwrap();
        h.use_c2_test_scene().unwrap();
        accepted(
            &h.handle(
                1,
                Command::Create {
                    name: "Real airfield service".into(),
                    map: "korea".into(),
                    observer: false,
                    era: 1976,
                },
                0.0,
            ),
            "create",
        );
        accepted(&h.handle(1, Command::Start, 0.0), "start");
        let company = if company {
            let vehicle = h.rooms[&1].vehicles[0].id.clone();
            accepted(
                &h.handle(1, Command::Deploy { vehicle }, 0.0),
                "owned native company",
            );
            let id = h.rooms[&1].members[&1].view.company.unwrap();
            accepted(&h.handle(1, Command::Return, 0.0), "friendly tank return");
            Some(id)
        } else {
            None
        };
        // Actual source preset4 has two AN-M64s and two120gal tanks. Service3
        // is the legitimate different tank-only preset, not a fake empty load.
        accepted(
            &h.handle(
                1,
                Command::DeployAir {
                    aircraft: "f86f".into(),
                    spawn: "air".into(),
                    loadout: 4,
                    custom: None, fuel_minutes: None,
                },
                0.0,
            ),
            "source bomb/tank loadout",
        );
        let member = &h.rooms[&1].members[&1].view;
        let unit = member.controlled.unwrap();
        let epoch = member.epoch;
        let pristine = h.rooms[&1]
            .air
            .views()
            .into_iter()
            .find(|v| v.unit == unit)
            .unwrap();
        let mut f = Self {
            h,
            unit,
            epoch,
            seq: 0,
            now: 0.0,
            pristine,
            company,
        };
        for i in 0..8 {
            f.input(1.0, 0.0, true, i == 0);
            f.advance(1);
        }
        assert!(ammo(&f.view()) < ammo(&f.pristine));
        assert!(
            f.view().fuel["total_kg"].as_f64().unwrap()
                < f.pristine.fuel["total_kg"].as_f64().unwrap()
        );
        assert_eq!(remaining(&f.view(), "anm64"), 1);
        f.damage_wing();
        assert_ne!(f.view().damage, f.pristine.damage);
        assert!(f.view().alive);
        assert_eq!(
            f.view().damage["fire"],
            false,
            "eligible surviving damage fixture must not be burning"
        );
        f
    }

    fn parked(company: bool) -> Self {
        let mut f = Self::spent_airborne(company);
        f.park();
        f
    }

    fn view(&self) -> AirUnitView {
        self.h.rooms[&1]
            .air
            .views()
            .into_iter()
            .find(|v| v.unit == self.unit)
            .unwrap()
    }

    fn advance(&mut self, ticks: usize) -> Vec<Value> {
        let mut all = Vec::new();
        for _ in 0..ticks {
            self.now += STEP;
            for (_, update) in self.h.tick(self.now + 1e-8) {
                if let Update::Frame { events, .. } = update {
                    all.extend(events);
                }
            }
        }
        all
    }

    fn input(&mut self, throttle: f32, roll: f32, fire: bool, release: bool) {
        self.seq += 1;
        let v = self.view();
        accepted(
            &self.h.handle(
                1,
                Command::AirInput {
                    unit: self.unit,
                    epoch: self.epoch,
                    seq: self.seq,
                    aim: [v.state[48], v.state[49], v.state[50]],
                    throttle,
                    manual_pitch: 0.0,
                    manual_roll: roll,
                    manual_yaw: 0.0,
                    flags: 1 | 4 | 128 | 16,
                    fire,
                    release,
                },
                self.now,
            ),
            "actual pilot intent",
        );
    }

    fn park(&mut self) {
        let runway = self.h.maps["korea"]["airfields"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["enabled"] == true && f["team"] == 0)
            .unwrap()["runway"]
            .clone();
        let center = runway["center"].as_array().unwrap();
        let forward = runway["forward"].as_array().unwrap();
        let spawn = FlightSpawn {
            position: [
                center[0].as_f64().unwrap() as f32,
                (runway["height"].as_f64().unwrap() + 2.0) as f32,
                center[1].as_f64().unwrap() as f32,
            ],
            heading: forward[0]
                .as_f64()
                .unwrap()
                .atan2(forward[1].as_f64().unwrap()) as f32,
            airspeed: 0.0,
            on_ground: true,
        };
        self.h
            .rooms
            .get_mut(&1)
            .unwrap()
            .air
            .test_spawn_at(self.unit.unit, spawn);
        // A native pose alone is insufficient: clear the actual previous firing
        // and full-power controls before asking the host for service.
        self.input(0.0, 0.0, false, false);
        self.advance(10);
        let v = self.view();
        assert_eq!(v.state[36], 4.0, "actual native ground mode");
        assert!((1.5..=2.5).contains(&v.state[35]));
        assert!(v.state[33] >= 0.9);
        assert!(self.h.rooms[&1].air.at_friendly_runway(self.unit.unit));
    }

    fn damage_wing(&mut self) {
        let accepted_catalog: Value =
            serde_json::from_slice(&std::fs::read(data().join("aircraft/aircraft.json")).unwrap())
                .unwrap();
        let p = accepted_catalog["types"]["f86f"]["parts"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == "wing_l")
            .unwrap();
        let c: [f64; 3] = serde_json::from_value(p["c"].clone()).unwrap();
        let v = self.view();
        let at = std::array::from_fn(|i| {
            v.pos[i]
                + v.state[42 + i] as f64 * c[0]
                + v.state[45 + i] as f64 * c[1]
                + v.state[48 + i] as f64 * c[2]
        });
        self.h
            .rooms
            .get_mut(&1)
            .unwrap()
            .air
            .blast(at, 0.001, 1, 97, false, None);
    }

    fn request(&mut self, loadout: u32) {
        self.seq += 1;
        accepted(
            &self.h.handle(
                1,
                Command::ServiceAir {
                    unit: self.unit,
                    epoch: self.epoch,
                    seq: self.seq,
                    loadout,
                    custom: None, fuel_minutes: None,
                },
                self.now,
            ),
            "actual service request",
        );
    }

    fn cancel(&mut self) {
        self.seq += 1;
        accepted(
            &self.h.handle(
                1,
                Command::CancelAirService {
                    unit: self.unit,
                    epoch: self.epoch,
                    seq: self.seq,
                },
                self.now,
            ),
            "actual service cancellation",
        );
    }

    fn refresh_control(&mut self) {
        let p = &self.h.rooms[&1].members[&1].view;
        assert_eq!(p.controlled, Some(self.unit));
        self.epoch = p.epoch;
        self.seq = 0;
    }
}

fn completions(events: &[Value], r: UnitRef) -> usize {
    events
        .iter()
        .filter(|e| {
            e["kind"] == "air_service_complete" && e["target"]["unit"].as_u64() == Some(r.unit)
        })
        .count()
}

#[test]
fn real_fifteen_second_service_atomically_repairs_rearms_refuels_and_switches_same_aircraft() {
    let mut f = Fixture::parked(true);
    let before = f.view();
    let stock = resources(&before);
    let company = f.company.unwrap();
    let tank_refs = f.h.rooms[&1].companies[&company].view.units.clone();
    f.request(3);
    let started = f.view();
    assert_eq!(started.service.status, "servicing");
    assert_eq!(started.service.duration_s, 15.0);
    assert_eq!(started.service.loadout, Some(3));
    assert_eq!(resources(&started), stock);
    let mut events = f.advance(100);
    let progress = f.view().service;
    assert!(progress.elapsed_s > 4.9 && progress.elapsed_s < 5.1);
    f.request(3); //A new sequence with the same target is an idempotent query.
    assert_eq!(f.view().service, progress);
    let target = f.h.rooms[&1].target(Team::Blue);
    accepted(
        &f.h.handle(
            1,
            Command::Order {
                company,
                platoons: vec![0, 1, 2],
                kind: OrderKind::Defend,
                target,
                seq: 1,
            },
            f.now,
        ),
        "aircraft commander retains company commands while servicing",
    );
    events.extend(f.advance(198)); //14.9 actual simulated seconds since request.
    let pending = f.view();
    assert_eq!(pending.service.status, "servicing");
    assert!(pending.service.elapsed_s < 15.0);
    assert_eq!(
        resources(&pending),
        stock,
        "no partial grants at14.9seconds"
    );
    assert_eq!(completions(&events, f.unit), 0);
    events.extend(f.advance(3)); //15.05seconds, beyond one native float rounding step.
    let complete = f.view();
    assert_eq!(complete.service.status, "complete");
    assert_eq!(complete.service.elapsed_s, 15.0);
    assert_eq!(complete.service.remaining_s, 0.0);
    assert_eq!(complete.unit, before.unit);
    assert_eq!(complete.epoch, before.epoch);
    assert_eq!(complete.loadout, 3);
    assert_eq!(ammo(&complete), ammo(&f.pristine));
    assert_eq!(complete.fuel["total_kg"], f.pristine.fuel["total_kg"]);
    assert_eq!(remaining(&complete, "anm64"), 0);
    assert_eq!(remaining(&complete, "tank120"), 2);
    for (part, max) in complete.damage["parts"]
        .as_array()
        .unwrap()
        .iter()
        .zip(complete.damage["part_max_hp"].as_array().unwrap())
    {
        assert_eq!(part[0], *max);
        assert_eq!(part[1], 0);
    }
    assert!(
        complete.state[23] > before.state[23] + 14.9,
        "completion must not respawn/reset the original native instance"
    );
    assert_eq!(complete.pos[0], before.pos[0]);
    assert_eq!(complete.pos[2], before.pos[2]);
    assert_eq!(
        complete.state[18], before.state[18],
        "stopped native heading must survive service"
    );
    assert_eq!(completions(&events, f.unit), 1);
    assert_eq!(f.h.rooms[&1].companies[&company].view.units, tank_refs);
    assert_eq!(f.h.rooms[&1].members[&1].view.company, Some(company));
    assert_eq!(f.h.rooms[&1].members[&1].view.controlled, Some(f.unit));
    let revision = complete.resource_revision;
    let later = f.advance(20);
    let after = f.view();
    assert_eq!(completions(&later, f.unit), 0);
    assert_eq!(after.resource_revision, revision);
    assert_eq!(
        resources(&after),
        resources(&complete),
        "completed service is not a periodic refill"
    );
}

#[test]
fn actual_service_admission_and_shared_action_sequences_reject_without_inventory_changes() {
    let mut f = Fixture::spent_airborne(false);
    let airborne = resources(&f.view());
    rejected(
        &f.h.handle(
            1,
            Command::ServiceAir {
                unit: f.unit,
                epoch: f.epoch,
                seq: f.seq + 1,
                loadout: 3,
                custom: None, fuel_minutes: None,
            },
            f.now,
        ),
        "service_rejected",
    );
    assert_eq!(
        resources(&f.view()),
        airborne,
        "airborne request cannot teleport or restore"
    );
    f.park();
    let stock = resources(&f.view());
    let service = f.view().service;
    accepted(
        &f.h.handle(
            2,
            Command::Join {
                room: 1,
                observer: true,
                team: None,
            },
            f.now,
        ),
        "observer",
    );
    accepted(
        &f.h.handle(
            3,
            Command::Join {
                room: 1,
                observer: false,
                team: Some(Team::Red),
            },
            f.now,
        ),
        "foreign pilot",
    );
    for (player, r, epoch, code) in [
        (2, f.unit, f.epoch, "observer"),
        (3, f.unit, f.epoch, "stale_control"),
        (1, f.unit, f.epoch - 1, "stale_control"),
        (
            1,
            UnitRef {
                life: f.unit.life + 1,
                ..f.unit
            },
            f.epoch,
            "stale_control",
        ),
    ] {
        rejected(
            &f.h.handle(
                player,
                Command::ServiceAir {
                    unit: r,
                    epoch,
                    seq: 999,
                    loadout: 3,
                    custom: None, fuel_minutes: None,
                },
                f.now,
            ),
            code,
        );
        assert_eq!(resources(&f.view()), stock);
        assert_eq!(f.view().service, service);
    }
    rejected(
        &f.h.handle(
            1,
            Command::ServiceAir {
                unit: f.unit,
                epoch: f.epoch,
                seq: 999,
                loadout: u32::MAX,
                custom: None, fuel_minutes: None,
            },
            f.now,
        ),
        "era_or_loadout",
    );
    assert_eq!(resources(&f.view()), stock);
    f.request(3);
    let active = f.view().service;
    let sequence = f.seq;
    for (player, epoch, code) in [
        (2, f.epoch, "observer"),
        (3, f.epoch, "stale_control"),
        (1, f.epoch - 1, "stale_control"),
    ] {
        rejected(
            &f.h.handle(
                player,
                Command::CancelAirService {
                    unit: f.unit,
                    epoch,
                    seq: 999,
                },
                f.now,
            ),
            code,
        );
        assert_eq!(
            f.view().service,
            active,
            "foreign cancellation cannot reset progress"
        );
        assert_eq!(resources(&f.view()), stock);
    }
    rejected(
        &f.h.handle(
            1,
            Command::ServiceAir {
                unit: f.unit,
                epoch: f.epoch,
                seq: 999,
                loadout: 0,
                custom: None, fuel_minutes: None,
            },
            f.now,
        ),
        "service_rejected",
    );
    assert_eq!(
        f.view().service,
        active,
        "an active job cannot partially switch targets"
    );
    rejected(
        &f.h.handle(
            1,
            Command::CancelAirService {
                unit: f.unit,
                epoch: f.epoch,
                seq: sequence,
            },
            f.now,
        ),
        "stale_input",
    );
    let v = f.view();
    rejected(
        &f.h.handle(
            1,
            Command::AirInput {
                unit: f.unit,
                epoch: f.epoch,
                seq: sequence,
                aim: [v.state[48], v.state[49], v.state[50]],
                throttle: 1.0,
                manual_pitch: 0.0,
                manual_roll: 0.0,
                manual_yaw: 0.0,
                flags: 1,
                fire: true,
                release: false,
            },
            f.now,
        ),
        "stale_input",
    );
    assert_eq!(f.view().service, active);
    assert_eq!(resources(&f.view()), stock);
    f.cancel();
    let cancelled = f.view().service;
    rejected(
        &f.h.handle(
            1,
            Command::ServiceAir {
                unit: f.unit,
                epoch: f.epoch,
                seq: f.seq,
                loadout: 3,
                custom: None, fuel_minutes: None,
            },
            f.now,
        ),
        "stale_input",
    );
    assert_eq!(f.view().service, cancelled);
    assert_eq!(resources(&f.view()), stock);
}

#[test]
fn unsafe_controls_native_motion_new_damage_and_cancel_abort_without_a_service_grant() {
    for reason in [
        "throttle",
        "fire",
        "release",
        "native_motion",
        "new_damage",
        "cancel",
    ] {
        let mut f = Fixture::parked(false);
        f.request(3);
        f.advance(4);
        assert_eq!(f.view().service.status, "servicing");
        let stock = f.view();
        match reason {
            "throttle" => f.input(0.4, 0.0, false, false),
            "fire" => f.input(0.0, 0.0, true, false),
            "release" => f.input(0.0, 0.0, false, true),
            "native_motion" => {
                let v = f.view();
                f.h.rooms.get_mut(&1).unwrap().air.test_spawn_at(
                    f.unit.unit,
                    FlightSpawn {
                        position: v.pos.map(|p| p as f32),
                        heading: v.yaw as f32,
                        airspeed: 3.0,
                        on_ground: false,
                    },
                );
            }
            "new_damage" => f.damage_wing(),
            "cancel" => f.cancel(),
            _ => unreachable!(),
        }
        let events = f.advance(3);
        let after = f.view();
        assert_eq!(after.service.status, "cancelled", "{reason}");
        assert_eq!(after.service.elapsed_s, 0.0, "{reason}");
        assert_eq!(after.loadout, 4, "{reason}: no target-loadout grant");
        assert!(
            ammo(&after) <= ammo(&stock),
            "{reason}: no ammunition restoration"
        );
        assert!(
            after.fuel["total_kg"].as_f64().unwrap() <= stock.fuel["total_kg"].as_f64().unwrap(),
            "{reason}: no fuel restoration"
        );
        assert_eq!(completions(&events, f.unit), 0, "{reason}");
        assert_ne!(
            after.damage, f.pristine.damage,
            "{reason}: existing damage was not repaired"
        );
        if reason == "fire" {
            assert!(ammo(&after) < ammo(&stock));
        }
        if reason == "release" {
            assert!(remaining(&after, "anm64") < remaining(&stock, "anm64"));
        }
        if reason == "new_damage" {
            assert_ne!(after.damage, stock.damage);
        }
    }
}

#[test]
fn disconnect_and_resume_cancel_service_and_require_a_fresh_full_interval_on_same_aircraft() {
    let mut f = Fixture::parked(false);
    f.request(3);
    f.advance(20);
    assert!(f.view().service.elapsed_s > 0.9);
    let before = f.view();
    let count = f.h.rooms[&1].air.units.len();
    f.h.disconnect(1, f.now);
    assert_eq!(f.view().service.status, "cancelled");
    assert_eq!(f.view().service.elapsed_s, 0.0);
    accepted(&f.h.resume(1, f.now), "resume original servicing aircraft");
    f.refresh_control();
    let resumed = f.view();
    assert!(resumed.epoch > before.epoch);
    assert_eq!(resumed.unit, before.unit);
    assert_eq!(resumed.state, before.state);
    assert_eq!(resources(&resumed), resources(&before));
    f.request(3);
    assert_eq!(f.view().service.elapsed_s, 0.0);
    assert_eq!(f.view().service.remaining_s, 15.0);
    let events = f.advance(2);
    let restarted = f.view();
    assert!(restarted.service.elapsed_s > 0.09 && restarted.service.elapsed_s < 0.11);
    assert!(restarted.service.remaining_s > 14.89);
    assert_eq!(resources(&restarted), resources(&before));
    assert_eq!(completions(&events, f.unit), 0);
    assert_eq!(f.h.rooms[&1].air.units.len(), count);
}

#[test]
fn return_cancels_service_and_parked_loadout_switch_requires_explicit_service() {
    let mut f = Fixture::parked(true);
    f.request(3);
    f.advance(4);
    let before = f.view();
    let count = f.h.rooms[&1].air.units.len();
    let company = f.company.unwrap();
    accepted(
        &f.h.handle(1, Command::Return, f.now),
        "return cancels active service",
    );
    assert_eq!(f.view().service.status, "cancelled");
    assert_eq!(f.view().service.elapsed_s, 0.0);
    assert!(f.h.rooms[&1].members[&1].view.controlled.is_none());
    rejected(
        &f.h.handle(
            1,
            Command::DeployAir {
                aircraft: "f86f".into(),
                spawn: "runway".into(),
                loadout: 3,
                custom: None, fuel_minutes: None,
            },
            f.now,
        ),
        "service_required",
    );
    assert_eq!(resources(&f.view()), resources(&before));
    assert!(f.h.rooms[&1].members[&1].view.controlled.is_none());
    accepted(
        &f.h.handle(
            1,
            Command::DeployAir {
                aircraft: "f86f".into(),
                spawn: "runway".into(),
                loadout: 4,
                custom: None, fuel_minutes: None,
            },
            f.now,
        ),
        "rejoin current actual parked configuration",
    );
    f.refresh_control();
    assert_eq!(resources(&f.view()), resources(&before));
    f.request(3);
    assert_eq!(f.view().service.elapsed_s, 0.0);
    assert_eq!(f.view().service.remaining_s, 15.0);
    assert_eq!(f.h.rooms[&1].air.units.len(), count);
    assert_eq!(f.h.rooms[&1].members[&1].view.company, Some(company));
    assert_eq!(f.h.rooms[&1].companies[&company].view.units.len(), 10);
}

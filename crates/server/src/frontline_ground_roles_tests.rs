//! Source guns and feeds, real120Hz discharge and actual exterior contacts.
use super::*;
use crate::flight_runtime::FlightSpawn;
use crate::frontline::{Team, UnitRef};
use crate::frontline_air::{AirInput, AirTemplate};

fn data() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
}
fn map() -> Value {
    json!({"id":"ground_roles","terrain":{"width":3,"height":3,"cellX":10000.0,"cellZ":10000.0,"x0":-10000.0,"z0":-10000.0,"heights":vec![0.0;9]}})
}
fn world(vehicle: &str) -> SimWorld {
    let mut w = SimWorld::load(&data(), &map()).unwrap();
    w.spawn_unit(1, vehicle, 0, [0.0; 3], 0.0).unwrap();
    w.set_input(
        1,
        SimInput {
            brake: 1.0,
            ..Default::default()
        },
    )
    .unwrap();
    w
}
fn advance(w: &mut SimWorld, seconds: f64) -> Vec<SimEvent> {
    let mut out = Vec::new();
    for _ in 0..(seconds / FIXED_DT).round() as usize {
        out.extend(w.step(FIXED_DT));
    }
    out
}
fn shot_count(events: &[SimEvent], instance: &str) -> usize {
    events
        .iter()
        .filter(|e| e.kind == "shot" && e.detail["weapon_instance"] == instance)
        .count()
}

#[test]
fn campaign_roles_keep_actual_source_identity_year_and_improvised_status() {
    let w = world("de_flakpz38t");
    let early = w.ground_role_options(1943);
    assert!(early.iter().any(|o| o.vehicle == "de_flakpz38t"
        && o.role == GroundCombatRole::AirDefense
        && o.source_class == "spaa"
        && o.year == 1943));
    assert!(early.iter().any(|o| o.vehicle == "us_m10"
        && o.role == GroundCombatRole::FireSupport
        && o.source_class == "td"
        && !o.prototype));
    assert!(!early.iter().any(|o| o.vehicle == "de_gepard"
        || o.vehicle == "de_rso_flak"
        || o.vehicle == "su_att_m46"));
    let later = w.ground_role_options(1980);
    assert!(later.iter().any(|o| o.vehicle == "de_gepard"
        && o.year == 1976
        && o.role == GroundCombatRole::AirDefense));
    assert!(later
        .iter()
        .any(|o| o.vehicle == "su_att_m46" && o.prototype && o.source_class == "spg"));
    assert!(!later.iter().any(|o|o.vehicle=="xp_bmp_k64"||o.vehicle=="us_m901"||o.vehicle=="su_bmpt34"),"An unsupported wheel plant, missile or user-created conversion cannot become a renamed native IFV/SAM");
}

#[test]
fn held_gepard_fires_both_source_muzzles_at_cyclic_rate_with_independent_stock() {
    let mut w = world("de_gepard");
    let before = w.snapshot(1).unwrap();
    let total = w.units[&1].ammo.finite_total().unwrap();
    assert_eq!(total, 680);
    w.set_weapon_trigger(1, true).unwrap();
    let events = advance(&mut w, 5.0);
    w.set_weapon_trigger(1, false).unwrap();
    for instance in [MAIN, "gun:0:1"] {
        let n = shot_count(&events, instance);
        assert!(
            (45..=47).contains(&n),
            "{instance}:550rpm over5s must survive a20Hz caller, got{n}"
        );
        let pool: u32 = w.snapshot(1).unwrap().ammo_counts[instance].iter().sum();
        assert_eq!(pool, 340 - n as u32);
    }
    let left = events
        .iter()
        .find(|e| e.kind == "shot" && e.detail["weapon_instance"] == MAIN)
        .unwrap();
    let right = events
        .iter()
        .find(|e| e.kind == "shot" && e.detail["weapon_instance"] == "gun:0:1")
        .unwrap();
    let source = &w.units[&1].model.mounted;
    assert!(
        (length(sub(left.pos, right.pos))
            - (source[0].trunnion[0] - source[1].trunnion[0]).abs() as f64)
            .abs()
            < 0.01,
        "Independent source barrel mouths cannot collapse to one centre muzzle"
    );
    let shots = events.iter().filter(|e| e.kind == "shot").count() as u32;
    assert_eq!(w.units[&1].ammo.finite_total().unwrap(), total - shots);
    assert_eq!(
        w.snapshot(1).unwrap().ammo_revision,
        before.ammo_revision + shots as u64
    );
    let stopped = w.units[&1].ammo.clone();
    assert!(advance(&mut w, 0.5).iter().all(|e| e.kind != "shot"));
    assert_eq!(w.units[&1].ammo, stopped);
}

#[test]
fn flak_source_magazine_requires_real_reload_and_trigger_toggling_cannot_refill() {
    let mut w = world("de_flakpz38t");
    let source = w.units[&1].model.mounted[0].gun.autocannon.clone().unwrap();
    w.set_weapon_trigger(1, true).unwrap();
    let mut times = Vec::new();
    for _ in 0..(8.0 / FIXED_DT) as usize {
        for e in w.step(FIXED_DT) {
            if e.kind == "shot" {
                times.push(w.now);
            }
        }
        if times.len() == source.belt_rounds as usize {
            w.set_weapon_trigger(1, false).unwrap();
            w.set_weapon_trigger(1, true).unwrap();
        }
    }
    assert!(times.len() > source.belt_rounds as usize);
    let last = times[source.belt_rounds as usize - 1];
    let next = times[source.belt_rounds as usize];
    assert!(
        next - last >= source.belt_reload_s as f64 - 1e-6,
        "Empty20round magazine must take source3.5s to change"
    );
    for pair in times[..source.belt_rounds as usize].windows(2) {
        assert!(pair[1] - pair[0] >= source.interval_s() as f64 - FIXED_DT - 1e-6);
    }
    assert_eq!(w.snapshot(1).unwrap().ammo, 1040 - times.len() as u32);
}

#[test]
fn actual_primary_breech_damage_leaves_only_the_other_gepard_barrel_firing() {
    let mut w = world("de_gepard");
    let before = w.snapshot(1).unwrap();
    let u = w.units.get_mut(&1).unwrap();
    let part = u
        .model
        .target
        .def
        .modules
        .iter()
        .position(|m| m.id == "breech")
        .unwrap();
    u.state.modules[part] = 0.0;
    assert!(!tg_combat::caps(&u.model.target, &u.state).weapons[MAIN].can_fire);
    assert!(tg_combat::caps(&u.model.target, &u.state).weapons["gun:0:1"].can_fire);
    w.set_weapon_trigger(1, true).unwrap();
    let events = advance(&mut w, 0.2);
    assert_eq!(shot_count(&events, MAIN), 0);
    assert!(shot_count(&events, "gun:0:1") > 0);
    assert_eq!(
        w.snapshot(1).unwrap().ammo_counts[MAIN],
        before.ammo_counts[MAIN]
    );
    assert!(w.snapshot(1).unwrap().ammo_counts["gun:0:1"][0] < before.ammo_counts["gun:0:1"][0]);
}

#[test]
fn rejected_ammo_revision_is_atomic_for_every_mounted_feed() {
    for index in [0, 1] {
        let mut w = world("de_gepard");
        w.units.get_mut(&1).unwrap().ammo.revision = crate::ammo::MAX_SAFE_COUNTER;
        let inventory = w.units[&1].ammo.clone();
        let feed = w.units[&1].mounted_feeds[index].clone();
        assert!(w.fire_mounted(1, index, None).is_err());
        assert_eq!(w.units[&1].ammo, inventory);
        assert_eq!(w.serial, 0);
        assert_eq!(w.active_projectiles(), 0);
        let after = &w.units[&1].mounted_feeds[index];
        assert_eq!(
            (
                after.belt_left,
                after.next_shot,
                after.belt_ready,
                after.selected_ammo
            ),
            (
                feed.belt_left,
                feed.next_shot,
                feed.belt_ready,
                feed.selected_ammo
            )
        );
    }
}

#[test]
fn aiming_requests_source_slew_and_rejects_unreachable_or_nonfinite_solutions() {
    let mut w = world("de_gepard");
    let before = w.snapshot(1).unwrap();
    assert!(!w
        .aim_at_moving(1, [800.0, 300.0, 0.0], [0.0, 0.0, 100.0])
        .unwrap());
    assert_eq!(w.snapshot(1).unwrap().turret_yaw, before.turret_yaw);
    advance(&mut w, 0.05);
    let after = w.snapshot(1).unwrap();
    assert!(after.turret_yaw > 0.0 && after.turret_yaw <= (90.0f64 * 0.05).to_radians() + 1e-5);
    assert!(w
        .aim_at_moving(1, [1000.0, 300.0, 0.0], [2000.0, 0.0, 0.0])
        .is_err());
    assert!(w
        .aim_at_moving(1, [f64::NAN, 300.0, 0.0], [0.0; 3])
        .is_err());
    assert_eq!(w.snapshot(1).unwrap().ammo, before.ammo);
    let mut td = world("us_m10");
    assert!(!td.aim_at_moving(1, [0.0, 1000.0, 50.0], [0.0; 3]).unwrap());
    advance(&mut td, 0.2);
    assert!(
        td.snapshot(1).unwrap().gun_pitch <= (30.0f64).to_radians() + 1e-6,
        "An aim request cannot bypass the M10 elevation stop"
    );
}

#[test]
fn fire_support_selects_real_he_and_its_projectile_reaches_the_ground_without_target_hp_shortcuts()
{
    let mut m = map();
    let mut heights = vec![0.0; 5 * 13];
    for x in 0..5 {
        heights[6 * 5 + x] = 6.0;
    }
    m["terrain"] = json!({"width":5,"height":13,"cellX":1000.0,"cellZ":250.0,"x0":-2000.0,"z0":-500.0,"heights":heights});
    let mut w = SimWorld::load(&data(), &m).unwrap();
    w.spawn_unit(1, "us_m10", 0, [0.0; 3], 0.0).unwrap();
    w.set_input(
        1,
        SimInput {
            brake: 1.0,
            ..Default::default()
        },
    )
    .unwrap();
    let target = [0.0, 0.0, 1800.0];
    assert!(
        !w.line_of_sight([0.0, 2.2, 20.0], [0.0, 1.0, 1800.0]),
        "A real six-metre ridge must block direct sight"
    );
    let mut ready = false;
    for _ in 0..600 {
        ready = w.aim_indirect(1, target).unwrap();
        if ready {
            break;
        }
        w.step(0.05);
    }
    assert!(ready, "Native source elevation and traverse must converge");
    advance(&mut w, 0.1);
    let before = w.snapshot(1).unwrap();
    let shot = w.fire(1, None).unwrap();
    assert_eq!(shot.detail["projectile_id"], "he_76_m42a1");
    assert_eq!(w.snapshot(1).unwrap().ammo, before.ammo - 1);
    let events = advance(&mut w, 5.0);
    let impact = events
        .iter()
        .find(|e| e.kind == "terrain_impact" && e.detail["shot_id"] == shot.detail["shot_id"])
        .expect("A real admitted source HE shell must fly and meet terrain");
    assert!((impact.pos[2]-target[2]).abs()<180.0,"The real source HE trajectory must clear the ridge; low-angle source dispersion remains physical: {:?}",impact.pos);
    assert_eq!(w.active_projectiles(), 0);
}

#[test]
fn actual_gepard_rounds_lead_and_hit_a_live_wasm_aircraft_through_shared_contacts() {
    let mut m = map();
    m["objectives"] = json!([{"id":"C2","pos":[0,0,0]}]);
    m["airfields"] = json!([{"id":"red","team":1,"enabled":true,"runway":{"center":[2000,0],"forward":[0,1],"height":0,"lengthMeters":2000,"widthMeters":40}}]);
    m["airspawns"] = json!([{"team":1,"enabled":true,"pos":[2000,600,0]}]);
    let mut w = SimWorld::load(&data(), &m).unwrap();
    w.spawn_unit(1, "de_gepard", 0, [0.0; 3], 0.0).unwrap();
    w.set_input(
        1,
        SimInput {
            brake: 1.0,
            ..Default::default()
        },
    )
    .unwrap();
    let mut air = AirTemplate::load(&data())
        .unwrap()
        .world(Arc::new(w.ground.clone()), m);
    air.spawn(
        UnitRef {
            battle: 1,
            unit: 71,
            life: 1,
        },
        "f86f",
        Team::Red,
        Some(7),
        "air",
        0,
    )
    .unwrap();
    air.units.get_mut(&71).unwrap().controller = Some(7);
    air.test_spawn_at(
        71,
        FlightSpawn {
            position: [-120.0, 170.0, 650.0],
            heading: std::f32::consts::FRAC_PI_2,
            airspeed: 135.0,
            on_ground: false,
        },
    );
    let initial = air.views()[0].clone();
    let stock = w.units[&1].ammo.finite_total().unwrap();
    let mut events = Vec::new();
    for frame in 0..600 {
        air.accept_input(
            71,
            AirInput {
                aim: [1.0, 0.0, 0.0],
                throttle: 0.7,
                manual_pitch: 0.0,
                manual_roll: 0.0,
                manual_yaw: 0.0,
                flags: 1,
                fire: false,
                release: false,
            },
            w.now,
        )
        .unwrap_or(());
        if frame % 6 == 0 {
            let target = air.combat_targets()[0];
            let ready = w
                .aim_at_moving(1, target.pos, target.velocity)
                .unwrap_or(false);
            w.set_weapon_trigger(1, ready && target.alive).unwrap();
        }
        events.extend(w.step_combined(FIXED_DT, &mut air));
        if events
            .iter()
            .any(|e| e.kind == "impact" && e.shooter == Some(1) && e.target == Some(71))
        {
            break;
        }
    }
    let shots = events
        .iter()
        .filter(|e| e.kind == "shot" && e.shooter == Some(1))
        .count();
    assert!(shots > 0);
    assert_eq!(
        w.units[&1].ammo.finite_total().unwrap(),
        stock - shots as u32
    );
    assert!(
        events
            .iter()
            .any(|e| e.kind == "impact" && e.shooter == Some(1) && e.target == Some(71)),
        "A native AA projectile must contact the actual accepted aircraft body; events={:?}",
        events
            .iter()
            .map(|e| (&e.kind, e.target))
            .collect::<Vec<_>>()
    );
    let after = air.views()[0].clone();
    assert_ne!(
        after.pos, initial.pos,
        "The target must move under its actual WASM plant"
    );
    assert_ne!(
        after.damage, initial.damage,
        "Accepted aircraft damage, not a role HP counter, must own the effect"
    );
}

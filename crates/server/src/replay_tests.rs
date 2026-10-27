use super::*;
use serde_json::json;

fn send(l: &mut Lobby, id: u32, mut v: Value, now: f64) -> Out {
    if v["t"] == "state" {
        super::gameplay_tests::fixture_state(l, id, &mut v["s"], now);
    }
    if matches!(v["t"].as_str(), Some("fire" | "mg_fire" | "launch")) {
        v["ammo_scope"] = json!(l.ammo_scope(id));
    }
    l.handle(id, serde_json::from_value(v).unwrap(), now)
}
fn connect(l: &mut Lobby) -> u32 {
    let (id, _) = l.connect();
    send(
        l,
        id,
        json!({"t":"hello","name":"replay","gameplay_rules_version":GAMEPLAY_RULES_VERSION,"ammo_protocol_version":1}),
        0.0,
    );
    id
}
fn fixture() -> (Lobby, u32, u32, u32, u32) {
    fixture_vehicle("us_m4a3_75w")
}
fn fixture_vehicle(victim: &str) -> (Lobby, u32, u32, u32, u32) {
    fixture_vehicle_plan(victim, false)
}
fn fixture_vehicle_plan(victim: &str, full: bool) -> (Lobby, u32, u32, u32, u32) {
    let mut l = super::ammo_tests::real_lobby();
    let a = connect(&mut l);
    let b = connect(&mut l);
    let c = connect(&mut l);
    send(
        &mut l,
        a,
        json!({"t":"create","name":"replay","map":"range","max":8,"deploy":true,"gameplay_mode":"casual","gameplay_rules_version":GAMEPLAY_RULES_VERSION}),
        0.0,
    );
    let room = l.players[&a].room.unwrap();
    for id in [b, c] {
        send(&mut l, id, json!({"t":"join","room":room}), 0.0);
    }
    send(&mut l, b, json!({"t":"team","team":"red"}), 0.0);
    send(&mut l, a, json!({"t":"start"}), 0.0);
    for (id, veh) in [(a, "de_tiger_e"), (b, victim), (c, "de_tiger_e")] {
        let mut deploy = json!({"t":"deploy","vehicle":veh});
        if full && veh == "de_tiger_e" {
            deploy["ammo_mix"] = json!({"gun:0:0":[46,40,6]});
        }
        let out = send(&mut l, id, deploy, 0.0);
        assert!(
            out.iter()
                .any(|(_, m)| matches!(m,ServerMsg::Respawned {id:to,..} if *to==id)),
            "deploy {veh}: {out:?}"
        );
        send(
            &mut l,
            id,
            json!({"t":"state","s":{"pos":[if id==c {10}else{0},0,0]}}),
            0.0,
        );
    }
    (l, a, b, c, room)
}
fn recipients(out: &Out) -> Vec<Value> {
    out.iter()
        .filter(|(_, m)| matches!(m, ServerMsg::Damage { .. }))
        .map(|(to, m)| json!({"to":to,"message":m}))
        .collect()
}
fn hit(l: &mut Lobby, a: u32, b: u32, seq: u32, shot: &WireShot, now: f64) -> Out {
    hit_shell(l, a, b, seq, shot, now, "apcbc_88_l56")
}
fn hit_shell(
    l: &mut Lobby,
    a: u32,
    b: u32,
    seq: u32,
    shot: &WireShot,
    now: f64,
    shell: &str,
) -> Out {
    send(
        l,
        a,
        json!({"t":"fire","seq":seq,"instance":"gun:0:0","shell":shell,"o":[0,0,0],"d":[0,0,1]}),
        now,
    );
    send(
        l,
        a,
        json!({"t":"hit","seq":seq,"target":b,"result":"penetrated","plate":null,"shot":{"o":shot.o,"d":shot.d,"yaw":shot.yaw,"speed":shot.speed,"dist":shot.dist}}),
        now + 0.001,
    )
}
fn flat(out: Broadcast) -> Out {
    out.into_iter()
        .flat_map(|(tos, m)| tos.into_iter().map(move |to| (to, m.clone())))
        .collect()
}
fn message(out: &Out, to: u32, kind: &str) -> Value {
    out.iter()
        .filter(|(id, _)| *id == to)
        .map(|(_, m)| serde_json::to_value(m).unwrap())
        .find(|m| m["t"] == kind)
        .unwrap_or(Value::Null)
}
fn all_recipients(out: &Out) -> Vec<Value> {
    out.iter()
        .map(|(to, m)| json!({"to":to,"message":m}))
        .collect()
}
#[test]
fn replay_single_resume_trail_before_first_sample_uses_accepted_endpoint() {
    let trail = VecDeque::from([(0.01, [0.0, 0.0, 0.0])]);
    assert_eq!(trail_at(&trail, 0.0), Some([0.0, 0.0, 0.0]));
    assert_eq!(trail_at(&trail, -0.1), None);
}
#[test]
fn replay_extinguish_status_sanitizes_observer_internal_state() {
    let (mut l, a, b, c, _) = fixture();
    let (seq, shot) = ignition_fixture(&l, a, b);
    hit(&mut l, a, b, seq, &shot, 0.0);
    let out = send(&mut l, b, json!({"t":"extinguish"}), 0.1);
    let public = message(&out, c, "status");
    assert!(public["state"].get("fire_at").is_none());
    assert!(public["state"].get("active_fire_cause").is_none());
    assert!(message(&out, b, "status")["state"].get("fire_at").is_some());
}
fn phase(name: &str, scenario: &str, out: Out) -> Value {
    json!({"name":name,"scenario":scenario,"recipients":all_recipients(&out)})
}
fn legacy_mg(l: &mut Lobby, a: u32, b: u32, shot: &WireShot, now: f64) -> Out {
    let instance = l.targets[&l.players[&a].vehicle]
        .weapon_bindings
        .iter()
        .find(|(_, w)| w.kind == WeaponKind::MachineGun && w.model_id == "mg34")
        .unwrap()
        .0
        .clone();
    send(
        l,
        a,
        json!({"t":"mg_hit","instance":instance,"target":b,"gun":"mg34","shot":{"o":shot.o,"d":shot.d,"yaw":shot.yaw,"speed":shot.speed,"dist":shot.dist}}),
        now,
    )
}
#[test]
fn replay_legacy_mg_preserves_known_shooter_without_discharge() {
    let (mut l, a, b, _, _) = fixture();
    let before = l.players[&b].combat.clone();
    let version = l.players[&b].replay.version;
    let shot = WireShot {
        o: [0.0, 2.0, 6.0],
        d: [0.0, 0.0, -1.0],
        yaw: 0.0,
        speed: 750.0,
        dist: 0.0,
    };
    let out = legacy_mg(&mut l, a, b, &shot, 0.1);
    let rows = recipients(&out);
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0]["to"], a,
        "legacy stopped feedback belongs to known shooter"
    );
    assert_eq!(rows[0]["message"]["from"], a);
    assert!(rows[0]["message"].get("replay").is_none());
    assert!(rows[0]["message"].get("hit_feedback").is_none());
    assert_eq!(
        serde_json::to_value(&l.players[&b].combat).unwrap(),
        serde_json::to_value(&before).unwrap()
    );
    assert_eq!(l.players[&b].replay.version, version);
}
#[test]
fn replay_legacy_mg_real_crew_hits_keep_immediate_lethal_credit() {
    let (mut l, a, b, c, _) = fixture_vehicle("de_rso_flak");
    let crew = l.targets["de_rso_flak"].def.crew.clone();
    let mut last = Vec::new();
    let mut damaged = false;
    for (i, seat) in crew.iter().enumerate() {
        for n in 0..4 {
            if !l.players[&b].alive {
                break;
            }
            let p = seat.pos;
            let shot = WireShot {
                o: [p.x, p.y + 2.0, p.z],
                d: [0.0, -1.0, 0.0],
                yaw: 0.0,
                speed: 750.0,
                dist: 0.0,
            };
            let out = legacy_mg(&mut l, a, b, &shot, 0.1 + (i * 4 + n) as f64 * 0.001);
            if !message(&out, b, "damage").is_null() {
                damaged = true;
                assert_eq!(message(&out, b, "damage")["from"], a);
                assert!(message(&out, b, "damage").get("replay").is_none());
                assert!(message(&out, c, "damage").get("report").is_none());
                last = out;
            }
        }
    }
    assert!(damaged, "actual legacy MG rays must damage fresh real crew");
    assert!(
        !l.players[&b].alive,
        "genuine MG shots must cause an immediate terminal transition"
    );
    assert_eq!(message(&last, b, "damage")["killed"], true);
    assert_eq!((l.players[&a].kills, l.players[&b].deaths), (1, 1));
}
fn admitted_mg_receipts() -> Vec<Value> {
    let (mut l, a, b, c, room) = fixture_vehicle("de_rso_flak");
    let mut phases = vec![phase(
        "admission",
        "admitted_mg",
        admitted(&mut l, a, b, c, room),
    )];
    let instance = l.targets["de_tiger_e"]
        .weapon_bindings
        .iter()
        .find(|(_, w)| w.kind == WeaponKind::MachineGun && w.model_id == "mg34")
        .unwrap()
        .0
        .clone();
    let crew = l.targets["de_rso_flak"].def.crew.clone();
    let mut seq = 0u32;
    let mut terminal = Value::Null;
    for seat in crew {
        for _ in 0..4 {
            if !l.players[&b].alive {
                break;
            }
            seq += 1;
            let p = seat.pos;
            let o = [p.x, p.y + 2.0, p.z];
            let d = [0.0, -1.0, 0.0];
            let now = 0.1 + seq as f64 * 0.002;
            let fired = send(
                &mut l,
                a,
                json!({"t":"mg_fire","seq":seq,"instance":instance,"gun":"mg34","o":o,"d":d}),
                now,
            );
            assert!(
                l.players[&a]
                    .fired
                    .iter()
                    .any(|f| f.seq == seq && f.kind == WeaponKind::MachineGun),
                "actual MG discharge is admitted"
            );
            phases.push(phase("mg_discharge", "admitted_mg", fired));
            let out = send(
                &mut l,
                a,
                json!({"t":"mg_hit","seq":seq,"instance":instance,"target":b,"gun":"mg34","shot":{"o":o,"d":d,"yaw":0.0,"speed":750.0,"dist":0.0}}),
                now + 0.001,
            );
            let owner = message(&out, b, "damage");
            if !owner.is_null() {
                let e = &owner["replay"];
                assert_eq!(
                    e["projectile_id"], "bullet_mg34",
                    "catalog body uses the actual MG bullet identity"
                );
                assert_eq!(e["weapon_instance"], instance);
                assert_eq!(e["shooter"]["entity"], a);
                assert_eq!(e["actor"]["entity"], b);
                assert!((e["report"]["caliber_mm"].as_f64().unwrap() - 7.92).abs() < 1e-5);
                assert!(message(&out, c, "damage").get("replay").is_none());
                assert!(message(&out, c, "damage").get("report").is_none());
                if owner["killed"] == true {
                    terminal = owner.clone();
                    assert_eq!(e["deaths"][0]["cause_event_id"], e["event_id"]);
                }
            }
            phases.push(phase("mg_impact", "admitted_mg", out));
        }
    }
    assert!(
        !l.players[&b].alive,
        "admitted real MG crew rays cause an immediate lethal transition"
    );
    assert_eq!(terminal["killed"], true);
    assert_eq!((l.players[&a].kills, l.players[&b].deaths), (1, 1));
    let resume = resumed(&mut l, b, 0.5);
    let status = message(&resume, b, "status");
    assert_eq!(status["state"]["destroyed"], true);
    assert_eq!(
        status["replay_checkpoint"]["cause_event_id"],
        terminal["replay"]["event_id"]
    );
    phases.push(phase("mg_fatal_status", "admitted_mg", resume));
    phases
}
#[test]
fn replay_admitted_mg_lethal_uses_catalog_bullet_and_owner_death_records() {
    assert!(!admitted_mg_receipts().is_empty());
}
fn resumed(l: &mut Lobby, b: u32, now: f64) -> Out {
    let token = l.players[&b].token.clone();
    l.drop_link(b, now);
    let (replacement, _) = l.connect();
    let (_,out)=l.dispatch_socket(replacement,serde_json::from_value(json!({"t":"hello","name":"resume","resume":token,"gameplay_rules_version":GAMEPLAY_RULES_VERSION,"ammo_protocol_version":1})).unwrap(),now+0.01);
    out
}
fn admitted(l: &mut Lobby, a: u32, b: u32, c: u32, _room: u32) -> Out {
    let mut out = Vec::new();
    for id in [a, b, c] {
        out.extend(resumed(l, id, 0.0));
        let state = l.players[&id].state.clone().unwrap();
        out.extend(send(l, id, json!({"t":"state","s":state}), 0.01));
    }
    out
}
fn gap_receipts() -> Vec<Value> {
    let (mut l, a, b, c, room) = fixture();
    let mut phases = vec![phase("admission", "gap", admitted(&mut l, a, b, c, room))];
    let (seq, shot) = ignition_fixture(&l, a, b);
    let one = hit(&mut l, a, b, seq, &shot, 0.0);
    let source = message(&one, b, "damage")["replay"].clone();
    assert_eq!(source["commit_seq"], 1);
    assert!(!source["report"]["state"]["destroyed"].as_bool().unwrap());
    let ordinary = WireShot {
        o: [3.0, 0.1, 0.0],
        d: [-1.0, 0.0, 0.0],
        yaw: 0.0,
        speed: 700.0,
        dist: 0.0,
    };
    let two = hit(&mut l, c, b, 1, &ordinary, 0.02);
    let three = hit(&mut l, c, b, 2, &ordinary, 0.04);
    assert_eq!(message(&two, b, "damage")["replay"]["commit_seq"], 2);
    assert_eq!(message(&three, b, "damage")["replay"]["commit_seq"], 3);
    let snapshot = flat(l.tick_at(0.05));
    phases.push(phase("snapshot_before_fatal", "gap", snapshot));
    send(&mut l, b, json!({"t":"ping","at":0}), 35.1);
    let fatal = flat(l.advance_combat(35.0));
    let e = message(&fatal, b, "damage")["replay"].clone();
    assert_eq!(e["event_id"], source["event_id"]);
    assert_eq!(e["report"], source["report"]);
    assert_eq!(e["accepted_pose"], source["accepted_pose"]);
    assert_eq!(e["state_before"], source["state_before"]);
    assert_eq!(e["commit_seq"], 1);
    assert_eq!(e["deaths"][0]["commit_seq"], 4);
    assert_eq!(e["deaths"][0]["cause_event_id"], source["event_id"]);
    assert_eq!(
        (
            l.players[&a].kills,
            l.players[&c].kills,
            l.players[&b].deaths
        ),
        (1, 0, 1)
    );
    let canonical = [one.clone(), two.clone(), three.clone(), fatal.clone()];
    for out in canonical {
        phases.push(phase("gap_1_3_late_2_fatal_older_cause", "gap", out));
    }
    phases.push(phase("fire_a_hit_b_death", "gap", fatal));
    let dup = send(
        &mut l,
        c,
        json!({"t":"hit","seq":2,"target":b,"result":"penetrated","plate":null,"shot":{"o":ordinary.o,"d":ordinary.d,"speed":700,"dist":0}}),
        35.2,
    );
    assert!(dup.is_empty());
    phases.push(phase("duplicate", "gap", dup));
    let resume = resumed(&mut l, b, 35.3);
    let checkpoint = message(&resume, b, "status")["replay_checkpoint"].clone();
    assert_eq!(checkpoint["baseline_commit"], 0);
    assert_eq!(checkpoint["covered_through"], 4);
    assert_eq!(
        checkpoint["canonical_identity_binding"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    phases.push(phase("resume", "gap", resume.clone()));
    phases.push(phase("coverage_checkpoint", "gap", resume));
    let old = shot_flight::actor(&l.players[&b]).unwrap();
    send(
        &mut l,
        b,
        json!({"t":"deploy","vehicle":"us_m4a3_75w"}),
        41.0,
    );
    let fresh = shot_flight::actor(&l.players[&b]).unwrap();
    assert!(fresh.life > old.life);
    let stale = send(
        &mut l,
        a,
        json!({"t":"hit","seq":seq,"target":b,"result":"penetrated","plate":null,"shot":{"o":shot.o,"d":shot.d,"speed":700,"dist":0}}),
        41.1,
    );
    assert!(stale.is_empty());
    phases.push(phase("respawn_stale", "gap", stale));
    phases
}

fn mechanism_shot(l: &Lobby, a: u32, b: u32, want: &str) -> (u32, WireShot, f64, &'static str) {
    let t = &l.targets[&l.players[&b].vehicle];
    let st = l.players[&b].combat.as_ref().unwrap();
    let ctx = tg_combat::causes::DamageContext {
        actor: shot_flight::actor(&l.players[&b]).unwrap(),
        shooter: shot_flight::actor(&l.players[&a]).unwrap(),
        event_id: "fixture_search".into(),
        shot_id: "fixture_search".into(),
        pose_revision: 0,
        geometry_revision: 0,
    };
    for shell_id in ["apcr_88_pzgr40", "apcbc_88_l56"] {
        for seq in 1..=128 {
            for y in [0.7, 1.0, 1.3, 1.5, 1.8, 2.0, 2.2] {
                for z in [-2.3, -2.0, -1.5, -1.0, -0.5, 0.0, 0.4, 0.8, 1.2] {
                    for (o, d) in [
                        ([3.0, y, z], [-1.0, 0.0, 0.0]),
                        ([z, y, -6.0], [0.0, 0.0, 1.0]),
                        ([z, y, 6.0], [0.0, 0.0, -1.0]),
                    ] {
                        let shot = WireShot {
                            o,
                            d,
                            yaw: 0.0,
                            speed: 700.0,
                            dist: 0.0,
                        };
                        let r = tg_combat::shoot_context(
                            t,
                            st,
                            &tg_combat::Shot {
                                shell: l.projectiles[shell_id].clone(),
                                origin: Vec3::new(o[0], o[1], o[2]),
                                dir: Vec3::new(d[0], d[1], d[2]),
                                speed_ms: 700.0,
                                distance_m: 0.0,
                                seed: shot_seed(a, seq),
                                turret_yaw: 0.0,
                            },
                            &ctx,
                        );
                        if want == "immediate_ammo" && r.state.ammo_detonated && r.state.destroyed {
                            return (seq, shot, 0.0, shell_id);
                        }
                        if r.state.destroyed || r.cause_transitions.is_empty() {
                            continue;
                        }
                        if want == "fire_start" {
                            return (seq, shot, 0.0, shell_id);
                        }
                        if want == "delayed_ammo" {
                            for dt in [1.0, 5.0, 10.0, 15.0, 20.0, 25.0, 35.0] {
                                let mut after = r.state.clone();
                                tg_combat::advance(
                                    t,
                                    &mut after,
                                    dt as f32,
                                    shot_seed(b, (dt * 4.0) as u32),
                                );
                                if after.ammo_detonated && after.destroyed {
                                    return (seq, shot, dt, shell_id);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    panic!("no genuine {want} shot for {}", l.players[&b].vehicle)
}
fn mechanism_receipts() -> Vec<Value> {
    let mut phases = Vec::new();
    for ongoing in [true, false] {
        let (mut l, a, b, c, room) = fixture();
        let scenario = if ongoing { "replacement" } else { "reignition" };
        phases.push(phase(
            "admission",
            scenario,
            admitted(&mut l, a, b, c, room),
        ));
        let (seq, shot) = ignition_fixture(&l, a, b);
        let first = hit(&mut l, a, b, seq, &shot, 0.1);
        let old = message(&first, b, "damage")["replay"]["event_id"].clone();
        if !ongoing {
            let extinguish = send(&mut l, b, json!({"t":"extinguish"}), 0.2);
            phases.push(phase("extinguish", scenario, extinguish));
            send(&mut l, b, json!({"t":"ping","at":0}), 1.7);
            let end = flat(l.advance_combat(1.5));
            assert!(l.players[&b]
                .combat
                .as_ref()
                .unwrap()
                .active_fire_cause
                .is_none());
            assert!(l.players[&b].replay.pinned.is_none());
            phases.push(phase("extinguish", scenario, end));
        }
        let (seq, shot, _, shell) = mechanism_shot(&l, c, b, "fire_start");
        let new = hit_shell(&mut l, c, b, seq, &shot, 2.0, shell);
        let rep = message(&new, b, "damage");
        assert_ne!(rep["replay"]["event_id"], old);
        assert_eq!(
            rep["report"]["cause_transitions"][0]["kind"],
            if ongoing { "replaced" } else { "started" }
        );
        assert_eq!(
            l.players[&b]
                .combat
                .as_ref()
                .unwrap()
                .active_fire_cause
                .as_ref()
                .unwrap()
                .shooter
                .entity,
            c
        );
        phases.push(phase(
            if ongoing { "replacement" } else { "reignition" },
            scenario,
            new,
        ));
    }
    for kind in ["immediate_ammo", "delayed_ammo"] {
        let (mut l, a, b, c, room) = fixture_vehicle(if kind == "delayed_ammo" {
            "de_pz3_j"
        } else {
            "us_m4a3_75w"
        });
        phases.push(phase("admission", kind, admitted(&mut l, a, b, c, room)));
        let (seq, shot, dt, shell) = mechanism_shot(&l, a, b, kind);
        let out = hit_shell(&mut l, a, b, seq, &shot, 6.0, shell);
        let source = message(&out, b, "damage")["replay"].clone();
        phases.push(phase(kind, kind, out));
        if dt > 0.0 {
            assert!(l.players[&b].alive);
            send(&mut l, b, json!({"t":"ping","at":0}), 6.1 + dt);
            let fatal = flat(l.advance_combat(dt));
            let e = message(&fatal, b, "damage")["replay"].clone();
            assert_eq!(e["report"], source["report"]);
            assert_eq!(e["deaths"][0]["reason"], "ammo_detonation");
            assert_eq!(e["deaths"][0]["cause_event_id"], source["event_id"]);
            phases.push(phase(kind, kind, fatal));
        }
        assert_eq!((l.players[&b].deaths, l.players[&a].kills), (1, 1));
        let again = flat(l.advance_combat(0.25));
        assert!(again
            .iter()
            .all(|(_, m)| !matches!(m, ServerMsg::Damage { killed: true, .. })));
    }
    phases
}

fn replay_source_tags() -> Value {
    use sha2::{Digest, Sha256};
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    for (name, compiled) in [
        (
            "crates/server/src/lobby.rs",
            include_bytes!("lobby.rs").as_slice(),
        ),
        (
            "crates/server/src/replay_receipts.rs",
            include_bytes!("replay_receipts.rs").as_slice(),
        ),
        (
            "crates/server/src/shot_flight.rs",
            include_bytes!("shot_flight.rs").as_slice(),
        ),
        (
            "crates/server/src/replay_tests.rs",
            include_bytes!("replay_tests.rs").as_slice(),
        ),
        (
            "crates/server/src/ammo_tests.rs",
            include_bytes!("ammo_tests.rs").as_slice(),
        ),
        (
            "crates/combat/src/lib.rs",
            include_bytes!("../../combat/src/lib.rs").as_slice(),
        ),
        (
            "crates/combat/src/causes.rs",
            include_bytes!("../../combat/src/causes.rs").as_slice(),
        ),
        (
            "crates/combat/src/replay_evidence.rs",
            include_bytes!("../../combat/src/replay_evidence.rs").as_slice(),
        ),
        (
            "crates/combat/src/impact_report.rs",
            include_bytes!("../../combat/src/impact_report.rs").as_slice(),
        ),
        (
            "crates/ballistics/src/lib.rs",
            include_bytes!("../../ballistics/src/lib.rs").as_slice(),
        ),
        (
            "crates/penetration/src/impact.rs",
            include_bytes!("../../penetration/src/impact.rs").as_slice(),
        ),
        (
            "crates/missile/src/lib.rs",
            include_bytes!("../../missile/src/lib.rs").as_slice(),
        ),
        (
            "crates/missile/src/world.rs",
            include_bytes!("../../missile/src/world.rs").as_slice(),
        ),
        (
            "crates/missile/src/def.rs",
            include_bytes!("../../missile/src/def.rs").as_slice(),
        ),
        (
            "crates/design-wasm/src/lib.rs",
            include_bytes!("../../design-wasm/src/lib.rs").as_slice(),
        ),
        (
            "crates/combat/src/weapon_damage.rs",
            include_bytes!("../../combat/src/weapon_damage.rs").as_slice(),
        ),
        (
            "crates/combat/src/tests.rs",
            include_bytes!("../../combat/src/tests.rs").as_slice(),
        ),
        (
            "crates/penetration/src/lib.rs",
            include_bytes!("../../penetration/src/lib.rs").as_slice(),
        ),
        (
            "crates/armor/src/lib.rs",
            include_bytes!("../../armor/src/lib.rs").as_slice(),
        ),
        (
            "crates/damage/src/module_state.rs",
            include_bytes!("../../damage/src/module_state.rs").as_slice(),
        ),
        (
            "crates/shared/src/lib.rs",
            include_bytes!("../../shared/src/lib.rs").as_slice(),
        ),
        (
            "crates/weapon/src/lib.rs",
            include_bytes!("../../weapon/src/lib.rs").as_slice(),
        ),
        (
            "crates/combat/src/geometry/mod.rs",
            include_bytes!("../../combat/src/geometry/mod.rs").as_slice(),
        ),
        (
            "crates/combat/src/geometry/bvh.rs",
            include_bytes!("../../combat/src/geometry/bvh.rs").as_slice(),
        ),
        (
            "crates/combat/src/geometry/manifest.rs",
            include_bytes!("../../combat/src/geometry/manifest.rs").as_slice(),
        ),
        (
            "crates/combat/src/geometry/ray.rs",
            include_bytes!("../../combat/src/geometry/ray.rs").as_slice(),
        ),
        (
            "crates/combat/src/geometry/surface.rs",
            include_bytes!("../../combat/src/geometry/surface.rs").as_slice(),
        ),
    ] {
        assert_eq!(
            std::fs::read(root.join(name)).unwrap(),
            compiled,
            "stale native receipt producer: {name}"
        );
    }
    let mut names: Vec<String> = super::ammo_tests::source_tags()
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect();
    names.extend(
        [
            "crates/combat/src/replay_evidence.rs",
            "crates/combat/src/causes.rs",
            "crates/combat/src/impact_report.rs",
            "crates/combat/src/geometry/mod.rs",
            "crates/combat/src/geometry/surface.rs",
            "crates/combat/src/geometry/ray.rs",
            "crates/combat/src/geometry/manifest.rs",
            "crates/combat/src/geometry/bvh.rs",
            "crates/server/src/replay_receipts.rs",
            "crates/server/src/shot_flight.rs",
            "crates/server/src/replay_tests.rs",
            "crates/ballistics/src/lib.rs",
            "crates/penetration/src/impact.rs",
            "crates/penetration/src/lib.rs",
            "crates/armor/src/lib.rs",
            "crates/damage/src/module_state.rs",
            "crates/shared/src/lib.rs",
            "crates/weapon/src/lib.rs",
            "client/web/src/game/replayEvidence.js",
            "client/web/src/game/localReplayAdmission.js",
            "client/web/src/game/combat.js",
            "client/web/src/design/core.js",
            "client/web/src/game/net.js",
            "client/web/src/main.js",
            "client/web/src/game/missiles.js",
            "client/web/src/game/rangeTargetRevival.js",
            "client/web/src/game/onlineAmmo.js",
        ]
        .map(String::from),
    );
    names.extend(
        [
            "crates/combat/src/tests.rs",
            "crates/missile/src/lib.rs",
            "client/web/src/game/enemies.js",
            "client/web/test/live-network-rig.mjs",
            "client/web/test/replay-network.test.mjs",
            "client/web/test/replay-local.test.mjs",
            "client/web/test/replay-evidence.test.mjs",
            "client/web/test/replay-core-compat.test.mjs",
            "client/web/test/replay-atomic.test.mjs",
            "client/web/test/replay-source-preflight.test.mjs",
        ]
        .map(String::from),
    );
    names.extend(
        [
            "client/web/src/game/projectileReplay.js",
            "client/web/src/game/projectileFlight.js",
            "client/web/src/game/projectileVisuals.js",
            "client/web/src/game/replayRecords.js",
            "client/web/src/game/replaySession.js",
            "client/web/src/game/replayClock.js",
            "client/web/src/game/replayCamera.js",
            "client/web/src/game/replayPose.js",
            "client/web/src/game/victimReplay.js",
            "client/web/src/game/hitcam.js",
            "client/web/src/gfx/replayDraw.js",
            "client/web/src/gfx/replayShaders.js",
            "client/web/src/gfx/renderer.js",
            "client/web/src/gfx/shaders.js",
            "client/web/test/replay-v3-main.test.mjs",
            "client/web/test/replay-v3-renderer.test.mjs",
            "client/web/test/replay-v3-session.test.mjs",
            "client/web/test/replay-v3-hitcam.test.mjs",
            "client/web/test/replay-v3-recorded.test.mjs",
            "client/web/test/replay-v3-player-pose.test.mjs",
            "client/web/test/replay-v3-victim.test.mjs",
            "client/web/test/replay-v3-draw.test.mjs",
            "client/web/test/projectile-flight-v3.test.mjs",
            "client/web/test/replay-v3-materials.test.mjs",
            "client/web/test/projectile-replay.test.mjs",
            "client/web/test/design-replay.test.mjs",
            "client/web/test/replay-pose.test.mjs",
        ]
        .map(String::from),
    );
    names.extend(
        [
            "client/web/src/game/testrange.js",
            "client/web/test/replay-v3-analysis-entry.test.mjs",
            "client/web/test/replay-v3-live-tracer.test.mjs",
        ]
        .map(String::from),
    );
    for vehicle in [
        "de_tiger_e",
        "us_m4a3_75w",
        "su_bmpt34",
        "us_m901_itv",
        "de_pz3_j",
        "de_rso_flak",
    ] {
        for file in [
            "vehicle.json",
            "armor.json",
            "modules.json",
            "crew.json",
            "weapons.json",
            "visual.json",
        ] {
            let name = format!("data/vehicles/{vehicle}/{file}");
            if root.join(&name).exists() {
                names.push(name);
            }
        }
    }
    names.push("data/machine_guns.json".into());
    for projectile in [
        "apcbc_88_l56",
        "heat_152_tow",
        "he_420_tt250",
        "apcr_88_pzgr40",
    ] {
        names.push(format!("data/projectiles/{projectile}.json"));
    }
    let mut out = serde_json::Map::new();
    for name in names {
        let bytes =
            std::fs::read(root.join(&name)).unwrap_or_else(|e| panic!("source {name}: {e}"));
        let utf8 = String::from_utf8(bytes.clone()).unwrap();
        out.insert(
            name,
            json!({"sha256":format!("{:x}",Sha256::digest(&bytes)),"utf8":utf8}),
        );
    }
    Value::Object(out)
}

fn ignition_fixture(l: &Lobby, a: u32, b: u32) -> (u32, WireShot) {
    let t = &l.targets[&l.players[&b].vehicle];
    let st = l.players[&b].combat.as_ref().unwrap();
    for seq in 1..=128 {
        for y in [0.7, 1.0, 1.3, 1.5, 1.8, 2.0, 2.2] {
            for z in [-2.3, -2.0, -1.5, -1.0, -0.5, 0.0, 0.4, 0.8, 1.2] {
                let shot = WireShot {
                    o: [3.0, y, z],
                    d: [-1.0, 0.0, 0.0],
                    yaw: 0.0,
                    speed: 700.0,
                    dist: 0.0,
                };
                let r = tg_combat::shoot(
                    t,
                    st,
                    &tg_combat::Shot {
                        shell: l.projectiles["apcbc_88_l56"].clone(),
                        origin: Vec3::new(3.0, y, z),
                        dir: Vec3::new(-1.0, 0.0, 0.0),
                        speed_ms: 700.0,
                        distance_m: 0.0,
                        seed: shot_seed(a, seq),
                        turret_yaw: 0.0,
                    },
                );
                if r.state.destroyed || r.state.fire_s <= 0.0 {
                    continue;
                }
                let mut after = r.state.clone();
                tg_combat::advance(t, &mut after, 35.0, shot_seed(b, 140));
                if after.destroyed {
                    eprintln!(
                        "genuine ignition fixture seq={seq} y={y} z={z}, crew={:?} fire={:?}",
                        r.state.crew, r.state.fire_at
                    );
                    return (seq, shot);
                }
            }
        }
    }
    panic!("no real ignition -> advance death fixture")
}

#[test]
fn replay_actual_fire_a_plain_b_keeps_a_death_credit() {
    let (mut l, a, b, c, _) = fixture();
    let (seq, shot) = ignition_fixture(&l, a, b);
    send(
        &mut l,
        a,
        json!({"t":"fire","seq":seq,"instance":"gun:0:0","shell":"apcbc_88_l56","o":[0,0,0],"d":[0,0,1]}),
        0.0,
    );
    send(
        &mut l,
        a,
        json!({"t":"hit","seq":seq,"target":b,"result":"penetrated","plate":null,"shot":{"o":shot.o,"d":shot.d,"yaw":0,"speed":700,"dist":0}}),
        0.01,
    );
    assert!(l.players[&b].combat.as_ref().unwrap().fire_s > 0.0);
    assert!(l.players[&b].alive);
    send(
        &mut l,
        c,
        json!({"t":"fire","seq":1,"instance":"gun:0:0","shell":"apcbc_88_l56","o":[0,0,0],"d":[0,0,1]}),
        0.02,
    );
    send(
        &mut l,
        c,
        json!({"t":"hit","seq":1,"target":b,"result":"stopped","plate":null,"shot":{"o":[3,0.1,0],"d":[-1,0,0],"yaw":0,"speed":700,"dist":0}}),
        0.03,
    );
    assert!(l.players[&b].alive, "ordinary B must not be terminal");
    let out = l.advance_combat(35.0);
    assert!(!l.players[&b].alive, "genuine advance must kill");
    assert!(out.iter().any(|(_,m)|matches!(m,ServerMsg::Damage {target,from,killed:true,..} if *target==b&&*from==a)),"death must resolve ignition A: {out:?}");
    assert_eq!(
        (
            l.players[&a].kills,
            l.players[&c].kills,
            l.players[&b].deaths
        ),
        (1, 0, 1)
    );
}

fn missile_receipts() -> Vec<Value> {
    let (mut l, a, b, c, room) = fixture();
    send(&mut l, a, json!({"t":"respawn"}), 10.0);
    send(
        &mut l,
        a,
        json!({"t":"deploy","vehicle":"us_m901_itv"}),
        16.0,
    );
    send(&mut l, a, json!({"t":"state","s":{"pos":[0,0,3400]}}), 16.0);
    send(&mut l, b, json!({"t":"state","s":{"pos":[0,0,0]}}), 16.0);
    let mut phases = vec![phase(
        "admission",
        "missile",
        admitted(&mut l, a, b, c, room),
    )];
    let launch = send(
        &mut l,
        a,
        json!({"t":"launch","seq":10,"instance":"gun:0:0","missile":"bgm71a_tow","ammo":"heat_152_tow","o":[0,2,3400],"d":[0,0,-1]}),
        16.0,
    );
    let launched = message(&launch, a, "launched");
    assert!(launched["id"].is_number(), "{launch:?}");
    let mid = launched["id"].as_u64().unwrap();
    let mut damage = Value::Null;
    let mut damage_out = Vec::new();
    for i in 1..=400 {
        let now = 16.0 + i as f64 * 0.05;
        send(
            &mut l,
            a,
            json!({"t":"guide","id":mid,"sight":[0,2,3400],"aim":[0,1.2,0]}),
            now,
        );
        let tick = flat(l.tick_at(now));
        let m = message(&tick, b, "damage");
        if !m.is_null() {
            damage = m;
            damage_out = tick;
            break;
        }
    }
    assert!(
        !damage.is_null(),
        "actual missile world contact required in room{room}"
    );
    let e = &damage["replay"];
    assert_eq!(
        e["shooter"]["entity"], a,
        "actual accepted launch must survive world ending"
    );
    assert_eq!(e["projectile_id"], "heat_152_tow");
    assert_eq!(e["launch_time_s"], 16.0);
    assert!(!e["segments"].as_array().unwrap().is_empty());
    assert_eq!(e["flight_trust"], "missile_world_segments_legacy_contact");
    assert!(e["travelled_distance_m"].as_f64().unwrap() > 0.0);
    eprintln!(
        "flight samples={} distance={} launch={} impact={}",
        e["flight"].as_array().unwrap().len(),
        e["travelled_distance_m"],
        e["launch_time_s"],
        e["impact_time_s"]
    );
    assert!(e["flight_compacted_count"].as_u64().unwrap() > 0);
    assert!(e["segment_compacted_count"].as_u64().unwrap() > 0);
    assert_eq!(e["flight"].as_array().unwrap().len(), 256);
    assert_eq!(e["segments"].as_array().unwrap().len(), 256);
    assert_eq!(
        e["flight"].as_array().unwrap().last().unwrap()["position"],
        e["segments"].as_array().unwrap().last().unwrap()["to"]
    );
    phases.push(phase("missile", "missile", damage_out));
    phases
}
#[test]
fn replay_missile_preserves_admitted_launch_and_actual_segment() {
    missile_receipts();
}

fn retained_receipts() -> Vec<Value> {
    let (mut l, a, b, c, room) = fixture_vehicle_plan("us_m4a3_75w", true);
    let mut phases = vec![phase(
        "admission",
        "retained",
        admitted(&mut l, a, b, c, room),
    )];
    let (seq, shot) = ignition_fixture(&l, a, b);
    let out = hit(&mut l, a, b, seq, &shot, 0.1);
    let source = message(&out, b, "damage")["replay"].clone();
    phases.push(phase("pin_source", "retained", out));
    let ordinary = WireShot {
        o: [3.0, 0.1, 0.0],
        d: [-1.0, 0.0, 0.0],
        yaw: 0.0,
        speed: 700.0,
        dist: 0.0,
    };
    for i in 0..66 {
        let shooter = if i < 33 { c } else { a };
        let s = if shooter == c { i + 1 } else { seq + i - 32 };
        let out = hit(&mut l, shooter, b, s, &ordinary, 7.0 + i as f64 * 0.6);
        assert!(
            !message(&out, b, "damage").is_null(),
            "ordinary {i} {s}: {out:?}"
        );
        phases.push(phase("pin_ordinary", "retained", out));
    }
    assert!(l.players[&b]
        .replay
        .recent
        .iter()
        .all(|e| e.event_id != source["event_id"].as_str().unwrap()));
    assert_eq!(
        l.players[&b].replay.pinned.as_ref().unwrap().event_id,
        source["event_id"]
    );
    for i in 0..20 {
        send(
            &mut l,
            b,
            json!({"t":"ping","at":0}),
            48.0 + i as f64 * 0.01,
        );
        let out = flat(l.advance_combat(0.01));
        phases.push(phase("pin_advance", "retained", out));
    }
    assert!(
        l.players[&b]
            .replay
            .pinned
            .as_ref()
            .unwrap()
            .mechanism_compaction
            .as_ref()
            .unwrap()
            .count
            >= 4
    );
    send(&mut l, b, json!({"t":"ping","at":0}), 83.0);
    let fatal = flat(l.advance_combat(35.0));
    let e = message(&fatal, b, "damage")["replay"].clone();
    assert_eq!(e["report"], source["report"]);
    assert_eq!(e["deaths"][0]["cause_event_id"], source["event_id"]);
    phases.push(phase("pin_beyond_ring_compaction", "retained", fatal));
    let checkpoint = resumed(&mut l, b, 83.1);
    let cp = message(&checkpoint, b, "status")["replay_checkpoint"].clone();
    assert!(cp["baseline_commit"].as_u64().unwrap() > 0);
    assert_eq!(cp["incoming"].as_array().unwrap().len(), 1);
    phases.push(phase("retained_checkpoint", "retained", checkpoint));
    phases
}
fn identity_receipts() -> Vec<Value> {
    let (mut l, a, b, c, room) = fixture();
    send(&mut l, a, json!({"t":"respawn"}), 10.0);
    send(&mut l, a, json!({"t":"deploy","vehicle":"su_bmpt34"}), 16.0);
    send(&mut l, a, json!({"t":"state","s":{"pos":[0,0,0]}}), 16.0);
    let mut phases = vec![phase(
        "admission",
        "same_shell_two_weapons",
        admitted(&mut l, a, b, c, room),
    )];
    let shell = l.ammo_catalogs["su_bmpt34"].guns["gun:0:0"].ammo[0].clone();
    assert!(l.ammo_catalogs["su_bmpt34"].guns["gun:0:1"]
        .ammo
        .contains(&shell));
    let mut sources = Vec::new();
    for (seq, instance) in [(1, "gun:0:0"), (2, "gun:0:1")] {
        let fire = send(
            &mut l,
            a,
            json!({"t":"fire","seq":seq,"instance":instance,"shell":shell,"o":[0,0,0],"d":[0,0,1]}),
            16.1,
        );
        assert!(!message(&fire, a, "fire_accepted").is_null());
        let out = send(
            &mut l,
            a,
            json!({"t":"hit","seq":seq,"target":b,"result":"stopped","shot":{"o":[3,0.1,0],"d":[-1,0,0],"speed":800,"dist":0}}),
            16.11,
        );
        let e = message(&out, b, "damage")["replay"].clone();
        assert_eq!(e["weapon_instance"], instance);
        sources.push(e);
        phases.push(phase(
            "same_shell_two_weapons",
            "same_shell_two_weapons",
            out,
        ));
    }
    assert_ne!(sources[0]["shot_id"], sources[1]["shot_id"]);
    assert_eq!(sources[0]["projectile_id"], sources[1]["projectile_id"]);
    let before = l.players[&b].replay.version;
    let rejected = send(
        &mut l,
        a,
        json!({"t":"fire","seq":3,"instance":"gun:9:0","shell":shell,"o":[0,0,0],"d":[0,0,1]}),
        16.2,
    );
    assert!(!message(&rejected, a, "fire_rejected").is_null());
    let hit = send(
        &mut l,
        a,
        json!({"t":"hit","seq":3,"target":b,"result":"penetrated","shot":{"o":[3,1,0],"d":[-1,0,0],"speed":800,"dist":0}}),
        16.21,
    );
    assert!(hit.is_empty());
    assert_eq!(l.players[&b].replay.version, before);
    phases.push(phase("rejected", "same_shell_two_weapons", rejected));
    phases
}

#[test]
fn v3_replay_protocol_receipt_from_actual_handlers() {
    let (mut l, a, b, c, _) = fixture();
    let instance = "gun:0:0";
    let shell = l.ammo_catalogs["de_tiger_e"].guns[instance].ammo[0].clone();
    let fire = send(
        &mut l,
        a,
        json!({"t":"fire","seq":1,"instance":instance,"shell":shell,"o":[0,0,0],"d":[0,0,1]}),
        0.0,
    );
    assert!(fire
        .iter()
        .any(|(_, m)| matches!(m, ServerMsg::FireAccepted { seq: 1, .. })));
    let out = send(
        &mut l,
        a,
        json!({"t":"hit","seq":1,"target":b,"result":"penetration","plate":null,"shot":{"o":[-5,1.2,0],"d":[1,0,0],"speed":800,"dist":0}}),
        0.01,
    );
    let rs = recipients(&out);
    let owner = rs
        .iter()
        .find(|r| r["to"] == b)
        .expect("actual victim Damage");
    let e = &owner["message"]["replay"];
    assert_eq!(
        e["actor"]["entity"], b,
        "missing owner-scoped actual replay envelope"
    );
    assert_eq!(e["shooter"]["entity"], a);
    assert_eq!(e["weapon_instance"], instance);
    assert!(e["shot_id"].as_str().unwrap().ends_with(":1"));
    assert_eq!(
        e["state_after_version"].as_u64().unwrap(),
        e["state_before_version"].as_u64().unwrap() + 1
    );
    assert!(e["accepted_pose"]["hull_origin"].is_array());
    assert!(rs
        .iter()
        .filter(|r| r["to"] == c)
        .all(|r| r["message"].get("replay").is_none() && r["message"].get("report").is_none()));
    let mut phases = vec![
        phase("direct", "direct", out.clone()),
        phase("observer", "direct", out),
    ];
    phases.extend(gap_receipts());
    phases.extend(mechanism_receipts());
    phases.extend(identity_receipts());
    phases.extend(retained_receipts());
    phases.extend(missile_receipts());
    phases.extend(admitted_mg_receipts());
    if let Ok(path) = std::env::var("TG_REPLAY_NETWORK_RECEIPT") {
        std::fs::write(path,serde_json::to_vec_pretty(&json!({"revision":1,"actors":{"shooter":shot_flight::actor(&l.players[&a]),"victim":shot_flight::actor(&l.players[&b]),"observer":shot_flight::actor(&l.players[&c])},"phases":phases,"sources":super::ammo_tests::source_tags(),"replay_sources":replay_source_tags()})).unwrap()).unwrap();
    }
}
#[test]
fn he_burst_near_an_enemy_damages_it_once_and_needs_a_live_filled_shell() {
    let (mut l, a, b, _, _) = fixture_vehicle("us_m8");
    let hp = serde_json::to_value(&l.players[&b].combat).unwrap();
    let fire = send(
        &mut l,
        a,
        json!({"t":"fire","seq":5,"instance":"gun:0:0","shell":"he_88_sprgr","o":[0,0,0],"d":[0,0,1]}),
        0.0,
    );
    assert!(!message(&fire, a, "fire_accepted").is_null(), "{fire:?}");
    // farther than the shell can have flown yet: rejected, and the shell stays live
    assert!(send(
        &mut l,
        a,
        json!({"t":"burst","seq":5,"at":[3000.0,0.0,0.0]}),
        0.01
    )
    .is_empty());
    let out = send(
        &mut l,
        a,
        json!({"t":"burst","seq":5,"at":[2.2,0.2,0.0]}),
        0.02,
    );
    assert!(
        !message(&out, b, "damage").is_null(),
        "no splash damage: {out:?}"
    );
    assert_ne!(serde_json::to_value(&l.players[&b].combat).unwrap(), hp);
    // the same shell bursts once
    assert!(send(
        &mut l,
        a,
        json!({"t":"burst","seq":5,"at":[2.2,0.2,0.0]}),
        0.03
    )
    .is_empty());
    // a solid shot has no filler to burst
    send(
        &mut l,
        a,
        json!({"t":"fire","seq":6,"instance":"gun:0:0","shell":"apcbc_88_l56","o":[0,0,0],"d":[0,0,1]}),
        9.0,
    );
    assert!(send(
        &mut l,
        a,
        json!({"t":"burst","seq":6,"at":[2.2,0.2,0.0]}),
        9.02
    )
    .is_empty());
}

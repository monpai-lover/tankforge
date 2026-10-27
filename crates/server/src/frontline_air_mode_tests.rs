//! New air-only mode policy through actual native command admission and snapshots.
//! JSON assertions deliberately compile against the older baseline for a real RED.
use super::*;

fn data_path() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

fn accepted(out: Vec<(u32, Update)>) {
    assert!(
        !out.iter().any(|(_, update)| matches!(update, Update::Error { .. })),
        "unexpected native rejection: {out:?}"
    );
}

fn setup() -> FrontlineHub {
    let mut hub = FrontlineHub::new(&data_path()).unwrap();
    accepted(hub.handle(
        1,
        Command::Create {
            name: "Authoritative air-only mode".into(),
            map: "korea".into(),
            observer: true,
            era: 1976,
        },
        0.0,
    ));
    accepted(hub.handle(
        2,
        Command::Join {
            room: 1,
            observer: false,
            team: Some(Team::Blue),
        },
        0.0,
    ));
    hub
}

#[test]
fn air_frontline_mode_is_the_production_default_and_not_a_client_only_label() {
    let hub = setup();
    let room = serde_json::to_value(hub.rooms[&1].view()).unwrap();
    assert_eq!(room["battle_mode"], "air_frontline");
    assert_eq!(room["player_ground_allowed"], false);
    assert_eq!(room["score_limit"], 1000);
    assert_eq!(room["team_score"], json!([0, 0]));
}

#[test]
fn air_frontline_mode_has_exactly_three_native_capture_zones() {
    let hub = setup();
    let snapshot = serde_json::to_value(hub.rooms[&1].snapshot()).unwrap();
    let points = snapshot["objectives"].as_array().unwrap();
    let ids: BTreeSet<_> = points.iter().map(|point| point["id"].as_str().unwrap()).collect();
    assert_eq!(ids, BTreeSet::from(["W2", "C2", "E2"]));
    for point in points {
        assert_eq!(point["pos"].as_array().unwrap().len(), 3);
        assert!(point["pos"].as_array().unwrap().iter().all(|v| v.as_f64().is_some_and(f64::is_finite)));
    }
}

#[test]
fn air_frontline_mode_rejects_player_ground_commands_at_native_admission() {
    let mut hub = setup();
    let battle = hub.rooms[&1].battle;
    let unit = json!({"battle":battle,"unit":1,"life":1});
    for value in [
        json!({"op":"deploy","vehicle":"su_t72a"}),
        json!({"op":"deploy_at","vehicle":"su_t72a","staging":"B-CENTRE-FRONT"}),
        json!({"op":"takeover","unit":unit}),
        json!({"op":"input","unit":unit,"epoch":1,"seq":1,"throttle":0.0,"steer":0.0,"brake":1.0,"turret_yaw":0.0,"gun_pitch":0.0,"fire":false}),
        json!({"op":"order","company":1,"platoons":[],"kind":"attack","target":[0.0,0.0],"seq":1}),
        json!({"op":"support_order","unit":unit,"kind":"repair","facility_id":"not-authoritative","expected_revision":1,"seq":1}),
    ] {
        let command: Command = serde_json::from_value(value.clone()).unwrap();
        let out = hub.handle(2, command, 0.0);
        assert!(
            out.iter().any(|(_, update)| matches!(update, Update::Error { code, .. } if code == "air_only")),
            "forbidden ground command must be rejected by mode policy, {value}: {out:?}"
        );
        assert_eq!(hub.rooms[&1].members[&2].view.controlled, None);
        assert_eq!(hub.rooms[&1].members[&2].view.company, None);
    }
}

#[test]
fn air_frontline_mode_scoreboard_contains_players_and_no_observer_authority() {
    let hub = setup();
    let room = serde_json::to_value(hub.rooms[&1].view()).unwrap();
    let scores = room["scoreboard"].as_array().expect("native scoreboard required");
    assert_eq!(scores.len(), 1);
    assert_eq!(scores[0]["player"], 2);
    for field in ["score", "air_kills", "ground_kills", "deaths"] {
        assert_eq!(scores[0][field], 0, "nonzero initial {field}");
    }
}

#[test]
fn air_frontline_mode_keeps_autonomous_ground_companies_when_players_do_not_deploy_tanks() {
    let mut hub = setup();
    accepted(hub.handle(1, Command::Start, 0.0));
    let room = &hub.rooms[&1];
    assert_eq!(room.companies.len(), 6, "both sides retain AI on all three fronts");
    assert!(room.companies.values().all(|company| company.view.owner.is_none()));
    assert!(room.units.values().all(|unit| unit.controller.is_none()));
    assert!(room.members.values().all(|member| member.view.company.is_none()));
    assert!(room.air.units.is_empty(), "only ground AI attackers are retained");
}

fn deploy_from_json(hub: &mut FrontlineHub, player: u32) -> UnitRef {
    let command: Command = serde_json::from_value(json!({
        "op":"deploy_air","aircraft":"f104g","spawn":"air","loadout":0
    })).unwrap();
    accepted(hub.handle(player, command, 0.0));
    hub.rooms[&1].members[&player].view.controlled.unwrap()
}

fn native_terminal_blast(hub: &mut FrontlineHub, target: UnitRef) {
    let room = hub.rooms.get_mut(&1).unwrap();
    let plane = &room.air.units[&target.unit];
    let pos = plane.pos();
    let opponent = if plane.team == Team::Blue { 1 } else { 0 };
    room.air.blast(pos, 2000.0, opponent, target.unit ^ 123, false, None);
    assert!(!room.air.units[&target.unit].alive(), "actual native air damage must be terminal");
}

fn ended(updates: &[(Vec<u32>, Update)]) -> Option<(Option<Team>, &str)> {
    updates.iter().find_map(|(_, update)| match update {
        Update::Ended { winner, reason, .. } => Some((*winner, reason.as_str())),
        _ => None,
    })
}

#[test]
fn air_frontline_mode_spends_one_sortie_on_real_spawn_and_forbids_redeploy_after_native_loss() {
    let mut hub = setup();
    accepted(hub.handle(1, Command::Start, 0.0));
    let reference = deploy_from_json(&mut hub, 2);
    let before = serde_json::to_value(hub.rooms[&1].view()).unwrap();
    let member = before["members"].as_array().unwrap().iter().find(|m| m["player"] == 2).unwrap();
    assert_eq!(member["air_sorties_remaining"], 0);
    assert_eq!(member["air_sortie_eligible"], true, "surviving original aircraft can return/reclaim");
    native_terminal_blast(&mut hub, reference);
    let room = hub.rooms.get_mut(&1).unwrap();
    room.last_step = STEP;
    room.step(&mut hub.next_unit);
    let command = serde_json::from_value(json!({"op":"deploy_air","aircraft":"f104g","spawn":"air","loadout":0})).unwrap();
    let out = hub.handle(2, command, STEP);
    assert!(out.iter().any(|(_, u)| matches!(u, Update::Error { code, .. } if code == "air_sortie_spent")), "dead life must not mint a replacement: {out:?}");
}

#[test]
fn air_frontline_mode_eliminating_all_enemy_native_aircraft_ends_round_immediately() {
    let mut hub = setup();
    accepted(hub.handle(3, Command::Join {room:1, observer:false, team:Some(Team::Red)}, 0.0));
    accepted(hub.handle(1, Command::Start, 0.0));
    let enemy = deploy_from_json(&mut hub, 3);
    native_terminal_blast(&mut hub, enemy);
    let out = hub.tick(STEP + 1e-8);
    assert_eq!(ended(&out), Some((Some(Team::Blue), "air_elimination")));
}

#[test]
fn air_frontline_mode_first_sortie_eligibility_prevents_false_elimination() {
    let mut hub = setup();
    accepted(hub.handle(3, Command::Join {room:1, observer:false, team:Some(Team::Red)}, 0.0));
    accepted(hub.handle(4, Command::Join {room:1, observer:false, team:Some(Team::Blue)}, 0.0));
    accepted(hub.handle(1, Command::Start, 0.0));
    deploy_from_json(&mut hub, 3);
    let ally = deploy_from_json(&mut hub, 4);
    native_terminal_blast(&mut hub, ally);
    assert!(ended(&hub.tick(STEP + 1e-8)).is_none(), "an undeployed pilot retains a real sortie");
    let view = serde_json::to_value(hub.rooms[&1].view()).unwrap();
    let player = view["members"].as_array().unwrap().iter().find(|m| m["player"] == 2).unwrap();
    assert_eq!(player["air_sorties_remaining"], 1);
    assert_eq!(player["air_sortie_eligible"], true);
}

#[test]
fn air_frontline_mode_both_air_forces_lost_in_same_native_tick_is_draw() {
    let mut hub = setup();
    accepted(hub.handle(3, Command::Join {room:1, observer:false, team:Some(Team::Red)}, 0.0));
    accepted(hub.handle(1, Command::Start, 0.0));
    deploy_from_json(&mut hub, 2);
    deploy_from_json(&mut hub, 3);
    let refs: Vec<_> = hub.rooms[&1].air.units.values().map(|u| u.reference).collect();
    for reference in refs { native_terminal_blast(&mut hub, reference); }
    let out = hub.tick(STEP + 1e-8);
    assert_eq!(ended(&out), Some((None, "air_elimination")));
}

#[test]
fn air_frontline_mode_held_zone_scores_one_point_per_accepted_simulation_second() {
    let mut hub = setup();
    accepted(hub.handle(1, Command::Start, 0.0));
    let room = hub.rooms.get_mut(&1).unwrap();
    let zone = room.objectives.iter_mut().find(|o| o.id == "W2").unwrap();
    zone.owner = Some(Team::Blue);
    zone.progress = 1.0;
    for i in 1..=19 { hub.tick(i as f64 * STEP + 1e-8); }
    let before = serde_json::to_value(hub.rooms[&1].view()).unwrap();
    assert_eq!(before["team_score"], json!([0,0]));
    hub.tick(20.0 * STEP + 1e-8);
    let after = serde_json::to_value(hub.rooms[&1].view()).unwrap();
    assert_eq!(after["team_score"], json!([1,0]));
}

#[test]
fn air_frontline_mode_damage_ledger_caps_nonfatal_ground_hits_across_pilots_and_settles_once() {
    let mut hub = setup();
    accepted(hub.handle(1, Command::Start, 0.0));
    let shooter = deploy_from_json(&mut hub, 2);
    accepted(hub.handle(3, Command::Join { room:1, observer:false, team:Some(Team::Blue) }, 0.0));
    let other = deploy_from_json(&mut hub, 3);
    let room = hub.rooms.get_mut(&1).unwrap();
    let target = room.units.values().find(|u| u.team == Team::Red && u.support.is_none()).unwrap().reference;
    let contact = |shot, plane, victim, changed| crate::frontline_sim::SimEvent {
        kind:"impact".into(), shooter:Some(plane), target:Some(victim), pos:[0.0;3],
        detail:json!({"shot_id":shot,"damage_applied":true,"damage_changed":changed})
    };
    let mut events = Vec::new();
    room.record_damage(&[contact(1, shooter.unit, target.unit, false)], &mut events);
    room.record_damage(&[contact(2, shooter.unit, shooter.unit, true)], &mut events);
    assert_eq!(room.team_score, [0,0], "cosmetic and self contacts cannot score");
    for shot in 10..20 {
        let owner = if shot % 2 == 0 { shooter.unit } else { other.unit };
        let accepted = contact(shot, owner, target.unit, true);
        room.record_damage(&[accepted.clone(), accepted], &mut events);
    }
    assert_eq!(room.team_score, [25,0], "one target life has a shared25-point budget");
    assert_eq!(room.scoreboard().iter().map(|p| p.score).sum::<u32>(), 25);
    room.sim.destroy_unit_for_frontline_test(target.unit);
    room.record_damage(&[contact(21, other.unit, target.unit, true)], &mut events);
    assert_eq!(room.team_score, [25,0], "same-step terminal target cannot earn an extra hit");
    room.settle_loss(target, None, false, &mut events);
    room.settle_loss(target, None, false, &mut events);
    assert_eq!(room.team_score, [125,0]);
    assert_eq!(room.scoreboard().iter().map(|p| p.ground_kills).sum::<u32>(), 1);
    assert_eq!(room.scoreboard().iter().map(|p| p.score).sum::<u32>(), 125);
    room.record_damage(&[contact(22, shooter.unit, target.unit, true)], &mut events);
    assert_eq!(room.team_score, [125,0], "already settled life rejects later contacts");
}

#[test]
fn air_frontline_mode_ground_ai_finishing_damage_does_not_grant_human_kill_points() {
    let mut hub = setup();
    accepted(hub.handle(1, Command::Start, 0.0));
    let shooter = deploy_from_json(&mut hub, 2);
    let room = hub.rooms.get_mut(&1).unwrap();
    let target = room.units.values().find(|u| u.team == Team::Red && u.support.is_none()).unwrap().reference;
    let ai = room.units.values().find(|u| u.team == Team::Blue && u.support.is_none()).unwrap().reference;
    let event = |shot, from| crate::frontline_sim::SimEvent {
        kind:"impact".into(), shooter:Some(from), target:Some(target.unit), pos:[0.0;3],
        detail:json!({"shot_id":shot,"damage_changed":true,"damage_applied":true})
    };
    let mut events = Vec::new();
    room.record_damage(&[event(1, shooter.unit)], &mut events);
    room.sim.destroy_unit_for_frontline_test(target.unit);
    room.record_damage(&[event(2, ai.unit)], &mut events);
    room.settle_loss(target, None, false, &mut events);
    assert_eq!(room.team_score, [5,0]);
    assert_eq!(room.scoreboard()[0].ground_kills, 0);
}

#[test]
fn air_frontline_mode_contested_zone_pauses_scoring_and_preserves_fractional_time() {
    let mut hub = setup();
    let room = hub.rooms.get_mut(&1).unwrap();
    let index = room.objectives.iter().position(|o| o.id == "W2").unwrap();
    room.objectives[index].owner = Some(Team::Blue);
    room.objectives[index].progress = 1.0;
    let mut events = Vec::new();
    for _ in 0..10 { room.score_zones(&mut events); }
    room.objectives[index].contested = true;
    for _ in 0..40 { room.score_zones(&mut events); }
    assert_eq!(room.team_score, [0,0]);
    room.objectives[index].contested = false;
    for _ in 0..10 { room.score_zones(&mut events); }
    assert_eq!(room.team_score, [1,0]);
    assert!(room.objectives.iter().filter(|o| matches!(o.id.as_str(), "W2" | "C2" | "E2")).all(|o| o.capturable == [true,true]), "rear anchors never lock the active middle zones");
}

#[test]
fn air_frontline_mode_real_returned_aircraft_and_service_are_not_eliminated_or_duplicated() {
    let mut hub = setup();
    accepted(hub.handle(3, Command::Join {room:1, observer:false, team:Some(Team::Red)}, 0.0));
    accepted(hub.handle(1, Command::Start, 0.0));
    deploy_from_json(&mut hub, 3);
    let command = serde_json::from_value(json!({"op":"deploy_air","aircraft":"f104g","spawn":"runway","loadout":0})).unwrap();
    accepted(hub.handle(2, command, 0.0));
    let original = hub.rooms[&1].members[&2].view.controlled.unwrap();
    accepted(hub.handle(2, Command::Return, 0.0));
    assert!(hub.rooms[&1].air_round_outcome().is_none(), "parked original remains real air strength");
    let command = serde_json::from_value(json!({"op":"deploy_air","aircraft":"f104g","spawn":"runway","loadout":0})).unwrap();
    accepted(hub.handle(2, command, 0.0));
    assert_eq!(hub.rooms[&1].members[&2].view.controlled, Some(original));
    let epoch = hub.rooms[&1].members[&2].view.epoch;
    let service = serde_json::from_value(json!({"op":"service_air","unit":original,"epoch":epoch,"seq":1,"loadout":0})).unwrap();
    accepted(hub.handle(2, service, 0.0));
    assert!(hub.rooms[&1].air_round_outcome().is_none(), "airfield service is a surviving life");
    assert_eq!(hub.rooms[&1].air.units.values().filter(|u| u.owner == Some(2)).count(), 1);
}

#[test]
fn air_frontline_mode_new_round_restores_sortie_and_resets_score_but_keeps_nickname() {
    let mut hub = setup();
    hub.set_nickname(2, "Air pilot".into());
    accepted(hub.handle(1, Command::Start, 0.0));
    deploy_from_json(&mut hub, 2);
    let room = hub.rooms.get_mut(&1).unwrap();
    room.team_score = [1000,0];
    room.finished = true;
    room.started = false;
    room.result = Some(RoundResult {battle:room.battle,winner:Some(Team::Blue),reason:"score_limit".into()});
    hub.reset_round(1, 1.0).unwrap();
    let view = hub.rooms[&1].view();
    assert_eq!(view.team_score, [0,0]);
    assert_eq!(view.battle_mode, "air_frontline");
    let pilot = view.members.iter().find(|p| p.player == 2).unwrap();
    assert_eq!(pilot.name, "Air pilot");
    assert_eq!(pilot.air_sorties_remaining, 1);
    assert!(pilot.air_sortie_eligible);
}

#[test]
fn air_frontline_mode_real_mounted_bomb_awards_native_player_and_team_score() {
    use crate::flight_runtime::FlightSpawn;
    let mut hub = FrontlineHub::new(&data_path()).unwrap();
    accepted(hub.handle(1, Command::Create {name:"Native aircraft scoring".into(),map:"korea".into(),observer:true,era:1976}, 0.0));
    accepted(hub.handle(2, Command::Join {room:1,observer:false,team:Some(Team::Blue)}, 0.0));
    accepted(hub.handle(1, Command::Start, 0.0));
    let command = serde_json::from_value(json!({"op":"deploy_air","aircraft":"f86f","spawn":"air","loadout":1})).unwrap();
    accepted(hub.handle(2, command, 0.0));
    let pilot = hub.rooms[&1].members[&2].view.clone();
    let reference = pilot.controlled.unwrap();
    let target = hub.rooms[&1].units.values().find(|u| u.team == Team::Red && u.support.is_none()).unwrap().reference;
    let target_pos = hub.rooms[&1].sim.snapshot(target.unit).unwrap().pos;
    let initial = hub.rooms[&1].air.views().into_iter().find(|u| u.unit == reference).unwrap();
    let mount = initial.stores.iter().find(|s| s["id"] == "anm64").unwrap();
    let p: [f64;3] = serde_json::from_value(mount["p"].clone()).unwrap();
    hub.rooms.get_mut(&1).unwrap().air.test_spawn_at(reference.unit, FlightSpawn {
        position:[(target_pos[0]-p[0]) as f32,(target_pos[1]+8.0) as f32,(target_pos[2]-p[2]) as f32],
        heading:0.0,airspeed:0.0,on_ground:false
    });
    let mut reports = Vec::new();
    for tick in 1..=45 {
        if hub.rooms[&1].members[&2].view.controlled == Some(reference) && !hub.rooms[&1].finished {
            accepted(hub.handle(2, Command::AirInput { unit:reference,epoch:pilot.epoch,seq:tick,
                aim:[0.0,0.0,1.0],throttle:0.0,manual_pitch:0.0,manual_roll:0.0,manual_yaw:0.0,
                flags:1,fire:false,release:tick <= 3 }, tick as f64*STEP));
        }
        for (to, update) in hub.tick(tick as f64*STEP+1e-8) {
            if to.contains(&1) { if let Update::Frame {events,..} = update { reports.extend(events); } }
        }
        if hub.rooms[&1].scoreboard().iter().any(|p|p.player==2 && p.score>0) {break;}
    }
    assert!(reports.iter().any(|e|e["kind"]=="shot" && e["shooter"]["unit"]==reference.unit && e["detail"]["store"]==true), "a real mounted native bomb must be released");
    assert!(reports.iter().any(|e|matches!(e["kind"].as_str(),Some("impact"|"blast")) && e["shooter"]["unit"]==reference.unit && (e["detail"]["damage_changed"]==true || e["detail"]["report"]["damage_changed"]==true)), "the released bomb must change accepted native damage");
    let room = &hub.rooms[&1];
    let pilot = room.scoreboard().into_iter().find(|p|p.player==2).unwrap();
    assert!(pilot.score>0, "real mounted combat must reach scoring, not only cosmetic impact events");
    assert_eq!(room.team_score[0], pilot.score);
    assert!(reports.iter().any(|e|e["kind"]=="player_score" && e["player"]==2 && e["points"].as_u64().is_some_and(|p|p>0)));
}

#[test]
fn air_frontline_mode_modern_air_pool_is_not_rejected_by_obsolete_ground_era_window() {
    let mut hub = FrontlineHub::new(&data_path()).unwrap();
    let source_air = hub.air_template.world(
        std::sync::Arc::new(hub.templates["korea"].ground.clone()), hub.maps["korea"].clone());
    assert!(source_air.options(2018).iter().any(|a|a.id=="f16v"), "fixture must use an actual admitted modern aircraft");
    accepted(hub.handle(1, Command::Create {
        name:"Modern native aircraft, older autonomous ground".into(),map:"korea".into(),observer:false,era:2018
    }, 0.0));
    accepted(hub.handle(1, Command::Start, 0.0));
    let room = &hub.rooms[&1];
    assert_eq!(room.view().battle_mode, "air_frontline");
    assert_eq!(room.companies.len(), 6);
    assert!(room.units.values().filter(|u|u.support.is_none()).all(|u| {
        let source = room.sim.snapshot(u.reference.unit).unwrap();
        hub.catalog.iter().any(|v|v.id==source.vehicle && v.year<=2018)
    }), "ground AI fallback must remain an older supported native model");
}

#[test]
fn air_frontline_mode_keeps_only_attack_ground_ai_and_does_not_score_historical_support_units() {
    let mut hub = setup();
    accepted(hub.handle(1, Command::Start, 0.0));
    assert!(hub.rooms[&1].pending_support.is_empty(), "pure air does not queue logistics actors");
    assert!(hub.rooms[&1].units.values().all(|u|u.support.is_none()), "pure air only retains attacking ground AI");
    for tick in 1..=3 { hub.tick(tick as f64*STEP+1e-8); }
    assert!(hub.rooms[&1].units.values().all(|u|u.support.is_none()), "normal maintenance cannot respawn support actors");

    // A legacy native world is a migration-boundary fixture only. No runtime
    // command or configuration can enable this test-only compatibility path.
    let mut old = FrontlineHub::new(&data_path()).unwrap();
    old.enable_legacy_ground_for_test();
    accepted(old.handle(1, Command::Create {name:"Historical support".into(),map:"korea".into(),observer:true,era:1976},0.0));
    accepted(old.handle(2, Command::Join {room:1,observer:false,team:Some(Team::Blue)},0.0));
    accepted(old.handle(1, Command::Start,0.0));
    let shooter = deploy_from_json(&mut old,2);
    let room = old.rooms.get_mut(&1).unwrap();
    let support = room.units.values().find(|u|u.team==Team::Red && u.support.is_some()).unwrap().reference;
    room.player_ground_allowed = false;
    let event = crate::frontline_sim::SimEvent {kind:"impact".into(),shooter:Some(shooter.unit),target:Some(support.unit),pos:[0.0;3],detail:json!({"shot_id":1,"damage_applied":true,"damage_changed":true})};
    let mut events = Vec::new();
    room.record_damage(&[event],&mut events);
    room.sim.destroy_unit_for_frontline_test(support.unit);
    room.settle_loss(support,None,false,&mut events);
    assert_eq!(room.team_score,[0,0], "a historical engineer/supply life is not an attacking combat score target");
    assert_eq!(room.scoreboard().iter().map(|s|s.score).sum::<u32>(),0);
}

//! AirFrontline retains ground attackers, never autonomous aircraft or AI air lives.
use super::*;

fn data() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
}
fn accepted(updates: Vec<(u32, Update)>) {
    assert!(!updates.iter().any(|(_, u)| matches!(u, Update::Error { .. })), "native rejection: {updates:?}");
}
fn hub(map: &str, two_teams: bool) -> FrontlineHub {
    let mut hub = FrontlineHub::new(&data()).unwrap();
    accepted(hub.handle(1, Command::Create {
        name: "Ground AI only, human air lives".into(), map: map.into(), observer: true, era: 2022,
    }, 0.0));
    if two_teams {
        for (player, team) in [(2, Team::Blue), (3, Team::Red)] {
            accepted(hub.handle(player, Command::Join { room: 1, observer: false, team: Some(team) }, 0.0));
        }
    }
    accepted(hub.handle(1, Command::Start, 0.0));
    hub
}
fn deploy(hub: &mut FrontlineHub, player: u32) -> UnitRef {
    accepted(hub.handle(player, Command::DeployAir {
        aircraft: "me262".into(), spawn: "air".into(), loadout: 0, custom: None, fuel_minutes: None,
    }, 0.0));
    hub.rooms[&1].members[&player].view.controlled.unwrap()
}
fn lose(hub: &mut FrontlineHub, reference: UnitRef) {
    let room = hub.rooms.get_mut(&1).unwrap();
    let unit = &room.air.units[&reference.unit];
    let pos = unit.pos();
    let opponent = 1 - unit.team.index() as u8;
    room.air.blast(pos, 2000.0, opponent, reference.unit ^ 123, false, None);
    assert!(!room.air.units[&reference.unit].alive(), "real native blast must destroy the player aircraft");
}
fn ground_attackers(room: &Room) {
    assert_eq!(room.companies.len(), 6, "both teams retain all three ground fronts");
    assert!(room.companies.values().all(|c| c.view.owner.is_none() && c.view.autonomous));
    assert!(room.units.values().all(|u| u.controller.is_none() && u.support.is_none()));
    assert!(room.units.len() >= 60);
    let zones: BTreeSet<_> = room.public_objectives().into_iter().map(|o| o.id).collect();
    assert_eq!(zones, BTreeSet::from(["W2".into(), "C2".into(), "E2".into()]));
}

#[test]
fn air_frontline_ground_ai_only_observer_starts_both_maps_without_autonomous_aircraft() {
    for map in ["korea", "taiwan"] {
        let mut hub = hub(map, false);
        ground_attackers(&hub.rooms[&1]);
        assert!(hub.rooms[&1].air.units.is_empty(), "{map}: observer-only start must create no AI aircraft");
        let before = hub.rooms[&1].sim.snapshots();
        for step in 1..=40 { hub.tick(step as f64 * STEP + 1e-8); }
        let room = &hub.rooms[&1];
        assert!(!room.finished, "no pilot teams cannot manufacture an air elimination");
        assert!(room.air.units.is_empty(), "normal simulation cannot inject autonomous aircraft");
        let after = room.sim.snapshots();
        for team in [0, 1] {
            assert!(before.iter().filter(|u| u.team == team).any(|a|
                after.iter().find(|b| b.id == a.id).is_some_and(|b| distance(a.pos, b.pos) > 0.5)),
                "{map}: actual native ground attackers must continue advancing");
        }
        assert!(room.scoreboard().is_empty(), "observers and ground AI do not become scored pilots");
    }
}

#[test]
fn air_frontline_ground_ai_only_player_aircraft_keep_owner_through_disconnect_and_reclaim() {
    let mut hub = hub("korea", true);
    let blue = deploy(&mut hub, 2);
    let red = deploy(&mut hub, 3);
    assert_eq!(hub.rooms[&1].air.units.len(), 2, "only the two admitted player sorties exist");
    assert!(hub.rooms[&1].air.units.values().all(|u| u.owner.is_some()));
    hub.disconnect(2, 0.0);
    let unit = &hub.rooms[&1].air.units[&blue.unit];
    assert_eq!(unit.owner, Some(2));
    assert_eq!(unit.controller, None);
    assert!(hub.rooms[&1].air_round_outcome().is_none(), "a disconnected owned life still survives");
    hub.resume(2, 0.0);
    assert_eq!(hub.rooms[&1].members[&2].view.controlled, Some(blue));
    assert_eq!(hub.rooms[&1].members[&3].view.controlled, Some(red));
    assert_eq!(hub.rooms[&1].air.units.len(), 2);
    assert!(hub.rooms[&1].members.values().filter(|p| !p.view.observer).all(|p| p.air_sortie_used));
}

#[test]
fn air_frontline_ground_ai_only_round_reset_recreates_ground_and_zero_pilotless_aircraft() {
    let mut hub = hub("taiwan", true);
    deploy(&mut hub, 2);
    deploy(&mut hub, 3);
    let old_battle = hub.rooms[&1].battle;
    let room = hub.rooms.get_mut(&1).unwrap();
    room.finished = true;
    room.started = false;
    hub.reset_round(1, 1.0).unwrap();
    let room = &hub.rooms[&1];
    assert_ne!(room.battle, old_battle);
    assert_eq!(room.round_number, 2);
    ground_attackers(room);
    assert!(room.air.units.is_empty(), "new round cannot recreate autonomous aircraft");
    assert!(room.members.values().filter(|p| !p.view.observer).all(|p| !p.air_sortie_used && p.view.controlled.is_none()));
    assert!(room.scoreboard().iter().all(|s| s.score == 0 && s.deaths == 0));
}

#[test]
fn air_frontline_ground_ai_only_due_reinforcement_spawns_ground_bodies_and_no_aircraft() {
    let mut hub = hub("korea", false);
    let room = hub.rooms.get_mut(&1).unwrap();
    let company = *room.companies.keys().next().unwrap();
    let old = room.companies[&company].view.units[0];
    // A real vacant native source slot exercises the reinforcement owner. The
    // existing 45-second native-clock receipt covers interval scheduling.
    room.sim.remove_unit(old.unit);
    room.companies.get_mut(&company).unwrap().reinforcement_next = room.sim.time();
    let mut events = Vec::new();
    room.reinforce_companies(&mut hub.next_unit, &mut events);
    assert!(events.iter().any(|e| e["kind"] == "reinforcement_batch" && e["company"] == company),
        "actual native ground replacement must be accepted: {events:?}");
    let new = room.companies[&company].view.units[0];
    assert_ne!(new, old);
    assert!(room.sim.unit_alive(new.unit));
    assert!(room.units[&new.unit].reinforcing);
    assert!(room.air.units.is_empty(), "ground reinforcement cannot retain or create an AI air force");
}

#[test]
fn air_frontline_ground_ai_only_unused_enemy_player_sortie_survives_real_blue_air_loss() {
    let mut hub = hub("korea", true);
    let blue = deploy(&mut hub, 2);
    lose(&mut hub, blue);
    let updates = hub.tick(STEP + 1e-8);
    assert!(updates.iter().any(|(_, u)| matches!(u, Update::Ended {winner: Some(Team::Red), reason, ..} if reason == "air_elimination")),
        "only real player lives/unused sorties decide elimination");
    let room = &hub.rooms[&1];
    let scores = room.scoreboard();
    assert_eq!(scores.len(), 2);
    assert_eq!(scores.iter().find(|s| s.player == 2).unwrap().deaths, 1);
    assert_eq!(scores.iter().find(|s| s.player == 3).unwrap().deaths, 0);
    assert_eq!(room.team_score, [0, 0]);
    assert!(room.air.units.values().all(|u| u.owner.is_some()));
}

#[test]
fn air_frontline_ground_ai_only_simultaneous_player_air_losses_draw_without_ai_survivors() {
    let mut hub = hub("korea", true);
    let blue = deploy(&mut hub, 2);
    let red = deploy(&mut hub, 3);
    lose(&mut hub, blue);
    lose(&mut hub, red);
    let updates = hub.tick(STEP + 1e-8);
    assert!(updates.iter().any(|(_, u)| matches!(u, Update::Ended {winner: None, reason, ..} if reason == "air_elimination")),
        "AI aircraft must not keep a lost player team alive");
    assert!(hub.rooms[&1].scoreboard().iter().all(|s| s.deaths == 1));
}

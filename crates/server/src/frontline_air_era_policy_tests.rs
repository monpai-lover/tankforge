//! Era is a maximum introduction year, with the same aircraft pool on both teams.
//! Real Hub admission/spawn tests: the browser cannot grant models or coordinates.
use super::*;

fn data_path() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
}
fn accepted(updates: Vec<(u32, Update)>) {
    assert!(!updates.iter().any(|(_, u)| matches!(u, Update::Error {..})), "unexpected native rejection: {updates:?}");
}
fn historical_catalog(era: u32) -> BTreeSet<String> {
    let source: Value = serde_json::from_slice(&std::fs::read(data_path().join("aircraft/frontline.json")).unwrap()).unwrap();
    source["aircraft"].as_object().unwrap().iter().filter_map(|(id, profile)| {
        let meta = &profile["metadata"];
        let year = meta["year"].as_u64().or_else(||meta["era"].as_str()?.parse().ok())?;
        (year <= u64::from(era)).then(||id.clone())
    }).collect()
}
fn create(hub: &mut FrontlineHub, host: u32, era: u32) -> u32 {
    accepted(hub.handle(host, Command::Create {
        name:format!("Taiwan unrestricted team aircraft, ceiling {era}"),
        map:"taiwan".into(),observer:true,era,
    },0.0));
    hub.membership[&host]
}
fn join(hub: &mut FrontlineHub, player: u32, room: u32, team: Team) {
    accepted(hub.handle(player, Command::Join {room,observer:false,team:Some(team)},0.0));
}
fn pool(hub: &mut FrontlineHub, player: u32) -> BTreeSet<String> {
    hub.handle(player,Command::Snapshot,0.0).into_iter().find_map(|(_, update)| {
        match update { Update::Snapshot { aircraft_options,.. } => Some(aircraft_options.into_iter().map(|a|a.id).collect()),_=>None }
    }).expect("real native snapshot aircraft options")
}
fn deploy(hub: &mut FrontlineHub, player: u32, aircraft: &str, spawn: &str) -> UnitRef {
    accepted(hub.handle(player,Command::DeployAir { custom_counts: None,
        aircraft:aircraft.into(),spawn:spawn.into(),loadout:0,custom:None, fuel_minutes: None,
    },0.0));
    hub.rooms[&hub.membership[&player]].members[&player].view.controlled.expect("accepted actual aircraft control")
}

#[test]
fn air_era_ceiling_modern_room_publishes_the_entire_dated_catalog_to_both_teams() {
    let mut hub = FrontlineHub::new(&data_path()).unwrap();
    let room = create(&mut hub,1,2022);
    join(&mut hub,2,room,Team::Blue);
    join(&mut hub,3,room,Team::Red);
    let expected = historical_catalog(2022);
    assert!(expected.contains("a6m2") && expected.contains("me262") && expected.contains("f16v"));
    assert_eq!(pool(&mut hub,2),expected,"modern Blue pool must retain every earlier introduction year");
    assert_eq!(pool(&mut hub,3),expected,"Red gets the same national-origin-independent aircraft pool");
}

#[test]
fn air_era_ceiling_both_teams_can_really_deploy_every_admitted_historical_aircraft_on_their_own_side() {
    let mut hub = FrontlineHub::new(&data_path()).unwrap();
    let aircraft: Vec<_> = historical_catalog(2022).into_iter().collect();
    let mut player = 10;
    // A fresh player per aircraft preserves the real one-aircraft-per-round rule;
    // chunks respect the existing 12-pilot team capacity rather than disabling it.
    for (round, group) in aircraft.chunks(TEAM_PLAYERS).enumerate() {
        let host = 1000+round as u32;
        let room = create(&mut hub,host,2022);
        accepted(hub.handle(host,Command::Start,0.0));
        for id in group {
            for team in [Team::Blue,Team::Red] {
                player+=1;
                join(&mut hub,player,room,team);
                let reference = deploy(&mut hub,player,id,"air");
                let native = &hub.rooms[&room].air.units[&reference.unit];
                assert_eq!(native.team,team);
                assert_eq!(native.owner,Some(player));
                assert_eq!(native.aircraft,*id);
                let map = &hub.maps["taiwan"];
                let start = |side| map["airspawns"].as_array().unwrap().iter()
                    .find(|s|s["enabled"]==true && s["team"]==side).unwrap()["pos"].clone();
                let own: [f64;3] = serde_json::from_value(start(team.index())).unwrap();
                let enemy: [f64;3] = serde_json::from_value(start(1-team.index())).unwrap();
                assert!(distance(native.pos(),own)<distance(native.pos(),enemy),"{id}/{team:?} must use its team's real rear air-start, independent of aircraft nation");
            }
        }
    }
}

#[test]
fn air_era_ceiling_excludes_future_models_but_allows_both_teams_the_same_older_runway_aircraft() {
    let mut hub = FrontlineHub::new(&data_path()).unwrap();
    let room = create(&mut hub,1,1943);
    join(&mut hub,2,room,Team::Blue);
    join(&mut hub,3,room,Team::Red);
    let expected = historical_catalog(1943);
    for player in [2,3] {
        assert_eq!(pool(&mut hub,player),expected);
        assert!(!pool(&mut hub,player).contains("p51d"));
    }
    accepted(hub.handle(1,Command::Start,0.0));
    for (player,team) in [(2,Team::Blue),(3,Team::Red)] {
        let denied=hub.handle(player,Command::DeployAir { custom_counts: None,aircraft:"p51d".into(),spawn:"air".into(),loadout:0,custom:None, fuel_minutes: None},0.0);
        assert!(denied.iter().any(|(_,u)|matches!(u,Update::Error{code,..} if code=="era_or_loadout")),"future aircraft must remain denied: {denied:?}");
        let reference=deploy(&mut hub,player,"a6m2","runway");
        let aircraft=&hub.rooms[&room].air.units[&reference.unit];
        assert_eq!(aircraft.team,team);
        assert!(hub.rooms[&room].air.at_friendly_runway(reference.unit),"both nations use their actual friendly runway");
    }
}

#[test]
fn air_era_ceiling_unrestricted_player_catalog_does_not_spawn_autonomous_aircraft() {
    let mut hub=FrontlineHub::new(&data_path()).unwrap();
    let room=create(&mut hub,1,2022);
    accepted(hub.handle(1,Command::Start,0.0));
    assert!(hub.rooms[&room].air.units.is_empty(), "the common player catalog must not create AI aircraft");
}

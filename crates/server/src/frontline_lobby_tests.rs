//! Actual Lobby/transport dispatch integration, beyond the native/domain unit tests.
use super::*;
use crate::frontline::{Command, Update};
use serde_json::json;

fn lobby() -> Lobby {
    let data = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let mut lobby = Lobby::new(Default::default(), Default::default(), vec![])
        .with_frontline(&data)
        .unwrap();
    lobby
        .frontline
        .as_mut()
        .unwrap()
        .use_c2_test_scene()
        .unwrap();
    lobby
}
fn connect(l: &mut Lobby) -> u32 {
    let (id, _) = l.connect();
    l.handle(
        id,
        ClientMsg::Hello {
            name: format!("p{id}"),
            resume: None,
            gameplay_rules_version: json!(GAMEPLAY_RULES_VERSION),
            ammo_protocol_version: json!(AMMO_PROTOCOL_VERSION),
        },
        0.0,
    );
    id
}
fn action(l: &mut Lobby, id: u32, c: Command, at: f64) -> Out {
    l.handle(
        id,
        ClientMsg::Frontline {
            version: 1,
            command: c,
        },
        at,
    )
}
fn snapshot(
    out: &Out,
) -> (
    &crate::frontline::RoomView,
    &Vec<crate::frontline::UnitView>,
    &Vec<crate::frontline::CompanyView>,
) {
    out.iter()
        .find_map(|(_, m)| match m {
            ServerMsg::Frontline {
                message:
                    Update::Snapshot {
                        room,
                        units,
                        companies,
                        ..
                    },
                ..
            } => Some((room, units, companies)),
            _ => None,
        })
        .expect("actual frontline snapshot")
}
fn started(l: &mut Lobby, id: u32, observer: bool) -> Out {
    action(
        l,
        id,
        Command::Create {
            name: "integration".into(),
            map: "korea".into(),
            observer,
            era: 1986,
        },
        0.0,
    );
    action(l, id, Command::Start, 0.0)
}

#[test]
fn frontline_lobby_observer_starts_without_player_vehicle_or_state() {
    let mut l = lobby();
    let observer = connect(&mut l);
    let rejected = l.handle(
        observer,
        ClientMsg::Frontline {
            version: 99,
            command: Command::List,
        },
        0.0,
    );
    assert!(matches!(rejected[0].1, ServerMsg::Error { .. }));
    let out = started(&mut l, observer, true);
    let (room, units, companies) = snapshot(&out);
    assert!(room.started && room.members[0].observer);
    assert_eq!(units.len(), 20);
    assert_eq!(companies.len(), 2);
    assert!(units.iter().all(|u| u.controller.is_none()));
    assert!(companies.iter().all(|c| c.autonomous && c.owner.is_none()));
    assert_eq!(l.players.len(), 1);
    assert!(l.players[&observer].state.is_none());
    let mut frames = 0;
    for i in 1..=20 {
        for (to, m) in l.tick_at(i as f64 * 0.05) {
            if let ServerMsg::Frontline {
                message: Update::Frame { units, .. },
                ..
            } = m
            {
                assert_eq!(to, vec![observer]);
                assert_eq!(units.len(), 20);
                frames += 1;
            }
        }
    }
    assert!(
        frames > 10,
        "observer-only world must replicate without legacy Player State packets"
    );
    let legacy = l.handle(
        observer,
        ClientMsg::State {
            s: json!({"pos":[100,100,100]}),
        },
        1.1,
    );
    assert!(matches!(legacy[0].1, ServerMsg::Error { .. }));
    assert!(l.players[&observer].state.is_none());
}

#[test]
fn frontline_lobby_keeps_company_and_vehicle_over_long_reconnect_and_blocks_stale_control() {
    let mut l = lobby();
    let owner = connect(&mut l);
    started(&mut l, owner, false);
    let out = action(
        &mut l,
        owner,
        Command::Deploy {
            vehicle: "su_t72a".into(),
        },
        0.1,
    );
    let (room, units, companies) = snapshot(&out);
    let company = companies
        .iter()
        .find(|c| c.owner == Some(owner))
        .unwrap()
        .clone();
    let controlled = room
        .members
        .iter()
        .find(|p| p.player == owner)
        .unwrap()
        .controlled
        .unwrap();
    let unit = units.iter().find(|u| u.unit == controlled).unwrap().clone();
    let old_epoch = unit.epoch;
    assert_eq!(company.units.len(), 10);
    assert_eq!(l.players.len(), 1);
    assert_eq!(l.players[&owner].sp, 0.0);
    l.drop_link(owner, 0.2);
    l.sweep(31.0);
    assert!(
        l.players.contains_key(&owner),
        "frontline participant must outlive legacy20-second seat grace"
    );
    let token = l.players[&owner].token.clone();
    let fresh = connect(&mut l);
    let (actual, out) = l.dispatch_socket(
        fresh,
        ClientMsg::Hello {
            name: "resumed".into(),
            resume: Some(token),
            gameplay_rules_version: json!(GAMEPLAY_RULES_VERSION),
            ammo_protocol_version: json!(AMMO_PROTOCOL_VERSION),
        },
        31.1,
    );
    assert_eq!(actual, owner);
    let (_, units, companies) = snapshot(&out);
    assert_eq!(
        companies
            .iter()
            .find(|c| c.owner == Some(owner))
            .unwrap()
            .units,
        company.units
    );
    let same = units.iter().find(|u| u.unit == controlled).unwrap();
    assert!(same.epoch > old_epoch);
    assert_eq!(same.ammo, unit.ammo);
    assert_eq!(same.damage, unit.damage);
    assert_eq!(same.pos, unit.pos);
    let stale = action(
        &mut l,
        owner,
        Command::Input {
            unit: controlled,
            epoch: old_epoch,
            seq: 1,
            throttle: 1.0,
            steer: 0.0,
            brake: 0.0,
            turret_yaw: 0.0,
            gun_pitch: 0.0,
            fire: true,
        },
        31.2,
    );
    assert!(stale.iter().any(|(_, m)| matches!(
        m,
        ServerMsg::Frontline {
            message: Update::Error { .. },
            ..
        }
    )));
}

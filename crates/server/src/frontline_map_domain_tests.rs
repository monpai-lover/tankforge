//! Installed map registry and actual per-theatre native room isolation.
use super::*;
fn data() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
}
fn accepted(out: &[(u32, Update)]) {
    assert!(
        !out.iter().any(|(_, m)| matches!(m, Update::Error { .. })),
        "{out:?}"
    );
}
fn start(h: &mut FrontlineHub, player: u32, map: &str) -> u32 {
    accepted(&h.handle(
        player,
        Command::Create {
            name: format!("Actual {map}"),
            map: map.into(),
            observer: true,
            era: 1986,
        },
        0.0,
    ));
    let id = h.membership[&player];
    accepted(&h.handle(player, Command::Start, 0.0));
    id
}
#[test]
fn installed_map_registry_serves_exact_validated_bytes_and_rejects_unknown_ids() {
    let mut h = FrontlineHub::new(&data()).unwrap();
    let options = h.map_options();
    let installed:Vec<_>=["korea","taiwan","taiwan-escort"].into_iter().filter(|id|data().join(format!("frontline/{id}.json")).exists()).collect();
    assert_eq!(options.len(), installed.len());
    for id in installed {
        let source = std::fs::read_to_string(data().join(format!("frontline/{id}.json"))).unwrap();
        assert_eq!(h.map_source(id), Some(source.as_str()));
        let sha = tg_combat::geometry::manifest::sha256(source.as_bytes());
        let option = options.iter().find(|o| o["id"] == id).unwrap();
        assert_eq!(option["sha256"], sha);
        assert_eq!(option["path"], format!("/frontline/{id}.json"));
        accepted(&h.handle(
            if id == "korea" { 1 } else if id=="taiwan" { 2 } else {3},
            Command::Create {
                name: "revision binder".into(),
                map: id.into(),
                observer: true,
                era: 1986,
            },
            0.0,
        ));
        let room = &h.rooms[&h.membership[&if id == "korea" { 1 } else if id=="taiwan" { 2 } else {3}]];
        assert_eq!(room.view().map_revision, sha);
        assert_eq!(room.view().map, id);
    }
    for id in [
        "unknown",
        "../korea",
        "korea/../../taiwan",
        "taiwan%2f..",
        "/taiwan",
        "taiwan.json",
    ] {
        assert!(h.map_source(id).is_none());
        let out = h.handle(
            4,
            Command::Create {
                name: "invalid".into(),
                map: id.into(),
                observer: true,
                era: 1986,
            },
            0.0,
        );
        assert!(out
            .iter()
            .any(|(_, m)| matches!(m,Update::Error{code,..}if code=="unknown_map")));
    }
}
#[test]
fn korea_and_taiwan_actual_sixty_body_rooms_have_independent_terrain_resources_and_shutdown() {
    let mut h = FrontlineHub::new(&data()).unwrap();
    h.enable_legacy_ground_for_test();
    let korea = start(&mut h, 1, "korea");
    let taiwan = start(&mut h, 2, "taiwan");
    for id in [korea, taiwan] {
        let r = &h.rooms[&id];
        assert_eq!(r.units.values().filter(|u| u.support.is_none()).count(), 60);
        assert_eq!(r.companies.len(), 6);
        assert_eq!(r.objectives.len(), 15);
        assert_eq!(r.staging.len(), 6);
        assert_eq!(
            r.air.views().len(),
            2,
            "Both independent theatres retain native air support"
        );
        assert!(r
            .members
            .values()
            .all(|p| p.view.observer && p.view.controlled.is_none()));
        for source in &r.staging {
            for p in &source.slots {
                assert!((r.sim.height(p[0], p[2]) - p[1]).abs() < 0.001);
            }
        }
    }
    let tw = &h.rooms[&taiwan];
    let p = tw.staging[0].pos;
    assert!(
        (tw.sim.height(p[0], p[2]) - h.rooms[&korea].sim.height(p[0], p[2])).abs() > 1.0,
        "Taiwan must not use the Korean height callback"
    );
    assert_ne!(tw.bounds, h.rooms[&korea].bounds);
    let before = tw.sim.snapshots();
    let companies = tw.company_views();
    let plans: BTreeMap<_, _> = tw
        .units
        .values()
        .filter(|u| u.support.is_none())
        .map(|u| (u.reference.unit, u.navigation.clone().unwrap()))
        .collect();
    let kr_unit = h.rooms[&korea]
        .companies
        .values()
        .next()
        .unwrap()
        .view
        .units[0];
    let tw_unit = h.rooms[&taiwan]
        .companies
        .values()
        .next()
        .unwrap()
        .view
        .units[0];
    let kr_stock = h.rooms[&korea].sim.snapshot(kr_unit.unit).unwrap().ammo;
    let tw_stock = h.rooms[&taiwan].sim.snapshot(tw_unit.unit).unwrap().ammo;
    h.rooms
        .get_mut(&taiwan)
        .unwrap()
        .sim
        .fire(tw_unit.unit, None)
        .unwrap();
    assert_eq!(
        h.rooms[&taiwan].sim.snapshot(tw_unit.unit).unwrap().ammo,
        tw_stock - 1
    );
    assert_eq!(
        h.rooms[&korea].sim.snapshot(kr_unit.unit).unwrap().ammo,
        kr_stock
    );
    assert_ne!(kr_unit.battle, tw_unit.battle);
    for i in 1..=80 {
        h.tick(i as f64 * STEP + 1e-8);
    }
    for c in &companies {
        let moved = c.view_units_for_test(&h.rooms[&taiwan], &before, &plans);
        assert!(
            moved >= 3,
            "{:?}/{} Taiwan source must physically advance at least three native tanks, got{moved}",
            c.team,
            c.front
        );
    }
    // End exactly one accepted room by an actual native loss exhausting its
    // remaining team readiness; the other map keeps its bodies and native clock.
    let victim = h.rooms[&taiwan]
        .units
        .values()
        .find(|u| u.team == Team::Red)
        .unwrap()
        .reference;
    let kr_before = h.rooms[&korea].sim.snapshot(kr_unit.unit).unwrap();
    let kr_clock = h.rooms[&korea].sim.time();
    let kr_ready = h.rooms[&korea].readiness;
    let r = h.rooms.get_mut(&taiwan).unwrap();
    r.readiness[1] = LOSS_COST;
    r.sim.destroy_unit_for_frontline_test(victim.unit);
    let out = h.tick(81.0 * STEP + 1e-8);
    assert!(out.iter().any(|(to, m)| to.contains(&2)
        && matches!(m,Update::Ended{winner:Some(Team::Blue),reason,..}if reason=="readiness")));
    assert!(h.rooms[&taiwan].finished && !h.rooms[&korea].finished);
    assert_eq!(h.rooms[&korea].readiness, kr_ready);
    assert!(h.rooms[&korea].sim.time() > kr_clock);
    assert_eq!(
        h.rooms[&korea].sim.snapshot(kr_unit.unit).unwrap().ammo,
        kr_before.ammo
    );
    h.leave(2);
    assert!(!h.rooms.contains_key(&taiwan));
    assert!(h.rooms.contains_key(&korea));
    h.tick(82.0 * STEP + 1e-8);
    assert_eq!(
        h.rooms[&korea]
            .units
            .values()
            .filter(|u| u.support.is_none())
            .count(),
        60
    );
}
impl CompanyView {
    fn view_units_for_test(
        &self,
        room: &Room,
        before: &[crate::frontline_sim::SimSnapshot],
        plans: &BTreeMap<u64, NavigationPlan>,
    ) -> usize {
        self.units
            .iter()
            .filter(|r| {
                let a = before.iter().find(|s| s.id == r.unit).unwrap();
                let b = room.sim.snapshot(r.unit).unwrap();
                // Require actual position change and forward progress on the
                // registered local polyline, not a map-marker-only animation.
                let points = &plans[&r.unit].points;
                let along = |p: [f64; 3]| {
                    let mut offset = 0.0;
                    let mut best = (f64::INFINITY, 0.0);
                    for e in points.windows(2) {
                        let dx = e[1][0] - e[0][0];
                        let dz = e[1][1] - e[0][1];
                        let len = dx.hypot(dz);
                        let t = if len > 0.0 {
                            ((p[0] - e[0][0]) * dx + (p[2] - e[0][1]) * dz) / (len * len)
                        } else {
                            0.0
                        };
                        let t = t.clamp(0.0, 1.0);
                        let d = (p[0] - e[0][0] - t * dx).hypot(p[2] - e[0][1] - t * dz);
                        if d < best.0 {
                            best = (d, offset + t * len);
                        }
                        offset += len;
                    }
                    best.1
                };
                b.alive && distance(a.pos, b.pos) > 1.0 && along(b.pos) - along(a.pos) > 1.0
            })
            .count()
    }
}

#[cfg(unix)]
#[test]
fn optional_taiwan_is_omitted_when_absent_but_invalid_installed_map_fails_startup() {
    use std::os::unix::fs::symlink;
    struct Scratch(std::path::PathBuf);
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let folder = std::env::temp_dir().join(format!(
        "tankforge-native-map-registry-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    std::fs::create_dir(&folder).unwrap();
    let scratch = Scratch(folder);
    // Share read-only real catalogs, not copied models or fabricated profiles.
    for entry in std::fs::read_dir(data()).unwrap().flatten() {
        if entry.file_name() == "frontline" {
            continue;
        }
        symlink(entry.path(), scratch.0.join(entry.file_name())).unwrap();
    }
    std::fs::create_dir(scratch.0.join("frontline")).unwrap();
    symlink(
        data().join("frontline/korea.json"),
        scratch.0.join("frontline/korea.json"),
    )
    .unwrap();
    let mut h = FrontlineHub::new(&scratch.0).unwrap();
    assert_eq!(h.map_options().len(), 1);
    assert!(h.map_source("taiwan").is_none());
    let out = h.handle(
        1,
        Command::Create {
            name: "not installed".into(),
            map: "taiwan".into(),
            observer: true,
            era: 1986,
        },
        0.0,
    );
    assert!(out
        .iter()
        .any(|(_, m)| matches!(m,Update::Error{code,..}if code=="unknown_map")));
    std::fs::write(
        scratch.0.join("frontline/taiwan.json"),
        b"{\"id\":\"taiwan\"}",
    )
    .unwrap();
    let error = FrontlineHub::new(&scratch.0)
        .err()
        .expect("A present malformed map must not be silently omitted or served");
    assert!(error.contains("taiwan"), "{error}");
    let source = std::fs::read_to_string(data().join("frontline/taiwan.json")).unwrap();
    std::fs::write(scratch.0.join("frontline/taiwan.json"), source.as_bytes()).unwrap();
    assert!(
        h.map_source("taiwan").is_none(),
        "A running registry does not discover an unvalidated file change"
    );
    let mut cached = FrontlineHub::new(&scratch.0).unwrap();
    let revision = tg_combat::geometry::manifest::sha256(source.as_bytes());
    std::fs::write(
        scratch.0.join("frontline/taiwan.json"),
        b"unvalidated replacement",
    )
    .unwrap();
    assert_eq!(cached.map_source("taiwan"), Some(source.as_str()));
    accepted(&cached.handle(
        2,
        Command::Create {
            name: "cached validated map".into(),
            map: "taiwan".into(),
            observer: true,
            era: 1986,
        },
        0.0,
    ));
    assert_eq!(
        cached.rooms[&1].view().map_revision,
        revision,
        "Native terrain and served bytes retain one immutable revision despite later disk changes"
    );
}

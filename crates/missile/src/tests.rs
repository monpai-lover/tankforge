use crate::def::*;
use crate::terrain::HeightGrid;
use crate::v::*;
use crate::world::*;

/// A T-10M sized box at the origin facing +z, its Oplot-MO pivot on the turret roof.
fn tank(id: u32, team: u8, gun_ok: bool, radar_ok: bool) -> Actor {
    Actor {
        id,
        team,
        alive: true,
        center: [0.0, 1.3, 0.0],
        vel: [0.0; 3],
        obb: Some(Obb { center: [0.0, 1.3, 0.0], axes: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]], half: [1.7, 1.3, 3.4] }),
        aps_pivot: Some([0.5, 2.8, 0.2]),
        aps_base_yaw: 0.0,
        aps_gun_ok: gun_ok,
        aps_radar_ok: radar_ok,
    }
}

fn shooter(id: u32) -> Actor {
    Actor { id, team: 1, alive: true, center: [0.0, 1.2, 0.0], vel: [0.0; 3], obb: None, aps_pivot: None, aps_base_yaw: 0.0, aps_gun_ok: true, aps_radar_ok: true }
}

fn rocket(speed: f64) -> MissileDef {
    MissileDef {
        id: format!("rocket_{speed}"),
        name: "test rocket".into(),
        guidance: Guidance::None,
        mass_kg: 40.0,
        caliber_mm: 180.0,
        length_m: 1.6,
        span_m: 0.4,
        launch_speed_ms: speed,
        max_speed_ms: speed,
        boost_s: 0.1,
        burn_s: 30.0,
        drag_k: 0.0,
        max_range_m: 5000.0,
        min_range_m: 0.0,
        turn_accel_ms2: 0.0,
        lift: true,
        hp: 4.0,
        warhead_share: 0.35,
        fuse_chance: 0.5,
        control_loss_chance: 0.3,
        warhead: "he".into(),
        guidance_lag_s: 0.25,
        smoke: 1.0,
    }
}

fn world(extra: Vec<MissileDef>) -> World {
    let mut defs = vec![MissileDef::tow()];
    defs.extend(extra);
    World::new(defs)
}

/// Elevation (rad) that brings an unguided rocket from `from` down through `target`, found by
/// flying it.
fn rocket_elevation(def: &MissileDef, from: V3, target: V3) -> f64 {
    let bearing = (target[0] - from[0]).atan2(target[2] - from[2]);
    let flat = ((target[0] - from[0]).powi(2) + (target[2] - from[2]).powi(2)).sqrt();
    let height_at = |el: f64| {
        let mut w = World::new(vec![def.clone()]);
        let id = w.launch(&def.id, 99, 1, from, dir_of(bearing, el), 1).unwrap();
        let mut prev = from;
        for _ in 0..6000 {
            w.step(1.0 / 120.0, &[]);
            let Some(m) = w.missile(id) else { return -1e9 };
            let d = ((m.pos[0] - from[0]).powi(2) + (m.pos[2] - from[2]).powi(2)).sqrt();
            if d >= flat {
                let d0 = ((prev[0] - from[0]).powi(2) + (prev[2] - from[2]).powi(2)).sqrt();
                let f = (flat - d0) / (d - d0).max(1e-9);
                return prev[1] + (m.pos[1] - prev[1]) * f - target[1];
            }
            prev = m.pos;
        }
        -1e9
    };
    let (mut lo, mut hi) = (-0.05, 0.7);
    for _ in 0..40 {
        let mid = (lo + hi) / 2.0;
        if height_at(mid) > 0.0 {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    (lo + hi) / 2.0
}

/// A TOW from `from` laid on the tank's middle, guided all the way.
fn tow_at(w: &mut World, from: V3, seed: u32) -> u32 {
    let target = [0.0, 1.4, 0.0];
    let id = w.launch("bgm71a_tow", 99, 1, from, norm(sub(target, from)), seed).unwrap();
    w.guide(id, 99, add(from, [0.0, 0.3, 0.0]), target);
    id
}

/// Runs until every missile is done; returns (all events, bullets fired).
fn run(w: &mut World, actors: &[Actor], secs: f64) -> (Vec<Event>, usize) {
    let mut ev = Vec::new();
    let mut fired = 0;
    let dt = 1.0 / 60.0;
    let mut t = 0.0;
    while t < secs {
        let o = w.step(dt, actors);
        fired += o.fired.len();
        ev.extend(o.events);
        t += dt;
        if w.missiles.is_empty() && t > 0.5 {
            break;
        }
    }
    (ev, fired)
}

fn intercepted(ev: &[Event], mid: u32) -> bool {
    ev.iter().any(|e| matches!(e, Event::Intercept { missile, .. } if *missile == mid))
}
fn struck(ev: &[Event], mid: u32) -> bool {
    ev.iter().any(|e| matches!(e, Event::MissileHit { missile, actor: 1, .. } if *missile == mid))
}

#[test]
fn a_tow_flies_its_speed_schedule_and_rides_the_line_to_the_target() {
    let mut w = world(vec![]);
    let actors = [tank(1, 0, true, true), shooter(99)];
    // no protection: it must hit, about where the sight is laid, in the TOW's time of flight
    let id = tow_at(&mut w, [30.0, 2.0, 1500.0], 1);
    let mut t_hit = None;
    let mut t = 0.0;
    while t < 12.0 {
        let o = w.step(1.0 / 60.0, &actors);
        t += 1.0 / 60.0;
        if let Some(Event::MissileHit { point, .. }) = o.events.iter().find(|e| matches!(e, Event::MissileHit { .. })) {
            t_hit = Some((t, *point));
            break;
        }
        if t > 1.0 && t < 1.1 {
            let m = w.missile(id).unwrap();
            assert!(m.speed > 180.0 && m.speed < 300.0, "boosting {}", m.speed);
        }
    }
    let (t, p) = t_hit.expect("the TOW reaches the tank");
    assert!(t > 4.5 && t < 8.0, "time of flight to 1500 m {t}");
    assert!(p[1] > 0.5 && p[1] < 2.7 && p[0].abs() < 1.8, "struck the box near the aim point {p:?}");
}

#[test]
fn the_oplot_mo_detects_tracks_leads_and_shoots_a_single_tow_down() {
    let mut downed = 0;
    let mut first_fire_range = Vec::new();
    for seed in 1..=20u32 {
        let mut w = world(vec![]);
        w.add_aps(1, 0, ApsDef::oplot_mo(), seed * 7);
        let actors = [tank(1, 0, true, true), shooter(99)];
        let id = tow_at(&mut w, [0.0, 2.0, 1000.0], seed);
        let mut ev = Vec::new();
        let mut t = 0.0;
        while t < 8.0 && !w.missiles.is_empty() {
            let o = w.step(1.0 / 60.0, &actors);
            if !o.fired.is_empty() && first_fire_range.len() < seed as usize {
                if let Some(m) = w.missile(id) {
                    first_fire_range.push(dist(m.pos, [0.5, 2.8, 0.2]));
                }
            }
            ev.extend(o.events);
            t += 1.0 / 60.0;
        }
        // in order: detected, locked, firing, then hits on the missile
        let pos = |f: &dyn Fn(&Event) -> bool| ev.iter().position(|e| f(e));
        let det = pos(&|e| matches!(e, Event::Detect { .. })).expect("detected");
        let lock = pos(&|e| matches!(e, Event::Lock { .. })).expect("locked");
        let fire = pos(&|e| matches!(e, Event::FireStart { .. })).expect("fired");
        assert!(det <= lock && lock < fire, "detect {det} lock {lock} fire {fire}");
        if let Some(Event::Detect { range, .. }) = ev.iter().find(|e| matches!(e, Event::Detect { .. })) {
            assert!(*range > 700.0, "seen far out: {range}");
        }
        if intercepted(&ev, id) {
            downed += 1;
            assert!(!struck(&ev, id));
        }
    }
    assert!(downed >= 15, "a lone TOW is usually shot down: {downed}/20");
    // it holds fire until the missile is inside 200 m
    assert!(first_fire_range.iter().all(|r| *r <= 205.0 && *r > 20.0), "{first_fire_range:?}");
}

#[test]
fn speed_matters_and_shot_faster_than_the_gun_can_handle_is_left_alone() {
    let count = |speed: f64| {
        let mut downed = 0;
        let mut fired_any = 0;
        for seed in 1..=12u32 {
            let def = rocket(speed);
            let did = def.id.clone();
            let mut w = world(vec![def]);
            w.add_aps(1, 0, ApsDef::oplot_mo(), seed);
            let from = [0.0, 1.6, 900.0];
            // laid with the elevation an unguided rocket needs to come down on the tank
            let el = rocket_elevation(&w.defs[&did], from, [0.0, 1.5, 0.0]);
            let id = w.launch(&did, 99, 1, from, dir_of(std::f64::consts::PI, el), seed).unwrap();
            let (ev, fired) = run(&mut w, &[tank(1, 0, true, true), shooter(99)], 12.0);
            if intercepted(&ev, id) {
                downed += 1;
            }
            if fired > 0 {
                fired_any += 1;
            }
        }
        (downed, fired_any)
    };
    let (slow, _) = count(135.0);
    let (fast, _) = count(600.0);
    let (_, shot_at) = count(1500.0);
    assert!(slow >= 9, "a 135 m/s rocket is easy: {slow}/12");
    assert!(fast <= slow, "a 600 m/s missile is harder: {fast} vs {slow}");
    assert_eq!(shot_at, 0, "1500 m/s is beyond it: it does not even try");
}

#[test]
fn missiles_from_two_sides_are_taken_one_after_the_other() {
    let mut both = 0;
    for seed in 1..=10u32 {
        let mut w = world(vec![]);
        w.add_aps(1, 0, ApsDef::oplot_mo(), seed);
        let actors = [tank(1, 0, true, true), shooter(99)];
        let a = tow_at(&mut w, [0.0, 2.0, 900.0], seed);
        // the second from the left rear, two seconds later
        let mut ev = Vec::new();
        for _ in 0..120 {
            ev.extend(w.step(1.0 / 60.0, &actors).events);
        }
        let b = tow_at(&mut w, [-700.0, 2.0, -500.0], seed + 100);
        let (more, _) = run(&mut w, &actors, 10.0);
        ev.extend(more);
        // defeated: blown up, broken up, or knocked off course into the ground short of the tank
        if !struck(&ev, a) && !struck(&ev, b) {
            both += 1;
        }
        // the gun turned round for the second
        assert!(ev.iter().filter(|e| matches!(e, Event::Lock { .. })).count() >= 2);
    }
    assert!(both >= 6, "two missiles from two sides defeated: {both}/10");
}

#[test]
fn a_salvo_can_saturate_it() {
    let mut through = 0;
    let mut downed = 0;
    for seed in 1..=10u32 {
        let mut w = world(vec![]);
        w.add_aps(1, 0, ApsDef::oplot_mo(), seed);
        let actors = [tank(1, 0, true, true), shooter(99)];
        let ids: Vec<u32> = [[0.0, 2.0, 800.0], [40.0, 2.0, 790.0], [-40.0, 2.0, 805.0], [20.0, 2.5, 795.0]].iter().enumerate().map(|(k, p)| tow_at(&mut w, *p, seed * 10 + k as u32)).collect();
        let (ev, _) = run(&mut w, &actors, 10.0);
        through += ids.iter().filter(|i| struck(&ev, **i)).count();
        downed += ids.iter().filter(|i| intercepted(&ev, **i)).count();
    }
    assert!(downed > 0, "it still gets some");
    assert!(through > 0, "but four at once get through sometimes");
}

#[test]
fn a_missile_skimming_the_ground_is_still_seen_and_engaged() {
    let mut downed = 0;
    for seed in 1..=10u32 {
        let mut w = world(vec![]);
        w.add_aps(1, 0, ApsDef::oplot_mo(), seed);
        let actors = [tank(1, 0, true, true), shooter(99)];
        let from = [0.0, 0.9, 900.0];
        let id = w.launch("bgm71a_tow", 99, 1, from, [0.0, 0.0, -1.0], seed).unwrap();
        w.guide(id, 99, [0.0, 0.9, 900.0], [0.0, 0.9, 0.0]);
        let (ev, _) = run(&mut w, &actors, 10.0);
        if intercepted(&ev, id) {
            downed += 1;
        }
    }
    assert!(downed >= 6, "low flyer: {downed}/10");
}

#[test]
fn a_hill_hides_a_missile_from_the_radar() {
    let ridge = |height: f32| {
        // a ridge across the line of fire 400 m out
        let n = 200usize;
        let size = 2000.0;
        let mut h = vec![0.0f32; n * n];
        for j in 0..n {
            let z = -1000.0 + (j as f64 + 0.5) * size / n as f64;
            if (z - 400.0).abs() < 25.0 {
                for i in 0..n {
                    h[j * n + i] = height;
                }
            }
        }
        HeightGrid { x0: -1000.0, z0: -1000.0, size, res: n, heights: h }
    };
    for (height, seen_far) in [(6.0f32, false), (0.0, true)] {
        let mut w = world(vec![]);
        w.terrain = ridge(height);
        w.add_aps(1, 0, ApsDef::oplot_mo(), 3);
        let actors = [tank(1, 0, true, true), shooter(99)];
        // launched from 900 m on the far side, flying at 2 m: into the ridge if there is one
        let id = tow_at(&mut w, [0.0, 2.0, 900.0], 5);
        let (ev, fired) = run(&mut w, &actors, 10.0);
        let detected = ev.iter().any(|e| matches!(e, Event::Detect { .. }));
        assert_eq!(detected, seen_far, "ridge {height} m");
        if !seen_far {
            assert_eq!(fired, 0);
            assert!(ev.iter().any(|e| matches!(e, Event::MissileGround { missile, point } if *missile == id && (point[2] - 400.0).abs() < 30.0)), "it flew into the ridge");
        }
    }
}

#[test]
fn an_ambush_from_close_in_leaves_too_little_time() {
    // a 250 m/s rocket from 60 m: there 0.25 s after launch, inside the radar's confirmation
    // and the barrels' spin-up
    let mut downed = 0;
    let mut far = 0;
    for seed in 1..=10u32 {
        for (range, count) in [(60.0, &mut downed), (900.0, &mut far)] {
            let def = rocket(250.0);
            let did = def.id.clone();
            let mut w = world(vec![def]);
            w.add_aps(1, 0, ApsDef::oplot_mo(), seed);
            let from = [0.0, 1.6, range];
            let el = rocket_elevation(&w.defs[&did], from, [0.0, 1.5, 0.0]);
            let id = w.launch(&did, 99, 1, from, dir_of(std::f64::consts::PI, el), seed).unwrap();
            let (ev, _) = run(&mut w, &[tank(1, 0, true, true), shooter(99)], 8.0);
            if intercepted(&ev, id) {
                *count += 1;
            }
        }
    }
    assert!(downed <= 1, "from 60 m there is no time: {downed}/10");
    assert!(far > downed + 4, "the same rocket from 900 m is met: {far}/10");
}

#[test]
fn no_rounds_a_broken_gun_a_dead_radar_or_switched_off_means_no_defence() {
    for case in 0..4 {
        let mut w = world(vec![]);
        let mut def = ApsDef::oplot_mo();
        if case == 0 {
            def.rounds = 0;
        }
        w.add_aps(1, 0, def, 9);
        if case == 3 {
            w.set_aps(1, false, None);
        }
        let actors = [tank(1, 0, case != 1, case != 2), shooter(99)];
        let id = tow_at(&mut w, [0.0, 2.0, 900.0], 4);
        let (ev, fired) = run(&mut w, &actors, 10.0);
        assert_eq!(fired, 0, "case {case}");
        assert!(struck(&ev, id), "case {case}: it goes home");
        let mode = w.aps_of(1).unwrap().mode;
        let want = [ApsMode::Empty, ApsMode::Fault, ApsMode::Fault, ApsMode::Off][case];
        // after the hit the mode settles back; empty and off stay what they are
        if case == 0 || case == 3 {
            assert_eq!(mode, want, "case {case}");
        }
    }
}

#[test]
fn barrels_overheat_and_the_rate_stays_inside_its_range() {
    let mut w = world(vec![]);
    let mut def = ApsDef::oplot_mo();
    def.heat_rounds = 40.0;
    def.cool_per_s = 0.05;
    w.add_aps(1, 0, def, 2);
    w.set_aps(1, true, Some(20000.0));
    assert_eq!(w.aps_of(1).unwrap().rate_rpm, 11000.0);
    w.set_aps(1, true, Some(9500.0));
    let actors = [tank(1, 0, true, true), shooter(99)];
    tow_at(&mut w, [0.0, 2.0, 900.0], 8);
    tow_at(&mut w, [300.0, 2.0, 850.0], 9);
    let (ev, fired) = run(&mut w, &actors, 10.0);
    assert!(ev.iter().any(|e| matches!(e, Event::Overheat { .. })), "40 rounds in a row is too many");
    assert!(fired >= 40 && fired < 120, "it stops when hot: {fired}");
}

#[test]
fn every_kill_is_a_bullet_that_reached_the_missile() {
    let mut w = world(vec![]);
    w.add_aps(1, 0, ApsDef::oplot_mo(), 11);
    let actors = [tank(1, 0, true, true), shooter(99)];
    let id = tow_at(&mut w, [0.0, 2.0, 1000.0], 2);
    let (ev, _) = run(&mut w, &actors, 10.0);
    if let Some(i) = ev.iter().position(|e| matches!(e, Event::Intercept { missile, .. } if *missile == id)) {
        let Event::Intercept { point, .. } = &ev[i] else { unreachable!() };
        // the killing event is preceded by the bullet hit at the same point
        assert!(matches!(&ev[i - 1], Event::BulletHit { point: p, .. } if dist(*p, *point) < 1e-9));
        assert!(dist(*point, [0.5, 2.8, 0.2]) > 15.0 && dist(*point, [0.5, 2.8, 0.2]) < 230.0);
    }
}

#[test]
fn the_same_seeds_give_the_same_battle() {
    let go = || {
        let mut w = world(vec![]);
        w.add_aps(1, 0, ApsDef::oplot_mo(), 5);
        let actors = [tank(1, 0, true, true), shooter(99)];
        tow_at(&mut w, [100.0, 2.0, 900.0], 6);
        run(&mut w, &actors, 10.0)
    };
    assert_eq!(go(), go());
}

#[test]
#[ignore]
fn debug_trace_single_tow() {
    for seed in 1..=6u32 {
        let mut w = world(vec![]);
        w.add_aps(1, 0, ApsDef::oplot_mo(), seed * 7);
        let actors = [tank(1, 0, true, true), shooter(99)];
        let id = tow_at(&mut w, [0.0, 2.0, 1000.0], seed);
        let mut t = 0.0;
        let mut fired = 0;
        let mut hits = 0;
        let mut first_fire = None;
        let mut min_bullet_miss = f64::INFINITY;
        let mut out = String::new();
        while t < 8.0 && !w.missiles.is_empty() {
            let o = w.step(1.0 / 60.0, &actors);
            fired += o.fired.len();
            if let Some(m) = w.missile(id) {
                for b in &w.bullets {
                    let d = dist(b.pos, m.pos);
                    if d < min_bullet_miss { min_bullet_miss = d; }
                }
                if !o.fired.is_empty() && first_fire.is_none() { first_fire = Some((t, dist(m.pos, [0.5,2.8,0.2]))); }
            }
            for e in &o.events {
                match e {
                    Event::BulletHit { .. } => hits += 1,
                    Event::FireStart{..} | Event::FireStop{..} | Event::Lock{..} | Event::Detect{..} | Event::Intercept{..} | Event::MissileHit{..} | Event::MissileDamaged{..} => out.push_str(&format!("  t={t:.2} {:?}\n", e)),
                    _ => {}
                }
            }
            t += 1.0 / 60.0;
        }
        let a = w.aps_of(1).unwrap();
        println!("seed {seed}: fired {fired} hits {hits} first_fire {first_fire:?} closest bullet {min_bullet_miss:.2} spin {:.2} mode {:?}\n{out}", a.spin, a.mode);
    }
}

#[test]
#[ignore]
fn debug_trace_rocket() {
    for seed in 1..=3u32 {
        let def = rocket(135.0);
        let did = def.id.clone();
        let mut w = world(vec![def]);
        w.add_aps(1, 0, ApsDef::oplot_mo(), seed);
        let from = [0.0, 1.6, 900.0];
        let el = rocket_elevation(&w.defs[&did], from, [0.0, 1.5, 0.0]);
        let id = w.launch(&did, 99, 1, from, dir_of(std::f64::consts::PI, el), seed).unwrap();
        let actors = [tank(1, 0, true, true), shooter(99)];
        let mut t: f64 = 0.0;
        while t < 12.0 && !w.missiles.is_empty() {
            let o = w.step(1.0 / 60.0, &actors);
            for e in &o.events { if !matches!(e, Event::BulletHit{..}) { println!("t={t:.2} {e:?}"); } }
            if (t * 60.0).round() as i64 % 60 == 0 { if let Some(m) = w.missile(id) { let a = w.aps_of(1).unwrap(); println!("  t={t:.1} pos {:?} tracks {} target {:?} mode {:?}", m.pos.map(|v| (v*10.0).round()/10.0), a.tracks.len(), a.target, a.mode); } }
            t += 1.0 / 60.0;
        }
    }
}

#[test]
#[ignore]
fn debug_two_sides() {
    for seed in 1..=4u32 {
        let mut w = world(vec![]);
        w.add_aps(1, 0, ApsDef::oplot_mo(), seed);
        let actors = [tank(1, 0, true, true), shooter(99)];
        let a = tow_at(&mut w, [0.0, 2.0, 900.0], seed);
        let mut t: f64 = 0.0;
        let mut b = 0;
        let mut fired = 0;
        while t < 12.0 {
            if (t - 2.0).abs() < 0.008 { b = tow_at(&mut w, [-700.0, 2.0, -500.0], seed + 100); }
            let o = w.step(1.0 / 60.0, &actors);
            fired += o.fired.len();
            for e in &o.events { if !matches!(e, Event::BulletHit{..} | Event::MissileDamaged{..}) { println!("t={t:.2} {e:?}"); } }
            t += 1.0 / 60.0;
            if t > 2.1 && w.missiles.is_empty() { break; }
        }
        println!("seed {seed} a={a} b={b} fired {fired} rounds left {}\n", w.aps_of(1).unwrap().rounds);
    }
}

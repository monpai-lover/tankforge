//! Exterior contact components from a trusted projectile. Native ground combat
//! still uses declared planes/anatomy, explicitly not registered-triangle parity.
//! Never relocate charges to guessed hull centers or crew stations.
use tg_combat::{Report, Shot, Target, TargetState};
#[cfg(test)]
use tg_shared::Vec3;
use tg_weapon::{ProjectileDef, ProjectileKind};

/// TNT equivalence (RE factor) of the filler types used by the projectile data: the RE table of
/// Wikipedia "TNT equivalent". Amatol (0.91-1.10 by ratio), explosive D (ammonium picrate, not
/// listed), A-IX-1 (96% RDX) and A-IX-2 (aluminised RDX, taken as hexal) are estimates.
pub fn re_factor(explosive_type: &str) -> f32 {
    tg_weapon::explosive_re_factor(explosive_type)
}

/// The filler as TNT (kg); zero for none or invalid data.
pub fn tnt_kg(shell: &ProjectileDef) -> f32 {
    shell.tnt_equivalent_kg()
}

fn merge(into: &mut Report, add: Report) {
    let was = into.caps.destroyed;
    into.state = add.state;
    into.caps = add.caps;
    into.crew.extend(add.crew);
    into.modules.extend(add.modules);
    into.events.extend(add.events);
    into.fragments.extend(add.fragments);
    into.bursts.extend(add.bursts);
    into.cause_transitions.extend(add.cause_transitions);
    into.geometry_contacts.extend(add.geometry_contacts);
    into.impact_events.extend(add.impact_events);
    into.hit |= add.hit;
    if into.caps.destroyed && !was {
        into.title = add.title;
    }
}

/// The hit report with the contact detonation's damage merged in (unchanged for other rounds).
pub fn contact(t: &Target, _before: &TargetState, shot: &Shot, mut r: Report) -> Report {
    // HEAT too: the core resolves the jet; the warhead's blast and casing fragments still act.
    if !matches!(shot.shell.kind, ProjectileKind::He | ProjectileKind::Hesh | ProjectileKind::Heat | ProjectileKind::HeatFs) || r.caps.destroyed {
        return r;
    }
    let Some(at) = r.impact else { return r };
    if !(shot.shell.explosive_mass_kg > 0.0) {
        return r;
    }
    let dir = shot.dir.normalized();
    let mut n = r.normal.unwrap_or(-dir);
    if n.dot(dir) > 0.0 {
        n = -n;
    }
    let query_at=at+n*0.001;
    let seed=(shot.seed^0x9e37_79b9).wrapping_add(1);
    let pressure_recorded=r.bursts.iter().any(|b|!b.inside&&b.explosive_kg>0.);
    let add=if pressure_recorded {
        tg_combat::near_burst::evaluate_casing(t,&r.state,query_at,&shot.shell,shot.turret_yaw,seed,None,None)
    }else{
        tg_combat::near_burst::evaluate(t,&r.state,query_at,&shot.shell,shot.turret_yaw,seed,None,None)
    };
    if let Ok(add)=add {merge(&mut r,add);}
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contact_keeps_one_recorded_primary_burst_and_adds_casing_without_synthetic_inner_blasts() {
        let data=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let catalog=crate::server::load_combat(&data);
        let target=&catalog.targets["de_tiger_e"];
        let projectile=&catalog.projectiles["he_122_of471"];
        let shot=side_hit(target,projectile,3);
        let before=target.fresh_state();
        let direct=tg_combat::shoot(target,&before,&shot);
        assert_eq!(direct.bursts.iter().filter(|b|!b.inside).count(),1,"fixture needs an actual recorded exterior primary burst");
        let report=contact(target,&before,&shot,direct);
        assert_eq!(report.bursts.iter().filter(|b|!b.inside).count(),1,"contact casing must not duplicate an existing primary blast");
        assert!(!report.bursts.iter().any(|b|b.inside),"stopped exterior contact cannot fabricate internal charges");
        assert!(report.fragments.iter().any(|f|serde_json::to_value(&f.provenance).unwrap()["source"]=="casing_fragment"),"contact preserves physical casing fragments");
    }

    fn side_hit(t: &Target, shell: &ProjectileDef, seed: u64) -> Shot {
        let at = Vec3::new(0.0, 1.0, 0.0);
        let origin = Vec3::new(t.hi.x + 20.0, 1.2, 0.3);
        Shot { shell: shell.clone(), origin, dir: (at - origin).normalized(), speed_ms: 600.0, distance_m: 300.0, seed, turret_yaw: 0.0 }
    }

    // Controlled declared-geometry fixture. These are game-model boundary
    // assertions, not a historical shell-versus-vehicle kill probability.
    fn screened_station(catalog: &crate::server::CombatData, mm: f32, backing: bool) -> Target {
        let mut def = catalog.targets["de_pz3_j"].def.clone();
        def.id = "native_contact_screen".into();
        def.surfaces = None;
        def.turret = None;
        def.modules.clear();
        def.weapons = serde_json::Value::Null;
        def.machine_guns = serde_json::Value::Null;
        def.open_top = false;
        def.crew.truncate(1);
        def.crew[0].pos = Vec3::new(0., 1., 0.);
        let mut wall = def.plates[0].clone();
        wall.id = "screen".into();
        wall.material = "rha".into();
        wall.thickness_mm = mm;
        wall.center = Vec3::new(-0.5, 1., 0.);
        wall.normal = Vec3::new(-1., 0., 0.);
        wall.axis_u = Vec3::new(0., 0., 1.);
        wall.half_u = 3.; wall.half_v = 3.;
        wall.polygon.clear(); wall.hinge = None; wall.curvature = 0.;
        def.plates = vec![wall.clone()];
        if backing {
            wall.id = "backing".into(); wall.center.x = -0.3; wall.thickness_mm = 250.;
            def.plates.push(wall);
        }
        Target::new(def, &[])
    }

    /// A stopped direct jet owns no imagined internal detonation. Its physical
    /// casing can cross thin armor, while each thick layer remains a barrier.
    #[test]
    fn contact_casing_defeats_thin_screen_without_bypassing_thick_or_backing_armor() {
        let data = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let c = crate::server::load_combat(&data);
        let mut shell = c.projectiles["he_420_tt250"].clone();
        shell.kind = ProjectileKind::HeatFs;
        shell.penetration_curve = vec![tg_weapon::CurvePoint { distance_m: 0., pen_mm: 0. }];
        for (mm, backing) in [(15., false), (250., false), (1., true)] {
            let t = screened_station(&c, mm, backing);
            let shot = Shot { shell: shell.clone(), origin: Vec3::new(-1.,1.,0.),
                dir: Vec3::new(1.,0.,0.), speed_ms: 600., distance_m: 0.,
                seed: 3 ^ 0x9e37_79b9, turret_yaw: 0. };
            let before = t.fresh_state();
            let direct = tg_combat::shoot(&t, &before, &shot);
            assert_eq!(direct.state.crew[0], 100., "zero-penetration direct control must not wound the station");
            assert!(direct.bursts.is_empty(), "direct jet must not invent an exterior primary burst");
            let at = direct.impact.expect("fixture contacts the actual screen");
            let report = contact(&t, &before, &shot, direct);
            assert_eq!(report.bursts.len(), 1, "one accepted contact has one exterior charge");
            assert!(!report.bursts[0].inside);
            assert!((report.bursts[0].pos-at).length() < 0.002, "the charge stays at the measured contact");
            assert!(!report.fragments.iter().any(|f| f.kind == "blast" && f.hit.as_deref() == Some("crew:0")), "sealed crew cannot receive invented gas ingress");
            if mm == 15. {
                assert!(report.state.crew[0] < 100., "large-charge casing must retain an actual thin-armor route");
                assert!(report.fragments.iter().any(|f| f.kind == "burst" && f.hit.as_deref() == Some("crew:0") && f.damage > 0.));
            } else {
                assert_eq!(report.state.crew[0], 100., "an intact thick layer must stop each physical fragment");
            }
        }
    }

    #[test]
    fn small_he_and_kinetic_rounds_are_unchanged() {
        let data = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let c = crate::server::load_combat(&data);
        let t = &c.targets["de_tiger_e"];
        for shell in ["apcbc_88_l56", "he_37_m63"] {
            let shot = side_hit(t, &c.projectiles[shell], 3);
            let r = tg_combat::shoot(t, &t.fresh_state(), &shot);
            let crew = r.caps.crew_alive;
            let r = contact(t, &t.fresh_state(), &shot, r);
            if shell.starts_with("ap") { assert_eq!(r.caps.crew_alive, crew); }
            assert!(!r.caps.destroyed || shell.starts_with("ap"), "{shell} destroyed a Tiger");
        }
        assert!((tnt_kg(&c.projectiles["he_88_sprgr"]) - c.projectiles["he_88_sprgr"].explosive_mass_kg * re_factor(&c.projectiles["he_88_sprgr"].explosive_type)).abs() < 1e-6);
    }
}

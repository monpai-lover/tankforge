//! Initiated external charge evaluation. Fragment sampling and primary air
//! pressure are separate; unknown compartment boundaries never imply ingress.
use super::*;

pub fn evaluate(
    t: &Target,
    st: &TargetState,
    at: Vec3,
    shell: &ProjectileDef,
    yaw: f32,
    seed: u64,
    context: Option<&causes::DamageContext>,
    scene: Option<&geometry::combat_scene::CombatScene>,
) -> Result<Report, String> {
    evaluate_response(t,st,at,shell,yaw,seed,context,scene,true)
}

/// A contact already recorded its primary blast. Emit its exterior casing once
/// without repeating primary injury; this never fabricates a shaped-charge jet.
pub fn evaluate_casing(t:&Target,st:&TargetState,at:Vec3,shell:&ProjectileDef,yaw:f32,seed:u64,
    context:Option<&causes::DamageContext>,scene:Option<&geometry::combat_scene::CombatScene>) -> Result<Report,String> {
    evaluate_response(t,st,at,shell,yaw,seed,context,scene,false)
}

fn evaluate_response(t:&Target,st:&TargetState,at:Vec3,shell:&ProjectileDef,yaw:f32,seed:u64,
    context:Option<&causes::DamageContext>,scene:Option<&geometry::combat_scene::CombatScene>,include_pressure:bool) -> Result<Report,String> {
    let kg = shell.explosive_mass_kg;
    if !kg.is_finite()
        || kg < 0.
        || !shell.mass_kg.is_finite()
        || shell.mass_kg < kg
        || !shell.caliber_mm.is_finite()
        || shell.caliber_mm <= 0.
        || !yaw.is_finite()
        || !at.to_array().iter().all(|v| v.is_finite())
        || context.is_some_and(|c| !c.valid())
    {
        return Err("invalid initiated near-burst input".into());
    }
    if scene.is_some_and(|s| !s.accepts(t)) {
        return Err("near-burst target/surface registration mismatch".into());
    }
    let mut w = Work {
        scene,
        context,
        t,
        p: t.posed(yaw),
        st: st.clone(),
        rng: Rng::new(seed.max(1)),
        explosive_re_factor: tg_weapon::explosive_re_factor(&shell.explosive_type),
        rep: Report {
            geometry_contacts: vec![],primary_geometry_contacts:vec![],primary_module_destructions:vec![],
            cause_transitions: vec![],
            hit: false,
            outcome: Outcome::Blast,
            shell_kind: shell.kind,
            caliber_mm: shell.caliber_mm,
            impact: Some(at),
            normal: None,
            plate: None,
            angle_deg: 0.,
            pen_mm: 0.,
            layers: vec![],
            path: vec![at],
            ricochet_dir: None,
            bursts: vec![],
            fragments: vec![],
            modules: vec![],
            crew: vec![],
            events: vec![],
            caps: caps(t, st),
            state: st.clone(),
            title: String::new(),
            turret_yaw: yaw,
            mechanism_revision: None,
            impact_events: vec![],
            impact_state: None,
        },
        mod_dmg: HashMap::new(),
        crew_dmg: HashMap::new(),
        newly_destroyed: vec![],
        newly_killed: vec![],
    };
    if kg == 0. {
        finish(&mut w);
        return Ok(w.rep);
    }
    if !matches!(
        shell.kind,
        ProjectileKind::He | ProjectileKind::Aphe | ProjectileKind::Hesh | ProjectileKind::Heat | ProjectileKind::HeatFs
    ) {
        w.rep
            .events
            .push("near_burst_charge_model_unavailable".into());
        finish(&mut w);
        return Ok(w.rep);
    }
    if let Some(s) = scene {
        s.reset_error();
    }
    w.rep.events.extend([
        "near_burst_fragment_sample_v1".into(),
        "unknown_pressure_boundary".into(),
        "uncalibrated_fragment_penetration_v1".into(),
    ]);
    let equivalent_kg = shell.tnt_equivalent_kg();
    let radius = outside_radius_m(equivalent_kg);
    if include_pressure {w.rep.bursts.push(Burst {time_s:None,armed_at_s:None,delay_s:None,detonation_id:None,mechanism:None,
        pos: at,
        radius,
        inside: false,
        explosive_kg: kg,
    });}
    // Primary direct exposure and casing are independent. A registered scene
    // owns each physical visibility contact; native legacy calls retain a named
    // declared-plane fallback, never a guessed whole-compartment pressure.
    if include_pressure {w.external_exposure(at, equivalent_kg, radius);}
    else {w.rep.events.push("primary_blast_already_recorded".into());}
    let casing = (shell.mass_kg - kg) as f64;
    if casing > 0. {
        // Explicit estimated mass bins, not casing mass divided by ray budget.
        // A weight represents number of physical pieces. It affects expected
        // health damage only; all penetration/work/drag uses ONE actual piece.
        let scale = ((shell.caliber_mm as f64 / 420.).powi(2)).clamp(0.02, 1.);
        let velocity =
            (2400. * ((equivalent_kg as f64 / casing) / (1. + 0.5 * equivalent_kg as f64 / casing)).sqrt()) as f32;
        let phase = w.rng.next_f32() * std::f32::consts::TAU;
        let source = context.map_or_else(
            || format!("near:{}:{seed}", shell.id),
            |c| c.event_id.clone(),
        );
        let range = (12. + 8. * equivalent_kg.cbrt()).min(60.);
        let (center, bound) = scene
            .and_then(|s| s.sampling_ball())
            .unwrap_or(((t.lo + t.hi) * 0.5, (t.hi - t.lo).length() * 0.5));
        let delta = center - at;
        let distance = delta.length();
        let axis = if distance > 0. {
            delta * (1. / distance)
        } else {
            Vec3::new(0., 1., 0.)
        };
        let u = axis.any_perpendicular();
        let v = axis.cross(u);
        let cone_cos = if distance > bound {
            (1. - (bound / distance).powi(2)).max(0.).sqrt()
        } else {
            -1.
        };
        let angular_share = (1. - cone_cos) as f64 * 0.5;
        w.rep
            .events
            .push("target_solid_angle_fragment_quadrature_v1".into());
        // Small HE autocannons retain all four physical mass bins and the same
        // registered triangle traversal. Only the representative quadrature is
        // bounded: numerical multiplicity changes weight, never one piece's
        // mass, energy, area or drag. Other explosive families keep 128 rays.
        let samples_per_bin = if shell.caliber_mm <= 40.
            && matches!(shell.kind, ProjectileKind::He) { 4usize } else { 32 };
        if samples_per_bin == 4 {
            w.rep.events.push("small_he_fragment_quadrature_16_v1".into());
        }
        let mut serial = 0;
        for (mass, share, n) in [
            (0.002, 0.20, samples_per_bin),
            (0.01, 0.45, samples_per_bin),
            (0.05, 0.30, samples_per_bin),
            (0.2, 0.05, samples_per_bin),
        ] {
            let mass: f64 = (mass * scale).min(casing * share);
            let weight = casing * share * angular_share / (mass * n as f64);
            for k in 0..n {
                let y = 1. - (1. - cone_cos) * (k as f32 + w.rng.next_f32()) / n as f32;
                let a = phase + serial as f32 * 2.3999631;
                let r = (1. - y * y).sqrt();
                let dir = (axis * y + u * (r * a.cos()) + v * (r * a.sin())).normalized();
                let physical = impact::PhysicalFragment {
                    mass_kg: mass,
                    energy_j: 0.5 * mass * (velocity as f64).powi(2),
                    area_m2: Some(
                        std::f64::consts::PI
                            * (3. * mass / (4. * std::f64::consts::PI * 7850.))
                                .cbrt()
                                .powi(2),
                    ),
                    velocity_m_s: dir * velocity,
                };
                let provenance = FragmentProvenance {
                    fragment_id: format!("{source}/casing:{serial}"),
                    parent_event_id: source.clone(),
                    source: impact::FragmentSource::CasingFragment,
                    source_layer_or_module: None,
                    physical: Some(physical.clone()),
                    weight,
                    start_s: Some(0.),
                    profile: Some(impact::ProfileReference {
                        id: "estimated_casing_bins_v1".into(),
                        revision: "near_burst_fragment_v1".into(),
                        source: impact::ProfileSource::Estimated,
                    }),
                };
                w.external_fragment(at, dir, physical, provenance, range);
                serial += 1;
            }
        }
    }
    if let Some(s) = scene {
        if let Some(error) = s.take_error() {
            return Err(error);
        }
    }
    w.rep.hit = !w.mod_dmg.is_empty() || !w.crew_dmg.is_empty();
    finish(&mut w);
    Ok(w.rep)
}

impl Work<'_> {
    pub(super) fn external_exposure(&mut self, at: Vec3, kg: f32, radius: f32) {
        let rows: Vec<_> = if let Some(scene) = self.scene {
            self.rep.events.push("registered_surface_direct_pressure_v1".into());
            match scene.exposed_anatomy(at, radius * 1.4) {
                Ok(rows) => rows
                    .into_iter()
                    .filter_map(|(kind, distance, c)| match kind {
                        EvKind::Module(i) if self.t.def.modules[i].is_external() && !empty_rack(self.t, &self.st, i) => Some((
                            kind,
                            distance,
                            Vec3::new(c.point[0] as f32, c.point[1] as f32, c.point[2] as f32),
                            Some(c),
                        )),
                        EvKind::Crew(_) => Some((kind,distance,
                            Vec3::new(c.point[0] as f32,c.point[1] as f32,c.point[2] as f32),Some(c))),
                        _ => None,
                    })
                    .collect(),
                Err(_) => return,
            }
        } else {
            let mut rows:Vec<_> = self.p
                .boxes
                .iter()
                .enumerate()
                .filter_map(|(i, b)| {
                    if !self.t.def.modules[i].is_external() || empty_rack(self.t, &self.st, i) {
                        return None;
                    }
                    let distance = b.distance(at);
                    if distance >= radius {
                        return None;
                    }
                    let delta = b.center - at;
                    let length = delta.length();
                    if length <= 0. {
                        return Some((EvKind::Module(i), distance, b.center, None));
                    }
                    if self
                        .events(at, delta * (1. / length), length, true)
                        .iter()
                        .any(|e| {
                            matches!(e.kind, EvKind::Plate(_) | EvKind::Unknown) && e.t < length
                        })
                    {
                        return None;
                    }
                    Some((EvKind::Module(i), distance, b.center, None))
                })
                .collect();
            // No registered compartment scene exists in this native path.
            // open_top admits candidates only; every station still needs an
            // unobstructed ray through the currently posed declared geometry.
            if self.t.def.open_top {
                self.rep.events.push("legacy_declared_plane_pressure_v1".into());
                for (i,&center) in self.p.crew.iter().enumerate() {
                    let delta=center-at;let distance=delta.length();
                    if distance>=radius*1.4 {continue;}
                    let exposed=distance<=0. || self.events(at,delta*(1./distance),distance*1.001,true)
                        .into_iter().find(|e|!matches!(e.kind,EvKind::Decoration))
                        .is_some_and(|e|e.kind==EvKind::Crew(i));
                    if exposed {rows.push((EvKind::Crew(i),distance,center,None));}
                }
            }
            rows
        };
        for (kind, distance, to, contact) in rows {
            let reach=if matches!(kind,EvKind::Crew(_)){radius*1.4}else{radius};
            if distance >= reach {
                continue;
            }
            let power=if matches!(kind,EvKind::Crew(_)){120.}else{140.};
            let requested = power * (kg / 0.7).powf(0.35) * (1. - (distance / reach).powi(2));
            let (damage,hit)=match kind {
                EvKind::Module(i)=>(self.hurt_module(i,requested,0.),self.t.def.modules[i].id.clone()),
                EvKind::Crew(i)=>(self.hurt_crew(i,requested),format!("crew:{i}")),
                _=>continue,
            };
            if let Some(c) = contact {
                self.record_contact(&Ev {
                    t: distance,
                    kind,
                    contact: Some(c),
                    paired_contact: None, surface_transit: None,
                });
            }
            self.rep.fragments.push(Frag {
                from: at,
                to,
                hit: Some(hit),
                damage,
                kind: "blast".into(),
                provenance: Default::default(),
                budget: None,
            });
        }
    }
    fn external_fragment(
        &mut self,
        at: Vec3,
        dir: Vec3,
        physical: impact::PhysicalFragment,
        provenance: FragmentProvenance,
        range: f32,
    ) {
        if self.rep.fragments.len() >= 255 {
            if !self
                .rep
                .events
                .iter()
                .any(|e| e == "fragment_sample_capacity")
            {
                self.rep.events.push("fragment_sample_capacity".into());
            }
            return;
        }
        let profile = provenance.profile.as_ref().unwrap();
        let Ok(mut state) = impact::fragment_state(
            &physical,
            frag_pen(physical.energy_j as f32) as f64,
            &provenance.fragment_id,
            profile,
        ) else {
            return;
        };
        let mut last_t = 0.;
        let mut from = at;
        let mut recorded = false;
        let drag = 1.225 * 0.8 * physical.area_m2.unwrap_or(0.) / physical.mass_kg;
        for ev in self.events(at, dir, range, true) {
            if ev.t < last_t {continue;}
            if state.energy_j() < 50. || self.rep.fragments.len() >= 240 {
                break;
            }
            let distance = (ev.t - last_t).max(0.);
            let entry = state.current.clone();
            state.advance_time(distance as f64);
            last_t = ev.t;
            let energy = state.energy_j();
            let retained = energy * (-drag * distance as f64).exp();
            if state.set_energy_j(retained).is_err() {
                break;
            }
            state.remaining_pen_mm *= if energy > 0. {
                (retained / energy).sqrt()
            } else {
                0.
            };
            let point = at + dir * ev.t;
            let mut next_from = point;
            let mut hit = None;
            let mut damage = 0.;
            let mut budget = None;
            self.record_contact(&ev);
            if ev.surface_transit.is_some_and(|t|t.is_exit) {continue;}
            match ev.kind {
                EvKind::Plate(i) => {
                    let plate = &self.p.plates[i];
                    let normal = ev
                        .contact
                        .as_ref()
                        .map(|c| {
                            Vec3::new(
                                c.geometric_normal[0] as f32,
                                c.geometric_normal[1] as f32,
                                c.geometric_normal[2] as f32,
                            )
                        })
                        .unwrap_or(plate.normal);
                    let cosine = dir.dot(normal).abs().max(0.001);
                    let required = plate.thickness_mm as f64 / cosine as f64
                        * self.t.material(&plate.material).kinetic_factor as f64;
                    let passed = state.remaining_pen_mm > required;
                    let exit = ev
                        .paired_contact
                        .as_ref()
                        .map(|c| Vec3::new(c.point[0] as f32, c.point[1] as f32, c.point[2] as f32))
                        .unwrap_or(point);
                    let Ok(tr) = impact::advance_kinetic_layer(
                        &mut state,
                        &impact::DeclaredLayerContact {
                            layer_id: format!("plate:{}", plate.id),
                            traversal_id: ev.surface_transit.map_or(0,|t|t.id),
                            cumulative_required_mm: required,
                            cumulative_path_m: (exit - point).length() as f64,
                            thickness_mm: plate.thickness_mm as f64,
                            density_kg_m3: self.t.material(&plate.material).density_kg_m3 as f64,
                            verdict: if passed {
                                impact::ImpactVerdict::Passed
                            } else {
                                impact::ImpactVerdict::Stopped
                            },
                            emit_spall: false,
                        },
                    ) else {
                        break;
                    };
                    budget = Some(tr.budget);
                    if self.rep.impact_events.len() < 64 {
                        self.rep.impact_events.push(impact_report::event(
                            tr,
                            point,
                            if passed { exit } else { point },
                            normal,
                        ));
                    }
                    if passed {
                        last_t = ev.t + (exit - point).length();
                        next_from = exit;
                    }
                    state.traversal = None;
                }
                EvKind::Module(i) | EvKind::Crew(i) => {
                    let (absorb, id) = match ev.kind {
                        EvKind::Module(_) => (
                            absorb_mm(self.t.def.modules[i].kind),
                            self.t.def.modules[i].id.clone(),
                        ),
                        _ => (CREW_ABSORB_MM, format!("crew:{i}")),
                    };
                    let Ok(tr) = impact::deposit_fragment_contact_energy(
                        &mut state,
                        absorb as f64,
                        &format!("{}/contact:{id}", provenance.fragment_id),
                    ) else {
                        break;
                    };
                    // Numerical multiplicity is never included in resistance.
                    let deposited = tr.budget.target_deposition_j as f32;
                    damage = match ev.kind {
                        EvKind::Module(_) => self.hurt_module(
                            i,
                            module_damage(deposited) * provenance.weight as f32,
                            0.5,
                        ),
                        _ => self.hurt_crew(i, crew_damage(deposited) * provenance.weight as f32),
                    };
                    hit = Some(id);
                    budget = Some(tr.budget);
                    if self.rep.impact_events.len() < 64 {
                        self.rep.impact_events.push(impact_report::event(
                            tr,
                            point,
                            point,
                            Vec3::ZERO,
                        ));
                    }
                }
                EvKind::Unknown => {
                    let _ = state.set_energy_j(0.);
                }
                EvKind::Decoration => continue,
            }
            if let Some(b) = budget.as_mut() {
                b.unresolved_loss_j += entry.energy_j() - b.input_j;
                b.input_j = entry.energy_j();
            }
            self.rep.fragments.push(Frag {
                from,
                to: point,
                hit,
                damage,
                kind: "burst".into(),
                provenance: impact_report::segment_provenance(&provenance, &entry),
                budget,
            });
            recorded = true;
            from = next_from;
        }
        if !recorded || state.energy_j() > 50. {
            let entry = state.current.clone();
            let distance = (range - last_t).max(0.);
            let to = if state.energy_j() > 50. {
                at + dir * range
            } else {
                from
            };
            let _ = distance;
            self.rep.fragments.push(Frag {
                from,
                to,
                hit: None,
                damage: 0.,
                kind: "burst".into(),
                provenance: impact_report::segment_provenance(&provenance, &entry),
                budget: None,
            });
        }
    }
}

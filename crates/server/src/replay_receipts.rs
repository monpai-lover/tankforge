//! The single core mutation/death/scoring/recipient owner for incoming damage.
use super::*;
use serde_json::json;
use tg_combat::causes::DamageContext;
use tg_combat::replay_evidence::*;

#[derive(Clone, Debug, Default)]
pub(super) struct ReplayHistory {
    pub version: u64,
    pub recent: VecDeque<ReplayEvidence>,
    pub pinned: Option<ReplayEvidence>,
    pub fatal: Option<ReplayEvidence>,
    pub identities: VecDeque<(u64, String)>,
    pub death_event_id: Option<String>,
    pub cause_event_id: Option<String>,
    pub unavailable: Option<String>,
}
pub(super) enum Mutation {
    Shot {
        attacker: u32,
        shot: tg_combat::Shot,
        discharge: Option<ReplayDischarge>,
        mg: bool,
    },
    Burst {
        attacker: u32,
        at: Vec3,
        shell: tg_weapon::ProjectileDef,
        yaw: f32,
        seed: u64,
    },
    Advance {
        dt: f64,
        seed: u64,
    },
    Repair {
        repair: bool,
    },
    Ammo {
        carried: u32,
    },
}
pub(super) fn public_state(st: &CombatState) -> Value {
    let mut v = serde_json::to_value(st).unwrap_or(Value::Null);
    if let Some(o) = v.as_object_mut() {
        o.remove("fire_at");
        o.remove("active_fire_cause");
    }
    v
}
impl Lobby {
    pub(super) fn checkpoint(&self, id: u32) -> Option<Value> {
        let p = self.players.get(&id)?;
        let actor = super::shot_flight::actor(p)?;
        let st = p.combat.as_ref()?;
        let first = p.replay.identities.front().map_or(1, |i| i.0);
        let mut incoming: Vec<ReplayEvidence> = p
            .replay
            .recent
            .iter()
            .filter(|e| self.now - e.impact_time_s <= 6.0)
            .cloned()
            .collect();
        for retained in [p.replay.pinned.as_ref(), p.replay.fatal.as_ref()]
            .into_iter()
            .flatten()
        {
            if let Some(i) = incoming
                .iter()
                .position(|e| e.event_id == retained.event_id)
            {
                incoming[i] = retained.clone();
            } else {
                incoming.push(retained.clone());
            }
        }
        serde_json::to_value(ReplayCheckpoint {
            replay_unavailable: p.replay.unavailable.clone(),
            actor,
            baseline_commit: first - 1,
            covered_through: p.replay.version,
            state_version: p.replay.version,
            state: serde_json::to_value(st).ok()?,
            canonical_identity_binding: p.replay.identities.iter().cloned().collect(),
            active_causes: st.active_fire_cause.iter().cloned().collect(),
            cause_event_id: p.replay.cause_event_id.clone().or_else(|| {
                st.active_fire_cause
                    .as_ref()
                    .map(|c| c.source_event_id.clone())
            }),
            death_event_id: p.replay.death_event_id.clone(),
            replay_available: p.replay.pinned.is_some() || p.replay.fatal.is_some(),
            incoming,
        })
        .ok()
    }
    pub(super) fn commit_damage(
        &mut self,
        room: u32,
        target: u32,
        mutation: Mutation,
        now: f64,
    ) -> Out {
        let Some(p) = self.players.get(&target) else {
            return Vec::new();
        };
        let Some(actor) = super::shot_flight::actor(p) else {
            return Vec::new();
        };
        let vehicle = p.vehicle.clone();
        let Some(t) = self.targets.get(&vehicle) else {
            return Vec::new();
        };
        let fold = p
            .state
            .as_ref()
            .map(crate::missiles::fold_of)
            .unwrap_or(0.0);
        let folded = if fold > 0.0 && t.has_hinges() {
            Some(t.folded(fold))
        } else {
            None
        };
        let t = folded.as_ref().unwrap_or(t);
        let before = p.combat.clone().unwrap_or_else(|| t.fresh_state());
        let version = p.replay.version;
        let pose = super::shot_flight::pose(p);
        let previous_cause = before.active_fire_cause.clone();
        if version >= tg_combat::replay_evidence::MAX_SAFE_COUNTER
            || self.replay_event_serial >= tg_combat::replay_evidence::MAX_SAFE_COUNTER
        {
            return Self::err(target, "Replay combat version exhausted");
        }
        self.replay_event_serial += 1;
        let event_id = format!("{}:{}", actor.battle, self.replay_event_serial);
        let commit = version + 1;
        let (state, caps, report, events, transitions, source, attacker, dt, owner_only) =
            match mutation {
                Mutation::Shot {
                    attacker,
                    shot,
                    discharge,
                    mg,
                } => {
                    let context = discharge.as_ref().map(|d| DamageContext {
                        actor: actor.clone(),
                        event_id: event_id.clone(),
                        shot_id: d.shot_id.clone(),
                        shooter: d.shooter.clone(),
                        pose_revision: 0,
                        geometry_revision: 0,
                    });
                    let r = match context.as_ref() {
                        Some(c) => tg_combat::shoot_context(t, &before, &shot, c),
                        None => tg_combat::shoot(t, &before, &shot),
                    };
                    let r = crate::he_effects::contact(t, &before, &shot, r);
                    if mg && r.modules.is_empty() && r.crew.is_empty() && !r.caps.destroyed {
                        if matches!(r.outcome, tg_combat::Outcome::Miss) {
                            return Vec::new();
                        }
                        let from = attacker;
                        return vec![(from,ServerMsg::Damage{target,from,result:serde_json::to_value(r.outcome).unwrap().as_str().unwrap().into(),plate:r.plate.clone(),hp:p.hp,killed:false,report:serde_json::to_value(&r).ok(),replay:None,replay_unavailable:Some("no_state_commit".into()),hit_feedback:discharge.as_ref().map(|d|json!({"event_id":event_id,"shot_id":d.shot_id,"weapon_instance":d.weapon_instance,"projectile_id":d.projectile_id})),owner_commit:None})];
                    }
                    (
                        r.state.clone(),
                        r.caps.clone(),
                        Some(r.clone()),
                        r.events.clone(),
                        r.cause_transitions.clone(),
                        discharge,
                        Some(attacker),
                        0.0,
                        false,
                    )
                }
                Mutation::Burst {
                    attacker,
                    at,
                    shell,
                    yaw,
                    seed,
                } => {
                    // a shell bursting nearby (ground, building): blast and fragments only, no replay film
                    let Ok(r) = tg_combat::near_burst::evaluate(t, &before, at, &shell, yaw, seed, None, None) else {return Vec::new();};
                    if r.modules.is_empty() && r.crew.is_empty() && !r.caps.destroyed {
                        return Vec::new();
                    }
                    (
                        r.state.clone(),
                        r.caps.clone(),
                        Some(r.clone()),
                        r.events.clone(),
                        r.cause_transitions.clone(),
                        None,
                        Some(attacker),
                        0.0,
                        false,
                    )
                }
                Mutation::Advance { dt, seed } => {
                    let mut state = before.clone();
                    let result =
                        tg_combat::advance_context(t, &mut state, dt as f32, seed, &event_id);
                    let caps = tg_combat::caps(t, &state);
                    (
                        state,
                        caps,
                        None,
                        result.events,
                        result.transitions,
                        None,
                        None,
                        dt,
                        false,
                    )
                }
                Mutation::Repair { repair } => {
                    if !p.alive {
                        return Vec::new();
                    }
                    let mut state = before.clone();
                    let ok = if repair {
                        tg_combat::start_repair(t, &mut state)
                    } else {
                        tg_combat::extinguish(&mut state)
                    };
                    if !ok {
                        return Self::err(
                            target,
                            if repair {
                                "沒有需要修理的模組"
                            } else {
                                "沒有起火或滅火器已用完"
                            },
                        );
                    }
                    let caps = tg_combat::caps(t, &state);
                    (
                        state,
                        caps,
                        None,
                        vec![if repair {
                            "repair_started"
                        } else {
                            "extinguished"
                        }
                        .into()],
                        Vec::new(),
                        None,
                        None,
                        0.0,
                        false,
                    )
                }
                Mutation::Ammo { carried } => {
                    let mut state = before.clone();
                    tg_combat::load_ammo(t, &mut state, carried);
                    if state.modules == before.modules && state.rack_fill == before.rack_fill {
                        return Vec::new();
                    }
                    let caps = tg_combat::caps(t, &state);
                    (
                        state,
                        caps,
                        None,
                        Vec::new(),
                        Vec::new(),
                        None,
                        None,
                        0.0,
                        true,
                    )
                }
            };
        let killed = state.destroyed && !before.destroyed && p.alive;
        let hp = if caps.destroyed {
            0.0
        } else if caps.crew_total > 0 {
            FULL_HP * caps.crew_alive as f64 / caps.crew_total as f64
        } else {
            FULL_HP
        };
        let before_value = serde_json::to_value(&before).unwrap();
        let after_value = serde_json::to_value(&state).unwrap();
        let mut evidence = match (source.as_ref(), report.as_ref(), pose.as_ref()) {
            (Some(d), Some(r), Some(pose)) => Some(ReplayEvidence {
                authority: "online".into(),
                flight_compacted_count: d.flight_compacted_count,
                segment_compacted_count: d.segment_compacted_count,
                travelled_distance_m: d.travelled_distance_m,
                mechanism_compaction: None,
                revision: 1,
                actor: actor.clone(),
                shooter: d.shooter.clone(),
                event_id: event_id.clone(),
                commit_seq: commit,
                shot_id: d.shot_id.clone(),
                parent_mechanism_id: None,
                weapon_instance: d.weapon_instance.clone(),
                projectile_id: d.projectile_id.clone(),
                seed: d.seed.clone(),
                build_hash: "legacy:unverified_build".into(),
                anatomy_hash: "legacy:unverified_anatomy".into(),
                pose_revision: 0,
                geometry_revision: 0,
                state_before_version: version,
                state_after_version: commit,
                state_before: before_value.clone(),
                launch_time_s: d.launch_time_s,
                impact_time_s: now,
                coordinates: "target_hull_metres".into(),
                accepted_pose: pose.clone(),
                flight: d.flight.clone(),
                segments: d.segments.clone(),
                flight_trust: d.flight_trust.clone(),
                report: serde_json::to_value(r).unwrap(),
                deaths: Vec::new(),
                mechanism_records: Vec::new(),
                capabilities: vec![
                    "legacy_receipt_pose".into(),
                    "exact_geometry_audit_pending".into(),
                    d.flight_trust.clone(),
                ],
            }),
            _ => None,
        };
        let delayed = report.is_none();
        if delayed {
            evidence = self.players[&target].replay.pinned.clone();
        }
        let cause = if delayed {
            previous_cause.as_ref().map(|c| {
                (
                    c.source_event_id.clone(),
                    c.mechanism_id.clone(),
                    c.shooter.entity,
                )
            })
        } else {
            source.as_ref().map(|d| {
                (
                    event_id.clone(),
                    format!(
                        "{event_id}:{}",
                        if state.ammo_detonated {
                            "ammo"
                        } else {
                            "direct"
                        }
                    ),
                    d.shooter.entity,
                )
            })
        };
        // Gameplay knows the immediate caller even when no causal replay was admitted.
        // Timed deaths still resolve only the typed active cause, never latest attacker.
        let from = attacker.unwrap_or_else(|| {
            if killed {
                cause.as_ref().map_or(target, |c| c.2)
            } else {
                target
            }
        });
        let timed = if delayed {
            Some(MechanismRecord {
                event_id: event_id.clone(),
                commit_seq: commit,
                time_s: now,
                dt_s: dt,
                state_before_version: version,
                state_after_version: commit,
                state_before: before_value.clone(),
                state_after: after_value.clone(),
                events: events.clone(),
                transitions: transitions.clone(),
            })
        } else {
            None
        };
        if let Some(e) = evidence.as_mut() {
            if let Some(record) = timed.as_ref() {
                e.mechanism_records.push(record.clone());
                if e.mechanism_records.len() > 16 {
                    let old = e.mechanism_records.remove(0);
                    let count = e.mechanism_compaction.as_ref().map_or(1, |c| c.count + 1);
                    e.mechanism_compaction = Some(MechanismCompaction {
                        count,
                        covered_through: old.commit_seq,
                        state_version: old.state_after_version,
                        state: old.state_after,
                    });
                    if !e
                        .capabilities
                        .iter()
                        .any(|c| c == "mechanism_prefix_compacted")
                    {
                        e.capabilities.push("mechanism_prefix_compacted".into());
                    }
                }
            }
            if killed {
                if let Some((cause_event_id, mechanism_id, _)) = cause.as_ref() {
                    e.deaths.push(ReplayDeath {
                        event_id: event_id.clone(),
                        commit_seq: commit,
                        time_s: now,
                        mechanism_id: mechanism_id.clone(),
                        cause_event_id: cause_event_id.clone(),
                        reason: if state.ammo_detonated {
                            "ammo_detonation"
                        } else if delayed {
                            "fire"
                        } else {
                            "direct"
                        }
                        .into(),
                        state_before_version: version,
                        state_after_version: commit,
                        state_after: after_value.clone(),
                        caps_after: serde_json::to_value(&caps).unwrap(),
                        accepted_terminal_pose: pose.clone(),
                    });
                }
            }
        }
        let unavailable = if evidence.as_ref().is_some_and(|e| e.validate().is_err()) {
            evidence = None;
            Some("invalid_or_over_limit_evidence".into())
        } else if evidence.is_none() {
            Some(
                if delayed {
                    "missing_mechanism_source"
                } else {
                    "unadmitted_or_missing_pose"
                }
                .into(),
            )
        } else {
            None
        };
        {
            let p = self.players.get_mut(&target).unwrap();
            p.combat = Some(state.clone());
            p.hp = hp;
            p.replay.version = commit;
            p.replay.identities.push_back((commit, event_id.clone()));
            if p.replay.identities.len() > 64 {
                p.replay.identities.pop_front();
            }
            if !delayed {
                if let Some(e) = evidence.as_ref() {
                    p.replay.recent.push_back(e.clone());
                }
                while p.replay.recent.len() > 64
                    || p.replay
                        .recent
                        .front()
                        .is_some_and(|e| now - e.impact_time_s > 6.0)
                {
                    p.replay.recent.pop_front();
                }
            }
            if state
                .active_fire_cause
                .as_ref()
                .is_some_and(|c| c.source_event_id == event_id)
            {
                p.replay.pinned = evidence.clone();
            }
            if delayed && !killed && state.active_fire_cause.is_some() {
                p.replay.pinned = evidence.clone();
            }
            if state.active_fire_cause.is_none() {
                p.replay.pinned = None;
            }
            if killed {
                p.alive = false;
                p.died_at = now;
                p.replay.fatal = evidence.clone();
                p.replay.death_event_id = Some(event_id.clone());
                p.replay.cause_event_id = cause.as_ref().map(|c| c.0.clone());
                p.replay.unavailable = unavailable.clone();
            }
        }
        if killed {
            self.count_death(target);
            if from != target {
                if let Some(p) = self.players.get_mut(&from) {
                    p.kills += 1;
                    p.sp += super::KILL_SP;
                }
            }
        }
        let result = report
            .as_ref()
            .map(|r| {
                serde_json::to_value(r.outcome)
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .unwrap_or_else(|| "fire".into());
        let plate = report.as_ref().and_then(|r| r.plate.clone());
        let mut out = Vec::new();
        if delayed {
            for &to in &self.rooms[&room].members {
                if owner_only && to != target {
                    continue;
                }
                out.push((
                    to,
                    ServerMsg::Status {
                        id: target,
                        state: if to == target {
                            after_value.clone()
                        } else {
                            public_state(&state)
                        },
                        caps: serde_json::to_value(&caps).unwrap(),
                        events: events.clone(),
                        ammo_scope: None,
                        ammo_revision: None,
                        replay_commit: if to == target {
                            timed.as_ref().map(|r| json!({"actor":actor,"record":r}))
                        } else {
                            None
                        },
                        replay_checkpoint: None,
                    },
                ));
            }
        }
        let owner_record = MechanismRecord {
            event_id: event_id.clone(),
            commit_seq: commit,
            time_s: now,
            dt_s: dt,
            state_before_version: version,
            state_after_version: commit,
            state_before: before_value,
            state_after: after_value.clone(),
            events: events.clone(),
            transitions: transitions.clone(),
        };
        if !delayed || killed {
            for &to in &self.rooms[&room].members {
                let authorized = to == target || to == from;
                out.push((to,ServerMsg::Damage{target,from,result:result.clone(),plate:plate.clone(),hp,killed,report:if authorized{report.as_ref().and_then(|r|serde_json::to_value(r).ok())}else{None},replay:if to==target{evidence.as_ref().and_then(|e|serde_json::to_value(e).ok())}else{None},replay_unavailable:if to==target{unavailable.clone()}else{None},hit_feedback:if to==from{source.as_ref().map(|d|json!({"event_id":event_id,"shot_id":d.shot_id,"weapon_instance":d.weapon_instance,"projectile_id":d.projectile_id}))}else{None},owner_commit:if to==target{Some(json!({"actor":actor,"record":owner_record,"caps_after":caps,"death_event_id":if killed{Some(event_id.clone())}else{None},"cause_event_id":if killed{cause.as_ref().map(|c|c.0.clone())}else{None}}))}else{None}}));
            }
        }
        if killed {
            out.extend(self.room_changed(room));
        }
        out
    }
}

//! Missiles, rockets and the guns that shoot them down, stepped together.
//!
//! A missile flies its motor's speed schedule, is steered onto the gunner's line of sight
//! (SACLOS) or not at all, and falls when nothing holds it up. An active protection system
//! (APS) looks with a radar that sees only what is in range, above the ground and inside its
//! elevation band, gets noisy measurements, builds tracks from them, picks the track that will
//! pass closest soonest, lays its gun with the lead its bullet needs, and fires real bullets:
//! each one flies and is tested against each missile's body as two moving segments, so a hit is
//! a hit and a miss is a miss. A missile that is hit may have its warhead set off, lose its wire,
//! controls or motor, or break up. Nothing is ever removed by a dice roll alone.
use crate::def::{ApsDef, Guidance, MissileDef};
use crate::terrain::HeightGrid;
use crate::v::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Longest internal step (s): bullets cross ~8 m of sky per step at this rate.
pub const MAX_STEP: f64 = 1.0 / 120.0;
const AIR_RHO: f64 = 1.225;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MStatus {
    Flying,
    /// Struck a vehicle (found here, or reported by the shooter).
    Struck,
    /// Hit the ground.
    Ground,
    /// Its warhead was set off in the air by gunfire.
    Intercepted,
    /// Gunfire broke it up.
    Broken,
    /// Out of range and out of time.
    Spent,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Missile {
    pub id: u32,
    pub def: String,
    pub owner: u32,
    pub team: u8,
    pub pos: V3,
    pub vel: V3,
    pub speed: f64,
    pub t: f64,
    pub travelled: f64,
    pub hp: f64,
    pub guided: bool,
    pub motor: bool,
    /// Gravity acts (no lift: a rocket, or a missile whose controls are gone).
    pub falls: bool,
    /// Yaw / pitch drift (rad/s) from damage.
    pub wobble: [f64; 2],
    /// The command line: the launcher's sight and the point it is laid on.
    pub sight: Option<V3>,
    pub aim: Option<V3>,
    pub steer: V3,
    pub status: MStatus,
    pub hits_taken: u32,
    /// The protection system whose bullets took its controls or motor (credited if it then falls short).
    #[serde(default)]
    pub crippled_by: Option<u32>,
    pub rng: Rng,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Bullet {
    pub aps: u32,
    pub team: u8,
    pub pos: V3,
    pub vel: V3,
    pub age: f64,
    pub tracer: bool,
}

/// An oriented box (a vehicle as missiles see it).
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Obb {
    pub center: V3,
    /// Unit axes x (right), y (up), z (forward).
    pub axes: [V3; 3],
    pub half: V3,
}

/// A vehicle in the world this step.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Actor {
    pub id: u32,
    pub team: u8,
    pub alive: bool,
    /// Middle of the vehicle and its velocity (for the threat test and the bullets' start).
    pub center: V3,
    #[serde(default)]
    pub vel: V3,
    /// Its box, when the world should find missile hits on it itself (the server).
    #[serde(default)]
    pub obb: Option<Obb>,
    /// The APS gun's pivot (world) and the bearing of the frame it traverses in (the turret it
    /// stands on); the gun and the radar each still working; switched on.
    #[serde(default)]
    pub aps_pivot: Option<V3>,
    #[serde(default)]
    pub aps_base_yaw: f64,
    #[serde(default = "yes")]
    pub aps_gun_ok: bool,
    #[serde(default = "yes")]
    pub aps_radar_ok: bool,
}

fn yes() -> bool {
    true
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApsMode {
    Off,
    Search,
    Track,
    Engage,
    Overheat,
    Empty,
    Fault,
    Dead,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Track {
    pub missile: u32,
    pub pos: V3,
    pub vel: V3,
    pub seen: f64,
    pub hits: u32,
    pub firm: bool,
    pub has_vel: bool,
    /// Estimated acceleration (a rocket falling, a missile turning).
    #[serde(default)]
    pub acc: V3,
}

impl Track {
    /// Where the track will be `t` seconds from now on its estimated path.
    pub fn at(&self, t: f64) -> V3 {
        add(add(self.pos, mul(self.vel, t)), mul(self.acc, 0.5 * t * t))
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Aps {
    pub owner: u32,
    pub team: u8,
    pub def: ApsDef,
    pub enabled: bool,
    pub mode: ApsMode,
    /// Gun bearing (world) and elevation, and where the servos are being told to go.
    pub yaw: f64,
    pub pitch: f64,
    pub yaw_cmd: f64,
    pub pitch_cmd: f64,
    /// Barrel cluster speed 0..1, barrel heat 0..1 (1: too hot), cooling down.
    pub spin: f64,
    pub heat: f64,
    pub overheated: bool,
    pub rounds: u32,
    pub rate_rpm: f64,
    pub acc: f64,
    pub radar_t: f64,
    /// Antenna sweep angle (for the look of it) and the tracks it holds.
    pub scan: f64,
    pub tracks: Vec<Track>,
    pub target: Option<u32>,
    /// Distance to the target and its time to closest approach (HUD).
    pub target_range: f64,
    pub target_tca: f64,
    pub firing: bool,
    pub fired: u32,
    pub kills: u32,
    pub rng: Rng,
}

/// A bullet fired this step, for drawing.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Fired {
    pub aps: u32,
    pub pos: V3,
    pub vel: V3,
    pub tracer: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// A missile struck a vehicle's box (server side).
    MissileHit { missile: u32, actor: u32, point: V3, dir: V3, speed: f64 },
    MissileGround { missile: u32, point: V3 },
    MissileSpent { missile: u32 },
    /// A track became firm / was dropped.
    Detect { aps: u32, missile: u32, range: f64 },
    Lost { aps: u32, missile: u32 },
    Lock { aps: u32, missile: u32, range: f64 },
    FireStart { aps: u32 },
    FireStop { aps: u32 },
    BulletHit { aps: u32, missile: u32, point: V3, section: String },
    /// damage: "control" (wire / fins gone, flying blind), "motor", "structure".
    MissileDamaged { missile: u32, damage: String },
    Intercept { aps: u32, missile: u32, point: V3, kind: String },
    Overheat { aps: u32 },
    Cooled { aps: u32 },
    Empty { aps: u32 },
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct StepOut {
    pub events: Vec<Event>,
    pub fired: Vec<Fired>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct World {
    pub t: f64,
    pub next_id: u32,
    pub defs: HashMap<String, MissileDef>,
    pub missiles: Vec<Missile>,
    pub bullets: Vec<Bullet>,
    pub aps: Vec<Aps>,
    #[serde(skip)]
    pub terrain: HeightGrid,
    /// The missiles that ended in the last step (who fired them, what they were).
    #[serde(skip)]
    pub ended: Vec<Missile>,
}

impl World {
    pub fn new(defs: Vec<MissileDef>) -> World {
        World { t: 0.0, next_id: 1, defs: defs.into_iter().map(|d| (d.id.clone(), d)).collect(), missiles: Vec::new(), bullets: Vec::new(), aps: Vec::new(), terrain: HeightGrid::flat(), ended: Vec::new() }
    }

    pub fn clear(&mut self) {
        self.missiles.clear();
        self.bullets.clear();
        self.aps.clear();
    }

    /// A missile leaves its launcher; returns its id (None: unknown kind or a bad line).
    pub fn launch(&mut self, def: &str, owner: u32, team: u8, pos: V3, dir: V3, seed: u32) -> Option<u32> {
        self.launch_as(None, def, owner, team, pos, dir, seed)
    }

    /// The same with the id chosen by the caller (a client mirroring the server's missile).
    pub fn launch_as(&mut self, id: Option<u32>, def: &str, owner: u32, team: u8, pos: V3, dir: V3, seed: u32) -> Option<u32> {
        let d = self.defs.get(def)?;
        if !finite(pos) || !finite(dir) || len(dir) < 1e-6 {
            return None;
        }
        let dir = norm(dir);
        let id = id.unwrap_or_else(|| {
            let i = self.next_id;
            self.next_id += 1;
            i
        });
        self.next_id = self.next_id.max(id + 1);
        self.missiles.push(Missile {
            id,
            def: def.into(),
            owner,
            team,
            pos,
            vel: mul(dir, d.launch_speed_ms),
            speed: d.launch_speed_ms,
            t: 0.0,
            travelled: 0.0,
            hp: d.hp,
            guided: d.guidance != Guidance::None,
            motor: true,
            falls: !d.lift || d.guidance == Guidance::None,
            wobble: [0.0, 0.0],
            sight: None,
            aim: None,
            steer: dir,
            status: MStatus::Flying,
            hits_taken: 0,
            crippled_by: None,
            rng: Rng::new(seed ^ 0x9e37_79b9),
        });
        Some(id)
    }

    /// The launcher's gunner lays the sight: the missile is steered onto the line sight -> aim.
    pub fn guide(&mut self, id: u32, owner: u32, sight: V3, aim: V3) {
        if !finite(sight) || !finite(aim) {
            return;
        }
        if let Some(m) = self.missiles.iter_mut().find(|m| m.id == id && m.owner == owner) {
            m.sight = Some(sight);
            m.aim = Some(aim);
        }
    }

    /// The missile is gone (struck something the world does not know of).
    pub fn end(&mut self, id: u32, status: MStatus) {
        if let Some(m) = self.missiles.iter_mut().find(|m| m.id == id) {
            if m.status == MStatus::Flying {
                m.status = status;
            }
        }
    }

    pub fn missile(&self, id: u32) -> Option<&Missile> {
        self.missiles.iter().find(|m| m.id == id)
    }

    /// Gives `owner` an APS (or replaces it), loaded and switched on.
    pub fn add_aps(&mut self, owner: u32, team: u8, def: ApsDef, seed: u32) {
        self.aps.retain(|a| a.owner != owner);
        let rate = def.rate_rpm;
        let rounds = def.rounds;
        self.aps.push(Aps {
            owner,
            team,
            def,
            enabled: true,
            mode: ApsMode::Search,
            yaw: 0.0,
            pitch: 0.0,
            yaw_cmd: 0.0,
            pitch_cmd: 0.0,
            spin: 0.0,
            heat: 0.0,
            overheated: false,
            rounds,
            rate_rpm: rate,
            acc: 0.0,
            radar_t: 0.0,
            scan: 0.0,
            tracks: Vec::new(),
            target: None,
            target_range: 0.0,
            target_tca: 0.0,
            firing: false,
            fired: 0,
            kills: 0,
            rng: Rng::new(seed ^ 0x51ed_270b),
        });
    }

    pub fn remove_aps(&mut self, owner: u32) {
        self.aps.retain(|a| a.owner != owner);
    }

    /// On / off, and the rate of fire (held inside the gun's range).
    pub fn set_aps(&mut self, owner: u32, enabled: bool, rate_rpm: Option<f64>) {
        self.set_aps_rounds(owner, enabled, rate_rpm, None);
    }

    /// The same, and the rounds left in its magazine (fired by hand while it was off).
    pub fn set_aps_rounds(&mut self, owner: u32, enabled: bool, rate_rpm: Option<f64>, rounds: Option<u32>) {
        if let Some(a) = self.aps.iter_mut().find(|a| a.owner == owner) {
            a.enabled = enabled;
            if let Some(r) = rate_rpm {
                a.rate_rpm = r.clamp(a.def.rate_range_rpm[0], a.def.rate_range_rpm[1]);
            }
            if let Some(n) = rounds {
                a.rounds = n.min(a.def.rounds);
            }
        }
    }

    pub fn aps_of(&self, owner: u32) -> Option<&Aps> {
        self.aps.iter().find(|a| a.owner == owner)
    }

    /// Advances everything by `dt` seconds; `actors` are the vehicles as they stand now.
    pub fn step(&mut self, dt: f64, actors: &[Actor]) -> StepOut {
        let mut out = StepOut::default();
        if !(dt > 0.0) {
            return out;
        }
        let n = (dt / MAX_STEP).ceil().max(1.0) as usize;
        let h = dt / n as f64;
        for _ in 0..n {
            self.substep(h, actors, &mut out);
        }
        // how each one ended is in the events: only those still flying stay
        let (flying, done): (Vec<Missile>, Vec<Missile>) = std::mem::take(&mut self.missiles).into_iter().partition(|m| m.status == MStatus::Flying);
        self.missiles = flying;
        self.ended = done;
        out
    }

    fn substep(&mut self, h: f64, actors: &[Actor], out: &mut StepOut) {
        self.t += h;
        let now = self.t;
        // ---- missiles fly
        let mut crippled: Vec<u32> = Vec::new();
        for i in 0..self.missiles.len() {
            if self.missiles[i].status != MStatus::Flying {
                continue;
            }
            let def = match self.defs.get(&self.missiles[i].def) {
                Some(d) => d.clone(),
                None => {
                    self.missiles[i].status = MStatus::Spent;
                    continue;
                }
            };
            let p0 = self.missiles[i].pos;
            fly(&mut self.missiles[i], &def, h);
            let m = &mut self.missiles[i];
            let p1 = m.pos;
            // a vehicle's box in the way (not the launcher's own as the missile leaves it)
            let mut best: Option<(f64, u32)> = None;
            for a in actors {
                let Some(b) = a.obb else { continue };
                if !a.alive || (a.id == m.owner && m.t < 1.0) {
                    continue;
                }
                if let Some(t) = segment_obb(p0, p1, &b) {
                    if best.map(|(bt, _)| t < bt).unwrap_or(true) {
                        best = Some((t, a.id));
                    }
                }
            }
            if let Some((t, actor)) = best {
                let point = add(p0, mul(sub(p1, p0), t));
                m.pos = point;
                m.status = MStatus::Struck;
                out.events.push(Event::MissileHit { missile: m.id, actor, point, dir: norm(m.vel), speed: m.speed });
                continue;
            }
            if self.terrain.height(p1[0], p1[2]) >= p1[1] {
                let gy = self.terrain.height(p1[0], p1[2]);
                m.pos = [p1[0], gy, p1[2]];
                m.status = MStatus::Ground;
                out.events.push(Event::MissileGround { missile: m.id, point: m.pos });
                crippled.extend(m.crippled_by);
                continue;
            }
            if m.t > 60.0 || (!m.motor && m.speed < 20.0) {
                m.status = MStatus::Spent;
                out.events.push(Event::MissileSpent { missile: m.id });
                crippled.extend(m.crippled_by);
            }
        }
        // a missile its bullets crippled that came down short counts to that system
        for owner in crippled {
            if let Some(a) = self.aps.iter_mut().find(|a| a.owner == owner) {
                a.kills += 1;
            }
        }
        // ---- the protection systems look, decide and shoot
        for k in 0..self.aps.len() {
            let owner = self.aps[k].owner;
            let actor = actors.iter().find(|a| a.id == owner);
            step_aps(&mut self.aps[k], actor, &self.missiles, &self.terrain, &self.defs, now, h, &mut self.bullets, out);
        }
        // ---- bullets fly and meet missiles
        let kb_of = |a: &Aps| 0.5 * AIR_RHO * a.def.bullet_drag * std::f64::consts::PI * (a.def.bullet_caliber_mm * 0.0005).powi(2) / a.def.bullet_mass_kg;
        let drags: HashMap<u32, f64> = self.aps.iter().map(|a| (a.owner, kb_of(a))).collect();
        let mut keep = Vec::with_capacity(self.bullets.len());
        let bullets = std::mem::take(&mut self.bullets);
        for mut b in bullets {
            let kb = drags.get(&b.aps).copied().unwrap_or(4.7e-4);
            let b0 = b.pos;
            let sp = len(b.vel);
            let mut nv = mul(b.vel, 1.0 - kb * sp * h);
            nv[1] -= G * h;
            let avg = mul(add(b.vel, nv), 0.5);
            b.pos = add(b0, mul(avg, h));
            b.vel = nv;
            b.age += h;
            // the first missile body this bullet's path meets this step
            let mut hit: Option<(f64, usize, f64)> = None; // (time, missile index, place along it)
            for (mi, m) in self.missiles.iter().enumerate() {
                if m.status != MStatus::Flying || m.team == b.team {
                    continue;
                }
                let Some(def) = self.defs.get(&m.def) else { continue };
                let ax = norm(m.vel);
                let half = def.length_m / 2.0;
                // the body's path this step is m.pos - vel*h .. m.pos (missiles moved first)
                let m0 = sub(m.pos, mul(m.vel, h));
                // relative motion: the bullet as seen from the missile
                let r0 = sub(b0, m0);
                let rv = sub(avg, m.vel);
                let r1 = add(r0, mul(rv, h));
                let (d, s, t) = seg_seg(r0, r1, mul(ax, -half), mul(ax, half));
                let body_r = def.caliber_mm / 2000.0 + 0.0073;
                // fins: thin, so only a share of passes through their span strike one
                let tail_s = -half + def.length_m * 0.2;
                let along = -half + s * def.length_m;
                let fin_r = def.span_m / 2.0;
                // a pass through the fins' span strikes one about one time in six (they are thin)
                let fin = along < tail_s && d < fin_r && ((b0[0] * 12.9898 + b0[2] * 78.233 + b0[1] * 37.719).sin() * 43_758.545).fract().abs() < 0.18;
                let struck = d < body_r || fin;
                if struck && hit.map(|(bt, _, _)| t < bt).unwrap_or(true) {
                    hit = Some((t, mi, along));
                }
            }
            if let Some((t, mi, along)) = hit {
                let point = add(b0, mul(avg, t * h));
                let aps_owner = b.aps;
                let (def_len, share, fuse, control) = {
                    let d = &self.defs[&self.missiles[mi].def];
                    (d.length_m, d.warhead_share, d.fuse_chance, d.control_loss_chance)
                };
                let half = def_len / 2.0;
                let section = if along > half - def_len * share { "warhead" } else if along < -half + def_len * 0.25 { "tail" } else { "body" };
                let m = &mut self.missiles[mi];
                m.hits_taken += 1;
                out.events.push(Event::BulletHit { aps: aps_owner, missile: m.id, point, section: section.into() });
                let roll = m.rng.f();
                if section == "warhead" && roll < fuse {
                    m.status = MStatus::Intercepted;
                    m.pos = point;
                    out.events.push(Event::Intercept { aps: aps_owner, missile: m.id, point, kind: "airburst".into() });
                } else {
                    m.hp -= 1.0;
                    if m.hp <= 0.0 {
                        m.status = MStatus::Broken;
                        m.pos = point;
                        out.events.push(Event::Intercept { aps: aps_owner, missile: m.id, point, kind: "breakup".into() });
                    } else {
                        // knocked about: drift, and it may lose its wire or controls, or its motor
                        let k = if section == "tail" { 0.45 } else { 0.2 };
                        m.wobble[0] += (m.rng.f() - 0.5) * k;
                        m.wobble[1] += (m.rng.f() - 0.5) * k;
                        if m.guided && m.rng.f() < control * if section == "tail" { 1.6 } else { 1.0 } {
                            m.guided = false;
                            m.falls = true;
                            m.crippled_by = Some(aps_owner);
                            out.events.push(Event::MissileDamaged { missile: m.id, damage: "control".into() });
                        } else if section == "tail" && m.motor && m.rng.f() < 0.4 {
                            m.motor = false;
                            m.crippled_by = Some(aps_owner);
                            out.events.push(Event::MissileDamaged { missile: m.id, damage: "motor".into() });
                        } else {
                            out.events.push(Event::MissileDamaged { missile: m.id, damage: "structure".into() });
                        }
                    }
                }
                if matches!(m.status, MStatus::Intercepted | MStatus::Broken) {
                    if let Some(a) = self.aps.iter_mut().find(|a| a.owner == aps_owner) {
                        a.kills += 1;
                    }
                }
                continue;
            }
            if b.age > 3.0 || self.terrain.height(b.pos[0], b.pos[2]) >= b.pos[1] {
                continue;
            }
            keep.push(b);
        }
        self.bullets = keep;
    }

    /// Missiles still in the air (and those that ended this step are already gone).
    pub fn flying(&self) -> impl Iterator<Item = &Missile> {
        self.missiles.iter().filter(|m| m.status == MStatus::Flying)
    }
}

/// One step of a missile's flight.
pub fn fly(m: &mut Missile, def: &MissileDef, h: f64) {
    m.t += h;
    // the motor's schedule; then it coasts against the air
    if m.motor && m.t < def.boost_s {
        m.speed = def.launch_speed_ms + (def.max_speed_ms - def.launch_speed_ms) * (m.t / def.boost_s.max(1e-3));
    } else if m.motor && m.t < def.burn_s.max(def.boost_s) {
        m.speed = def.max_speed_ms;
    } else {
        m.motor = false;
        m.speed = (m.speed - def.drag_k * m.speed * m.speed * h).max(0.0);
    }
    let mut d = norm(m.vel);
    // out of wire: it flies on, unguided, and comes down
    if m.guided && m.travelled > def.max_range_m {
        m.guided = false;
        m.falls = true;
    }
    if m.guided && def.guidance == Guidance::Saclos && m.travelled > def.min_range_m.min(20.0) {
        if let (Some(s), Some(a)) = (m.sight, m.aim) {
            let u = norm(sub(a, s));
            let along = dot(sub(m.pos, s), u);
            let look = (m.speed * 0.6).max(40.0);
            let q = add(s, mul(u, along + look));
            let want = norm(sub(q, m.pos));
            let k = (h / def.guidance_lag_s.max(h)).min(1.0);
            m.steer = norm(add(m.steer, mul(sub(want, m.steer), k)));
            // turn towards the command no faster than the fins allow
            let max_turn = def.turn_accel_ms2 / m.speed.max(20.0) * h;
            let c = dot(d, m.steer).clamp(-1.0, 1.0);
            let ang = c.acos();
            if ang > 1e-9 {
                let f = (max_turn / ang).min(1.0);
                d = norm(add(mul(d, 1.0 - f), mul(m.steer, f)));
            }
        }
    }
    if m.wobble != [0.0, 0.0] {
        let (yaw, pitch) = yaw_pitch(d);
        d = dir_of(yaw + m.wobble[0] * h, (pitch + m.wobble[1] * h).clamp(-1.5, 1.5));
    }
    // the heading carries what gravity has already bent into it; it bends a little more
    let mut vel = mul(d, m.speed);
    if m.falls {
        vel[1] -= G * h;
        m.speed = len(vel);
    }
    let avg = mul(add(m.vel, vel), 0.5);
    m.pos = add(m.pos, mul(avg, h));
    m.travelled += len(avg) * h;
    m.vel = vel;
}

/// Closest approach of segments p0-p1 and q0-q1: (distance, place along p 0..1, place along q 0..1).
pub fn seg_seg(p0: V3, p1: V3, q0: V3, q1: V3) -> (f64, f64, f64) {
    let d1 = sub(p1, p0);
    let d2 = sub(q1, q0);
    let r = sub(p0, q0);
    let a = dot(d1, d1);
    let e = dot(d2, d2);
    let f = dot(d2, r);
    let (s, t);
    if a <= 1e-12 && e <= 1e-12 {
        return (len(r), 0.0, 0.0);
    }
    if a <= 1e-12 {
        s = 0.0;
        t = (f / e).clamp(0.0, 1.0);
    } else {
        let c = dot(d1, r);
        if e <= 1e-12 {
            t = 0.0;
            s = (-c / a).clamp(0.0, 1.0);
        } else {
            let b = dot(d1, d2);
            let den = a * e - b * b;
            let mut ss = if den > 1e-12 { ((b * f - c * e) / den).clamp(0.0, 1.0) } else { 0.0 };
            let mut tt = (b * ss + f) / e;
            if tt < 0.0 {
                tt = 0.0;
                ss = (-c / a).clamp(0.0, 1.0);
            } else if tt > 1.0 {
                tt = 1.0;
                ss = ((b - c) / a).clamp(0.0, 1.0);
            }
            s = ss;
            t = tt;
        }
    }
    let cp = add(p0, mul(d1, s));
    let cq = add(q0, mul(d2, t));
    // returns (distance, place along q (the missile), place along p (the bullet's step))
    (len(sub(cp, cq)), t, s)
}

/// Where along a -> b (0..1) the segment enters the box, if it does.
pub fn segment_obb(a: V3, b: V3, o: &Obb) -> Option<f64> {
    let d = sub(b, a);
    let rel = sub(a, o.center);
    let mut t0: f64 = 0.0;
    let mut t1: f64 = 1.0;
    for k in 0..3 {
        let ax = o.axes[k];
        let p = dot(rel, ax);
        let v = dot(d, ax);
        let h = o.half[k];
        if v.abs() < 1e-12 {
            if p < -h || p > h {
                return None;
            }
        } else {
            let mut ta = (-h - p) / v;
            let mut tb = (h - p) / v;
            if ta > tb {
                std::mem::swap(&mut ta, &mut tb);
            }
            t0 = t0.max(ta);
            t1 = t1.min(tb);
            if t0 > t1 {
                return None;
            }
        }
    }
    Some(t0)
}

/// Time a bullet (speed v0, drag k per metre) takes to cover `r` metres.
pub fn bullet_time(r: f64, v0: f64, k: f64) -> f64 {
    if k < 1e-9 {
        r / v0
    } else {
        ((k * r).exp() - 1.0) / (k * v0)
    }
}

#[allow(clippy::too_many_arguments)]
fn step_aps(a: &mut Aps, actor: Option<&Actor>, missiles: &[Missile], terrain: &HeightGrid, defs: &HashMap<String, MissileDef>, now: f64, h: f64, bullets: &mut Vec<Bullet>, out: &mut StepOut) {
    let me = a.owner;
    let was_firing = a.firing;
    a.firing = false;
    // barrels cool all the time
    a.heat = (a.heat - a.def.cool_per_s * h).max(0.0);
    if a.overheated && a.heat <= a.def.resume_heat {
        a.overheated = false;
        out.events.push(Event::Cooled { aps: me });
    }
    let Some(actor) = actor.filter(|x| x.alive) else {
        a.mode = ApsMode::Dead;
        a.spin = (a.spin - h / a.def.spin_up_s.max(0.05) * 0.5).max(0.0);
        return;
    };
    let Some(pivot) = actor.aps_pivot else {
        a.mode = ApsMode::Dead;
        return;
    };
    if !a.enabled {
        a.mode = ApsMode::Off;
        a.tracks.clear();
        a.target = None;
        a.spin = (a.spin - h / a.def.spin_up_s.max(0.05) * 0.5).max(0.0);
        if was_firing {
            out.events.push(Event::FireStop { aps: me });
        }
        return;
    }
    // ---- the radar: a look every 1/rate s
    a.scan = wrap(a.scan + h * 4.0 * std::f64::consts::PI);
    let radar = add(pivot, [0.0, 0.35, 0.0]);
    a.radar_t += h;
    let look_every = 1.0 / a.def.radar_rate_hz.max(1.0);
    // between looks every track coasts on its estimate
    for tr in a.tracks.iter_mut() {
        tr.pos = add(add(tr.pos, mul(tr.vel, h)), mul(tr.acc, 0.5 * h * h));
        tr.vel = add(tr.vel, mul(tr.acc, h));
    }
    if actor.aps_radar_ok && a.radar_t >= look_every {
        let dtl = a.radar_t;
        a.radar_t = 0.0;
        for m in missiles {
            if m.status != MStatus::Flying || m.team == a.team {
                continue;
            }
            let rel = sub(m.pos, radar);
            let r = len(rel);
            if r > a.def.radar_range_m || r < 1.0 {
                continue;
            }
            let el = (rel[1] / r).asin().to_degrees();
            if el < a.def.radar_elevation_deg[0] || el > a.def.radar_elevation_deg[1] {
                continue;
            }
            if !terrain.line_clear(radar, m.pos, 0.2) {
                continue;
            }
            let x = (r / a.def.radar_range_m).powi(2);
            let pd = 0.98 + (a.def.detect_chance_far - 0.98) * x;
            if a.rng.f() >= pd {
                continue;
            }
            // a noisy measurement: across the line by the angle error, along it by the range error
            let u = norm(rel);
            let p1 = norm(cross(u, [0.0, 1.0, 0.0]));
            let p1 = if len(p1) < 0.5 { [1.0, 0.0, 0.0] } else { p1 };
            let p2 = cross(p1, u);
            let ae = a.def.angle_noise_mrad / 1000.0 * r;
            let meas = add(
                add(m.pos, mul(u, a.rng.gauss() * a.def.range_noise_m)),
                add(mul(p1, a.rng.gauss() * ae), mul(p2, a.rng.gauss() * ae)),
            );
            if let Some(tr) = a.tracks.iter_mut().find(|t| t.missile == m.id) {
                // alpha-beta filter on the coasted estimate
                let res = sub(meas, tr.pos);
                if tr.has_vel {
                    // alpha-beta-gamma: position, speed and a slowly learnt acceleration
                    // far out a measurement is worth less (its error grows with range): smaller
                    // gains there, as a Kalman filter's would be
                    let dl = dtl.max(1e-3);
                    let k = (250.0 / r).clamp(0.3, 1.0);
                    tr.pos = add(tr.pos, mul(res, 0.5 * k));
                    tr.vel = add(tr.vel, mul(res, 0.15 * k * k / dl));
                    tr.acc = add(tr.acc, mul(res, 0.02 * k * k * k / (dl * dl)));
                    // nothing that flies pulls more than 30 g
                    let al = len(tr.acc);
                    if al > 300.0 {
                        tr.acc = mul(tr.acc, 300.0 / al);
                    }
                } else {
                    // second look: a first speed from the two
                    tr.vel = mul(sub(meas, sub(tr.pos, mul(tr.vel, dtl))), 1.0 / dtl.max(1e-3));
                    tr.pos = meas;
                    tr.has_vel = true;
                }
                tr.seen = now;
                tr.hits += 1;
                if !tr.firm && tr.hits >= a.def.confirm_hits {
                    tr.firm = true;
                    out.events.push(Event::Detect { aps: me, missile: m.id, range: r });
                }
            } else {
                a.tracks.push(Track { missile: m.id, pos: meas, vel: [0.0; 3], seen: now, hits: 1, firm: a.def.confirm_hits <= 1, has_vel: false, acc: [0.0; 3] });
            }
        }
    }
    // tracks not seen for a while are dropped
    let drop = a.def.drop_after_s;
    let mut lost = Vec::new();
    a.tracks.retain(|t| {
        let keep = now - t.seen <= drop;
        if !keep && t.firm {
            lost.push(t.missile);
        }
        keep
    });
    for mid in lost {
        out.events.push(Event::Lost { aps: me, missile: mid });
    }
    if !actor.aps_radar_ok {
        a.tracks.clear();
    }
    // ---- threat evaluation: the firm track that will pass within reach soonest
    let c = actor.center;
    let cv = actor.vel;
    let mut best: Option<(f64, u32, f64)> = None; // (time to closest approach, missile, range)
    for tr in a.tracks.iter().filter(|t| t.firm && t.has_vel) {
        let sp = len(tr.vel);
        if sp < a.def.min_threat_speed_ms || sp > a.def.max_threat_speed_ms {
            continue;
        }
        // closest approach on the curved estimated path (coarse, then fine)
        let gap = |t: f64| len(sub(tr.at(t), add(c, mul(cv, t))));
        let mut tca = 0.0;
        let mut miss = gap(0.0);
        let mut t = 0.0;
        while t < 20.0 {
            t += 0.1;
            let g = gap(t);
            if g < miss {
                miss = g;
                tca = t;
            }
        }
        let (mut lo_t, mut hi_t) = ((tca - 0.1f64).max(0.0), tca + 0.1);
        for _ in 0..20 {
            let m1 = lo_t + (hi_t - lo_t) / 3.0;
            let m2 = hi_t - (hi_t - lo_t) / 3.0;
            if gap(m1) < gap(m2) {
                hi_t = m2;
            } else {
                lo_t = m1;
            }
        }
        tca = (lo_t + hi_t) / 2.0;
        miss = gap(tca);
        if tca <= 0.0 || tca >= 19.9 {
            continue;
        }
        // the track already being engaged keeps its place unless it clearly turns away
        let limit = if a.target == Some(tr.missile) { a.def.threat_miss_m * 2.0 } else { a.def.threat_miss_m };
        if miss > limit {
            continue;
        }
        // the one engaged now wins ties of a tenth of a second: no flicking between two
        let k = if a.target == Some(tr.missile) { tca - 0.1 } else { tca };
        if best.map(|(bt, _, _)| k < bt).unwrap_or(true) {
            best = Some((k, tr.missile, len(sub(tr.pos, pivot))));
        }
    }
    let prev = a.target;
    a.target = best.map(|b| b.1);
    if let Some((tca, mid, range)) = best {
        a.target_range = range;
        a.target_tca = tca;
        if prev != Some(mid) {
            out.events.push(Event::Lock { aps: me, missile: mid, range });
        }
    } else {
        a.target_range = 0.0;
        a.target_tca = 0.0;
    }
    // ---- the gun: spin up when something is coming, lay on the lead, fire inside the zone
    let kb = 0.5 * AIR_RHO * a.def.bullet_drag * std::f64::consts::PI * (a.def.bullet_caliber_mm * 0.0005).powi(2) / a.def.bullet_mass_kg;
    let coming = best.map(|(_, _, r)| r < a.def.engage_range_m * 2.5).unwrap_or(false);
    let spin_rate = h / a.def.spin_up_s.max(0.05);
    a.spin = if coming { (a.spin + spin_rate).min(1.0) } else { (a.spin - spin_rate * 0.4).max(0.0) };
    let mut fire = false;
    let want;
    if let Some(tr) = a.target.and_then(|mid| a.tracks.iter().find(|t| t.missile == mid)) {
        // lead: where the track will be when a bullet gets there
        let muzzle0 = pivot;
        let mut t = bullet_time(len(sub(tr.pos, muzzle0)), a.def.bullet_speed_ms, kb);
        let mut p = tr.pos;
        for _ in 0..5 {
            p = tr.at(t);
            t = bullet_time(len(sub(p, muzzle0)), a.def.bullet_speed_ms, kb);
        }
        let drop = 0.5 * G * t * t;
        let aim_pt = add(p, [0.0, drop, 0.0]);
        let (wy, wp) = yaw_pitch(sub(aim_pt, muzzle0));
        want = (wy, wp);
        let range_now = len(sub(tr.pos, pivot));
        let in_zone = range_now <= a.def.engage_range_m && range_now >= a.def.stop_range_m;
        fire = in_zone;
    } else if let Some(tr) = a
        .tracks
        .iter()
        .filter(|t| t.firm && t.has_vel)
        .min_by(|x, y| len(sub(x.pos, pivot)).partial_cmp(&len(sub(y.pos, pivot))).unwrap_or(std::cmp::Ordering::Equal))
    {
        // nothing judged a threat yet: stay laid on the nearest track, ready
        want = yaw_pitch(sub(tr.pos, pivot));
    } else {
        // nothing in the air: the gun rests forward on the turret's bearing
        want = (actor.aps_base_yaw, 0.0);
    }
    // limits: the depression the hull allows at this bearing, the gun's top elevation
    let rel = wrap(want.0 - actor.aps_base_yaw);
    let lo = a.def.min_pitch(rel);
    let hi = a.def.max_elevation_deg.to_radians();
    let bears = want.1 >= lo && want.1 <= hi;
    a.yaw_cmd = want.0;
    a.pitch_cmd = want.1.clamp(lo, hi);
    // servos: a short lag, then no faster than their rates
    let lag = a.def.servo_lag_s.max(h);
    let dy = wrap(a.yaw_cmd - a.yaw) * (h / lag).min(1.0);
    let dp = (a.pitch_cmd - a.pitch) * (h / lag).min(1.0);
    let ry = a.def.traverse_deg_s.to_radians() * h;
    let rp = a.def.elevate_deg_s.to_radians() * h;
    a.yaw = wrap(a.yaw + dy.clamp(-ry, ry));
    a.pitch = (a.pitch + dp.clamp(-rp, rp)).clamp(lo, hi);
    let aim_dir = dir_of(a.yaw, a.pitch);
    let laid = {
        let wd = dir_of(want.0, want.1);
        // once firing it holds the trigger through small servo hunting
        let window = if was_firing { a.def.fire_window_mrad * 2.0 } else { a.def.fire_window_mrad };
        dot(aim_dir, wd).clamp(-1.0, 1.0).acos() * 1000.0 <= window
    };
    a.mode = if !actor.aps_gun_ok || !actor.aps_radar_ok {
        ApsMode::Fault
    } else if a.overheated {
        ApsMode::Overheat
    } else if a.rounds == 0 {
        ApsMode::Empty
    } else if a.target.is_some() {
        if fire { ApsMode::Engage } else { ApsMode::Track }
    } else {
        ApsMode::Search
    };
    let can = fire && bears && laid && a.spin >= 0.999 && actor.aps_gun_ok && actor.aps_radar_ok && !a.overheated && a.rounds > 0;
    if can {
        a.firing = true;
        a.acc += a.rate_rpm / 60.0 * h;
        let muzzle = add(pivot, mul(aim_dir, a.def.barrel_m));
        while a.acc >= 1.0 && a.rounds > 0 {
            a.acc -= 1.0;
            a.rounds -= 1;
            a.fired += 1;
            // scatter round the laid line
            let sd = a.def.dispersion_mrad / 1000.0;
            let (y0, p0) = (a.yaw, a.pitch);
            let d = dir_of(y0 + a.rng.gauss() * sd / p0.cos().max(0.2), p0 + a.rng.gauss() * sd);
            let vel = add(mul(d, a.def.bullet_speed_ms), cv);
            // a round fired part-way through the step starts part-way along
            let lead = a.rng.f() * h;
            let pos = add(muzzle, mul(vel, lead));
            let tracer = a.def.tracer_every > 0 && a.fired % a.def.tracer_every == 0;
            bullets.push(Bullet { aps: me, team: a.team, pos, vel, age: lead, tracer });
            out.fired.push(Fired { aps: me, pos: muzzle, vel, tracer });
            a.heat += 1.0 / a.def.heat_rounds.max(1.0);
            if a.heat >= 1.0 && !a.overheated {
                a.overheated = true;
                out.events.push(Event::Overheat { aps: me });
            }
            if a.rounds == 0 {
                out.events.push(Event::Empty { aps: me });
            }
            if a.overheated {
                break;
            }
        }
    } else {
        a.acc = 0.0;
    }
    if a.firing && !was_firing {
        out.events.push(Event::FireStart { aps: me });
    } else if !a.firing && was_firing {
        out.events.push(Event::FireStop { aps: me });
    }
    let _ = defs;
}

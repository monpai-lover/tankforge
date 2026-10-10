//! The lobby and its rooms, with no networking in it: every client message goes through
//! [`Lobby::handle`] and comes back as a list of messages to send to whom, so the whole game
//! flow can be tested without sockets.
//!
//! What the server decides (authoritative): who is in which room and team, when a room's battle
//! starts, every vehicle's hit points, kills, deaths and respawns. A hit only counts when it
//! names an accepted shot the shooter really fired (once, within a few seconds), at an
//! enemy in the same battle; an in-flight shot remains valid after its shooter is lost; the damage comes from the shell's own data (an explosive filler knocks
//! a vehicle out with one penetration, solid shot needs two). What the clients decide: their own
//! vehicle's motion (the server relays it to the room 20 times a second, refusing jumps faster than
//! any vehicle can drive) and which armour plate a shell met (the shooter resolves it against the
//! target's armour data). Running the vehicle physics on the server (crates/physics/src/tank) is
//! the next step; the state relayed here is already its NetState.
//!
//! Damage (with the vehicles' data loaded, see [`Lobby::with_combat`]): there are no hit points.
//! The shooter sends the shot in the target's own frame (where its shell met the vehicle, as it
//! saw it) and the server resolves it with crates/combat against the target's armour, modules and
//! crew and its damage so far -- the same code the clients run, with a seed both sides derive from
//! the shot, so the shooter's hit camera shows what the server decides. The report goes to the
//! room; a vehicle is out when the model says so (ammunition gone up, too few crew left). Fire,
//! crew changing seats and field repairs run on the server's clock.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use tg_combat::{Target, TargetState as CombatState};
use tg_combat::weapon_damage::{select_weapon, WeaponKind};
use tg_shared::Vec3;
use tg_weapon::ProjectileDef;

pub const MAX_ROOMS: usize = 64;
pub const MAX_NAME: usize = 24;
/// Faster than this between two states (m/s) is not driving.
const MAX_SPEED: f64 = 30.0;
/// How long after (re)spawning a vehicle may be anywhere.
const SPAWN_GRACE: f64 = 2.0;
/// How long a fired shot can still be reported as a hit.
const SHOT_LIFE: f64 = 8.0;
/// At most this many shots in any 10 s (a multi-gun ripple included); an automatic gun of
/// [`AUTOCANNON_MM`] or less may fire [`AUTO_BURST`].
const FIRE_BURST: usize = 16;
const AUTOCANNON_MM: f64 = 40.0;
const AUTO_BURST: usize = 600;
pub const RESPAWN_DELAY: f64 = 5.0;
/// Conquest: each side's tickets at the start, what a lost vehicle costs, how fast holding fewer
/// points than the enemy bleeds them (per second per point short), how long one vehicle takes
/// to turn a neutral point (more vehicles are faster, up to three).
pub const TICKETS: f64 = 1000.0;
pub const DEATH_COST: f64 = 50.0;
pub const BLEED: f64 = 1.5;
pub const CAPTURE_TIME: f64 = 24.0;
/// Conquest is reckoned four times a second.
const CONQUEST_DT: f64 = 0.25;
/// Lag compensation (after Claude-of-Tanks' MIT server/match/lagCompensation.ts): a hit is checked
/// against where the target stood when the shooter saw it, rewound by the shooter's one-way delay
/// and the clients' interpolation delay -- at most this far back.
const MAX_REWIND: f64 = 0.25;
/// The remote-vehicle interpolation delay of the client (src/game/enemies.js INTERP_DELAY).
const CLIENT_INTERP: f64 = 0.13;
/// Positions kept per player for the rewind (s).
const TRAIL: f64 = 2.0;
/// RTT samples kept (their median is used, so one slow ping does not move it).
const RTT_SAMPLES: usize = 8;
/// Interest tiers (after the reference's server/match/interestTiers.ts): the others' states go to a
/// player every tick when near, every 2nd tick at middle range, every 4th far away or wrecked.
const NEAR_M: f64 = 450.0;
const MID_M: f64 = 1100.0;
/// A player whose connection drops in a battle keeps the seat this long (s) for a reconnect
/// (after the reference's server/match/seatToken.ts: the seat is held, not the socket).
pub const RESUME_GRACE: f64 = 20.0;
pub const FULL_HP: f64 = 100.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Team {
    Blue,
    Red,
}

/// What the server knows about a shell (from data/projectiles).
#[derive(Clone, Debug)]
pub struct Shell {
    pub kind: String,
    pub filler_kg: f64,
    pub caliber_mm: f64,
}

impl Shell {
    /// Hit points one penetration takes: a filler (or HE / HEAT) knocks the vehicle out.
    pub fn damage(&self) -> f64 {
        if self.filler_kg > 0.01 || matches!(self.kind.as_str(), "he" | "heat" | "heat_fs" | "hesh") {
            FULL_HP
        } else {
            55.0
        }
    }
}

// ------------------------------------------------------------------ messages

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum ClientMsg {
    /// resume: the token of a seat this client held before its connection dropped.
    Hello {
        name: String,
        #[serde(default)]
        resume: Option<String>,
    },
    List,
    /// `deploy`: the battle starts with nobody on the field; every player chooses a vehicle,
    /// its ammunition and a spawn point on the deploy screen, and again after every death.
    Create {
        name: String,
        map: String,
        max: u32,
        #[serde(default)]
        deploy: bool,
        /// Only vehicles of these years (first, last) may be brought into the room.
        #[serde(default)]
        era: Option<[u32; 2]>,
    },
    Join { room: u32 },
    Leave,
    Vehicle { id: String },
    Ready { ready: bool },
    Start,
    /// The host ends the battle: back to the room, scores kept on the board.
    End,
    /// Change side before the battle.
    Team { team: Team },
    /// The client's own vehicle: its NetState plus what the turret and gun do.
    State { s: Value },
    Fire { seq: u32, #[serde(default)] instance: Option<String>, o: [f64; 3], d: [f64; 3], shell: String },
    /// A verified MG discharge; the following hit may name this proof once.
    MgFire { seq: u32, #[serde(default)] instance: Option<String>, gun: String, o: [f64; 3], d: [f64; 3] },
    /// What shot `seq` did; `shot` is the shell's line in the target's frame (combat model).
    Hit {
        seq: u32,
        target: u32,
        result: String,
        plate: Option<String>,
        #[serde(default)]
        shot: Option<WireShot>,
    },
    /// A machine-gun bullet that struck another vehicle (bullets are not relayed one by one).
    MgHit { #[serde(default)] seq: Option<u32>, #[serde(default)] instance: Option<String>, target: u32, gun: String, shot: WireShot },
    /// Field repair of the player's own broken modules; the fire extinguisher.
    Repair,
    Extinguish,
    /// Back in at the team's start once the delay is over; while still alive it abandons the
    /// vehicle (stuck, drowned), which counts as a death.
    Respawn,
    /// From the deploy screen (a deploy room, while not on the field): into battle with this
    /// vehicle at the team's spawn point `spawn`.
    Deploy {
        vehicle: String,
        #[serde(default)]
        spawn: u32,
        /// Main-gun rounds chosen (all of them when left out); never more than the racks hold.
        #[serde(default)]
        rounds: Option<u32>,
    },
    Chat { text: String },
    /// rtt: the round trip the client measured last (ms), for the server's lag compensation.
    Ping {
        at: f64,
        #[serde(default)]
        rtt: Option<f64>,
    },
    /// A missile or rocket leaves the player's launcher (o, d in the world).
    Launch { seq: u32, #[serde(default)] instance: Option<String>, missile: String, o: [f64; 3], d: [f64; 3] },
    /// The gunner's line for a wire-guided missile: from the sight through the aim point.
    Guide { id: u32, sight: [f64; 3], aim: [f64; 3] },
    /// The player's own missile struck something the server does not know of (a building).
    MissileEnd { id: u32 },
    /// The player's active protection: on or off, its rate of fire.
    Aps {
        enabled: bool,
        #[serde(default)]
        rate: Option<f64>,
    },
}

/// A shot in the target's hull frame: a point short of it, the direction, turret yaw, speed, range.
#[derive(Clone, Debug, Deserialize)]
pub struct WireShot {
    pub o: [f32; 3],
    pub d: [f32; 3],
    #[serde(default)]
    pub yaw: f32,
    pub speed: f32,
    pub dist: f32,
}

/// The seed the shooter's client and the server both derive for shot `seq` of player `id`.
pub fn shot_seed(id: u32, seq: u32) -> u64 {
    let s = (id as u64).wrapping_mul(1_000_003).wrapping_add((seq as u64).wrapping_mul(7919)) & 0xffff_ffff;
    s.max(1)
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct RoomInfo {
    pub id: u32,
    pub name: String,
    pub map: String,
    pub players: usize,
    pub max: u32,
    pub playing: bool,
    pub host: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub era: Option<[u32; 2]>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Member {
    pub id: u32,
    pub name: String,
    pub team: Team,
    pub slot: u32,
    pub vehicle: String,
    pub ready: bool,
    pub kills: u32,
    pub deaths: u32,
    pub hp: f64,
    pub alive: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct RoomDetail {
    pub id: u32,
    pub name: String,
    pub map: String,
    pub max: u32,
    pub host: u32,
    pub playing: bool,
    pub deploy: bool,
    pub members: Vec<Member>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub era: Option<[u32; 2]>,
}

/// A capture point of a map (data/maps/<id>/map.json "points").
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CapPoint {
    pub id: String,
    pub x: f64,
    pub z: f64,
    pub r: f64,
}

/// A capture point in battle: who holds it, and how far it is turned (-1 red .. +1 blue).
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct PointState {
    pub id: String,
    pub x: f64,
    pub z: f64,
    pub r: f64,
    pub owner: Option<Team>,
    pub progress: f64,
    /// Vehicles of each side inside the circle.
    pub blue: u32,
    pub red: u32,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct SnapPlayer {
    pub id: u32,
    pub s: Value,
    pub hp: f64,
    pub alive: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum ServerMsg {
    /// token: this player's secret for taking the seat back after a dropped connection.
    Welcome { id: u32, name: String, maps: Vec<String>, token: String },
    Rooms { rooms: Vec<RoomInfo> },
    Room { room: RoomDetail },
    LeftRoom,
    Start { map: String, members: Vec<Member> },
    Ended {
        members: Vec<Member>,
        /// Conquest: the side that won (tickets), None when the host ended it.
        #[serde(skip_serializing_if = "Option::is_none")]
        winner: Option<Team>,
    },
    Snap {
        tick: u64,
        players: Vec<SnapPlayer>,
        /// Missiles in flight, every active protection system, what happened, rounds fired.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        ms: Vec<Value>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        aps: Vec<Value>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        ev: Vec<Value>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        fired: Vec<Value>,
    },
    /// A missile left a launcher: its id in the battle (the shooter's `seq` tells it which).
    Launched { from: u32, seq: u32, id: u32, missile: String, o: [f64; 3], d: [f64; 3] },
    /// The requested tube did not fire. The client retains it and may retry after this interval.
    LaunchRejected { seq: u32, reason: String, retry_after_s: f64 },
    Fire { from: u32, seq: u32, o: [f64; 3], d: [f64; 3], shell: String },
    FireAccepted { seq: u32 },
    FireRejected { seq: u32, reason: String },
    Damage {
        target: u32,
        from: u32,
        result: String,
        plate: Option<String>,
        hp: f64,
        killed: bool,
        /// The combat model's report (what was met, broken and killed, and the state after).
        #[serde(skip_serializing_if = "Option::is_none")]
        report: Option<Value>,
    },
    /// A vehicle's damage changed without a hit: fire, a crew member taking another seat, repairs.
    Status { id: u32, state: Value, caps: Value, events: Vec<String> },
    /// Back on the field: with which vehicle, at which of the team's spawn points.
    Respawned { id: u32, vehicle: String, spawn: u32 },
    /// Conquest, four times a second: the points and both sides' tickets [blue, red].
    Capture { points: Vec<PointState>, tickets: [f64; 2] },
    Chat { from: u32, name: String, text: String },
    Error { msg: String },
    Pong { at: f64 },
}

pub type Out = Vec<(u32, ServerMsg)>;
/// One message for many: the snapshots, serialised once for the whole room.
pub type Broadcast = Vec<(Vec<u32>, ServerMsg)>;

// ------------------------------------------------------------------ state

const MAX_SEQUENCES: usize = 2048;
const MAX_LAUNCH_RECEIPTS: usize = 256;
const LAUNCH_RECEIPT_LIFE: f64 = 60.0;

#[derive(Clone, Debug)]
struct LaunchReceipt {
    at: f64,
    instance: String,
    request_instance: Option<String>,
    message: ServerMsg,
}

#[derive(Clone, Debug)]
struct Fired {
    seq: u32,
    at: f64,
    shell: String,
    used: bool,
    /// From an automatic gun (counted against its own, larger burst limit).
    small: bool,
    kind: WeaponKind,
    instance: String,
}

#[derive(Clone, Debug)]
pub struct Player {
    pub id: u32,
    pub name: String,
    pub room: Option<u32>,
    pub team: Team,
    pub slot: u32,
    pub vehicle: String,
    pub ready: bool,
    pub hp: f64,
    pub alive: bool,
    pub kills: u32,
    pub deaths: u32,
    pub state: Option<Value>,
    last_pos: Option<([f64; 3], f64)>,
    /// Recent positions (server time, position), for the rewind.
    trail: VecDeque<(f64, [f64; 3])>,
    /// Recent round trips the client reported (s).
    rtts: VecDeque<f64>,
    /// The secret that takes this seat back on another connection.
    token: String,
    /// Since when the connection is gone (the seat is held for RESUME_GRACE).
    pub away: Option<f64>,
    grace_until: f64,
    died_at: f64,
    fired: VecDeque<Fired>,
    /// Module and crew state in the combat model (None: the vehicle's data is not loaded).
    pub combat: Option<CombatState>,
    last_attacker: Option<u32>,
    mg_window: (f64, u32),
    /// Main-gun rounds on board: the load chosen on the deploy screen (None: full racks), less
    /// every shell fired since; the racks the rest are in can go up, the empty ones cannot.
    rounds: Option<u32>,
    /// Missiles and rockets still on board (by missile id) and when the last one left.
    missiles_left: HashMap<String, u32>,
    last_launch: f64,
    /// Retries replay on reconnect within this spawn, bounded in time and count.
    launch_receipts: HashMap<u32, LaunchReceipt>,
    sequences: VecDeque<u32>,
    retired_seq: Option<u32>,
}

impl Player {
    fn reset_shots(&mut self) {
        self.fired.clear();
        self.launch_receipts.clear();
        self.sequences.clear();
        self.retired_seq = None;
        self.mg_window = (0.0, 0);
        self.last_launch = f64::NEG_INFINITY;
    }

    fn reset_spawn_shots(&mut self) {
        // The client keeps its sequence monotonic across respawns. A scalar floor
        // prevents a delayed old discharge from spending a fresh vehicle's ammo,
        // while all old hit proofs, weapon identities and launch receipts are cleared.
        let floor = self.sequences.iter().copied().chain(self.retired_seq).max();
        self.reset_shots();
        self.retired_seq = floor;
    }

    fn sequence_used(&self, seq: u32) -> bool {
        self.retired_seq.is_some_and(|floor| seq <= floor) || self.sequences.contains(&seq)
    }

    fn remember_sequence(&mut self, seq: u32) {
        self.sequences.push_back(seq);
        if self.sequences.len() > MAX_SEQUENCES {
            let old = self.sequences.pop_front().unwrap();
            self.retired_seq = Some(self.retired_seq.unwrap_or(0).max(old));
        }
    }

    fn spend_round(&mut self, t: &Target) {
        if let Some(before) = self.rounds.or_else(|| (t.def.ammo_capacity > 0).then_some(t.def.ammo_capacity)) {
            let left = before - 1; // zero is refused before accepting the discharge
            self.rounds = Some(left);
            if let Some(st) = self.combat.as_mut() { tg_combat::load_ammo(t, st, left); }
        }
    }

    fn prune_fired(&mut self, now: f64) {
        // Keep the entire burst window, even after a proof's hit validity expires.
        while self.fired.front().is_some_and(|f| now - f.at > 10.0) { self.fired.pop_front(); }
    }
}

#[derive(Clone, Debug)]
pub struct Room {
    pub id: u32,
    pub name: String,
    pub map: String,
    pub max: u32,
    pub host: u32,
    pub members: Vec<u32>,
    pub playing: bool,
    pub deploy: bool,
    /// The years of the vehicles allowed in the room (None: any).
    pub era: Option<[u32; 2]>,
    /// Conquest (a map with capture points): the points and the tickets [blue, red].
    pub points: Vec<PointState>,
    pub tickets: [f64; 2],
    /// Missiles, rockets and active protection in the battle (crates/missile).
    pub world: Option<tg_missile::World>,
}

#[derive(Default)]
pub struct Lobby {
    pub players: BTreeMap<u32, Player>,
    pub rooms: BTreeMap<u32, Room>,
    next_player: u32,
    next_room: u32,
    tick: u64,
    shells: HashMap<String, Shell>,
    /// Vehicles a player may bring (empty: any id).
    vehicles: HashSet<String>,
    /// Each vehicle's year (vehicle.json meta.year), for rooms limited to an era.
    years: HashMap<String, u32>,
    maps: Vec<String>,
    /// The combat model: each vehicle's armour, modules and crew, every shell and bullet.
    targets: HashMap<String, Target>,
    projectiles: HashMap<String, ProjectileDef>,
    bullets: HashMap<String, ProjectileDef>,
    combat_clock: f64,
    /// Capture points by map id.
    map_points: HashMap<String, Vec<CapPoint>>,
    /// The latest time handed to [`Lobby::handle`] (the clock fire and conquest deaths use).
    now: f64,
    /// Missiles, launchers, active protection and the maps' ground (see [`crate::missiles`]).
    mdata: crate::missiles::MissileData,
    token_seed: u64,
    /// Hits refused because the target was nowhere near where the shooter could have seen it.
    pub rejected_hits: u64,
}

fn clean_name(s: &str, fallback: &str) -> String {
    let t: String = s.chars().filter(|c| !c.is_control()).take(MAX_NAME).collect::<String>().trim().to_string();
    if t.is_empty() {
        fallback.to_string()
    } else {
        t
    }
}

fn team_index(t: Team) -> u8 {
    match t {
        Team::Blue => 0,
        Team::Red => 1,
    }
}

/// Whether a member at `me` hears of player `p` on `tick`: near every tick, middle range every 2nd,
/// far or wrecked every 4th. Without positions, every tick.
fn interest(tick: u64, me: Option<[f64; 3]>, p: Option<&Player>) -> bool {
    let Some(p) = p else { return false };
    let every = match (me, p.last_pos) {
        _ if !p.alive => 4,
        (Some(a), Some((b, _))) => {
            let d = ((a[0] - b[0]).powi(2) + (a[2] - b[2]).powi(2)).sqrt();
            if d <= NEAR_M {
                1
            } else if d <= MID_M {
                2
            } else {
                4
            }
        }
        _ => 1,
    };
    // spread over the ticks by id, so the far ones do not all come on the same beat
    (tick + p.id as u64) % every == 0
}

/// A position on a trail at time t, between the samples either side (the last one past its end,
/// for a little while). None before the trail starts.
fn trail_at(trail: &VecDeque<(f64, [f64; 3])>, t: f64) -> Option<[f64; 3]> {
    let (first, last) = (trail.front()?, trail.back()?);
    if t < first.0 - 0.05 {
        return None;
    }
    if t >= last.0 {
        return Some(last.1);
    }
    let i = trail.iter().position(|(at, _)| *at > t).unwrap_or(0).max(1);
    let (a, b) = (&trail[i - 1], &trail[i]);
    let k = ((t - a.0) / (b.0 - a.0).max(1e-6)).clamp(0.0, 1.0);
    Some([0, 1, 2].map(|j| a.1[j] + (b.1[j] - a.1[j]) * k))
}

fn pos_of(s: &Value) -> Option<[f64; 3]> {
    let p = s.get("pos")?.as_array()?;
    if p.len() != 3 {
        return None;
    }
    let mut out = [0.0; 3];
    for (o, v) in out.iter_mut().zip(p) {
        *o = v.as_f64()?;
        if !o.is_finite() || o.abs() > 20_000.0 {
            return None;
        }
    }
    Some(out)
}

impl Lobby {
    pub fn new(shells: HashMap<String, Shell>, vehicles: HashSet<String>, maps: Vec<String>) -> Self {
        Self { shells, vehicles, maps, next_player: 1, next_room: 1, ..Default::default() }
    }

    /// Resolves hits with the combat model: targets by vehicle id, shells by id, bullets by gun id.
    pub fn with_combat(mut self, targets: HashMap<String, Target>, projectiles: HashMap<String, ProjectileDef>, bullets: HashMap<String, ProjectileDef>) -> Self {
        self.targets = targets;
        self.projectiles = projectiles;
        self.bullets = bullets;
        self
    }

    /// The maps' capture points (conquest on every map that has them).
    /// Each vehicle's year, for rooms limited to an era.
    pub fn with_years(mut self, years: HashMap<String, u32>) -> Self {
        self.years = years;
        self
    }

    /// Whether `vehicle` may be brought into a room of `era` (a vehicle of unknown year may not
    /// enter a limited room).
    fn in_era(&self, vehicle: &str, era: Option<[u32; 2]>) -> bool {
        match era {
            None => true,
            Some([a, b]) => self.years.get(vehicle).map(|y| (a..=b).contains(y)).unwrap_or(false),
        }
    }

    fn era_of(&self, id: u32) -> Option<[u32; 2]> {
        self.players.get(&id).and_then(|p| p.room).and_then(|r| self.rooms.get(&r)).and_then(|r| r.era)
    }

    pub fn with_points(mut self, points: HashMap<String, Vec<CapPoint>>) -> Self {
        self.map_points = points;
        self
    }

    /// The missiles, launchers and active protection systems, and the ground they fly over.
    pub fn with_missiles(mut self, m: crate::missiles::MissileData) -> Self {
        self.mdata = m;
        self
    }

    fn err(id: u32, msg: &str) -> Out {
        vec![(id, ServerMsg::Error { msg: msg.into() })]
    }

    /// A new connection: its id and the welcome.
    pub fn connect(&mut self) -> (u32, Out) {
        let id = self.next_player;
        self.next_player += 1;
        let name = format!("車長{id}");
        let token = self.new_token(id);
        self.players.insert(
            id,
            Player { id, name: name.clone(), room: None, team: Team::Blue, slot: 0, vehicle: String::new(), ready: false, hp: FULL_HP, alive: true, kills: 0, deaths: 0, state: None, last_pos: None, trail: VecDeque::new(), rtts: VecDeque::new(), token: token.clone(), away: None, grace_until: 0.0, died_at: 0.0, fired: VecDeque::new(), combat: None, last_attacker: None, mg_window: (0.0, 0), rounds: None, missiles_left: HashMap::new(), last_launch: f64::NEG_INFINITY, launch_receipts: HashMap::new(), sequences: VecDeque::new(), retired_seq: None },
        );
        (id, vec![(id, ServerMsg::Welcome { id, name, maps: self.maps.clone(), token }), (id, self.room_list())])
    }

    /// An unguessable seat token: splitmix64 over a counter, the id and the wall clock.
    fn new_token(&mut self, id: u32) -> String {
        let clock = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0);
        self.token_seed = self.token_seed.wrapping_add(0x9E37_79B9_7F4A_7C15) ^ clock.rotate_left(17) ^ ((id as u64) << 32);
        let mix = |mut z: u64| {
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            z ^ (z >> 31)
        };
        let a = mix(self.token_seed);
        let b = mix(a ^ clock);
        format!("{a:016x}{b:016x}")
    }

    pub fn disconnect(&mut self, id: u32) -> Out {
        let out = self.leave(id);
        self.players.remove(&id);
        out
    }

    /// The connection dropped: in a battle the seat (vehicle, damage, score) is held for a while
    /// for a reconnect; anywhere else the player leaves at once.
    pub fn drop_link(&mut self, id: u32, now: f64) -> Out {
        let in_battle = self.players.get(&id).and_then(|p| p.room).and_then(|r| self.rooms.get(&r)).is_some_and(|r| r.playing);
        if !in_battle {
            return self.disconnect(id);
        }
        if let Some(p) = self.players.get_mut(&id) {
            p.away = Some(now);
        }
        Vec::new()
    }

    /// A new connection (`new_id`, just made by connect) presents a seat token: the seat comes back
    /// to it under its old id. None: no such seat (the client carries on as the new player).
    pub fn resume(&mut self, new_id: u32, token: &str, now: f64) -> Option<(u32, Out)> {
        if token.len() < 16 {
            return None;
        }
        let old = self.players.values().find(|p| p.id != new_id && p.token == token).map(|p| p.id)?;
        // the placeholder from connect() goes; it never joined anything
        if self.players.get(&new_id).is_some_and(|p| p.room.is_none()) {
            self.players.remove(&new_id);
        }
        let token = self.new_token(old);
        let p = self.players.get_mut(&old)?;
        p.away = None;
        p.token = token.clone();
        // its position history jumps: no speed check on the first state back
        p.last_pos = None;
        p.trail.clear();
        p.grace_until = now + SPAWN_GRACE;
        let mut out = vec![(old, ServerMsg::Welcome { id: old, name: p.name.clone(), maps: self.maps.clone(), token })];
        if let Some(room) = p.room {
            out.extend(self.room_changed(room));
        } else {
            out.push((old, self.room_list()));
        }
        Some((old, out))
    }

    /// Lets go of the seats whose connection has been gone longer than RESUME_GRACE.
    pub fn sweep(&mut self, now: f64) -> Out {
        let gone: Vec<u32> = self.players.values().filter(|p| p.away.is_some_and(|t| now - t > RESUME_GRACE)).map(|p| p.id).collect();
        let mut out = Vec::new();
        for id in gone {
            out.extend(self.disconnect(id));
        }
        out
    }

    pub fn room_list(&self) -> ServerMsg {
        ServerMsg::Rooms {
            rooms: self
                .rooms
                .values()
                .map(|r| RoomInfo { id: r.id, name: r.name.clone(), map: r.map.clone(), players: r.members.len(), max: r.max, playing: r.playing, host: self.players.get(&r.host).map(|p| p.name.clone()).unwrap_or_default(), era: r.era })
                .collect(),
        }
    }

    fn member(&self, id: u32) -> Option<Member> {
        let p = self.players.get(&id)?;
        Some(Member { id, name: p.name.clone(), team: p.team, slot: p.slot, vehicle: p.vehicle.clone(), ready: p.ready, kills: p.kills, deaths: p.deaths, hp: p.hp, alive: p.alive })
    }

    fn detail(&self, room: u32) -> Option<RoomDetail> {
        let r = self.rooms.get(&room)?;
        Some(RoomDetail { id: r.id, name: r.name.clone(), map: r.map.clone(), max: r.max, host: r.host, playing: r.playing, deploy: r.deploy, members: r.members.iter().filter_map(|m| self.member(*m)).collect(), era: r.era })
    }

    /// The room's state to everyone in it, and the room list to everyone in the lobby.
    fn room_changed(&self, room: u32) -> Out {
        let mut out = Vec::new();
        if let Some(d) = self.detail(room) {
            for m in &d.members {
                out.push((m.id, ServerMsg::Room { room: d.clone() }));
            }
        }
        out.extend(self.lobby_list());
        out
    }

    fn lobby_list(&self) -> Out {
        let list = self.room_list();
        self.players.values().filter(|p| p.room.is_none()).map(|p| (p.id, list.clone())).collect()
    }

    fn to_room(&self, room: u32, msg: ServerMsg) -> Out {
        self.rooms.get(&room).map(|r| r.members.iter().map(|m| (*m, msg.clone())).collect()).unwrap_or_default()
    }

    /// The team with fewer players, and the first free slot in it.
    fn place(&self, room: u32) -> (Team, u32) {
        let r = &self.rooms[&room];
        let count = |t: Team| r.members.iter().filter(|m| self.players.get(m).map(|p| p.team) == Some(t)).count();
        let team = if count(Team::Red) < count(Team::Blue) { Team::Red } else { Team::Blue };
        let used: HashSet<u32> = r.members.iter().filter_map(|m| self.players.get(m)).filter(|p| p.team == team).map(|p| p.slot).collect();
        let slot = (0..).find(|s| !used.contains(s)).unwrap_or(0);
        (team, slot)
    }

    fn leave(&mut self, id: u32) -> Out {
        let Some(room) = self.players.get(&id).and_then(|p| p.room) else { return Vec::new() };
        if let Some(p) = self.players.get_mut(&id) {
            p.room = None;
            p.ready = false;
            p.state = None;
            p.reset_shots();
        }
        let mut out = vec![(id, ServerMsg::LeftRoom)];
        let empty = match self.rooms.get_mut(&room) {
            Some(r) => {
                r.members.retain(|m| *m != id);
                if r.host == id {
                    if let Some(next) = r.members.first() {
                        r.host = *next;
                    }
                }
                r.members.is_empty()
            }
            None => false,
        };
        if empty {
            self.rooms.remove(&room);
            out.extend(self.lobby_list());
        } else {
            out.extend(self.room_changed(room));
        }
        out.push((id, self.room_list()));
        out
    }

    fn start_msg(&self, room: u32) -> ServerMsg {
        let r = &self.rooms[&room];
        ServerMsg::Start { map: r.map.clone(), members: r.members.iter().filter_map(|m| self.member(*m)).collect() }
    }

    /// A vehicle lost: the death counted, and in conquest its side's tickets.
    fn count_death(&mut self, id: u32) {
        let Some(p) = self.players.get_mut(&id) else { return };
        p.deaths += 1;
        let team = p.team;
        if let Some(r) = p.room.and_then(|r| self.rooms.get_mut(&r)) {
            if r.playing && !r.points.is_empty() {
                let t = &mut r.tickets[team as usize];
                *t = (*t - DEATH_COST).max(0.0);
            }
        }
    }

    /// Off the field (a deploy room's start, joining one under way): waiting on the deploy screen.
    fn bench(&mut self, id: u32) {
        if let Some(p) = self.players.get_mut(&id) {
            p.alive = false;
            p.hp = 0.0;
            p.state = None;
            p.combat = None;
            p.died_at = f64::NEG_INFINITY;
            p.reset_shots();
            p.last_pos = None;
            p.trail.clear();
        }
    }

    fn spawn(&mut self, id: u32, now: f64) {
        let fresh = self.players.get(&id).and_then(|p| {
            let t = self.targets.get(&p.vehicle)?;
            let mut st = t.fresh_state();
            if let Some(n) = p.rounds {
                tg_combat::load_ammo(t, &mut st, n.min(t.def.ammo_capacity));
            }
            Some(st)
        });
        let carried = self.players.get(&id).and_then(|p| self.mdata.launchers.get(&p.vehicle)).cloned().unwrap_or_default();
        if let Some((room, vehicle, team)) = self.players.get(&id).and_then(|p| p.room.map(|r| (r, p.vehicle.clone(), p.team))) {
            let spec = self.mdata.aps.get(&vehicle).cloned();
            if let Some(w) = self.rooms.get_mut(&room).and_then(|r| r.world.as_mut()) {
                match spec {
                    Some(sp) => w.add_aps(id, team_index(team), sp.def, id.wrapping_mul(2_654_435_761)),
                    None => w.remove_aps(id),
                }
            }
        }
        if let Some(p) = self.players.get_mut(&id) {
            p.missiles_left = carried;
            p.hp = FULL_HP;
            p.alive = true;
            p.grace_until = now + SPAWN_GRACE;
            p.last_pos = None;
            p.trail.clear();
            p.combat = fresh;
            p.reset_spawn_shots();
            p.last_attacker = None;
        }
    }

    pub fn handle(&mut self, id: u32, msg: ClientMsg, now: f64) -> Out {
        if !self.players.contains_key(&id) {
            return Vec::new();
        }
        self.now = self.now.max(now);
        match msg {
            ClientMsg::Hello { name, .. } => {
                let fallback = format!("車長{id}");
                let p = self.players.get_mut(&id).expect("player");
                p.name = clean_name(&name, &fallback);
                let mut out = vec![(id, ServerMsg::Welcome { id, name: p.name.clone(), maps: self.maps.clone(), token: p.token.clone() })];
                if let Some(room) = p.room {
                    out.extend(self.room_changed(room));
                }
                out
            }
            ClientMsg::List => vec![(id, self.room_list())],
            ClientMsg::Create { name, map, max, deploy, era } => {
                if self.rooms.len() >= MAX_ROOMS {
                    return Self::err(id, "房間已滿，請稍後再試");
                }
                if !self.maps.is_empty() && !self.maps.contains(&map) {
                    return Self::err(id, "沒有這張地圖");
                }
                let era = era.map(|[a, b]| [a.min(b).clamp(1900, 2100), a.max(b).clamp(1900, 2100)]);
                let mut out = self.leave(id);
                let rid = self.next_room;
                self.next_room += 1;
                let pname = self.players[&id].name.clone();
                self.rooms.insert(rid, Room { id: rid, name: clean_name(&name, &format!("{pname} 的房間")), map, max: max.clamp(2, 16), host: id, members: vec![id], playing: false, deploy, era, points: Vec::new(), tickets: [TICKETS; 2], world: None });
                let (team, slot) = (Team::Blue, 0);
                if let Some(p) = self.players.get_mut(&id) {
                    p.room = Some(rid);
                    p.team = team;
                    p.slot = slot;
                    p.ready = false;
                    p.kills = 0;
                    p.deaths = 0;
                }
                out.extend(self.room_changed(rid));
                out
            }
            ClientMsg::Join { room } => {
                let Some(r) = self.rooms.get(&room) else { return Self::err(id, "房間不存在") };
                if r.members.contains(&id) {
                    return self.room_changed(room);
                }
                if r.members.len() >= r.max as usize {
                    return Self::err(id, "房間已滿");
                }
                let mut out = self.leave(id);
                let (team, slot) = self.place(room);
                let (playing, deploy) = {
                    let r = self.rooms.get_mut(&room).expect("room");
                    r.members.push(id);
                    (r.playing, r.deploy)
                };
                if let Some(p) = self.players.get_mut(&id) {
                    p.room = Some(room);
                    p.team = team;
                    p.slot = slot;
                    p.ready = false;
                    p.kills = 0;
                    p.deaths = 0;
                }
                out.extend(self.room_changed(room));
                if playing {
                    // a battle under way: straight in at the team's start (or to the deploy screen)
                    if deploy {
                        self.bench(id);
                    } else {
                        self.spawn(id, now);
                    }
                    out.push((id, self.start_msg(room)));
                }
                out
            }
            ClientMsg::Leave => self.leave(id),
            ClientMsg::Vehicle { id: v } => {
                if !self.vehicles.is_empty() && !self.vehicles.contains(&v) {
                    return Self::err(id, "聯機只能使用一般車輛");
                }
                if let Some([a, b]) = self.era_of(id).filter(|_| !self.in_era(&v, self.era_of(id))) {
                    return Self::err(id, &format!("這個房間只能用 {a}–{b} 年的車輛"));
                }
                let p = self.players.get_mut(&id).expect("player");
                if p.room.and_then(|r| self.rooms.get(&r)).map(|r| r.playing).unwrap_or(false) {
                    // the vehicle on the field stays what it is until the battle is over
                    return Vec::new();
                }
                p.vehicle = v;
                match p.room {
                    Some(r) => self.room_changed(r),
                    None => Vec::new(),
                }
            }
            ClientMsg::Ready { ready } => {
                let p = self.players.get_mut(&id).expect("player");
                p.ready = ready;
                match p.room {
                    Some(r) => self.room_changed(r),
                    None => Vec::new(),
                }
            }
            ClientMsg::Start => {
                let Some(room) = self.players[&id].room else { return Self::err(id, "不在房間裡") };
                let r = &self.rooms[&room];
                if r.host != id {
                    return Self::err(id, "只有房主可以開始");
                }
                if r.playing {
                    return Vec::new();
                }
                let members = r.members.clone();
                let deploy = r.deploy;
                if !deploy && members.iter().any(|m| self.players.get(m).map(|p| p.vehicle.is_empty()).unwrap_or(true)) {
                    return Self::err(id, "還有人沒選車");
                }
                if !deploy && members.iter().any(|m| self.players.get(m).map(|p| !self.in_era(&p.vehicle, r.era)).unwrap_or(false)) {
                    return Self::err(id, "有人的車輛不在這個房間的年代內");
                }
                let points: Vec<PointState> = self
                    .map_points
                    .get(&r.map)
                    .map(|ps| ps.iter().map(|c| PointState { id: c.id.clone(), x: c.x, z: c.z, r: c.r, owner: None, progress: 0.0, blue: 0, red: 0 }).collect())
                    .unwrap_or_default();
                {
                    let r = self.rooms.get_mut(&room).expect("room");
                    r.playing = true;
                    r.points = points;
                    r.tickets = [TICKETS; 2];
                    let mut w = tg_missile::World::new(self.mdata.defs.clone());
                    if let Some(g) = self.mdata.grids.get(&r.map) {
                        w.terrain = g.clone();
                    }
                    r.world = Some(w);
                }
                for m in &members {
                    if let Some(p) = self.players.get_mut(m) { p.reset_shots(); }
                    if deploy {
                        self.bench(*m);
                    } else {
                        self.spawn(*m, now);
                    }
                }
                let mut out = self.to_room(room, self.start_msg(room));
                out.extend(self.room_changed(room));
                out
            }
            ClientMsg::End => {
                let Some(room) = self.players[&id].room else { return Vec::new() };
                let Some(r) = self.rooms.get_mut(&room) else { return Vec::new() };
                if r.host != id {
                    return Self::err(id, "只有房主可以結束");
                }
                if !r.playing {
                    return Vec::new();
                }
                self.end_battle(room, None)
            }
            ClientMsg::Team { team } => {
                let Some(room) = self.players[&id].room else { return Vec::new() };
                let r = &self.rooms[&room];
                if r.playing {
                    return Self::err(id, "戰鬥中不能換邊");
                }
                if self.players[&id].team == team {
                    return Vec::new();
                }
                let on_side = r.members.iter().filter(|m| self.players.get(m).map(|p| p.team) == Some(team)).count();
                if on_side as u32 >= r.max.div_ceil(2) {
                    return Self::err(id, "那一邊已經滿了");
                }
                let used: HashSet<u32> = r.members.iter().filter_map(|m| self.players.get(m)).filter(|p| p.team == team).map(|p| p.slot).collect();
                let slot = (0..).find(|s| !used.contains(s)).unwrap_or(0);
                if let Some(p) = self.players.get_mut(&id) {
                    p.team = team;
                    p.slot = slot;
                    p.ready = false;
                }
                self.room_changed(room)
            }
            ClientMsg::State { s } => {
                let p = self.players.get_mut(&id).expect("player");
                let Some(room) = p.room else { return Vec::new() };
                if !self.rooms.get(&room).map(|r| r.playing).unwrap_or(false) {
                    return Vec::new();
                }
                let Some(pos) = pos_of(&s) else { return Vec::new() };
                if let Some((last, at)) = p.last_pos {
                    let dt = (now - at).max(0.02);
                    let d = ((pos[0] - last[0]).powi(2) + (pos[2] - last[2]).powi(2)).sqrt();
                    if now > p.grace_until && d / dt > MAX_SPEED {
                        // a jump no vehicle can drive: keep the last good state
                        return Vec::new();
                    }
                }
                p.last_pos = Some((pos, now));
                p.trail.push_back((now, pos));
                while p.trail.front().is_some_and(|(t, _)| now - t > TRAIL) {
                    p.trail.pop_front();
                }
                p.state = Some(s);
                Vec::new()
            }
            ClientMsg::Fire { seq, instance, o, d, shell } => self.fire(id, seq, instance.as_deref(), o, d, &shell, now),
            ClientMsg::MgFire { seq, instance, gun, o, d } => self.mg_fire(id, seq, instance.as_deref(), &gun, o, d, now),
            ClientMsg::Hit { seq, target, result, plate, shot } => match shot {
                Some(shot) if self.can_resolve(target) => self.combat_hit(id, Some(seq), None, None, target, &shot, now),
                _ => self.hit(id, seq, target, &result, plate, now),
            },
            ClientMsg::MgHit { seq, instance, target, gun, shot } => {
                if !self.can_resolve(target) {
                    return Vec::new();
                }
                self.combat_hit(id, seq, Some(gun), instance.as_deref(), target, &shot, now)
            }
            ClientMsg::Repair => self.repair(id, true),
            ClientMsg::Extinguish => self.repair(id, false),
            ClientMsg::Respawn => {
                let p = &self.players[&id];
                let Some(room) = p.room else { return Vec::new() };
                if !self.rooms.get(&room).map(|r| r.playing).unwrap_or(false) {
                    return Vec::new();
                }
                if p.alive {
                    // stuck or drowned: the crew bail out (it counts as a death), back in after the delay
                    let p = self.players.get_mut(&id).expect("player");
                    p.alive = false;
                    p.hp = 0.0;
                    p.died_at = now;
                    if let Some(c) = p.combat.as_mut() {
                        c.destroyed = true;
                    }
                    self.count_death(id);
                    let mut out = self.to_room(room, ServerMsg::Damage { target: id, from: id, result: "scuttle".into(), plate: None, hp: 0.0, killed: true, report: None });
                    out.extend(self.room_changed(room));
                    return out;
                }
                if now - p.died_at < RESPAWN_DELAY {
                    return Self::err(id, "還不能重生");
                }
                // a fresh vehicle with full racks
                self.players.get_mut(&id).expect("player").rounds = None;
                self.spawn(id, now);
                let vehicle = self.players[&id].vehicle.clone();
                let mut out = self.to_room(room, ServerMsg::Respawned { id, vehicle, spawn: 0 });
                out.extend(self.room_changed(room));
                out
            }
            ClientMsg::Deploy { vehicle, spawn, rounds } => {
                let p = &self.players[&id];
                let Some(room) = p.room else { return Vec::new() };
                let Some(r) = self.rooms.get(&room) else { return Vec::new() };
                if !r.playing || !r.deploy {
                    return Self::err(id, "現在不能出擊");
                }
                if p.alive {
                    return Vec::new();
                }
                if now - p.died_at < RESPAWN_DELAY {
                    return Self::err(id, "還不能出擊");
                }
                if !r.points.is_empty() && r.tickets[p.team as usize] <= 0.0 {
                    return Self::err(id, "我方兵力已耗盡");
                }
                if vehicle.is_empty() || (!self.vehicles.is_empty() && !self.vehicles.contains(&vehicle)) {
                    return Self::err(id, "聯機只能使用一般車輛");
                }
                if let Some([a, b]) = r.era.filter(|_| !self.in_era(&vehicle, r.era)) {
                    return Self::err(id, &format!("這個房間只能用 {a}–{b} 年的車輛"));
                }
                let spawn = spawn.min(15);
                let cap = self.targets.get(&vehicle).map(|t| t.def.ammo_capacity).unwrap_or(0);
                let p = self.players.get_mut(&id).expect("player");
                p.vehicle = vehicle.clone();
                p.rounds = rounds.filter(|_| cap > 0).map(|n| n.min(cap));
                self.spawn(id, now);
                let mut out = self.to_room(room, ServerMsg::Respawned { id, vehicle, spawn });
                out.extend(self.room_changed(room));
                out
            }
            ClientMsg::Launch { seq, instance, missile, o, d } => self.launch_instance(id, seq, instance.as_deref(), &missile, o, d, now),
            ClientMsg::Guide { id: mid, sight, aim } => {
                let Some(room) = self.players.get(&id).and_then(|p| if p.alive { p.room } else { None }) else { return Vec::new() };
                let near = self.players[&id].state.as_ref().and_then(pos_of).map(|p| ((p[0] - sight[0]).powi(2) + (p[2] - sight[2]).powi(2)).sqrt() < 20.0).unwrap_or(false);
                if near {
                    if let Some(w) = self.rooms.get_mut(&room).and_then(|r| r.world.as_mut()) {
                        w.guide(mid, id, sight, aim);
                    }
                }
                Vec::new()
            }
            ClientMsg::MissileEnd { id: mid } => {
                let Some(room) = self.players.get(&id).and_then(|p| p.room) else { return Vec::new() };
                if let Some(w) = self.rooms.get_mut(&room).and_then(|r| r.world.as_mut()) {
                    if w.missile(mid).map(|m| m.owner == id).unwrap_or(false) {
                        w.end(mid, tg_missile::MStatus::Struck);
                    }
                }
                Vec::new()
            }
            ClientMsg::Aps { enabled, rate } => {
                let Some(room) = self.players.get(&id).and_then(|p| p.room) else { return Vec::new() };
                if let Some(w) = self.rooms.get_mut(&room).and_then(|r| r.world.as_mut()) {
                    w.set_aps(id, enabled, rate.filter(|r| r.is_finite()));
                }
                Vec::new()
            }
            ClientMsg::Chat { text } => {
                let p = &self.players[&id];
                let Some(room) = p.room else { return Vec::new() };
                let text: String = text.chars().filter(|c| !c.is_control()).take(200).collect();
                if text.trim().is_empty() {
                    return Vec::new();
                }
                self.to_room(room, ServerMsg::Chat { from: id, name: p.name.clone(), text })
            }
            ClientMsg::Ping { at, rtt } => {
                if let (Some(ms), Some(p)) = (rtt, self.players.get_mut(&id)) {
                    if ms.is_finite() && ms >= 0.0 {
                        p.rtts.push_back(ms.min(2000.0) / 1000.0);
                        if p.rtts.len() > RTT_SAMPLES {
                            p.rtts.pop_front();
                        }
                    }
                }
                vec![(id, ServerMsg::Pong { at })]
            }
        }
    }

    /// A shooter reports what its shot `seq` did to `target`.
    fn hit(&mut self, id: u32, seq: u32, target: u32, result: &str, plate: Option<String>, now: f64) -> Out {
        let (room, team) = {
            let p = &self.players[&id];
            (p.room, p.team)
        };
        let Some(room) = room else { return Vec::new() };
        let Some(t) = self.players.get(&target) else { return Vec::new() };
        if t.room != Some(room) || target == id || t.team == team || !t.alive || !self.rooms[&room].playing {
            return Vec::new();
        }
        if !matches!(result, "pen" | "kill" | "nopen" | "ricochet" | "track") {
            return Vec::new();
        }
        // the shot must be one this player fired, not too long ago, and not counted yet
        let shell = {
            let p = self.players.get_mut(&id).expect("player");
            let Some(f) = p.fired.iter_mut().find(|f| f.seq == seq && f.kind == WeaponKind::Cannon && !f.used && now - f.at <= SHOT_LIFE) else { return Vec::new() };
            f.used = true;
            f.shell.clone()
        };
        let through = matches!(result, "pen" | "kill");
        let damage = if through { self.shells.get(&shell).map(|s| s.damage()).unwrap_or(55.0) } else { 0.0 };
        let (hp, killed) = {
            let t = self.players.get_mut(&target).expect("target");
            t.hp = (t.hp - damage).max(0.0);
            let killed = t.hp <= 0.0;
            if killed {
                t.alive = false;
                t.died_at = now;
            }
            (t.hp, killed)
        };
        if killed {
            self.count_death(target);
            if let Some(p) = self.players.get_mut(&id) {
                p.kills += 1;
            }
        }
        let shown = if killed { "kill" } else if through { "pen" } else { result };
        let mut out = self.to_room(room, ServerMsg::Damage { target, from: id, result: shown.into(), plate, hp, killed, report: None });
        if killed {
            out.extend(self.room_changed(room));
        }
        out
    }

    /// Authoritative mount selection; no damage/capability fields in NetState are trusted.
    fn own_weapon(&self, id: u32, instance: Option<&str>, model: Option<&str>, ammo: Option<&str>, missile: Option<&str>, kind: WeaponKind) -> Result<String, String> {
        let p = &self.players[&id];
        if let Some(t) = self.targets.get(&p.vehicle) {
            let fresh;
            let st = if let Some(st) = &p.combat { st } else { fresh = t.fresh_state(); &fresh };
            let b = select_weapon(t, st, instance, model, ammo, missile)?;
            if b.kind != kind { return Err("wrong weapon kind".into()); }
            return Ok(b.key.clone());
        }
        Err("vehicle weapon data unavailable".into())
    }

    fn reject_fire(id: u32, seq: u32, reason: &str) -> Out {
        vec![(id, ServerMsg::FireRejected { seq, reason: reason.into() })]
    }

    #[allow(clippy::too_many_arguments)]
    fn fire(&mut self, id: u32, seq: u32, instance: Option<&str>, o: [f64; 3], d: [f64; 3], shell: &str, now: f64) -> Out {
        let p = &self.players[&id];
        let Some(room) = p.room else { return Self::reject_fire(id, seq, "not_in_room") };
        if !p.alive { return Self::reject_fire(id, seq, "destroyed"); }
        if !self.rooms.get(&room).is_some_and(|r| r.playing) { return Self::reject_fire(id, seq, "not_in_battle"); }
        let length: f64 = d.iter().map(|x| x*x).sum();
        if !o.iter().chain(d.iter()).all(|x| x.is_finite()) || (length.sqrt()-1.0).abs() > 0.05 { return Self::reject_fire(id, seq, "invalid_shot"); }
        if p.sequence_used(seq) { return Self::reject_fire(id, seq, "sequence_conflict"); }
        if !self.shells.contains_key(shell) && !self.projectiles.contains_key(shell) { return Self::reject_fire(id, seq, "unknown_ammo"); }
        let selected = match self.own_weapon(id, instance, None, Some(shell), None, WeaponKind::Cannon) {
            Ok(key) => key,
            Err(_) => return Self::reject_fire(id, seq, "weapon_disabled"),
        };
        let aps_shell = self.mdata.aps.get(&p.vehicle).is_some_and(|spec| {
            let Some(t) = self.targets.get(&p.vehicle) else { return false };
            t.weapon_bindings[&selected].critical.iter().any(|&i| Some(&t.def.modules[i].id) == spec.gun_module.as_ref())
        });
        if !aps_shell && p.rounds == Some(0) { return Self::reject_fire(id, seq, "no_ammo"); }
        let small = self.shells.get(shell).map(|s| s.caliber_mm).or_else(|| self.projectiles.get(shell).map(|s| s.caliber_mm as f64)).is_some_and(|c| c > 0.0 && c <= AUTOCANNON_MM);
        let p = self.players.get_mut(&id).unwrap();
        p.prune_fired(now);
        let count = p.fired.iter().filter(|f| f.small == small).count();
        if count >= if small { AUTO_BURST } else { FIRE_BURST } { return Self::reject_fire(id, seq, "rate_limited"); }
        if aps_shell {
            let Some(w) = self.rooms.get_mut(&room).and_then(|r| r.world.as_mut()) else { return Self::reject_fire(id, seq, "weapon_disabled") };
            let Some(a) = w.aps_of(id) else { return Self::reject_fire(id, seq, "weapon_disabled") };
            if a.enabled { return Self::reject_fire(id, seq, "automatic_protection"); }
            if a.rounds == 0 { return Self::reject_fire(id, seq, "no_ammo"); }
            let left = a.rounds - 1;
            w.set_aps_rounds(id, false, None, Some(left));
        } else if let Some(t) = self.targets.get(&p.vehicle) {
            p.spend_round(t);
        }
        p.remember_sequence(seq);
        p.fired.push_back(Fired { seq, at: now, shell: shell.into(), used: false, small, kind: WeaponKind::Cannon, instance: selected });
        let msg = ServerMsg::Fire { from: id, seq, o, d, shell: shell.into() };
        let mut out: Out = self.to_room(room, msg).into_iter().filter(|(to,_)| *to != id).collect();
        out.push((id, ServerMsg::FireAccepted { seq }));
        out
    }

    #[allow(clippy::too_many_arguments)]
    fn mg_fire(&mut self, id: u32, seq: u32, instance: Option<&str>, gun: &str, o: [f64; 3], d: [f64; 3], now: f64) -> Out {
        let p = &self.players[&id];
        if !p.alive || p.sequence_used(seq) || !p.room.and_then(|r| self.rooms.get(&r)).is_some_and(|r| r.playing) { return Vec::new(); }
        let length: f64 = d.iter().map(|x| x*x).sum();
        if !o.iter().chain(d.iter()).all(|x| x.is_finite()) || (length.sqrt()-1.0).abs() > 0.05 || !self.bullets.contains_key(gun) { return Vec::new(); }
        let selected = match self.own_weapon(id, instance, Some(gun), None, None, WeaponKind::MachineGun) {
            Ok(key) => key,
            Err(_) => return Vec::new(),
        };
        let p = self.players.get_mut(&id).unwrap();
        p.prune_fired(now);
        if p.fired.iter().filter(|f| f.small).count() >= AUTO_BURST { return Vec::new(); }
        p.remember_sequence(seq);
        p.fired.push_back(Fired { seq, at: now, shell: gun.into(), used: false, small: true, kind: WeaponKind::MachineGun, instance: selected });
        Vec::new()
    }

    /// Whether a hit on `target` can go through the combat model (its vehicle's data is loaded).
    fn can_resolve(&self, target: u32) -> bool {
        self.players.get(&target).map(|t| t.combat.is_some() && self.targets.contains_key(&t.vehicle)).unwrap_or(false)
    }

    /// A shell (`seq`) or a bullet (`gun`) that struck `target`, resolved by the combat model.
    fn combat_hit(&mut self, id: u32, seq: Option<u32>, gun: Option<String>, instance: Option<&str>, target: u32, shot: &WireShot, now: f64) -> Out {
        let Some(shooter) = self.players.get(&id) else { return Vec::new() };
        let (room, team, alive) = (shooter.room, shooter.team, shooter.alive);
        let Some(room) = room else { return Vec::new() };
        let Some(t) = self.players.get(&target) else { return Vec::new() };
        if (seq.is_none() && !alive) || t.room != Some(room) || target == id || t.team == team || !t.alive || !self.rooms.get(&room).map(|r| r.playing).unwrap_or(false) {
            return Vec::new();
        }
        // a sane line: finite, a unit direction, starting near the vehicle
        let o = Vec3::new(shot.o[0], shot.o[1], shot.o[2]);
        let d = Vec3::new(shot.d[0], shot.d[1], shot.d[2]);
        let finite = shot.o.iter().chain(shot.d.iter()).chain([shot.yaw, shot.speed, shot.dist].iter()).all(|x| x.is_finite());
        if !finite || (d.length() - 1.0).abs() > 0.05 || o.length() > 60.0 || shot.speed <= 0.0 || shot.speed > 2000.0 {
            return Vec::new();
        }
        // the round: a shell this player fired (once, recently), or a bullet within the burst limit
        // where the two were when the round flew, as the shooter saw it
        let fired_at = match seq {
            Some(seq) => self.players[&id].fired.iter().find(|f| f.seq == seq && !f.used && now - f.at <= SHOT_LIFE).map(|f| f.at),
            None => Some(now - (shot.dist / shot.speed) as f64),
        };
        if let Some(at) = fired_at {
            if !self.hit_plausible(id, target, at, shot.dist as f64, shot.speed as f64) {
                self.rejected_hits += 1;
                return Vec::new();
            }
        }
        let (shell, seed) = match (seq, &gun) {
            (Some(seq), g) => {
                let kind = if g.is_some() { WeaponKind::MachineGun } else { WeaponKind::Cannon };
                let p = self.players.get_mut(&id).expect("player");
                let Some(f) = p.fired.iter_mut().find(|f| f.seq == seq && f.kind == kind && !f.used && now - f.at <= SHOT_LIFE
                    && g.as_ref().is_none_or(|g| *g == f.shell) && (g.is_none() || instance == Some(f.instance.as_str()))) else { return Vec::new() };
                let def = if kind == WeaponKind::MachineGun { self.bullets.get(&f.shell) } else { self.projectiles.get(&f.shell) };
                let Some(def) = def else { return Vec::new() };
                f.used = true;
                (def.clone(), shot_seed(id, seq))
            }
            (None, Some(g)) => {
                if self.own_weapon(id, instance, Some(g), None, None, WeaponKind::MachineGun).is_err() { return Vec::new(); }
                let p = self.players.get_mut(&id).expect("player");
                if now - p.mg_window.0 > 1.0 { p.mg_window = (now, 0); }
                if p.mg_window.1 >= 40 { return Vec::new(); }
                let Some(def) = self.bullets.get(g) else { return Vec::new() };
                p.mg_window.1 += 1;
                (def.clone(), shot_seed(id, 1_000_000 + p.mg_window.1 + (now * 20.0) as u32))
            }
            _ => return Vec::new(),
        };
        let mg = gun.is_some();
        self.apply_shot(id, room, target, shell, o, d.normalized(), shot.speed, shot.dist, seed, shot.yaw, mg, now)
    }

    /// The shooter's one-way delay: half the median of the round trips it reported (s).
    fn one_way(&self, id: u32) -> f64 {
        let Some(p) = self.players.get(&id) else { return 0.0 };
        if p.rtts.is_empty() {
            return 0.0;
        }
        let mut v: Vec<f64> = p.rtts.iter().copied().collect();
        v.sort_by(|a, b| a.total_cmp(b));
        v[v.len() / 2] / 2.0
    }

    /// A hit claimed for a round fired at `fired_at` (server time) over `dist` m at `speed` m/s
    /// holds if, somewhere in the window the shooter could have seen, the target stood about that
    /// far from where the shooter fired. No history yet (just spawned, states not in): believed.
    fn hit_plausible(&self, id: u32, target: u32, fired_at: f64, dist: f64, speed: f64) -> bool {
        let (Some(a), Some(b)) = (self.players.get(&id), self.players.get(&target)) else { return true };
        let Some(from) = trail_at(&a.trail, fired_at) else { return true };
        if b.trail.is_empty() {
            return true;
        }
        let flight = if speed > 1.0 { dist / speed } else { 0.0 };
        let back = (self.one_way(id) + CLIENT_INTERP).min(MAX_REWIND + CLIENT_INTERP) + 0.1;
        let (t0, t1) = (fired_at + flight - back, fired_at + flight + 0.15);
        // the vehicles' own size, the aim point on the hull and the 20 Hz sampling
        let tol = 15.0 + dist * 0.05;
        let mut t = t0;
        while t <= t1 + 1e-9 {
            if let Some(p) = trail_at(&b.trail, t) {
                let d = ((p[0] - from[0]).powi(2) + (p[1] - from[1]).powi(2) + (p[2] - from[2]).powi(2)).sqrt();
                if (d - dist).abs() <= tol {
                    return true;
                }
            } else {
                return true;
            }
            t += 0.025;
        }
        false
    }

    /// A round (shell, bullet or missile warhead) through `target`'s armour, modules and crew:
    /// the state kept, a kill counted, the report to the room. o, d: the line in its hull frame.
    #[allow(clippy::too_many_arguments)]
    fn apply_shot(&mut self, id: u32, room: u32, target: u32, shell: ProjectileDef, o: Vec3, d: Vec3, speed: f32, dist: f32, seed: u64, yaw: f32, mg: bool, now: f64) -> Out {
        let vehicle = self.players[&target].vehicle.clone();
        let Some(tgt) = self.targets.get(&vehicle) else { return Vec::new() };
        let fold = self.players[&target].state.as_ref().map(crate::missiles::fold_of).unwrap_or(0.0);
        let folded = if fold > 0.0 && tgt.has_hinges() { Some(tgt.folded(fold)) } else { None };
        let tgt = folded.as_ref().unwrap_or(tgt);
        let before = self.players[&target].combat.clone().unwrap_or_else(|| tgt.fresh_state());
        let r = tg_combat::shoot(tgt, &before, &tg_combat::Shot { shell, origin: o, dir: d, speed_ms: speed, distance_m: dist, seed, turret_yaw: yaw });
        if mg && r.modules.is_empty() && r.crew.is_empty() && !r.caps.destroyed {
            return Vec::new(); // a bullet that did nothing is not worth telling anyone
        }
        let killed = r.caps.destroyed && !before.destroyed;
        let hp = if r.caps.crew_total > 0 { FULL_HP * r.caps.crew_alive as f64 / r.caps.crew_total as f64 } else { FULL_HP };
        {
            let t = self.players.get_mut(&target).expect("target");
            t.combat = Some(r.state.clone());
            t.hp = if r.caps.destroyed { 0.0 } else { hp };
            t.last_attacker = Some(id);
            if killed {
                t.alive = false;
                t.died_at = now;
            }
        }
        if killed {
            self.count_death(target);
            if let Some(p) = self.players.get_mut(&id) {
                p.kills += 1;
            }
        }
        let result = serde_json::to_value(r.outcome).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default();
        let msg = ServerMsg::Damage { target, from: id, result, plate: r.plate.clone(), hp: if killed { 0.0 } else { hp }, killed, report: serde_json::to_value(&r).ok() };
        let mut out = self.to_room(room, msg);
        if killed {
            out.extend(self.room_changed(room));
        }
        out
    }

    /// The player starts a field repair (or puts out a fire) of their own vehicle.
    fn repair(&mut self, id: u32, repair: bool) -> Out {
        let Some(p) = self.players.get(&id) else { return Vec::new() };
        let Some(room) = p.room else { return Vec::new() };
        let Some(t) = self.targets.get(&p.vehicle) else { return Vec::new() };
        let Some(mut st) = p.combat.clone() else { return Vec::new() };
        if !p.alive {
            return Vec::new();
        }
        let ok = if repair { tg_combat::start_repair(t, &mut st) } else { tg_combat::extinguish(&mut st) };
        if !ok {
            return Self::err(id, if repair { "沒有需要修理的模組" } else { "沒有起火或滅火器已用完" });
        }
        let caps = tg_combat::caps(t, &st);
        if let Some(p) = self.players.get_mut(&id) {
            p.combat = Some(st.clone());
        }
        let ev = if repair { "repair_started" } else { "extinguished" };
        self.to_room(room, ServerMsg::Status { id, state: serde_json::to_value(&st).unwrap_or(Value::Null), caps: serde_json::to_value(&caps).unwrap_or(Value::Null), events: vec![ev.into()] })
    }

    /// Time passing for the battles' damage: fire, crew changing seats, repairs. A vehicle that
    /// burns out is credited to whoever last hit it.
    pub fn advance_combat(&mut self, dt: f64) -> Broadcast {
        self.combat_clock += dt;
        let mut out: Broadcast = Vec::new();
        let playing: Vec<(u32, Vec<u32>)> = self.rooms.values().filter(|r| r.playing).map(|r| (r.id, r.members.clone())).collect();
        for (room, members) in playing {
            for &id in &members {
                let Some(p) = self.players.get(&id) else { continue };
                let Some(st) = p.combat.as_ref() else { continue };
                if !(st.fire_s > 0.0 || st.repair_s > 0.0 || !st.swaps.is_empty()) {
                    continue;
                }
                let Some(t) = self.targets.get(&p.vehicle) else { continue };
                let mut st = st.clone();
                let was = st.destroyed;
                let seed = shot_seed(id, (self.combat_clock * 4.0) as u32);
                let events = tg_combat::advance(t, &mut st, dt as f32, seed);
                let caps = tg_combat::caps(t, &st);
                let burned_out = st.destroyed && !was;
                let attacker = p.last_attacker;
                if let Some(p) = self.players.get_mut(&id) {
                    p.combat = Some(st.clone());
                    if burned_out {
                        p.alive = false;
                        p.hp = 0.0;
                        p.died_at = self.now;
                    }
                }
                if burned_out {
                    self.count_death(id);
                }
                if !events.is_empty() {
                    out.push((members.clone(), ServerMsg::Status { id, state: serde_json::to_value(&st).unwrap_or(Value::Null), caps: serde_json::to_value(&caps).unwrap_or(Value::Null), events }));
                }
                if burned_out {
                    let from = attacker.unwrap_or(id);
                    if from != id {
                        if let Some(a) = self.players.get_mut(&from) {
                            a.kills += 1;
                        }
                    }
                    out.push((members.clone(), ServerMsg::Damage { target: id, from, result: "fire".into(), plate: None, hp: 0.0, killed: true, report: None }));
                    for (to, m) in self.room_changed(room) {
                        out.push((vec![to], m));
                    }
                }
            }
        }
        out
    }

    /// 20 times a second: every battle's vehicles to everyone in it.
    pub fn tick(&mut self) -> Broadcast {
        self.tick += 1;
        let mut out = Vec::new();
        if self.tick % 5 == 0 {
            out.extend(self.conquest(CONQUEST_DT));
        }
        let skies = self.step_missiles(1.0 / 20.0, &mut out);
        for r in self.rooms.values().filter(|r| r.playing) {
            let players: Vec<SnapPlayer> = r
                .members
                .iter()
                .filter_map(|m| self.players.get(m))
                .filter_map(|p| p.state.as_ref().map(|s| SnapPlayer { id: p.id, s: s.clone(), hp: p.hp, alive: p.alive }))
                .collect();
            if players.is_empty() {
                continue;
            }
            let (ms, aps, ev, fired) = skies.get(&r.id).cloned().unwrap_or_default();
            // who each member hears of this tick; members hearing the same set share one message
            let mut groups: BTreeMap<Vec<u32>, Vec<u32>> = BTreeMap::new();
            for m in &r.members {
                let me = self.players.get(m).and_then(|p| p.last_pos.map(|(q, _)| q));
                let set: Vec<u32> = players.iter().filter(|p| p.id == *m || interest(self.tick, me, self.players.get(&p.id))).map(|p| p.id).collect();
                groups.entry(set).or_default().push(*m);
            }
            for (set, to) in groups {
                let list: Vec<SnapPlayer> = players.iter().filter(|p| set.contains(&p.id)).cloned().collect();
                // nothing new for them: only skip when there is no news from the sky either
                if list.is_empty() && ms.is_empty() && aps.is_empty() && ev.is_empty() && fired.is_empty() {
                    continue;
                }
                out.push((to, ServerMsg::Snap { tick: self.tick, players: list, ms: ms.clone(), aps: aps.clone(), ev: ev.clone(), fired: fired.clone() }));
            }
        }
        out
    }
}

type Sky = (Vec<Value>, Vec<Value>, Vec<Value>, Vec<Value>);

impl Lobby {
    fn reject_launch(id: u32, seq: u32, reason: &str, retry_after_s: f64) -> Out {
        vec![(id, ServerMsg::LaunchRejected { seq, reason: reason.into(), retry_after_s })]
    }

    /// A player launches a missile or rocket their vehicle carries.
    #[cfg(test)]
    fn launch(&mut self, id: u32, seq: u32, missile: &str, o: [f64; 3], d: [f64; 3], now: f64) -> Out {
        self.launch_instance(id, seq, None, missile, o, d, now)
    }

    fn launch_instance(&mut self, id: u32, seq: u32, instance: Option<&str>, missile: &str, o: [f64; 3], d: [f64; 3], now: f64) -> Out {
        if let Some(p) = self.players.get_mut(&id) { p.launch_receipts.retain(|_, r| now - r.at <= LAUNCH_RECEIPT_LIFE); }
        let Some(p) = self.players.get(&id) else { return Self::reject_launch(id, seq, "unknown_player", 0.0) };
        if let Some(receipt) = p.launch_receipts.get(&seq) {
            if let ServerMsg::Launched { missile: original, o: origin, d: direction, .. } = &receipt.message {
                if original.as_str() == missile && *origin == o && *direction == d
                    && (instance == receipt.request_instance.as_deref() || (instance.is_some() && instance == Some(receipt.instance.as_str()))) {
                    return vec![(id, receipt.message.clone())];
                }
            }
            return Self::reject_launch(id, seq, "sequence_conflict", 0.0);
        }
        if p.sequence_used(seq) { return Self::reject_launch(id, seq, "sequence_conflict", 0.0); }
        let Some(room) = p.room else { return Self::reject_launch(id, seq, "not_in_room", 0.0) };
        if !p.alive { return Self::reject_launch(id, seq, "destroyed", 0.0); }
        let direction_length_sq: f64 = d.iter().map(|v| v * v).sum();
        if !o.iter().chain(d.iter()).all(|x| x.is_finite()) || !direction_length_sq.is_finite() || direction_length_sq < 1e-12 {
            return Self::reject_launch(id, seq, "invalid_launch", 0.0);
        }
        if !self.rooms.get(&room).is_some_and(|r| r.playing && r.world.is_some()) {
            return Self::reject_launch(id, seq, "not_in_battle", 0.0);
        }
        let selected = match self.own_weapon(id, instance, None, None, Some(missile), WeaponKind::Missile) {
            Ok(key) => key,
            Err(_) => return Self::reject_launch(id, seq, "weapon_disabled", 0.0),
        };
        // from the vehicle, from what it carries, not faster than a launcher can
        let near = p.state.as_ref().and_then(pos_of).map(|q| ((q[0] - o[0]).powi(2) + (q[2] - o[2]).powi(2)).sqrt() < 12.0).unwrap_or(false);
        if !near { return Self::reject_launch(id, seq, "invalid_origin", 0.0); }
        if p.rounds == Some(0) || p.missiles_left.get(missile).copied().unwrap_or(0) == 0 {
            return Self::reject_launch(id, seq, "no_ammo", 0.0);
        }
        if now - p.last_launch < 0.25 {
            return Self::reject_launch(id, seq, "rate_limited", 0.25 - (now - p.last_launch));
        }
        let team = team_index(p.team);
        let seed = (shot_seed(id, seq) & 0xffff_ffff) as u32;
        let Some(w) = self.rooms.get_mut(&room).and_then(|r| r.world.as_mut()) else { return Self::reject_launch(id, seq, "not_in_battle", 0.0) };
        let Some(mid) = w.launch(missile, id, team, o, d, seed) else { return Self::reject_launch(id, seq, "launch_failed", 0.0) };
        let p = self.players.get_mut(&id).expect("player");
        if let Some(n) = p.missiles_left.get_mut(missile) {
            *n -= 1;
        }
        if let Some(t) = self.targets.get(&p.vehicle) { p.spend_round(t); }
        p.remember_sequence(seq);
        p.last_launch = now;
        let receipt = ServerMsg::Launched { from: id, seq, id: mid, missile: missile.into(), o, d };
        if p.launch_receipts.len() >= MAX_LAUNCH_RECEIPTS {
            if let Some(oldest) = p.launch_receipts.iter().min_by(|a,b| a.1.at.total_cmp(&b.1.at)).map(|(&seq,_)| seq) { p.launch_receipts.remove(&oldest); }
        }
        p.launch_receipts.insert(seq, LaunchReceipt { at: now, instance: selected, request_instance: instance.map(String::from), message: receipt.clone() });
        self.to_room(room, receipt)
    }

    /// Every battle's missiles and protection systems for `dt`: what the clients draw, and the
    /// missiles that struck a vehicle resolved through the combat model.
    fn step_missiles(&mut self, dt: f64, out: &mut Broadcast) -> HashMap<u32, Sky> {
        let mut skies = HashMap::new();
        let rooms: Vec<u32> = self.rooms.values().filter(|r| r.playing && r.world.is_some()).map(|r| r.id).collect();
        for room in rooms {
            let members = self.rooms[&room].members.clone();
            let actors: Vec<tg_missile::Actor> = members
                .iter()
                .filter_map(|m| self.players.get(m))
                .filter_map(|p| {
                    let s = p.state.as_ref()?;
                    crate::missiles::actor_of(p.id, team_index(p.team), p.alive, s, self.targets.get(&p.vehicle), self.mdata.aps.get(&p.vehicle), p.combat.as_ref())
                })
                .collect();
            let w = self.rooms.get_mut(&room).and_then(|r| r.world.as_mut()).expect("world");
            if w.missiles.is_empty() && w.bullets.is_empty() && w.aps.is_empty() {
                continue;
            }
            let res = w.step(dt, &actors);
            let ms: Vec<Value> = w.flying().map(|m| serde_json::json!({"id": m.id, "def": m.def, "owner": m.owner, "team": m.team, "pos": m.pos, "vel": m.vel, "motor": m.motor, "guided": m.guided, "hits": m.hits_taken, "g_load": m.g_load, "lateral_g": m.lateral_g, "max_g": m.max_g})).collect();
            let aps: Vec<Value> = w
                .aps
                .iter()
                .map(|a| serde_json::json!({"owner": a.owner, "mode": a.mode, "yaw": a.yaw, "pitch": a.pitch, "spin": a.spin, "heat": a.heat, "rounds": a.rounds, "rate_rpm": a.rate_rpm, "target": a.target, "range": a.target_range, "tca": a.target_tca, "firing": a.firing, "tracks": a.tracks.iter().filter(|t| t.firm).count(), "track_pos": a.tracks.iter().filter(|t| t.firm).map(|t| t.pos).collect::<Vec<_>>(), "scan": a.scan, "kills": a.kills, "enabled": a.enabled}))
                .collect();
            // tracers, and one round per gun per tick for its flash
            let mut flashed = HashSet::new();
            let fired: Vec<Value> = res.fired.iter().filter(|f| f.tracer || flashed.insert(f.aps)).map(|f| serde_json::json!({"aps": f.aps, "pos": f.pos, "vel": f.vel, "tracer": f.tracer})).collect();
            let ev: Vec<Value> = res.events.iter().filter_map(|e| serde_json::to_value(e).ok()).collect();
            let ended: HashMap<u32, (u32, String)> = w.ended.iter().map(|m| (m.id, (m.owner, m.def.clone()))).collect();
            let warheads: HashMap<String, String> = self.mdata.defs.iter().map(|d| (d.id.clone(), d.warhead.clone())).collect();
            skies.insert(room, (ms, aps, ev, fired));
            // a missile in a vehicle's box: its warhead through the combat model
            for e in res.events {
                let tg_missile::Event::MissileHit { missile, actor, point, dir, speed } = e else { continue };
                let Some((owner, def)) = ended.get(&missile).cloned() else { continue };
                let Some(shell) = warheads.get(&def).and_then(|w| self.projectiles.get(w)).cloned() else { continue };
                let (Some(t), Some(o)) = (self.players.get(&actor), self.players.get(&owner)) else { continue };
                if t.team == o.team || !t.alive {
                    continue;
                }
                let Some(pose) = t.state.as_ref().and_then(crate::missiles::pose_of) else { continue };
                let yaw = t.state.as_ref().map(crate::missiles::yaws_of).and_then(|y| y.first().copied()).unwrap_or(0.0);
                let o0 = pose.local_point([point[0] - dir[0] * 2.0, point[1] - dir[1] * 2.0, point[2] - dir[2] * 2.0]);
                let d0 = pose.local_dir(dir);
                let v = |a: [f64; 3]| Vec3::new(a[0] as f32, a[1] as f32, a[2] as f32);
                let seed = shot_seed(owner, 2_000_000 + missile);
                let now = self.now;
                for (to, msg) in self.apply_shot(owner, room, actor, shell, v(o0), v(d0).normalized(), speed as f32, 500.0, seed, yaw as f32, false, now) {
                    out.push((vec![to], msg));
                }
            }
        }
        skies
    }

    /// The battle is over: everyone back in the room, the board to all (and the winner).
    fn end_battle(&mut self, room: u32, winner: Option<Team>) -> Out {
        let Some(r) = self.rooms.get_mut(&room) else { return Vec::new() };
        r.playing = false;
        r.points.clear();
        r.world = None;
        let members = r.members.clone();
        for m in &members {
            if let Some(p) = self.players.get_mut(m) {
                p.state = None;
                p.ready = false;
                p.hp = FULL_HP;
                p.alive = true;
                p.reset_shots();
            }
        }
        let board: Vec<Member> = members.iter().filter_map(|m| self.member(*m)).collect();
        let mut out = self.to_room(room, ServerMsg::Ended { members: board, winner });
        out.extend(self.room_changed(room));
        out
    }

    /// Conquest for `dt` seconds: the vehicles in each circle turn it (one side alone in it; both
    /// sides in it hold it still), the side holding fewer points bleeds tickets, and a side out of
    /// tickets loses.
    pub fn conquest(&mut self, dt: f64) -> Broadcast {
        let mut out: Broadcast = Vec::new();
        let rooms: Vec<u32> = self.rooms.values().filter(|r| r.playing && !r.points.is_empty()).map(|r| r.id).collect();
        for room in rooms {
            let members = self.rooms[&room].members.clone();
            let on_field: Vec<(Team, [f64; 3])> = members
                .iter()
                .filter_map(|m| self.players.get(m))
                .filter(|p| p.alive)
                .filter_map(|p| p.state.as_ref().and_then(pos_of).map(|pos| (p.team, pos)))
                .collect();
            let r = self.rooms.get_mut(&room).expect("room");
            for pt in r.points.iter_mut() {
                let inside = |t: Team| on_field.iter().filter(|(team, pos)| *team == t && (pos[0] - pt.x).hypot(pos[2] - pt.z) <= pt.r).count() as u32;
                pt.blue = inside(Team::Blue);
                pt.red = inside(Team::Red);
                let (n, sign) = match (pt.blue, pt.red) {
                    (b, 0) if b > 0 => (b, 1.0),
                    (0, r) if r > 0 => (r, -1.0),
                    _ => (0, 0.0),
                };
                if n == 0 {
                    continue;
                }
                let rate = dt / CAPTURE_TIME * (1.0 + 0.5 * (n.min(3) - 1) as f64);
                let held_by_us = pt.owner == Some(if sign > 0.0 { Team::Blue } else { Team::Red });
                if held_by_us && pt.progress * sign >= 1.0 {
                    continue;
                }
                let before = pt.progress;
                pt.progress = (pt.progress + sign * rate).clamp(-1.0, 1.0);
                // through the middle: whoever held it has lost it
                if before * pt.progress <= 0.0 && before != 0.0 {
                    pt.owner = None;
                }
                if pt.progress >= 1.0 {
                    pt.owner = Some(Team::Blue);
                } else if pt.progress <= -1.0 {
                    pt.owner = Some(Team::Red);
                }
            }
            let held = |t: Team| r.points.iter().filter(|p| p.owner == Some(t)).count() as f64;
            let (blue, red) = (held(Team::Blue), held(Team::Red));
            r.tickets[0] = (r.tickets[0] - BLEED * (red - blue).max(0.0) * dt).max(0.0);
            r.tickets[1] = (r.tickets[1] - BLEED * (blue - red).max(0.0) * dt).max(0.0);
            let msg = ServerMsg::Capture { points: r.points.clone(), tickets: r.tickets };
            out.push((members.clone(), msg));
            let tickets = r.tickets;
            if tickets[0] <= 0.0 || tickets[1] <= 0.0 {
                let winner = if tickets[0] > tickets[1] { Team::Blue } else { Team::Red };
                for (to, m) in self.end_battle(room, Some(winner)) {
                    out.push((vec![to], m));
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn lobby() -> Lobby {
        let mut shells = HashMap::new();
        shells.insert("ap".into(), Shell { kind: "ap".into(), filler_kg: 0.0, caliber_mm: 75.0 });
        shells.insert("aphe".into(), Shell { kind: "aphe".into(), filler_kg: 0.16, caliber_mm: 85.0 });
        let mut l = Lobby::new(shells, ["su_t34_85", "de_tiger_e"].into_iter().map(String::from).collect(), vec!["range".into(), "coast".into()]);
        for id in ["su_t34_85", "de_tiger_e"] {
            let def = serde_json::from_value(json!({"id":id,"plates":[],"crew":[],
                "weapons":{"mount_m":[0,1,0],"main_gun":{"id":"test-cannon","ammo":["ap","aphe","api_14"]}},
                "modules":[
                    {"id":"breech","kind":"gun_breech","center":{"x":0,"y":1,"z":0},"half_extents":{"x":0.2,"y":0.2,"z":0.2},"max_health":100,"health":100},
                    {"id":"barrel","kind":"gun_barrel","center":{"x":0,"y":1,"z":1},"half_extents":{"x":0.1,"y":0.1,"z":1},"max_health":100,"health":100}]})).unwrap();
            l.targets.insert(id.into(),Target::new(def,&[]));
        }
        l
    }
    fn msgs_to(out: &Out, id: u32) -> Vec<&ServerMsg> {
        out.iter().filter(|(to, _)| *to == id).map(|(_, m)| m).collect()
    }
    fn state(x: f64) -> Value {
        json!({ "pos": [x, 0.0, 0.0], "ex": [1, 0, 0], "ez": [0, 0, 1] })
    }

    /// Two players a and b in a started battle on the range.
    fn battle() -> (Lobby, u32, u32) {
        let mut l = lobby();
        let (a, _) = l.connect();
        let (b, _) = l.connect();
        l.handle(a, ClientMsg::Create { name: "r".into(), map: "range".into(), max: 8, deploy: false, era: None }, 0.0);
        let room = *l.rooms.keys().next().unwrap();
        l.handle(b, ClientMsg::Join { room }, 0.0);
        l.handle(a, ClientMsg::Vehicle { id: "de_tiger_e".into() }, 0.0);
        l.handle(b, ClientMsg::Vehicle { id: "su_t34_85".into() }, 0.0);
        l.handle(a, ClientMsg::Start, 0.0);
        (l, a, b)
    }

    #[test]
    fn a_dropped_player_keeps_the_seat_and_takes_it_back_with_the_token() {
        let (mut l, a, b) = battle();
        l.handle(a, ClientMsg::State { s: state(0.0) }, 0.1);
        let token = l.players[&a].token.clone();
        assert_eq!(token.len(), 32);
        assert_ne!(token, l.players[&b].token);
        // the connection drops in the battle: still in the room, its tank still in the snapshots
        assert!(l.drop_link(a, 5.0).is_empty());
        assert!(l.players[&a].away.is_some());
        assert!(l.sweep(10.0).is_empty());
        // a new connection with a wrong token is just a new player
        let (c, _) = l.connect();
        assert!(l.resume(c, "0123456789abcdef0123", 11.0).is_none());
        // with the right one it becomes a again, and the token changes
        let (old, out) = l.resume(c, &token, 12.0).expect("resumed");
        assert_eq!(old, a);
        assert!(!l.players.contains_key(&c));
        assert!(l.players[&a].away.is_none());
        assert!(matches!(msgs_to(&out, a)[0], ServerMsg::Welcome { id, .. } if *id == a));
        assert_ne!(l.players[&a].token, token);
        assert!(l.resume(c + 1, &token, 12.0).is_none());
        // gone for longer than the grace: the seat is let go
        l.drop_link(a, 20.0);
        l.sweep(20.0 + RESUME_GRACE + 0.5);
        assert!(!l.players.contains_key(&a));
        // outside a battle a dropped connection leaves at once
        let (d, _) = l.connect();
        l.drop_link(d, 30.0);
        assert!(!l.players.contains_key(&d));
    }

    #[test]
    fn hits_are_checked_against_where_the_target_stood_when_the_shooter_saw_it() {
        let (mut l, a, b) = battle();
        // b drives along x 300 m away from a, 10 m/s
        for i in 0..40 {
            let t = 1.0 + i as f64 * 0.05;
            l.handle(a, ClientMsg::State { s: state(0.0) }, t);
            l.handle(b, ClientMsg::State { s: json!({ "pos": [300.0 + (t - 1.0) * 10.0, 0.0, 0.0], "ex": [1, 0, 0], "ez": [0, 0, 1] }) }, t);
        }
        // a round fired at t = 2.0 over 305 m at 800 m/s: b was there
        assert!(l.hit_plausible(a, b, 2.0, 305.0, 800.0));
        // the same claim over 900 m (b was never that far) is refused
        assert!(!l.hit_plausible(a, b, 2.0, 900.0, 800.0));
        // with a 200 ms round trip reported the rewind reaches a little further back
        for _ in 0..3 {
            l.handle(a, ClientMsg::Ping { at: 0.0, rtt: Some(200.0) }, 2.5);
        }
        assert!((l.one_way(a) - 0.1).abs() < 1e-9);
        // no history for a shooter yet: believed
        let (c, _) = l.connect();
        assert!(l.hit_plausible(c, b, 2.0, 900.0, 800.0));
    }

    #[test]
    fn far_players_are_sent_less_often() {
        let (mut l, a, b) = battle();
        l.handle(a, ClientMsg::State { s: state(0.0) }, 0.1);
        l.handle(b, ClientMsg::State { s: state(2000.0) }, 0.1);
        let mut heard = 0;
        for _ in 0..8 {
            for (to, m) in l.tick() {
                if let ServerMsg::Snap { players, .. } = m {
                    if to.contains(&a) && players.iter().any(|p| p.id == b) {
                        heard += 1;
                    }
                    // everyone always hears of themselves
                    for id in &to {
                        assert!(players.iter().any(|p| p.id == *id));
                    }
                }
            }
        }
        assert_eq!(heard, 2);
        // near: every tick
        l.handle(b, ClientMsg::State { s: state(100.0) }, 100.0);
        let snaps = l.tick();
        assert_eq!(snaps.len(), 1);
    }

    #[test]
    fn players_create_join_and_leave_rooms() {
        let mut l = lobby();
        let (a, out) = l.connect();
        assert!(matches!(msgs_to(&out, a)[0], ServerMsg::Welcome { .. }));
        let (b, _) = l.connect();
        l.handle(a, ClientMsg::Hello { name: "阿明\u{7}".into(), resume: None }, 0.0);
        assert_eq!(l.players[&a].name, "阿明");
        let out = l.handle(a, ClientMsg::Create { name: "河口決戰".into(), map: "coast".into(), max: 4, deploy: false, era: None }, 0.0);
        let room = *l.rooms.keys().next().unwrap();
        // b, in the lobby, sees the new room
        assert!(msgs_to(&out, b).iter().any(|m| matches!(m, ServerMsg::Rooms { rooms } if rooms.len() == 1 && rooms[0].name == "河口決戰")));
        let out = l.handle(b, ClientMsg::Join { room }, 0.0);
        let ServerMsg::Room { room: d } = msgs_to(&out, a).into_iter().find(|m| matches!(m, ServerMsg::Room { .. })).unwrap() else { panic!() };
        assert_eq!(d.members.len(), 2);
        // teams are balanced
        assert_ne!(d.members[0].team, d.members[1].team);
        // an unknown map, a full room, a missing room
        let (c, _) = l.connect();
        assert!(matches!(msgs_to(&l.handle(c, ClientMsg::Create { name: "x".into(), map: "moon".into(), max: 4, deploy: false, era: None }, 0.0), c)[0], ServerMsg::Error { .. }));
        assert!(matches!(msgs_to(&l.handle(c, ClientMsg::Join { room: 99 }, 0.0), c)[0], ServerMsg::Error { .. }));
        // the host leaves: b becomes host; b leaves: the room is gone
        l.handle(a, ClientMsg::Leave, 0.0);
        assert_eq!(l.rooms[&room].host, b);
        l.handle(b, ClientMsg::Leave, 0.0);
        assert!(l.rooms.is_empty());
    }

    #[test]
    fn the_host_starts_the_battle_and_states_are_relayed() {
        let mut l = lobby();
        let (a, _) = l.connect();
        let (b, _) = l.connect();
        l.handle(a, ClientMsg::Create { name: "r".into(), map: "range".into(), max: 8, deploy: false, era: None }, 0.0);
        let room = *l.rooms.keys().next().unwrap();
        l.handle(b, ClientMsg::Join { room }, 0.0);
        // only the host may start, and only with everyone's vehicle chosen
        assert!(matches!(msgs_to(&l.handle(b, ClientMsg::Start, 0.0), b)[0], ServerMsg::Error { .. }));
        assert!(matches!(msgs_to(&l.handle(a, ClientMsg::Start, 0.0), a)[0], ServerMsg::Error { .. }));
        assert!(matches!(msgs_to(&l.handle(a, ClientMsg::Vehicle { id: "proto_x".into() }, 0.0), a)[0], ServerMsg::Error { .. }));
        l.handle(a, ClientMsg::Vehicle { id: "de_tiger_e".into() }, 0.0);
        l.handle(b, ClientMsg::Vehicle { id: "su_t34_85".into() }, 0.0);
        let out = l.handle(a, ClientMsg::Start, 0.0);
        assert!(msgs_to(&out, b).iter().any(|m| matches!(m, ServerMsg::Start { map, members } if map == "range" && members.len() == 2)));
        l.handle(a, ClientMsg::State { s: state(0.0) }, 0.0);
        l.handle(b, ClientMsg::State { s: state(50.0) }, 0.0);
        let snap = l.tick();
        assert_eq!(snap.len(), 1);
        assert!(snap[0].0.contains(&a) && snap[0].0.contains(&b));
        assert!(matches!(&snap[0].1, ServerMsg::Snap { players, .. } if players.len() == 2));
        // past the spawn grace a jump of 100 m in 0.1 s is refused, an ordinary move is kept
        l.handle(b, ClientMsg::State { s: state(52.0) }, 3.0);
        l.handle(b, ClientMsg::State { s: state(152.0) }, 3.1);
        assert_eq!(pos_of(l.players[&b].state.as_ref().unwrap()).unwrap()[0], 52.0);
        l.handle(b, ClientMsg::State { s: state(53.0) }, 3.2);
        assert_eq!(pos_of(l.players[&b].state.as_ref().unwrap()).unwrap()[0], 53.0);
        // someone joining a battle under way is sent straight in
        let (c, _) = l.connect();
        let out = l.handle(c, ClientMsg::Join { room }, 4.0);
        assert!(msgs_to(&out, c).iter().any(|m| matches!(m, ServerMsg::Start { .. })));
        // no changing sides in battle; the host ends it and everyone is back in the room
        assert!(matches!(msgs_to(&l.handle(c, ClientMsg::Team { team: Team::Blue }, 4.0), c)[0], ServerMsg::Error { .. }));
        assert!(matches!(msgs_to(&l.handle(b, ClientMsg::End, 5.0), b)[0], ServerMsg::Error { .. }));
        let out = l.handle(a, ClientMsg::End, 5.0);
        assert!(msgs_to(&out, c).iter().any(|m| matches!(m, ServerMsg::Ended { members, .. } if members.len() == 3)));
        assert!(!l.rooms[&room].playing && l.tick().is_empty());
        // between battles a side can be changed while it has room
        let t = l.players[&c].team;
        let other = if t == Team::Blue { Team::Red } else { Team::Blue };
        l.handle(c, ClientMsg::Team { team: other }, 6.0);
        assert_eq!(l.players[&c].team, other);
    }

    #[test]
    fn hits_count_only_for_real_shots_and_the_server_keeps_the_hit_points() {
        let mut l = lobby();
        let (a, _) = l.connect();
        let (b, _) = l.connect();
        let (c, _) = l.connect();
        l.handle(a, ClientMsg::Create { name: "r".into(), map: "range".into(), max: 8, deploy: false, era: None }, 0.0);
        let room = *l.rooms.keys().next().unwrap();
        l.handle(b, ClientMsg::Join { room }, 0.0);
        l.handle(c, ClientMsg::Join { room }, 0.0);
        for p in [a, b, c] {
            l.handle(p, ClientMsg::Vehicle { id: "su_t34_85".into() }, 0.0);
        }
        l.handle(a, ClientMsg::Start, 0.0);
        let (ta, tb, tc) = (l.players[&a].team, l.players[&b].team, l.players[&c].team);
        assert_eq!(ta, tc);
        assert_ne!(ta, tb);
        // a hit without a shot fired does nothing
        assert!(l.handle(a, ClientMsg::Hit { seq: 1, target: b, result: "pen".into(), plate: None, shot: None }, 1.0).is_empty());
        // a shot is relayed to the others, not back to the shooter
        let out = l.handle(a, ClientMsg::Fire { seq: 1, instance: None, o: [0.0; 3], d: [0.0, 0.0, 1.0], shell: "ap".into() }, 1.0);
        assert!(msgs_to(&out, a).iter().any(|m| matches!(m,ServerMsg::FireAccepted {seq:1})) && !msgs_to(&out, b).is_empty());
        // solid shot: 55 per penetration, and the same shot cannot count twice
        let out = l.handle(a, ClientMsg::Hit { seq: 1, target: b, result: "pen".into(), plate: Some("hull_upper_front".into()), shot: None }, 1.2);
        assert!(msgs_to(&out, b).iter().any(|m| matches!(m, ServerMsg::Damage { hp, killed: false, .. } if (*hp - 45.0).abs() < 1e-9)));
        assert!(l.handle(a, ClientMsg::Hit { seq: 1, target: b, result: "pen".into(), plate: None, shot: None }, 1.3).is_empty());
        // no friendly fire
        l.handle(a, ClientMsg::Fire { seq: 2, instance: None, o: [0.0; 3], d: [0.0, 0.0, 1.0], shell: "aphe".into() }, 2.0);
        assert!(l.handle(a, ClientMsg::Hit { seq: 2, target: c, result: "pen".into(), plate: None, shot: None }, 2.1).is_empty());
        // an explosive-filled round knocks it out; the kill and the death are counted
        let out = l.handle(a, ClientMsg::Hit { seq: 2, target: b, result: "pen".into(), plate: None, shot: None }, 2.2);
        assert!(msgs_to(&out, c).iter().any(|m| matches!(m, ServerMsg::Damage { killed: true, result, .. } if result == "kill")));
        assert_eq!((l.players[&a].kills, l.players[&b].deaths, l.players[&b].alive), (1, 1, false));
        // a wreck cannot be hit again, nor respawn too early; after the delay it can
        l.handle(a, ClientMsg::Fire { seq: 3, instance: None, o: [0.0; 3], d: [0.0, 0.0, 1.0], shell: "aphe".into() }, 3.0);
        assert!(l.handle(a, ClientMsg::Hit { seq: 3, target: b, result: "pen".into(), plate: None, shot: None }, 3.1).is_empty());
        assert!(matches!(msgs_to(&l.handle(b, ClientMsg::Respawn, 4.0), b)[0], ServerMsg::Error { .. }));
        let out = l.handle(b, ClientMsg::Respawn, 2.2 + RESPAWN_DELAY + 0.1);
        assert!(msgs_to(&out, a).iter().any(|m| matches!(m, ServerMsg::Respawned { id, .. } if *id == b)));
        assert_eq!((l.players[&b].hp, l.players[&b].alive), (FULL_HP, true));
        // a crew bailing out of a stuck vehicle: a death, no kill, and the same wait
        let out = l.handle(c, ClientMsg::Respawn, 9.0);
        assert!(msgs_to(&out, a).iter().any(|m| matches!(m, ServerMsg::Damage { target, killed: true, result, .. } if *target == c && result == "scuttle")));
        assert_eq!((l.players[&c].alive, l.players[&c].deaths, l.players[&a].kills), (false, 1, 1));
        assert!(matches!(msgs_to(&l.handle(c, ClientMsg::Respawn, 10.0), c)[0], ServerMsg::Error { .. }));
        // a shot reported too late does not count; nor do more than the burst limit
        l.handle(a, ClientMsg::Fire { seq: 4, instance: None, o: [0.0; 3], d: [0.0, 0.0, 1.0], shell: "aphe".into() }, 10.0);
        assert!(l.handle(a, ClientMsg::Hit { seq: 4, target: b, result: "pen".into(), plate: None, shot: None }, 10.0 + SHOT_LIFE + 1.0).is_empty());
        for s in 10..10 + FIRE_BURST as u32 + 5 {
            l.handle(a, ClientMsg::Fire { seq: s, instance: None, o: [0.0; 3], d: [0.0, 0.0, 1.0], shell: "ap".into() }, 30.0);
        }
        assert!(l.players[&a].fired.len() <= FIRE_BURST);
        // an automatic gun's rounds have a burst limit of their own
        l.shells.insert("api_14".into(), Shell { kind: "ap".into(), filler_kg: 0.0, caliber_mm: 14.5 });
        for s in 1000..1200 {
            l.handle(a, ClientMsg::Fire { seq: s, instance: None, o: [0.0; 3], d: [0.0, 0.0, 1.0], shell: "api_14".into() }, 31.0 + (s - 1000) as f64 * 0.02);
        }
        assert_eq!(l.players[&a].fired.iter().filter(|f| f.small).count(), 200);
    }

    #[test]
    fn a_deploy_room_starts_empty_players_choose_on_the_deploy_screen_and_conquest_ends_it() {
        let mut points = HashMap::new();
        points.insert("coast".to_string(), vec![CapPoint { id: "A".into(), x: 0.0, z: 0.0, r: 40.0 }, CapPoint { id: "B".into(), x: 300.0, z: 0.0, r: 40.0 }]);
        let mut l = lobby().with_points(points);
        let (a, _) = l.connect();
        let (b, _) = l.connect();
        l.handle(a, ClientMsg::Create { name: "r".into(), map: "coast".into(), max: 8, deploy: true, era: None }, 0.0);
        let room = *l.rooms.keys().next().unwrap();
        l.handle(b, ClientMsg::Join { room }, 0.0);
        // nobody has chosen a vehicle, and the host may still start: everyone to the deploy screen
        let out = l.handle(a, ClientMsg::Start, 0.0);
        assert!(msgs_to(&out, b).iter().any(|m| matches!(m, ServerMsg::Start { .. })));
        assert!(!l.players[&a].alive && !l.players[&b].alive);
        // a vehicle that is not allowed, then a real one at spawn point 1
        assert!(matches!(msgs_to(&l.handle(a, ClientMsg::Deploy { vehicle: "proto_x".into(), spawn: 0, rounds: None }, 1.0), a)[0], ServerMsg::Error { .. }));
        let out = l.handle(a, ClientMsg::Deploy { vehicle: "de_tiger_e".into(), spawn: 1, rounds: None }, 1.0);
        assert!(msgs_to(&out, b).iter().any(|m| matches!(m, ServerMsg::Respawned { id, vehicle, spawn: 1 } if *id == a && vehicle == "de_tiger_e")));
        assert!(l.players[&a].alive && l.players[&a].vehicle == "de_tiger_e");
        // on the field already: a second deploy does nothing
        assert!(l.handle(a, ClientMsg::Deploy { vehicle: "su_t34_85".into(), spawn: 0, rounds: None }, 1.5).is_empty());
        l.handle(b, ClientMsg::Deploy { vehicle: "su_t34_85".into(), spawn: 0, rounds: None }, 1.0);
        // a (blue) sits in A alone; b (red) is far from both
        l.handle(a, ClientMsg::State { s: state(5.0) }, 1.0);
        l.handle(b, ClientMsg::State { s: json!({ "pos": [150.0, 0.0, 200.0] }) }, 1.0);
        let mut owner = None;
        for _ in 0..(CAPTURE_TIME / CONQUEST_DT) as usize + 2 {
            for (_, m) in l.conquest(CONQUEST_DT) {
                if let ServerMsg::Capture { points, .. } = m {
                    owner = points[0].owner;
                }
            }
        }
        assert_eq!(owner, Some(Team::Blue));
        // red bleeds, blue does not
        let t = l.rooms[&room].tickets;
        l.conquest(4.0);
        let t2 = l.rooms[&room].tickets;
        assert!(t2[1] < t[1] && t2[0] == t[0]);
        // b's crew bail out: a death costs red tickets; after the wait b may choose again
        let before = l.rooms[&room].tickets[1];
        l.handle(b, ClientMsg::Respawn, 2.0);
        assert!((before - l.rooms[&room].tickets[1] - DEATH_COST).abs() < 1e-9);
        assert!(matches!(msgs_to(&l.handle(b, ClientMsg::Deploy { vehicle: "de_tiger_e".into(), spawn: 0, rounds: None }, 3.0), b)[0], ServerMsg::Error { .. }));
        assert!(!l.handle(b, ClientMsg::Deploy { vehicle: "de_tiger_e".into(), spawn: 0, rounds: None }, 2.0 + RESPAWN_DELAY).is_empty());
        assert_eq!(l.players[&b].vehicle, "de_tiger_e");
        // someone joining now waits on the deploy screen
        let (c, _) = l.connect();
        let out = l.handle(c, ClientMsg::Join { room }, 8.0);
        assert!(msgs_to(&out, c).iter().any(|m| matches!(m, ServerMsg::Start { .. })) && !l.players[&c].alive);
        // red runs out of tickets: blue wins and the battle is over
        let mut won = None;
        for _ in 0..2000 {
            for (_, m) in l.conquest(1.0) {
                if let ServerMsg::Ended { winner, .. } = m {
                    won = winner;
                }
            }
            if won.is_some() {
                break;
            }
        }
        assert_eq!(won, Some(Team::Blue));
        assert!(!l.rooms[&room].playing);
    }

    /// Two players with the real vehicles' data: hits resolved by the combat model.
    fn combat_lobby() -> (Lobby, u32, u32, u32) {
        let data = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let c = crate::server::load_combat(&data);
        let mut l = Lobby::new(HashMap::new(), HashSet::new(), vec!["range".into()]).with_combat(c.targets, c.projectiles, c.bullets);
        let (a, _) = l.connect();
        let (b, _) = l.connect();
        l.handle(a, ClientMsg::Create { name: "r".into(), map: "range".into(), max: 4, deploy: false, era: None }, 0.0);
        let room = *l.rooms.keys().next().unwrap();
        l.handle(b, ClientMsg::Join { room }, 0.0);
        l.handle(a, ClientMsg::Vehicle { id: "de_tiger_e".into() }, 0.0);
        l.handle(b, ClientMsg::Vehicle { id: "us_m4a3_75w".into() }, 0.0);
        l.handle(a, ClientMsg::Start, 0.0);
        (l, a, b, room)
    }

    #[test]
    fn shot_resolution_uses_the_defenders_current_folded_wall_pose() {
        let (mut l, a, b) = battle();
        let room = l.players[&b].room.unwrap();
        let vehicle = l.players[&b].vehicle.clone();
        let def = serde_json::from_value(json!({
            "id": vehicle, "modules": [], "crew": [],
            "plates": [{ "id": "fold_side", "zone": "hull_side", "material": "rha", "thickness_mm": 200,
                "center": { "x": 1.5, "y": 2.2, "z": 0 }, "normal": { "x": 1, "y": 0, "z": 0 },
                "axis_u": { "x": 0, "y": 0, "z": 1 }, "half_u": 3, "half_v": 0.4,
                "hinge": { "a": [1.5, 1.8, -3], "b": [1.5, 1.8, 3], "angle": -90 } }]
        })).unwrap();
        l.targets.insert(vehicle.clone(), Target::new(def, &[]));
        let initial = l.targets[&vehicle].fresh_state();
        for (fold, expected_plate) in [(0.0, Some("fold_side")), (0.5, Some("fold_side")), (1.0, None), (0.0, Some("fold_side"))] {
            let mut s = state(0.0);
            s["fold"] = json!(fold);
            l.handle(b, ClientMsg::State { s }, 0.1);
            l.players.get_mut(&b).unwrap().combat = Some(initial.clone());
            let out = l.apply_shot(a, room, b, ProjectileDef::generic_ap(75.0, 120.0),
                Vec3::new(4.0, 2.2, 0.0), Vec3::new(-1.0, 0.0, 0.0), 800.0, 0.0, 17, 0.0, false, 0.1);
            let plate = msgs_to(&out, b).into_iter().find_map(|m| match m {
                ServerMsg::Damage { plate, .. } => Some(plate.as_deref()),
                _ => None,
            }).expect("the authoritative shot report goes to the defender");
            assert_eq!(plate, expected_plate, "fold = {fold}");
        }
        assert_eq!(l.targets[&vehicle].def.plates[0].center, Vec3::new(1.5, 2.2, 0.0));
    }

    #[test]
    fn hits_are_resolved_by_the_combat_model_and_the_report_goes_to_the_room() {
        let (mut l, a, b, _) = combat_lobby();
        assert!(l.players[&b].combat.is_some());
        // the Tiger fires an 88 mm PzGr 39 into the Sherman's side, level with the gunner
        let side = WireShot { o: [3.0, 1.9, 0.3], d: [-1.0, 0.0, 0.0], yaw: 0.0, speed: 700.0, dist: 400.0 };
        let mut killed = false;
        for seq in 1..=6u32 {
            l.handle(a, ClientMsg::Fire { seq, instance: None, o: [0.0; 3], d: [0.0, 0.0, 1.0], shell: "apcbc_88_l56".into() }, seq as f64);
            let out = l.handle(a, ClientMsg::Hit { seq, target: b, result: "penetrated".into(), plate: None, shot: Some(side.clone()) }, seq as f64 + 0.3);
            let dmg = msgs_to(&out, b).into_iter().find_map(|m| match m {
                ServerMsg::Damage { report, killed, .. } => Some((report.clone(), *killed)),
                _ => None,
            });
            let Some((report, k)) = dmg else { break };
            let r = report.expect("a combat report");
            assert_eq!(r["outcome"], "penetrated");
            assert!(r["fragments"].as_array().map(|f| !f.is_empty()).unwrap_or(false));
            if k {
                killed = true;
                break;
            }
        }
        assert!(killed, "four 88 mm hits through the side put a Sherman out");
        assert_eq!((l.players[&a].kills, l.players[&b].deaths, l.players[&b].alive), (1, 1, false));
        // a shot that was never fired, or a line that makes no sense, is refused
        assert!(l.handle(a, ClientMsg::Hit { seq: 99, target: b, result: "penetrated".into(), plate: None, shot: Some(side.clone()) }, 9.0).is_empty());
    }

    #[test]
    fn a_short_load_leaves_racks_empty_and_every_shot_fired_empties_more() {
        let data = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let c = crate::server::load_combat(&data);
        let mut l = Lobby::new(HashMap::new(), ["su_t34_85".to_string()].into_iter().collect(), vec!["range".into()]).with_combat(c.targets, c.projectiles, c.bullets);
        let (a, _) = l.connect();
        l.handle(a, ClientMsg::Create { name: "r".into(), map: "range".into(), max: 4, deploy: true, era: None }, 0.0);
        l.handle(a, ClientMsg::Start, 0.0);
        let cap = l.targets["su_t34_85"].def.ammo_capacity;
        assert_eq!(cap, 60, "24 + 31 + 5 rounds");
        l.handle(a, ClientMsg::Deploy { vehicle: "su_t34_85".into(), spawn: 0, rounds: Some(20) }, 1.0);
        let racks = |l: &Lobby| -> Vec<f32> {
            let t = &l.targets["su_t34_85"];
            let st = l.players[&a].combat.as_ref().unwrap();
            (0..t.def.modules.len()).filter(|i| t.def.modules[*i].kind == tg_combat::ModuleKind::AmmoRack).map(|i| st.rack(i)).collect()
        };
        let r = racks(&l);
        assert!(r.iter().any(|f| *f == 0.0) && r.iter().any(|f| *f > 0.0), "{r:?}");
        let held: f32 = r.iter().sum();
        for seq in 1..=10u32 {
            l.handle(a, ClientMsg::Fire { seq, instance: None, o: [0.0; 3], d: [0.0, 0.0, 1.0], shell: "aphe_85_br365".into() }, 2.0 + seq as f64 * 9.0);
        }
        assert_eq!(l.players[&a].rounds, Some(10));
        assert!(racks(&l).iter().sum::<f32>() < held);
    }

    #[test]
    fn the_server_runs_repairs_and_fires_on_its_own_clock() {
        let (mut l, a, b, _) = combat_lobby();
        // from behind into the Sherman's engine
        let rear = WireShot { o: [0.0, 1.2, -6.0], d: [0.0, 0.0, 1.0], yaw: 0.0, speed: 700.0, dist: 300.0 };
        let mut broken = false;
        for seq in 1..=4u32 {
            l.handle(a, ClientMsg::Fire { seq, instance: None, o: [0.0; 3], d: [0.0, 0.0, 1.0], shell: "apcbc_88_l56".into() }, seq as f64);
            l.handle(a, ClientMsg::Hit { seq, target: b, result: "penetrated".into(), plate: None, shot: Some(rear.clone()) }, seq as f64 + 0.2);
            let st = l.players[&b].combat.clone().unwrap();
            let t = &l.targets["us_m4a3_75w"];
            if !st.destroyed && tg_combat::caps(t, &st).engine_power == 0.0 {
                broken = true;
                break;
            }
            if st.destroyed {
                break;
            }
        }
        if broken {
            let out = l.handle(b, ClientMsg::Repair, 5.0);
            assert!(msgs_to(&out, a).iter().any(|m| matches!(m, ServerMsg::Status { events, .. } if events.contains(&"repair_started".to_string()))));
            let mut repaired = false;
            for _ in 0..200 {
                let out = l.advance_combat(0.25);
                if out.iter().any(|(_, m)| matches!(m, ServerMsg::Status { events, .. } if events.contains(&"repaired".to_string()))) {
                    repaired = true;
                    break;
                }
            }
            assert!(repaired);
            let t = &l.targets["us_m4a3_75w"];
            assert!(tg_combat::caps(t, l.players[&b].combat.as_ref().unwrap()).engine_power > 0.0);
        }
        // respawning gives a fresh vehicle
        let p = l.players.get_mut(&b).unwrap();
        p.alive = false;
        p.died_at = 0.0;
        l.handle(b, ClientMsg::Respawn, 100.0);
        let st = l.players[&b].combat.clone().unwrap();
        assert!(!st.destroyed && st.crew.iter().all(|h| *h == 100.0));
    }

    /// An M901 against the T-10M with its Oplot-MO, 600 m apart on the range: the server
    /// launches, steers on the gunner's line and runs the protection system.
    fn missile_lobby() -> (Lobby, u32, u32) {
        let data = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let c = crate::server::load_combat(&data);
        let mut l = Lobby::new(HashMap::new(), HashSet::new(), vec!["range".into()]).with_combat(c.targets, c.projectiles, c.bullets).with_missiles(crate::missiles::load(&data));
        let (a, _) = l.connect();
        let (b, _) = l.connect();
        l.handle(a, ClientMsg::Create { name: "r".into(), map: "range".into(), max: 4, deploy: false, era: None }, 0.0);
        let room = *l.rooms.keys().next().unwrap();
        l.handle(b, ClientMsg::Join { room }, 0.0);
        l.handle(a, ClientMsg::Vehicle { id: "us_m901_itv".into() }, 0.0);
        l.handle(b, ClientMsg::Vehicle { id: "su_t10m".into() }, 0.0);
        l.handle(a, ClientMsg::Start, 0.0);
        l.handle(a, ClientMsg::State { s: json!({ "pos": [0.0, 0.0, 0.0], "ex": [1, 0, 0], "ez": [0, 0, 1] }) }, 0.0);
        // the T-10M faces the launcher
        l.handle(b, ClientMsg::State { s: json!({ "pos": [0.0, 0.0, 600.0], "ex": [-1, 0, 0], "ez": [0, 0, -1], "tur": [[0.0, 0.0], [0.0, 0.0]] }) }, 0.0);
        (l, a, b)
    }

    /// Fires one TOW from a at b and steers it until it is over; the events and messages seen.
    fn tow_at_b(l: &mut Lobby, a: u32, seq: u32, now: f64) -> (Vec<Value>, Out) {
        let out = l.handle(a, ClientMsg::Launch { seq, instance: None, missile: "bgm71a_tow".into(), o: [0.0, 2.3, 2.0], d: [0.0, 0.01, 1.0] }, now);
        let mid = out
            .iter()
            .find_map(|(_, m)| match m {
                ServerMsg::Launched { id, seq: s, .. } if *s == seq => Some(*id),
                _ => None,
            })
            .expect("launched");
        let mut ev = Vec::new();
        let mut msgs: Out = Vec::new();
        for _ in 0..200 {
            l.handle(a, ClientMsg::Guide { id: mid, sight: [0.0, 2.3, 0.0], aim: [0.0, 1.2, 600.0] }, now);
            for (to, m) in l.tick() {
                if let ServerMsg::Snap { ev: e, .. } = &m {
                    ev.extend(e.iter().cloned());
                }
                for t in to {
                    msgs.push((t, m.clone()));
                }
            }
            if l.rooms.values().all(|r| r.world.as_ref().map(|w| w.missile(mid).is_none()).unwrap_or(true)) {
                break;
            }
        }
        (ev, msgs)
    }

    fn launch_rejection(out: &Out, player: u32, seq: u32, reason: &str) -> Value {
        let message = out.iter().find(|(to, _)| *to == player).expect("every refused launch must reply to its shooter");
        let value = serde_json::to_value(&message.1).unwrap();
        assert_eq!(value["t"], "launch_rejected");
        assert_eq!(value["seq"], seq);
        assert_eq!(value["reason"], reason);
        value
    }

    #[test]
    fn every_launch_rejection_preserves_ammunition_and_releases_the_client_request() {
        for (case, reason) in [
            ("not_in_room", "not_in_room"), ("destroyed", "destroyed"),
            ("invalid_launch", "invalid_launch"), ("invalid_origin", "invalid_origin"),
            ("no_state", "invalid_origin"), ("no_ammo", "no_ammo"),
            ("rate_limited", "rate_limited"), ("not_in_battle", "not_in_battle"),
            ("missing_world", "not_in_battle"), ("launch_failed", "launch_failed"),
        ] {
            let (mut l, a, _) = missile_lobby();
            let room = l.players[&a].room.unwrap();
            let mut origin = [0.0, 2.3, 2.0];
            let mut dir = [0.0, 0.0, 1.0];
            let missile = "bgm71a_tow";
            match case {
                "not_in_room" => l.players.get_mut(&a).unwrap().room = None,
                "destroyed" => l.players.get_mut(&a).unwrap().alive = false,
                "invalid_launch" => dir = [0.0; 3],
                "invalid_origin" => origin[2] = 300.0,
                "no_state" => l.players.get_mut(&a).unwrap().state = None,
                "no_ammo" => { l.players.get_mut(&a).unwrap().missiles_left.insert(missile.into(), 0); },
                "rate_limited" => l.players.get_mut(&a).unwrap().last_launch = 1.0,
                "not_in_battle" => l.rooms.get_mut(&room).unwrap().playing = false,
                "missing_world" => l.rooms.get_mut(&room).unwrap().world = None,
                "launch_failed" => {
                    l.rooms.get_mut(&room).unwrap().world.as_mut().unwrap().defs.remove(missile);
                },
                _ => unreachable!(),
            }
            let before = l.players[&a].missiles_left.clone();
            let out = l.launch(a, 41, missile, origin, dir, 1.1);
            let rejected = launch_rejection(&out, a, 41, reason);
            assert_eq!(l.players[&a].missiles_left, before, "{case}");
            if case == "rate_limited" {
                assert!(rejected["retry_after_s"].as_f64().unwrap() > 0.14);
            }
        }
    }

    #[test]
    fn a_destroyed_launch_apparatus_refuses_missiles_until_repaired_without_spending_ammo() {
        let (mut l, a, _) = missile_lobby();
        let launcher = l.targets["us_m901_itv"].def.modules.iter().position(|m| m.kind == tg_combat::ModuleKind::Launcher).unwrap();
        l.players.get_mut(&a).unwrap().combat.as_mut().unwrap().modules[launcher] = 0.0;
        let before = l.players[&a].missiles_left.clone();
        let rejected = l.launch(a, 70, "bgm71a_tow", [0.0, 2.3, 2.0], [0.0, 0.0, 1.0], 1.0);
        launch_rejection(&rejected, a, 70, "weapon_disabled");
        assert_eq!(l.players[&a].missiles_left, before);
        assert!(l.players[&a].launch_receipts.is_empty());
        l.players.get_mut(&a).unwrap().combat.as_mut().unwrap().modules[launcher] = l.targets["us_m901_itv"].def.modules[launcher].max_health;
        let accepted = l.launch(a, 70, "bgm71a_tow", [0.0, 2.3, 2.0], [0.0, 0.0, 1.0], 1.1);
        assert!(accepted.iter().any(|(_, m)| matches!(m, ServerMsg::Launched { seq: 70, .. })));
        assert_eq!(l.players[&a].missiles_left["bgm71a_tow"], before["bgm71a_tow"] - 1);
    }

    #[test]
    fn bmpt_cannon_and_one_live_rocket_rail_do_not_bypass_two_destroyed_launchers() {
        let (mut l, a, _) = missile_lobby();
        l.players.get_mut(&a).unwrap().vehicle = "su_bmpt34".into();
        l.spawn(a, 1.0);
        let rails: Vec<usize> = l.targets["su_bmpt34"].def.modules.iter().enumerate().filter_map(|(i, m)| (m.kind == tg_combat::ModuleKind::Launcher).then_some(i)).collect();
        assert_eq!(rails.len(), 2);
        l.players.get_mut(&a).unwrap().combat.as_mut().unwrap().modules[rails[0]] = 0.0;
        let shot = |seq| ClientMsg::Launch { seq, instance: None, missile: "tt250_rocket".into(), o: [0.0, 2.3, 2.0], d: [0.0, 0.0, 1.0] };
        l.handle(a, ClientMsg::State { s: state(0.0) }, 1.0);
        let first = l.handle(a, shot(80), 1.1);
        assert!(first.iter().any(|(_, m)| matches!(m, ServerMsg::Launched { seq: 80, .. })), "the other rocket rail remains usable");
        l.players.get_mut(&a).unwrap().combat.as_mut().unwrap().modules[rails[1]] = 0.0;
        assert!(tg_combat::caps(&l.targets["su_bmpt34"], l.players[&a].combat.as_ref().unwrap()).can_fire, "damaged rails leave the independent cannon usable");
        let before = l.players[&a].missiles_left.clone();
        let rejected = l.handle(a, shot(81), 1.5);
        launch_rejection(&rejected, a, 81, "weapon_disabled");
        assert_eq!(l.players[&a].missiles_left, before);
    }

    #[test]
    fn mixed_vehicle_requires_one_complete_launcher_group_not_surviving_parts_from_broken_groups() {
        let (mut l, a, _) = missile_lobby();
        let mut def = l.targets["su_bmpt34"].def.clone();
        let rails: Vec<usize> = def.modules.iter().enumerate().filter_map(|(i, m)| (m.kind == tg_combat::ModuleKind::Launcher).then_some(i)).collect();
        for &rail in &rails {
            let mut igniter = def.modules[rail].clone();
            igniter.id.push_str("_igniter");
            def.modules.push(igniter);
        }
        let second_igniter = def.modules.len() - 1;
        l.targets.insert("su_bmpt34".into(), Target::new(def, &[]));
        l.players.get_mut(&a).unwrap().vehicle = "su_bmpt34".into();
        l.spawn(a, 1.0);
        l.handle(a, ClientMsg::State { s: state(0.0) }, 1.0);
        let st = l.players.get_mut(&a).unwrap().combat.as_mut().unwrap();
        st.modules[rails[0]] = 0.0;
        st.modules[second_igniter] = 0.0;
        assert!(tg_combat::caps(&l.targets["su_bmpt34"], l.players[&a].combat.as_ref().unwrap()).can_fire, "independent cannon remains usable");
        let before = l.players[&a].missiles_left.clone();
        let rejected = l.launch(a, 85, "tt250_rocket", [0.0, 2.3, 2.0], [0.0, 0.0, 1.0], 1.1);
        launch_rejection(&rejected, a, 85, "weapon_disabled");
        assert_eq!(l.players[&a].missiles_left, before);
        assert!(!l.players[&a].launch_receipts.contains_key(&85));
        l.players.get_mut(&a).unwrap().combat.as_mut().unwrap().modules[rails[0]] = 70.0;
        let accepted = l.launch(a, 85, "tt250_rocket", [0.0, 2.3, 2.0], [0.0, 0.0, 1.0], 1.2);
        assert!(accepted.iter().any(|(_, m)| matches!(m, ServerMsg::Launched { seq: 85, .. })), "one restored complete group permits launching");
        assert_eq!(l.players[&a].missiles_left["tt250_rocket"], before["tt250_rocket"] - 1);
    }

    #[test]
    fn a_lost_launch_ack_can_be_retried_with_the_same_sequence_without_launching_twice() {
        let (mut l, a, _) = missile_lobby();
        let origin = [0.0, 2.3, 2.0];
        let dir = [0.0, 0.0, 1.0];
        let first = l.launch(a, 51, "bgm71a_tow", origin, dir, 0.1);
        let receipt = first.iter().find(|(to, _)| *to == a).unwrap().1.clone();
        assert!(matches!(&receipt, ServerMsg::Launched { .. }));
        assert_eq!(l.players[&a].missiles_left["bgm71a_tow"], 11);
        let repeated = l.launch(a, 51, "bgm71a_tow", origin, dir, 0.2);
        assert_eq!(repeated, vec![(a, receipt.clone())], "only the shooter needs its original ACK replayed");
        assert_eq!(l.players[&a].missiles_left["bgm71a_tow"], 11);
        l.spawn(a, 1.0);
        assert_eq!(l.players[&a].missiles_left["bgm71a_tow"], 12);
        assert!(l.players[&a].launch_receipts.is_empty() && l.players[&a].sequences.is_empty());
        l.handle(a,ClientMsg::State {s:state(0.0)},1.0);
        let fresh_ammo=l.players[&a].rounds;
        let fresh_state=serde_json::to_value(&l.players[&a].combat).unwrap();
        let room=l.players[&a].room.unwrap();
        let missiles=l.rooms[&room].world.as_ref().unwrap().missiles.len();
        let after_respawn = l.launch(a, 51, "bgm71a_tow", origin, dir, 1.1);
        launch_rejection(&after_respawn,a,51,"sequence_conflict");
        assert_eq!(l.players[&a].missiles_left["bgm71a_tow"],12);
        assert_eq!(l.players[&a].rounds,fresh_ammo);assert_eq!(serde_json::to_value(&l.players[&a].combat).unwrap(),fresh_state);
        assert_eq!(l.rooms[&room].world.as_ref().unwrap().missiles.len(),missiles);
        let fresh=l.launch(a,52,"bgm71a_tow",origin,dir,1.2);
        assert!(fresh.iter().any(|(_,m)|matches!(m,ServerMsg::Launched {id:2,..})));
        assert_eq!(l.players[&a].missiles_left["bgm71a_tow"],11);
        l.end_battle(room,None);
        l.handle(a,ClientMsg::Start,2.0);
        l.handle(a,ClientMsg::State {s:state(0.0)},2.0);
        assert!(l.launch(a,1,"bgm71a_tow",origin,dir,2.1).iter().any(|(_,m)|matches!(m,ServerMsg::Launched {seq:1,..})), "a new round resets the accepted sequence floor");
    }

    #[test]
    fn a_rate_rejected_second_missile_keeps_its_ammunition_for_a_later_retry() {
        let (mut l, a, _) = missile_lobby();
        let origin = [0.0, 2.3, 2.0];
        let dir = [0.0, 0.0, 1.0];
        assert!(l.launch(a, 61, "bgm71a_tow", origin, dir, 0.1).iter().any(|(_, m)| matches!(m, ServerMsg::Launched { .. })));
        let rejected = l.launch(a, 62, "bgm71a_tow", origin, dir, 0.3);
        launch_rejection(&rejected, a, 62, "rate_limited");
        assert_eq!(l.players[&a].missiles_left["bgm71a_tow"], 11);
        assert!(l.launch(a, 62, "bgm71a_tow", origin, dir, 0.4).iter().any(|(_, m)| matches!(m, ServerMsg::Launched { .. })));
        assert_eq!(l.players[&a].missiles_left["bgm71a_tow"], 10);
    }

    #[test]
    fn manual_oplot_fire_spends_the_server_magazine_once_without_spending_main_gun_ammo() {
        let (mut l, a, b) = missile_lobby();
        l.shells.insert("api_145_b32".into(), Shell { kind: "ap".into(), filler_kg: 0.0, caliber_mm: 14.5 });
        let room = l.players[&b].room.unwrap();
        let shot = |seq, o| ClientMsg::Fire { seq, instance: None, o, d: [0.0, 0.0, -1.0], shell: "api_145_b32".into() };
        let rounds = |l: &Lobby| l.rooms[&room].world.as_ref().unwrap().aps_of(b).unwrap().rounds;
        // Automatic control owns the mount until the client hands it to the gunner.
        assert!(matches!(l.handle(b, shot(100, [0.0, 3.0, 600.0]), 1.0)[0].1,ServerMsg::FireRejected {..}));
        assert_eq!(rounds(&l), 900);
        assert!(l.players[&b].fired.is_empty());
        l.handle(b, ClientMsg::Aps { enabled: false, rate: None }, 1.0);
        let main_before = l.players[&b].rounds;
        let out = l.handle(b, shot(101, [0.0, 3.0, 600.0]), 1.1);
        assert!(msgs_to(&out, a).iter().any(|m| matches!(m, ServerMsg::Fire { from, seq: 101, .. } if *from == b)));
        assert_eq!(rounds(&l), 899);
        assert_eq!(l.players[&b].rounds, main_before, "protection rounds do not empty the main gun's racks");
        assert!(matches!(l.handle(b, shot(101, [0.0, 3.0, 600.0]), 1.2)[0].1,ServerMsg::FireRejected {..}));
        assert_eq!(rounds(&l), 899, "retrying a sequence cannot spend a second round");
        assert!(matches!(l.handle(b, shot(102, [f64::NAN, 3.0, 600.0]), 1.3)[0].1,ServerMsg::FireRejected {..}));
        assert_eq!(rounds(&l), 899, "rejected fire consumes no rounds");
        l.rooms.get_mut(&room).unwrap().world.as_mut().unwrap().set_aps_rounds(b, false, None, Some(1));
        assert!(!l.handle(b, shot(103, [0.0, 3.0, 600.0]), 1.4).is_empty());
        assert_eq!(rounds(&l), 0);
        assert!(matches!(l.handle(b, shot(104, [0.0, 3.0, 600.0]), 1.5)[0].1,ServerMsg::FireRejected {..}));
        assert!(!l.players[&b].fired.iter().any(|f| f.seq == 104));
        l.handle(b, ClientMsg::Aps { enabled: true, rate: None }, 1.6);
        assert_eq!(rounds(&l), 0, "returning to interception cannot refill the magazine");
    }

    #[test]
    fn manual_oplot_fire_rejects_a_broken_protection_gun_without_spending_ammo() {
        let (mut l, _, b) = missile_lobby();
        l.shells.insert("api_145_b32".into(), Shell { kind: "ap".into(), filler_kg: 0.0, caliber_mm: 14.5 });
        let room = l.players[&b].room.unwrap();
        l.handle(b, ClientMsg::Aps { enabled: false, rate: None }, 1.0);
        let target = &l.targets["su_t10m"];
        let gun = target.def.modules.iter().position(|m| m.id == "oplot_gun").unwrap();
        l.players.get_mut(&b).unwrap().combat.as_mut().unwrap().modules[gun] = 0.0;
        let shot = |seq| ClientMsg::Fire { seq, instance: None, o: [0.0, 3.0, 600.0], d: [0.0, 0.0, -1.0], shell: "api_145_b32".into() };
        assert!(matches!(l.handle(b, shot(100), 1.1)[0].1,ServerMsg::FireRejected {..}));
        assert_eq!(l.rooms[&room].world.as_ref().unwrap().aps_of(b).unwrap().rounds, 900);
        assert!(l.players[&b].fired.is_empty());
        l.players.get_mut(&b).unwrap().combat.as_mut().unwrap().modules[gun] = 1.0;
        assert!(!l.handle(b, shot(101), 1.2).is_empty());
        assert_eq!(l.rooms[&room].world.as_ref().unwrap().aps_of(b).unwrap().rounds, 899);
    }

    #[test]
    fn the_server_flies_missiles_and_the_oplot_mo_shoots_them_down() {
        let (mut l, a, b) = missile_lobby();
        assert_eq!(l.players[&a].missiles_left.get("bgm71a_tow"), Some(&12));
        // the protection system is the T-10M's, registered at spawn
        assert!(l.rooms.values().any(|r| r.world.as_ref().map(|w| w.aps_of(b).is_some()).unwrap_or(false)));
        // a launch from far away from the launcher, or of a missile it does not carry, is refused
        launch_rejection(&l.handle(a, ClientMsg::Launch { seq: 1, instance: None, missile: "bgm71a_tow".into(), o: [0.0, 2.0, 300.0], d: [0.0, 0.0, 1.0] }, 1.0), a, 1, "invalid_origin");
        launch_rejection(&l.handle(a, ClientMsg::Launch { seq: 2, instance: None, missile: "tt250_rocket".into(), o: [0.0, 2.0, 2.0], d: [0.0, 0.0, 1.0] }, 1.0), a, 2, "weapon_disabled");
        let kind = |e: &Value| e["type"].as_str().unwrap_or("").to_string();
        let mut downed = 0;
        for k in 0..4u32 {
            let (ev, _) = tow_at_b(&mut l, a, 10 + k, 2.0 + k as f64 * 20.0);
            assert!(ev.iter().any(|e| kind(e) == "detect"), "the radar sees it");
            assert!(ev.iter().any(|e| kind(e) == "fire_start"), "the gun fires");
            if ev.iter().any(|e| kind(e) == "intercept") {
                downed += 1;
                assert!(ev.iter().position(|e| kind(e) == "bullet_hit") < ev.iter().position(|e| kind(e) == "intercept"), "a bullet hit first");
            }
        }
        assert!(downed >= 2, "{downed} of 4 downed");
        assert_eq!(l.players[&a].missiles_left["bgm71a_tow"], 8);
        // switched off, the T-10M does nothing and the TOW strikes: the warhead through the combat model
        l.handle(b, ClientMsg::Aps { enabled: false, rate: None }, 90.0);
        let (ev, msgs) = tow_at_b(&mut l, a, 30, 90.0);
        assert!(!ev.iter().any(|e| kind(e) == "fire_start"));
        assert!(msgs.iter().any(|(to, m)| *to == b && matches!(m, ServerMsg::Damage { target, report: Some(_), .. } if *target == b)), "the hit is resolved");
    }

    #[test]
    fn a_room_limited_to_an_era_takes_only_vehicles_of_those_years() {
        let mut years = HashMap::new();
        years.insert("de_tiger_e".to_string(), 1943);
        years.insert("su_t10m".to_string(), 1962);
        let mut l = Lobby::new(HashMap::new(), ["de_tiger_e", "su_t10m"].into_iter().map(String::from).collect(), vec!["range".into()]).with_years(years);
        let (a, _) = l.connect();
        let (b, _) = l.connect();
        let out = l.handle(a, ClientMsg::Create { name: "二戰".into(), map: "range".into(), max: 4, deploy: false, era: Some([1945, 1939]) }, 0.0);
        let room = *l.rooms.keys().next().unwrap();
        assert_eq!(l.rooms[&room].era, Some([1939, 1945]));
        assert!(out.iter().any(|(_, m)| matches!(m, ServerMsg::Rooms { rooms } if rooms[0].era == Some([1939, 1945]))));
        l.handle(b, ClientMsg::Join { room }, 0.0);
        assert!(matches!(msgs_to(&l.handle(a, ClientMsg::Vehicle { id: "su_t10m".into() }, 0.0), a)[0], ServerMsg::Error { .. }));
        l.handle(a, ClientMsg::Vehicle { id: "de_tiger_e".into() }, 0.0);
        assert_eq!(l.players[&a].vehicle, "de_tiger_e");
        // b chose a later vehicle before joining: the battle cannot start with it
        l.players.get_mut(&b).unwrap().vehicle = "su_t10m".into();
        assert!(matches!(msgs_to(&l.handle(a, ClientMsg::Start, 0.0), a)[0], ServerMsg::Error { .. }));
        l.handle(b, ClientMsg::Vehicle { id: "de_tiger_e".into() }, 0.0);
        assert!(msgs_to(&l.handle(a, ClientMsg::Start, 0.0), b).iter().any(|m| matches!(m, ServerMsg::Start { .. })));
        let m: ClientMsg = serde_json::from_str(r#"{"t":"create","name":"a","map":"range","max":4,"era":[1940,1950]}"#).unwrap();
        assert!(matches!(m, ClientMsg::Create { era: Some([1940, 1950]), .. }));
    }

    #[test]
    fn messages_parse_from_the_client_json() {
        let m: ClientMsg = serde_json::from_str(r#"{"t":"create","name":"a","map":"coast","max":6}"#).unwrap();
        assert!(matches!(m, ClientMsg::Create { max: 6, .. }));
        let m: ClientMsg = serde_json::from_str(r#"{"t":"hit","seq":3,"target":2,"result":"pen","plate":null}"#).unwrap();
        assert!(matches!(m, ClientMsg::Hit { seq: 3, target: 2, shot: None, .. }));
        let m: ClientMsg = serde_json::from_str(r#"{"t":"mg_hit","target":2,"gun":"m2hb","shot":{"o":[1,2,3],"d":[0,0,1],"yaw":0.1,"speed":800,"dist":100,"seed":7}}"#).unwrap();
        assert!(matches!(m, ClientMsg::MgHit { target: 2, .. }));
        assert_eq!(shot_seed(3, 5), 3 * 1_000_003 + 5 * 7919);
        let s = serde_json::to_string(&ServerMsg::Respawned { id: 4, vehicle: "us_m8".into(), spawn: 1 }).unwrap();
        assert_eq!(s, r#"{"t":"respawned","id":4,"vehicle":"us_m8","spawn":1}"#);
        let m: ClientMsg = serde_json::from_str(r#"{"t":"deploy","vehicle":"us_m8"}"#).unwrap();
        assert!(matches!(m, ClientMsg::Deploy { spawn: 0, .. }));
        let m: ClientMsg = serde_json::from_str(r#"{"t":"create","name":"a","map":"normandy","max":8,"deploy":true}"#).unwrap();
        assert!(matches!(m, ClientMsg::Create { deploy: true, .. }));
    }
    #[test]
    fn fire_selects_an_owned_healthy_cannon_before_spending_rounds() {
        let (mut l, a, _, _) = combat_lobby();
        let before = l.players[&a].rounds;
        for instance in ["gun:99:0", "mg:coax"] {
            let msg = serde_json::from_value(json!({"t":"fire","seq":50,"instance":instance,"shell":"apcbc_88_l56","o":[0,0,0],"d":[0,0,1]})).unwrap();
            let out = l.handle(a, msg, 1.0);
            assert!(!out.iter().any(|(_,m)| matches!(m, ServerMsg::Fire {..})), "foreign/wrong-kind request was fired");
            assert_eq!(l.players[&a].rounds, before);
            assert!(l.players[&a].fired.is_empty());
        }
        let t = &l.targets["de_tiger_e"];
        let i = t.weapon_bindings["gun:0:0"].critical[0];
        l.players.get_mut(&a).unwrap().combat.as_mut().unwrap().modules[i] = 0.0;
        l.handle(a, serde_json::from_value(json!({"t":"fire","seq":51,"instance":"gun:0:0","shell":"apcbc_88_l56","o":[0,0,0],"d":[0,0,1]})).unwrap(), 1.1);
        assert_eq!(l.players[&a].rounds, before);
        assert!(l.players[&a].fired.is_empty());
    }

    #[test]
    fn empty_cannon_and_empty_launcher_do_not_consume_or_discharge() {
        let (mut l, a, _, _) = combat_lobby();
        l.players.get_mut(&a).unwrap().rounds = Some(0);
        l.handle(a, serde_json::from_value(json!({"t":"fire","seq":51,"instance":"gun:0:0","shell":"apcbc_88_l56","o":[0,0,0],"d":[0,0,1]})).unwrap(), 1.0);
        assert!(l.players[&a].fired.is_empty());
        let (mut l, a, _) = missile_lobby();
        l.players.get_mut(&a).unwrap().rounds = Some(0);
        let before = l.players[&a].missiles_left.clone();
        let out = l.handle(a, serde_json::from_value(json!({"t":"launch","seq":51,"instance":"gun:0:0","missile":"bgm71a_tow","o":[0,2.3,2],"d":[0,0,1]})).unwrap(), 1.0);
        launch_rejection(&out,a,51,"no_ammo");
        assert_eq!(l.players[&a].missiles_left,before);
    }

    #[test]
    fn mg_fire_protocol_is_defined_and_requires_an_own_instance() {
        let (mut l, a, _, _) = combat_lobby();
        let parsed = serde_json::from_value::<ClientMsg>(json!({"t":"mg_fire","seq":61,"instance":"mg:foreign","gun":"mg34","o":[0,0,0],"d":[0,0,1]}));
        assert!(parsed.is_ok(), "mg_fire packet missing from protocol");
        l.handle(a,parsed.unwrap(),1.0);
        assert!(l.players[&a].fired.is_empty());
    }

    fn wire(value: Value) -> ClientMsg { serde_json::from_value(value).unwrap() }

    #[test]
    fn mg_hit_requires_matching_discharge_proof_and_survives_later_shooter_damage() {
        let (mut l,a,b,_) = combat_lobby();
        let binding=l.targets["de_tiger_e"].weapon_bindings.values().find(|b|b.kind==WeaponKind::MachineGun).unwrap().clone();
        let barrel=l.targets["us_m4a3_75w"].def.modules.iter().find(|m|m.kind==tg_combat::ModuleKind::GunBarrel).unwrap();
        let origin=[barrel.center.x+2.0,barrel.center.y,barrel.center.z+barrel.half_extents.z*0.7];
        let shot=json!({"o":origin,"d":[-1,0,0],"speed":800,"dist":10});
        let before=serde_json::to_value(&l.players[&b].combat).unwrap();
        for value in [
            json!({"t":"mg_hit","seq":80,"instance":binding.key,"gun":binding.model_id,"target":b,"shot":shot}),
            json!({"t":"mg_hit","gun":"foreign","target":b,"shot":shot})] {
            assert!(l.handle(a,wire(value),1.0).is_empty());
            assert_eq!(serde_json::to_value(&l.players[&b].combat).unwrap(),before);
        }
        l.handle(a,wire(json!({"t":"mg_fire","seq":80,"instance":binding.key,"gun":binding.model_id,"o":[0,2,0],"d":[0,0,1]})),1.0);
        assert_eq!(l.players[&a].fired.len(),1);
        for (gun,instance) in [(binding.model_id.as_str(),Some("mg:foreign")),("foreign",Some(binding.key.as_str())),(binding.model_id.as_str(),None)] {
            let out=l.handle(a,wire(json!({"t":"mg_hit","seq":80,"instance":instance,"gun":gun,"target":b,"shot":shot})),1.1);
            assert!(out.is_empty()); assert!(!l.players[&a].fired[0].used);
            assert_eq!(serde_json::to_value(&l.players[&b].combat).unwrap(),before);
        }
        // Later weapon damage, repair or shooter death cannot recall an accepted bullet.
        let p=l.players.get_mut(&a).unwrap();p.alive=false;
        let st=p.combat.as_mut().unwrap();st.modules[binding.critical[0]]=0.0;st.repair_s=5.0;st.destroyed=true;
        let hit=json!({"t":"mg_hit","seq":80,"instance":binding.key,"gun":binding.model_id,"target":b,"shot":shot});
        l.handle(a,wire(hit.clone()),1.2);
        assert!(l.players[&a].fired[0].used);
        let after=serde_json::to_value(&l.players[&b].combat).unwrap();
        assert_ne!(after,before,"the proven bullet must damage the external barrel");
        assert!(l.handle(a,wire(hit),1.3).is_empty());
        assert_eq!(serde_json::to_value(&l.players[&b].combat).unwrap(),after);
    }

    #[test]
    fn sequence_proofs_are_unique_across_packet_kinds_and_replays_keep_ammo_unchanged() {
        let (mut l,a,_) = missile_lobby();
        l.players.get_mut(&a).unwrap().vehicle="su_bmpt34".into();l.spawn(a,0.0);
        l.handle(a,ClientMsg::State {s:state(0.0)},0.0);
        // BMPT has no secondary MG in source; add one real Tiger installation in
        // this test-only mixed fixture so all three packet kinds share one vehicle.
        let mut def=l.targets["su_bmpt34"].def.clone();
        def.weapons["secondary"]=json!([l.targets["de_tiger_e"].def.weapons["secondary"][0]]);
        l.targets.insert("su_bmpt34".into(),Target::new(def,&[]));l.spawn(a,0.0);
        let t=&l.targets["su_bmpt34"];
        let cannon=t.weapon_bindings.values().find(|b|b.kind==WeaponKind::Cannon).unwrap().clone();
        let mg=t.weapon_bindings.values().find(|b|b.kind==WeaponKind::MachineGun).unwrap().clone();
        let launcher=t.weapon_bindings.values().find(|b|b.kind==WeaponKind::Missile && b.binding_error.is_none()).unwrap().clone();
        let fire=|seq|wire(json!({"t":"fire","seq":seq,"instance":cannon.key,"shell":cannon.ammo[0],"o":[0,2,0],"d":[0,0,1]}));
        let mgfire=|seq|wire(json!({"t":"mg_fire","seq":seq,"instance":mg.key,"gun":mg.model_id,"o":[0,2,0],"d":[0,0,1]}));
        l.handle(a,fire(90),1.0);
        let rounds=l.players[&a].rounds;
        let before=l.players[&a].missiles_left.clone();
        l.handle(a,mgfire(90),1.1);
        let out=l.launch_instance(a,90,Some(&launcher.key),launcher.missile.as_ref().unwrap(),[0.0,2.0,0.0],[0.0,0.0,1.0],1.1);
        launch_rejection(&out,a,90,"sequence_conflict");
        l.handle(a,fire(90),1.1);
        assert_eq!(l.players[&a].rounds,rounds);assert_eq!(l.players[&a].missiles_left,before);
        assert_eq!(l.players[&a].fired.len(),1);
        l.handle(a,mgfire(91),1.2);
        l.handle(a,fire(91),1.2);
        assert_eq!(l.players[&a].rounds,rounds);assert_eq!(l.players[&a].fired.len(),2);
        let accepted=l.launch_instance(a,92,Some(&launcher.key),launcher.missile.as_ref().unwrap(),[0.0,2.0,0.0],[0.0,0.0,1.0],1.3);
        assert!(accepted.iter().any(|(_,m)|matches!(m,ServerMsg::Launched {seq:92,..})));
        assert_eq!(l.players[&a].rounds,rounds.map(|r|r-1));
        let state=serde_json::to_value(&l.players[&a].combat).unwrap();
        let ammo=l.players[&a].missiles_left.clone();
        l.handle(a,fire(92),1.4);l.handle(a,mgfire(92),1.4);
        let replay=l.launch_instance(a,92,Some(&launcher.key),launcher.missile.as_ref().unwrap(),[0.0,2.0,0.0],[0.0,0.0,1.0],1.4);
        assert_eq!(replay.len(),1);
        let conflict=l.launch_instance(a,92,Some("gun:99:0"),launcher.missile.as_ref().unwrap(),[0.0,2.0,0.0],[0.0,0.0,1.0],1.5);
        launch_rejection(&conflict,a,92,"sequence_conflict");
        assert_eq!(l.players[&a].missiles_left,ammo);assert_eq!(serde_json::to_value(&l.players[&a].combat).unwrap(),state);
    }

    #[test]
    fn legacy_mg_is_unique_and_currently_healthy_while_cannon_proofs_outlive_shooter() {
        let (mut l,a,b,_) = combat_lobby();
        let t=&l.targets["de_tiger_e"];
        let mg=t.weapon_bindings.values().find(|b|b.kind==WeaponKind::MachineGun).unwrap().clone();
        assert!(t.weapon_bindings.values().filter(|b|b.kind==WeaponKind::MachineGun && b.model_id==mg.model_id).count()>1);
        let shot=json!({"o":[3,1.9,0.3],"d":[-1,0,0],"speed":700,"dist":400});
        let before=serde_json::to_value(&l.players[&b].combat).unwrap();
        assert!(l.handle(a,wire(json!({"t":"mg_hit","gun":mg.model_id,"target":b,"shot":shot})),1.0).is_empty());
        assert_eq!(serde_json::to_value(&l.players[&b].combat).unwrap(),before);
        l.handle(a,wire(json!({"t":"fire","seq":101,"instance":"gun:0:0","shell":"apcbc_88_l56","o":[0,2,0],"d":[0,0,1]})),1.0);
        let p=l.players.get_mut(&a).unwrap();p.alive=false;p.combat.as_mut().unwrap().destroyed=true;
        let out=l.handle(a,wire(json!({"t":"hit","seq":101,"target":b,"result":"penetrated","shot":shot})),1.1);
        assert!(out.iter().any(|(_,m)|matches!(m,ServerMsg::Damage {..})));
        assert!(l.players[&a].fired[0].used);
    }

    #[test]
    fn aps_world_uses_own_authority_after_main_damage_and_stops_for_own_gun_damage() {
        for broken_aps in [false,true] {
            let (mut l,a,b)=missile_lobby();
            let t=&l.targets["su_t10m"];
            let main=t.weapon_bindings["gun:0:0"].critical[0];
            let aps=t.def.modules.iter().position(|m|m.id=="oplot_gun").unwrap();
            let st=l.players.get_mut(&b).unwrap().combat.as_mut().unwrap();
            st.modules[main]=0.0;if broken_aps {st.modules[aps]=0.0;}
            // A fake client health/capability object has no say in World control.
            l.players.get_mut(&b).unwrap().state.as_mut().unwrap()["caps"]=json!({"can_fire":!broken_aps,"weapons":{},"aps_dispersion_mult":99});
            let (events,_) = tow_at_b(&mut l,a,120,1.0);
            let fired=events.iter().any(|e|e["type"]=="fire_start");
            assert_eq!(fired,!broken_aps);
            let room=l.players[&b].room.unwrap();
            let left=l.rooms[&room].world.as_ref().unwrap().aps_of(b).unwrap().rounds;
            assert_eq!(left<900,!broken_aps);
        }
    }

    #[test]
    fn manual_aps_ammo_ownership_comes_from_binding_not_shell_caliber() {
        let (mut l,_,b)=missile_lobby();let room=l.players[&b].room.unwrap();
        let mut def=l.targets["su_t10m"].def.clone();
        // A test main cannon with the same declared round as Oplot remains a different magazine.
        def.weapons["main_gun"]["ammo"]=json!(["api_145_b32"]);
        l.targets.insert("su_t10m".into(),Target::new(def,&[]));l.spawn(b,0.0);
        let cap=l.targets["su_t10m"].def.ammo_capacity;
        let fire=|seq,instance|wire(json!({"t":"fire","seq":seq,"instance":instance,"shell":"api_145_b32","o":[0,3,600],"d":[0,0,-1]}));
        let out=l.handle(b,fire(130,"gun:0:0"),1.0);
        assert!(out.iter().any(|(_,m)|matches!(m,ServerMsg::FireAccepted {..})));
        assert_eq!(l.players[&b].rounds,Some(cap-1));
        assert_eq!(l.rooms[&room].world.as_ref().unwrap().aps_of(b).unwrap().rounds,900);
        // Disabled main does not bar manual protection fire; protection still owns its own rounds.
        let main=l.targets["su_t10m"].weapon_bindings["gun:0:0"].critical[0];
        l.players.get_mut(&b).unwrap().combat.as_mut().unwrap().modules[main]=0.0;
        l.handle(b,ClientMsg::Aps {enabled:false,rate:None},1.1);
        let aps=l.targets["su_t10m"].weapon_bindings.values().find(|w|w.critical.iter().any(|&i|l.targets["su_t10m"].def.modules[i].kind==tg_combat::ModuleKind::ApsGun)).unwrap().key.clone();
        let out=l.handle(b,fire(131,&aps),1.2);
        assert!(out.iter().any(|(_,m)|matches!(m,ServerMsg::FireAccepted {..})));
        assert_eq!(l.players[&b].rounds,Some(cap-1));
        assert_eq!(l.rooms[&room].world.as_ref().unwrap().aps_of(b).unwrap().rounds,899);
    }

    #[test]
    fn missing_weapon_data_wrong_kind_and_ambiguous_legacy_discharge_fail_closed() {
        let (mut l,a,_)=missile_lobby();
        let t=&l.targets["us_m901_itv"];let shell=t.weapon_bindings["gun:0:0"].ammo[0].clone();
        let before=(l.players[&a].rounds,l.players[&a].missiles_left.clone(),serde_json::to_value(&l.players[&a].combat).unwrap());
        l.handle(a,wire(json!({"t":"fire","seq":140,"instance":"gun:0:0","shell":shell,"o":[0,2,0],"d":[0,0,1]})),1.0);
        assert!(l.players[&a].fired.is_empty());
        assert_eq!((l.players[&a].rounds,l.players[&a].missiles_left.clone(),serde_json::to_value(&l.players[&a].combat).unwrap()),before);
        l.targets.remove("us_m901_itv");
        launch_rejection(&l.launch(a,141,"bgm71a_tow",[0.0,2.0,0.0],[0.0,0.0,1.0],1.1),a,141,"weapon_disabled");
        assert_eq!((l.players[&a].rounds,l.players[&a].missiles_left.clone(),serde_json::to_value(&l.players[&a].combat).unwrap()),before);
        let (mut l,a,_)=missile_lobby();l.players.get_mut(&a).unwrap().vehicle="su_bmpt34".into();l.spawn(a,0.0);
        let shell=l.targets["su_bmpt34"].weapon_bindings.values().find(|b|b.kind==WeaponKind::Cannon).unwrap().ammo[0].clone();
        let before=serde_json::to_value(&l.players[&a].combat).unwrap();
        let out=l.handle(a,wire(json!({"t":"fire","seq":142,"shell":shell,"o":[0,2,0],"d":[0,0,1]})),1.2);
        assert!(matches!(out[0].1,ServerMsg::FireRejected {..}));assert!(l.players[&a].fired.is_empty());
        assert_eq!(serde_json::to_value(&l.players[&a].combat).unwrap(),before);
    }

    #[test]
    fn expired_proofs_do_not_reopen_sequences_and_cache_storage_is_bounded() {
        let (mut l,a,b,_) = combat_lobby();
        let mg=l.targets["de_tiger_e"].weapon_bindings.values().find(|b|b.kind==WeaponKind::MachineGun).unwrap().clone();
        for seq in 1..=2200 {
            l.mg_fire(a,seq,Some(&mg.key),&mg.model_id,[0.0,2.0,0.0],[0.0,0.0,1.0],seq as f64*0.03);
        }
        assert_eq!(l.players[&a].sequences.len(),MAX_SEQUENCES);
        assert!(l.players[&a].fired.len()<=AUTO_BURST);
        let before=l.players[&a].fired.len();
        l.mg_fire(a,1,Some(&mg.key),&mg.model_id,[0.0,2.0,0.0],[0.0,0.0,1.0],70.0);
        assert_eq!(l.players[&a].fired.len(),before);
        let st=serde_json::to_value(&l.players[&b].combat).unwrap();
        assert!(l.handle(a,wire(json!({"t":"mg_hit","seq":2200,"instance":mg.key,"gun":mg.model_id,"target":b,"shot":{"o":[3,2,4],"d":[-1,0,0],"speed":800,"dist":10}})),80.0).is_empty());
        assert_eq!(serde_json::to_value(&l.players[&b].combat).unwrap(),st);
        l.spawn(a,81.0);
        assert!(l.players[&a].sequences.is_empty()&&l.players[&a].fired.is_empty()&&l.players[&a].retired_seq==Some(2200));
    }

    #[test]
    fn missing_legacy_damage_state_still_spends_authoritative_cannon_and_missile_rounds() {
        let (mut l,a,_,_)=combat_lobby();let cap=l.targets["de_tiger_e"].def.ammo_capacity;
        l.players.get_mut(&a).unwrap().combat=None;
        l.handle(a,wire(json!({"t":"fire","seq":151,"instance":"gun:0:0","shell":"apcbc_88_l56","o":[0,2,0],"d":[0,0,1]})),1.0);
        assert_eq!(l.players[&a].rounds,Some(cap-1));
        let (mut l,a,_)=missile_lobby();let cap=l.targets["us_m901_itv"].def.ammo_capacity;
        l.players.get_mut(&a).unwrap().combat=None;
        let out=l.launch(a,151,"bgm71a_tow",[0.0,2.0,0.0],[0.0,0.0,1.0],1.0);
        assert!(out.iter().any(|(_,m)|matches!(m,ServerMsg::Launched {..})));
        assert_eq!(l.players[&a].rounds,Some(cap-1));
    }

}

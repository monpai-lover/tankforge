//! A tracked vehicle as the chain the forces really follow:
//!
//! ```text
//! terrain -> track contact -> road wheels -> suspension -> hull rigid body
//! engine -> gearbox -> final drive -> left / right track -> ground force -> hull
//!        -> suspension -> wheel positions -> track path -> visual
//! ```
//!
//! Nothing here sets the hull's attitude: heave, pitch and roll come from the suspension forces at
//! their mounts, weight transfer from the track forces acting at the ground below the centre of
//! mass. The systems:
//! * [`rigid_body::VehicleRigidBody`]: mass, centre of mass, inertia tensor, damping, forces at points
//! * [`suspension::SuspensionSystem`]: spring-damper units (single wheels or bogies), bump and rebound stops
//! * [`road_wheel`]: wheel stations, the track's support under each wheel, wheel spin
//! * [`track_path`]: the visual track loop at constant length, links by arc length
//! * [`track_contact`]: friction contacts along the tracks, impulse solve with the drive motors
//! * [`track_drive`]: differential drive targets, engine / steering motors, brakes
//! * [`powertrain`]: torque curve, automatic gearbox, final drive
//! * [`terrain`]: the [`terrain::Ground`] trait, ground rows, rigid run and belly contacts
//! * [`obstacle`]: boxes on the ground (walls, vehicles) the track belts and the hull collide with
//!
//! Multiplayer: the server runs [`step`] and sends a [`NetState`] (hull pose, velocities, track
//! speeds, engine speed, gear); clients put remote tanks there with [`apply_net_state`] and
//! rebuild their wheels and tracks with [`reconstruct_running_gear`].
//! (client/web/src/sim/tank/tank.js mirrors this file until the WASM build carries it.)
pub mod math;
pub mod obstacle;
pub mod powertrain;
pub mod rigid_body;
pub mod road_wheel;
pub mod suspension;
pub mod terrain;
pub mod track_contact;
pub mod track_drive;
pub mod track_path;

use crate::{terra, Input, VehicleParams};
use math::*;
use obstacle::{apply_obstacles, collision_points, HullBox, Obstacle};
use powertrain::Powertrain;
use rigid_body::{VehicleRigidBody, GRAVITY};
use road_wheel::{si, support_under, GearGeometry};
use serde::{Deserialize, Serialize};
use suspension::{SuspensionOpts, SuspensionState, SuspensionSystem};
use terrain::{ContactGeometry, ContactState, Ground};
use tg_vehicle::{LoadedVehicle, VehicleDef};
use track_contact::{solve_friction, track_contacts, Contact};
use track_drive::{drive_step, DriveEnv, DriveState};

const AIR_RHO: f64 = 1.225;

/// Box-like hull: inertia about the centre of mass along the hull axes [x, y, z], size [w, h, l].
pub fn box_inertia(mass: f64, size: [f64; 3]) -> V3 {
    let [w, h, l] = size;
    [mass * (h * h + l * l) / 12.0, mass * (w * w + l * l) / 12.0, mass * (w * w + h * h) / 12.0]
}

#[derive(Clone, Copy, Debug)]
pub struct TankOpts {
    /// Hull floor height in the hull frame.
    pub belly_y: f64,
    pub contacts_per_side: usize,
    pub substeps: usize,
}

impl Default for TankOpts {
    fn default() -> Self {
        Self { belly_y: 0.42, contacts_per_side: 12, substeps: 2 }
    }
}

/// Everything fixed about one vehicle's running gear and drivetrain.
#[derive(Clone, Debug)]
pub struct TankModel {
    pub pt: Powertrain,
    pub mass: f64,
    pub com: V3,
    pub inertia: V3,
    pub gear: GearGeometry,
    pub sp: SuspensionSystem,
    pub ct: ContactGeometry,
    pub substeps: usize,
    /// Mean pressure under the tracks, Pa.
    pub ground_pressure: f64,
    /// Hull-frame outline (track belts and hull box) that collides with obstacles.
    pub collide: Vec<V3>,
}

impl TankModel {
    pub fn new(params: &VehicleParams, def: &VehicleDef, gear: GearGeometry, opts: TankOpts) -> Self {
        let hull = &def.hull;
        let ph = &def.physics;
        let mass = hull.mass_kg as f64;
        let com = hull.center_of_mass.map(|x| x as f64);
        let height = hull.size_m[1] as f64 + 0.5 * def.turret.size_m[1] as f64;
        let inertia = ph.inertia_kgm2.map(|i| i.map(|x| x as f64)).unwrap_or_else(|| box_inertia(mass, [hull.size_m[0] as f64, height, hull.size_m[2] as f64]));
        let sp = SuspensionSystem::new(
            &gear,
            &SuspensionOpts {
                mass,
                cg_z: com[2],
                travel: Some(ph.suspension.travel_m as f64),
                stiffness: ph.suspension.stiffness as f64,
                damping: ph.suspension.damping as f64,
                kind: ph.suspension.kind.clone().unwrap_or_default(),
                freq_hz: ph.suspension_freq_hz.map(|x| x as f64),
                damping_ratio: ph.suspension_damping.map(|x| x as f64),
            },
        );
        let ct = ContactGeometry::new(&gear, &sp, opts.belly_y, opts.contacts_per_side);
        let ground_pressure = terra::ground_pressure(mass as f32, gear.track_width as f32, ct.contact_length as f32) as f64;
        let collide = collision_points(&gear, HullBox { hw: hull.size_m[0] as f64 / 2.0, y0: opts.belly_y, y1: hull.size_m[1] as f64, hl: hull.size_m[2] as f64 / 2.0 });
        Self { pt: Powertrain::new(params), mass, com, inertia, gear, sp, ct, substeps: opts.substeps.max(1), ground_pressure, collide }
    }

    /// From a loaded vehicle; None without a running gear in its visual description.
    pub fn from_vehicle(v: &LoadedVehicle, opts: TankOpts) -> Option<Self> {
        let gear = GearGeometry::from_visual(v.visual.as_ref()?.get("running_gear")?)?;
        Some(Self::new(&VehicleParams::from_vehicle(v), &v.def, gear, opts))
    }
}

/// What the rest of the game reads after a step.
#[derive(Clone, Copy, Debug, Default, Serialize)]
pub struct TankInfo {
    pub rpm: f64,
    pub gear: usize,
    pub reversing: bool,
    pub speed_kmh: f64,
    /// 0 = full grip, 1 = tracks fully spinning (the worse track).
    pub track_slip: f64,
    pub yaw_rate_deg: f64,
    /// Longitudinal acceleration, m/s^2, and the centripetal one.
    pub ax: f64,
    pub lateral_acc: f64,
    pub slip_left: f64,
    pub slip_right: f64,
    pub track_speed_left: f64,
    pub track_speed_right: f64,
    pub ground_speed_left: f64,
    pub ground_speed_right: f64,
    /// Ground force along each track, N.
    pub force_left: f64,
    pub force_right: f64,
    pub braking: bool,
    pub throttle_load: f64,
    pub heading: f64,
    pub pitch: f64,
    pub roll: f64,
    /// Hull velocity: forward, sideways (right +), yaw rate (clockwise +).
    pub u: f64,
    pub w: f64,
    pub r: f64,
}

/// One tank's changing state.
#[derive(Clone, Debug)]
pub struct Tank {
    pub body: VehicleRigidBody,
    pub ss: SuspensionState,
    pub cs: ContactState,
    pub ds: DriveState,
    /// Friction contacts of the last substep (debug, ground deformation, effects).
    pub contacts: Vec<Contact>,
    pub info: TankInfo,
    /// How far each track has run [left, right], m (wheel and link animation).
    pub travel: [f64; 2],
    /// Share of the ground under the tracks still fresh (1) rather than already pressed (0).
    pub rut: f64,
    /// Boxes the vehicle collides with this step (walls, other vehicles).
    pub obstacles: Vec<Obstacle>,
    /// Tracks shot off [left, right] (set by the damage model).
    pub broken: [bool; 2],
}

impl Tank {
    pub fn new(tm: &TankModel) -> Self {
        Self {
            body: VehicleRigidBody::new(tm.mass, tm.inertia, tm.com),
            ss: tm.sp.new_state(),
            cs: tm.ct.new_state(),
            ds: DriveState::new(&tm.pt, tm.mass),
            contacts: Vec::new(),
            info: TankInfo::default(),
            travel: [0.0; 2],
            rut: 1.0,
            obstacles: Vec::new(),
            broken: [false; 2],
        }
    }
}

fn rotate(v: V3, axis: V3, a: f64) -> V3 {
    let (s, c) = a.sin_cos();
    let d = dot(axis, v);
    let cr = cross(axis, v);
    [0, 1, 2].map(|i| v[i] * c + cr[i] * s + axis[i] * d * (1.0 - c))
}

/// Puts the tank standing on the ground at (x, z) facing `heading`, still: level with a plane
/// through the ground at the four track ends.
pub fn place(tm: &TankModel, t: &mut Tank, terrain: &dyn Ground, x: f64, z: f64, heading: f64) {
    let (sn, cs) = heading.sin_cos();
    let st = &tm.sp.stations;
    let l = (st[0].z - st[st.len() / 2 - 1].z) / 2.0 + 0.3;
    let xx = tm.ct.track_x;
    let at = |lx: f64, lz: f64| terrain.height(x + lx * cs + lz * sn, z - lx * sn + lz * cs);
    let (fr, fl, rr, rl) = (at(xx, l), at(-xx, l), at(xx, -l), at(-xx, -l));
    let pitch = ((fr + fl - rr - rl) / 2.0).atan2(2.0 * l);
    let roll = ((fr + rr - fl - rl) / 2.0).atan2(2.0 * xx);
    let b = &mut t.body;
    b.place([x, (fr + fl + rr + rl) / 4.0, z], heading);
    let origin = b.origin();
    // tilt: nose up by pitch, right side up by roll
    for (axis, a) in [(b.ex, -pitch), (b.ez, roll)] {
        b.ex = rotate(b.ex, axis, a);
        b.ey = rotate(b.ey, axis, a);
        b.ez = rotate(b.ez, axis, a);
    }
    b.pos = add(origin, b.world_dir(b.com));
    t.ss = tm.sp.new_state();
    t.cs = tm.ct.new_state();
    t.ds = DriveState::new(&tm.pt, tm.mass);
}

/// One step of `dt` (split into the model's substeps).
pub fn step(tm: &TankModel, t: &mut Tank, input: Input, terrain: &dyn Ground, dt: f64) -> TankInfo {
    let n = tm.substeps;
    let h = dt / n as f64;
    let u0 = dot(t.body.v, t.body.ez);
    let mut solved = Vec::new();
    for _ in 0..n {
        tm.ct.sample_ground(&mut t.cs, &t.body, terrain);
        let side_load = tm.sp.apply(&mut t.ss, &mut t.body, &t.cs.prof, h);
        let extra = tm.ct.apply_rigid_contacts(&mut t.cs, &mut t.body, terrain, h, &tm.sp, &t.ss);
        // walls, buildings, other vehicles: the track belts and the hull are solid against them
        apply_obstacles(&tm.collide, &mut t.body, &t.obstacles, h);
        let speed = len(t.body.v);
        if speed > 0.01 {
            let drag = scale(t.body.v, -0.5 * AIR_RHO * tm.pt.cd_a * speed);
            t.body.add_force(drag);
        }
        t.body.integrate_velocity(h);

        // drive: targets, engine, steering, brakes
        let u = dot(t.body.v, t.body.ez);
        let mid = terrain.surface(t.body.pos[0], t.body.pos[2]);
        let pf = terra::pressure_factor(mid.soil.as_ref(), tm.ground_pressure as f32) as f64;
        let roll_mult = 1.0 + (mid.rolling_mult as f64 - 1.0) * pf * (0.35 + 0.65 * t.rut.clamp(0.0, 1.0));
        let roll_total = tm.pt.rolling_force(roll_mult, side_load[0] + side_load[1]);
        let grade = tm.mass * GRAVITY * t.body.ez[1];
        let env = DriveEnv { u, resist: roll_total + 0.5 * AIR_RHO * tm.pt.cd_a * u * u, grade };
        drive_step(&tm.pt, tm.mass, &mut t.ds, input, &env, h);
        t.ds.motor.broken = t.broken;
        // rolling losses hold each track back (never past standing still)
        for i in 0..2 {
            let b = &mut t.ds.belts[i];
            let dv = tm.pt.rolling_force(roll_mult, side_load[i]) * h / b.m;
            b.v = if b.v.abs() <= dv { 0.0 } else { b.v - dv * sign(b.v) };
        }

        let mut contacts = track_contacts(&tm.ct, &t.cs, &t.body, &tm.sp, &t.ss, terrain);
        contacts.extend(extra);
        solve_friction(&mut contacts, &mut t.body, &mut t.ds.belts, t.ds.brakes, h, 10, Some(&mut t.ds.motor));
        let mo = t.ds.motor;
        t.ds.drive = [mo.f_mean / 2.0 + mo.f_steer, mo.f_mean / 2.0 - mo.f_steer];
        t.ds.load = if mo.pushing && t.ds.f_eng > 0.0 {
            (mo.f_mean.abs() / t.ds.f_eng + (mo.f_steer * (t.ds.belts[0].v - t.ds.belts[1].v)).abs() / tm.pt.power).min(1.0)
        } else {
            0.0
        };
        t.body.integrate_position(h);
        for i in 0..2 {
            t.travel[i] += t.ds.belts[i].v * h;
        }
        solved = contacts;
    }
    t.contacts = solved;

    let b = &t.body;
    let att = b.attitude();
    let u = dot(b.v, b.ez);
    let w = dot(b.v, b.ex);
    let r = dot(b.w, b.ey);
    let half = tm.pt.gauge / 2.0;
    let slip = |side: i8| {
        let bv = t.ds.belts[si(side)].v;
        let g = u - side as f64 * r * half;
        ((bv - g).abs() / bv.abs().max(g.abs()).max(1.0)).min(1.0)
    };
    let mut force = [0.0; 2];
    for c in &t.contacts {
        if c.side != 0 {
            force[si(c.side)] += c.fl;
        }
    }
    t.info = TankInfo {
        rpm: t.ds.gearbox.rpm,
        gear: t.ds.gearbox.gear,
        reversing: t.ds.reversing,
        speed_kmh: u * 3.6,
        track_slip: slip(1).max(slip(-1)),
        yaw_rate_deg: r.to_degrees(),
        ax: (u - u0) / dt,
        lateral_acc: u * r,
        slip_left: slip(-1),
        slip_right: slip(1),
        track_speed_left: t.ds.belts[0].v,
        track_speed_right: t.ds.belts[1].v,
        ground_speed_left: u + r * half,
        ground_speed_right: u - r * half,
        force_left: force[0],
        force_right: force[1],
        braking: t.ds.braking,
        throttle_load: t.ds.load,
        heading: att.heading,
        pitch: att.pitch,
        roll: att.roll,
        u,
        w,
        r,
    };
    t.info
}

// ---------------------------------------------------------------- multiplayer

/// What the server sends for a tank (authoritative): hull position (hull-frame origin, world),
/// orientation (hull axes x and z; y follows), velocities, track speeds, engine speed and gear.
/// Wheels, track shape and sprocket phase are rebuilt by each client from this.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct NetState {
    pub pos: [f32; 3],
    pub ex: [f32; 3],
    pub ez: [f32; 3],
    pub v: [f32; 3],
    pub w: [f32; 3],
    /// [left, right], m/s.
    pub track: [f32; 2],
    pub rpm: f32,
    pub gear: u8,
}

fn f3(v: V3) -> [f32; 3] {
    v.map(|x| x as f32)
}
fn d3(v: [f32; 3]) -> V3 {
    v.map(|x| x as f64)
}

pub fn net_state(t: &Tank) -> NetState {
    let b = &t.body;
    NetState {
        pos: f3(b.origin()),
        ex: f3(b.ex),
        ez: f3(b.ez),
        v: f3(b.v),
        w: f3(b.w),
        track: [t.ds.belts[0].v as f32, t.ds.belts[1].v as f32],
        rpm: t.ds.gearbox.rpm as f32,
        gear: t.ds.gearbox.gear as u8,
    }
}

/// Puts a remote tank into the state the server sent (no forces are simulated for it).
pub fn apply_net_state(t: &mut Tank, s: &NetState) {
    let b = &mut t.body;
    b.ex = norm(d3(s.ex));
    b.ez = norm(d3(s.ez));
    b.ey = cross(b.ez, b.ex);
    b.pos = add(d3(s.pos), b.world_dir(b.com));
    b.v = d3(s.v);
    b.w = d3(s.w);
    t.ds.belts[0].v = s.track[0] as f64;
    t.ds.belts[1].v = s.track[1] as f64;
    t.ds.gearbox.rpm = s.rpm as f64;
    t.ds.gearbox.gear = s.gear as usize;
}

/// Rebuilds a remote tank's road wheels from its hull pose and the ground: each wheel stands on
/// its ground within its travel, or hangs from its stop. Tracks run on at the sent speeds.
pub fn reconstruct_running_gear(tm: &TankModel, t: &mut Tank, terrain: &dyn Ground, dt: f64) {
    tm.ct.sample_ground(&mut t.cs, &t.body, terrain);
    let sp = &tm.sp;
    let up_y = t.body.ey[1].max(0.2);
    for (i, s) in sp.stations.iter().enumerate() {
        let sup = support_under(sp.window, &t.cs.prof[si(s.side)], s);
        let h = t.body.world_point([s.x, s.y, s.z])[1];
        let x = (sup + s.r + sp.thickness - h) / up_y;
        t.ss.grounded[i] = x >= -sp.rebound;
        t.ss.comp[i] = x.clamp(-sp.rebound, sp.travel + 0.03);
    }
    for i in 0..2 {
        t.travel[i] += t.ds.belts[i].v * dt;
    }
}

#[cfg(test)]
mod tests;

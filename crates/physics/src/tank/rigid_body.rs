//! VehicleRigidBody: the hull as one rigid body with mass, centre of mass and a diagonal inertia
//! tensor (hull axes). Every force acts at a point ([`VehicleRigidBody::add_force_at`]), so a
//! force off the centre of mass also turns the hull: the hull's pitch and roll are a result of the
//! suspension forces, never set directly.
//! Hull frame: +X right, +Y up, +Z forward, origin on the ground under the hull at static ride.
//! (client/web/src/sim/tank/body.js mirrors this file.)
use super::math::*;
use super::running_gear_dynamics::{MassResponse, RunningGearModel, RunningGearState, WheelBlend};
use std::sync::Arc;

pub const GRAVITY: f64 = 9.81;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Attitude {
    /// Clockwise from +Z (towards +X).
    pub heading: f64,
    /// Nose up +.
    pub pitch: f64,
    /// Right side up +.
    pub roll: f64,
}

#[derive(Clone, Debug)]
pub struct VehicleRigidBody {
    pub mass: f64,
    /// [Ixx, Iyy, Izz] about the centre of mass in hull axes, kg m^2.
    pub inertia: V3,
    /// Centre of mass in the hull frame.
    pub com: V3,
    /// World position of the centre of mass.
    pub pos: V3,
    /// Hull axes in world space.
    pub ex: V3,
    pub ey: V3,
    pub ez: V3,
    /// Linear and angular velocity, world.
    pub v: V3,
    pub w: V3,
    pub linear_damping: f64,
    pub angular_damping: f64,
    /// Tracked only. q/qv live here so all hull and wheel impulses use the same operator.
    pub running_gear: Option<RunningGearState>,
    f: V3,
    t: V3,
}

impl VehicleRigidBody {
    pub fn new(mass: f64, inertia: V3, com: V3) -> Self {
        Self {
            mass,
            inertia,
            com,
            pos: [0.0, com[1], 0.0],
            ex: [1.0, 0.0, 0.0],
            ey: [0.0, 1.0, 0.0],
            ez: [0.0, 0.0, 1.0],
            v: [0.0; 3],
            w: [0.0; 3],
            linear_damping: 0.01,
            angular_damping: 0.15,
            running_gear: None,
            f: [0.0; 3],
            t: [0.0; 3],
        }
    }

    pub fn clear_forces(&mut self) {
        self.f = [0.0; 3];
        self.t = [0.0; 3];
    }

    #[cfg(test)]
    pub(crate) fn accumulated_force_torque(&self) -> (V3, V3) {
        (self.f, self.t)
    }

    /// Puts the hull frame's origin at `origin`, heading `yaw` (clockwise from +Z), level and still.
    pub fn place(&mut self, origin: V3, yaw: f64) {
        let (s, c) = yaw.sin_cos();
        self.ex = [c, 0.0, -s];
        self.ey = [0.0, 1.0, 0.0];
        self.ez = [s, 0.0, c];
        self.pos = add(origin, self.world_dir(self.com));
        self.v = [0.0; 3];
        self.w = [0.0; 3];
        if let Some(rg) = &mut self.running_gear { rg.reset(); }
    }

    pub fn world_dir(&self, d: V3) -> V3 {
        [
            self.ex[0] * d[0] + self.ey[0] * d[1] + self.ez[0] * d[2],
            self.ex[1] * d[0] + self.ey[1] * d[1] + self.ez[1] * d[2],
            self.ex[2] * d[0] + self.ey[2] * d[1] + self.ez[2] * d[2],
        ]
    }

    pub fn local_dir(&self, d: V3) -> V3 {
        [dot(d, self.ex), dot(d, self.ey), dot(d, self.ez)]
    }

    /// Hull-frame point -> world.
    pub fn world_point(&self, p: V3) -> V3 {
        add(self.pos, self.world_dir(sub(p, self.com)))
    }

    /// World point -> hull frame.
    pub fn local_point(&self, p: V3) -> V3 {
        add(self.local_dir(sub(p, self.pos)), self.com)
    }

    /// World position of the hull frame's origin.
    pub fn origin(&self) -> V3 {
        self.world_point([0.0; 3])
    }

    pub fn point_velocity(&self, pw: V3) -> V3 {
        self.coupled_point_velocity(pw, WheelBlend::default())
    }

    pub fn coupled_point_velocity(&self, pw: V3, blend: WheelBlend) -> V3 {
        let mut v = add(self.v, cross(self.w, sub(pw, self.pos)));
        if let Some(rg) = &self.running_gear {
            let qv = (0..2).filter(|&k| blend.w[k] != 0.0).map(|k| blend.w[k] * rg.qv[blend.i[k]]).sum::<f64>();
            v = madd(v, self.ey, qv);
        }
        v
    }

    /// I^-1 (world) applied to a world vector.
    pub fn inv_inertia(&self, x: V3) -> V3 {
        let l = self.local_dir(x);
        self.world_dir([l[0] / self.inertia[0], l[1] / self.inertia[1], l[2] / self.inertia[2]])
    }

    /// Effective inverse mass of the body for a push along unit `dir` at world point `pw`.
    pub fn inv_mass_along(&self, dir: V3, pw: V3) -> f64 {
        self.coupled_inv_mass_along(dir, pw, WheelBlend::default())
    }

    pub fn coupled_inv_mass_along(&self, dir: V3, pw: V3, blend: WheelBlend) -> f64 {
        if let Some(rg) = &self.running_gear {
            let d = self.local_dir(dir); let r = self.local_dir(sub(pw, self.pos)); let t = cross(r, d);
            return rg.inverse_mass([d[0], d[1], d[2], t[0], t[1], t[2]], blend, d[1]);
        }
        let rn = cross(sub(pw, self.pos), dir);
        1.0 / self.mass + dot(rn, self.inv_inertia(rn))
    }

    pub fn add_force_at(&mut self, force: V3, pw: V3) {
        self.f = add(self.f, force);
        self.t = add(self.t, cross(sub(pw, self.pos), force));
    }

    pub fn add_force(&mut self, force: V3) {
        self.f = add(self.f, force);
    }

    pub fn apply_impulse_at(&mut self, j: V3, pw: V3) {
        self.coupled_apply_impulse_at(j, pw, WheelBlend::default());
    }

    pub fn coupled_apply_impulse_at(&mut self, j: V3, pw: V3, blend: WheelBlend) {
        if self.running_gear.is_some() {
            let jl = self.local_dir(j); let r = self.local_dir(sub(pw, self.pos)); let tau = cross(r, jl);
            let (dv, dw) = self.running_gear.as_mut().unwrap().impulse([jl[0], jl[1], jl[2], tau[0], tau[1], tau[2]], blend, jl[1]);
            self.v = add(self.v, self.world_dir(dv)); self.w = add(self.w, self.world_dir(dw));
            return;
        }
        self.v = madd(self.v, j, 1.0 / self.mass);
        self.w = add(self.w, self.inv_inertia(cross(sub(pw, self.pos), j)));
    }

    /// Velocity step from the accumulated forces (and gravity), then clears them.
    pub fn integrate_velocity(&mut self, dt: f64) {
        if self.running_gear.is_some() {
            let f = self.local_dir(self.f); let t = self.local_dir(self.t); let w = self.local_dir(self.w); let g = self.local_dir([0.0, -GRAVITY, 0.0]);
            let (dv, dw) = self.running_gear.as_mut().unwrap().integrate_velocity(f, t, w, g, dt);
            self.v = add(self.v, self.world_dir(dv)); self.w = add(self.w, self.world_dir(dw));
            let v = self.local_dir(self.v); let w = self.local_dir(self.w);
            let (dv, dw) = self.running_gear.as_mut().unwrap().damp(v, w, self.linear_damping, self.angular_damping, self.inertia, dt);
            self.v = add(self.v, self.world_dir(dv)); self.w = add(self.w, self.world_dir(dw));
            self.clear_forces(); return;
        }
        self.v = madd(self.v, self.f, dt / self.mass);
        self.v[1] -= GRAVITY * dt;
        // gyroscopic term in hull axes: I w' = t - w x (I w)
        let wl = self.local_dir(self.w);
        let iw = [self.inertia[0] * wl[0], self.inertia[1] * wl[1], self.inertia[2] * wl[2]];
        let gyro = self.world_dir(cross(wl, iw));
        self.w = add(self.w, scale(self.inv_inertia(sub(self.t, gyro)), dt));
        self.v = scale(self.v, (1.0 - self.linear_damping * dt).max(0.0));
        self.w = scale(self.w, (1.0 - self.angular_damping * dt).max(0.0));
        self.clear_forces();
    }

    pub fn integrate_position(&mut self, dt: f64) {
        self.pos = madd(self.pos, self.v, dt);
        // rotate the axes by w dt, then re-orthonormalise
        let w = self.w;
        let rot = |a: V3| add(a, scale(cross(w, a), dt));
        let ez = norm(rot(self.ez));
        let ey = rot(self.ey);
        let ex = norm(cross(ey, ez));
        let ey = cross(ez, ex);
        self.ex = ex;
        self.ey = norm(ey);
        self.ez = ez;
        if let Some(rg) = &mut self.running_gear {
            for i in 0..rg.q.len() { rg.q[i] += rg.qv[i] * dt; }
            rg.refresh();
        }
    }

    pub fn install_running_gear(&mut self, model: Arc<RunningGearModel>) { self.running_gear = Some(RunningGearState::new(model)); }
    pub fn prepare_contact_response(&self, dir: V3, pw: V3, blend: WheelBlend, cache: &mut MassResponse) {
        let d = self.local_dir(dir); let r = self.local_dir(sub(pw, self.pos)); let t = cross(r, d);
        self.running_gear.as_ref().unwrap().prepare_response([d[0], d[1], d[2], t[0], t[1], t[2]], blend, d[1], cache);
    }
    pub fn prepare_normal_response(&mut self, index: usize, dir: V3, pw: V3, blend: WheelBlend) {
        let d = self.local_dir(dir); let r = self.local_dir(sub(pw, self.pos)); let t = cross(r, d);
        self.running_gear.as_mut().unwrap().prepare_normal(index, [d[0], d[1], d[2], t[0], t[1], t[2]], blend, d[1]);
    }
    pub fn apply_cached_response(&mut self, cache: &MassResponse, impulse: f64) {
        let (dv, dw) = self.running_gear.as_mut().unwrap().apply_response(cache, impulse);
        self.v = add(self.v, self.world_dir(dv)); self.w = add(self.w, self.world_dir(dw));
    }
    pub fn apply_relative_cached(&mut self, index: usize, impulse: f64) {
        let (dv, dw) = self.running_gear.as_mut().unwrap().apply_relative_cache(index, impulse);
        self.v = add(self.v, self.world_dir(dv)); self.w = add(self.w, self.world_dir(dw));
    }
    pub fn apply_normal_cached(&mut self, index: usize, impulse: f64) {
        let (dv, dw) = self.running_gear.as_mut().unwrap().apply_normal_cache(index, impulse);
        self.v = add(self.v, self.world_dir(dv)); self.w = add(self.w, self.world_dir(dw));
    }
    pub fn refresh_running_gear(&mut self) { if let Some(rg) = &mut self.running_gear { rg.refresh(); } }
    pub fn relative_inv_mass(&self, blend: WheelBlend) -> f64 { self.running_gear.as_ref().unwrap().inverse_mass([0.0; 6], blend, 1.0) }
    pub fn apply_relative_impulse(&mut self, blend: WheelBlend, j: f64) {
        let (dv, dw) = self.running_gear.as_mut().unwrap().impulse([0.0; 6], blend, j);
        self.v = add(self.v, self.world_dir(dv)); self.w = add(self.w, self.world_dir(dw));
    }

    pub fn attitude(&self) -> Attitude {
        Attitude {
            heading: self.ez[0].atan2(self.ez[2]),
            pitch: self.ez[1].clamp(-1.0, 1.0).asin(),
            roll: self.ex[1].clamp(-1.0, 1.0).asin(),
        }
    }
}

// TEMPORARY JS mirror of crates/weapon turret.rs + fire.rs and tg_shared::HullPose.
// Angles in radians. Yaw is clockwise from +Z (hull forward) towards +X; pitch is up-positive.

export const wrapPi = (a) => {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
};

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rad = (d) => (d * Math.PI) / 180;

export function newTurret() {
  return { yaw: 0, pitch: 0 };
}

/** Rate-limited slew towards (targetYaw, targetPitch). drive scales model damaged traverse / elevation. */
export function aimStep(gun, s, targetYaw, targetPitch, drive, dt) {
  const maxYaw = rad(gun.traverse_deg_s) * drive.traverse * dt;
  const dy = wrapPi(targetYaw - s.yaw);
  s.yaw = wrapPi(s.yaw + clamp(dy, -maxYaw, maxYaw));
  const lo = -rad(gun.max_depression_deg);
  const hi = rad(gun.max_elevation_deg);
  const tp = clamp(targetPitch, lo, hi);
  const maxPitch = rad(gun.elevate_deg_s) * drive.elevate * dt;
  s.pitch = clamp(s.pitch + clamp(tp - s.pitch, -maxPitch, maxPitch), lo, hi);
}

/**
 * Traverse for a turret with a limited arc. `facing` is the centre of the arc (rad, hull frame),
 * `limit` = [min, max] offsets from it (rad). The turret never swings through the blocked sector.
 * Returns the yaw it is trying to reach (so callers can tell whether the target is inside the arc).
 */
export function traverseLimited(s, targetYaw, facing, limit, rateRad, dt) {
  const max = Math.max(0, rateRad * dt);
  if (!limit) {
    s.yaw = wrapPi(s.yaw + clamp(wrapPi(targetYaw - s.yaw), -max, max));
    return targetYaw;
  }
  const rel = clamp(wrapPi(s.yaw - facing), limit[0], limit[1]);
  const want = clamp(wrapPi(targetYaw - facing), limit[0], limit[1]);
  s.yaw = wrapPi(facing + rel + clamp(want - rel, -max, max));
  return wrapPi(facing + want);
}

/** Elevation only (same rules as aimStep). */
export function elevate(gun, s, targetPitch, scale, dt) {
  const lo = -rad(gun.max_depression_deg);
  const hi = rad(gun.max_elevation_deg);
  const tp = clamp(targetPitch, lo, hi);
  const max = rad(gun.elevate_deg_s) * scale * dt;
  s.pitch = clamp(s.pitch + clamp(tp - s.pitch, -max, max), lo, hi);
}

/** Rotate a vector about +Y, clockwise seen from above (so +Z turns towards +X). */
export function rotateYaw(v, yaw) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

export function gunDirLocal(t) {
  const cp = Math.cos(t.pitch);
  return [Math.sin(t.yaw) * cp, Math.sin(t.pitch), Math.cos(t.yaw) * cp];
}

/**
 * mount = {pivot: turret ring centre, trunnion: gun pivot at yaw 0, muzzleOffset: trunnion -> muzzle (m)}
 * Returns {pos, dir} in hull-local space.
 */
export function muzzleLocal(mount, t) {
  const rel = [mount.trunnion[0] - mount.pivot[0], mount.trunnion[1] - mount.pivot[1], mount.trunnion[2] - mount.pivot[2]];
  const tr = rotateYaw(rel, t.yaw);
  const dir = gunDirLocal(t);
  // Off-axis coax and launcher mouths rotate about their shared elevation
  // hinge; the complete offset follows pitch, including its vertical component.
  let offset = dir.map(v => v * mount.muzzleOffset);
  if (mount.muzzleVector) {
    const [x, y, z] = mount.muzzleVector;
    const c = Math.cos(t.pitch), s = Math.sin(t.pitch);
    offset = rotateYaw([x, y * c + z * s, -y * s + z * c], t.yaw);
  }
  return {
    trunnion: [mount.pivot[0] + tr[0], mount.pivot[1] + tr[1], mount.pivot[2] + tr[2]],
    pos: [
      mount.pivot[0] + tr[0] + offset[0],
      mount.pivot[1] + tr[1] + offset[1],
      mount.pivot[2] + tr[2] + offset[2],
    ],
    dir,
  };
}

/** pose = {pos:[x,y,z], heading}. */
export function toWorldPoint(pose, p) {
  const r = rotateYaw(p, pose.heading);
  return [pose.pos[0] + r[0], pose.pos[1] + r[1], pose.pos[2] + r[2]];
}
export function toWorldDir(pose, d) {
  return rotateYaw(d, pose.heading);
}
export function toLocalPoint(pose, p) {
  return rotateYaw([p[0] - pose.pos[0], p[1] - pose.pos[1], p[2] - pose.pos[2]], -pose.heading);
}
export function toLocalDir(pose, d) {
  return rotateYaw(d, -pose.heading);
}

export function muzzleWorld(pose, mount, t) {
  const m = muzzleLocal(mount, t);
  return { pos: toWorldPoint(pose, m.pos), dir: toWorldDir(pose, m.dir), trunnion: toWorldPoint(pose, m.trunnion) };
}

// ------------------------------------------------------------------ fire control

export function newGunState() {
  return { reloadRemaining: 0, selectedAmmo: 0 };
}

export function tickReload(st, dt) {
  st.reloadRemaining = Math.max(0, st.reloadRemaining - dt);
}

/** Returns {ok:true, ammo} or {ok:false, reason:'disabled'|'reloading'|'no_ammo'}. */
export function tryFire(gun, st, canFire, reloadMultiplier) {
  if (!canFire) return { ok: false, reason: 'disabled' };
  if (st.reloadRemaining > 0) return { ok: false, reason: 'reloading' };
  const ammo = gun.ammo[st.selectedAmmo];
  if (!ammo) return { ok: false, reason: 'no_ammo' };
  st.reloadRemaining = gun.reload_s * reloadMultiplier;
  return { ok: true, ammo };
}

/** Random direction inside a cone of half-angle dispersion_mrad around dir (unit). */
export function disperse(dir, dispersionMrad, rng) {
  if (dispersionMrad <= 0) return dir;
  const ang = Math.sqrt(rng.nextF32()) * dispersionMrad * 0.001;
  const az = rng.nextF32() * 2 * Math.PI;
  const a = Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = [dir[1] * a[2] - dir[2] * a[1], dir[2] * a[0] - dir[0] * a[2], dir[0] * a[1] - dir[1] * a[0]];
  const ul = Math.hypot(u[0], u[1], u[2]);
  u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const v = [dir[1] * u[2] - dir[2] * u[1], dir[2] * u[0] - dir[0] * u[2], dir[0] * u[1] - dir[1] * u[0]];
  const t = Math.tan(ang);
  const d = [
    dir[0] + (u[0] * Math.cos(az) + v[0] * Math.sin(az)) * t,
    dir[1] + (u[1] * Math.cos(az) + v[1] * Math.sin(az)) * t,
    dir[2] + (u[2] * Math.cos(az) + v[2] * Math.sin(az)) * t,
  ];
  const l = Math.hypot(d[0], d[1], d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
}

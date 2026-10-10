// Minimal column-major 4x4 matrix helpers (right-handed, +Y up). No dependencies.

export function m4() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mul(a, b, out = new Float32Array(16)) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4];
    const b1 = b[c * 4 + 1];
    const b2 = b[c * 4 + 2];
    const b3 = b[c * 4 + 3];
    out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

export function translation(x, y, z) {
  const m = m4();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

export function scaling(x, y, z) {
  const m = m4();
  m[0] = x;
  m[5] = y;
  m[10] = z;
  return m;
}

export function rotX(a) {
  const m = m4();
  const c = Math.cos(a);
  const s = Math.sin(a);
  m[5] = c;
  m[6] = s;
  m[9] = -s;
  m[10] = c;
  return m;
}

/** Positive angle turns +Z towards +X (clockwise seen from above) -- same as the sim's heading. */
export function rotY(a) {
  const m = m4();
  const c = Math.cos(a);
  const s = Math.sin(a);
  m[0] = c;
  m[2] = -s;
  m[8] = s;
  m[10] = c;
  return m;
}

export function rotZ(a) {
  const m = m4();
  const c = Math.cos(a);
  const s = Math.sin(a);
  m[0] = c;
  m[1] = s;
  m[4] = -s;
  m[5] = c;
  return m;
}

/** T * Rx * Ry * Rz (three.js 'XYZ' Euler order), angles in radians. */
export function compose(pos, rot) {
  let m = translation(pos[0], pos[1], pos[2]);
  if (rot) {
    if (rot[0]) m = mul(m, rotX(rot[0]));
    if (rot[1]) m = mul(m, rotY(rot[1]));
    if (rot[2]) m = mul(m, rotZ(rot[2]));
  }
  return m;
}

export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function ortho(l, r, b, t, n, f) {
  const m = m4();
  m[0] = 2 / (r - l);
  m[5] = 2 / (t - b);
  m[10] = -2 / (f - n);
  m[12] = -(r + l) / (r - l);
  m[13] = -(t + b) / (t - b);
  m[14] = -(f + n) / (f - n);
  return m;
}

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function lookAt(eye, target, up = [0, 1, 0]) {
  const f = norm(sub(target, eye));
  const s = norm(cross(f, up));
  const u = cross(s, f);
  const m = m4();
  m[0] = s[0];
  m[4] = s[1];
  m[8] = s[2];
  m[1] = u[0];
  m[5] = u[1];
  m[9] = u[2];
  m[2] = -f[0];
  m[6] = -f[1];
  m[10] = -f[2];
  m[12] = -dot(s, eye);
  m[13] = -dot(u, eye);
  m[14] = dot(f, eye);
  return m;
}

/**
 * View matrix for this project's world, which is left-handed (+X right, +Y up, +Z forward):
 * world +X ends up on screen right when looking along +Z.
 */
export function lookAtLH(eye, forward, up = [0, 1, 0]) {
  const f = norm(forward);
  const s = norm(cross(up, f));
  const u = cross(f, s);
  const m = m4();
  m[0] = s[0];
  m[4] = s[1];
  m[8] = s[2];
  m[1] = u[0];
  m[5] = u[1];
  m[9] = u[2];
  m[2] = -f[0];
  m[6] = -f[1];
  m[10] = -f[2];
  m[12] = -dot(s, eye);
  m[13] = -dot(u, eye);
  m[14] = dot(f, eye);
  return { view: m, right: s, up: u, forward: f };
}

export function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

export function transformDir(m, d) {
  return [m[0] * d[0] + m[4] * d[1] + m[8] * d[2], m[1] * d[0] + m[5] * d[1] + m[9] * d[2], m[2] * d[0] + m[6] * d[1] + m[10] * d[2]];
}

/** Projects a world point to clip space; returns [ndcX, ndcY, w]. */
export function project(viewProj, p) {
  const x = viewProj[0] * p[0] + viewProj[4] * p[1] + viewProj[8] * p[2] + viewProj[12];
  const y = viewProj[1] * p[0] + viewProj[5] * p[1] + viewProj[9] * p[2] + viewProj[13];
  const w = viewProj[3] * p[0] + viewProj[7] * p[1] + viewProj[11] * p[2] + viewProj[15];
  return [x / w, y / w, w];
}

/** Scene-graph node. local = T(pos) * Ry(yaw) * Rx(pitch) * Rz(roll) unless a custom matrix is set. */
export class Node {
  constructor(name = '') {
    this.name = name;
    this.pos = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.local = null;
    this.world = m4();
    this.children = [];
    this.mesh = null;
    this.kind = 0;
    this.scroll = 0;
    this.visible = true;
    this.castShadow = true;
    this.texture = null;
  }
  add(child) {
    this.children.push(child);
    return child;
  }
  update(parent) {
    let l = this.local;
    if (!l) {
      l = translation(this.pos[0], this.pos[1], this.pos[2]);
      if (this.yaw) l = mul(l, rotY(this.yaw));
      if (this.pitch) l = mul(l, rotX(this.pitch));
      if (this.roll) l = mul(l, rotZ(this.roll));
    }
    this.world = parent ? mul(parent, l) : l;
    for (const c of this.children) c.update(this.world);
  }
  collect(out, excludedRoot = null) {
    if (!this.visible || this === excludedRoot) return out;
    if (this.mesh) out.push(this);
    for (const c of this.children) c.collect(out, excludedRoot);
    return out;
  }
}

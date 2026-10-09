// TEMPORARY JS mirror of crates/physics/src/tank/obstacle.rs -- keep the two in lockstep.
//
// Obstacles: boxes standing on the ground (walls, buildings, other vehicles). The tracks and the
// hull are solid against them: points along the outline of each track belt (ground run, the curve
// round the sprocket and idler, the upper run, at both edges of the track) and round the hull box
// are tested against every box near the vehicle. A point inside a box is pushed out through the
// nearest face by a stiff spring-damper force acting at that point, with friction along the face,
// so the rigid body does the rest: a track scraping a wall turns the hull, a block met by the front
// of the track lifts the nose and is climbed, a head-on wall stops the vehicle.
import { scale, sub, dot, madd } from './math3.js';
import { GRAVITY } from './body.js';

const K = 120; // spring of one point, in vehicle weights per metre of penetration
const ZETA = 0.9;
const MU = 0.4;
const SPACING = 0.45;

/**
 * Hull-frame points of the vehicle's outline. gear: running gear (stations, sprocket, idler,
 * trackX, trackWidth, thickness); hull: {hw, y0, y1, hl} (half width, floor, deck, half length).
 */
export function collisionPoints(gear, hull) {
  const pts = [];
  const st = gear.stations;
  const ends = [gear.sprocket, gear.idler].sort((a, b) => b.z - a.z);
  const [front, rear] = ends;
  const bottom = Math.min(...st.map((s) => s.y - s.r)) - gear.thickness * 0.5 + 0.06;
  const top = Math.max(front.y + front.r, rear.y + rear.r, ...st.map((s) => s.y + s.r)) + gear.thickness * 0.5;
  const outline = [];
  // ground run and upper run, rear to front
  for (let z = rear.z; z <= front.z + 1e-6; z += SPACING) {
    outline.push([bottom, z], [top, z]);
  }
  // the curves round the end wheels (front and back halves of the circles)
  for (const [w, dir] of [[front, 1], [rear, -1]]) {
    const r = w.r + gear.thickness * 0.5;
    for (let a = -Math.PI / 2; a <= Math.PI / 2 + 1e-6; a += Math.PI / 6) outline.push([w.y + r * Math.sin(a), w.z + dir * r * Math.cos(a)]);
  }
  for (const side of [1, -1]) {
    for (const edge of [-0.5, 0.5]) {
      const x = side * (gear.trackX + edge * gear.trackWidth);
      for (const [y, z] of outline) pts.push([x, y, z]);
    }
  }
  // the hull box: corners, edge midpoints, and points along its long sides
  for (const x of [-hull.hw, 0, hull.hw]) {
    for (const y of [hull.y0, (hull.y0 + hull.y1) / 2, hull.y1]) {
      for (let z = -hull.hl; z <= hull.hl + 1e-6; z += hull.hl / 3) {
        if (x === 0 && y !== hull.y1 && y !== hull.y0 && Math.abs(z) < hull.hl - 1e-6) continue;
        pts.push([x, y, z]);
      }
    }
  }
  return pts;
}

/**
 * Pushes the hull out of the boxes. boxes: [{x, z, yaw, hx, hz, y0, y1}] (centre on the ground,
 * half extents, heading clockwise from +z, bottom and top heights). Returns the contacts made
 * ({p, n, f}) for debugging.
 */
export function applyObstacles(points, body, boxes, mass, dt) {
  const out = [];
  if (!boxes || !boxes.length) return out;
  const o = body.origin();
  const k = (K * mass * GRAVITY) / 1;
  const c = 2 * ZETA * Math.sqrt((k * mass) / 8);
  const cap = 4 * mass * GRAVITY;
  for (const b of boxes) {
    const reach = Math.hypot(b.hx, b.hz) + 8;
    if ((b.x - o[0]) ** 2 + (b.z - o[2]) ** 2 > reach * reach) continue;
    const cs = Math.cos(b.yaw);
    const sn = Math.sin(b.yaw);
    for (const lp of points) {
      const p = body.worldPoint(lp);
      if (p[1] < b.y0 || p[1] > b.y1) continue;
      const dx = p[0] - b.x;
      const dz = p[2] - b.z;
      // box frame: u across (box's x), w along (box's z)
      const u = dx * cs - dz * sn;
      const w = dx * sn + dz * cs;
      const pu = b.hx - Math.abs(u);
      const pw = b.hz - Math.abs(w);
      if (pu <= 0 || pw <= 0) continue;
      const py = b.y1 - p[1];
      // out through the nearest face (the top face for something low enough to climb)
      let n;
      let depth;
      if (py < pu && py < pw) {
        n = [0, 1, 0];
        depth = py;
      } else if (pu < pw) {
        const s = Math.sign(u) || 1;
        n = [s * cs, 0, -s * sn];
        depth = pu;
      } else {
        const s = Math.sign(w) || 1;
        n = [s * sn, 0, s * cs];
        depth = pw;
      }
      const v = body.pointVelocity(p);
      const vn = dot(v, n);
      const fn = Math.min(cap, Math.max(0, k * depth - c * vn));
      if (fn <= 0) continue;
      // friction along the face, never more than stops the sliding in this step
      const vt = sub(v, scale(n, vn));
      const st = Math.hypot(vt[0], vt[1], vt[2]);
      let f = scale(n, fn);
      if (st > 1e-4) {
        const ft = Math.min(MU * fn, (st * mass) / (8 * dt));
        f = madd(f, vt, -ft / st);
      }
      body.addForceAt(f, p);
      out.push({ p, n, f: fn });
    }
  }
  return out;
}

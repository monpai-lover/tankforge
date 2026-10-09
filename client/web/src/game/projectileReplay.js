// Read-only hit presentation. Positions stay in the report's hull frame; no damage is resolved here.
import { Node, rotX } from '../gfx/math.js';
import { GeoBuilder } from '../gfx/geo.js';
import { shellKind } from './shellicons.js';

const point = p => Array.isArray(p) ? p.slice(0, 3) : [p.x, p.y, p.z];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const clamp = x => Math.max(0, Math.min(1, x));
const direction = (a, b) => {
  const n = distance(a, b) || 1;
  return [(b[0] - a[0]) / n, (b[1] - a[1]) / n, (b[2] - a[2]) / n];
};
function track(points) {
  const lengths = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) lengths[i] = lengths[i - 1] + distance(points[i - 1], points[i]);
  return { points, lengths, length: lengths[lengths.length - 1] || 0 };
}

/** Prepare once per hit. A reflected leg is explanatory length, along the core's reflection only. */
export function replayTrack(rep, shell) {
  const impact = point(rep.impact);
  const pts = (rep.path || []).map(point);
  if (!pts.length) pts.push(impact.slice());
  const incoming = (rep.flight_path || []).map(point);
  let dir = rep.shot?.dir ? point(rep.shot.dir) : incoming.length > 1 ? direction(incoming[incoming.length - 2], impact) : pts.length > 1 ? direction(pts[0], pts[1]) : [0, 0, -1];
  const magnitude = Math.hypot(...dir) || 1;
  dir = dir.map(x => x / magnitude);
  // Combat reports have a straight shot ray; design reports also retain their actual flight samples.
  if (!incoming.length) incoming.push(impact.map((x, i) => x - dir[i] * 9));
  if (distance(incoming[incoming.length - 1], impact) > 1e-6) incoming.push(impact.slice());
  let flight = track(incoming);
  if (flight.length > 9) {
    const cut = { pos: [0, 0, 0], dir: [0, 0, 0], segment: 0 };
    sampleTrack(flight, flight.length - 9, cut);
    flight = track([cut.pos.slice(), ...incoming.slice(cut.segment + 1)]);
  }
  const heat = /^heat(?:$|[-_]?fs)/.test(rep.shell_kind || shellKind(shell));
  const reflected = rep.ricochet_dir ? point(rep.ricochet_dir) : null;
  let ricochet = null;
  if (reflected) {
    const n = Math.hypot(...reflected) || 1;
    ricochet = track([impact.slice(), impact.map((x, i) => x + reflected[i] / n * 6)]);
  }
  return { impact, dir, flight, inside: track(pts), ricochet, heat, caliber: rep.caliber_mm || shell?.caliber_mm || 75 };
}

function sampleTrack(tr, travelled, out) {
  const pts = tr.points;
  const d = Math.max(0, Math.min(tr.length, travelled));
  let i = 0;
  while (i < pts.length - 2 && tr.lengths[i + 1] < d) i++;
  const a = pts[i];
  const b = pts[Math.min(i + 1, pts.length - 1)];
  const span = tr.lengths[i + 1] - tr.lengths[i] || 0;
  const k = span > 0 ? (d - tr.lengths[i]) / span : 0;
  for (let axis = 0; axis < 3; axis++) {
    out.pos[axis] = a[axis] + (b[axis] - a[axis]) * k;
    if (span > 0) out.dir[axis] = (b[axis] - a[axis]) / span;
  }
  out.segment = i;
  out.distance = d;
  return out;
}

export function replayState() {
  return { pos: [0, 0, 0], dir: [0, 0, 0], shellPos: [0, 0, 0], shellDir: [0, 0, 0], segment: 0, distance: 0, progress: 0, jet: false, phase: '' };
}

/** Samples into reusable state: uneven report segments advance by metres rather than point count. */
export function sampleReplay(tr, stage, out) {
  out.phase = stage.name;
  out.jet = false;
  let active = tr.inside;
  let progress = 0;
  if (stage.name === 'approach') {
    active = tr.flight;
    progress = clamp(stage.k);
    progress = progress * progress * (3 - 2 * progress);
  } else if (stage.name === 'xray') progress = clamp(stage.k / .72);
  else if (stage.name === 'after') progress = clamp(stage.k);
  else if (stage.name === 'hold') progress = 1;
  if (tr.ricochet && stage.name !== 'approach' && stage.name !== 'impact') active = tr.ricochet;
  for (let i = 0; i < 3; i++) out.dir[i] = tr.dir[i];
  sampleTrack(active, active.length * progress, out);
  out.progress = progress;
  out.activeTrack = active;
  const jet = tr.heat && !tr.ricochet && stage.name !== 'approach';
  out.jet = jet && active.length > 0 && progress > 0;
  for (let i = 0; i < 3; i++) {
    out.shellPos[i] = jet ? tr.impact[i] : out.pos[i];
    out.shellDir[i] = jet ? tr.dir[i] : out.dir[i];
  }
  return out;
}

// Unit shell, nose at z=0 and tail at -1. Scaled for explanation without shifting its contact point.
function geometry(jet) {
  const b = new GeoBuilder();
  const m = rotX(Math.PI / 2);
  const steel = { color: [.48, .57, .65], rough: .34, metal: .55 };
  const tip = { color: [.28, .33, .36], rough: .3, metal: .6 };
  const copper = { color: [.82, .47, .10], rough: .34, metal: .35 };
  const ring = (y, r) => Array.from({ length: 16 }, (_, i) => {
    const a = -i / 16 * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  });
  if (jet) b.loft(m, false, [ring(-1, .5), ring(-.2, .32), ring(0, .02)], { color: [1, .65, .18], rough: .7, metal: 0 }, 30);
  else {
    b.loft(m, false, [ring(-1, .43), ring(-.91, .5), ring(-.32, .5)], steel, 30);
    b.loft(m, false, [ring(-.32, .5), ring(-.16, .40), ring(-.05, .20), ring(0, .015)], tip, 30);
    b.loft(m, false, [ring(-.86, .513), ring(-.81, .513)], copper, 10, [false, false]);
  }
  return b.build();
}

function worldInto(body, p, out, vector = false) {
  if (body.ex && body.ey && body.ez) {
    const x = p[0] - (vector ? 0 : body.com[0]);
    const y = p[1] - (vector ? 0 : body.com[1]);
    const z = p[2] - (vector ? 0 : body.com[2]);
    for (let i = 0; i < 3; i++) out[i] = body.ex[i] * x + body.ey[i] * y + body.ez[i] * z + (vector ? 0 : body.pos[i]);
  } else {
    const w = vector ? body.worldDir(p) : body.worldPoint(p);
    for (let i = 0; i < 3; i++) out[i] = w[i];
  }
}

/** Two persistent meshes and matrices, shared by every report and all stages. */
export class ReplayProjectile {
  constructor(renderer) {
    this.shell = new Node('replay_projectile');
    this.jet = new Node('replay_jet');
    for (const n of [this.shell, this.jet]) {
      n.mesh = renderer.mesh(geometry(n === this.jet));
      n.kind = 3;
      n.castShadow = false;
    }
    this.jet.highlight = [1, .55, .15, .85];
    this.pos = [0, 0, 0];
    this.dir = [0, 0, 0];
  }

  pose(node, body, pos, dir, diameter, length) {
    worldInto(body, pos, this.pos);
    worldInto(body, dir, this.dir, true);
    const z = this.dir;
    const horizontal = Math.hypot(z[0], z[2]);
    const rx = horizontal > 1e-8 ? z[2] / horizontal : 1;
    const rz = horizontal > 1e-8 ? -z[0] / horizontal : 0;
    const m = node.world;
    m[0] = rx * diameter; m[1] = 0; m[2] = rz * diameter;
    m[4] = z[1] * rz * diameter; m[5] = (z[2] * rx - z[0] * rz) * diameter; m[6] = -z[1] * rx * diameter;
    m[8] = z[0] * length; m[9] = z[1] * length; m[10] = z[2] * length;
    m[12] = this.pos[0]; m[13] = this.pos[1]; m[14] = this.pos[2];
  }

  update(tr, state, body) {
    const diameter = Math.max(.14, Math.min(.32, tr.caliber / 1000 * 2.7));
    this.pose(this.shell, body, state.shellPos, state.shellDir, diameter, Math.max(.6, diameter * 4));
    this.jet.visible = state.jet;
    if (state.jet) this.pose(this.jet, body, state.pos, state.dir, .075, .48);
  }
}

/** Preserve the design core's flight, terminal contact and penetrator trace; never infer a blast. */
export function designReplayReport(last, roles = [], turretYaw = 0) {
  const { resp, shell } = last;
  const ev = resp.event;
  const impact = point(ev.impact_position);
  const pts = ev.projectile_path.map(q => point(q.pos));
  const at = pts.findIndex(p => distance(p, impact) < .05);
  const flight = at >= 0 ? pts.slice(0, at + 1) : [...pts, impact.slice()];
  const dir = resp.shot?.dir ? point(resp.shot.dir) : flight.length > 1 ? direction(flight[flight.length - 2], impact) : direction(point(ev.muzzle_position), impact);
  const path = at >= 0 ? pts.slice(at) : [impact.slice()];
  const penetrator = ev.fragments.find(f => f.is_penetrator);
  if (ev.penetration_result === 'penetrated' && penetrator) {
    for (const p of [point(penetrator.origin), point(penetrator.end)]) if (distance(path[path.length - 1], p) > 1e-6) path.push(p);
  } else if (resp.stopped_point && !resp.ricochet_dir) {
    const stop = point(resp.stopped_point);
    if (distance(path[path.length - 1], stop) > 1e-6) path.push(stop);
  }
  const used = new Set();
  const crew = ev.damaged_crew.map(c => {
    const index = roles.findIndex((r, i) => r === c.role && !used.has(i));
    used.add(index);
    return { index, role: c.role, damage: c.damage, killed: c.killed, health: resp.state?.crew_health?.[`${c.role}_${index}`] };
  });
  const killed = crew.filter(c => c.killed).length;
  const crewAlive = resp.state?.crew_health ? Object.values(resp.state.crew_health).filter(h => h > 0).length : roles.length - killed;
  const destroyed = resp.capabilities.ammo_detonated || (roles.length >= 2 && crewAlive < 2);
  const outcome = ev.penetration_result;
  const heat = /^heat/.test(shellKind(shell));
  return {
    hit: resp.hit, outcome, impact, normal: point(ev.impact_normal), plate: null,
    shell_kind: shellKind(shell), caliber_mm: shell.caliber_mm,
    shot: { dir }, flight_path: flight, path,
    ricochet_dir: resp.ricochet_dir ? point(resp.ricochet_dir) : null,
    bursts: [],
    fragments: ev.fragments.map(f => ({ from: point(f.origin), to: point(f.end), hit: f.hit, damage: f.damage, kind: f.is_penetrator ? heat ? 'jet' : 'shell' : 'spall' })),
    modules: ev.damaged_modules.map(m => ({ ...m, health: resp.state?.module_health?.[m.id] })), crew,
    caps: { destroyed, crew_alive: crewAlive, crew_total: roles.length },
    title: resp.capabilities.ammo_detonated ? '彈藥殉爆　擊毀' : destroyed ? '乘員失去戰鬥力　擊毀' : { penetrated: '擊穿', stopped: '未擊穿', ricochet: '跳彈', shattered: '彈體碎裂', miss: '未命中' }[outcome] || outcome,
    turret_yaw: turretYaw, layers: resp.layers,
  };
}

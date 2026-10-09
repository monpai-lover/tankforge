// Read-only geometry evidence for stock procedural vehicles. This is an audit,
// not a release gate: intersections include designed joints until reviewed.
// node tools/procedural-fleet-audit.mjs [ids...] [--out=path] [--yaw-steps=24]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadData } from './load-data.mjs';
import { GeoBuilder, STRIDE } from '../src/gfx/geo.js';
import { addPart, buildTank, materials } from '../src/gfx/tankmodel.js';
import { makeLoadout, generatedTurretParts, depressionAt } from '../src/game/loadout.js';
import { setMgModels } from '../src/gfx/mgmodel.js';
import { foldDepression, foldYawLimit } from '../src/game/folding.js';
import { transformPoint, sub, dot, cross } from '../src/gfx/math.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEG = Math.PI / 180;
const CONTACT = .012;
const keyPoint = p => p.map(v => Math.round(v * 1e5)).join(',');
const round = n => Math.round(n * 1e6) / 1e6;
const roundPoint = p => p.map(round);

function bounds(tris) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]);
  }
  return { lo, hi };
}
const meet = (a, b, e = 0) => a.lo.every((v, k) => v <= b.hi[k] + e && b.lo[k] <= a.hi[k] + e);
const gap = (a, b) => Math.hypot(...a.lo.map((v, k) => Math.max(0, v - b.hi[k], b.lo[k] - a.hi[k])));

function tree(tris, indices) {
  const bb = bounds(indices.map(i => tris[i]));
  if (indices.length <= 12) return { ...bb, indices };
  const spans = bb.hi.map((v, k) => v - bb.lo[k]);
  const axis = spans.indexOf(Math.max(...spans));
  indices.sort((i, j) => tris[i].reduce((s, p) => s + p[axis], 0) - tris[j].reduce((s, p) => s + p[axis], 0));
  const at = Math.floor(indices.length / 2);
  return { ...bb, children: [tree(tris, indices.slice(0, at)), tree(tris, indices.slice(at))] };
}

export function makePiece(name, data, triangles = false, extra = {}) {
  const tris = triangles ? data : Array.from({ length: data.length / (STRIDE * 3) }, (_, i) =>
    [0, 1, 2].map(k => [0, 1, 2].map(a => data[(i * 3 + k) * STRIDE + a])));
  const bb = bounds(tris);
  return { name, tris, ...bb, ...extra };
}

function visitPairs(A, B, callback, epsilon = 0) {
  if (!meet(A, B, epsilon)) return false;
  A.tree ||= tree(A.tris, A.tris.map((_, i) => i));
  B.tree ||= tree(B.tris, B.tris.map((_, i) => i));
  const visit = (a, b) => {
    if (!meet(a, b, epsilon)) return false;
    if (a.indices && b.indices) {
      for (const i of a.indices) for (const j of b.indices)
        if (callback(A.tris[i], B.tris[j], i, j)) return true;
    } else if (a.children) {
      for (const child of a.children) if (visit(child, b)) return true;
    } else for (const child of b.children) if (visit(a, child)) return true;
    return false;
  };
  return visit(A.tree, B.tree);
}

/** Segment/triangle crossing, without the old barycentric 2% blind strip. */
function segTri(p, q, [a, b, c], strict = true) {
  const d = sub(q, p), ab = sub(b, a), ac = sub(c, a), h = cross(d, ac);
  const det = dot(ab, h);
  if (Math.abs(det) < 1e-12) return null; // coplanar surfaces do not establish penetration
  const s = sub(p, a), u = dot(s, h) / det;
  const r = cross(s, ab), v = dot(d, r) / det, t = dot(ac, r) / det;
  const e = strict ? 1e-7 : -1e-8;
  if (u < -1e-8 || v < -1e-8 || u + v > 1 + 1e-8 || t <= e || t >= 1 - e) return null;
  return { point: p.map((x, k) => x + d[k] * t), t };
}

export function surfaceCrossings(A, B, maxPoints = 12) {
  const hits = new Set(), points = [], pointKeys = new Set();
  visitPairs(A, B, (a, b, ai) => {
    let hit = false;
    for (let k = 0; k < 3; k++) for (const [t, u] of [[a, b], [b, a]]) {
      const x = segTri(t[k], t[(k + 1) % 3], u);
      if (!x) continue;
      hit = true;
      const pk = keyPoint(x.point);
      if (points.length < maxPoints && !pointKeys.has(pk)) { pointKeys.add(pk); points.push(x.point); }
    }
    if (hit) hits.add(ai);
    return false;
  });
  return { count: hits.size, points };
}

function distancePointTriangle(p, [a, b, c]) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap), q = x => dot(sub(p, x), sub(p, x));
  if (d1 <= 0 && d2 <= 0) return q(a);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return q(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return q(a.map((x, k) => x + ab[k] * d1 / (d1 - d3)));
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return q(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return q(a.map((x, k) => x + ac[k] * d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return q(b.map((x, k) => x + (c[k] - x) * (d4 - d3) / (d4 - d3 + d5 - d6)));
  const den = va + vb + vc;
  if (Math.abs(den) < 1e-24) return Math.min(q(a), q(b), q(c));
  return q(a.map((x, k) => x + ab[k] * vb / den + ac[k] * vc / den));
}

function inside(p, B) {
  if (p.some((v, k) => v < B.lo[k] || v > B.hi[k])) return false;
  const q = [B.hi[0] + 1, p[1] + .000731, p[2] + .000419];
  const hits = [];
  for (const t of B.tris) {
    const h = segTri(p, q, t, false);
    if (h && !hits.some(x => Math.abs(x - h.t) < 1e-7)) hits.push(h.t);
  }
  return hits.length % 2 === 1;
}

function distanceSegments(p, q, a, b) {
  const d1 = sub(q, p), d2 = sub(b, a), r = sub(p, a);
  const aa = dot(d1, d1), ee = dot(d2, d2), f = dot(d2, r);
  const clamp = x => Math.max(0, Math.min(1, x));
  let s = 0, t = 0;
  if (aa <= 1e-20 && ee <= 1e-20) return dot(r, r);
  if (aa <= 1e-20) t = clamp(f / ee);
  else {
    const c = dot(d1, r);
    if (ee <= 1e-20) s = clamp(-c / aa);
    else {
      const bb = dot(d1, d2), den = aa * ee - bb * bb;
      if (Math.abs(den) > 1e-20) s = clamp((bb * f - c * ee) / den);
      t = (bb * s + f) / ee;
      if (t < 0) { t = 0; s = clamp(-c / aa); }
      else if (t > 1) { t = 1; s = clamp((bb - c) / aa); }
    }
  }
  const delta = r.map((v, k) => v + d1[k] * s - d2[k] * t);
  return dot(delta, delta);
}

export function touches(A, B) {
  if (!meet(A, B, CONTACT)) return false;
  // Closed containment is attachment evidence, even without surface crossings.
  if (inside(A.tris[0][0], B) || inside(B.tris[0][0], A)) return true;
  return visitPairs(A, B, (a, b) => {
    for (let k = 0; k < 3; k++) {
      if (segTri(a[k], a[(k + 1) % 3], b) || segTri(b[k], b[(k + 1) % 3], a)) return true;
      if (distancePointTriangle(a[k], b) <= CONTACT ** 2 || distancePointTriangle(b[k], a) <= CONTACT ** 2) return true;
      for (let j = 0; j < 3; j++) if (distanceSegments(a[k], a[(k + 1) % 3], b[j], b[(j + 1) % 3]) <= CONTACT ** 2) return true;
    }
    const center = t => t[0].map((_, k) => (t[0][k] + t[1][k] + t[2][k]) / 3);
    return distancePointTriangle(center(a), b) <= CONTACT ** 2 || distancePointTriangle(center(b), a) <= CONTACT ** 2;
  }, CONTACT);
}

export function topologyStatistics(P) {
  const edges = new Map(), vertices = new Set();
  let degenerate = 0;
  for (const t of P.tris) {
    if (Math.hypot(...cross(sub(t[1], t[0]), sub(t[2], t[0]))) < 1e-10) { degenerate++; continue; }
    const ids = t.map(keyPoint);
    for (const i of ids) vertices.add(i);
    for (let k = 0; k < 3; k++) {
      const e = [ids[k], ids[(k + 1) % 3]].sort().join('|');
      const v = edges.get(e) || { count: 0, points: [t[k], t[(k + 1) % 3]] };
      v.count++; edges.set(e, v);
    }
  }
  const boundary = [...edges.values()].filter(e => e.count === 1);
  return { triangles: P.tris.length, weldedVertices: vertices.size, degenerate,
    boundaryEdges: boundary.length, nonManifoldEdges: [...edges.values()].filter(e => e.count > 2).length,
    boundaryExamples: boundary.slice(0, 8).map(e => e.points.map(roundPoint)) };
}

/** Build the game's real nodes, then retain source-part identities on each node. */
export function runtimeParts(id, data) {
  const bundle = data.vehicles[id];
  if (!bundle) throw new Error(`Unknown vehicle ${id}`);
  if (bundle.model) throw new Error(`Imported vehicle excluded from procedural audit: ${id}`);
  setMgModels(JSON.parse(fs.readFileSync(path.join(HERE, '../assets/mg_models.json'), 'utf8')));
  const loadout = makeLoadout(id, bundle, data.projectiles, data.machineGuns);
  const renderer = {
    mesh: data => ({ data, count: data.length / STRIDE }),
    instancedMesh: (data, capacity) => ({ data, count: data.length / STRIDE, capacity }),
    setInstances: (m, matrices) => { m.matrices = matrices; }, freeMesh: () => {},
  };
  const model = buildTank(renderer, loadout, generatedTurretParts);
  const mats = materials(bundle.visual.palette || {}), records = [], buffers = new Map();
  const hingeNodes = model.body.children.filter(n => n.name === 'hinged_flap');
  const hinges = [...new Map(bundle.visual.parts.filter(p => p.hinge).map(p => [JSON.stringify(p.hinge), p.hinge])).values()];
  const addRecord = (part, index, generated = false) => {
    const ti = part.turret || 0, gi = part.gun || 0;
    const t = loadout.turrets[ti], mt = model.turrets[ti];
    let node = model.hull, offset = [0, 0, 0], bore = 0;
    if (part.mount === 'turret') { node = mt.node.children.find(n => n.name === 'turret_shell'); offset = t.pivot; }
    else if (part.mount === 'gun') {
      const mg = mt.guns[gi];
      node = part.payload != null ? mg.rounds[part.payload] : part.recoil ? mg.barrel : mg.node.children.find(n => n.name === 'gun_mount');
      offset = t.guns[gi].trunnion; bore = (t.guns[gi].def.caliber_mm || 0) / 2000;
    } else if (part.hinge) { node = hingeNodes[hinges.findIndex(h => JSON.stringify(h) === JSON.stringify(part.hinge))]; offset = part.hinge.a; }
    const b = new GeoBuilder(); addPart(b, part, offset, mats, bore);
    const label = `${generated ? 'generated' : 'visual'}#${index}`;
    records.push({ part, id: label, index, node, local: makePiece(label, b.data), ti, gi,
      group: part.mount === 'turret' || part.mount === 'gun' ? `turret${ti}` : 'hull' });
    if (!buffers.has(node)) buffers.set(node, []);
    buffers.get(node).push(...b.data);
  };
  bundle.visual.parts.forEach((p, i) => addRecord(p, i));
  for (const [ti, t] of loadout.turrets.entries()) if (t.generated)
    generatedTurretParts(t, ti).forEach((p, i) => addRecord(p, i, true));
  let maxRuntimeError = 0;
  for (const [node, values] of buffers) {
    if (values.length !== node.mesh?.data.length) throw new Error(`Runtime part mapping mismatch ${id}/${node?.name}`);
    for (let i = 0; i < values.length; i += STRIDE) for (let k = 0; k < 3; k++)
      maxRuntimeError = Math.max(maxRuntimeError, Math.abs(values[i + k] - node.mesh.data[i + k]));
  }
  // Pintle post and actual gun mesh (including game-created shield) also matter.
  const machineGunPieces = model.mgs.length * 2;
  for (const mg of model.mgs) {
    const post = model.turrets[0].node.children.filter(n => n.name === 'mg_post')[model.mgs.indexOf(mg)];
    for (const [suffix, node] of [['post', post], ['gun', mg.node]])
      records.push({ id: `mg${mg.index}:${suffix}`, part: { type: 'machine-gun', mount: 'turret' }, node,
        local: makePiece(`mg${mg.index}:${suffix}`, node.mesh.data), ti: 0, gi: null, group: 'turret0', mg: mg.index, mgGun: suffix === 'gun' });
  }
  const at = ({ turret = 0, yaw = 0, pitch = 0, recoil = 0, fold = 0, mgYaw = 0, mgPitch = 0 } = {}) => {
    model.setFold(fold);
    loadout.turrets.forEach((t, ti) => {
      model.turrets[ti].node.yaw = t.facing + (ti === turret ? yaw : 0);
      model.turrets[ti].guns.forEach((mg, gi) => {
        mg.node.pitch = ti === turret ? -pitch : 0;
        mg.barrel.pos = [0, 0, ti === turret ? -(t.guns[gi].def.recoil_mm || 0) / 1000 * recoil : 0];
      });
    });
    for (const mg of model.mgs) { mg.node.yaw = mgYaw; mg.node.pitch = -mgPitch; }
    model.root.update();
    return records.map(r => makePiece(r.id, r.local.tris.map(t => t.map(p => transformPoint(r.node.world, p))), true,
      { ...r, local: undefined, node: undefined,
        worldTrunnion: r.part.mount === 'gun' ? transformPoint(model.turrets[r.ti].guns[r.gi].node.world, [0, 0, 0]) :
          r.mgGun ? transformPoint(r.node.world, [0, 0, 0]) : null }));
  };
  return { loadout, model, records, at, maxRuntimeError, machineGunPieces };
}

function connectivity(pieces) {
  const parent = pieces.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++)
    if (pieces[i].group === pieces[j].group && find(i) !== find(j) && touches(pieces[i], pieces[j])) parent[find(i)] = find(j);
  const report = [];
  for (const group of new Set(pieces.map(p => p.group))) {
    const list = pieces.map((p, i) => [p, i]).filter(([p]) => p.group === group);
    const volume = p => p.hi.reduce((s, v, k) => s * (v - p.lo[k]), 1);
    const anchor = list.reduce((a, b) => volume(a[0]) >= volume(b[0]) ? a : b)[1];
    const components = new Map();
    for (const [p, i] of list) { const root = find(i); if (!components.has(root)) components.set(root, []); components.get(root).push(p); }
    for (const [root, own] of components) {
      if (root === find(anchor)) continue;
      const others = pieces.filter(p => !own.includes(p));
      if (group !== 'hull' && own.some(p => others.some(q => q.group === 'hull' && touches(p, q)))) continue;
      let nearest = { gap: Infinity };
      for (const p of own) for (const q of others) {
        if (gap(p, q) > nearest.gap) continue;
        for (const t of p.tris) for (const v of t) for (const u of q.tris) {
          const d = Math.sqrt(distancePointTriangle(v, u));
          if (d < nearest.gap) nearest = { gap: d, from: p.id, to: q.id, point: roundPoint(v) };
        }
      }
      report.push({ group, pieces: own.map(p => p.id), nearest: { ...nearest, gap: round(nearest.gap) }, classification: 'candidate; verify exposure/support' });
    }
  }
  return report;
}

function addHit(hits, P, Q, hit, baseline, pose) {
  if (!hit.count) return;
  const key = `${P.id}|${Q.id}`;
  const trunnion = P.worldTrunnion;
  const far = trunnion ? Math.max(...hit.points.map(p => Math.hypot(...sub(p, trunnion)))) : 0;
  const novel = hit.points.filter(p => !baseline.points.some(q => Math.hypot(...sub(p, q)) < .025));
  const previous = hits.get(key);
  const score = (novel.length ? 10 : 0) + (hit.count - baseline.count) / 100 + far;
  const report = previous || { a: P.id, b: Q.id, aMount: P.part.mount, bMount: Q.part.mount,
    partA: P.part, partB: Q.part, hitPoses: 0, classification: 'candidate; designed joints require review' };
  report.hitPoses++;
  if (!previous || score > report.score) Object.assign(report, { score, pose, triangles: hit.count, baselineTriangles: baseline.count,
    novelWitnesses: novel.length, points: hit.points.map(roundPoint), maxDistanceFromMovingTrunnion: round(far) });
  hits.set(key, report);
}

export function auditVehicle(id, data, { yawSteps = 24 } = {}) {
  const runtime = runtimeParts(id, data), { loadout, model } = runtime;
  const neutral = runtime.at(), hits = new Map();
  const closure = neutral.filter(p => p.part.mount === 'hull' && ['loft', 'prism', 'mesh', 'plan'].includes(p.part.type))
    .map(p => ({ id: p.id, type: p.part.type, caps: p.part.caps, ...topologyStatistics(p) }));
  const floating = connectivity(neutral);
  let poses = 0;
  const folds = model.hasFlaps ? [0, .25, .5, .75, 1] : [0];
  // Folded hull flaps can also sweep through fixed body details. Preserve
  // their closed-pose contact baseline rather than treating every hinge joint as an error.
  if (model.hasFlaps) for (const fold of folds) {
    const pieces = runtime.at({ fold });
    for (let i = 0; i < pieces.length; i++) if (pieces[i].part.hinge) for (let j = 0; j < pieces.length; j++) {
      if (pieces[j].group !== 'hull' || pieces[j].part.hinge || !meet(pieces[i], pieces[j])) continue;
      addHit(hits, pieces[i], pieces[j], surfaceCrossings(pieces[i], pieces[j]), surfaceCrossings(neutral[i], neutral[j]),
        { foldFraction: fold, kind: 'flap/fixed-hull' });
    }
    poses++;
  }
  for (const fold of folds) for (const [ti, t] of loadout.turrets.entries()) {
    const limits = ti === 0 && model.hasFlaps ? foldYawLimit(t, fold) : t.limit;
    const [low, high] = limits || [-Math.PI, Math.PI];
    for (let k = 0; k <= yawSteps; k++) {
      const yaw = low + (high - low) * k / yawSteps;
      const dep = Math.min(...t.guns.map(g => ti === 0 && model.hasFlaps ? foldDepression(t, yaw, g.def.max_depression_deg, fold) : depressionAt(t, yaw, g.def.max_depression_deg))) * DEG;
      const elev = Math.min(...t.guns.map(g => g.def.max_elevation_deg)) * DEG;
      const base = runtime.at({ turret: ti, yaw, fold });
      const baseline = new Map();
      for (const pitch of [...new Set([0, -dep / 2, -dep, elev / 4, elev / 2, elev * .75, elev])]) for (const recoil of [0, .5, 1]) {
        const pose = { turret: ti, yawDeg: round(yaw / DEG), pitchDeg: round(pitch / DEG), recoilFraction: recoil, foldFraction: fold };
        const pieces = runtime.at({ turret: ti, yaw, pitch, recoil, fold }); poses++;
        for (let i = 0; i < pieces.length; i++) {
          const P = pieces[i];
          if (P.ti !== ti || (P.part.mount !== 'turret' && P.part.mount !== 'gun') || P.mg != null) continue;
          for (let j = 0; j < pieces.length; j++) {
            const Q = pieces[j];
            // Gun/hull, gun/turret (all gun parts), turret/hull. Same gun's sleeves are designed overlaps.
            const eligible = P.part.mount === 'gun' ? Q.group === 'hull' || Q.part.mount === 'turret' ||
              (Q.part.mount === 'gun' && (Q.ti !== P.ti || Q.gi !== P.gi) && i < j) : Q.group === 'hull';
            if (!eligible || !meet(P, Q)) continue;
            const key = `${i}|${j}`;
            if (!baseline.has(key)) baseline.set(key, surfaceCrossings(base[i], base[j]));
            addHit(hits, P, Q, surfaceCrossings(P, Q), baseline.get(key), pose);
          }
        }
      }
    }
  }
  // Roof MG pitch and full legal hand-aim yaw, including actual asset and shield geometry.
  for (const mg of loadout.machineGuns.filter(m => m.mount === 'pintle')) for (let k = 0; k <= yawSteps; k++) {
    const mgYaw = -mg.arc[0] + 2 * mg.arc[0] * k / yawSteps;
    const base = runtime.at({ mgYaw });
    for (const mgPitch of [0, -mg.arc[1], mg.arc[2] / 2, mg.arc[2]]) {
      const pieces = runtime.at({ mgYaw, mgPitch }); poses++;
      const i = pieces.findIndex(p => p.mgGun && loadout.machineGuns[p.mg] === mg);
      if (i < 0) continue;
      for (let j = 0; j < pieces.length; j++) {
        const Q = pieces[j];
        if (Q.mg != null || !meet(pieces[i], Q)) continue;
        addHit(hits, pieces[i], Q, surfaceCrossings(pieces[i], Q), surfaceCrossings(base[i], base[j]),
          { mg: mg.id, yawDeg: round(mgYaw / DEG), pitchDeg: round(mgPitch / DEG), foldFraction: 0 });
      }
    }
  }
  const bundle = data.vehicles[id];
  const sourceFingerprint = createHash('sha256').update(JSON.stringify({ vehicle: bundle.vehicle, weapons: bundle.weapons, visual: bundle.visual })).digest('hex');
  return { id, sourceFingerprint, parts: neutral.length, sourceParts: data.vehicles[id].visual.parts.length, poses, maxRuntimeError: runtime.maxRuntimeError,
    closure, floating, intersections: [...hits.values()].sort((a, b) => b.score - a.score),
    bounds: bounds(neutral.flatMap(p => p.tris)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = loadData(), args = process.argv.slice(2), options = args.filter(a => a.startsWith('--'));
  const named = args.filter(a => !a.startsWith('--')), ids = named.length ? named : data.order.filter(id => !data.vehicles[id].model);
  const yawSteps = Number(options.find(a => a.startsWith('--yaw-steps='))?.split('=')[1] || 24);
  if (!Number.isInteger(yawSteps) || yawSteps < 1) throw new Error('yaw-steps must be a positive integer');
  const results = [];
  for (const id of ids) {
    const result = auditVehicle(id, data, { yawSteps }); results.push(result);
    console.log(`${id}: ${result.parts} parts, ${result.poses} legal sampled poses, ${result.floating.length} floating candidates, ${result.intersections.length} intersection pairs`);
  }
  const report = { schema: 1, policy: 'procedural only; candidates need visual/source review; not proof of continuous-pose clearance',
    excludedImported: data.order.filter(id => data.vehicles[id].model), yawSteps, results };
  const out = options.find(a => a.startsWith('--out='))?.slice(6);
  if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2)); }
  else console.log(JSON.stringify(report));
}

// Offline aircraft surface collision. Rendering and collision consume the SAME uploaded
// Float32 triangles. AABB/BVH nodes only reject candidates; they never establish a hit.
// One query uses the current fixed target pose, not continuous moving-target TOI.
import {TriangleBVH, segmentTriangle, inverseAffine} from '../../client/web/src/collision/meshHitbox.js';
import {mul, transformPoint, sub, cross, dot, norm} from '../../client/web/src/gfx/math.js';

export const AIRCRAFT_HITBOX_REVISION = 3;
const caches = new WeakMap();
const finite3 = v => v && v.length === 3 && Array.from(v).every(Number.isFinite);
const at = (a, d, t) => [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
const arraySource = r => r.node && 'mesh' in r.node
  ? r.node.mesh ? r.node.mesh._src?.data || r.data : null : r.data;
const float32 = data => ArrayBuffer.isView(data) && data.BYTES_PER_ELEMENT === 4 && data.constructor.name === 'Float32Array';

function geometry(data) {
  if (!float32(data) || data.length % 39) throw new TypeError('Aircraft collision requires the uploaded Float32 13-float triangle buffer');
  let cached = caches.get(data);
  if (cached) return cached;
  const bounds = {lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity]};
  for (let i = 0; i < data.length; i += 13) for (let k = 0; k < 3; k++) {
    const v = data[i + k];
    if (!Number.isFinite(v)) throw new TypeError('Non-finite aircraft collision vertex');
    bounds.lo[k] = Math.min(bounds.lo[k], v); bounds.hi[k] = Math.max(bounds.hi[k], v);
  }
  cached = {data, bounds, triangleCount: data.length / 39, bvh: null, positions: null, fingerprint: null, hash: null};
  caches.set(data, cached);
  return cached;
}
function positions(cache) {
  if (cache.bvh) return cache.bvh.positions;
  if (cache.positions) return cache.positions;
  const data = cache.data, p = new Float32Array(data.length / 13 * 3);
  for (let i = 0, j = 0; i < data.length; i += 13) for (let k = 0; k < 3; k++) p[j++] = data[i + k];
  const words = new Uint32Array(p.buffer, p.byteOffset, p.length);
  let h = 2166136261;
  for (const word of words) for (let k = 0; k < 4; k++) h = Math.imul(h ^ (word >>> (k * 8) & 255), 16777619);
  cache.fingerprint = `fnv1a32-f32le:${(h >>> 0).toString(16).padStart(8, '0')}`;
  return cache.positions = p;
}
function buildBVH(cache) {
  if (!cache.bvh) { cache.bvh = new TriangleBVH(positions(cache)); cache.positions = null; }
  return cache.bvh;
}
function boxIntersects(a, d, bounds) {
  let lo = 0, hi = 1;
  for (let k = 0; k < 3; k++) {
    // Rounding outward is conservative; these bounds can reject, never score hits.
    const e = 1e-11 * Math.max(1, Math.abs(bounds.lo[k]), Math.abs(bounds.hi[k]));
    if (d[k] === 0) { if (a[k] < bounds.lo[k] - e || a[k] > bounds.hi[k] + e) return false; continue; }
    let x = (bounds.lo[k] - e - a[k]) / d[k], y = (bounds.hi[k] + e - a[k]) / d[k];
    if (x > y) [x, y] = [y, x];
    lo = Math.max(lo, x); hi = Math.min(hi, y); if (lo > hi) return false;
  }
  return true;
}
function transformedBounds(bounds, matrix) {
  const out = {lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity]};
  for (let bits = 0; bits < 8; bits++) {
    const p = transformPoint(matrix, [0, 1, 2].map(k => bits & 1 << k ? bounds.hi[k] : bounds.lo[k]));
    for (let k = 0; k < 3; k++) { out.lo[k] = Math.min(out.lo[k], p[k]); out.hi[k] = Math.max(out.hi[k], p[k]); }
  }
  return out;
}
// A segment exactly on a triangle's plane contacts its closed material boundary.
// Non-coplanar rays use the repository's watertight shared-edge predicate instead.
function coplanarSegment(a, d, A, B, C) {
  const n = cross(sub(B, A), sub(C, A)), nl = Math.hypot(...n);
  if (!(nl > 1e-15)) return null;
  const tolerance = 1e-11 * nl * Math.max(1, Math.hypot(...sub(B, A)), Math.hypot(...sub(C, A)));
  if (Math.abs(dot(n, sub(a, A))) > tolerance || Math.abs(dot(n, d)) > tolerance) return null;
  const drop = Math.abs(n[0]) > Math.abs(n[1]) ? Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2 : Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2;
  const axes = [0, 1, 2].filter(k => k !== drop), project = p => axes.map(k => p[k]);
  const orient = (u, v) => u[0] * v[1] - u[1] * v[0];
  const minus = (u, v) => [u[0] - v[0], u[1] - v[1]];
  const [p, e, v0, v1, v2] = [a, d, A, B, C].map(project);
  const ab = minus(v1, v0), ac = minus(v2, v0), den = orient(ab, ac);
  if (den === 0) return null;
  const bary = q => {
    const aq = minus(q, v0), v = orient(aq, ac) / den, w = orient(ab, aq) / den;
    return [1 - v - w, v, w];
  };
  const start = bary(p);
  if (start.every(v => v >= 0 && v <= 1)) return {t: 0, barycentric: start, coplanar: true};
  let best = null;
  for (const [v, w] of [[v0, v1], [v1, v2], [v2, v0]]) {
    const edge = minus(w, v), q = minus(v, p), determinant = orient(e, edge);
    if (determinant !== 0) {
      const t = orient(q, edge) / determinant, u = orient(q, e) / determinant;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
    } else if (orient(q, e) === 0) {
      const axis = Math.abs(e[0]) >= Math.abs(e[1]) ? 0 : 1;
      if (e[axis] === 0) continue;
      const t0 = (v[axis] - p[axis]) / e[axis], t1 = (w[axis] - p[axis]) / e[axis];
      const t = Math.max(0, Math.min(t0, t1));
      if (t <= Math.min(1, Math.max(t0, t1)) && (best === null || t < best)) best = t;
    }
  }
  return best === null ? null : {t: best, barycentric: bary([p[0] + e[0] * best, p[1] + e[1] * best]), coplanar: true};
}

function inferredDamageId(plane, r) {
  if (r.damageId !== undefined) return r.damageId;
  if (r.source === 'interior') return r.id || null;
  if (plane.damage?.by?.[r.partId]) return r.partId;
  const name = r.node?.name || '';
  if (/aircraft_wing_[lr]$/.test(name)) return name.endsWith('_l') ? 'wing_l' : 'wing_r';
  if (name === 'aircraft_prop') return 'prop';
  const c = plane.controls?.find(c => c.node === r.node);
  if (c?.type === 'roll' || c?.type === 'elevon') return c.sign < 0 ? 'aileron_l' : 'aileron_r';
  if (c?.type === 'pitch') return 'elevator';
  if (c?.type === 'yaw') return 'rudder';
  return null;
}

/** `outer` captures each node's real renderer.mesh(data); interior.parts uses the same
 * {id,node,data,role,owner} records as the O-view. owner means physical detachment;
 * damageId means a binding to the EXISTING AircraftDamage part, never a nearby box.
 * `outer` may be a provider for asynchronously loaded/replaced meshes. Mixed draw
 * meshes accept damageIds[triangle] or damageIdAtTriangle(triangle); carrier names
 * the structural parent whose detachment removes the material. surface overrides
 * live212's structural/module attenuation classification (e.g. cockpit/pilot=false).
 * live212 delegates HP, blast, fires, detachment and child propagation to the current
 * AircraftDamage. Its authored blast falloff/part boxes are deliberately unchanged.
 * auto selects live212 only with D.hitbox.structuralSurface; hosts should pass the
 * explicit policy when migrating a delivered source version.
 * poseVersion enables prepared transform/bounds reuse for a stable scene provider.
 * Node matrices (including in-place edits), mesh buffers, hierarchy, disabled flags
 * and damage generations are still checked. A host changing only provider semantic
 * metadata outside that scene must call invalidatePose(). Uploaded positions are
 * immutable, as in renderer mesh creation; a new buffer identity invalidates bounds.
 */
export function createAircraftHitbox(plane, {outer = [], interior = null, damagePolicy = 'auto', poseVersion = null} = {}) {
  if (!plane?.root) throw new TypeError('Aircraft root required');
  if (!['auto', 'legacy68c', 'live212'].includes(damagePolicy)) throw new TypeError('Unknown aircraft damage policy');
  let internal = interior;
  let queries = 0, lastStats = null, frameBuilds = 0, poseCacheHits = 0, bvhBuilds = 0, prepared = null;
  function snapshot(node) {
    return {node, mesh: node.mesh, data: node.mesh?._src?.data, children: (node.children || []).slice(),
      disabled: node.hitboxDisabled, local: node.local ? Array.from(node.local) : null,
      pos: node.pos ? Array.from(node.pos) : null, yaw: node.yaw, pitch: node.pitch, roll: node.roll};
  }
  function unchanged(s) {
    const n = s.node, children = n.children || [];
    if (n.mesh !== s.mesh || n.mesh?._src?.data !== s.data || n.hitboxDisabled !== s.disabled || children.length !== s.children.length ||
        n.yaw !== s.yaw || n.pitch !== s.pitch || n.roll !== s.roll || !!n.local !== !!s.local || !!n.pos !== !!s.pos) return false;
    for (let i = 0; i < children.length; i++) if (children[i] !== s.children[i]) return false;
    if (s.local) for (let i = 0; i < s.local.length; i++) if (n.local[i] !== s.local[i]) return false;
    if (s.pos) for (let i = 0; i < s.pos.length; i++) if (n.pos[i] !== s.pos[i]) return false;
    return true;
  }
  const policy = () => damagePolicy === 'auto' ? plane.damage?.hitbox?.structuralSurface ? 'live212' : 'legacy68c' : damagePolicy;
  const physicallyGone = id => !!id && (typeof plane.damage?.gone === 'function' ? plane.damage.gone(id) : plane.damage?.dead?.(id));
  function records() {
    const list = Array.isArray(internal) ? internal : internal?.parts || [];
    // HD cockpits, restored GL meshes and animated node trees may change after the
    // aircraft is built. The provider resolves live mesh instances, never ghost copies.
    const exterior = typeof outer === 'function' ? outer() : outer;
    if (!Array.isArray(exterior)) throw new TypeError('Aircraft outer provider must return mesh records');
    const mounts=(plane.mountFitNodes||[]).map(node=>({node,source:'outer',partId:node.mountOwner,damageId:node.mountOwner,owner:node.mountOwner,role:'skin'}));
    return [...exterior.map((r, i) => ({...r, source: 'outer', partId: r.partId || r.id || `outer:${i}`, role: r.role || 'skin'})),...mounts,
      ...list.map((r, i) => ({...r, source: 'interior', partId: r.partId || r.instanceId || r.id || `interior:${i}`, role: r.role || 'internal'}))];
  }
  function frame() {
    const version = typeof poseVersion === 'function' ? poseVersion() : null;
    const D = plane.damage;
    if (poseVersion && prepared && prepared.version === version && prepared.damage === D && prepared.damageRevision === D?.revision &&
        prepared.nodes.every(unchanged)) { poseCacheHits++; return prepared; }
    plane.root.update?.();
    const live = new Map(), nodes = [];
    const visit = (node, disabled = false) => {
      disabled ||= node.hitboxDisabled === true;
      live.set(node, disabled); nodes.push(snapshot(node));
      for (const child of node.children || []) visit(child, disabled);
    };
    visit(plane.root);
    const inverseRoot = inverseAffine(plane.root.world || plane.root.local);
    const out = [], instances = new Map();
    for (const r of records()) {
      // Scope/camera/O hiding is PRESENTATION. Only physical removal, detachment or an
      // explicit hitboxDisabled flag changes membership. Repaired/spawned parts rejoin.
      if (!r.node || !live.has(r.node) || live.get(r.node) || r.enabled === false || typeof r.enabled === 'function' && !r.enabled()) continue;
      const owner = r.owner || (/^wing_[lr]$/.test(r.partId) ? r.partId : null);
      if (physicallyGone(owner) || physicallyGone(r.carrier)) continue;
      const data = arraySource(r);
      if (!data) continue; // A removed draw mesh cannot retain its captured collider.
      const cache = geometry(data);
      if (!cache.triangleCount) continue;
      const matrix = mul(inverseRoot, r.node.world, new Float64Array(16));
      let inverse;
      try { inverse = inverseAffine(matrix); }
      catch (error) { if (error instanceof RangeError) continue; throw error; }
      const entry = {record: r, cache, matrix, inverse, bounds: transformedBounds(cache.bounds, matrix), damageId: inferredDamageId(plane, r)};
      const previous = instances.get(r.node);
      // A preserved modelled pilot can be discovered by both the scene provider
      // and the detailed interior. One rendered instance is still one collider;
      // retain its precise interior metadata, not two copies of the same face.
      if (previous && previous.entry.cache === cache && previous.entry.damageId === entry.damageId) {
        if (r.source === 'interior') { out[previous.index] = entry; previous.entry = entry; }
        continue;
      }
      instances.set(r.node, {entry, index: out.length});
      out.push(entry);
    }
    const bounds = {lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity]};
    for (const e of out) for (let k = 0; k < 3; k++) { bounds.lo[k] = Math.min(bounds.lo[k], e.bounds.lo[k]); bounds.hi[k] = Math.max(bounds.hi[k], e.bounds.hi[k]); }
    frameBuilds++;
    return prepared = {entries: out, bounds, nodes, version, damage: D, damageRevision: D?.revision};
  }
  function trace(localA, localB) {
    if (!finite3(localA) || !finite3(localB)) throw new TypeError('Finite aircraft segment required');
    const a = Array.from(localA), b = Array.from(localB), d = sub(b, a), length = Math.hypot(...d);
    const stats = {entries: 0, candidateEntries: 0, bvhNodes: 0, trianglesTested: 0, bvhBuilds: 0, meshBoundsTests: 0, aggregateRejected: false};
    const contacts = [], pose = length > 0 ? frame() : null;
    if (pose) stats.entries = pose.entries.length;
    if (pose && pose.entries.length && !boxIntersects(a, d, pose.bounds)) stats.aggregateRejected = true;
    if (pose && !stats.aggregateRejected) for (const entry of pose.entries) {
      stats.meshBoundsTests++;
      if (!boxIntersects(a, d, entry.bounds)) continue;
      const p = transformPoint(entry.inverse, a), q = transformPoint(entry.inverse, b), delta = sub(q, p);
      if (!boxIntersects(p, delta, entry.cache.bounds)) continue;
      if (!entry.cache.bvh) { stats.bvhBuilds++; bvhBuilds++; }
      const bvh = buildBVH(entry.cache);
      let tested = false;
      bvh.candidates(p, delta, 0, 1, triangleId => {
        tested = true;
        stats.trianglesTested++;
        const tri = bvh.triangle(triangleId);
        const h = segmentTriangle(p, delta, ...tri, 1) || coplanarSegment(p, delta, ...tri);
        if (!h) return;
        const r = entry.record;
        // The live fuselage draw mesh contains both nose and centre triangles. Its
        // original classification can bind each triangle without splitting/reuploading.
        const damageId = r.damageIdAtTriangle ? r.damageIdAtTriangle(triangleId) : r.damageIds ? r.damageIds[triangleId] : entry.damageId;
        const owner = r.ownerIds ? r.ownerIds[triangleId] : r.owner;
        const carrier = r.carrierIds ? r.carrierIds[triangleId] : r.carrier;
        if (physicallyGone(damageId) || physicallyGone(owner) || physicallyGone(carrier)) return;
        const transformed = tri.map(v => transformPoint(entry.matrix, v));
        const faceNormal = norm(cross(sub(transformed[1], transformed[0]), sub(transformed[2], transformed[0])));
        contacts.push({t: h.t, distance: h.t * length, point: at(a, d, h.t),
          normal: dot(faceNormal, d) > 0 ? faceNormal.map(v => -v) : faceNormal,
          faceNormal, barycentric: h.barycentric, coplanar: !!h.coplanar,
          triangleId, partId: r.partId, instanceId: r.instanceId || r.partId,
          damageId, role: r.role, owner: owner || null, carrier: carrier || null, source: r.source,
          surface: r.surface,
          positionFingerprint: entry.cache.fingerprint, revision: AIRCRAFT_HITBOX_REVISION});
      }, stats);
      if (tested) stats.candidateEntries++;
    }
    contacts.sort((x, y) => x.t - y.t || x.partId.localeCompare(y.partId) || x.triangleId - y.triangleId);
    const unique = [];
    for (const c of contacts) {
      // Two triangles sharing ONE material face/edge are one contact. Separate part
      // instances at the same point remain distinct; no gap is filled by this merge.
      const last = unique.at(-1);
      if (last && last.partId === c.partId && last.instanceId === c.instanceId && last.source === c.source && Math.abs(last.t - c.t) * length <= 1e-8) continue;
      unique.push(c);
    }
    queries++;
    lastStats = stats;
    return {first: unique[0] || null, contacts: unique, stats, revision: AIRCRAFT_HITBOX_REVISION};
  }
  function damageRay(a, b, energyJ, tnt = 0, incendiary = false, rnd = Math.random) {
    if (!Number.isFinite(energyJ) || !Number.isFinite(tnt) || tnt < 0) throw new TypeError('Finite aircraft hit energy and non-negative TNT required');
    const hit = trace(a, b);
    if (!hit.first) return null;
    const D = plane.damage;
    if (!D?.harm || !D?.blast) throw new TypeError('Existing AircraftDamage owner required');
    const killed = [], parts = [], seen = new Set();
    const live212 = policy() === 'live212';
    let k = 0, left = 1;
    for (const c of hit.contacts) {
      const id = c.damageId;
      // A filled round bursts at its first actual material contact, including a
      // precise internal mesh reached through an opening. It cannot pass an unbound
      // cockpit/gear triangle and apply kinetic damage to a module behind it.
      if (tnt > 0 && c.t > hit.first.t + 1e-12) break;
      if (!id || !D.by?.[id] || seen.has(id)) continue;
      seen.add(id);
      if (tnt > 0 && parts.length > 0 || k > 3) break;
      parts.push(id);
      // Retain the chosen delivered damage model; only intersections change. The
      // live model's structural layers share damage once per id, with a smaller
      // kinetic share/attenuation than internal modules and their own armour factor.
      const surface = c.surface ?? (D.hitbox?.surface?.has(id) || c.source === 'outer');
      const amount = .17 * Math.sqrt(Math.max(0, energyJ)) * (live212 ? left * (surface ? .6 : 1) * (D.by[id].armor ?? 1) : .65 ** k);
      if (D.harm(id, amount, incendiary, rnd)) killed.push(id);
      if (live212) { left *= surface ? .85 : .65; if (!surface) k++; }
      else k++;
    }
    if (tnt > 0) D.blast(hit.first.point, tnt, rnd, killed);
    if (killed.includes('ammo') && D.by.ammo && rnd() < 0.35) D.blast(D.by.ammo.c, 0.25, rnd, killed);
    return {t: hit.first.t, killed, parts, piece: hit.first.partId, tri: hit.first.triangleId,
      first: hit.first, contacts: hit.contacts, stats: hit.stats, damagePolicy: live212 ? 'live212' : 'legacy68c',
      geometryRevision: AIRCRAFT_HITBOX_REVISION, source: 'uploaded_float32_triangles'};
  }
  return {
    revision: AIRCRAFT_HITBOX_REVISION, trace, damageRay,
    setInterior(value) { internal = value; prepared = null; },
    invalidatePose() { prepared = null; },
    statistics() { return {queries, frameBuilds, poseCacheHits, bvhBuilds, last: lastStats && {...lastStats}}; },
    async audit() {
      const entries = frame().entries, out = [];
      for (const e of entries) {
        const c = e.cache, p = positions(c);
        if (!c.hash) c.hash = globalThis.crypto?.subtle
          ? `sha256:${Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', p)), b => b.toString(16).padStart(2, '0')).join('')}`
          : c.fingerprint;
        out.push({partId: e.record.partId, instanceId: e.record.instanceId || e.record.partId,
          role: e.record.role, damageId: e.damageId, source: e.record.source,
          triangles: c.triangleCount, positionHash: c.hash});
      }
      return {revision: AIRCRAFT_HITBOX_REVISION, damagePolicy: policy(), geometrySource: 'uploaded_float32_triangles',
        membership: 'physical_removal_and_damage_owner; visibility_ignored',
        timing: 'fixed_target_pose_per_finite_segment', entries: out,
        triangles: out.reduce((n, e) => n + e.triangles, 0)};
    },
  };
}

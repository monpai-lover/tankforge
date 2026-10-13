// Copyright (c) 2026 Replay Lab Contributors. V3-derived helpers are MIT licensed.
// Full notice: docs/third-party/hit-replay-v3-LICENSE.txt (added with the clock port).
// Physical prototypes leased by live battlefield, missile, design-range and replay owners.
const REVISION = 'v3_display_profile_v1';
const profiles = new WeakSet();
const positive = n => Number.isFinite(n) && n > 0;
const dimension = (value, source, status = 'catalog') => Object.freeze({ value, source, status: value == null ? 'unknown' : status });
const deepFreeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); } return value; };

// Source makeAmmo family envelopes. Diameter is the body/collar envelope, not fins or sabot.
const ENVELOPES = {
  ap: [-.33, .39, .106, 5], aphe: [-.33, .39, .106, 0], apcbc: [-.33, .39, .106, 0],
  apfsds: [-.49, .49, .025, 1], heat: [-.38, .47, .084, 2], heat_fs: [-.40, .47, .084, 2],
  he: [-.36, .42, .128, 3], hesh: [-.32, .31, .121, 4], apcr: [-.24, .30, .087, 6],
  apds: [-.26, .29, .061, 7], missile: [-.62, .71, .080, 8], rocket: [-.62, .71, .080, 8],
  mg: [-.28, .38, .102, 5],
};

/** Catalog dimensions are physical. Every unsupported fine shape remains a versioned display estimate. */
export function projectileProfile(shell, missileDef = null) {
  if (!shell || typeof shell !== 'object' || !missileDef && typeof shell.id !== 'string') throw new TypeError('projectile profile needs a catalog entry');
  if (missileDef && (typeof missileDef !== 'object' || typeof missileDef.id !== 'string')) throw new TypeError('projectile profile needs a missile definition');
  const mg = !missileDef && (positive(shell.bullet_mass_g) || String(shell.id).startsWith('bullet_') || shell.kind === 'mg');
  const family = missileDef ? (missileDef.guidance === 'none' ? 'rocket' : 'missile') : mg ? 'mg' : String(shell.kind || 'unknown').toLowerCase().replace('heat-fs', 'heat_fs');
  const id = missileDef?.id || shell.id;
  const diameterM = positive((missileDef || shell).caliber_mm) ? (missileDef || shell).caliber_mm / 1000 : null;
  const lengthM = missileDef ? (positive(missileDef.length_m) ? missileDef.length_m : null) : mg ? (diameterM == null ? null : diameterM * 4) : positive(shell.length_mm) ? shell.length_mm / 1000 : null;
  const spanM = missileDef && positive(missileDef.span_m) ? missileDef.span_m : null;
  const weaponClass = missileDef ? family : mg ? 'mg' : diameterM != null && diameterM <= .035 ? 'autocannon' : 'cannon';
  // The catalog's explicit ID/name identifies caps; their dimensions are not catalog measurements.
  const capIdentity = family === 'apcbc' ? (/^apc_/.test(id) ? 'apc' : 'apcbc') : /^apbc_/.test(id) ? 'apbc' : 'none';
  const explosiveFuze = !missileDef && (family === 'aphe' || family === 'apcbc') && (positive(shell.explosive_mass_kg) || family === 'aphe');
  let roles;
  if (['ap', 'aphe', 'apcbc'].includes(family)) {
    roles = ['core', 'band'];
    if (capIdentity === 'apc' || capIdentity === 'apcbc') roles.push('penetration_cap');
    if (capIdentity === 'apbc' || capIdentity === 'apcbc') roles.push('ballistic_cap');
    else roles.push('ogive');
    if (family === 'aphe' || family === 'apcbc') roles.push('jacket');
    if (explosiveFuze) roles.push('fuze');
  } else if (family === 'mg') roles = ['jacket', 'ogive', 'tracer_base'];
  else if (family === 'apcr') roles = ['jacket', 'core', 'band'];
  else if (family === 'apds') roles = ['core', 'band', 'sabot'];
  else if (family === 'apfsds') roles = ['core', 'band', 'fins', 'sabot'];
  else if (family === 'he' || family === 'hesh') roles = ['jacket', 'band', 'fuze'];
  else if (family === 'heat' || family === 'heat_fs') roles = ['jacket', 'band', 'fuze', ...(family === 'heat_fs' ? ['fins'] : [])];
  else if (missileDef) roles = ['jacket', 'band', 'fins'];
  else roles = ['body'];
  if (weaponClass === 'autocannon' && !roles.includes('tracer_base')) roles.push('tracer_base');
  const envelope = ENVELOPES[family];
  const p = deepFreeze({
    id, revision: REVISION, family, weaponClass, lengthM, diameterM, spanM, roles,
    provenance: {
      source: missileDef ? 'missile_catalog' : mg ? 'machine_gun_catalog' : 'projectile_catalog',
      dimensions: {
        lengthM: dimension(lengthM, missileDef ? 'missile.length_m' : mg ? `${REVISION}:caliber*4` : 'shell.length_mm', mg ? 'estimated' : 'catalog'),
        diameterM: dimension(diameterM, missileDef ? 'missile.caliber_mm' : 'shell.caliber_mm'),
        spanM: dimension(spanM, missileDef ? 'missile.span_m' : null),
      },
      fineShape: REVISION, finChord: REVISION, finThickness: REVISION, finPosition: REVISION,
      sabotDimensions: REVISION, fuzeDimensions: REVISION,
      capIdentity: { value: capIdentity, source: capIdentity === 'none' ? 'catalog.kind' : 'catalog.id' },
      fuzeIdentity: { value: explosiveFuze, source: positive(shell.explosive_mass_kg) ? 'catalog.explosive_mass_kg' : 'catalog.kind' },
    },
    shape: envelope ? {
      sourceTail: envelope[0], sourceNose: envelope[1], sourceRadius: envelope[2], sourceType: envelope[3],
      axialScale: lengthM == null ? null : lengthM / (envelope[1] - envelope[0]),
      radialScale: diameterM == null ? null : diameterM / (2 * envelope[2]),
      capIdentity, explosiveFuze,
    } : null,
  });
  profiles.add(p);
  return p;
}
const V = {
  sub: (a, b) => a.map((x, i) => x - b[i]),
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); },
};

// V3 gl.js:22–23,31–38. Original indexed winding is deliberately retained here.
function geometry(p, n, i, e = []) { return { p, n, i, e }; }
function faceMesh(faces) {
  const p = [], n = [], idx = [], edges = [];
  for (const face of faces) {
    const start = p.length / 3, N = V.norm(V.cross(V.sub(face[1], face[0]), V.sub(face[2], face[0])));
    for (const v of face) { p.push(...v); n.push(...N); }
    for (let j = 1; j < face.length - 1; j++) idx.push(start, start + j, start + j + 1);
    for (let j = 0; j < face.length; j++) edges.push(start + j, start + (j + 1) % face.length);
  }
  return geometry(p, n, idx, edges);
}
function latheGeo(profile, segments = 40) {
  const p = [], n = [], i = [], e = [];
  for (let j = 0; j < profile.length; j++) {
    const [x, r] = profile[j], prev = profile[Math.max(0, j - 1)], next = profile[Math.min(profile.length - 1, j + 1)];
    const slope = (next[1] - prev[1]) / Math.max(next[0] - prev[0], .0001);
    for (let k = 0; k <= segments; k++) {
      const a = k / segments * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      p.push(x, r * c, r * s); n.push(...V.norm([-slope, c, s]));
    }
  }
  for (let j = 0; j < profile.length - 1; j++) for (let k = 0; k < segments; k++) {
    const a = j * (segments + 1) + k, b = a + segments + 1;
    i.push(a, b, a + 1, a + 1, b, b + 1);
  }
  for (const j of [0, profile.length - 1]) for (let k = 0; k < segments; k++) e.push(j * (segments + 1) + k, j * (segments + 1) + k + 1);
  return geometry(p, n, i, e);
}

// Adaptation of gl.js:49 transformed/M.normal: source +X onto TankForge +Z,
// R([x,y,z])=[-z,y,x], det(R)=+1. Scale normals with the inverse transpose.
function transformed(g, profile, { angle = 0, offsetX = 0, scale = [1, 1, 1] } = {}) {
  const p = [], n = [], c = Math.cos(angle), s = Math.sin(angle), { radialScale: r, axialScale: l, sourceNose: nose } = profile.shape;
  for (let i = 0; i < g.p.length; i += 3) {
    const x = g.p[i] * scale[0] + offsetX, y = g.p[i + 1] * scale[1] * c - g.p[i + 2] * scale[2] * s, z = g.p[i + 1] * scale[1] * s + g.p[i + 2] * scale[2] * c;
    const nx = g.n[i] / scale[0], ny = g.n[i + 1] / scale[1] * c - g.n[i + 2] / scale[2] * s, nz = g.n[i + 1] / scale[1] * s + g.n[i + 2] / scale[2] * c;
    p.push(-z * r, y * r, (x - nose) * l);
    n.push(...V.norm([-nz / r, ny / r, nx / l]));
  }
  return geometry(p, n, g.i.slice(), g.e.slice());
}

const COLOR = {
  core: '#b6babc', jacket: '#647276', ogive: '#425d73', ballistic_cap: '#425d73', penetration_cap: '#aec0c6',
  band: '#bd9b57', fuze: '#26363f', fins: '#6e7b82', sabot: '#778584', tracer_base: '#5d686d',
};
const linearColor = h => [1, 3, 5].map(i => Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2));

/** Maximum-reuse V3 scene.js:137–154 construction, with roles retained before merging. */
function makeAmmo(profile) {
  const parts = [], shoes = [], type = profile.shape.sourceType, { family, shape, weaponClass } = profile;
  const add = (geo, role, color = COLOR[role], options = {}) => {
    parts.push({ geo: transformed(geo, profile, options), role, color: linearColor(color), id: `${role}:${parts.filter(p => p.role === role).length}`, doubleSided: role === 'fins' });
  };
  const lat = (points, color, role = 'jacket') => add(latheGeo(points, 40), role, color);
  // V3 ring -> G.cyl/Builder.cylinder, gl.js:48,56. Same profile and 24 segments.
  const ring = (x, l, r, color, role = 'band') => add(latheGeo([[-.5, 0], [-.5, 1], [.5, 1], [.5, 0]], 24), role, color, { offsetX: x, scale: [l, r, r] });
  const fins = (x, length, radius, width, color) => {
    // Actual catalog span overrides the source outer radius; absent span is an estimated shape.
    if (profile.spanM != null) radius = profile.spanM / (2 * shape.radialScale);
    for (let a = 0; a < 4; a++) {
      const g = faceMesh([
        [[x - length / 2, .026, -width / 2], [x + length / 2, .026, -width / 2], [x + length * .10, radius, -width / 2], [x - length / 2, radius * .75, -width / 2]],
        [[x - length / 2, .026, width / 2], [x - length / 2, radius * .75, width / 2], [x + length * .10, radius, width / 2], [x + length / 2, .026, width / 2]],
      ]);
      add(g, 'fins', color, { angle: a * Math.PI / 2 });
    }
  };
  if (family === 'mg') {
    lat([[-.28, 0], [-.28, .088], [.14, .10]], COLOR.jacket, 'jacket');
    lat([[.14, .10], [.27, .048], [.38, 0]], COLOR.ogive, 'ogive');
    ring(-.25, .028, .102, COLOR.tracer_base, 'tracer_base');
  } else if (type === 1) {
    lat([[-.49, 0], [-.49, .018], [.34, .018], [.49, 0]], '#b6babc', 'core');
    ring(-.39, .035, .025, '#5d686d'); fins(-.41, .15, .086, .004, '#6e7b82');
  } else if (type === 2) {
    lat([[-.38, 0], [-.38, .067], [-.21, .081], [.03, .081], [.19, .040], [.41, .012], [.47, 0]], '#798773');
    ring(-.23, .024, .084, COLOR.band); ring(.39, .05, .014, COLOR.fuze, 'fuze');
    if (family === 'heat_fs') fins(-.31, .18, .122, .006, '#596b60');
  } else if (type === 3) {
    lat([[-.36, 0], [-.36, .112], [-.18, .124], [.13, .121], [.28, .082], [.39, .028], [.42, 0]], '#536b65');
    ring(-.21, .052, .128, COLOR.band); ring(.34, .055, .046, '#b3b6a7', 'fuze');
  } else if (type === 4) {
    lat([[-.32, 0], [-.32, .118], [.12, .118], [.23, .094], [.30, .035], [.31, 0]], '#657e79');
    ring(-.19, .044, .121, COLOR.band); ring(.15, .031, .108, '#adbdad', 'fuze');
  } else if (type === 6) {
    lat([[-.24, 0], [-.24, .050], [-.13, .085], [.09, .067], [.28, 0]], '#809398');
    ring(-.11, .06, .087, COLOR.band); lat([[.01, .048], [.18, .028], [.30, 0]], COLOR.fuze, 'core');
  } else if (type === 7) {
    lat([[-.26, 0], [-.26, .040], [.11, .040], [.29, 0]], '#abb7b8', 'core');
    ring(-.18, .035, .061, COLOR.fuze);
  } else if (type === 8) {
    lat([[-.62, 0], [-.62, .067], [-.45, .078], [.33, .078], [.55, .056], [.71, 0]], '#b9b9a1');
    ring(-.50, .06, .08, '#46534d'); ring(.20, .05, .080, '#4f5e5a');
    fins(-.42, .27, .20, .008, '#6d7b6e');
    if (family === 'missile') fins(.10, .26, .18, .007, '#768477');
  } else {
    // V3 shared AP/APHE profile is split at the ogive, then refined by catalog cap/fuze identity.
    // Its unsupported cap and fuze dimensions remain REVISION estimates, never damage geometry.
    lat([[-.33, shape.explosiveFuze ? .028 : 0], [-.33, .093], [-.18, .102], [.09, .10]], type === 0 ? '#425d73' : '#83918d', 'core');
    if (shape.capIdentity === 'apcbc') {
      lat([[.09, .10], [.19, .086]], COLOR.penetration_cap, 'penetration_cap');
      lat([[.19, .086], [.30, .045], [.39, 0]], COLOR.ballistic_cap, 'ballistic_cap');
    } else if (shape.capIdentity === 'apc') {
      lat([[.09, .10], [.23, .071], [.29, .054]], COLOR.penetration_cap, 'penetration_cap');
      lat([[.29, .054], [.39, 0]], COLOR.ogive, 'ogive');
    } else if (shape.capIdentity === 'apbc') lat([[.09, .10], [.26, .079], [.37, .014], [.39, 0]], COLOR.ballistic_cap, 'ballistic_cap');
    else lat([[.09, .10], [.26, .066], [.39, 0]], COLOR.ogive, 'ogive');
    ring(-.21, .053, .106, COLOR.band);
    if (type === 0) ring(.02, .019, .102, '#aec0c6', 'jacket');
    if (shape.explosiveFuze) lat([[-.33, 0], [-.33, .027], [-.31, .027], [-.31, 0]], COLOR.fuze, 'fuze');
  }
  if (weaponClass === 'autocannon') ring(shape.sourceTail + .012, .016, shape.sourceRadius * .45, COLOR.tracer_base, 'tracer_base');
  if (type === 1 || type === 7) for (let i = 0; i < 3; i++) {
    // scene.js:150–152: actual three sector-shaped shoes. The unused source sleeve is omitted.
    const f = faceMesh([
      [[-.18, .027, -.035], [.13, .027, -.035], [.09, .12, -.060], [-.15, .12, -.060]],
      [[-.18, .027, .035], [-.15, .12, .060], [.09, .12, .060], [.13, .027, .035]],
      [[-.15, .12, -.060], [.09, .12, -.060], [.09, .12, .060], [-.15, .12, .060]],
    ]);
    shoes.push({ geo: transformed(f, profile, { angle: i * Math.PI * 2 / 3, offsetX: -.05 }), role: 'sabot', color: linearColor(COLOR.sabot), id: `sabot:${i}`, doubleSided: true });
  }
  return { body: parts, sabot: shoes };
}

function assertProfile(profile) {
  if (!profiles.has(profile)) throw new TypeError('projectile profile must come from projectileProfile');
}

const BODY_KINDS = new Set(['intact', 'launch', 'core', 'sabot']);
const TERMINAL_KINDS = new Set(['stopped', 'detonated', 'fractured', 'terminated']);
function stageInfo(stage = 'intact') {
  const structural = typeof stage === 'string';
  if (!structural && (!stage || typeof stage !== 'object')) throw new TypeError('projectile stage must be a kind or record');
  const kind = structural ? stage : stage.kind;
  if (typeof kind !== 'string') throw new TypeError('projectile stage needs a kind');
  const recorded = !structural && stage.recorded === true;
  const timeS = !structural && Number.isFinite(stage.time_s) && stage.time_s >= 0 ? stage.time_s : null;
  // Structural core/sabot requests only construct prototypes; they claim no timed transition.
  const allowed = structural ? BODY_KINDS.has(kind) : kind === 'intact' || kind === 'launch' || recorded && BODY_KINDS.has(kind);
  return { kind, recorded, timeS, transitionKnown: recorded && timeS != null, visibility: recorded && TERMINAL_KINDS.has(kind) ? 'none' : allowed ? 'body' : 'unknown' };
}

const ADAPTER = Object.freeze({ frontFace: 'CCW', lathe: 'align_winding_to_normals', openFaces: 'duplicate_reverse_face_and_normal' });
/** CPU source-parity indexed geometry. +Z nose is always anchored at z=0, meters. */
export function buildProjectileGeometry(profile, stage = 'intact') {
  assertProfile(profile);
  const info = stageInfo(stage);
  if (info.visibility === 'body' && (!profile.shape || profile.lengthM == null || profile.diameterM == null)) info.visibility = 'unknown';
  const source = info.visibility === 'body' ? makeAmmo(profile) : { body: [], sabot: [] };
  const selected = info.kind === 'sabot' ? source.sabot : info.kind === 'launch' ? [...source.body, ...source.sabot] : source.body;
  const vertices = [], indices = [], parts = [], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const part of selected) {
    const vertexStart = vertices.length / 13, indexStart = indices.length, g = part.geo;
    for (let i = 0; i < g.p.length; i += 3) {
      const p = g.p.slice(i, i + 3), n = g.n.slice(i, i + 3);
      vertices.push(...p, ...n, ...part.color, .55, .45, p[0], p[2]);
      for (let j = 0; j < 3; j++) { min[j] = Math.min(min[j], p[j]); max[j] = Math.max(max[j], p[j]); }
    }
    for (const index of g.i) indices.push(index + vertexStart);
    parts.push(Object.freeze({ id: part.id, role: part.role, vertexStart, vertexCount: g.p.length / 3, indexStart, indexCount: g.i.length, doubleSided: part.doubleSided }));
  }
  return {
    profileId: profile.id, revision: profile.revision, stage: info.kind, visibility: info.visibility,
    transitionKnown: info.transitionKnown, timeS: info.timeS, stride: 13,
    vertices: new Float32Array(vertices), indices: new Uint32Array(indices), parts: Object.freeze(parts),
    bounds: selected.length ? { min, max } : null, adapter: ADAPTER,
  };
}

/**
 * Renderer.mesh expects unindexed STRIDE13 triangles with CCW front faces. Raw V3 lathe
 * winding disagrees with its smooth normals. Correct only the adapter, and emit reverse
 * faces/normals for open fins/shoes. sourceWinding is for source diagnostics, not rendering.
 */
export function projectileTriangleData(g, { sourceWinding = false } = {}) {
  if (!g || g.stride !== 13 || !(g.vertices instanceof Float32Array) || !(g.indices instanceof Uint32Array)) throw new TypeError('invalid projectile geometry');
  const doubleIndices = sourceWinding ? 0 : g.parts.reduce((sum, p) => sum + (p.doubleSided ? p.indexCount : 0), 0);
  const out = new Float32Array((g.indices.length + doubleIndices) * 13);
  let offset = 0;
  const emit = (indices, reverseNormal = false) => {
    for (const i of indices) {
      out.set(g.vertices.subarray(i * 13, i * 13 + 13), offset);
      if (reverseNormal) for (let n = 3; n < 6; n++) out[offset + n] *= -1;
      offset += 13;
    }
  };
  for (const part of g.parts) for (let i = part.indexStart; i < part.indexStart + part.indexCount; i += 3) {
    const ids = Array.from(g.indices.subarray(i, i + 3));
    if (!sourceWinding) {
      const p = ids.map(id => Array.from(g.vertices.subarray(id * 13, id * 13 + 3)));
      const face = V.cross(V.sub(p[1], p[0]), V.sub(p[2], p[0]));
      let agreement = 0;
      for (const id of ids) for (let j = 0; j < 3; j++) agreement += face[j] * g.vertices[id * 13 + 3 + j];
      if (agreement < 0) [ids[1], ids[2]] = [ids[2], ids[1]];
    }
    emit(ids);
    if (!sourceWinding && part.doubleSided) emit([ids[0], ids[2], ids[1]], true);
  }
  return out;
}

/** Display enlargement is separate from the physical mesh and anchored at its nose. */
export function projectileDisplayTransform(profile, { diameterScale = 1, lengthScale = 1 } = {}) {
  assertProfile(profile);
  if (!positive(diameterScale) || !positive(lengthScale)) throw new TypeError('projectile display scale must be finite and positive');
  return {
    matrix: new Float32Array([diameterScale, 0, 0, 0, 0, diameterScale, 0, 0, 0, 0, lengthScale, 0, 0, 0, 0, 1]),
    diagnostic: Object.freeze({ physicalLengthM: profile.lengthM, physicalDiameterM: profile.diameterM, diameterScale, lengthScale, revision: REVISION }),
  };
}
function assertRenderer(renderer) {
  if (!renderer || typeof renderer.mesh !== 'function' || typeof renderer.freeMesh !== 'function') throw new TypeError('projectile pool renderer needs mesh and freeMesh');
}

/**
 * Bounded prototype owner, distinct from active leases. release() returns a prototype to
 * the idle cache; clearIdle()/eviction frees idle GPU owners; dispose() frees ALL owners.
 * One reserve upload is permitted during an idle replacement so failed uploads preserve
 * the previous cache (maxPrototypes + 1 transient owners, never unbounded).
 * Context seams remove this pool's owners from Renderer._live before its automatic restore.
 * Consumers must call contextLost() before restore, then restoreContext() after availability.
 */
export class ProjectileVisualPool {
  constructor(renderer, { maxPrototypes = 64, maxLeases = 256, reservedPrototypes=0 } = {}) {
    assertRenderer(renderer);
    if (!Number.isSafeInteger(maxPrototypes) || maxPrototypes < 1 || !Number.isSafeInteger(maxLeases) || maxLeases < 1) throw new TypeError('projectile pool capacities must be positive integers');
    this.renderer = renderer;
    this.maxPrototypes = maxPrototypes;
    this.maxLeases = maxLeases;
    if(!Number.isSafeInteger(reservedPrototypes)||reservedPrototypes<0||reservedPrototypes>=maxPrototypes)throw new TypeError('invalid projectile prototype reservation');
    this.reservedPrototypes=reservedPrototypes;
    this.entries = new Map();
    this.leases = new Map();
    this.profileKeys = new WeakMap();
    this.serial = 0;
    this.geometryBuilds = 0;
    this.uploads = 0;
    this.disposedOwners = 0;
    this.lost = false;
    this.disposed = false;
  }

  _upload(renderer, triangleData) {
    if (!triangleData.length) return null;
    // Renderer.mesh is itself transactional if GPU allocation throws.
    const mesh = renderer.mesh(triangleData);
    if (!mesh || typeof mesh !== 'object') throw new TypeError('projectile renderer returned an invalid mesh');
    this.uploads++;
    return mesh;
  }

  _free(entry, renderer = this.renderer) {
    if (entry.mesh) {
      renderer.freeMesh(entry.mesh);
      entry.mesh = null;
      this.disposedOwners++;
    }
  }

  acquire(profile, stage = 'intact', {reserve=false}={}) {
    assertProfile(profile);
    const info = stageInfo(stage);
    if (this.disposed) throw new Error('projectile pool is disposed');
    if (this.lost) throw new Error('projectile pool context is unavailable');
    if (this.leases.size >= this.maxLeases) throw new RangeError('projectile pool lease capacity reached');
    let profileKey = this.profileKeys.get(profile);
    if (!profileKey) { profileKey = JSON.stringify(profile); this.profileKeys.set(profile, profileKey); }
    const key = `${profileKey}|${info.kind}|${info.visibility}`;
    let entry = this.entries.get(key);
    if (!entry) {
      let victim = null;
      if (this.entries.size >= this.maxPrototypes-(reserve?0:this.reservedPrototypes)) {
        for (const candidate of this.entries.values()) if (!candidate.leases && (!victim || candidate.lastUse < victim.lastUse)) victim = candidate;
        if (!victim) throw new RangeError('projectile pool prototype capacity reached with active leases');
      }
      // Prototype metadata has no event timing. The handle retains the caller's stage record.
      const prototypeStage = info.visibility === 'body' ? info.kind : { kind: info.kind, recorded: info.visibility === 'none' };
      const geometry = buildProjectileGeometry(profile, prototypeStage);
      this.geometryBuilds++;
      const triangleData = projectileTriangleData(geometry);
      const mesh = this._upload(this.renderer, triangleData);
      entry = { key, geometry, triangleData, mesh, leases: 0, lastUse: ++this.serial };
      if (victim) {
        try { this._free(victim); } catch (error) { this._free(entry); throw error; }
        this.entries.delete(victim.key);
      }
      this.entries.set(key, entry);
    }
    entry.leases++; entry.lastUse = ++this.serial;
    const pool = this;
    const handle = Object.freeze({ profile, stage: Object.freeze(info), geometry: entry.geometry, get mesh() { return pool.leases.has(handle) ? entry.mesh : null; } });
    this.leases.set(handle, entry);
    return handle;
  }

  release(handle) {
    const entry = this.leases.get(handle);
    if (!entry) return false;
    this.leases.delete(handle); entry.leases--; entry.lastUse = ++this.serial;
    return true;
  }

  clearIdle() {
    for (const [key, entry] of this.entries) if (!entry.leases) { this._free(entry); this.entries.delete(key); }
  }

  contextLost() {
    if (this.disposed || this.lost) return;
    for (const entry of this.entries.values()) this._free(entry);
    this.lost = true;
  }

  restoreContext(renderer = this.renderer) {
    if (this.disposed) throw new Error('projectile pool is disposed');
    if (!this.lost) return;
    assertRenderer(renderer);
    const pending = [];
    try {
      for (const entry of this.entries.values()) pending.push({ entry, mesh: this._upload(renderer, entry.triangleData) });
    } catch (error) {
      for (const owner of pending) this._free(owner, renderer);
      throw error;
    }
    for (const owner of pending) owner.entry.mesh = owner.mesh;
    this.renderer = renderer; this.lost = false;
  }

  stats() {
    let idle = 0;
    for (const entry of this.entries.values()) if (!entry.leases) idle++;
    return { prototypes: this.entries.size, leases: this.leases.size, idle, geometryBuilds: this.geometryBuilds, uploads: this.uploads, disposedOwners: this.disposedOwners, contextLost: this.lost, disposed: this.disposed };
  }

  dispose() {
    if (this.disposed) return;
    for (const entry of this.entries.values()) this._free(entry);
    this.entries.clear(); this.leases.clear(); this.disposed = true;
  }
}

// The range's ground shape, written once and used twice: as JS for the physics (terrain.js) and
// as GLSL for the drawn terrain (the terrain grid is displaced in the vertex shader by the same
// function), so what the tracks stand on is exactly what is drawn. Deformation (ruts) is added on
// top by terrain.js and the deformation texture.
//
//   relief = zone roughness (small waves, per surface) + cross-country field + suspension course
// Hump lanes beside the road are solid objects (world.js), not part of the relief.

// rect = [xmin, zmin, xmax, zmax]; first match wins, everything else is grass.
export const ZONES = [
  { id: 'road', label: '道路', rect: [-6, -80, 6, 2600], color: '#5b5953', soft: 0.12 },
  // the motor pool beside the start of the road: hard standing, drives like the road
  { id: 'road', label: '停車坪', rect: [-98, -82, -22, -22], color: '#5e5d57', soft: 0.5, sign: false },
  { id: 'mud', label: '泥地', rect: [-100, 30, -24, 130], color: '#3d2f20', soft: 1.6 },
  { id: 'snow', label: '雪地', rect: [-100, 165, -24, 265], color: '#dfe5ea', soft: 1.6 },
  { id: 'sand', label: '沙地', rect: [24, 30, 100, 130], color: '#b79e66', soft: 1.6 },
  { id: 'dirt', label: '土路', rect: [24, 165, 100, 265], color: '#6b5539', soft: 1.6 },
  // cross-country field: rolling ground, a ditch, a ridge and shell craters (see fieldHeight)
  { id: 'dirt', label: '越野場', rect: [24, 300, 110, 540], color: '#5f5236', soft: 2.4 },
  // suspension test course lanes with their own surfaces (the others are dirt)
  { id: 'gravel', label: '碎石路', rect: [-80, 300, -70, 440], color: '#77736a', soft: 0.4, sign: false },
  { id: 'wetland', label: '濕地', rect: [-38, 300, -28, 440], color: '#38382a', soft: 0.8, sign: false },
  { id: 'dirt', label: '懸吊測試場', rect: [-112, 290, -24, 470], color: '#66583d', soft: 1.2, sign: false },
];

// How uneven each surface is (metres): the small waves the road wheels ride over.
export const BUMP_HEIGHT = { road: 0.006, grass: 0.034, dirt: 0.044, mud: 0.05, sand: 0.034, snow: 0.024, gravel: 0.03, wetland: 0.04 };

// The battle map in use (game/battlemap.js), or null on the test range. Everything that asks
// for the ground (physics, camera, rays, shells) goes through relief() and terrainAt().
let ACTIVE = null;
export function setActiveMap(m) {
  ACTIVE = m;
}
export function activeMap() {
  return ACTIVE;
}

export function terrainAt(x, z) {
  if (ACTIVE) return ACTIVE.surfaceId(x, z);
  for (const zn of ZONES) {
    const r = zn.rect;
    if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) return zn.id;
  }
  return 'grass';
}

/** Small waves of a surface: long gentle ones everywhere; gravel adds short, sharp ones. */
export function roughness(id, x, z) {
  const a = BUMP_HEIGHT[id] ?? 0.03;
  let h = a * (0.5 * Math.sin(x * 1.1 + z * 0.7) * Math.sin(z * 0.9 - x * 0.4) + 0.32 * Math.sin(z * 2.3 + 1.7) * Math.sin(x * 1.9 + 0.4) + 0.18 * Math.sin(z * 4.1 + x * 3.3));
  if (id === 'gravel') h += 0.022 * Math.sin(z * 9.7 + x * 2.1) * Math.sin(x * 8.3 - z * 1.3) + 0.012 * Math.sin(z * 17.0 + x * 13.0);
  return h;
}

// ---------------------------------------------------------------- cross-country field

export const FIELD = { rect: [24, 300, 110, 540], edge: 14 };
export const CRATERS = [
  [48, 338, 2.6, 0.65],
  [83, 366, 3.2, 0.85],
  [64, 392, 2.2, 0.5],
  [94, 428, 2.8, 0.7],
  [40, 498, 2.4, 0.6],
  [72, 512, 3.0, 0.75],
];
const bell = (u) => (u * u < 1 ? 0.5 + 0.5 * Math.cos(Math.PI * u) : 0);
const smooth = (e0, e1, x) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Height of the field's relief (0 outside it), metres. */
export function fieldHeight(x, z) {
  const [x0, z0, x1, z1] = FIELD.rect;
  if (x <= x0 || x >= x1 || z <= z0 || z >= z1) return 0;
  const e = Math.min(x - x0, x1 - x, z - z0, z1 - z) / FIELD.edge;
  const w = e >= 1 ? 1 : e * e * (3 - 2 * e);
  let h = 0.42 * Math.sin(x * 0.19 + z * 0.11) * Math.sin(z * 0.16 - x * 0.07) + 0.24 * Math.sin(z * 0.37 + 1.3) * Math.cos(x * 0.27 + 0.4) + 0.1 * Math.sin(x * 0.71 + z * 0.53);
  // an anti-tank ditch across the field, a ridge beyond it
  h -= 0.7 * bell((z - 405) / 1.7);
  h += 0.55 * bell((z - 458) / 3.6);
  for (const [cx, cz, r, d] of CRATERS) {
    const q = ((x - cx) ** 2 + (z - cz) ** 2) / (r * r);
    if (q < 2.2) h += q < 1 ? -d * (1 - q) ** 2 + 0.12 * d * q : 0.12 * d * Math.max(0, 1 - (q - 1) / 1.2);
  }
  return h * w;
}

// ---------------------------------------------------------------- suspension test course

// Lanes run north (+z) from z 310. Each lane is 10 m wide; x0 is its west edge.
export const COURSE = {
  rect: [-112, 290, -24, 470],
  lanes: [
    { x0: -108, label: '連續波浪', id: 'waves' },
    { x0: -94, label: '左右交錯波浪', id: 'staggered' },
    { x0: -80, label: '碎石與小凸起', id: 'gravel' },
    { x0: -66, label: '壕溝・台階・坡頂・坑洞', id: 'obstacles' },
    { x0: -52, label: '左右高低差・側傾', id: 'camber' },
    { x0: -38, label: '濕地', id: 'wetland' },
  ],
};

/** Height of the suspension course (0 outside it), metres. */
export function courseHeight(x, z) {
  if (x < -108 || x > -28 || z < 305 || z > 445) return 0;
  // continuous sine waves: 0.24 m high, 6 m long
  if (x >= -108 && x <= -98) {
    if (z < 310 || z > 430) return 0;
    return 0.12 * (1 - Math.cos(((z - 310) / 6) * 2 * Math.PI));
  }
  // staggered waves: the right track meets the crests the left track has the troughs of
  if (x >= -94 && x <= -84) {
    if (z < 310 || z > 430) return 0;
    const s = smooth(-0.6, 0.6, x + 89);
    return 0.12 * (1 - Math.cos(((z - 310) / 6) * 2 * Math.PI + Math.PI * s));
  }
  // small bumps of different heights every 4.3 m (on gravel)
  if (x >= -80 && x <= -70) {
    if (z < 310 || z > 430) return 0;
    const k = Math.round((z - 312) / 4.3);
    const d = z - (312 + k * 4.3);
    const hh = 0.07 + 0.08 * (0.5 + 0.5 * Math.sin(k * 2.39 + 0.7));
    const side = Math.sin(k * 1.7) > 0 ? smooth(-0.4, 0.4, x + 75) : 1 - smooth(-0.4, 0.4, x + 75);
    return hh * bell(d / 0.55) * (0.35 + 0.65 * side);
  }
  // trench, step up, step down, a 15 degree ramp over a crest, a big pothole
  if (x >= -66 && x <= -56) {
    let h = 0;
    h -= 0.8 * (1 - smooth(0.7, 0.9, Math.abs(z - 318)));
    h += 0.35 * smooth(344.9, 345.1, z) * (1 - smooth(364.9, 365.1, z));
    const ramp = Math.tan((15 * Math.PI) / 180);
    h += Math.min(Math.max((z - 390) * ramp, 0), 2.0) - Math.min(Math.max((z - 404) * ramp, 0), 2.0);
    const q = ((x + 61) ** 2 + (z - 428) ** 2) / 9;
    if (q < 1) h -= 0.9 * (1 - q) * (1 - q);
    return h;
  }
  // a kerb under the left track, then the whole lane tilted, left side high
  if (x >= -52 && x <= -42) {
    const kerb = (1 - smooth(-0.3, 0.3, x + 47)) * smooth(318, 321, z) * (1 - smooth(377, 380, z));
    const tilt = Math.min(Math.max(-47 - x + 5, 0), 10) * Math.tan((10 * Math.PI) / 180) * smooth(396, 402, z) * (1 - smooth(436, 442, z));
    return 0.32 * kerb + tilt;
  }
  return 0;
}

/** The whole relief (no ruts), world y of the ground. */
export function relief(x, z) {
  if (ACTIVE) return ACTIVE.relief(x, z);
  return roughness(terrainAt(x, z), x, z) + fieldHeight(x, z) + courseHeight(x, z);
}

/** Areas where the ground leaves y = 0 by more than a few centimetres (for ray marching). */
export const RELIEF_RECTS = [FIELD.rect, [-108, 305, -28, 445]];
export function reliefRects() {
  return ACTIVE ? [[ACTIVE.rect[0] - 4000, ACTIVE.rect[1] - 4000, ACTIVE.rect[2] + 4000, ACTIVE.rect[3] + 4000]] : RELIEF_RECTS;
}

// ---------------------------------------------------------------- the same in GLSL

const f = (v) => {
  const s = String(v);
  return /[.e]/.test(s) ? s : s + '.0';
};
const BUMP_IDS = Object.keys(BUMP_HEIGHT);

export const RELIEF_GLSL = `
const int RZ_N = ${ZONES.length};
const vec4 RZ_RECT[${ZONES.length}] = vec4[](${ZONES.map((z) => `vec4(${z.rect.map(f).join(', ')})`).join(', ')});
const float RZ_AMP[${ZONES.length}] = float[](${ZONES.map((z) => f(BUMP_HEIGHT[z.id])).join(', ')});
const float RZ_GRAVEL[${ZONES.length}] = float[](${ZONES.map((z) => (z.id === 'gravel' ? '1.0' : '0.0')).join(', ')});
const float R_GRASS_AMP = ${f(BUMP_HEIGHT.grass)};
float rBell(float u) { return u * u < 1.0 ? 0.5 + 0.5 * cos(3.14159265 * u) : 0.0; }
float rRough(vec2 p) {
  float a = R_GRASS_AMP; float g = 0.0;
  for (int i = 0; i < RZ_N; i++) {
    vec4 r = RZ_RECT[i];
    if (p.x >= r.x && p.x <= r.z && p.y >= r.y && p.y <= r.w) { a = RZ_AMP[i]; g = RZ_GRAVEL[i]; break; }
  }
  float x = p.x, z = p.y;
  float h = a * (0.5 * sin(x * 1.1 + z * 0.7) * sin(z * 0.9 - x * 0.4) + 0.32 * sin(z * 2.3 + 1.7) * sin(x * 1.9 + 0.4) + 0.18 * sin(z * 4.1 + x * 3.3));
  if (g > 0.5) h += 0.022 * sin(z * 9.7 + x * 2.1) * sin(x * 8.3 - z * 1.3) + 0.012 * sin(z * 17.0 + x * 13.0);
  return h;
}
const vec4 R_CRATERS[${CRATERS.length}] = vec4[](${CRATERS.map((c) => `vec4(${c.map(f).join(', ')})`).join(', ')});
float rField(vec2 p) {
  float x = p.x, z = p.y;
  if (x <= ${f(FIELD.rect[0])} || x >= ${f(FIELD.rect[2])} || z <= ${f(FIELD.rect[1])} || z >= ${f(FIELD.rect[3])}) return 0.0;
  float e = min(min(x - ${f(FIELD.rect[0])}, ${f(FIELD.rect[2])} - x), min(z - ${f(FIELD.rect[1])}, ${f(FIELD.rect[3])} - z)) / ${f(FIELD.edge)};
  float w = e >= 1.0 ? 1.0 : e * e * (3.0 - 2.0 * e);
  float h = 0.42 * sin(x * 0.19 + z * 0.11) * sin(z * 0.16 - x * 0.07) + 0.24 * sin(z * 0.37 + 1.3) * cos(x * 0.27 + 0.4) + 0.1 * sin(x * 0.71 + z * 0.53);
  h -= 0.7 * rBell((z - 405.0) / 1.7);
  h += 0.55 * rBell((z - 458.0) / 3.6);
  for (int i = 0; i < ${CRATERS.length}; i++) {
    vec4 c = R_CRATERS[i];
    float q = ((x - c.x) * (x - c.x) + (z - c.y) * (z - c.y)) / (c.z * c.z);
    if (q < 2.2) h += q < 1.0 ? -c.w * (1.0 - q) * (1.0 - q) + 0.12 * c.w * q : 0.12 * c.w * max(0.0, 1.0 - (q - 1.0) / 1.2);
  }
  return h * w;
}
float rCourse(vec2 p) {
  float x = p.x, z = p.y;
  if (x < -108.0 || x > -28.0 || z < 305.0 || z > 445.0) return 0.0;
  const float TAU = 6.2831853;
  if (x >= -108.0 && x <= -98.0) {
    if (z < 310.0 || z > 430.0) return 0.0;
    return 0.12 * (1.0 - cos((z - 310.0) / 6.0 * TAU));
  }
  if (x >= -94.0 && x <= -84.0) {
    if (z < 310.0 || z > 430.0) return 0.0;
    float s = smoothstep(-0.6, 0.6, x + 89.0);
    return 0.12 * (1.0 - cos((z - 310.0) / 6.0 * TAU + 3.14159265 * s));
  }
  if (x >= -80.0 && x <= -70.0) {
    if (z < 310.0 || z > 430.0) return 0.0;
    float k = floor((z - 312.0) / 4.3 + 0.5);
    float d = z - (312.0 + k * 4.3);
    float hh = 0.07 + 0.08 * (0.5 + 0.5 * sin(k * 2.39 + 0.7));
    float sm = smoothstep(-0.4, 0.4, x + 75.0);
    float side = sin(k * 1.7) > 0.0 ? sm : 1.0 - sm;
    return hh * rBell(d / 0.55) * (0.35 + 0.65 * side);
  }
  if (x >= -66.0 && x <= -56.0) {
    float h = 0.0;
    h -= 0.8 * (1.0 - smoothstep(0.7, 0.9, abs(z - 318.0)));
    h += 0.35 * smoothstep(344.9, 345.1, z) * (1.0 - smoothstep(364.9, 365.1, z));
    float ramp = tan(15.0 * 3.14159265 / 180.0);
    h += clamp((z - 390.0) * ramp, 0.0, 2.0) - clamp((z - 404.0) * ramp, 0.0, 2.0);
    float q = ((x + 61.0) * (x + 61.0) + (z - 428.0) * (z - 428.0)) / 9.0;
    if (q < 1.0) h -= 0.9 * (1.0 - q) * (1.0 - q);
    return h;
  }
  if (x >= -52.0 && x <= -42.0) {
    float kerb = (1.0 - smoothstep(-0.3, 0.3, x + 47.0)) * smoothstep(318.0, 321.0, z) * (1.0 - smoothstep(377.0, 380.0, z));
    float tilt = clamp(-47.0 - x + 5.0, 0.0, 10.0) * tan(10.0 * 3.14159265 / 180.0) * smoothstep(396.0, 402.0, z) * (1.0 - smoothstep(436.0, 442.0, z));
    return 0.32 * kerb + tilt;
  }
  return 0.0;
}
// the battle map: heights (R32F, texel centres, bilinear exactly as BattleMap.height) and ground
// types (alpha of the colour map, nearest) for the small waves of each surface
uniform float uMapOn;
uniform vec4 uMapRect;        // x0, z0, size, height resolution
uniform sampler2D uMapH;
uniform sampler2D uMapC;
const float MAP_AMP[6] = float[](0.0, ${f(BUMP_HEIGHT.sand)}, ${f(BUMP_HEIGHT.grass)}, ${f(BUMP_HEIGHT.grass)}, ${f(BUMP_HEIGHT.dirt)}, ${f(BUMP_HEIGHT.gravel)});
float mapHeight(vec2 p) {
  float n = uMapRect.w;
  vec2 u = clamp((p - uMapRect.xy) / uMapRect.z * n - 0.5, vec2(0.0), vec2(n - 1.001));
  ivec2 i = ivec2(floor(u));
  vec2 f = u - vec2(i);
  float a = texelFetch(uMapH, i, 0).r;
  float b = texelFetch(uMapH, i + ivec2(1, 0), 0).r;
  float c = texelFetch(uMapH, i + ivec2(0, 1), 0).r;
  float d = texelFetch(uMapH, i + ivec2(1, 1), 0).r;
  return (a * (1.0 - f.x) + b * f.x) * (1.0 - f.y) + (c * (1.0 - f.x) + d * f.x) * f.y;
}
int mapClass(vec2 p) {
  float n = float(textureSize(uMapC, 0).x);
  ivec2 i = clamp(ivec2(floor((p - uMapRect.xy) / uMapRect.z * n)), ivec2(0), ivec2(int(n) - 1));
  return int(texelFetch(uMapC, i, 0).a * 255.0 / 40.0 + 0.5);
}
float mapRelief(vec2 p) {
  int c = mapClass(p);
  float h = mapHeight(p);
  if (c == 0) return h;
  float a = MAP_AMP[c];
  float x = p.x, z = p.y;
  h += a * (0.5 * sin(x * 1.1 + z * 0.7) * sin(z * 0.9 - x * 0.4) + 0.32 * sin(z * 2.3 + 1.7) * sin(x * 1.9 + 0.4) + 0.18 * sin(z * 4.1 + x * 3.3));
  if (c == 5) h += 0.022 * sin(z * 9.7 + x * 2.1) * sin(x * 8.3 - z * 1.3) + 0.012 * sin(z * 17.0 + x * 13.0);
  return h;
}
float relief(vec2 p) { return uMapOn > 0.5 ? mapRelief(p) : rRough(p) + rField(p) + rCourse(p); }
`;
void BUMP_IDS;

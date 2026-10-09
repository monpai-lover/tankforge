// GLSL for the renderer. The frame is built in linear HDR:
//   shadow map -> sky dome (atmosphere + volumetric clouds, refreshed a tile per frame)
//   -> scene (lit geometry, effects) -> light shafts (half size) -> bloom -> composite
//   (height fog, in-scattered sunlight, tone mapping) -> optional pixel-art pass.
export const SHADOW_SIZE = 2048;
export const MAX_ZONES = 12;
import { RELIEF_GLSL } from '../game/relief.js';
/** Texels per side of the deformation window texture (ruts and marks around the player). */
export const DEFORM_TEX = 1024;
/** The dome texture covers the sky down to a little below the horizon (stereographic). */
export const DOME_SCALE = 1.06;

/** Scene colour is kept in half-float targets; on devices without them it is range-compressed. */
export const hdrDefines = (floatTargets) =>
  floatTargets
    ? '#define ENC(c) (c)\n#define DEC(c) (c)\n'
    : '#define ENC(c) sqrt(clamp((c) * 0.0625, 0.0, 1.0))\n#define DEC(c) ((c) * (c) * 16.0)\n';

const FULLSCREEN_VS = `#version 300 es
out vec2 vNdc;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vNdc = p;
  gl_Position = vec4(p, 0.9999, 1.0);
}`;

// ---------------------------------------------------------------------------- shared chunks

const ATMOSPHERE = `
const float PI = 3.14159265;
const float R_PLANET = 6371e3;
const float R_ATMOS = 6471e3;
const vec3 K_RLH = vec3(5.5e-6, 13.0e-6, 22.4e-6);
const float K_MIE = 21e-6;
const vec3 K_OZO = vec3(0.65e-6, 1.881e-6, 0.085e-6);
const float SH_RLH = 8e3;
const float SH_MIE = 1.2e3;
const float G_MIE = 0.758;

float atmosExit(vec3 pos, vec3 dir) {
  float b = 2.0 * dot(dir, pos);
  float c = dot(pos, pos) - R_ATMOS * R_ATMOS;
  float d = b * b - 4.0 * c;
  return d < 0.0 ? 0.0 : (-b + sqrt(d)) * 0.5;
}
vec3 atmosDensity(vec3 pos) {
  float h = max(length(pos) - R_PLANET, 0.0);
  return vec3(exp(-h / SH_RLH), exp(-h / SH_MIE), max(0.0, 1.0 - abs(h - 25e3) / 15e3));
}
// Sky radiance seen from the ground: single scattering of sunlight by air (Rayleigh) and haze (Mie).
vec3 atmosphere(vec3 r, vec3 sun, float iSun) {
  r = normalize(vec3(r.x, max(r.y, 0.0), r.z));
  vec3 origin = vec3(0.0, R_PLANET + 2.0, 0.0);
  float len = atmosExit(origin, r);
  float mu = dot(r, sun), gg = G_MIE * G_MIE;
  float pRlh = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float pMie = 3.0 / (8.0 * PI) * ((1.0 - gg) * (mu * mu + 1.0)) / (pow(1.0 + gg - 2.0 * mu * G_MIE, 1.5) * (2.0 + gg));
  vec3 od = vec3(0.0), totalR = vec3(0.0), totalM = vec3(0.0);
  const int ISTEPS = 12;
  const int JSTEPS = 4;
  for (int i = 0; i < ISTEPS; i++) {
    float f0 = float(i) / float(ISTEPS), f1 = float(i + 1) / float(ISTEPS);
    float ta = len * f0 * f0, tb = len * f1 * f1;
    vec3 p = origin + r * (0.5 * (ta + tb));
    vec3 d = atmosDensity(p) * (tb - ta);
    od += d;
    float jl = atmosExit(p, sun);
    vec3 od2 = vec3(0.0);
    for (int j = 0; j < JSTEPS; j++) {
      float g0 = float(j) / float(JSTEPS), g1 = float(j + 1) / float(JSTEPS);
      float ja = jl * g0 * g0, jb = jl * g1 * g1;
      od2 += atmosDensity(p + sun * (0.5 * (ja + jb))) * (jb - ja);
    }
    vec3 o = od + od2;
    vec3 att = exp(-(K_RLH * o.x + K_MIE * 1.1 * o.y + K_OZO * o.z));
    totalR += d.x * att;
    totalM += d.y * att;
  }
  return iSun * (pRlh * K_RLH * totalR + pMie * K_MIE * totalM);
}`;

// Cloud layer shared by the sky, the cloud shadows on the ground and the light shafts, so that a
// gap you can see overhead is the same gap the sun shines through.
const CLOUDS = `
precision highp sampler3D;
uniform sampler3D uNoise;   // r: billowy base shape, g: fine cellular detail, b: large-scale weather
uniform vec3 uWind;         // metres the cloud field has drifted so far
uniform vec4 uCloud;        // coverage 0..1, evolution phase, extinction (1/m), detail erosion
const float CLOUD_BASE = 1500.0;
const float CLOUD_TOP = 3400.0;
float cloudDensity(vec3 p, float alt, float cheap) {
  float h = (alt - CLOUD_BASE) / (CLOUD_TOP - CLOUD_BASE);
  if (h <= 0.0 || h >= 1.0) return 0.0;
  vec3 q = p + uWind;
  float weather = textureLod(uNoise, vec3(q.x / 43000.0, uCloud.y * 0.2, q.z / 43000.0), 0.0).b;
  float cov = clamp(uCloud.x + (weather - 0.5) * 1.3, 0.0, 1.0);
  float top = mix(0.5, 1.0, smoothstep(0.4, 0.68, weather));
  float profile = smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(top * 0.45, top, h));
  float base = textureLod(uNoise, vec3(q.x, alt * 1.3, q.z) / 7600.0 + vec3(0.0, uCloud.y, 0.0), 0.0).r;
  float th = mix(NOISE_HI, NOISE_LO, cov);
  float d = smoothstep(th, th + 0.11, mix(NOISE_LO * 0.6, base, profile));
  d *= profile;
  if (cheap < 0.5 && d > 0.0) {
    float det = textureLod(uNoise, vec3(q.x, alt, q.z) / 1500.0 - vec3(0.0, uCloud.y * 3.0, 0.0), 0.0).g;
    float e = det * uCloud.w * (1.0 - d * 0.75);
    d = clamp((d - e) / (1.0 - e), 0.0, 1.0);
  }
  return d * uCloud.z;
}
// Sunlight left after passing through the cloud layer above a point near the ground.
float cloudShadow(vec3 p, vec3 sun) {
  float sy = max(sun.y, 0.07);
  float a = 0.0;
  for (int i = 0; i < 2; i++) {
    float alt = mix(CLOUD_BASE, CLOUD_TOP, 0.22 + 0.3 * float(i));
    a += cloudDensity(p + sun * ((alt - p.y) / sy), alt, 1.0);
  }
  return exp(-a / uCloud.z * 4.5);
}`;

const DOME_LOOKUP = `
vec2 domeUV(vec3 d) {
  return 0.5 + 0.5 * d.xz / ((1.0 + max(d.y, -0.2)) * ${DOME_SCALE.toFixed(3)});
}`;

const HG = `
float hg(float mu, float g) { float gg = g * g; return (1.0 - gg) / (4.0 * 3.14159265 * pow(max(1.0 + gg - 2.0 * g * mu, 1e-4), 1.5)); }`;

const VIEW_RAY = `
uniform vec3 uForward, uRight, uUp, uCamPos;
uniform vec2 uTan;
uniform vec2 uNearFar;
float viewDepth(float depth) {
  return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - (depth * 2.0 - 1.0) * (uNearFar.y - uNearFar.x));
}`;

// ---------------------------------------------------------------------------- noise volume

// One slice of the tileable 3D noise the clouds are carved from (rendered once at start-up).
// Technique: gradient ("Perlin") noise re-shaped by inverted cellular ("Worley") noise, as in
// Schneider & Vos, "The Real-time Volumetric Cloudscapes of Horizon Zero Dawn" (SIGGRAPH 2015).
export const NOISE_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform float uSlice;
out vec4 outColor;
vec3 hash33(vec3 p) {
  uvec3 q = uvec3(ivec3(p)) * uvec3(1597334673u, 3812015801u, 2798796415u);
  q = (q.x ^ q.y ^ q.z) * uvec3(1597334673u, 3812015801u, 2798796415u);
  return -1.0 + 2.0 * vec3(q) * (1.0 / 4294967295.0);
}
float gnoise(vec3 x, float freq) {
  vec3 p = floor(x), w = fract(x);
  vec3 u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  float n[8];
  for (int i = 0; i < 8; i++) {
    vec3 o = vec3(float(i & 1), float((i >> 1) & 1), float((i >> 2) & 1));
    n[i] = dot(hash33(mod(p + o, freq)), w - o);
  }
  return mix(mix(mix(n[0], n[1], u.x), mix(n[2], n[3], u.x), u.y), mix(mix(n[4], n[5], u.x), mix(n[6], n[7], u.x), u.y), u.z);
}
float worley(vec3 uv, float freq) {
  uv *= freq;
  vec3 id = floor(uv), p = fract(uv);
  float md = 1e4;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 f = hash33(mod(id + o, freq)) * 0.5 + 0.5 + o;
    vec3 d = p - f;
    md = min(md, dot(d, d));
  }
  return 1.0 - min(md, 1.0);
}
float perlinFbm(vec3 p, float freq, int octaves) {
  float amp = 1.0, n = 0.0, norm = 0.0;
  for (int i = 0; i < octaves; i++) { n += amp * gnoise(p * freq, freq); norm += amp; freq *= 2.0; amp *= 0.5; }
  return n / norm;
}
float worleyFbm(vec3 p, float freq) {
  return worley(p, freq) * 0.625 + worley(p, freq * 2.0) * 0.25 + worley(p, freq * 4.0) * 0.125;
}
void main() {
  vec3 p = vec3(vNdc * 0.5 + 0.5, uSlice);
  float billow = abs(perlinFbm(p, 4.0, 4)) * 2.2;
  float cells = worleyFbm(p, 4.0);
  float base = clamp(cells + billow * (1.0 - cells), 0.0, 1.0);
  float detail = worleyFbm(p, 6.0) * 0.6 + worley(p, 24.0) * 0.4;
  float weather = perlinFbm(p, 2.0, 3) * 1.4 + 0.5;
  outColor = vec4(base, detail, clamp(weather, 0.0, 1.0), cells);
}`;

// ---------------------------------------------------------------------------- sky dome

// Atmosphere + raymarched clouds for every direction of the upper hemisphere. rgb = radiance,
// a = how much of what lies behind the clouds still shows (1 = clear sky).
export const domeFS = (defs) => `#version 300 es
precision highp float;
${defs}
#define NOISE_LO uNoiseRange.x
#define NOISE_HI uNoiseRange.y
uniform vec2 uNoiseRange;
in vec2 vNdc;
uniform vec3 uSunDir, uSunE, uSkyAmb, uCamPos;
uniform float uISun;
uniform int uSteps;
uniform sampler2D uPrev;   // the dome as it was a moment ago
uniform float uBlend;      // share of this render in the result (1 = no history)
uniform float uSeed;
out vec4 outColor;
${ATMOSPHERE}
${CLOUDS}
${HG}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 p = vNdc * ${DOME_SCALE.toFixed(3)};
  float r2 = dot(p, p);
  vec3 d = vec3(2.0 * p.x, 1.0 - r2, 2.0 * p.y) / (1.0 + r2);
  vec3 sky = atmosphere(d, uSunDir, uISun);
  float T = 1.0;
  vec3 L = vec3(0.0);
  if (d.y > 0.012) {
    float b = R_PLANET * d.y;
    float c0 = 2.0 * R_PLANET * CLOUD_BASE + CLOUD_BASE * CLOUD_BASE;
    float c1 = 2.0 * R_PLANET * CLOUD_TOP + CLOUD_TOP * CLOUD_TOP;
    float t0 = c0 / (b + sqrt(b * b + c0));
    float t1 = c1 / (b + sqrt(b * b + c1));
    float fade = 1.0 - smoothstep(26000.0, 52000.0, t0);
    if (fade > 0.0) {
      float n = float(uSteps);
      float dt = (t1 - t0) / n;
      float jitter = hash12(gl_FragCoord.xy + uSeed * 17.13);
      float mu = dot(d, uSunDir);
      float flat2 = dot(d.xz, d.xz) / (2.0 * R_PLANET);
      float tMean = 0.0, wSum = 0.0;
      for (int i = 0; i < 48; i++) {
        if (i >= uSteps || T < 0.02) break;
        float t = t0 + dt * (float(i) + jitter);
        vec3 pos = uCamPos + d * t;
        float alt = pos.y + flat2 * t * t;
        float dens = cloudDensity(pos, alt, 0.0);
        if (dens > 1e-5) {
          // how much cloud lies between this point and the sun
          float tau = 0.0, ls = 70.0;
          vec3 lp = pos;
          float la = alt;
          for (int j = 0; j < 5; j++) {
            lp += uSunDir * ls;
            la += uSunDir.y * ls;
            tau += cloudDensity(lp, la, 1.0) * ls;
            ls *= 1.8;
          }
          // direct light plus two cheaper "octaves" standing in for light scattered many times
          float sunL = 0.0, a = 1.0, e = 1.0, g = 1.0;
          for (int k = 0; k < 3; k++) {
            sunL += a * mix(hg(mu, 0.8 * g), hg(mu, -0.25 * g), 0.3) * exp(-tau * e);
            a *= 0.55; e *= 0.35; g *= 0.5;
          }
          float hN = clamp((alt - CLOUD_BASE) / (CLOUD_TOP - CLOUD_BASE), 0.0, 1.0);
          vec3 S = uSunE * sunL * 5.2 + uSkyAmb * (0.35 + 0.75 * hN);
          float stepT = exp(-dens * dt);
          float w = T * (1.0 - stepT);
          L += w * S;
          tMean += w * t;
          wSum += w;
          T *= stepT;
        }
      }
      // distant cloud sinks into the haze
      float tm = wSum > 0.0 ? tMean / wSum : t0;
      float clear = exp(-tm * 3.2e-5) * fade;
      T = mix(1.0, T, fade);
      L = mix(sky * (1.0 - T), L * fade, clear);
    }
  }
  // each refresh starts its march at a different offset; averaging over a few refreshes removes
  // the grain that a low step count would leave (clouds move far too slowly for this to smear)
  vec4 cur = vec4(sky * T + L, T);
  if (uBlend < 1.0) {
    vec4 prev = texture(uPrev, vNdc * 0.5 + 0.5);
    cur = mix(vec4(DEC(prev.rgb), prev.a), cur, uBlend);
  }
  outColor = vec4(ENC(cur.rgb), cur.a);
}`;

// ---------------------------------------------------------------------------- scene

export const LIT_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNor;
layout(location=2) in vec3 aCol;
layout(location=3) in vec2 aMR;
layout(location=4) in vec2 aUV;
layout(location=5) in vec4 aI0;
layout(location=6) in vec4 aI1;
layout(location=7) in vec4 aI2;
layout(location=8) in vec4 aI3;
uniform mat4 uModel, uViewProj, uLightVP;
uniform float uInstanced;
uniform float uTerrain;       // 1: the terrain grid, displaced by the relief and the ruts
uniform vec3 uCamPos;
uniform sampler2D uDeform;    // RG: height change (m), marks; a window that wraps round (toroidal)
uniform vec4 uDeformWin;      // window x0, z0, size (m), 1 / size
out vec3 vWorld; out vec3 vNor; out vec3 vCol; out vec2 vMR; out vec2 vUV; out vec4 vShadow; out vec3 vLocal;
${RELIEF_GLSL}
float deformAt(vec2 p) {
  vec2 q = p - uDeformWin.xy;
  if (q.x < 0.0 || q.y < 0.0 || q.x >= uDeformWin.z || q.y >= uDeformWin.z) return 0.0;
  return textureLod(uDeform, p * uDeformWin.w + 0.5 / ${DEFORM_TEX}.0, 0.0).r;
}
float groundAt(vec2 p) { return relief(p) + deformAt(p); }
void main() {
  mat4 model = uModel;
  if (uInstanced > 0.5) model = uModel * mat4(aI0, aI1, aI2, aI3);
  vec4 w = model * vec4(aPos, 1.0);
  vec3 nor = mat3(model) * aNor;
  if (uTerrain > 0.5) {
    vec2 p = w.xz;
    // finite differences, wider far away where the grid is coarse
    float e = clamp(length(p - uCamPos.xz) * 0.006, 0.07, 2.0);
    w.y = groundAt(p);
    float hx = groundAt(p + vec2(e, 0.0)) - groundAt(p - vec2(e, 0.0));
    float hz = groundAt(p + vec2(0.0, e)) - groundAt(p - vec2(0.0, e));
    nor = normalize(vec3(-hx, 2.0 * e, -hz));
  }
  vWorld = w.xyz;
  vLocal = aPos;
  vNor = nor;
  vCol = aCol; vMR = aMR; vUV = aUV;
  vShadow = uLightVP * w;
  gl_Position = uViewProj * w;
}`;

export const litFS = (defs) => `#version 300 es
precision highp float;
precision highp sampler2DShadow;
${defs}
#define NOISE_LO uNoiseRange.x
#define NOISE_HI uNoiseRange.y
uniform vec2 uNoiseRange;
in vec3 vWorld; in vec3 vNor; in vec3 vCol; in vec2 vMR; in vec2 vUV; in vec4 vShadow; in vec3 vLocal;
uniform vec3 uCamPos, uSunDir, uSunColor, uSkyColor, uGroundColor, uMud;
uniform float uScroll, uAlpha, uDirtHeight, uWet;
uniform int uKind;            // 0 painted solid, 1 track band, 2 ground, 3 plain (interior parts), 4 textured board,
                              // 5 track link / bare running gear, 6 see-through shell (interior view), 7 water,
                              // 8 foliage, 9 textured model (colour map in uTex), 10 hit-camera x-ray shell
uniform vec4 uHighlight;      // rgb + strength: the hit camera's damaged (yellow) / destroyed (red) parts
uniform sampler2DShadow uShadowMap;
uniform sampler2D uTex;
uniform highp sampler2D uArmor; // protection analysis: 4 texels per plate (see Renderer.setArmor)
uniform int uArmorN;
uniform vec4 uArmorShell;       // pen mm, normalization deg, ricochet deg, calibre mm
uniform float uArmorChem;
uniform sampler2D uNormTex;     // the textured model's normal map (tangent space), when uNormOn
uniform float uNormOn;
uniform sampler2D uDome;
uniform vec4 uZoneRect[${MAX_ZONES}];
uniform vec4 uZoneColor[${MAX_ZONES}];   // rgb + edge softness (m)
uniform int uZoneCount;
uniform vec4 uRoad;           // xmin, zmin, xmax, zmax of the range road (distance ticks)
uniform float uTerrain;
uniform sampler2D uDeform;
uniform vec4 uDeformWin;
uniform vec4 uHole;           // the flat far ground is cut away where the terrain grid lies
out vec4 outColor;
${CLOUDS}
${DOME_LOOKUP}
uniform float uClock;
${RELIEF_GLSL}

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// Bump mapping from a height value without texture coordinates (Mikkelsen 2010).
vec3 bump(vec3 N, vec3 p, float h, float strength) {
  vec3 dpdx = dFdx(p), dpdy = dFdy(p);
  float dhdx = dFdx(h), dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, N), r2 = cross(N, dpdx);
  float det = dot(dpdx, r1);
  vec3 g = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * N - strength * g);
}

float shadow() {
  vec3 p = vShadow.xyz / vShadow.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float t = 1.0 / ${SHADOW_SIZE}.0, s = 0.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++)
    s += texture(uShadowMap, vec3(p.xy + vec2(x, y) * t * 1.3, p.z - 0.0022));
  return s / 9.0;
}

void main() {
  vec3 V = normalize(uCamPos - vWorld);
  vec3 N = normalize(vNor);
  if (dot(N, V) < 0.0) N = -N;
  vec3 albedo = vCol; float rough = vMR.x; float metal = vMR.y;
  float dist = length(uCamPos - vWorld);

  float ao = 1.0;
  float wdepth = 0.0;
  // interior parts are untextured (a white texel) except the crew figures with their colour map
  if (uKind == 3) albedo *= pow(texture(uTex, vUV).rgb, vec3(2.2));
  if (uKind == 0) {
    // Painted armour plate: uneven faded paint over rolled steel with a fine surface grain, dust
    // on what faces up, rain streaks down the sides and mud thrown up from below.
    float n = fbm(vUV * 2.6);
    float fine = vnoise(vUV * 38.0);
    float near = smoothstep(70.0, 12.0, dist);
    float grain = noise3(vLocal * 60.0);
    albedo *= 0.80 + 0.34 * n;
    float up = smoothstep(0.55, 0.95, N.y);
    float side = 1.0 - abs(N.y);
    float streak = smoothstep(0.5, 0.92, vnoise(vec2((vLocal.x + vLocal.z) * 7.0, vLocal.y * 0.8))) * side;
    albedo = mix(albedo, albedo * 0.6, streak * 0.45);
    albedo = mix(albedo, uMud * 1.5 + 0.03, up * (0.18 + 0.3 * n));
    // Wear: no pitting or speckle. Paint thins to a slightly darker, glossier tone in broad
    // patches (where crews climb and brush scrapes), with a little rust low on the hull.
    float worn = smoothstep(0.55, 0.85, noise3(vLocal * 1.7 + 11.0)) * near;
    float low = 1.0 - smoothstep(0.4, 1.3, vWorld.y);
    albedo = mix(albedo, albedo * 0.82, worn * 0.5);
    float rust = smoothstep(0.62, 0.9, noise3(vLocal * 3.1 + 4.0)) * low * 0.35;
    albedo = mix(albedo, vec3(0.15, 0.085, 0.05), rust);
    rough = clamp(rough + (n - 0.5) * 0.24 + (fine - 0.5) * 0.06 - worn * 0.12 + rust * 0.2, 0.2, 1.0);
    float dirt = smoothstep(uDirtHeight, uDirtHeight * 0.15, vWorld.y) * (0.3 + 0.7 * n);
    albedo = mix(albedo, uMud * (0.65 + 0.5 * fine), dirt * 0.6);
    rough = clamp(rough + dirt * 0.25 + up * 0.1, 0.2, 1.0);
    metal *= 1.0 - dirt * 0.7;
    N = bump(N, vWorld, grain * 0.0009 * near, 1.0);
    ao = mix(0.62, 1.0, smoothstep(0.2, 1.25, vWorld.y)) * mix(0.8, 1.0, n);
  } else if (uKind == 1) {
    float u = fract(vUV.x + uScroll);
    float gap = smoothstep(0.0, 0.07, u) * smoothstep(1.0, 0.93, u);
    float bar = smoothstep(0.30, 0.38, u) * smoothstep(0.70, 0.62, u);
    float edge = smoothstep(0.0, 0.10, vUV.y) * smoothstep(1.0, 0.90, vUV.y);
    float guide = smoothstep(0.06, 0.03, abs(vUV.y - 0.5));
    albedo *= mix(0.22, 1.0, gap) * (0.72 + 0.5 * bar) * mix(0.65, 1.0, edge) * (1.0 + 0.3 * guide * bar);
    albedo = mix(albedo, uMud, 0.35 * vnoise(vUV * vec2(3.0, 9.0)));
    rough = 0.62;
  } else if (uKind == 5) {
    // Running gear in bare metal: dark oxidised steel, polished where it rubs (wheel path,
    // grouser faces, sprocket teeth), brown rust in the recesses, and whatever the ground is made
    // of pressed into it. vUV.x = wear (0 recess .. 1 contact face), vUV.y = how much mud it holds.
    float n = noise3(vLocal * 38.0);
    float n2 = noise3(vWorld * 2.6);
    float near = smoothstep(60.0, 10.0, dist);
    vec3 oxide = vec3(0.055, 0.047, 0.042) * (0.75 + 0.5 * n);
    vec3 rust = vec3(0.115, 0.064, 0.036) * (0.7 + 0.6 * n);
    vec3 steel = vec3(0.33, 0.32, 0.30);
    float wear = smoothstep(0.55, 0.95, vUV.x + (n - 0.5) * 0.35);
    albedo = mix(mix(oxide, rust, smoothstep(0.35, 0.75, n2) * (1.0 - vUV.x) * 0.9), steel, wear);
    metal = mix(0.35, 0.95, wear);
    rough = mix(0.8, 0.3, wear) + (n - 0.5) * 0.12;
    float mud = clamp(vUV.y * (0.25 + 0.9 * n2) * uWet, 0.0, 1.0);
    albedo = mix(albedo, uMud * (0.7 + 0.5 * n), mud);
    metal *= 1.0 - mud;
    rough = clamp(mix(rough, 0.93, mud), 0.2, 1.0);
    N = bump(N, vWorld, n * 0.0022 * near, 1.0);
  } else if (uKind == 2) {
    vec2 p = vWorld.xz;
    float big = fbm(p * 0.035);
    float mid = fbm(p * 0.45);
    float fine = vnoise(p * 6.0) * smoothstep(120.0, 10.0, dist);
    // dry late-summer grass: straw and ochre with some green left in the low patches
    vec3 grass = mix(vec3(0.115, 0.135, 0.045), vec3(0.330, 0.245, 0.075), smoothstep(0.25, 0.75, big));
    grass = mix(grass, vec3(0.42, 0.33, 0.12), smoothstep(0.55, 0.8, mid) * 0.5);
    albedo = grass * (0.78 + 0.4 * mid) * (0.9 + 0.22 * fine);
    if (uMapOn > 0.5) {
      // battle map: the drawn ground colours, varied like the grass; wet and dark at the waterline
      // and on the beds of the sea, the river and the lakes
      vec2 uvm = (p - uMapRect.xy) / uMapRect.z;
      vec3 mc = pow(texture(uMapC, uvm).rgb, vec3(2.2));
      albedo = mix(mc, grass, 0.18) * (0.8 + 0.38 * mid) * (0.9 + 0.22 * fine);
      float hg = mapHeight(p);
      albedo = mix(albedo, albedo * 0.5 + vec3(0.01, 0.012, 0.01), smoothstep(0.45, -0.15, hg));
    }
    for (int i = 0; i < ${MAX_ZONES}; i++) {
      if (i >= uZoneCount) break;
      vec4 r = uZoneRect[i];
      vec2 d = max(r.xy - p, p - r.zw);
      float soft = uZoneColor[i].a;
      float e = max(d.x, d.y) + (mid - 0.5) * soft * 3.0;
      float m = smoothstep(soft + 0.05, -soft - 0.05, e);
      albedo = mix(albedo, uZoneColor[i].rgb * (0.8 + 0.4 * mid) * (0.92 + 0.16 * fine), m);
    }
    if (p.x > uRoad.x && p.x < uRoad.z && p.y > uRoad.y && p.y < uRoad.w) {
      float zz = abs(mod(p.y + 50.0, 100.0) - 50.0);
      float tick = smoothstep(0.35, 0.2, zz) * step(40.0, p.y);
      albedo = mix(albedo, vec3(0.62, 0.60, 0.52), tick * 0.8);
    }
    rough = 0.96; metal = 0.0;
    if (uTerrain < 0.5) {
      // the flat far ground: cut away where the terrain grid is drawn
      if (p.x > uHole.x && p.x < uHole.z && p.y > uHole.y && p.y < uHole.w) discard;
    } else {
      vec2 q = p - uDeformWin.xy;
      if (q.x >= 0.0 && q.y >= 0.0 && q.x < uDeformWin.z && q.y < uDeformWin.z) {
        float tx = 1.0 / ${DEFORM_TEX}.0;
        vec2 uv = p * uDeformWin.w + 0.5 * tx;
        vec2 dm = texture(uDeform, uv).rg;
        // the rut's own shape at full texture resolution (the grid is coarser than a rut wall)
        float hx = texture(uDeform, uv + vec2(tx, 0.0)).r - texture(uDeform, uv - vec2(tx, 0.0)).r;
        float hz = texture(uDeform, uv + vec2(0.0, tx)).r - texture(uDeform, uv - vec2(0.0, tx)).r;
        float span = 2.0 * uDeformWin.z * tx;
        N = normalize(N + vec3(-hx / span, 0.0, -hz / span) * smoothstep(80.0, 20.0, dist));
        // marks: scuffed, polished tread prints on hard ground; dark churned soil in a rut
        float rut = smoothstep(-0.005, -0.04, dm.r);
        float mk = clamp(dm.g, 0.0, 1.0);
        vec3 churned = uMud * (0.75 + 0.35 * mid);
        albedo = mix(albedo, mix(albedo * 0.6, churned, rut), mk);
        rough = mix(rough, mix(0.7, 0.9, rut), mk * 0.6);
        // the berms beside a rut are fresh, lighter soil
        albedo *= 1.0 + 0.25 * smoothstep(0.004, 0.03, dm.r);
      }
    }
  } else if (uKind == 7) {
    // water: dark and clear in the shallows, deep blue-green further out; the waves are two
    // drifting noise layers that bend the normal (reflections and sun glitter come from it)
    vec2 p = vWorld.xz;
    wdepth = uMapOn > 0.5 ? max(0.0, -mapHeight(p)) : 6.0;
    vec2 q1 = p * 0.16 + vec2(uClock * 0.045, uClock * 0.027);
    vec2 q2 = p * 0.62 - vec2(uClock * 0.08, -uClock * 0.05);
    float e = 0.3;
    float h0 = fbm(q1) + 0.45 * vnoise(q2);
    float hx = fbm(q1 + vec2(e, 0.0)) + 0.45 * vnoise(q2 + vec2(e * 3.9, 0.0));
    float hz = fbm(q1 + vec2(0.0, e)) + 0.45 * vnoise(q2 + vec2(0.0, e * 3.9));
    float fade = smoothstep(500.0, 30.0, dist);
    N = normalize(vec3(-(hx - h0) * 0.32 * fade, 1.0, -(hz - h0) * 0.32 * fade));
    albedo = mix(vec3(0.045, 0.085, 0.07), vec3(0.01, 0.032, 0.048), smoothstep(0.3, 5.0, wdepth));
    rough = 0.09; metal = 0.0;
  } else if (uKind == 11) {
    // buildings: limestone and plaster walls weathered by the rain, slate and tile roofs laid in
    // courses, concrete with its shuttering marks
    float n = fbm(vWorld.xz * 0.45 + vWorld.y * 0.6);
    float fine = vnoise(vec2(vWorld.x + vWorld.z, vWorld.y) * 7.0);
    float near = smoothstep(150.0, 15.0, dist);
    albedo = vCol * (0.8 + 0.32 * n) * (0.95 + 0.1 * fine * near);
    if (N.y > 0.3 && N.y < 0.98) {
      float course = smoothstep(0.0, 0.14, fract(vWorld.y * 3.4));
      float slate = vnoise(vec2((vWorld.x - vWorld.z) * 2.2, floor(vWorld.y * 3.4)));
      albedo *= mix(0.72, 1.0, course * near + (1.0 - near)) * (0.88 + 0.24 * slate);
      // moss and lichen on the north side of the roofs
      albedo = mix(albedo, vec3(0.09, 0.1, 0.05), smoothstep(0.3, 0.9, -N.z) * 0.3 * n);
    } else if (abs(N.y) < 0.3) {
      float streak = smoothstep(0.5, 0.9, vnoise(vec2((vWorld.x + vWorld.z) * 2.4, vWorld.y * 0.3)));
      albedo = mix(albedo, albedo * 0.68, streak * 0.4);
      // stone courses where the plaster has fallen
      float bare = smoothstep(0.62, 0.8, noise3(vWorld * 0.35));
      float joint = smoothstep(0.08, 0.0, abs(fract(vWorld.y * 3.0) - 0.5) - 0.42) * near;
      albedo = mix(albedo, albedo * vec3(0.85, 0.8, 0.72) * (1.0 - 0.35 * joint), bare);
    }
  } else if (uKind == 12) {
    // protection analysis on the vehicle's own surface: the plate nearest this point gives the
    // thickness and material, the surface's own angle to the camera gives the incidence
    float best = 1e9;
    int bi = -1;
    for (int i = 0; i < 512; i++) {
      if (i >= uArmorN) break;
      vec4 pa = texelFetch(uArmor, ivec2(0, i), 0);
      vec4 pn = texelFetch(uArmor, ivec2(1, i), 0);
      vec4 pu = texelFetch(uArmor, ivec2(2, i), 0);
      vec4 pv = texelFetch(uArmor, ivec2(3, i), 0);
      vec3 r = vWorld - pa.xyz;
      float du = max(abs(dot(r, pu.xyz)) - pu.w, 0.0);
      float dv = max(abs(dot(r, pv.xyz)) - pv.w, 0.0);
      float d = abs(dot(r, pn.xyz)) + 1.5 * length(vec2(du, dv));
      if (d < best) { best = d; bi = i; }
    }
    albedo = vec3(0.16, 0.17, 0.18);
    if (bi >= 0 && best < 0.5) {
      vec4 pa = texelFetch(uArmor, ivec2(0, bi), 0);
      vec4 pn = texelFetch(uArmor, ivec2(1, bi), 0);
      float inc = degrees(acos(clamp(abs(dot(V, N)), 0.0, 1.0)));
      float eff = uArmorChem > 0.5 ? inc : max(inc - uArmorShell.y, 0.0);
      float need = pa.w / max(cos(radians(eff)), 0.01) * pn.w;
      bool over = uArmorChem < 0.5 && uArmorShell.w >= 3.0 * pa.w;
      if (!over && inc >= uArmorShell.z) albedo = vec3(0.16, 0.3, 0.6);
      // War Thunder's colours: green goes through, yellow is close, red stops it
      else if (uArmorShell.x >= need * 1.1) albedo = vec3(0.03, 0.45, 0.06);
      else if (uArmorShell.x >= need * 0.9) albedo = vec3(0.93, 0.45, 0.012);
      else albedo = vec3(0.85, 0.035, 0.012);
    }
    rough = 0.75; metal = 0.0;
  } else if (uKind == 8) {
    // foliage: vertex colour with patchy light and dark leaves
    albedo = vCol * (0.78 + 0.38 * noise3(vWorld * 0.9)) * (0.9 + 0.2 * vnoise(vWorld.xz * 0.05));
    rough = 0.86; metal = 0.0;
  } else if (uKind == 9) {
    // a textured model (an imported vehicle or figure): its colour map, the painted-steel dust
    albedo = pow(texture(uTex, vUV).rgb, vec3(2.2)) * vCol;
    if (uNormOn > 0.5) {
      // the model's normal map, on a tangent frame worked out from the screen-space change of
      // position and texture coordinate (no tangents stored)
      vec3 tn = texture(uNormTex, vUV).xyz * 2.0 - 1.0;
      vec3 dp1 = dFdx(vWorld), dp2 = dFdy(vWorld);
      vec2 du1 = dFdx(vUV), du2 = dFdy(vUV);
      vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
      vec3 T = dp2perp * du1.x + dp1perp * du2.x;
      vec3 B = dp2perp * du1.y + dp1perp * du2.y;
      float im = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-20));
      N = normalize(mat3(T * im, B * im, N) * vec3(tn.xy * smoothstep(80.0, 8.0, dist), tn.z));
    }
    float n9 = fbm(vWorld.xz * 2.1 + vWorld.y);
    float up9 = smoothstep(0.55, 0.95, N.y);
    albedo = mix(albedo, uMud * 1.4 + 0.03, up9 * (0.08 + 0.12 * n9));
    float dirt9 = smoothstep(uDirtHeight, uDirtHeight * 0.15, vWorld.y) * (0.3 + 0.7 * n9);
    albedo = mix(albedo, uMud * 0.8, dirt9 * 0.45);
  } else if (uKind == 4) {
    albedo = pow(texture(uTex, vUV).rgb, vec3(2.2));
    rough = 0.9; metal = 0.0;
  } else if (uKind == 6) {
    albedo = mix(vec3(0.5, 0.6, 0.66), vCol, 0.3);
    rough = 0.3; metal = 0.0;
  }

  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + V);
  float NoL = max(dot(N, L), 0.0), NoV = max(dot(N, V), 1e-3), NoH = max(dot(N, H), 0.0), VoH = max(dot(V, H), 0.0);
  float a = rough * rough, a2 = a * a;
  float dd = NoH * NoH * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * dd * dd);
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = (NoL / (NoL * (1.0 - k) + k)) * (NoV / (NoV * (1.0 - k) + k));
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VoH, 5.0);
  vec3 spec = min(D * G * F / (4.0 * NoL * NoV + 1e-4), vec3(24.0));
  vec3 kd = (1.0 - F) * (1.0 - metal);
  float sh = shadow() * cloudShadow(vWorld, L);
  vec3 direct = (kd * albedo / 3.14159 + spec) * uSunColor * NoL * sh;

  float hemi = N.y * 0.5 + 0.5;
  vec3 amb = mix(uGroundColor, uSkyColor, hemi) * albedo * (1.0 - metal * 0.5) * ao;
  vec3 Rr = reflect(-V, N);
  vec3 envSoft = mix(uGroundColor, uSkyColor, smoothstep(-0.2, 0.45, Rr.y));
  vec3 envSharp = mix(uGroundColor, DEC(textureLod(uDome, domeUV(Rr), 0.0).rgb), smoothstep(-0.05, 0.05, Rr.y));
  vec3 env = mix(envSharp, envSoft, clamp(rough * 1.7, 0.0, 1.0));
  vec3 Fr = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - NoV, 5.0);
  vec3 col = direct + amb + env * Fr * (1.0 - rough * 0.6) * ao;
  float alpha = uAlpha;
  if (uKind == 12) {
    // flat, even colour so the verdict reads from every side
    col = mix(col, albedo * (uSkyColor * 1.6 + 0.55), 0.6);
  } else if (uKind == 3) {
    // parts inside the hull get a fill light so they read through the shell
    col += albedo * (uSkyColor * 1.4 + uSunColor * 0.035) * (1.0 - metal * 0.4);
  } else if (uKind == 7) {
    // more water shows its reflection the flatter it is seen; the shallows let the bed through,
    // with a little foam where it laps the shore
    float rim7 = pow(1.0 - NoV, 4.0);
    alpha = clamp(mix(0.32, 0.9, smoothstep(0.0, 2.2, wdepth)) + rim7 * 0.6, 0.0, 0.97);
    float foam = smoothstep(0.22, 0.0, wdepth) * (0.5 + 0.5 * vnoise(vWorld.xz * 1.3 + uClock * 0.3));
    col = mix(col, (uSkyColor * 1.5 + uSunColor * 0.06) * 0.9, foam * 0.55);
    alpha = max(alpha, foam * 0.7);
  } else if (uKind == 6) {
    // glass-like shell: nearly clear face-on, visible along its outlines
    float rim = pow(1.0 - NoV, 2.2);
    alpha = mix(0.06, 0.62, rim);
    col = mix(col * 0.6, uSkyColor * 2.2 + uSunColor * 0.03, rim * 0.6);
  } else if (uKind == 10) {
    // the hit camera's x-ray: a dark smoked hull, its outline picked out in light
    float rim = pow(1.0 - NoV, 2.0);
    alpha = mix(0.38, 0.95, rim);
    col = mix(vec3(0.02, 0.022, 0.026) + albedo * 0.04, vec3(1.4, 1.45, 1.5), rim * 0.85);
  }
  if (uHighlight.a > 0.0) {
    // lit from within: damaged and destroyed parts glow in their colour
    col = mix(col, uHighlight.rgb * (uSkyColor * 2.5 + 0.6), uHighlight.a);
  }
  outColor = vec4(ENC(col), alpha);
}`;

export const DEPTH_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=5) in vec4 aI0;
layout(location=6) in vec4 aI1;
layout(location=7) in vec4 aI2;
layout(location=8) in vec4 aI3;
uniform mat4 uModel, uLightVP;
uniform float uInstanced;
void main() {
  mat4 model = uModel;
  if (uInstanced > 0.5) model = uModel * mat4(aI0, aI1, aI2, aI3);
  gl_Position = uLightVP * model * vec4(aPos, 1.0);
}`;
export const DEPTH_FS = `#version 300 es
precision highp float;
void main() {}`;

export const SKY_VS = FULLSCREEN_VS;

// Background: the dome (cross-faded between two refreshes) plus the sun's disc behind the clouds.
export const skyFS = (defs) => `#version 300 es
precision highp float;
${defs}
in vec2 vNdc;
uniform vec3 uForward, uRight, uUp, uSunDir, uSunE;
uniform vec2 uTan;
uniform sampler2D uDomeA, uDomeB;
uniform float uDomeMix;
out vec4 outColor;
${DOME_LOOKUP}
void main() {
  vec3 d = normalize(uForward + uRight * vNdc.x * uTan.x + uUp * vNdc.y * uTan.y);
  vec2 uv = domeUV(d);
  vec4 a = texture(uDomeA, uv), b = texture(uDomeB, uv);
  vec3 col = mix(DEC(a.rgb), DEC(b.rgb), uDomeMix);
  float T = mix(a.a, b.a, uDomeMix);
  float ang = length(cross(d, uSunDir));
  float front = step(0.0, dot(d, uSunDir)) * step(0.0, d.y);
  float disc = smoothstep(0.0056, 0.0042, ang);
  // glare of the lens / eye around the disc
  float glare = 1.6 * exp(-ang * ang / (2.0 * 0.011 * 0.011)) + 0.16 * exp(-ang / 0.05);
  col += uSunE * ((60.0 * disc + glare) * front * T * T * T);
  outColor = vec4(ENC(col), 1.0);
}`;

export const FX_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in vec4 aCol;
uniform mat4 uViewProj;
out vec2 vUV; out vec4 vCol;
void main() { vUV = aUV; vCol = aCol; gl_Position = uViewProj * vec4(aPos, 1.0); }`;

// Billboards. Smoke and dust are lit by the sun and sky (uGain); flashes and tracers emit.
export const fxFS = (defs) => `#version 300 es
precision highp float;
${defs}
in vec2 vUV; in vec4 vCol;
uniform vec3 uGain;
out vec4 outColor;
void main() {
  float a;
  if (vUV.y > 1.5) { a = 1.0 - abs(vUV.x); a *= a; }
  else { float d = length(vUV); a = smoothstep(1.0, 0.0, d); a *= a; }
  outColor = vec4(ENC(pow(vCol.rgb, vec3(2.2)) * uGain), vCol.a * a);
}`;

// Soft particles, drawn after the scene is resolved into a target without a depth attachment so
// the scene depth can be read: each fragment fades out as it nears whatever stands behind it
// (no hard slice where a puff meets the ground or a hull) and is dropped where something stands
// in front. Smoke is shaped by the cloud noise volume -- a billowy body that thins and frays as it
// ages -- and lit as a lumpy ball: a fake normal from the quad gives a sun side and a shadow side,
// thick parts shade deeper, thin edges glow when the sun is behind the smoke. Flashes and fire
// are additive and only flicker with the noise.
export const FX_SOFT_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in vec4 aCol;
layout(location=3) in vec4 aX;   // seed, life fraction, size, spare
uniform mat4 uViewProj;
out vec2 vUV; out vec4 vCol; out vec4 vX; out float vDepth; out vec3 vWorld;
void main() {
  vUV = aUV; vCol = aCol; vX = aX; vWorld = aPos;
  gl_Position = uViewProj * vec4(aPos, 1.0);
  vDepth = gl_Position.w;
}`;

export const fxSoftFS = (defs) => `#version 300 es
precision highp float;
precision highp sampler3D;
${defs}
in vec2 vUV; in vec4 vCol; in vec4 vX; in float vDepth; in vec3 vWorld;
uniform sampler2D uDepth;
uniform float uLayer;         // 1: drawn into the effects layer, fogged here at the puff's own range
uniform vec2 uFog;
uniform vec3 uCamPos, uHaze;
uniform sampler3D uNoise;
uniform vec2 uNoiseRange;
uniform vec2 uNearFar;
uniform vec2 uInvSize;
uniform vec3 uAmb, uSun;      // sky and sun light reaching the smoke
uniform vec3 uSunCam;         // sun direction in the camera frame: right, up, towards the viewer
uniform float uAdditive;
uniform float uClock;
out vec4 outColor;
float viewDepth(float depth) {
  return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - (depth * 2.0 - 1.0) * (uNearFar.y - uNearFar.x));
}
// the composite's height fog, from the camera to this point
float fogT(vec3 p) {
  vec3 r = p - uCamPos;
  float dist = length(r);
  float k = (r.y / max(dist, 1e-4)) / uFog.y;
  float span = abs(k * dist) > 1e-4 ? (1.0 - exp(-k * dist)) / k : dist;
  return exp(-uFog.x * exp(-uCamPos.y / uFog.y) * span);
}
void main() {
  float d2 = dot(vUV, vUV);
  if (d2 >= 1.0) discard;
  float raw = texture(uDepth, gl_FragCoord.xy * uInvSize).r;
  float gap = raw >= 1.0 ? 1e4 : viewDepth(raw) - vDepth;
  // the fade distance grows with the puff, so a big cloud blends into the ground over metres
  float feather = clamp(vX.z * 0.5, 0.08, 3.5);
  float soft = clamp(gap / feather, 0.0, 1.0);
  if (soft <= 0.0) discard;
  float seed = vX.x, t = vX.y;
  // two octaves of the noise volume; bigger puffs get more lumps across them
  float f = 0.3 + 0.12 * min(vX.z, 5.0);
  vec3 nc = vec3(vUV * f + seed * vec2(17.3, 5.9), seed * 3.7 + t * 0.35 + uClock * 0.01);
  vec4 nz = texture(uNoise, nc);
  float n = clamp((nz.r - uNoiseRange.x) / max(uNoiseRange.y - uNoiseRange.x, 1e-3), 0.0, 1.0);
  n = clamp(n * 0.7 + texture(uNoise, nc * 2.7 + 0.37).g * 0.45 - 0.08, 0.0, 1.0);
  float body = 1.0 - d2;
  if (uAdditive > 0.5) {
    float a;
    vec3 c = pow(vCol.rgb, vec3(2.2));
    if (vX.z > 0.25) {
      // flame: a ragged tongue, white-hot inside, deeper red where it thins
      float heat = body * mix(0.25, 1.45, n);
      a = smoothstep(0.08, 0.6, heat);
      c *= mix(vec3(1.0, 0.45, 0.25), vec3(1.15, 1.05, 0.95), smoothstep(0.35, 1.0, heat));
    } else {
      a = smoothstep(1.0, 0.0, sqrt(d2));
      a *= a;
    }
    c *= 22.0;
    // a soft knee per card, so a deep stack of flame keeps its colours instead of burning white
    // (the reference's per-card tone cap)
    c /= 1.0 + 0.045 * max(c.r, max(c.g, c.b));
    if (uLayer > 0.5) c *= fogT(vWorld);
    outColor = vec4(ENC(c), vCol.a * a * soft);
    return;
  }
  // billow: noise lumps on a soft ball; the edge erodes away as the puff ages
  float dens = body * mix(0.3, 1.45, n);
  float a = smoothstep(0.06 + 0.25 * t, 0.7, dens);
  float th = clamp(dens, 0.0, 1.0);
  // lit across the card from the sun's side (lumps tilt it), brighter overall when the sun is
  // behind the viewer; with the sun behind the smoke its thin edges glow instead
  vec2 q = vUV + (vec2(nz.g, nz.b) - 0.5) * 0.6;
  float side = clamp(0.5 + 0.8 * dot(q, uSunCam.xy), 0.0, 1.0);
  float lambert = mix(side, 1.0, 0.25 + 0.25 * uSunCam.z);
  float shadow = mix(1.0, 0.5, th * (1.0 - side));
  float rim = pow(max(-uSunCam.z, 0.0), 3.0) * (1.0 - th) * 1.6;
  vec3 light = uAmb * (0.8 + 0.35 * (1.0 - th)) + uSun * (1.7 * lambert * shadow + rim);
  vec3 c = pow(vCol.rgb, vec3(2.2)) * light;
  if (uLayer > 0.5) {
    float T = fogT(vWorld);
    c = c * T + uHaze * (1.0 - T);
  }
  outColor = vec4(ENC(c), vCol.a * a * soft);
}`;

// ---------------------------------------------------------------------------- light shafts

// Half-size pass. r: the share of the haze along this view ray that the sun actually reaches
// (cloud shadows cut it into beams -- the Tyndall effect). g: shafts radiating from the sun's
// position on screen, blocked by clouds and by anything standing in front of the sky.
export const shaftsFS = (defs) => `#version 300 es
precision highp float;
${defs}
#define NOISE_LO uNoiseRange.x
#define NOISE_HI uNoiseRange.y
uniform vec2 uNoiseRange;
in vec2 vNdc;
uniform sampler2D uDepth;
uniform sampler2D uDome;
uniform vec3 uSunDir;
uniform vec2 uFog;        // extinction at ground level (1/m), scale height (m)
uniform vec2 uSunUV;
uniform float uSunFacing;
uniform int uSteps, uRaySteps;
out vec4 outColor;
${VIEW_RAY}
${CLOUDS}
${DOME_LOOKUP}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  vec2 uv = vNdc * 0.5 + 0.5;
  float depth = texture(uDepth, uv).r;
  vec3 ray = uForward + uRight * vNdc.x * uTan.x + uUp * vNdc.y * uTan.y;
  float rl = length(ray);
  vec3 d = ray / rl;
  float reach = depth >= 1.0 ? 9000.0 : min(viewDepth(depth) * rl, 9000.0);
  // above the haze layer there is nothing left to light up
  float ceilT = d.y > 1e-3 ? max((uFog.y * 5.0 - uCamPos.y) / d.y, 0.0) : 1e9;
  reach = min(reach, ceilT);
  float n = ign(gl_FragCoord.xy);
  float lit = 0.0, wsum = 0.0, tau = 0.0;
  float steps = float(uSteps);
  for (int i = 0; i < 24; i++) {
    if (i >= uSteps) break;
    float f0 = float(i) / steps, f1 = float(i + 1) / steps;
    float ta = reach * f0 * f0, tb = reach * f1 * f1;
    vec3 p = uCamPos + d * mix(ta, tb, n);
    float dens = exp(-max(p.y, 0.0) / uFog.y) * (tb - ta);
    float w = dens * exp(-tau * uFog.x);
    tau += dens;
    lit += cloudShadow(p, uSunDir) * w;
    wsum += w;
  }
  lit = wsum > 1e-6 ? lit / wsum : 1.0;

  float rays = 0.0;
  if (uSunFacing > 0.0 && uRaySteps > 0) {
    float rs = float(uRaySteps);
    vec2 delta = (uSunUV - uv) * (0.92 / rs);
    vec2 suv = uv + delta * n;
    float decay = 1.0;
    for (int i = 0; i < 32; i++) {
      if (i >= uRaySteps) break;
      suv += delta;
      vec2 q = suv * 2.0 - 1.0;
      vec3 sd = normalize(uForward + uRight * q.x * uTan.x + uUp * q.y * uTan.y);
      float m = pow(max(dot(sd, uSunDir), 0.0), 26.0);
      float t = textureLod(uDome, domeUV(sd), 0.0).a;
      m *= t * t;
      // sky just off the edge of the picture still counts, fading out with distance from it
      vec2 off = max(max(-suv, suv - 1.0), 0.0);
      float edge = 1.0 - smoothstep(0.0, 0.3, max(off.x, off.y));
      bool inside = off.x <= 0.0 && off.y <= 0.0;
      m *= inside ? step(1.0, textureLod(uDepth, suv, 0.0).r) : step(0.0, sd.y) * edge;
      rays += m * decay;
      decay *= 0.95;
    }
    rays = rays / rs * uSunFacing;
  }
  outColor = vec4(lit, clamp(rays, 0.0, 1.0), 0.0, 1.0);
}`;

// ---------------------------------------------------------------------------- bloom

export const bloomDownFS = (defs) => `#version 300 es
precision highp float;
${defs}
in vec2 vNdc;
uniform sampler2D uScene, uLayer;
uniform vec2 uTexel;
uniform float uThreshold;
out vec4 outColor;
void main() {
  vec2 uv = vNdc * 0.5 + 0.5;
  vec3 c = vec3(0.0);
  for (int x = 0; x < 2; x++) for (int y = 0; y < 2; y++) {
    vec2 tc = uv + (vec2(float(x), float(y)) * 2.0 - 1.0) * uTexel;
    // the effects layer (flashes and fire) over the scene
    vec4 fx = texture(uLayer, tc);
    vec3 s = min(DEC(texture(uScene, tc).rgb) * (1.0 - fx.a) + fx.rgb, vec3(60.0));
    float l = max(s.r, max(s.g, s.b));
    c += s * (max(l - uThreshold, 0.0) / max(l, 1e-4));
  }
  outColor = vec4(ENC(c * 0.25), 1.0);
}`;

export const blurFS = (defs) => `#version 300 es
precision highp float;
${defs}
in vec2 vNdc;
uniform sampler2D uScene;
uniform vec2 uStep;
out vec4 outColor;
void main() {
  vec2 uv = vNdc * 0.5 + 0.5;
  vec3 c = DEC(texture(uScene, uv).rgb) * 0.2270270270;
  c += (DEC(texture(uScene, uv + uStep * 1.3846153846).rgb) + DEC(texture(uScene, uv - uStep * 1.3846153846).rgb)) * 0.3162162162;
  c += (DEC(texture(uScene, uv + uStep * 3.2307692308).rgb) + DEC(texture(uScene, uv - uStep * 3.2307692308).rgb)) * 0.0702702703;
  outColor = vec4(ENC(c), 1.0);
}`;

// ---------------------------------------------------------------------------- composite

// Haze and in-scattered light from depth, shafts, bloom, exposure, filmic tone curve.
// Tone curve: the ACES fit by Stephen Hill (BakingLab, MIT licence).
export const compositeFS = (defs) => `#version 300 es
precision highp float;
${defs}
in vec2 vNdc;
uniform sampler2D uScene, uDepth, uShafts, uBloom, uLayer;
uniform vec3 uSunDir, uSunE, uSkyAmb;
uniform vec2 uFog;
uniform vec2 uShaftTexel;
uniform float uExposure, uBloomGain, uRayGain, uShaftGain, uVignette;
uniform int uDebug;
uniform vec3 uTint;
out vec4 outColor;
${VIEW_RAY}
${HG}
const mat3 ACES_IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACES_OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 tonemap(vec3 c) {
  c = ACES_IN * (c / 0.6);
  vec3 a = c * (c + 0.0245786) - 0.000090537;
  vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return clamp(ACES_OUT * (a / b), 0.0, 1.0);
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 uv = vNdc * 0.5 + 0.5;
  vec3 col = DEC(texture(uScene, uv).rgb);
  float depth = texture(uDepth, uv).r;
  vec3 ray = uForward + uRight * vNdc.x * uTan.x + uUp * vNdc.y * uTan.y;
  float rl = length(ray);
  vec3 d = ray / rl;
  bool sky = depth >= 1.0;
  float dist = sky ? 4e5 : viewDepth(depth) * rl;
  // exponential height fog, integrated analytically along the ray
  float dy = sky ? max(d.y, 0.02) : d.y;
  float k = dy / uFog.y;
  float span = abs(k * dist) > 1e-4 ? (1.0 - exp(-k * dist)) / k : dist;
  float T = exp(-uFog.x * exp(-uCamPos.y / uFog.y) * span);

  vec2 sh = (texture(uShafts, uv + uShaftTexel * vec2(-0.75, -0.75)).rg + texture(uShafts, uv + uShaftTexel * vec2(0.75, -0.75)).rg
           + texture(uShafts, uv + uShaftTexel * vec2(-0.75, 0.75)).rg + texture(uShafts, uv + uShaftTexel * vec2(0.75, 0.75)).rg) * 0.25;
  float mu = dot(d, uSunDir);
  float phase = mix(hg(mu, 0.62), hg(mu, -0.15), 0.4);
  // sh.r is the lit share of the haze on this ray; the curve deepens the unlit beams a little
  col = col * T + (uSkyAmb * 0.9 + uSunE * (phase * pow(sh.r, 1.5) * uShaftGain)) * (1.0 - T);
  // smoke and fire, already fogged at their own range, over the fogged scene behind them
  vec4 fx = texture(uLayer, uv);
  col = col * (1.0 - fx.a) + fx.rgb;
  col += uSunE * sh.g * uRayGain;
  col += DEC(texture(uBloom, uv).rgb) * uBloomGain;

  col = tonemap(col * uExposure);
  col = pow(col, vec3(1.0 / 2.2));
  col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 1.12) * uTint;
  col *= 1.0 - uVignette * dot(vNdc, vNdc) * 0.5;
  col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  if (uDebug == 1) col = vec3(sh.r);
  if (uDebug == 2) col = vec3(sh.g * 4.0);
  outColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------------------- pixel art (optional)

// The whole frame is rendered at a fraction of the screen size and enlarged with hard edges.
// Brightness is cut into bands with a light ordered dither between neighbouring bands while the
// hue is kept, and strong edges get a darker line on their dark side.
export const PIXEL_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform sampler2D uScene;
uniform vec2 uSize;      // low-resolution size in pixels
uniform float uLevels;   // number of brightness bands
out vec4 outColor;
float bayer(vec2 p) {
  int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[y * 4 + x]) + 0.5) / 16.0;
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 uv = vNdc * 0.5 + 0.5;
  vec2 cell = floor(uv * uSize);
  vec2 px = 1.0 / uSize;
  vec2 cuv = (cell + 0.5) * px;
  vec3 c = texture(uScene, cuv).rgb;
  float l = luma(c);
  float nb = max(
    max(luma(texture(uScene, cuv + vec2(px.x, 0.0)).rgb), luma(texture(uScene, cuv - vec2(px.x, 0.0)).rgb)),
    max(luma(texture(uScene, cuv + vec2(0.0, px.y)).rgb), luma(texture(uScene, cuv - vec2(0.0, px.y)).rgb)));
  c = clamp(mix(vec3(l), c, 1.12), 0.0, 1.0);
  float v = max(c.r, max(c.g, c.b));
  float n = uLevels - 1.0;
  float q = clamp(floor(v * n + 0.5 + (bayer(cell) - 0.5) * 0.55) / n, 0.0, 1.0);
  c *= q / max(v, 1e-4);
  c = floor(c * 31.0 + 0.5) / 31.0;
  c *= 1.0 - 0.38 * smoothstep(0.08, 0.2, nb - l);
  outColor = vec4(c, 1.0);
}`;

export { FULLSCREEN_VS };

// ------------------------------------------------------------------------------ inset

// A small extra view (the hit camera) into a rectangle of the screen: exposure and the same
// filmic curve as the main picture, darkened by uDim behind the x-ray.
export const insetFS = (defs) => `#version 300 es
precision highp float;
${defs}
in vec2 vNdc;
uniform sampler2D uScene;
uniform float uExposure, uDim, uDisc;
out vec4 outColor;
const mat3 ACES_IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACES_OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 tonemap(vec3 c) {
  c = ACES_IN * (c / 0.6);
  vec3 a = c * (c + 0.0245786) - 0.000090537;
  vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return clamp(ACES_OUT * (a / b), 0.0, 1.0);
}
void main() {
  vec2 uv = vNdc * 0.5 + 0.5;
  vec3 col = tonemap(DEC(texture(uScene, uv).rgb) * uExposure);
  col = pow(col, vec3(1.0 / 2.2)) * (1.0 - uDim);
  // the status panel's round window: only the disc, see-through by uDisc
  if (uDisc > 0.0) {
    float r = length(vNdc);
    if (r > 1.0) discard;
    outColor = vec4(col, uDisc * smoothstep(1.0, 0.97, r));
    return;
  }
  outColor = vec4(col, 1.0);
}`;

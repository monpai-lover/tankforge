// Clear-sky atmosphere model on the CPU: the same single-scattering integral the sky shader runs
// (Rayleigh + Mie + ozone absorption over a spherical planet), used here to derive the light the
// scene is lit with -- sun irradiance at the ground, ambient sky radiance, exposure -- so that the
// sun, the sky, the haze and the clouds all come from one set of numbers for a given sun height.
// Constants follow Nishita et al. 1993 / Bruneton & Neyret 2008 (see SOURCES.md).

export const R_PLANET = 6371e3;
export const R_ATMOS = 6471e3;
export const K_RLH = [5.5e-6, 13.0e-6, 22.4e-6];
export const K_MIE = 21e-6;
export const K_OZO = [0.65e-6, 1.881e-6, 0.085e-6];
export const SH_RLH = 8e3;
export const SH_MIE = 1.2e3;
export const G_MIE = 0.758;
/** Sun irradiance above the atmosphere in scene units. */
export const I_SUN = 22;

const R0 = R_PLANET + 2;

function exitDistance(pos, dir) {
  const b = 2 * (pos[0] * dir[0] + pos[1] * dir[1] + pos[2] * dir[2]);
  const c = pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2] - R_ATMOS * R_ATMOS;
  const d = b * b - 4 * c;
  return d < 0 ? 0 : (-b + Math.sqrt(d)) / 2;
}

function densities(pos) {
  const h = Math.max(0, Math.hypot(pos[0], pos[1], pos[2]) - R_PLANET);
  return [Math.exp(-h / SH_RLH), Math.exp(-h / SH_MIE), Math.max(0, 1 - Math.abs(h - 25e3) / 15e3)];
}

/** Optical depths [rayleigh, mie, ozone] from pos to the top of the atmosphere. */
function opticalDepth(pos, dir, steps) {
  const len = exitDistance(pos, dir);
  const od = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    const f0 = i / steps;
    const f1 = (i + 1) / steps;
    const ta = len * f0 * f0;
    const tb = len * f1 * f1;
    const tm = 0.5 * (ta + tb);
    const d = densities([pos[0] + dir[0] * tm, pos[1] + dir[1] * tm, pos[2] + dir[2] * tm]);
    for (let k = 0; k < 3; k++) od[k] += d[k] * (tb - ta);
  }
  return od;
}

const attenuation = (od) => [0, 1, 2].map((k) => Math.exp(-(K_RLH[k] * od[0] + K_MIE * 1.1 * od[1] + K_OZO[k] * od[2])));

/** Fraction of sunlight (per colour) that reaches the ground. */
export function sunTransmittance(sunDir) {
  return attenuation(opticalDepth([0, R0, 0], sunDir, 48));
}

/** Sky radiance seen from the ground along dir (unit vector, y up). */
export function skyRadiance(dir, sunDir, iSteps = 12, jSteps = 4) {
  const r = [dir[0], Math.max(dir[1], 0), dir[2]];
  const rl = Math.hypot(r[0], r[1], r[2]) || 1;
  r[0] /= rl;
  r[1] /= rl;
  r[2] /= rl;
  const origin = [0, R0, 0];
  const len = exitDistance(origin, r);
  const mu = r[0] * sunDir[0] + r[1] * sunDir[1] + r[2] * sunDir[2];
  const gg = G_MIE * G_MIE;
  const pRlh = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const pMie = ((3 / (8 * Math.PI)) * ((1 - gg) * (mu * mu + 1))) / (Math.pow(1 + gg - 2 * mu * G_MIE, 1.5) * (2 + gg));
  const od = [0, 0, 0];
  const totalR = [0, 0, 0];
  const totalM = [0, 0, 0];
  for (let i = 0; i < iSteps; i++) {
    const f0 = i / iSteps;
    const f1 = (i + 1) / iSteps;
    const ta = len * f0 * f0;
    const tb = len * f1 * f1;
    const tm = 0.5 * (ta + tb);
    const p = [origin[0] + r[0] * tm, origin[1] + r[1] * tm, origin[2] + r[2] * tm];
    const d = densities(p);
    const ds = tb - ta;
    for (let k = 0; k < 3; k++) od[k] += d[k] * ds;
    const od2 = opticalDepth(p, sunDir, jSteps);
    const att = attenuation([od[0] + od2[0], od[1] + od2[1], od[2] + od2[2]]);
    for (let k = 0; k < 3; k++) {
      totalR[k] += d[0] * ds * att[k];
      totalM[k] += d[1] * ds * att[k];
    }
  }
  return [0, 1, 2].map((k) => I_SUN * (pRlh * K_RLH[k] * totalR[k] + pMie * K_MIE * totalM[k]));
}

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Times of day the range can be set to. Azimuth is clockwise from +Z (down the range) towards +X. */
export const TIMES = [
  { id: 'afternoon', label: '午後', elev: 27, az: 56, fog: [1.1e-4, 520], coverage: 0.44 },
  { id: 'noon', label: '正午', elev: 62, az: 25, fog: [0.7e-4, 600], coverage: 0.46 },
  { id: 'dusk', label: '黃昏', elev: 6.5, az: -48, fog: [2.0e-4, 460], coverage: 0.52 },
  { id: 'morning', label: '清晨薄霧', elev: 11, az: 70, fog: [5.0e-4, 260], coverage: 0.42 },
];

/**
 * Everything the renderer needs for one sun position:
 * sunDir, sunE (irradiance on a surface facing the sun), skyAmb (mean sky radiance = sky irradiance / pi),
 * ground (light bounced off the terrain, as radiance), exposure.
 */
export function environment(time) {
  const el = (time.elev * Math.PI) / 180;
  const az = (time.az * Math.PI) / 180;
  const sunDir = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
  const sunE = sunTransmittance(sunDir).map((t) => t * I_SUN);

  // cosine-weighted mean of the sky radiance over the upper hemisphere
  const amb = [0, 0, 0];
  let wsum = 0;
  const NE = 6;
  const NA = 12;
  for (let i = 0; i < NE; i++) {
    const e = ((i + 0.5) / NE) * (Math.PI / 2);
    const w = Math.sin(e) * Math.cos(e);
    for (let j = 0; j < NA; j++) {
      const a = (j / NA) * Math.PI * 2;
      const L = skyRadiance([Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)], sunDir, 10, 3);
      for (let k = 0; k < 3; k++) amb[k] += L[k] * w;
      wsum += w;
    }
  }
  const skyAmb = amb.map((v) => v / wsum);

  // light arriving on level ground, with part of the sun hidden by cloud
  const cloudCut = 1 - 0.45 * time.coverage;
  const ground = [0.115, 0.125, 0.07].map((alb, k) => (alb * (sunE[k] * Math.sin(el) * cloudCut + Math.PI * skyAmb[k])) / Math.PI);

  // exposure: a mid-grey card lying on the ground lands on a fixed value before tone mapping
  const grey = (0.18 / Math.PI) * (lum(sunE) * Math.sin(el) * cloudCut + Math.PI * lum(skyAmb));
  // (with a low sun the sky is the brightest thing in view, so it sets the exposure instead)
  const glowEl = Math.max(el, 0.2);
  const glow = lum(skyRadiance([Math.sin(az) * Math.cos(glowEl), Math.sin(glowEl), Math.cos(az) * Math.cos(glowEl)], sunDir));
  const exposure = Math.min(4, Math.max(0.05, 0.19 / Math.max(grey, 0.62 * lum(skyAmb), 0.1 * glow)));

  return { sunDir, sunE, skyAmb, ground, exposure, fog: time.fog, coverage: time.coverage, elev: time.elev };
}

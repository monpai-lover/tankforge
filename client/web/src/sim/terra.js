// TEMPORARY JS mirror of crates/physics/src/terra.rs -- keep the two in lockstep.
//
// Track / soil interaction after Bekker and Wong (see SOURCES.md):
//   pressure-sinkage      p = (kc / b + kphi) * z^n
//   compaction resistance Rc = b * (kc / b + kphi) * z^(n+1) / (n+1)        (per track)
//   shear (Janosi-Hanamoto) F = Fmax * (1 - K/(i L) * (1 - exp(-i L / K))),  Fmax = c A + W tan(phi)
// Units follow the published tables: kc in kN/m^(n+1), kphi in kN/m^(n+2), c in kPa, K in metres.

const G = 9.81;
/** Ground pressure the terrain multipliers in terrains.json are calibrated for. */
export const REFERENCE_PRESSURE_PA = 80e3;
/** Shear deformation modulus used on hard ground (no soil data). */
export const HARD_GROUND_K = 0.006;

/** Mean ground pressure under the tracks, Pa. */
export function groundPressure(massKg, trackWidth, contactLength) {
  return (massKg * G) / (2 * trackWidth * contactLength);
}

/** Static sinkage in metres for a track of width b carrying `pressurePa`. */
export function sinkage(soil, pressurePa, b) {
  if (!soil) return 0;
  const k = soil.kc / b + soil.kphi;
  const z = Math.pow(pressurePa / 1000 / k, 1 / soil.n);
  return Math.min(z, soil.max_sinkage_m ?? 0.5);
}

/** Force needed to press one track's rut into the soil, N. */
export function compactionResistance(soil, z, b) {
  if (!soil) return 0;
  return ((b * (soil.kc / b + soil.kphi) * Math.pow(z, soil.n + 1)) / (soil.n + 1)) * 1000;
}

/** Largest thrust the soil can carry under contact area A (m^2) and weight W (N). */
export function maxTraction(soil, area, weightN) {
  return soil.c * 1000 * area + weightN * Math.tan((soil.phi_deg * Math.PI) / 180);
}

/** Share of the maximum thrust developed at slip i (0..1) for contact length L. */
export function shearRatio(slip, K, L) {
  const x = (slip * L) / K;
  if (x < 1e-6) return 0;
  return 1 - (1 - Math.exp(-x)) / x;
}

/** Inverse of shearRatio: the slip a track needs to deliver `ratio` of its maximum thrust. */
export function slipForRatio(ratio, K, L) {
  const r = Math.min(Math.max(ratio, 0), 0.9999);
  if (r <= 0) return 0;
  const f = (x) => 1 - (1 - Math.exp(-x)) / x;
  let lo = 0;
  let hi = 1;
  while (f(hi) < r && hi < 1e6) hi *= 2;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) < r) lo = mid;
    else hi = mid;
  }
  return Math.min((0.5 * (lo + hi) * K) / L, 1);
}

/**
 * How much harder (or easier) soft ground is for this vehicle than for the reference one.
 * Compaction resistance grows with z^(n+1) and z with p^(1/n), so it scales with p^((n+1)/n).
 */
export function pressureFactor(soil, pressurePa) {
  if (!soil) return 1;
  const e = Math.min((soil.n + 1) / soil.n, 3);
  return Math.min(Math.max(Math.pow(pressurePa / REFERENCE_PRESSURE_PA, e), 0.6), 1.8);
}

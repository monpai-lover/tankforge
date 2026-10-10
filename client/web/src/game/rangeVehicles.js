// Stock vehicle targets, ordered by frontal hull protection. Distances are from
// the single-player firing origin; bearings avoid paper targets and test obstacles.
const TARGETS = [
  ['us_m8', 100, -12],
  ['de_pz3_j', 200, -16],
  ['de_pz4_h', 400, 20],
  ['de_tiger_e', 600, -8],
  ['de_panther_g', 800, -5.5],
  ['su_t54', 1200, 6],
  ['su_t10m', 1600, 10],
  ['xp_bmp_k64', 2000, 15],
];

export function rangeVehicleTargets() {
  return TARGETS.map(([id, rangeM, bearingDeg]) => {
    const bearing = bearingDeg * Math.PI / 180;
    return {id, rangeM, x: Math.sin(bearing) * rangeM, z: Math.cos(bearing) * rangeM, heading: bearing + Math.PI};
  });
}

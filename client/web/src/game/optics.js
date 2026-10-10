const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** True FOV spans the visible eyepiece, rather than the whole rectangular canvas.
 * A common 60-degree apparent-field scale makes different optics keep their
 * own aperture while equal optical power keeps equal central image scale.
 * Aperture sizing is a readability policy, not measured eye relief. Wide optics
 * may overscan the short screen edge so the gunner gets a larger visible window.
 */
export function sightProjection(level, width, height) {
  const mag = Number.isFinite(level?.magnification) ? clamp(level.magnification, 1, 40) : 3;
  const fov = Number.isFinite(level?.fov_deg) && level.fov_deg > 0 && level.fov_deg <= 90 ? level.fov_deg : 16;
  const baseMag = level?.doubled ? mag / 2 : mag;
  const baseFov = level?.doubled ? fov * 2 : fov;
  const apparentTangent = baseMag * Math.tan(baseFov * DEG / 2);
  const apparentFovDeg = 2 * Math.atan(apparentTangent) / DEG;
  const ratio = clamp(.60 * apparentTangent / Math.tan(30 * DEG), .33, .625);
  const w = Math.max(1, width), h = Math.max(1, height);
  const radius = Math.min(w, h) * ratio;
  const pxPerRad = radius / Math.tan(fov * DEG / 2);
  return { radius, pxPerRad, fovY: 2 * Math.atan(h / 2 / pxPerRad),
    apparentFovDeg, edgeOpacity: clamp(.85 - (apparentFovDeg - 25) * .01, .35, .85) };
}

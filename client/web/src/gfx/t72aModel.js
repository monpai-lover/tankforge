// First-party, opt-in T-72A geometry. No shared vehicle movement/material policy.
// Faces in the casting's two smoothing islands share area-weighted normals;
// aperture reveals, the roof and the bearing face retain hard cast/machined edges.
import { cross, sub, norm, translation } from './math.js';
import { GeoBuilder } from './geo.js';

export function addT72aCasting(builder, matrix, part, material) {
  const { vertices, faces, t72a_smoothing: groups } = part;
  if (!Array.isArray(groups) || groups.length !== faces.length)
    throw new Error('T-72A casting smoothing groups do not match authored faces');
  const normals = new Map();
  for (let i = 0; i < faces.length; i++) {
    if (!groups[i]) continue;
    const f = faces[i];
    const n = cross(sub(vertices[f[1]], vertices[f[0]]), sub(vertices[f[2]], vertices[f[0]]));
    for (const v of f) {
      const key = `${groups[i]}:${v}`, previous = normals.get(key) || [0, 0, 0];
      normals.set(key, previous.map((x, k) => x + n[k]));
    }
  }
  for (const [key, n] of normals) normals.set(key, norm(n));
  faces.forEach((f, i) => builder.tri(matrix, false, ...f.map(v => vertices[v]), material,
    groups[i] ? f.map(v => normals.get(`${groups[i]}:${v}`)) : undefined));
}

/** Original low-poly NSVT/Utes interpretation. Swivel and bore vector are unchanged.
 * Only visual.mg_variants.aa_nsvt=nsvt_t72a selects this, including transplants.
 * Mount dimensions are authored fits, not an original NSVT production drawing.
 */
export function t72aNsvt(mats) {
  const b = new GeoBuilder(), T = translation, m = mats;
  const box = (p, s, mat = m.black) => b.box(T(...p), false, s, mat);
  const tube = (p, r, len, r2 = r, hole = 0, mat = m.black) =>
    b.cyl(T(...p), false, 'z', r, r2, len, 16, mat, null, hole, m.black);
  // Cradle cheeks straddle the fixed pivot; the feed box is carried by the gun.
  for (const s of [-1, 1]) box([s * .056, -.012, -.045], [.024, .105, .22], m.paint_dark);
  b.cyl(T(0, 0, 0), false, 'x', .026, .026, .16, 16, m.steel);
  box([0, .052, -.13], [.103, .12, .57]);
  box([0, .117, -.14], [.11, .021, .39]);
  box([-.127, .017, -.12], [.15, .18, .29], m.paint_dark);
  box([-.08, .09, -.07], [.065, .041, .13], m.steel);
  // Smooth barrel and underslung gas cylinder, not DShK fins/ball brake.
  tube([0, .06, .395], .029, .50, .0215, .00635);
  tube([0, .06, .8565], .0205, .435, .0175, .00635, m.steel);
  tube([0, .06, 1.1025], .027, .105, .031, .00635);
  tube([0, .06, 1.16], .031, .02, .031, .00635);
  tube([0, .002, .398], .017, .51, .017, 0);
  box([0, .029, .61], [.047, .047, .07]);
  box([0, .106, .95], [.016, .085, .023]);
  box([0, .106, .125], [.014, .08, .018]);
  box([0, .055, -.431], [.145, .095, .027], m.steel);
  for (const s of [-1, 1]) {
    b.cyl(T(s * .062, .032, -.473), false, 'y', .014, .014, .11, 10, m.black);
    box([s * .062, .04, -.443], [.019, .025, .067], m.steel);
  }
  return { geo: b, muzzle: 1.17, muzzleVector: [0, .06, 1.17] };
}

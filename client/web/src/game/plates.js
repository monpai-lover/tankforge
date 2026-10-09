// Armour plates: the rectangle (half_u x half_v round the centre) and, for plates out of an
// imported damage model, the exact outline polygon in the same (u, v) plane -- as
// crates/armor ArmorPlate::intersect tests it.

/** Even-odd point-in-polygon in the plate's (u, v) plane; poly: [[u, v], ...]. */
export function insidePolygon(poly, u, v) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > v !== b[1] > v && u < ((b[0] - a[0]) * (v - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Whether (u, v) lies on the plate: inside its rectangle and, when it has one, its outline. */
export function onPlate(def, u, v) {
  if (Math.abs(u) > def.half_u || Math.abs(v) > def.half_v) return false;
  return !(def.polygon && def.polygon.length >= 3) || insidePolygon(def.polygon, u, v);
}

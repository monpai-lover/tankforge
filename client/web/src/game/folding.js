const clampFold = t => Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
const arr = v => Array.isArray(v) ? v : [v.x, v.y, v.z];
const vec = v => ({ x: v[0], y: v[1], z: v[2] });

export function smoothFold(t) {
  t = clampFold(t);
  return t * t * (3 - 2 * t);
}

/** Hull-mounted panels use the renderer's Rodrigues rotation about a -> b. */
export function foldedPlate(plate, fraction) {
  const h = plate.hinge, t = clampFold(fraction);
  if (!h || t === 0) return plate;
  const axis = h.b.map((v, i) => v - h.a[i]);
  const length = Math.hypot(...axis);
  if (length < 1e-8) return plate;
  const [x, y, z] = axis.map(v => v / length), angle = h.angle * Math.PI / 180 * t;
  const c = Math.cos(angle), s = Math.sin(angle), d = 1 - c;
  const rotate = v => {
    const [a, b, e] = arr(v), dot = x * a + y * b + z * e;
    return [a * c + (y * e - z * b) * s + x * dot * d,
      b * c + (z * a - x * e) * s + y * dot * d,
      e * c + (x * b - y * a) * s + z * dot * d];
  };
  const center = rotate(arr(plate.center).map((v, i) => v - h.a[i])).map((v, i) => v + h.a[i]);
  return { ...plate, center: vec(center), normal: vec(rotate(plate.normal)), axis_u: vec(rotate(plate.axis_u)) };
}

function bearing(tab, yaw, fallback) {
  if (!tab?.length) return fallback;
  const n = ((yaw / (2 * Math.PI) % 1 + 1) % 1) * tab.length;
  const i = Math.floor(n), f = n - i;
  return tab[i % tab.length] * (1 - f) + tab[(i + 1) % tab.length] * f;
}

function stagesAt(stages, fold) {
  const t = clampFold(fold);
  for (let i = 0; i < stages.length; i++) {
    if (t <= stages[i].fold + 1e-9) {
      if (Math.abs(t - stages[i].fold) < 1e-9 || i === 0) return [stages[i], stages[i]];
      return [stages[i - 1], stages[i]];
    }
  }
  return [stages.at(-1), stages.at(-1)];
}

/** Keep the intersection of measured safe arcs until the next stage is fully reached. */
export function foldDepression(turret, yaw, full, fold) {
  if (turret.foldDepStages?.length) {
    const [a, b] = stagesAt(turret.foldDepStages, fold);
    return Math.min(full, bearing(a.angles, yaw, full), bearing(b.angles, yaw, full));
  }
  if (clampFold(fold) >= 1 - 1e-9 && turret.foldedDepByYaw) return Math.min(full, bearing(turret.foldedDepByYaw, yaw, full));
  return clampFold(fold) >= 1 - 1e-9 ? full : Math.min(full, bearing(turret.depByYaw, yaw, full));
}

export function foldYawLimit(turret, fold) {
  if (turret.foldYawStages?.length) {
    const [a, b] = stagesAt(turret.foldYawStages, fold);
    return [Math.max(a.limits[0], b.limits[0]) * Math.PI / 180, Math.min(a.limits[1], b.limits[1]) * Math.PI / 180];
  }
  return clampFold(fold) >= 1 - 1e-9 && turret.foldedLimit ? turret.foldedLimit : turret.limit;
}

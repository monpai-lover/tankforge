// Embed beside the production renderer helpers. Distant VISUAL LOD only: these meshes
// must never be registered as vehicle contact, armour, damage or replay geometry.
// Near/followed/controlled units keep their original imported model and running gear.
function createFrontlineLod(renderer, bundle) {
  const vehicle = bundle.vehicle, weapons = bundle.weapons;
  const vector = (v) => v?.length === 3 && Array.from(v).every(Number.isFinite);
  const dimensions = (v) => vector(v) && Array.from(v).every((n) => n > 0);
  if (!dimensions(vehicle?.hull?.size_m) || !dimensions(vehicle?.turret?.size_m) ||
      !vector(vehicle.turret.position_m) || !vector(weapons?.mount_m)) {
    throw new TypeError('Frontline LOD requires the actual hull, turret and main-gun mount');
  }
  const [width, height, length] = vehicle.hull.size_m;
  const [tw, th, tl] = vehicle.turret.size_m;
  const pivot = vehicle.turret.position_m, mount = weapons.mount_m, main = weapons.main_gun;
  const barrelLength = main?.barrel_length_mm / 1000;
  const calibre = main?.caliber_mm / 1000;
  const muzzle = main?.muzzle_vector_m || weapons.muzzle_vector_m ||
    [0, 0, weapons.muzzle_offset_m ?? barrelLength];
  if (!(barrelLength > 0) || !Number.isFinite(barrelLength) || !(calibre > 0) ||
      !vector(muzzle) || Math.hypot(...muzzle) < 1e-6) {
    throw new TypeError('Frontline LOD requires a finite main-gun barrel and muzzle');
  }
  const root = new Node('frontline_distant_visual_lod');
  root.visualLodOnly = true;
  const body = root.add(new Node('frontline_lod_body'));
  const turret = body.add(new Node('frontline_lod_turret'));
  const gun = turret.add(new Node('frontline_lod_main_gun'));
  const meshes = [];
  const bodyMatrix = body.local = new Float32Array(IDENTITY);
  const turretMatrix = turret.local = new Float32Array(IDENTITY);
  const gunMatrix = gun.local = new Float32Array(IDENTITY);
  const olive = { color: [.16, .20, .10], rough: .88, metal: .22 };
  const turretOlive = { color: [.18, .22, .12], rough: .85, metal: .25 };
  const rubber = { color: [.025, .029, .023], rough: .97, metal: .03 };
  const wheelMat = { color: [.075, .090, .045], rough: .85, metal: .22 };
  const gunMat = { color: [.10, .13, .07], rough: .65, metal: .48 };
  const hullGeo = new GeoBuilder(), turretGeo = new GeoBuilder(), gunGeo = new GeoBuilder();

  // A sloped silhouette within the source hull box, not an inferred armour layout.
  const hz = length / 2;
  hullGeo.prism(IDENTITY, false, [
    [-hz, height * .30], [-hz * .90, height], [hz * .72, height],
    [hz, height * .65], [hz * .93, height * .20], [-hz * .90, height * .20]
  ], width * .76, width, 0, olive);

  const gear = bundle.visual?.running_gear;
  const wheels = (gear?.wheels || []).filter((w) =>
    [w.z, w.y, w.r].every(Number.isFinite) && w.r > 0);
  const endpoints = [gear?.sprocket, gear?.idler].filter((w) =>
    w && [w.z, w.y, w.r].every(Number.isFinite) && w.r > 0);
  const stations = [...wheels, ...endpoints];
  const physics = vehicle.physics || {};
  const trackWidth = gear?.track_width ?? physics.track_width_m;
  const trackX = gear?.track_x ?? (width - trackWidth) / 2;
  const thickness = gear?.track_thickness ?? 0;
  let trackBounds = null;
  if (stations.length && Number.isFinite(trackWidth) && trackWidth > 0 &&
      Number.isFinite(trackX) && trackX > 0) {
    trackBounds = {
      minZ: Math.min(...stations.map((w) => w.z - w.r)) - thickness / 2,
      maxZ: Math.max(...stations.map((w) => w.z + w.r)) + thickness / 2,
      minY: Math.min(...stations.map((w) => w.y - w.r)) - thickness / 2,
      maxY: Math.max(...stations.map((w) => w.y + w.r)) + thickness / 2
    };
  } else if ([physics.track_length_m, physics.sprocket_radius_m, trackWidth, trackX]
    .every((v) => Number.isFinite(v) && v > 0)) {
    // Old tracked bundles without authored running gear: use their actual contact
    // length and sprocket radius. No invented per-wheel layout is generated.
    trackBounds = {
      minZ: -physics.track_length_m / 2 - physics.sprocket_radius_m,
      maxZ: physics.track_length_m / 2 + physics.sprocket_radius_m,
      minY: 0, maxY: 2 * physics.sprocket_radius_m
    };
  }
  if (trackBounds) {
    const { minZ, maxZ, minY, maxY } = trackBounds;
    const rise = maxY - minY, bevel = Math.min((maxZ - minZ) * .12, rise * .6);
    const profile = [
      [minZ, minY + rise * .32], [minZ + bevel, minY], [maxZ - bevel, minY],
      [maxZ, minY + rise * .32], [maxZ - bevel * .2, maxY], [minZ + bevel * .2, maxY]
    ];
    const unique = [...new Map(wheels.map((w) => [Math.round(w.z * 1000), w])).values()]
      .sort((a, b) => a.z - b.z);
    // At most six actual stations per side. Distant wheels are static caps;
    // accepted running-gear state and close-model suspension remain untouched.
    const samples = unique.length <= 6 ? unique : Array.from({ length: 6 }, (_, i) =>
      unique[Math.round(i * (unique.length - 1) / 5)]);
    for (const side of [-1, 1]) {
      hullGeo.prism(IDENTITY, false, profile, trackWidth, trackWidth, side * trackX, rubber);
      for (const wheel of samples) {
        const x = side * (trackX + trackWidth / 2 + .003), c = [x, wheel.y, wheel.z];
        const rim = [[x, wheel.y + wheel.r, wheel.z], [x, wheel.y, wheel.z + wheel.r],
          [x, wheel.y - wheel.r, wheel.z], [x, wheel.y, wheel.z - wheel.r]];
        for (let i = 0; i < 4; i++) hullGeo.tri(IDENTITY, side < 0,
          c, rim[i], rim[(i + 1) % 4], wheelMat);
      }
    }
  }
  // Rounded eight-sided turret, bounded by its real size about the ring pivot.
  const outline = [[-tw * .35, -tl / 2], [tw * .35, -tl / 2], [tw / 2, -tl * .30],
    [tw / 2, tl * .30], [tw * .35, tl / 2], [-tw * .35, tl / 2],
    [-tw / 2, tl * .30], [-tw / 2, -tl * .30]];
  turretGeo.plan(IDENTITY, false, outline, 0, th, [.80, .84], [0, 0], [0, 0], false, turretOlive);

  // Preserve the source muzzle location and complete barrel length, including
  // the part behind the trunnion. A non-axial authored muzzle is respected.
  const axis = muzzle.map((v) => v / Math.hypot(...muzzle));
  const up = Math.abs(axis[1]) > .95 ? [1, 0, 0] : [0, 1, 0];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const right0 = cross3(up, axis), rightLength = Math.hypot(...right0);
  const right = right0.map((v) => v / rightLength), top = cross3(axis, right);
  const barrelMatrix = new Float32Array(IDENTITY);
  for (let k = 0; k < 3; k++) {
    barrelMatrix[k] = right[k]; barrelMatrix[4 + k] = top[k]; barrelMatrix[8 + k] = axis[k];
    barrelMatrix[12 + k] = muzzle[k] - axis[k] * barrelLength / 2;
  }
  gunGeo.cyl(barrelMatrix, false, 'z', calibre * .65, calibre * .53,
    barrelLength, 6, gunMat);
  gunGeo.box(IDENTITY, false, [Math.min(tw * .50, calibre * 5), Math.min(th * .65, calibre * 4),
    Math.min(tl * .30, calibre * 5)], olive);

  try {
    for (const [node, geometry] of [[body, hullGeo], [turret, turretGeo], [gun, gunGeo]]) {
      node.mesh = renderer.mesh(geometry.build()); meshes.push(node.mesh);
      node.castShadow = false;
    }
  } catch (error) {
    for (const mesh of meshes) renderer.freeMesh(mesh);
    throw error;
  }
  let disposed = false;
  function pose(unit) {
    if (disposed) return false;
    const net = unit.net || {}, pos = vector(unit.pos) ? unit.pos : net.pos;
    if (!vector(pos)) return false;
    let ex = net.ex, ez = net.ez;
    if (!vector(ex) || !vector(ez)) {
      const yaw = Number.isFinite(unit.yaw) ? unit.yaw : unit.heading;
      if (!Number.isFinite(yaw)) return false;
      ex = [Math.cos(yaw), 0, -Math.sin(yaw)]; ez = [Math.sin(yaw), 0, Math.cos(yaw)];
    }
    const ey = cross3(ez, ex);
    if (Math.hypot(...ey) < .1) return false;
    const yaw = unit.turret_yaw ?? 0, pitch = unit.gun_pitch ?? 0;
    if (![yaw, pitch].every(Number.isFinite)) return false;
    for (let k = 0; k < 3; k++) {
      bodyMatrix[k] = ex[k]; bodyMatrix[4 + k] = ey[k]; bodyMatrix[8 + k] = ez[k];
      bodyMatrix[12 + k] = pos[k];
      turretMatrix[12 + k] = pivot[k]; gunMatrix[12 + k] = mount[k] - pivot[k];
    }
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    turretMatrix[0] = cy; turretMatrix[2] = -sy; turretMatrix[8] = sy; turretMatrix[10] = cy;
    // Positive accepted gun elevation points its forward axis upward.
    gunMatrix[5] = cp; gunMatrix[6] = -sp; gunMatrix[9] = sp; gunMatrix[10] = cp;
    return true;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const mesh of meshes) renderer.freeMesh(mesh);
    for (const node of [body, turret, gun]) node.mesh = null;
    root.visible = false;
  }
  return { root, body, turret, gun, pose, dispose, meshes };
}

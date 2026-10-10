// Builds a modular tank model from a vehicle's data (vehicle.json + weapons.json + visual.json),
// or from an imported model (gfx/imported.js) cut into the same moving pieces, the tracks still
// the game's own.
// Every module is its own scene node so it can be animated, hidden or faded independently:
//   root ─┬─ running gear: track L/R, road wheels, sprockets, idlers, return rollers
//         └─ body (pitch / roll) ─┬─ hull
//                                 └─ turret (yaw) ─┬─ turret shell
//                                                  └─ gun (elevation) ─┬─ mantlet & static parts
//                                                                      └─ barrel (recoil slide)
import { GeoBuilder, hexToLinear, partMatrix } from './geo.js';
import { Node, translation, mul, rotX } from './math.js';
import { stationsOf, buildLoop, fitLoop, placeLinks, sprocketPhase, linkGeometry, sprocketGeometry, wheelGeometry } from './track.js';
import { partMesh, imageTexture } from './imported.js';
import { pintleGun } from './mgmodel.js';
import { buildGearSupports } from './gearSupports.js';

const MATERIAL_PROPS = {
  paint: { rough: 0.62, metal: 0.22 },
  paint_dark: { rough: 0.7, metal: 0.18 },
  steel: { rough: 0.42, metal: 0.85 },
  rubber: { rough: 0.93, metal: 0.0 },
  track: { rough: 0.6, metal: 0.7 },
  black: { rough: 0.8, metal: 0.1 },
  // marker lights and reflectors
  orange: { rough: 0.45, metal: 0.05 },
  // glazing (dark, glossy) and lamp lenses
  glass: { rough: 0.06, metal: 0.55 },
  lamp: { rough: 0.15, metal: 0.3 },
  // tarpaulins and bedrolls, the wooden boards of a lorry's bed
  canvas: { rough: 0.95, metal: 0.0 },
  wood: { rough: 0.85, metal: 0.0 },
};
/** Colours of the materials a palette does not name. */
const DEFAULT_HEX = { glass: '#1e262c', lamp: '#d8d4c4', orange: '#d98a1e', canvas: '#8b8466', wood: '#6f5c42' };

/** Rotation by angle a about the unit axis k (column-major). */
function axisRotation(k, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  const [x, y, z] = k;
  const m = new Float32Array(16);
  m[0] = c + x * x * t;
  m[1] = y * x * t + z * s;
  m[2] = z * x * t - y * s;
  m[4] = x * y * t - z * s;
  m[5] = c + y * y * t;
  m[6] = z * y * t + x * s;
  m[8] = x * z * t + y * s;
  m[9] = y * z * t - x * s;
  m[10] = c + z * z * t;
  m[15] = 1;
  return m;
}

export function materials(palette) {
  const out = {};
  for (const [name, props] of Object.entries(MATERIAL_PROPS)) {
    out[name] = { color: hexToLinear(palette[name] || DEFAULT_HEX[name] || '#808080'), ...props };
  }
  // inside the barrel: soot-black, it reads as a hole from outside
  out.bore = { color: [0.008, 0.008, 0.007], rough: 0.95, metal: 0.1 };
  return out;
}

export function addPart(b, part, offset, mats, bore = 0) {
  const mat = mats[part.mat] || mats.paint;
  const back = translation(-offset[0], -offset[1], -offset[2]);
  if (part.type === 'prism') {
    b.prism(back, false, part.profile, part.w, part.wt ?? part.w, part.x || 0, mat);
    return;
  }
  if (part.type === 'mesh') {
    b.polyMesh(back, false, part.vertices, part.faces, mat);
    return;
  }
  if (part.type === 'loft') {
    b.loft(back, false, part.rings, mat, part.crease ?? 35, part.caps || [true, true]);
    return;
  }
  if (part.type === 'plan') {
    b.plan(back, false, part.outline, part.y0, part.y1, part.scale_top || [1, 1], part.shift_top || [0, 0], part.origin, !!part.smooth, mat, part.hollow || 0);
    return;
  }
  for (const mirrored of part.mirror ? [false, true] : [false]) {
    const m = mul(back, partMatrix(part.pos, part.rot, mirrored));
    if (part.type === 'box') b.box(m, mirrored, part.size, mat);
    else if (part.type === 'cyl') {
      // the moving barrel parts along the bore are tubes: the muzzle is open
      const hole = bore > 0 && part.recoil && part.axis === 'z' ? bore : 0;
      b.cyl(m, mirrored, part.axis, part.r, part.r2 ?? part.r, part.len, part.segs || 18, mat, null, hole, mats.bore || mats.black);
    }
  }
}

/**
 * loadout: see game/loadout.js (vehicle, visual, turrets[] with guns[]).
 * Turrets without parts of their own in visual.json get a generated exterior.
 */
export function buildTank(renderer, loadout, generatedTurretParts) {
  const { vehicle, visual } = loadout;
  const mats = materials(visual.palette);

  const meshes = [];
  const meshNode = (name, parent, builder) => {
    const node = parent.add(new Node(name));
    if (builder.vertexCount > 0) {
      node.mesh = renderer.mesh(builder.build());
      meshes.push(node.mesh);
    }
    return node;
  };

  const root = new Node('vehicle');
  const body = root.add(new Node('body'));
  // sprocket, idler, rollers and the wheel arms are bolted to the hull: the running gear rides
  // with it, and only the road wheels move against it on their springs
  const running = body.add(new Node('running_gear'));

  const hullBuilder = new GeoBuilder();
  for (const part of visual.parts) if (part.mount !== 'turret' && part.mount !== 'gun' && !part.hinge) addPart(hullBuilder, part, [0, 0, 0], mats);
  const hull = meshNode('hull', body, hullBuilder);
  const shellNodes = [hull]; // everything that hides the interior

  // ---- armour flaps on hinges (the upper walls of an open fighting compartment that fold down
  // to clear the guns' arc): one node per hinge line, turned about it by `angle` when folded
  const hingeGroups = new Map();
  for (const part of visual.parts) {
    if (!part.hinge || part.mount === 'turret' || part.mount === 'gun') continue;
    const h = part.hinge;
    const key = JSON.stringify([h.a, h.b, h.angle]);
    if (!hingeGroups.has(key)) hingeGroups.set(key, { h, b: new GeoBuilder() });
    addPart(hingeGroups.get(key).b, part, h.a, mats);
  }
  const hinges = [];
  for (const { h, b } of hingeGroups.values()) {
    const node = meshNode('hinged_flap', body, b);
    hingeGroups.get(JSON.stringify([h.a, h.b, h.angle])).node = node;
    shellNodes.push(node);
    const d = [h.b[0] - h.a[0], h.b[1] - h.a[1], h.b[2] - h.a[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    hinges.push({ node, a: h.a, k: [d[0] / l, d[1] / l, d[2] / l], angle: (h.angle * Math.PI) / 180 });
  }
  const setFold = (t) => {
    for (const hg of hinges) hg.node.local = mul(translation(hg.a[0], hg.a[1], hg.a[2]), axisRotation(hg.k, hg.angle * t));
  };
  setFold(0);

  // ---- the imported model's pieces, textured, each on the node that moves it
  const imp = loadout.imported || null;
  let importedTris = 0;
  const impParts = (mount, test) => (imp ? imp.parts.map((p, i) => [p, i]).filter(([p]) => p.mount === mount && (!test || test(p))) : []);
  const impNode = (parent, name, part, i, origin) => {
    const n = parent.add(new Node(name));
    n.mesh = partMesh(renderer, `${imp.uid}:${i}:${origin.map((v) => v.toFixed(3)).join(',')}`, part, origin);
    n.kind = 9;
    n.baseKind = 9;
    n.texture = imageTexture(renderer, imp.images[part.texture], (t) => (n.texture = t));
    if (part.normal >= 0) n.normalTex = imageTexture(renderer, imp.images[part.normal], (t) => (n.normalTex = t));
    importedTris += part.triangles;
    return n;
  };
  let hullLow = hullBuilder.vertexCount ? hullBuilder.min[1] : Infinity;
  let top = hullBuilder.vertexCount ? hullBuilder.max[1] : 0;
  for (const [p, i] of impParts('hull', p => !p.hinge)) {
    shellNodes.push(impNode(body, 'hull_model', p, i, [0, 0, 0]));
    // the belly: the lowest of the hull's pieces between the tracks
    if (Math.abs((p.lo[0] + p.hi[0]) / 2) < 0.5) hullLow = Math.min(hullLow, p.lo[1]);
    top = Math.max(top, p.hi[1]);
  }
  // Source-textured armour panels keep the same hinge contract as procedural
  // flaps. Their vertices remain in hull space; only the named panel node folds.
  for (const [p, i] of impParts('hull', p => !!p.hinge)) {
    const h = p.hinge;
    const key = JSON.stringify([h.a, h.b, h.angle]);
    if (!hingeGroups.has(key)) {
      const node = body.add(new Node('imported_flap'));
      const d = h.b.map((v, k) => v - h.a[k]);
      const len = Math.hypot(...d) || 1;
      hingeGroups.set(key, { h, node });
      hinges.push({ node, a: h.a, k: d.map(v => v / len), angle: h.angle * Math.PI / 180 });
    }
    const node = hingeGroups.get(key).node;
    shellNodes.push(impNode(node, 'flap_model', p, i, h.a));
    top = Math.max(top, p.hi[1]);
  }
  setFold(0);
  const turrets = [];
  loadout.turrets.forEach((t, ti) => {
    const own = visual.parts.filter((p) => (p.mount === 'turret' || p.mount === 'gun') && (p.turret || 0) === ti);
    const impTurret = imp && imp.parts.some((p) => (p.mount === 'turret' || p.mount === 'gun' || p.mount === 'barrel') && (p.turret || 0) === ti);
    const parts = own.length ? own : impTurret ? [] : generatedTurretParts(t, ti);
    const shell = new GeoBuilder();
    for (const p of parts) if (p.mount === 'turret') addPart(shell, p, t.pivot, mats);
    // a turret riding on another hangs from that turret's node and turns with it
    const up = t.parent != null && turrets[t.parent] ? loadout.turrets[t.parent] : null;
    const node = (up ? turrets[t.parent].node : body).add(new Node('turret_' + ti));
    node.pos = up ? [t.pivot[0] - up.pivot[0], t.pivot[1] - up.pivot[1], t.pivot[2] - up.pivot[2]] : [t.pivot[0], t.pivot[1], t.pivot[2]];
    shellNodes.push(meshNode('turret_shell', node, shell));
    if (shell.vertexCount) top = Math.max(top, t.pivot[1] + shell.max[1]);
    {
      // the imported model's pieces on this turret (p.turret: which turret, 0 by default)
      for (const [p, i] of impParts('turret', (q) => (q.turret || 0) === ti)) {
        shellNodes.push(impNode(node, 'turret_model', p, i, t.pivot));
        top = Math.max(top, p.hi[1]);
      }
    }
    const guns = t.guns.map((g, gi) => {
      const fixed = new GeoBuilder();
      const moving = new GeoBuilder();
      // rounds carried on the outside (rockets on their rails): one piece per round, hidden once fired
      const carried = [];
      for (const p of parts) {
        if (p.mount !== 'gun' || (p.gun || 0) !== gi) continue;
        if (p.payload != null) {
          if (!carried[p.payload]) carried[p.payload] = new GeoBuilder();
          addPart(carried[p.payload], p, g.trunnion, mats);
          continue;
        }
        addPart(p.recoil ? moving : fixed, p, g.trunnion, mats, (g.def?.caliber_mm || 0) / 2000);
      }
      const gn = node.add(new Node('gun_' + gi));
      gn.pos = [g.trunnion[0] - t.pivot[0], g.trunnion[1] - t.pivot[1], g.trunnion[2] - t.pivot[2]];
      shellNodes.push(meshNode('gun_mount', gn, fixed));
      const barrel = meshNode('barrel', gn, moving);
      shellNodes.push(barrel);
      const rounds = carried.map((bd, k) => (bd ? meshNode('payload_' + k, gn, bd) : null));
      for (const r of rounds) if (r) shellNodes.push(r);
      {
        // the imported model's pieces of this gun (p.gun: which gun of the turret, 0 by default)
        const mine = (p) => (p.gun || 0) === gi && (p.turret || 0) === ti;
        for (const [p, i] of impParts('gun', mine)) {
          shellNodes.push(impNode(gn, 'gun_model', p, i, g.trunnion));
          top = Math.max(top, p.hi[1]);
        }
        for (const [p, i] of impParts('barrel', mine)) shellNodes.push(impNode(barrel, 'barrel_model', p, i, g.trunnion));
      }
      return { node: gn, barrel, rounds };
    });
    turrets.push({ node, guns });
  });

  // ---- roof pintles: fixed casemates carry the post on the hull; normal turrets carry it with them
  const mgs = [];
  (loadout.machineGuns || []).forEach((mg, mi) => {
    if (mg.mount !== 'pintle') return;
    const t = loadout.turrets[0];
    const hullMounted = mg.anchor === 'hull';
    const tn = hullMounted ? body : turrets[0].node;
    const rel = hullMounted ? mg.pos.slice() : [mg.pos[0] - t.pivot[0], mg.pos[1] - t.pivot[1], mg.pos[2] - t.pivot[2]];
    const post = new GeoBuilder();
    const pl = mg.post ?? 0.34;
    post.cyl(translation(0, -pl / 2, 0), false, 'y', 0.035, 0.028, pl, 10, mats.steel);
    post.cyl(translation(0, -pl + 0.015, 0), false, 'y', 0.07, 0.07, 0.03, 12, mats.paint_dark);
    const pn = meshNode('mg_post', tn, post);
    pn.pos = rel;
    // the gun itself, after the real one's proportions where we have them (DShK, M2HB)
    mg.displayVariant = visual.mg_variants?.[mg.id] || null;
    const { geo: gun, muzzle, muzzleVector } = pintleGun(mg.weapon, mg.def.caliber_mm, mats, mg.displayVariant);
    // Bind render-derived bore metadata once for the runtime firing path.
    mg.muzzleVector = muzzleVector;
    mg.muzzleOffset = muzzle;
    if (mg.shield) {
      // the shield on the mount, turning with the gun: two plates either side of the barrel's
      // slot and the plate under it
      const [w, h, ahead] = mg.shield;
      const slot = 0.06;
      const side = (w - slot) / 2;
      const y0 = -0.11;
      for (const sx of [-1, 1]) gun.box(translation(sx * (slot / 2 + side / 2), y0 + h / 2, ahead), false, [side, h, 0.012], mats.paint_dark);
      gun.box(translation(0, y0 + 0.065, ahead), false, [slot, 0.13, 0.012], mats.paint_dark);
    }
    const gn = meshNode('mg_gun', tn, gun);
    gn.pos = rel;
    shellNodes.push(pn, gn);
    mgs.push({ index: mi, node: gn, post: pn, anchor: hullMounted ? 'hull' : 'turret', muzzle, muzzleVector });
  });

  // ---- an armoured car: tyres on their axles, steered and sprung, no tracks
  if (visual.running_gear && visual.running_gear.kind === 'wheels') {
    return Object.assign(wheeledGear({ renderer, visual, vehicle, mats, meshes, root, running, body, hull, shellNodes, turrets, mgs, impParts, impNode, top, hullLow, hullBuilder, importedTris: () => importedTris }), {
      setFold,
      hasFlaps: hinges.length > 0,
      payload(ti, gi, left) {
        const g = turrets[ti] && turrets[ti].guns[gi];
        if (g) g.rounds.forEach((r, k) => r && (r.visible = k < left));
      },
    });
  }

  // ---- running gear: road wheels on their stations, sprocket, idler, rollers, and the track as
  // one instanced mesh of separate links for both sides
  const rg = visual.running_gear;
  const stations = stationsOf(rg);
  const stationIndex = (z) => stations.findIndex((s) => Math.abs(s.z - z) < 1e-3);
  const staticLoop = buildLoop(rg, stations, null, rg.track_sag ?? ((rg.rollers || []).length ? 0.012 : 0.03));
  const linkCount = Math.max(8, Math.round(staticLoop.length / (rg.link_pitch || 0.14)));
  const pitch = staticLoop.length / linkCount;
  const teeth = Math.max(8, Math.round((Math.PI * 2 * (rg.sprocket.r + rg.track_thickness / 2)) / pitch));
  const idlerTeeth = rg.idler.teeth ? Math.max(8, Math.round((Math.PI * 2 * (rg.idler.r + rg.track_thickness / 2)) / pitch)) : 0;
  const wheels = [];
  const cache = new Map();
  const shared = (key, make, wheelRadius = 0) => {
    if (!cache.has(key)) {
      const geometry = make();
      const m = renderer.mesh(geometry);
      if (wheelRadius) {
        let lo = Infinity, hi = -Infinity;
        // Dished plates and bolt heads project past the tyre face. The small
        // central hub is an intentional axle connection and is excluded here.
        for (let i = 0; i < geometry.length; i += 13) {
          if (Math.hypot(geometry[i + 1], geometry[i + 2]) <= wheelRadius * .30) continue;
          lo = Math.min(lo, geometry[i]); hi = Math.max(hi, geometry[i]);
        }
        m.gearFace = [lo, hi];
      }
      meshes.push(m);
      cache.set(key, m);
    }
    return cache.get(key);
  };
  const trackMat = { ...mats.track };
  const trackMesh = renderer.instancedMesh(linkGeometry(rg, pitch, trackMat, mats.rubber), linkCount * 2);
  meshes.push(trackMesh);
  const trackNode = running.add(new Node('tracks'));
  trackNode.mesh = trackMesh;
  trackNode.kind = 5;
  const sides = [];
  for (const side of [1, -1]) {
    const addWheel = (name, spec, mesh, kind = 0, index = 0) => {
      const n = running.add(new Node(name));
      n.baseY = spec.y;
      n.pos = [side * (rg.track_x + (spec.x || 0)), spec.y, spec.z];
      // the imported model's own wheel, turning on the same axle, in place of the built-in one
      const own = impParts(name, (p) => p.side === side && p.index === index);
      if (own.length) {
        for (const [p, i] of own) impNode(n, name + '_model', p, i, n.pos);
        n.imported = true;
      } else {
        n.mesh = mesh;
        n.kind = kind;
      }
      const w = { node: n, r: spec.r, side, role: name, station: name === 'road_wheel' ? stationIndex(spec.z) : -1 };
      wheels.push(w);
      return w;
    };
    rg.wheels.forEach((w, k) => {
      addWheel('road_wheel', w, shared(`w${w.r}_${w.w}`, () => wheelGeometry(w.r, w.w, rg.wheel_style, mats), w.r), 0, k);
    });
    const sg = () => sprocketGeometry(rg, teeth, pitch, mats, side);
    const sprocket = addWheel('sprocket', rg.sprocket, shared('sprocket_body' + side, () => sg().body));
    if (!sprocket.node.imported) {
      const ring = sprocket.node.add(new Node('sprocket_teeth'));
      ring.mesh = shared('sprocket_teeth', () => sg().teeth);
      ring.kind = 5;
    }
    const idler = addWheel('idler', rg.idler, shared('idler', () => wheelGeometry(rg.idler.r, rg.track_width * 0.6, 'steel_dish', mats)));
    if (idlerTeeth && !idler.node.imported) {
      const ring = idler.node.add(new Node('idler_teeth'));
      ring.mesh = shared('idler_teeth', () => sprocketGeometry({ ...rg, sprocket: rg.idler }, idlerTeeth, pitch, mats, side).teeth);
      ring.kind = 5;
    }
    (rg.rollers || []).forEach((rl, k) => {
      addWheel('return_roller', rl, shared(`r${rl.r}_${rl.w}`, () => wheelGeometry(rl.r, rl.w, 'rubber_dish', mats)), 0, k);
    });
    sides.push({ side, sprocket, idler, idlerPhaseLoop: { front: staticLoop.front, rear: staticLoop.rear, sprocketFront: !staticLoop.sprocketFront } });
  }
  const matrices = new Float32Array(linkCount * 2 * 16);
  const pins = new Float32Array((linkCount + 1) * 2);
  const gearSupports = !imp && hullBuilder.vertexCount ? buildGearSupports(renderer, running, hullBuilder.data, wheels, rg, mats, meshes, vehicle.physics?.suspension?.kind) : null;
  if (gearSupports) shellNodes.push(...gearSupports.nodes);

  /**
   * Places everything that moves under the hull.
   * dyn: {lifts: {1: [...], -1: [...]} per station: wheel height against the hull, from static,
   *       travel: {1, -1} metres the track has run,
   *       slack: {1, -1} how the drive tension shifts the droop of the upper run (1 = neutral),
   *       ground: {1, -1} optional functions z -> ground height under that track, hull frame,
   *       lod: 0 near (track wrapped round the wheels and over the ground), 1 middle distance
   *            (round the wheels only), 2 far (the resting loop, links still running)}
   */
  function updateRunningGear(dyn) {
    let o = 0;
    const lod = dyn.lod || 0;
    for (const sd of sides) {
      const side = sd.side;
      const lifts = lod >= 2 ? level : dyn.lifts[side];
      const loop = lod >= 2 ? staticLoop : fitLoop(rg, stations, lifts, lod === 0 && dyn.ground ? dyn.ground[side] : null, staticLoop.length, dyn.slack ? dyn.slack[side] : 1);
      // the ground run stands still on the ground, so seen from the hull it runs backwards
      o = placeLinks(loop, linkCount, -dyn.travel[side], side * rg.track_x, matrices, o, pins);
      sd.sprocket.node.pitch = sprocketPhase(loop, pins, linkCount, rg.sprocket, teeth);
      if (idlerTeeth && !sd.idler.node.imported) {
        sd.idlerPhaseLoop.front = loop.front;
        sd.idlerPhaseLoop.rear = loop.rear;
        sd.idlerPhaseLoop.sprocketFront = !loop.sprocketFront;
        sd.idler.node.pitch = sprocketPhase(sd.idlerPhaseLoop, pins, linkCount, rg.idler, idlerTeeth);
      }
      sd.length = loop.length;
      sd.idlerShift = loop.idlerShift || 0;
    }
    renderer.setInstances(trackMesh, matrices, linkCount * 2);
    for (const w of wheels) {
      if (w.station >= 0) w.node.pos[1] = w.node.baseY + (lod >= 2 ? 0 : dyn.lifts[w.side][w.station]);
      if (w.role === 'idler') w.node.pos[2] = rg.idler.z + (sides.find((sd) => sd.side === w.side).idlerShift || 0);
      if (w.role !== 'sprocket' && !(w.role === 'idler' && idlerTeeth && !w.node.imported)) w.node.pitch = (dyn.travel[w.side] / w.r) % (Math.PI * 2);
    }
    if (gearSupports) gearSupports.update();
  }
  const baseSag = rg.track_sag ?? ((rg.rollers || []).length ? 0.012 : 0.03);
  const level = stations.map(() => 0);
  updateRunningGear({ lifts: { 1: level, [-1]: level }, travel: { 1: 0, [-1]: 0 } });


  return {
    root,
    running,
    body,
    hull,
    shellNodes,
    turrets,
    mgs,
    wheels,
    stations,
    runningGear: rg,
    trackX: rg.track_x,
    baseSag,
    sprocketFront: staticLoop.sprocketFront,
    linkCount,
    linkPitch: pitch,
    updateRunningGear,
    /** Folds the hinged flaps: 0 up (closed), 1 down. */
    setFold,
    hasFlaps: hinges.length > 0,
    /** Shows the rounds still on turret ti's gun gi (the first `left` of them). */
    payload(ti, gi, left) {
      const g = turrets[ti] && turrets[ti].guns[gi];
      if (g) g.rounds.forEach((r, k) => r && (r.visible = k < left));
    },
    height: top,
    // the hull's floor (lowest point of the hull shape), for the belly contacts
    hullBottom: visual.hull_bottom ?? (Number.isFinite(hullLow) ? hullLow : 0.4),
    length: vehicle.hull.size_m[2],
    width: vehicle.hull.size_m[0],
    imported: !!imp,
    triangles: meshes.reduce((s, m) => s + m.count / 3, 0) + importedTris,
    dispose() {
      for (const m of meshes) renderer.freeMesh(m);
    },
  };
}

/**
 * A military tyre on its rim, axle along x, the hub on the outer side (`side` +1 right): a fat
 * rubber band with chunky tread lugs round it, the steel disc wheel with its nuts.
 */
function tyreGeometry(r, w, mats, side) {
  const b = new GeoBuilder();
  b.cyl(translation(0, 0, 0), false, 'x', r * 0.93, r * 0.93, w * 0.96, 28, mats.rubber);
  // shoulders: the tyre bulges a little at its sidewalls
  for (const sx of [-1, 1]) b.cyl(translation((sx * w) / 2 - sx * 0.02, 0, 0), false, 'x', r * 0.86, r * 0.9, 0.04, 28, mats.rubber);
  const lugs = Math.max(16, Math.round((2 * Math.PI * r) / 0.11));
  for (let i = 0; i < lugs; i++) {
    const a = (i / lugs) * Math.PI * 2;
    // directional lugs: two staggered rows
    for (const sx of [-1, 1]) {
      const m = mul(rotX(a), translation(sx * w * 0.24 + (i % 2 ? 0.015 : -0.015) * sx, r * 0.955, 0));
      b.box(m, false, [w * 0.42, r * 0.07, 0.045], mats.rubber);
    }
  }
  // the disc wheel: dish, hub, nuts, on the outer face
  const o = side * w * 0.36;
  b.cyl(translation(o, 0, 0), false, 'x', r * 0.56, r * 0.5, w * 0.3, 22, mats.paint);
  b.cyl(translation(o + side * w * 0.16, 0, 0), false, 'x', r * 0.22, r * 0.18, 0.06, 16, mats.paint_dark);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.cyl(translation(o + side * w * 0.17, Math.sin(a) * r * 0.3, Math.cos(a) * r * 0.3), false, 'x', 0.018, 0.018, 0.04, 6, mats.steel);
  }
  return b.build();
}

/** The running gear of a wheeled vehicle, and the rest of buildTank's result for it. */
function wheeledGear(o) {
  const { renderer, visual, vehicle, mats, meshes, running, root, body, hull, shellNodes, turrets, mgs } = o;
  const rg = visual.running_gear;
  const wheels = [];
  const cache = new Map();
  for (const side of [1, -1]) {
    rg.axles.forEach((a, k) => {
      const key = `${a.r}_${a.w}_${side}`;
      if (!cache.has(key)) {
        const m = renderer.mesh(tyreGeometry(a.r, a.w, mats, side));
        meshes.push(m);
        cache.set(key, m);
      }
      const n = running.add(new Node('road_wheel'));
      n.baseY = a.y;
      n.pos = [side * a.x, a.y, a.z];
      const own = o.impParts('road_wheel', (p) => p.side === side && p.index === k);
      if (own.length) for (const [p, i] of own) o.impNode(n, 'road_wheel_model', p, i, n.pos);
      else n.mesh = cache.get(key);
      wheels.push({ node: n, r: a.r, side, role: 'road_wheel', station: -1, axle: k });
    });
  }
  /** dyn.wheels: per wheel (right side's axles, then the left's) {lift, spin, steer}. */
  function updateRunningGear(dyn) {
    const list = dyn.wheels || [];
    wheels.forEach((w, i) => {
      const d = list[i];
      if (!d) return;
      w.node.pos[1] = w.node.baseY + (dyn.lod >= 2 ? 0 : d.lift);
      w.node.yaw = d.steer;
      w.node.pitch = d.spin;
    });
  }
  updateRunningGear({ wheels: wheels.map(() => ({ lift: 0, spin: 0, steer: 0 })) });
  const x = Math.max(...rg.axles.map((a) => a.x));
  const hb = o.hullBuilder;
  return {
    root,
    running,
    body,
    hull,
    shellNodes,
    turrets,
    mgs,
    wheels,
    stations: [],
    runningGear: rg,
    wheeled: true,
    trackX: x,
    baseSag: 0,
    sprocketFront: false,
    linkCount: 0,
    linkPitch: 0,
    updateRunningGear,
    height: o.top,
    hullBottom: visual.hull_bottom ?? (Number.isFinite(o.hullLow) ? o.hullLow : hb.vertexCount ? hb.min[1] : 0.4),
    length: vehicle.hull.size_m[2],
    width: vehicle.hull.size_m[0],
    imported: false,
    triangles: meshes.reduce((sum, m) => sum + m.count / 3, 0) + o.importedTris(),
    dispose() {
      for (const m of meshes) renderer.freeMesh(m);
    },
  };
}

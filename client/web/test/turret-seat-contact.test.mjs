import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadData } from '../tools/load-data.mjs';
import { runtimeParts, touches, surfaceCrossings } from '../tools/procedural-fleet-audit.mjs';
import { buildToBundle, newTurretSpec, exportFolder, makeLoadout } from '../src/game/loadout.js';
import { decodeAllImported, decodeImported } from '../src/gfx/imported.js';
import { Mods } from '../src/game/mods.js';
import { workshopTurretSeat } from '../src/game/turretSeat.js';
import { foldYawLimit } from '../src/game/folding.js';
import { seatSupportChain, auditTurretSeats } from '../tools/turret-seat-audit.mjs';

const data = loadData();
await decodeAllImported(data.vehicles);
const cases = [
  ['de_tiger_e', 29], ['de_panther_g', 14], ['de_panther_f', 14],
  ['us_m4a1_76w', 32], ['us_m4a3_76w_hvss', 18],
];

// Follow real triangle contacts from the complete shell. A detached seat touching
// the hull is insufficient: the complete shell must reach that seat and the hull.
function reachesHull(pieces, shell) {
  return seatSupportChain(pieces, { parent: null }, shell.ti, shell).supported;
}

for (const [id, shellIndex] of cases) test(`${id}: complete turret shell has a hollow bearing path to the hull at 0/90/180 degrees`, () => {
  const rt = runtimeParts(id, data);
  for (const deg of [0, 90, 180]) {
    const pieces = rt.at({ yaw: deg * Math.PI / 180 });
    const shell = pieces.find(p => p.id === `visual#${shellIndex}`);
    assert.ok(reachesHull(pieces, shell), `${id}/${deg}: detached complete shell`);
    const collar = pieces.find(p => p.part.name === 'turret_seat_collar');
    assert.ok(collar, `${id}/${deg}: measured bearing collar`);
    assert.equal(collar.part.type, 'loft');
    assert.deepEqual(collar.part.caps, [false, false], 'central crew/basket passage remains open');
    const [cx, , cz] = rt.loadout.turrets[0].pivot;
    for (const ring of collar.part.rings) for (const [x, , z] of ring)
      assert.ok(Math.hypot(x - cx, z - cz) > .75, 'collar must not fill the turret interior');
    assert.ok(touches(collar, shell), `${id}/${deg}: collar supports complete shell`);
    assert.ok(pieces.some(p => p !== collar && p.part.mount === 'hull' && touches(collar, p)), `${id}/${deg}: collar reaches hull`);
  }
});

test('seat repairs retain every vehicle, firing, armor, module and crew datum', () => {
  const protectedData = cases.map(([id]) => Object.fromEntries(Object.entries(data.vehicles[id]).filter(([k]) => k !== 'visual')));
  assert.equal(createHash('sha256').update(JSON.stringify(protectedData)).digest('hex'), '38f6bb58ba1e27023c8bf99a7b186392b96542bb2c4dde4dc436941641487478');
});

test('W78 tall pedestal remains a valid support rather than being flattened into the deck', () => {
  const rt = runtimeParts('xp_w78', data);
  for (const deg of [0, 90, 180]) {
    const pieces = rt.at({ yaw: deg * Math.PI / 180 });
    assert.ok(reachesHull(pieces, pieces.find(p => p.id === 'visual#1')));
    const pedestal = pieces.find(p => p.id === 'visual#9');
    assert.ok(pedestal.hi[1] - pedestal.lo[1] > .23);
  }
});

for (const keepStock of [false, true]) test(`Hetzer workshop ${keepStock ? 'added' : 'replacement'} center head retains a physical hull path`, () => {
  const made = buildToBundle({ base: 'de_hetzer', keepStock, turrets: [{ ...newTurretSpec(-.05), lift: .12, ring: 1.2 }] }, data);
  const workshop = { ...data, vehicles: { seat_workshop: made.bundle }, projectiles: { ...data.projectiles, ...made.projectiles } };
  const rt = runtimeParts('seat_workshop', workshop);
  const ti = keepStock ? 1 : 0;
  for (const deg of [0, 90, 180]) {
    const pieces = rt.at({ turret: ti, yaw: deg * Math.PI / 180 });
    assert.ok(reachesHull(pieces, pieces.find(p => p.id === 'generated#0' && p.ti === ti)));
  }
});

for (const base of ['de_hetzer', 'de_hetzer_mk103']) for (const keepStock of [false, true])
  for (const z of [-2, ...(base === 'de_hetzer' ? [2] : [0])]) for (const lift of [0, .3])
    test(`${base} workshop ${keepStock ? 'added' : 'replacement'} .8m seat at z${z}/lift${lift} reaches the real fixed roof`, async () => {
      const saved = new Map(), mods = new Mods({ get: k => saved.get(k), set: (k, v) => saved.set(k, v) }, 'seat', id => !!data.vehicles[id]);
      mods.choose(base);
      const selected = mods.variantOf('de_hetzer');
      assert.equal(selected, base);
      const build = { base: selected, keepStock, turrets: [{ ...newTurretSpec(z), ring: .8, lift }] };
      const original = structuredClone(data.vehicles[base].vehicle);
      const made = buildToBundle(build, data);
      const workshop = { ...data, vehicles: { seat_workshop: made.bundle }, projectiles: { ...data.projectiles, ...made.projectiles } };
      const rt = runtimeParts('seat_workshop', workshop), ti = made.stats.stockTurrets;
      assert.deepEqual(rt.loadout.turrets[ti].pivot, [0, original.hull.size_m[1] + lift, z], 'existing custom coordinates remain stable');
      for (const deg of [0, 90, 180]) {
        const pieces = rt.at({ turret: ti, yaw: deg * Math.PI / 180 });
        const shell = pieces.find(p => p.id === 'generated#0' && p.ti === ti);
        const seat = pieces.find(p => p.part.name === 'workshop_turret_seat');
        assert.ok(seat, 'custom seat derived from real roof');
        assert.ok(touches(seat, shell), 'seat supports complete generated shell');
        assert.ok(pieces.some(p => p !== seat && p.part.mount === 'hull' && !p.part.hinge && touches(seat, p)), 'seat meets fixed roof triangles');
        assert.ok(seat.part.rings.flat().every(([x, , zz]) => Math.hypot(x, zz - z) >= .31), 'central passage remains hollow');
        assert.ok(rt.model.shellNodes.includes(rt.model.hull), 'seat belongs to the disposable/fading hull mesh');
      }
      const exported = exportFolder(build, data, data.vehicles[base], 'seat_export', 'seat regression');
      const files = exported.files;
      const reloaded = { vehicle: files['vehicle.json'], weapons: files['weapons.json'], engine: files['engine.json'], visual: files['visual.json'] };
      if (files['model.json']) reloaded.imported = await decodeImported(files['model.json']);
      const loadout = makeLoadout('seat_export', reloaded, { ...data.projectiles, ...made.projectiles }, data.machineGuns);
      assert.deepEqual(loadout.turrets[ti].pivot, rt.loadout.turrets[ti].pivot);
      assert.deepEqual(reloaded.visual.parts.filter(p => p.name === 'workshop_turret_seat'), made.bundle.visual.parts.filter(p => p.name === 'workshop_turret_seat'));
      const roundTrip = runtimeParts('seat_export', { ...workshop, vehicles: { seat_export: reloaded } });
      for (const deg of [0, 90, 180]) {
        const pieces = roundTrip.at({ turret: ti, yaw: deg * Math.PI / 180 });
        const seat = pieces.find(p => p.part.name === 'workshop_turret_seat');
        assert.ok(touches(seat, pieces.find(p => p.id === 'generated#0' && p.ti === ti)));
        assert.ok(pieces.some(p => p !== seat && p.part.mount === 'hull' && !p.part.hinge && touches(seat, p)));
      }
      roundTrip.model.dispose();
      assert.deepEqual(data.vehicles[base].vehicle, original, 'stock base is not mutated');
      rt.model.dispose();
    });

test('T10 parent turret retains its source 3mm rotation seam and follows the actual parent node', () => {
  const rt = runtimeParts('su_t10m', data);
  assert.equal(rt.loadout.turrets[1].parent, 0);
  for (const deg of [0, 90, 180]) {
    const pieces = rt.at({ turret: 0, yaw: deg * Math.PI / 180 });
    const head = pieces.find(p => p.id === 'imported#12');
    const bearing = pieces.find(p => p.id === 'imported#15');
    assert.ok(touches(head, bearing));
    assert.ok(Math.abs(head.lo[1] - bearing.hi[1] - .003) < 1e-6, 'normal source seam remains');
  }
});

test('custom support probes reject MG, moving gear and hinged faces as false fixed roofs', () => {
  const fake = { visual: { palette: {}, parts: [
    { type: 'box', mount: 'hull', size: [1, .2, 1], pos: [9, 1, 9] },
    ...['mg', 'road_wheel', 'turret', 'gun', 'barrel'].map(mount => ({ type: 'box', mount, size: [2, .2, 2], pos: [0, 1, 0] })),
    { type: 'box', mount: 'hull', hinge: { a: [0, 0, 0], b: [1, 0, 0], angle: 90 }, size: [2, .2, 2], pos: [0, 1, 0] },
  ] } };
  const seat = workshopTurretSeat(fake, { position_m: [0, 2, 0], ring_diameter_m: .8 });
  assert.equal(seat.part, null, 'must not create a pillar ending on a moving/MG/hinged face');
  assert.deepEqual(seat.support, { status: 'unsupported', samples: 0 });
});

for (const [id, shellIndex, baseIndex] of [['de_hetzer_flak', 23, 22], ['de_rso_flak', 32, 31], ['de_rso_pak40', 32, 31]])
  test(`${id}: complete fixed carriage reaches its turntable without borrowing a crew cushion`, () => {
    const rt = runtimeParts(id, data);
    for (const deg of [0, 90, 180]) {
      const t = rt.loadout.turrets[0], yaw = deg * Math.PI / 180;
      const limits = rt.model.hasFlaps ? foldYawLimit(t, 1) : t.limit;
      if (limits && (yaw < limits[0] || yaw > limits[1])) continue;
      const pieces = rt.at({ yaw, fold: 1 }).filter(p => !p.part.name?.startsWith('crew_clearance'));
      const fixedPieces = pieces.filter(p => !['gun', 'barrel'].includes(p.part.mount));
      assert.ok(reachesHull(fixedPieces, fixedPieces.find(p => p.id === `visual#${shellIndex}`)), `${id}/${deg}: unsupported fixed carriage`);
      const base = pieces.find(p => p.id === `visual#${baseIndex}`);
      if (id !== 'de_rso_pak40') assert.ok(touches(base, pieces.find(p => p.id === `visual#${shellIndex}`)), 'side-frame foot reaches original turntable');
      else {
        const fork = pieces.find(p => p.part.name === 'pak40_elevation_fork');
        const pins = pieces.find(p => p.part.name === 'pak40_elevation_pins');
        const stays = pieces.find(p => p.part.name === 'pak40_shield_stays');
        assert.ok(touches(base, fork));
        assert.ok(touches(fork, stays));
        assert.ok(touches(stays, pieces.find(p => p.id === 'visual#32')), 'shield has a fixed structural connection independent of the recuperator');
        for (const pitch of [-t.guns[0].def.max_depression_deg, 0, t.guns[0].def.max_elevation_deg]) {
          const pose = rt.at({ yaw, fold: 1, pitch: pitch * Math.PI / 180 });
          const pin = pose.find(p => p.id === pins.id), cradle = pose.find(p => p.id === 'visual#34');
          assert.ok(touches(pin, cradle), 'elevation shaft remains engaged in the original moving cradle');
        }
      }
    }
  });

test('open carriage support repairs preserve all combat and crew data', () => {
  const protectedData = ['de_hetzer_flak', 'de_rso_flak', 'de_rso_pak40'].map(id =>
    Object.fromEntries(Object.entries(data.vehicles[id]).filter(([k]) => k !== 'visual')));
  assert.equal(createHash('sha256').update(JSON.stringify(protectedData)).digest('hex'), 'fed909ecbcf49983ef7c7406b7d5515e48805d71e4847b0dc7fbd1e368939ee0');
});

test('all eight repaired stock bundles preserve the combined combat and crew receipt', () => {
  const ids = [...cases.map(([id]) => id), 'de_hetzer_flak', 'de_rso_flak', 'de_rso_pak40'];
  const protectedData = ids.map(id => Object.fromEntries(Object.entries(data.vehicles[id]).filter(([k]) => k !== 'visual')));
  assert.equal(createHash('sha256').update(JSON.stringify(protectedData)).digest('hex'), '21482f7ad59bdfb762d86abdce99c6b664618c7f51511a8112ae20136f75e6c8');
});

test('a hull-touching loose ring cannot certify a detached complete shell', () => {
  const bundle = structuredClone(data.vehicles.us_m4a3_76w_hvss);
  bundle.visual.parts[17] = { type: 'cyl', mount: 'turret', mat: 'paint_dark', axis: 'y', r: .95, len: .06, pos: [0, 1.828, -.05], segs: 28 };
  const rt = runtimeParts('detached', { ...data, vehicles: { detached: bundle } });
  const pieces = rt.at();
  assert.ok(pieces.some(p => p.part.mount === 'hull' && touches(pieces.find(p => p.id === 'visual#17'), p)), 'loose ring still reaches hull');
  assert.equal(seatSupportChain(pieces, rt.loadout.turrets[0], 0).supported, false, 'complete shell remains detached');
});

test('all 42 stock bundles and their extra/parent assemblies have reviewed true-triangle support', () => {
  for (const id of data.order) {
    const audit = auditTurretSeats(id, data);
    assert.ok(audit.poses.length, `${id}: real nodes inspected`);
    if (id === 'xp_bmp_k64') {
      assert.ok(audit.poses.every(p => !p.supported), 'preserve supplied 13mm source rotation seam as reviewed candidate');
    } else assert.ok(audit.poses.every(p => p.supported), `${id}: detached assembly`);
  }
});

test('PaK fixed fork and shield stays clear the original moving weapon throughout elevation and recoil', () => {
  const rt = runtimeParts('de_rso_pak40', data), gun = rt.loadout.turrets[0].guns[0];
  for (const yaw of [0, Math.PI / 2, Math.PI]) for (let pitch = -gun.def.max_depression_deg; pitch <= gun.def.max_elevation_deg; pitch++)
    for (const recoil of [0, .5, 1]) {
      const pieces = rt.at({ yaw, pitch: pitch * Math.PI / 180, recoil, fold: 1 });
      const fixed = pieces.filter(p => ['pak40_elevation_fork', 'pak40_shield_stays'].includes(p.part.name));
      for (const p of fixed) for (const q of pieces.filter(p => p.part.mount === 'gun'))
        assert.equal(surfaceCrossings(p, q).count, 0, `${yaw}/${pitch}/${recoil}: ${p.part.name} crosses ${q.id}`);
    }
});

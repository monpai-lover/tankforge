// The combat model (crates/combat through the WebAssembly core) on the real vehicles and shells.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCoreSync } from '../src/design/core.js';
import { loadData } from '../tools/load-data.mjs';
import { Combat, bulletShell, ammoCapacity, emptyRacks } from '../src/game/combat.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = loadData();
const core = loadCoreSync(fs.readFileSync(path.join(here, '../assets/tg_design.wasm')), { materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains) });
const combat = new Combat(core);
const P = data.projectiles;

/** Level from the right side at the height and length of a crew member's seat. */
function sideShot(bundle, shell, role, seed, dist = 500) {
  const c = bundle.crew.find((x) => x.role === role) || bundle.crew[0];
  return { shell, origin: [40, c.pos.y, c.pos.z], dir: [-1, 0, 0], speed_ms: shell.muzzle_velocity_ms * 0.85, distance_m: dist, seed, turret_yaw: 0 };
}

test('combat: an 88 mm PzGr 39 through a Sherman side bursts inside and puts crew out', () => {
  const sherman = data.vehicles.us_m4a3_75w;
  let killed = 0;
  let bursts = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const st = combat.fresh('us_m4a3_75w', sherman).state;
    const r = combat.shoot('us_m4a3_75w', st, sideShot(sherman, P.apcbc_88_l56, 'gunner', seed));
    assert.equal(r.outcome, 'penetrated', JSON.stringify(r.layers));
    bursts += r.bursts.filter((b) => b.inside).length;
    killed += r.crew.filter((c) => c.killed).length;
  }
  assert.ok(bursts >= 8, `bursts ${bursts}`);
  assert.ok(killed >= 10, `crew put out in 10 shots: ${killed}`);
});

test('combat: HE against a Tiger front does nothing inside; low on the side it breaks the track', () => {
  const tiger = data.vehicles.de_tiger_e;
  const st = combat.fresh('de_tiger_e', tiger).state;
  const front = combat.shoot('de_tiger_e', st, { shell: P.he_75_m48, origin: [0.2, 1.6, 40], dir: [0, 0, -1], speed_ms: 450, distance_m: 600, seed: 3, turret_yaw: 0 });
  assert.equal(front.outcome, 'blast');
  assert.equal(front.crew.length, 0);
  const trackMod = tiger.modules.find((m) => m.kind === 'track' && m.center.x > 0);
  const low = combat.shoot('de_tiger_e', st, { shell: P.he_122_of471, origin: [40, trackMod.center.y, trackMod.center.z], dir: [-1, 0, 0], speed_ms: 600, distance_m: 600, seed: 4, turret_yaw: 0 });
  assert.ok(low.events.includes('track_right'), JSON.stringify(low.events));
  assert.equal(low.caps.track_right, false);
});

test('combat: a machine gun cannot hurt a closed tank but reaches into an open-topped M10', () => {
  const mg = bulletShell(data.machineGuns.m2hb || Object.values(data.machineGuns).find((m) => m.caliber_mm > 12));
  const sherman = data.vehicles.us_m4a3_75w;
  const st = combat.fresh('us_m4a3_75w', sherman).state;
  const r = combat.shoot('us_m4a3_75w', st, sideShot(sherman, mg, 'gunner', 1, 100));
  assert.ok(['stopped', 'ricochet'].includes(r.outcome) && r.crew.length === 0, r.outcome);
  const m10 = data.vehicles.us_m10;
  const s10 = combat.fresh('us_m10', m10).state;
  // from above the open turret, down onto the gunner
  const g = m10.crew.find((c) => c.role === 'gunner');
  const r2 = combat.shoot('us_m10', s10, { shell: mg, origin: [g.pos.x, g.pos.y + 20, g.pos.z], dir: [0, -1, 0], speed_ms: 800, distance_m: 100, seed: 2, turret_yaw: 0 });
  assert.ok(r2.crew.some((c) => c.damage > 30), JSON.stringify({ outcome: r2.outcome, crew: r2.crew, plate: r2.plate }));
});

test('combat: the state carries over, repairs take time and fix the engine', () => {
  const t34 = data.vehicles.su_t34_85;
  const eng = t34.modules.find((m) => m.kind === 'engine');
  // from behind into the engine bay, until a shot stops the engine without destroying the tank
  // (a wreck cannot be repaired: the call says so)
  let r = null;
  let wrecks = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const fresh = combat.fresh('su_t34_85', t34).state;
    r = combat.shoot('su_t34_85', fresh, { shell: P.apcbc_75_pzgr39_42, origin: [eng.center.x, eng.center.y, -40], dir: [0, 0, 1], speed_ms: 700, distance_m: 300, seed, turret_yaw: 0 });
    assert.equal(r.outcome, 'penetrated');
    if (r.caps.destroyed) {
      wrecks++;
      assert.equal(combat.repair('su_t34_85', r.state).ok, false);
      continue;
    }
    if (r.caps.engine_power === 0) break;
  }
  assert.ok(wrecks < 40, 'some shot leaves the tank to be repaired');
  let st = r.state;
  if (r.caps.engine_power === 0 && !r.caps.destroyed) {
    const rep = combat.repair('su_t34_85', st);
    assert.ok(rep.ok && rep.state.repair_s > 0);
    st = rep.state;
    let caps = rep.caps;
    for (let i = 0; i < 80 && caps.repair_s > 0; i++) ({ state: st, caps } = combat.advance('su_t34_85', st, 0.5, i));
    assert.ok(caps.engine_power > 0, JSON.stringify(caps));
  }
});

test('combat: every vehicle can be registered and shot', () => {
  for (const [id, b] of Object.entries(data.vehicles)) {
    const st = combat.fresh(id, b).state;
    const r = combat.shoot(id, st, sideShot(b, P.apcbc_76_m62, 'driver', 1));
    assert.ok(r.hit, id);
    assert.ok(typeof r.title === 'string' && r.title.length > 0, id);
  }
});

test('combat: a short load leaves the upper racks empty, and an empty rack is never hit', () => {
  const t34 = data.vehicles.su_t34_85;
  const racks = t34.modules.map((m, i) => [m, i]).filter(([m]) => m.kind === 'ammo_rack');
  assert.ok(racks.length >= 2);
  const full = combat.fresh('su_t34_85', t34).state;
  assert.equal(ammoCapacity(t34.weapons), 60);
  const st = combat.ammo('su_t34_85', full, 12).state;
  const empty = emptyRacks(t34, st);
  assert.ok(empty.size > 0 && empty.size < racks.length, [...empty].join());
  // the empty ones are the highest; the lowest rack keeps its rounds
  const lowest = racks.reduce((a, b) => (b[0].center.y < a[0].center.y ? b : a));
  assert.ok(!empty.has(lowest[0].id));
  for (const id of empty) {
    const m = t34.modules.find((x) => x.id === id);
    for (let seed = 1; seed <= 6; seed++) {
      const side = Math.sign(m.center.x) || 1;
      const r = combat.shoot('su_t34_85', st, { shell: P.apcbc_88_l56, origin: [side * 40, m.center.y, m.center.z], dir: [-side, 0, 0], speed_ms: 750, distance_m: 300, seed, turret_yaw: 0 });
      assert.ok(!r.modules.some((x) => x.id === id) && !r.events.includes('ammo_detonation'), `${id} seed ${seed}: ${r.events}`);
    }
  }
  // all 60 rounds on board: every rack full again
  assert.equal(emptyRacks(t34, combat.ammo('su_t34_85', st, 60).state).size, 0);
});

test('combat: the 35 mm KDA rounds — APFSDS and APDS go through a Pz IV side, the capped AP bursts inside, HEAT-FS ignores range', () => {
  const pz = data.vehicles.de_pz4_h;
  const through = (shell, seed) => combat.shoot('de_pz4_h', combat.fresh('de_pz4_h', pz).state, sideShot(pz, shell, 'gunner', seed, 500));
  for (const id of ['apfsds_35_pmc287', 'apds_35_kda']) {
    const r = through(P[id], 1);
    assert.equal(r.outcome, 'penetrated', `${id}: ${r.outcome}`);
    assert.equal(r.bursts.filter((b) => b.inside).length, 0, `${id} carries no filler`);
  }
  const he = through(P.apcbche_35, 2);
  assert.equal(he.outcome, 'penetrated', he.outcome);
  assert.ok(he.bursts.some((b) => b.inside), 'the APCBC-HE filler goes off inside');
  const c = P.heatfs_35.penetration_curve;
  assert.equal(c[0].pen_mm, c[c.length - 1].pen_mm);
  assert.equal(P.heatfs_35.kind, 'heat_fs');
  assert.ok(P.apfsds_35_pmc287.penetration_curve[3].pen_mm > P.apds_35_kda.penetration_curve[3].pen_mm);
});

test('combat: heavy machine guns go through thin plate — the M113 aluminium side, the Panzerjäger I — but a rifle-calibre MG does not', () => {
  const hmg = bulletShell(data.machineGuns.m2hb);
  const kpv = bulletShell(data.machineGuns.kpvt);
  const rifle = bulletShell(data.machineGuns.mg34);
  const throughs = (id, shell, dist, role = 'driver') => {
    const b = data.vehicles[id];
    let n = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const st = combat.fresh(id, b).state;
      const r = combat.shoot(id, st, sideShot(b, shell, role, seed, dist));
      if (r.outcome === 'penetrated') n++;
    }
    return n;
  };
  assert.ok(throughs('us_m901_itv', hmg, 100) >= 5, '12.7 mm through 44 mm aluminium at 100 m');
  assert.ok(throughs('us_m901_itv', kpv, 300) >= 5, '14.5 mm through the M113 side at 300 m');
  assert.ok(throughs('de_pzjg1', hmg, 100, 'commander') >= 5, '12.7 mm through the 13-14.5 mm steel of the fighting compartment');
  assert.equal(throughs('us_m901_itv', rifle, 100), 0, 'a 7.92 mm ball round stops on the aluminium');
  assert.equal(throughs('us_m4a3_75w', hmg, 100), 0, 'not through a Sherman side');
});

// ---- the crew's reload animation spans exactly the reload and grows with the round
import { loaderPose, loadWeight } from '../src/game/crewanim.js';

test('loader cycle starts and ends at rest and bends deeper for a heavier round', () => {
  for (const k of [0, 0.5, 1]) {
    for (const p of [0, 1]) {
      const s = loaderPose(p, k);
      for (const v of [s.dx, s.dy, s.dz, s.yaw, s.pitch]) assert.ok(Math.abs(v) < 1e-9, `pose at ${p} is rest`);
    }
  }
  const deepest = (k) => Math.min(...Array.from({ length: 101 }, (_, i) => loaderPose(i / 100, k).dy));
  assert.ok(deepest(loadWeight(122)) < deepest(loadWeight(57)) - 0.1);
  // separate-loading: two fetches, back at rest half way through
  assert.ok(Math.abs(loaderPose(0.5, 1, true).yaw) < 1e-9);
  assert.ok(loaderPose(0.15, 1, true).yaw > 0.5 && loaderPose(0.65, 1, true).yaw > 0.5);
});

// Numeric checks of the JS simulation mirror. The same scenarios (and thresholds) exist as
// Rust unit tests in crates/physics, crates/weapon and crates/ballistics.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as phys from '../src/sim/physics.js';
import * as gun from '../src/sim/gunnery.js';
import * as bal from '../src/sim/ballistics.js';
import { Rng } from '../src/sim/rng.js';
import * as design from '../src/sim/design.js';
import * as loading from '../src/sim/loading.js';
import * as mg from '../src/sim/mg.js';
import { PRESETS, buildToBundle, makeLoadout, exportFolder, checkFolder, reloadTime } from '../src/game/loadout.js';
import { loadData } from '../tools/load-data.mjs';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
const json = (p) => JSON.parse(fs.readFileSync(path.join(DATA, p), 'utf8'));
const terrains = Object.fromEntries(json('terrains.json').map((t) => [t.id, t]));
const vehicle = (id) => ({ v: json(`vehicles/${id}/vehicle.json`), e: json(`vehicles/${id}/engine.json`), w: json(`vehicles/${id}/weapons.json`) });
const params = (id) => {
  const d = vehicle(id);
  return phys.makeParams(d.v, d.e);
};
const DT = 1 / 60;
const run = (p, s, input, terrain, slope, secs, dt = DT) => {
  let info;
  let maxSlip = 0;
  const env = { terrain: terrains[terrain], slope };
  for (let i = 0; i < Math.round(secs / dt); i++) {
    info = phys.step(p, s, input, env, dt);
    maxSlip = Math.max(maxSlip, info.trackSlip);
  }
  return { ...info, maxSlip };
};
const FULL = { throttle: 1, steer: 0, brake: 0 };
const deg = (r) => (r * 180) / Math.PI;
const ALL = ['proto_a', 'de_pz3_j', 'de_pz4_h', 'de_tiger_e', 'de_panther_g', 'su_t34_85', 'su_is2', 'su_t54', 'us_m10', 'us_m4a3_75w', 'us_m4a3_76w_hvss', 'uk_cromwell_iv'];

test('proto_a: accelerates to 30 km/h quickly on road', () => {
  const p = params('proto_a');
  const s = phys.newState();
  let t = 0;
  while (s.u * 3.6 < 30 && t < 20) {
    phys.step(p, s, FULL, { terrain: terrains.road, slope: 0 }, DT);
    t += DT;
  }
  assert.ok(t < 12, `took ${t}s`);
});

test('proto_a: top speed is governed, in top gear', () => {
  const p = params('proto_a');
  const s = phys.newState();
  const info = run(p, s, FULL, 'road', 0, 90);
  assert.ok(info.speedKmh > 42 && info.speedKmh < 52, `${info.speedKmh} km/h`);
  assert.equal(info.gear, p.trans.gear_ratios.length - 1);
});

test('proto_a: mud slips and is slower than road', () => {
  const p = params('proto_a');
  const a = phys.newState();
  const b = phys.newState();
  run(p, a, FULL, 'road', 0, 8);
  const m = run(p, b, FULL, 'mud', 0, 8);
  assert.ok(m.maxSlip > 0);
  assert.ok(b.z < a.z * 0.9, `mud ${b.z} road ${a.z}`);
});

test('proto_a: neutral steer rotates in place', () => {
  const p = params('proto_a');
  const s = phys.newState();
  const info = run(p, s, { throttle: 0, steer: 1, brake: 0 }, 'road', 0, 6);
  assert.ok(info.yawRateDeg > 30 && info.yawRateDeg < 50, `${info.yawRateDeg}`);
  assert.ok(Math.abs(s.u) < 0.2 && Math.hypot(s.x, s.z) < 1.5);
});

test('proto_a: climbs a gentle slope without gear hunting, not a cliff', () => {
  const p = params('proto_a');
  const a = phys.newState();
  let minU = 99;
  let shifts = 0;
  let lastGear = 0;
  const env = { terrain: terrains.road, slope: (10 * Math.PI) / 180 };
  for (let i = 0; i < 20 / DT; i++) {
    phys.step(p, a, FULL, env, DT);
    if (i * DT > 10) {
      minU = Math.min(minU, a.u);
      if (a.gear !== lastGear) shifts++;
    }
    lastGear = a.gear;
  }
  assert.ok(minU > 1.0, `10 deg: min u ${minU}`);
  assert.ok(shifts <= 1, `gear hunting: ${shifts} shifts in steady climb`);
  const b = phys.newState();
  run(p, b, FULL, 'road', (40 * Math.PI) / 180, 10);
  assert.ok(b.u < 0.5, `40 deg: u=${b.u}`);
});

test('proto_a: brakes to a full stop without reversing; parked on a slope stays put', () => {
  const p = params('proto_a');
  const s = { ...phys.newState(), u: 10, gear: 3 };
  run(p, s, { throttle: 0, steer: 0, brake: 1 }, 'road', 0, 3);
  assert.ok(Math.abs(s.u) < 1e-3, `u=${s.u}`);
  const q = phys.newState();
  run(p, q, { throttle: 0, steer: 0, brake: 0 }, 'road', (10 * Math.PI) / 180, 5);
  assert.equal(q.u, 0);
  assert.equal(q.z, 0);
});

test('proto_a: reverse speed is limited; rollback on a 20 deg slope recovers', () => {
  const p = params('proto_a');
  const s = phys.newState();
  run(p, s, { throttle: -1, steer: 0, brake: 0 }, 'road', 0, 20);
  assert.ok(s.u < -3.5 && s.u > -4.5, `u=${s.u}`);
  const q = { ...phys.newState(), u: -3 };
  run(p, q, FULL, 'road', (20 * Math.PI) / 180, 15);
  assert.ok(q.u > 0.5, `u=${q.u}`);
});

test('proto_a: hard turn at speed drifts on mud but grips on road', () => {
  const p = params('proto_a');
  const input = { throttle: 1, steer: 1, brake: 0 };
  const r = { ...phys.newState(), u: 10, gear: 3 };
  run(p, r, input, 'road', 0, 3);
  const m = { ...phys.newState(), u: 10, gear: 3 };
  let maxW = 0;
  for (let i = 0; i < 3 / DT; i++) {
    phys.step(p, m, input, { terrain: terrains.mud, slope: 0 }, DT);
    maxW = Math.max(maxW, Math.abs(m.w));
  }
  assert.ok(Math.abs(r.w) < 0.5, `road w=${r.w}`);
  assert.ok(maxW > 1.0, `mud max w=${maxW}`);
});

test('physics is deterministic and stable at 30 Hz', () => {
  const p = params('proto_a');
  const i = { throttle: 0.8, steer: 0.3, brake: 0 };
  const a = phys.newState();
  const b = phys.newState();
  run(p, a, i, 'dirt', 0.05, 10);
  run(p, b, i, 'dirt', 0.05, 10);
  assert.deepEqual(a, b);
  const c = phys.newState();
  const info = run(p, c, FULL, 'road', 0, 60, 1 / 30);
  assert.ok(info.speedKmh > 42 && info.speedKmh < 52);
});

test('historical vehicles: top speed, steering type and reverse match their data', () => {
  const expect = { de_tiger_e: [38, 46], su_t34_85: [48, 56], us_m4a3_76w_hvss: [36, 43], uk_cromwell_iv: [54, 64] };
  for (const [id, [lo, hi]] of Object.entries(expect)) {
    const p = params(id);
    const s = phys.newState();
    const info = run(p, s, FULL, 'road', 0, 150);
    assert.ok(info.speedKmh > lo && info.speedKmh < hi, `${id} top ${info.speedKmh}`);
    const piv = phys.newState();
    const pi = run(p, piv, { throttle: 0, steer: 1, brake: 0 }, 'road', 0, 6);
    if (p.minTurnRadius > 0) {
      // cannot neutral-steer: creeps forward in an arc instead
      assert.ok(piv.u > 0.5 && pi.yawRateDeg > 3, `${id} arc u=${piv.u} r=${pi.yawRateDeg}`);
    } else {
      assert.ok(Math.abs(piv.u) < 0.2 && pi.yawRateDeg > 12, `${id} pivot r=${pi.yawRateDeg}`);
    }
    const rev = phys.newState();
    run(p, rev, { throttle: -1, steer: 0, brake: 0 }, 'road', 0, 20);
    assert.ok(rev.u < -0.8 * p.maxReverseSpeed && rev.u > -1.1 * p.maxReverseSpeed, `${id} reverse ${rev.u}`);
  }
});

test('turret: traverse rate, shortest path, elevation limits, jammed drive', () => {
  const g = vehicle('proto_a').w.main_gun; // 20 deg/s traverse, 12 deg/s elevate, -8/+20
  const drive = { traverse: 1, elevate: 1 };
  const s = gun.newTurret();
  for (let i = 0; i < 60; i++) gun.aimStep(g, s, Math.PI / 2, 0, drive, DT);
  assert.ok(Math.abs(deg(s.yaw) - 20) < 0.1, `${deg(s.yaw)}`);
  for (let i = 0; i < 60 * 4; i++) gun.aimStep(g, s, Math.PI / 2, 0, drive, DT);
  assert.ok(Math.abs(deg(s.yaw) - 90) < 1e-3);
  const w = { yaw: (170 * Math.PI) / 180, pitch: 0 };
  const target = (-170 * Math.PI) / 180;
  for (let i = 0; i < 30; i++) gun.aimStep(g, w, target, 0, drive, DT);
  assert.ok(Math.abs(Math.abs(deg(w.yaw)) - 180) < 0.2, `went the short way: ${deg(w.yaw)}`);
  for (let i = 0; i < 60; i++) gun.aimStep(g, w, target, 0, drive, DT);
  assert.ok(Math.abs(gun.wrapPi(w.yaw - target)) < 1e-4);
  const e = gun.newTurret();
  for (let i = 0; i < 600; i++) gun.aimStep(g, e, 0, -1, drive, DT);
  assert.ok(Math.abs(deg(e.pitch) + 8) < 1e-3);
  for (let i = 0; i < 600; i++) gun.aimStep(g, e, 0, 1.2, drive, DT);
  assert.ok(Math.abs(deg(e.pitch) - 20) < 1e-3);
  const j = gun.newTurret();
  for (let i = 0; i < 60; i++) gun.aimStep(g, j, 1, 0.1, { traverse: 0, elevate: 0 }, DT);
  assert.deepEqual(j, { yaw: 0, pitch: 0 });
});

test('muzzle geometry follows hull pose, turret yaw and gun pitch', () => {
  const mount = { pivot: [0, 1.1, 0.2], trunnion: [0, 1.6, 1.5], muzzleOffset: 3.6 };
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-4);
  let m = gun.muzzleLocal(mount, { yaw: 0, pitch: 0 });
  assert.ok(near(m.pos, [0, 1.6, 5.1]) && near(m.dir, [0, 0, 1]));
  m = gun.muzzleLocal(mount, { yaw: Math.PI / 2, pitch: 0 });
  assert.ok(near(m.pos, [4.9, 1.6, 0.2]) && near(m.dir, [1, 0, 0]), JSON.stringify(m));
  m = gun.muzzleLocal(mount, { yaw: 0, pitch: Math.PI / 6 });
  assert.ok(near(m.pos, [0, 1.6 + 1.8, 1.5 + 3.6 * Math.cos(Math.PI / 6)]));
  const w = gun.muzzleWorld({ pos: [10, 0, 5], heading: Math.PI / 2 }, mount, { yaw: 0, pitch: 0 });
  assert.ok(near(w.pos, [15.1, 1.6, 5]) && near(w.dir, [1, 0, 0]), JSON.stringify(w));
});

test('fire control: reload gate, crew/module gate, reload multiplier', () => {
  const g = vehicle('proto_a').w.main_gun;
  const st = gun.newGunState();
  assert.deepEqual(gun.tryFire(g, st, false, 1), { ok: false, reason: 'disabled' });
  assert.equal(gun.tryFire(g, st, true, 1).ammo, 'ap_75_generic');
  assert.equal(st.reloadRemaining, 7.5);
  assert.equal(gun.tryFire(g, st, true, 1).reason, 'reloading');
  gun.tickReload(st, 7.5);
  gun.tryFire(g, st, true, 2);
  assert.equal(st.reloadRemaining, 15);
});

test('dispersion stays inside its cone and is seed-deterministic', () => {
  const dir = [0, 0, 1];
  const a = new Rng(42);
  const b = new Rng(42);
  for (let i = 0; i < 200; i++) {
    const d = gun.disperse(dir, 1.2, a);
    const e = gun.disperse(dir, 1.2, b);
    assert.deepEqual(d, e);
    assert.ok(Math.acos(Math.min(1, d[2])) <= 0.0012 + 1e-6);
  }
  assert.deepEqual(gun.disperse(dir, 0, a), dir);
});

test('ballistics: vacuum elevation matches the closed form, drag needs more', () => {
  const def = { caliber_mm: 75, mass_kg: 6.8, muzzle_velocity_ms: 800, drag_coefficient: 0.3 };
  const vac = bal.elevationForRange(def, 1000, { airDensity: 0, gravity: 9.80665 });
  const closed = 0.5 * Math.asin((9.80665 * 1000) / (800 * 800));
  assert.ok(Math.abs(vac.elevation - closed) < 2e-5, `${vac.elevation} vs ${closed}`);
  const air = bal.elevationForRange(def, 1000);
  assert.ok(air.elevation > vac.elevation && air.speed < 800);
});

test('sight range table is monotonic for every shipped shell', () => {
  for (const f of fs.readdirSync(path.join(DATA, 'projectiles'))) {
    const def = json(`projectiles/${f}`);
    const table = bal.rangeTable(def, [200, 400, 800, 1200, 1600, 2000], undefined, def.muzzle_velocity_ms < 300 ? 0.7 : 0.35);
    // slow heavy rockets (BMPT-34's 250 kg TT: 180 m/s, WT AttackMaxDistance 1000 m) run out
    // of the sight's 20 deg elevation before 2 km; they must still reach 1200 m
    assert.ok(table.length === 6 || (def.muzzle_velocity_ms < 300 && table.length >= 4), def.id);
    for (let i = 1; i < table.length; i++) assert.ok(table[i].elevation > table[i - 1].elevation);
  }
});

test('gun design: derived values, layout reload, self-consistent gun', () => {
  assert.ok(Math.abs(design.shellMassKg(75) - 6.58) < 0.05 && Math.abs(design.shellMassKg(88) - 10.63) < 0.05);
  assert.equal(design.muzzleVelocity(56), 804);
  const r = design.layoutReloadTime(10.2, [0.5, 2.0, -0.1], [1.25, 1.38, 0.2], [0, 2.18, 0.6]);
  assert.ok(Math.abs(r.total - 7.5) < 0.2, JSON.stringify(r));
  assert.ok(design.handlingTime(25) > 2 * design.handlingTime(10.2));
  const { gun, shell } = design.designGun(88, 56);
  assert.deepEqual(gun.ammo, [shell.id]);
  const c = shell.penetration_curve;
  assert.ok(c[0].pen_mm > 140 && c[0].pen_mm < 190, c[0].pen_mm);
  for (let i = 1; i < c.length; i++) assert.ok(c[i].pen_mm < c[i - 1].pen_mm);
  assert.ok(design.designGun(88, 71).shell.penetration_curve[0].pen_mm > c[0].pen_mm);
  assert.ok(design.traverseRate(1.0, 150) > design.traverseRate(1.85, 1300));
});

test('loader queue: one loader reloads six guns one after another; two work in parallel', () => {
  const runL = (L, secs, t) => {
    let n = 0;
    for (let i = 0; i < Math.round(secs * 120); i++) n += loading.tick(L, 1 / 120, () => t).length;
    return n;
  };
  const one = loading.newLoading(6, 1);
  for (let g = 0; g < 6; g++) loading.fired(one, g);
  assert.equal(runL(one, 5.1, 5), 1);
  assert.equal(loading.progress(one, 5).waiting, true);
  assert.equal(runL(one, 25.1, 5), 5);
  const two = loading.newLoading(4, 2);
  loading.fired(two, 2);
  runL(two, 1, 5);
  loading.fired(two, 0);
  loading.fired(two, 3);
  runL(two, 0.1, 5);
  assert.deepEqual(two.state, ['loading', 'ready', 'loading', 'waiting']);
  assert.equal(runL(two, 5, 5), 2);
  const none = loading.newLoading(1, 0);
  loading.fired(none, 0);
  assert.equal(runL(none, 7.9, 5), 0);
  assert.equal(runL(none, 0.2, 5), 1);
});

test('limited-arc traverse parks on the edge and never crosses the blocked sector', () => {
  const facing = Math.PI;
  const limit = [(-60 * Math.PI) / 180, (60 * Math.PI) / 180];
  const rate = (20 * Math.PI) / 180;
  const s = { yaw: facing, pitch: 0 };
  let reach = 0;
  for (let i = 0; i < 600; i++) {
    reach = gun.traverseLimited(s, 0.4, facing, limit, rate, DT);
    assert.ok(Math.abs(gun.wrapPi(s.yaw - facing)) <= limit[1] + 1e-6);
  }
  assert.ok(Math.abs(Math.abs(gun.wrapPi(s.yaw - facing)) - limit[1]) < 1e-3);
  assert.ok(Math.abs(gun.wrapPi(reach - 0.4)) > 0.5);
  const inside = (170 * Math.PI) / 180;
  for (let i = 0; i < 600; i++) reach = gun.traverseLimited(s, inside, facing, limit, rate, DT);
  assert.ok(Math.abs(gun.wrapPi(s.yaw - inside)) < 1e-3 && Math.abs(gun.wrapPi(reach - inside)) < 1e-6);
});

test('sight setting: elevationAt interpolates the range table', () => {
  const t = [{ range: 100, elevation: 0.001 }, { range: 200, elevation: 0.0021 }];
  assert.equal(bal.elevationAt(t, 0), 0);
  assert.ok(Math.abs(bal.elevationAt(t, 50) - 0.0005) < 1e-12);
  assert.ok(Math.abs(bal.elevationAt(t, 150) - 0.00155) < 1e-12);
  assert.equal(bal.elevationAt(t, 900), 0.0021);
});

test('workshop presets: valid data folders, six guns, heavier and slower than stock', () => {
  const data = loadData();
  for (const [key, preset] of Object.entries(PRESETS)) {
    const { bundle, projectiles, stats } = buildToBundle(preset.build, data);
    const lo = makeLoadout('custom', bundle, { ...data.projectiles, ...projectiles });
    assert.equal(lo.gunCount, stats.guns, key);
    for (const t of lo.turrets) for (let g = 0; g < t.guns.length; g++) assert.ok(reloadTime(t, g, 0) > 1 && reloadTime(t, g, 0) < 60, key);
    const out = exportFolder(preset.build, data, data.vehicles[preset.build.base], 'x_' + key, key);
    assert.deepEqual(checkFolder(out.files), [], key);
    const p = phys.makeParams(bundle.vehicle, bundle.engine);
    assert.ok(p.mass > 10000 && p.mass < 120000, key);
  }
  const hexa = buildToBundle(PRESETS.hexa.build, data);
  assert.equal(hexa.stats.guns, 6);
  const lo = makeLoadout('custom', hexa.bundle, { ...data.projectiles, ...hexa.projectiles });
  assert.equal(lo.turrets.length, 3);
  assert.ok(Math.abs(lo.turrets[2].facing - Math.PI) < 1e-9 && lo.turrets[2].limit);
  // a far rack is slower than a turret-bustle rack for the same gun
  const near = JSON.parse(JSON.stringify(PRESETS.twin.build));
  near.turrets[0].rack = 'ready';
  const far = JSON.parse(JSON.stringify(PRESETS.twin.build));
  far.turrets[0].rack = 'hull_floor';
  const rt = (b) => {
    const r = buildToBundle(b, data);
    const l = makeLoadout('custom', r.bundle, { ...data.projectiles, ...r.projectiles });
    return reloadTime(l.turrets[0], 0, 0);
  };
  assert.ok(rt(far) > rt(near) + 1, `${rt(far)} vs ${rt(near)}`);
});

test('machine gun: cyclic rate, belt change, overheating and cooling', () => {
  const def = json('machine_guns.json').find((m) => m.id === 'mg34');
  const st = mg.newMg(def);
  const dt = 1 / 120;
  let fired = 0;
  for (let i = 0; i < 240; i++) fired += mg.stepMg(def, st, true, dt); // two seconds on the trigger
  assert.ok(Math.abs(fired - (2 * def.rate_rpm) / 60) <= 1, `fired ${fired}`);
  assert.equal(st.belt, def.belt_rounds - fired);
  assert.ok(st.heat > 0.05 && st.heat < 0.2, `heat ${st.heat}`);
  // released: nothing leaves the barrel, and the first round after the pause is immediate
  for (let i = 0; i < 120; i++) assert.equal(mg.stepMg(def, st, false, dt), 0);
  assert.equal(mg.stepMg(def, st, true, dt), 1);
  // run the belt out: the gun stops, changes belts for reload_s, then carries on
  let guard = 0;
  while (st.reload === 0 && guard++ < 5000) mg.stepMg(def, st, true, dt);
  assert.equal(st.belt, 0);
  assert.ok(Math.abs(st.reload - def.reload_s) < 1e-9);
  let during = 0;
  for (let i = 0; i < Math.round(def.reload_s / dt) - 2; i++) during += mg.stepMg(def, st, true, dt);
  assert.equal(during, 0);
  for (let i = 0; i < 10; i++) mg.stepMg(def, st, true, dt);
  assert.ok(st.belt > def.belt_rounds - 5 && st.belt < def.belt_rounds);
  // keep firing belt after belt: the barrel overheats, the gun refuses, and it recovers once cooler
  guard = 0;
  while (!st.hot && guard++ < 200000) mg.stepMg(def, st, true, dt);
  assert.ok(st.hot, 'never overheated');
  assert.equal(mg.stepMg(def, st, true, dt), 0);
  guard = 0;
  while (st.hot && guard++ < 200000) mg.stepMg(def, st, false, dt);
  assert.ok(st.heat < mg.RESUME_HEAT && guard * dt > 10, `cooled in ${guard * dt} s`);
  // tracers come at the belt's interval
  const t = mg.newMg(def);
  let tracers = 0;
  for (let i = 0; i < 1200; i++) if (mg.stepMg(def, t, true, dt) && mg.isTracer(def, t)) tracers++;
  assert.ok(Math.abs(tracers - t.fired / def.tracer_every) <= 1, `${tracers} of ${t.fired}`);
});

test('machine gun mounts: a ball mount stays inside its arc, a pintle swings all the way round', () => {
  const rad = (d) => (d * Math.PI) / 180;
  const arc = [rad(15), rad(10), rad(20)];
  const aim = { yaw: 0, pitch: 0 };
  let on = false;
  for (let i = 0; i < 240; i++) on = mg.slewMount(aim, { yaw: rad(8), pitch: rad(5) }, arc, rad(50), 1 / 120);
  assert.ok(on && Math.abs(aim.yaw - rad(8)) < 1e-6 && Math.abs(aim.pitch - rad(5)) < 1e-6);
  for (let i = 0; i < 240; i++) on = mg.slewMount(aim, { yaw: rad(60), pitch: rad(-30) }, arc, rad(50), 1 / 120);
  assert.ok(!on && Math.abs(aim.yaw - rad(15)) < 1e-6 && Math.abs(aim.pitch + rad(10)) < 1e-6);
  const free = { yaw: 0, pitch: 0 };
  for (let i = 0; i < 600; i++) on = mg.slewMount(free, { yaw: rad(-170), pitch: rad(40) }, [Math.PI, rad(10), rad(60)], rad(70), 1 / 120);
  assert.ok(on && Math.abs(free.yaw - rad(-170)) < 1e-6 && Math.abs(free.pitch - rad(40)) < 1e-6);
});

test('vehicles: every stock vehicle loads, its machine guns resolve and its figures are sane', () => {
  const data = loadData();
  assert.ok(data.order.length >= 12);
  for (const id of data.order) {
    const b = data.vehicles[id];
    const lo = makeLoadout(id, b, data.projectiles, data.machineGuns);
    assert.equal(lo.machineGuns.length, b.weapons.secondary.length, id);
    for (const m of lo.machineGuns) assert.ok(m.table.length >= 6 && m.table[0].elevation > 0 && m.table[0].elevation < 0.004, `${id} ${m.id}`);
    const p = phys.makeParams(b.vehicle, b.engine);
    // armoured cars run on tyres (test/wheeled.test.mjs); the tracked figures are for tracks
    if (b.vehicle.physics.drive !== 'wheeled') {
      // the slowest: the Raupenschlepper Ost tractors, 17 km/h on the road; the fastest: the
      // Gepard on its Leopard 1 running gear, 65 km/h
      assert.ok(p.vTop * 3.6 > 14 && p.vTop * 3.6 < 70, `${id} top speed ${p.vTop * 3.6}`);
      assert.ok(p.groundPressure > 25e3 && p.groundPressure < 115e3, `${id} ground pressure`);
    }
    assert.ok(['traced', 'dimensions', 'original', 'model'].includes(b.vehicle.meta.outline), id);
    for (const t of lo.turrets)
      for (const g of t.guns) for (const a of g.ammo) assert.ok(a.table.length >= (a.shell.muzzle_velocity_ms < 300 ? 10 : 20), `${id} range table`);
  }
  const m10 = makeLoadout('us_m10', data.vehicles.us_m10, data.projectiles, data.machineGuns);
  assert.ok(m10.turrets[0].openTop && m10.machineGuns[0].mount === 'pintle');
  // published top speeds, within the tolerance of the 95 % governor margin used by the model
  const top = (id) => phys.makeParams(data.vehicles[id].vehicle, data.vehicles[id].engine).vTop * 3.6;
  for (const [id, kmh] of [['de_pz3_j', 40], ['de_pz4_h', 38], ['de_panther_g', 55], ['su_is2', 37], ['su_t54', 50], ['us_m10', 48], ['us_m4a3_75w', 42], ['su_t10m', 50], ['de_panther_f', 55]]) {
    assert.ok(Math.abs(top(id) - kmh) < 2.5, `${id}: ${top(id).toFixed(1)} vs ${kmh}`);
  }
});

test('report', () => {
  for (const id of ALL) {
    const p = params(id);
    const d = vehicle(id);
    const s = phys.newState();
    let t30 = 0;
    while (s.u * 3.6 < 30 && t30 < 60) {
      phys.step(p, s, FULL, { terrain: terrains.road, slope: 0 }, DT);
      t30 += DT;
    }
    const top = {};
    for (const tid of ['road', 'grass', 'mud', 'snow']) {
      const q = phys.newState();
      top[tid] = run(p, q, FULL, tid, 0, 150).speedKmh.toFixed(0);
    }
    const piv = phys.newState();
    const pr = run(p, piv, { throttle: 0, steer: 1, brake: 0 }, 'road', 0, 6);
    const shell = fs.readdirSync(path.join(DATA, 'projectiles')).map((f) => json(`projectiles/${f}`)).find((x) => x.id === d.w.main_gun.ammo[0]);
    const tb = bal.rangeTable(shell, [500, 1000, 2000]).map((r) => `${r.range}m:${(r.elevation * 1000).toFixed(1)}mrad/${r.tof.toFixed(2)}s`);
    console.log(`${id.padEnd(18)} 0-30 ${t30.toFixed(1)}s  top ${JSON.stringify(top)}  steer-only ${pr.yawRateDeg.toFixed(0)} deg/s  ${tb.join(' ')}`);
  }
});

// ---------------------------------------------------------------- terramechanics and suspension

import * as terra from '../src/sim/terra.js';

test('terramechanics: sinkage, shear curve and its inverse, pressure factor', () => {
  const mud = terrains.mud.soil;
  const sand = terrains.sand.soil;
  // a heavier-loaded track sinks deeper, and soft mud gives way more than firm sand at tank pressures
  assert.ok(terra.sinkage(mud, 107e3, 0.725) > terra.sinkage(mud, 80e3, 0.5));
  const z = terra.sinkage(sand, 100e3, 0.6);
  assert.ok(z > 0.02 && z < 0.2, `sand sinkage ${z}`);
  assert.equal(terra.sinkage(undefined, 100e3, 0.6), 0);
  // pressure-sinkage relation holds: p = (kc/b + kphi) z^n
  const b = 0.6;
  const p = (sand.kc / b + sand.kphi) * Math.pow(z, sand.n) * 1000;
  assert.ok(Math.abs(p - 100e3) < 50, `p ${p}`);
  // compaction resistance is a small share of the weight on sand
  const rc = 2 * terra.compactionResistance(sand, z, b);
  assert.ok(rc > 1000 && rc < 0.1 * 100e3 * 2 * b * 3.6, `rc ${rc}`);
  // Janosi-Hanamoto: monotonic, saturating, and slipForRatio inverts it
  let last = 0;
  for (const i of [0.01, 0.05, 0.1, 0.3, 0.6, 1]) {
    const r = terra.shearRatio(i, 0.025, 3.6);
    assert.ok(r > last && r < 1);
    assert.ok(Math.abs(terra.slipForRatio(r, 0.025, 3.6) - i) < 1e-3, `inverse at ${i}`);
    last = r;
  }
  assert.ok(terra.slipForRatio(0.5, 0.025, 3.6) < 0.03, 'half the available thrust needs very little slip');
  assert.ok(terra.slipForRatio(0.97, 0.025, 3.6) > 0.15, 'the last few percent need a lot');
  // the terrain multipliers are calibrated for the reference pressure
  assert.equal(terra.pressureFactor(mud, terra.REFERENCE_PRESSURE_PA), 1);
  assert.ok(terra.pressureFactor(mud, 107e3) > 1.5 && terra.pressureFactor(mud, 60e3) < 1);
  assert.equal(terra.pressureFactor(undefined, 200e3), 1);
});

test('tracks slip to make thrust: little on a road, heavily when the mud cannot carry it', () => {
  const p = params('proto_a');
  const s = phys.newState();
  const road = run(p, s, { throttle: 0.5, steer: 0, brake: 0 }, 'road', 0, 12);
  assert.ok(road.slipL < 0.05 && road.trackSpeedL >= s.u - 1e-6, `cruise slip ${road.slipL}`);
  assert.equal(road.sinkage, 0);
  const s2 = phys.newState();
  const first = phys.step(p, s2, FULL, { terrain: terrains.mud, slope: 0 }, DT);
  assert.ok(first.slipL > 0.3, `launch in mud slips ${first.slipL}`);
  assert.ok(first.trackSpeedL > s2.u + 0.3, 'the track runs faster than the ground goes by');
  assert.ok(first.sinkage > 0.005, `mud sinkage ${first.sinkage}`);
  // a heavier ground pressure pays more on soft ground: Tiger vs T-34 in mud, relative to road
  const ratio = (id) => {
    const q = params(id);
    const a = phys.newState();
    const b2 = phys.newState();
    return run(q, a, FULL, 'mud', 0, 40).speedKmh / run(q, b2, FULL, 'road', 0, 40).speedKmh;
  };
  assert.ok(ratio('de_tiger_e') < ratio('su_t34_85'), `tiger ${ratio('de_tiger_e')} t34 ${ratio('su_t34_85')}`);
});

test('physics: an unloaded track loses its grip, damper drag costs speed', () => {
  const p = params('proto_a');
  const a = phys.newState();
  const b = phys.newState();
  for (let i = 0; i < 120 * 20; i++) {
    phys.step(p, a, FULL, { terrain: terrains.road, slope: 0 }, DT);
    phys.step(p, b, FULL, { terrain: terrains.road, slope: 0, drag: 0.08 * p.mass * 9.81 }, DT);
  }
  assert.ok(b.u < a.u - 1, `drag ${b.u} vs ${a.u}`);
  const c = phys.newState();
  const info = phys.step(p, c, FULL, { terrain: terrains.road, slope: 0, load: [0, 1] }, DT);
  assert.equal(info.forceL, 0);
  assert.ok(info.slipL === 1 && info.forceR > 0);
});

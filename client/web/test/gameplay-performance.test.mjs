import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as gunnery from '../src/sim/gunnery.js';
import * as ballistics from '../src/sim/ballistics.js';
import { weaponDamage } from '../src/game/weaponDamage.js';
import { loadCoreSync } from '../src/design/core.js';
import { loadData } from '../tools/load-data.mjs';
import { makeParams, newState, step } from '../src/sim/physics.js';
import { makeDrive, newDriveState, driveStep } from '../src/sim/tank/drive.js';
import { makeLoadout, reloadTime, fireLauncherRound, tickLauncher, refillLauncher, roundsLeft, refillBelt, syncGunShell, nextAmmo } from '../src/game/loadout.js';
import * as loading from '../src/sim/loading.js';
import { newTurret, aimStep } from '../src/sim/gunnery.js';
import { newMg, stepMg, slewMount, bulletOf } from '../src/sim/mg.js';
import { RigidBody } from '../src/sim/tank/body.js';

const api = await import('../src/game/gameplayPerformance.js').catch(e => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  return {};
});
// Identity fallbacks let the RED run fail on measured ratios, not just absent exports.
const deriveVehicleParams = api.deriveVehicleParams ?? (p => p);
const deriveLoadoutPerformance = api.deriveLoadoutPerformance ?? (lo => lo);
const deriveMgProfile = api.deriveMgProfile ?? (def => def);
const deriveApsProfile = api.deriveApsProfile ?? (def => def);
const effectiveReloadSeconds = api.effectiveReloadSeconds ?? (seconds => seconds);
const data = loadData();
const vehicleIds = ['su_t34_85', 'su_t10m', 'de_sdkfz234_2'];
const make = id => makeLoadout(id, data.vehicles[id], data.projectiles, data.machineGuns);
const close = (got, expected, label, tolerance = 1e-9) => assert.ok(Math.abs(got - expected) <= tolerance, `${label}: ${got}, expected ${expected}`);
const healthy = { traverse: 1, elevate: 1 };

// Execute the production autocannon firing body, as the existing weapon-control tests do.
// Only presentation sinks are inert; ammunition, loaders and projectile emission stay real.
function automaticControls(lo, ti) {
  const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  const start = source.indexOf('  function fireGun(');
  assert.ok(start >= 0, 'production firing function exists');
  const body = source.slice(start, source.indexOf('\n  }', start) + 4);
  const G = { loadout: lo, shots: [], aps: null, caps: null, online: null, cam: { shake: 0 }, ss: {},
    sightM: -1, sightT: ti, fireHeld: true, mgHeld: false,
    T: lo.turrets.map(t => ({ yaw: 0, guns: t.guns.map(() => ({ pitch: 0, smoke: 0 })), loading: loading.newLoading(t.guns.length, t.loaders.length, t.guns.map(g => !g.rack)) })) };
  G.veh = { body: new RigidBody(1000, [1000, 1000, 1000], [0, 0, 0]), impulse(j, p) { this.body.applyImpulseAt(j, p); }, worldPoint(p) { return this.body.worldPoint(p); } };
  const deps = { G, RECOIL_ROCK: 1, weaponDamage, gunnery, ballistics, loading, syncGunShell, nextAmmo,
    pose: () => ({ pos: [0, 0, 0], heading: 0 }),
    mountOf: (t, g) => ({ pivot: t.pivot, trunnion: g.trunnion, muzzleOffset: g.muzzleOffset }), hullTilt: () => 0,
    rng: { nextF32: () => .5 }, surfaceAt: () => 0, fx: { mgFlash() {}, autocannonBlast() {} }, sound: { mg() {} } };
  const fire = new Function(...Object.keys(deps), `${body}\nreturn fireGun;`)(...Object.values(deps));
  const spinStart = source.indexOf("        // a rotary gun's barrels spin up");
  const spinEnd = source.indexOf('\n        });', spinStart);
  assert.ok(spinStart >= 0 && spinEnd > spinStart, 'production rotary spin cycle exists');
  const spin = new Function('G', 't', 'ti', 'SIM_DT', 'clamp', source.slice(spinStart, spinEnd + '\n        });'.length));
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  return { G, L: G.T[ti].loading, fire: () => fire(ti, 0), spinStep: dt => spin(G, lo.turrets[ti], ti, dt, clamp) };
}

test('performance exports cover each independent timing owner', () => {
  for (const name of ['deriveVehicleParams', 'deriveLoadoutPerformance', 'deriveMgProfile', 'deriveApsProfile', 'effectiveReloadSeconds']) assert.equal(typeof api[name], 'function', name);
});

for (const id of vehicleIds) {
  test(`${id}: historical is stock identity and source derivations never compound`, () => {
    const bundle = data.vehicles[id], source = structuredClone(bundle);
    const stock = makeParams(bundle.vehicle, bundle.engine), snapshot = structuredClone(stock);
    assert.equal(deriveVehicleParams(stock), stock, 'low-level omitted mode is historical');
    assert.equal(deriveVehicleParams(stock, 'historical'), stock);
    const casual = deriveVehicleParams(stock, 'casual');
    assert.equal(deriveVehicleParams(stock, 'casual'), casual, 'cached source derivation');
    close(casual.vTop / stock.vTop, 1.15, 'forward speed');
    close(casual.maxReverseSpeed / stock.maxReverseSpeed, 1.15, 'reverse speed');
    close(casual.maxTurnRate / stock.maxTurnRate, 1.25, 'steering');
    close(casual.power / stock.power, 1.25 * 1.15, 'power follows force times speed');
    close(casual.engine.horsepower / stock.engine.horsepower, 1.25 * 1.15, 'engine power');
    for (const key of Object.keys(stock).filter(k => !['engine', 'trans', 'vTop', 'maxReverseSpeed', 'maxTurnRate', 'power'].includes(k))) assert.deepEqual(casual[key], stock[key], key);
    assert.equal(casual.trans.gear_ratios, stock.trans.gear_ratios, 'unchanged gearing table');
    assert.deepEqual(stock, snapshot);
    assert.deepEqual(bundle, source, 'source vehicle, geometry and engine unchanged');
  });

  test(`${id}: real tracked drivetrain produces 1.25 force at matched RPM and extended governed speed`, () => {
    const b = data.vehicles[id], stock = makeParams(b.vehicle, b.engine), casual = deriveVehicleParams(stock, 'casual');
    const run = (p, gear, fraction, input) => {
      const speed = fraction * p.engine.max_rpm / (p.trans.gear_ratios[gear] * p.trans.final_drive_ratio) / 60 * 2 * Math.PI * p.sprocketR;
      const dr = makeDrive(p, p.mass), ds = newDriveState(dr);
      ds.gear = gear;
      ds.belts[1].v = ds.belts[-1].v = speed;
      return driveStep(dr, ds, input, { u: speed, resist: 0, grade: 0 }, 1 / 60);
    };
    const input = { throttle: 1, steer: 0, brake: 0 };
    for (const fraction of [0.65, 0.8, 0.97]) {
      const gear = stock.trans.gear_ratios.length - 1;
      const a = run(stock, gear, fraction, input), b = run(casual, gear, fraction, input);
      close(b.rpm, a.rpm, 'matched engine RPM', 1e-8);
      close(b.fEng / a.fEng, 1.25, 'actual available track force', 1e-8);
      close(b.target[1] / a.target[1], 1.15, 'actual drive speed target');
    }
    const zero = p => driveStep(makeDrive(p, p.mass), newDriveState(makeDrive(p, p.mass)), { throttle: 0, steer: .05, brake: 0 }, { u: 0, resist: 0, grade: 0 }, 1 / 60);
    const a = zero(stock), c = zero(casual);
    if (stock.minTurnRadius === 0) close(c.motor.diff / a.motor.diff, 1.25, 'actual steering target');
    else assert.ok(Math.abs(c.motor.diff) <= 2 * stock.gauge / stock.minTurnRadius, 'turning circle limit preserved');
    const damaged = run(casual, 0, .65, { ...input, drive_power: .4 });
    const healthyDrive = run(casual, 0, .65, input);
    close(damaged.fEng / healthyDrive.fEng, .4, 'existing drivetrain damage');
  });

  test(`${id}: real planar force retains the original traction cap`, () => {
    const b = data.vehicles[id], stock = makeParams(b.vehicle, b.engine), casual = deriveVehicleParams(stock, 'casual');
    const env = { terrain: { rolling_mult: 1, traction_mu: .01, lateral_mu: .01 } };
    const input = { throttle: 1, steer: 0, brake: 0 };
    const a = step(stock, newState(), input, env, 1 / 60), c = step(casual, newState(), input, env, 1 / 60);
    close(c.forceL + c.forceR, a.forceL + a.forceR, 'same physical grip cap');
    close(c.forceL + c.forceR, stock.mass * 9.81 * .01, 'actual traction force');
  });

  test(`${id}: loadout source, ammunition and geometry survive cached mode derivation`, () => {
    const stock = make(id), snapshot = structuredClone(stock), casual = deriveLoadoutPerformance(stock, 'casual');
    assert.equal(deriveLoadoutPerformance(stock), stock);
    assert.equal(deriveLoadoutPerformance(stock, 'historical'), stock);
    assert.equal(deriveLoadoutPerformance(stock, 'casual'), casual);
    for (let ti = 0; ti < stock.turrets.length; ti++) {
      const a = stock.turrets[ti], b = casual.turrets[ti];
      close(b.traverse / a.traverse, 1.3, 'turret traverse');
      for (const key of ['pivot', 'size', 'limit', 'loaders', 'depByYaw', 'sight']) assert.equal(b[key], a[key], key);
      for (let gi = 0; gi < a.guns.length; gi++) {
        const g = a.guns[gi], c = b.guns[gi];
        for (const key of ['ammo', 'shell', 'table', 'trunnion', 'breech', 'rack']) assert.equal(c[key], g[key], key);
        for (const key of ['loaded', 'selected', 'belt', 'spin', 'beltChange']) assert.equal(c[key], g[key], key);
        for (const key of ['recoil_mm', 'mass_kg', 'caliber_mm', 'ammo_count', 'max_depression_deg', 'max_elevation_deg', 'dispersion_mrad']) assert.deepEqual(c.def[key], g.def[key], key);
      }
    }
    assert.equal(casual.vehicle, stock.vehicle);
    assert.equal(casual.engine, stock.engine);
    assert.equal(casual.visual, stock.visual);
    assert.deepEqual(stock, snapshot);
  });
}

test('actual turret and independent MG slews use separate horizontal and elevation factors', () => {
  const stock = make('su_t34_85'), casual = deriveLoadoutPerformance(stock, 'casual');
  const a = newTurret(), b = newTurret();
  aimStep(stock.turrets[0].guns[0].def, a, 1, .3, healthy, .1);
  aimStep(casual.turrets[0].guns[0].def, b, 1, .3, healthy, .1);
  close(b.yaw / a.yaw, 1.3, 'actual turret yaw');
  close(b.pitch / a.pitch, 1.2, 'actual gun pitch');
  const m = stock.machineGuns.find(m => m.mount === 'hull'), c = casual.machineGuns.find(c => c.id === m.id);
  const ma = { yaw: 0, pitch: 0 }, mb = { yaw: 0, pitch: 0 };
  slewMount(ma, { yaw: 1, pitch: 1 }, m.arc, m.slew, .01);
  slewMount(mb, { yaw: 1, pitch: 1 }, c.arc, c.slew, .01, c.elevateSlew ?? c.slew);
  close(mb.yaw / ma.yaw, 1.3, 'actual MG horizontal slew');
  close(mb.pitch / ma.pitch, 1.2, 'actual MG elevation slew');
});

test('manual and layout-driven reloads become ready at final stock time divided once by fire', () => {
  for (const [id, loaders] of [['su_t34_85', 1], ['su_t10m', 1], ['de_sdkfz234_2', 0]]) {
    const t = make(id).turrets[0], seconds = reloadTime(t, 0, 0), L = loading.newLoading(1, loaders);
    loading.fired(L, 0);
    const duration = effectiveReloadSeconds(seconds, 'casual');
    assert.deepEqual(loading.tick(L, .001, () => duration), []);
    close(loading.progress(L, 0).total, seconds / 1.2 * (loaders === 0 ? 1.6 : 1), 'actual ready clock');
    const remaining = loading.progress(L, 0).remaining;
    assert.deepEqual(loading.tick(L, remaining - .001, () => duration), []);
    assert.deepEqual(loading.tick(L, .001, () => duration), [0]);
    assert.equal(effectiveReloadSeconds(seconds), seconds);
  }
  // Actual layout owner, from the existing source racks/loaders used by workshop mounts.
  const t = make('su_t34_85').turrets[0];
  t.loaders = [[0, 1, 0]]; t.guns[0].rack = [1, 1, -1];
  const seconds = reloadTime(t, 0, 0), L = loading.newLoading(1, 1);
  loading.fired(L, 0);
  assert.deepEqual(loading.tick(L, seconds / 1.2 - 1e-5, () => effectiveReloadSeconds(reloadTime(t, 0, 0), 'casual')), []);
  assert.deepEqual(loading.tick(L, 1e-5, () => effectiveReloadSeconds(reloadTime(t, 0, 0), 'casual')), [0]);
});

test('actual automatic cannon rounds, belt changes and loader independence use one mode factor', () => {
  const stock = make('su_t10m'), casual = deriveLoadoutPerformance(stock, 'casual');
  const source = stock.turrets[1].guns[0], t = casual.turrets[1], g = t.guns[0];
  const { G, L, fire } = automaticControls(casual, 1);
  g.spin = source.spin = 1;
  const interval = reloadTime(t, 0, 0), stockInterval = reloadTime(stock.turrets[1], 0, 0);
  close(interval, stockInterval / 1.2, 'actual automatic round interval');
  const count = g.ammo[0].count, belt = g.belt;
  for (let n = 0; n < 3; n++) {
    assert.equal(L.state[0], 'ready');
    assert.equal(fire(), true);
    assert.equal(fire(), false, 'cannot emit a second round before ready');
    assert.deepEqual(loading.tick(L, interval - 1e-5, () => reloadTime(t, 0, 0)), []);
    assert.deepEqual(loading.tick(L, 1e-5, () => reloadTime(t, 0, 0)), [0]);
    g.loaded = nextAmmo(g); syncGunShell(g);
  }
  assert.equal(G.shots.length, 3, 'three real projectile emissions');
  assert.equal(G.shots[0].shell, source.shell, 'same projectile definition');
  assert.equal(g.ammo[0].count, count - 3); assert.equal(g.belt, belt - 3);
  g.belt = 0; loading.fired(L, 0);
  const duration = source.def.autocannon.belt_reload_s / 1.2;
  assert.deepEqual(loading.tick(L, duration - 1e-5, () => reloadTime(t, 0, 0)), []);
  assert.equal(g.beltChange, true);
  assert.deepEqual(loading.tick(L, 1e-5, () => reloadTime(t, 0, 0)), [0]);
  refillBelt(g);
  assert.equal(g.belt, Math.min(source.def.autocannon.belt_rounds, roundsLeft(g)));
  assert.equal(g.def.autocannon.spin_up_s, source.def.autocannon.spin_up_s);
});

for (const mode of ['historical', 'casual']) test(`${mode}: cold rotary gun advances partial-spin loading and emits the real ready sequence`, () => {
  const source = data.vehicles.su_t10m.weapons, snapshot = structuredClone(source);
  const original = source.extra_turrets[0].guns[0].gun.autocannon;
  const lo = deriveLoadoutPerformance(make('su_t10m'), mode), t = lo.turrets[1], g = t.guns[0];
  const { G, L, fire, spinStep } = automaticControls(lo, 1);
  const dt = 1 / 120, factor = mode === 'casual' ? 1.2 : 1;
  const rounds = roundsLeft(g), belt = g.belt, fireTicks = [0], cycles = [];
  let cycle;
  assert.equal(g.spin, 0, 'fresh source gun starts cold');
  assert.equal(g.def.autocannon.spin_up_s, original.spin_up_s);
  assert.equal(fire(), true, 'the initially loaded round is allowed at cold start');
  for (let tick = 1; tick <= 48; tick++) {
    const done = loading.tick(L, dt, (gi, li) => {
      const seconds = reloadTime(t, gi, li);
      const expected = 60 / (original.rate_rpm * factor) / Math.max(.12, g.spin);
      close(seconds, expected, 'cold or partial-spin cycle duration');
      cycle = { spin: g.spin, seconds, startTick: tick - 1 };
      cycles.push(cycle);
      return seconds;
    });
    // Match the live owner order: loading advances first, then the held trigger spins up.
    spinStep(dt);
    close(g.spin, Math.min(tick * dt / original.spin_up_s, 1), 'original spin-up clock');
    if (done.length) {
      assert.deepEqual(done, [0]);
      close((tick - cycle.startTick) * dt, Math.ceil((cycle.seconds - 1e-9) / dt) * dt, 'actual ready time at fixed simulation steps');
      g.loaded = nextAmmo(g); syncGunShell(g);
      assert.equal(fire(), true);
      fireTicks.push(tick);
    }
    assert.equal(fire(), false, 'loading prevents another emitted round');
    assert.equal(G.shots.length, fireTicks.length);
    assert.equal(roundsLeft(g), rounds - fireTicks.length);
    assert.equal(g.belt, belt - fireTicks.length);
    assert.equal(g.beltChange, false, 'partial spin does not cause a belt change');
  }
  assert.equal(cycles[0].spin, 0);
  close(fireTicks[1] * dt, Math.ceil((60 / original.rate_rpm / factor / .12 - 1e-9) / dt) * dt, 'first cold-spin ready boundary');
  assert.ok(cycles.some(c => c.spin > .12 && c.spin < 1), 'real firing sequence includes partial spin');
  assert.ok(cycles.some(c => c.spin === 1), 'same sequence reaches full-spin cadence');
  assert.ok(fireTicks.length > 10, 'actual projectile sequence spans the ramp');
  assert.equal(g.spin, 1);
  assert.ok(G.shots.every(shot => shot.shell === g.ammo[0].shell), 'projectile references stay original');
  const emitted = G.shots.length, remainingBelt = g.belt;
  G.fireHeld = false;
  spinStep(original.spin_up_s / 4);
  close(g.spin, .5, 'released trigger uses the original spin-down clock');
  spinStep(original.spin_up_s / 4);
  close(g.spin, 0, 'barrels stop without consuming another round');
  assert.equal(G.shots.length, emitted); assert.equal(g.belt, remainingBelt);
  assert.deepEqual(source, snapshot, 'source weapon and spin values remain immutable');
});

test('real machine gun emits the accelerated cadence and keeps heat per round, bullets and belt capacity', () => {
  const def = data.machineGuns.dt, source = structuredClone(def), casual = deriveMgProfile(def, 'casual');
  assert.equal(deriveMgProfile(def), def);
  assert.equal(deriveMgProfile(def, 'casual'), casual);
  assert.deepEqual(bulletOf(casual), bulletOf(def));
  const st = newMg(casual), interval = 60 / def.rate_rpm / 1.2;
  assert.equal(stepMg(casual, st, true, 0), 1);
  close(st.heat, 1 / def.heat_rounds, 'unchanged heat per round');
  assert.equal(stepMg(casual, st, true, interval - 1e-6), 0);
  assert.equal(stepMg(casual, st, true, 2e-6), 1);
  assert.equal(st.belt, def.belt_rounds - 2);
  st.belt = 1; st.cooldown = 0;
  assert.equal(stepMg(casual, st, true, 0), 1);
  close(st.reload, def.reload_s / 1.2, 'actual belt reload');
  assert.equal(stepMg(casual, st, false, st.reload - 1e-5), 0);
  assert.equal(st.belt, 0);
  // Use the exact remaining clock: split decimal subtraction can leave a ~1e-16 residue.
  stepMg(casual, st, false, st.reload);
  assert.equal(st.belt, def.belt_rounds);
  assert.deepEqual(def, source);
});

test('twin missile launchers consume real rounds at accelerated interlaunch and refill times', () => {
  for (const id of ['us_m901_itv', 'xp_bmp_k64_atgm', 'xp_bmp_k64_kornet']) {
    const source = make(id), t = deriveLoadoutPerformance(source, 'casual').turrets[0], g = t.guns[0];
    const L = loading.newLoading(1, 1), before = roundsLeft(g);
    assert.equal(fireLauncherRound(g, L, 0), true);
    close(g.launcher.cooldown, .25 / 1.2, 'actual missile spacing');
    assert.equal(g.launcher.ready, 1);
    tickLauncher(g, .25 / 1.2 - 1e-5);
    assert.equal(fireLauncherRound(g, L, 0), false);
    tickLauncher(g, 1e-5);
    assert.equal(fireLauncherRound(g, L, 0), true);
    assert.equal(roundsLeft(g), before - 2);
    const duration = source.turrets[0].guns[0].def.reload_s / 1.2;
    assert.deepEqual(loading.tick(L, duration - 1e-5, () => reloadTime(t, 0, 0)), []);
    assert.deepEqual(loading.tick(L, 1e-5, () => reloadTime(t, 0, 0)), [0]);
    refillLauncher(g);
    assert.equal(g.launcher.ready, 2);
    assert.equal(g.def.launcher, source.turrets[0].guns[0].def.launcher, 'unchanged tube geometry');
  }
});

test('APS descriptors accelerate firing and slews while radar, ballistic, damage and heat values remain original', () => {
  const source = data.vehicles.su_t10m.weapons.aps, snapshot = structuredClone(source), casual = deriveApsProfile(source, 'casual');
  assert.equal(deriveApsProfile(source), source);
  assert.equal(deriveApsProfile(source, 'casual'), casual);
  close(casual.rate_rpm / source.rate_rpm, 1.2, 'APS cyclic rate');
  assert.deepEqual(casual.rate_range_rpm, source.rate_range_rpm.map(r => r * 1.2));
  close(casual.traverse_deg_s / source.traverse_deg_s, 1.3, 'APS traverse');
  close(casual.elevate_deg_s / source.elevate_deg_s, 1.2, 'APS elevation');
  for (const key of Object.keys(source).filter(k => !['rate_rpm', 'rate_range_rpm', 'traverse_deg_s', 'elevate_deg_s'].includes(k))) assert.deepEqual(casual[key], source[key], key);
  assert.equal(deriveLoadoutPerformance(make('su_t10m'), 'casual').weapons.aps, casual);
  assert.deepEqual(source, snapshot);
});

test('actual APS world emits the mode-owned rate, consumes one shared round per bullet and obeys gun damage', () => {
  const bytes = fs.readFileSync(new URL('../assets/tg_design.wasm', import.meta.url));
  const source = data.vehicles.su_t10m.weapons.aps;
  for (const mode of ['historical', 'casual']) {
    const core = loadCoreSync(bytes, { materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains) });
    const def = deriveApsProfile(source, mode), rate = source.rate_rpm * (mode === 'casual' ? 1.2 : 1);
    core.call({ op: 'mw_reset', defs: Object.values(data.missiles) });
    core.call({ op: 'mw_aps', owner: 1, team: 0, def, seed: 21 });
    const from = [0, 2, 1000], target = [0, 1.4, 0], delta = target.map((p, i) => p - from[i]), length = Math.hypot(...delta);
    const id = core.call({ op: 'mw_launch', def: 'bgm71a_tow', owner: 99, team: 1, pos: from, dir: delta.map(p => p / length), seed: 3 }).id;
    core.call({ op: 'mw_guide', id, owner: 99, sight: [0, 2.3, 1000], aim: target });
    const actor = { id: 1, team: 0, alive: true, center: [0, 1.3, 0], aps_pivot: [.5, 2.8, .2], aps_base_yaw: 0, aps_gun_ok: true, aps_radar_ok: true };
    let emitted = 0, work = 0, state;
    for (let step = 0; step < 1200 && emitted < 12; step++) {
      const out = core.call({ op: 'mw_step', dt: 1 / 120, actors: [actor] });
      state = out.aps[0];
      if (state.firing) work += rate / 60 / 120;
      emitted += out.fired.length;
      assert.equal(emitted, Math.floor(work + 1e-8), 'real APS cyclic emission count');
      assert.equal(state.rounds, source.rounds - emitted, 'shared magazine consumed exactly once');
      for (const bullet of out.fired) close(Math.hypot(...bullet.vel), source.bullet_speed_ms, 'original APS bullet velocity', 1e-6);
    }
    assert.ok(emitted >= 12, `${mode} APS actually fires`);
    assert.equal(state.rate_rpm, rate);
    const blocked = core.call({ op: 'mw_step', dt: 1 / 120, actors: [{ ...actor, aps_gun_ok: false }] });
    assert.deepEqual(blocked.fired, []);
    assert.equal(blocked.aps[0].rounds, state.rounds);
  }
});

test('invalid modes and timings are rejected without changing source ammunition', () => {
  const lo = make('us_m901_itv'), p = makeParams(lo.vehicle, lo.engine), g = lo.turrets[0].guns[0], L = loading.newLoading(1, 1);
  for (const fn of [() => deriveVehicleParams(p, 'bogus'), () => deriveLoadoutPerformance(lo, 'bogus'), () => deriveMgProfile(data.machineGuns.dt, 'bogus'), () => deriveApsProfile(data.vehicles.su_t10m.weapons.aps, 'bogus'), () => effectiveReloadSeconds(1, 'bogus')]) assert.throws(fn, /gameplay mode/i);
  assert.equal(effectiveReloadSeconds(0, 'casual'), 0);
  for (const seconds of [-1, NaN, Infinity, '10', null]) assert.throws(() => effectiveReloadSeconds(seconds, 'casual'), /seconds/i);
  for (const interval of [0, -1, Infinity, NaN, '0.2', null]) {
    const count = roundsLeft(g);
    assert.throws(() => fireLauncherRound(g, L, 0, interval), /interval/i);
    assert.equal(roundsLeft(g), count);
    assert.equal(L.state[0], 'ready');
  }
});

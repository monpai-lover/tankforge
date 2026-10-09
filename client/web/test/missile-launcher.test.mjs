import test from 'node:test';
import assert from 'node:assert/strict';
import * as loadout from '../src/game/loadout.js';
import * as loading from '../src/sim/loading.js';
import { muzzleLocal } from '../src/sim/gunnery.js';
import { applyAmmo } from '../src/game/deploy.js';
import { loadData } from '../tools/load-data.mjs';

const data = loadData();
const twins = ['us_m901_itv', 'xp_bmp_k64_atgm', 'xp_bmp_k64_kornet'];
const make = id => loadout.makeLoadout(id, data.vehicles[id], data.projectiles, data.machineGuns);
const fire = (g, L) => {
  assert.equal(typeof loadout.fireLauncherRound, 'function', 'loaded launcher tubes need independent consumption');
  return loadout.fireLauncherRound(g, L, 0);
};

test('all three source-confirmed twin ATGM launchers start with two loaded tubes', () => {
  for (const id of twins) {
    const g = make(id).turrets[0].guns[0];
    assert.equal(g.def.launcher?.muzzle_vectors_m?.length, 2, `${id} needs explicit two-tube geometry`);
    assert.equal(g.launcher?.ready, 2, `${id} must load both tubes`);
    assert.equal(g.launcher.nextTube, 0);
    const [a, b] = g.def.launcher.muzzle_vectors_m;
    assert.ok(a.every(Number.isFinite) && b.every(Number.isFinite));
    assert.ok(Math.hypot(...a.map((x, k) => x - b[k])) > 0.1, 'distinct tube mouths');
  }
});

test('the first ATGM leaves its second tube ready and the second starts one full reload', () => {
  for (const id of twins) {
    const t = make(id).turrets[0];
    const g = t.guns[0], count = loadout.roundsLeft(g);
    const L = loading.newLoading(1, 1);
    assert.equal(fire(g, L), true);
    assert.equal(loadout.roundsLeft(g), count - 1);
    assert.equal(g.launcher.ready, 1);
    assert.equal(g.launcher.nextTube, 1);
    assert.equal(L.state[0], 'ready');
    assert.ok(g.loaded >= 0);
    assert.equal(fire(g, L), false, 'a rapid second click respects the server launch spacing');
    assert.equal(loadout.roundsLeft(g), count - 1);
    loadout.tickLauncher(g, 0.25);
    assert.equal(fire(g, L), true, 'second launch does not wait for a reload');
    assert.equal(loadout.roundsLeft(g), count - 2);
    assert.equal(g.launcher.ready, 0);
    assert.equal(g.loaded, -1);
    assert.equal(L.state[0], 'waiting');
    assert.equal(fire(g, L), false, 'empty tubes cannot launch a third round');
    loading.tick(L, 0.01, () => loadout.reloadTime(t, 0, 0));
    assert.ok(loading.progress(L, 0).remaining > g.def.reload_s - 0.02);
    assert.equal(L.loaders.filter(l => l.gun === 0).length, 1);
    const done = loading.tick(L, g.def.reload_s, () => loadout.reloadTime(t, 0, 0));
    assert.deepEqual(done, [0]);
    g.loaded = loadout.nextAmmo(g);
    loadout.refillLauncher(g);
    assert.equal(g.launcher.ready, 2);
    assert.equal(g.launcher.nextTube, 0);
    assert.equal(fire(g, L), true);
    assert.equal(L.state[0], 'ready');
  }
});

test('a one-missile deployment load neither invents a second missile nor queues an empty reload', () => {
  for (const id of twins) {
    const lo = make(id);
    applyAmmo(lo, { [id]: { '0.0': [1] } });
    const g = lo.turrets[0].guns[0];
    const L = loading.newLoading(1, 1);
    assert.equal(g.launcher?.ready, 1);
    assert.equal(fire(g, L), true);
    assert.equal(loadout.roundsLeft(g), 0);
    assert.equal(g.launcher.ready, 0);
    assert.equal(L.state[0], 'empty');
    assert.equal(fire(g, L), false);
    assert.deepEqual(loading.tick(L, 30, () => g.def.reload_s), []);
  }
});

test('the last odd reserve round fills only one tube after reloading', () => {
  const lo = make(twins[0]);
  applyAmmo(lo, { [twins[0]]: { '0.0': [3] } });
  const g = lo.turrets[0].guns[0], L = loading.newLoading(1, 1);
  fire(g, L); loadout.tickLauncher(g, 0.25); fire(g, L);
  loading.tick(L, 12, () => 12);
  g.loaded = loadout.nextAmmo(g);
  loadout.refillLauncher(g);
  assert.equal(g.launcher.ready, 1);
  fire(g, L);
  assert.equal(L.state[0], 'empty');
  assert.equal(loadout.roundsLeft(g), 0);
});

test('each tube mouth follows the common hinge at elevation and turret yaw', () => {
  assert.equal(typeof loadout.launcherMount, 'function');
  for (const id of twins) {
    const t = make(id).turrets[0], g = t.guns[0];
    const mount = { pivot: t.pivot, trunnion: g.trunnion, muzzleOffset: g.muzzleOffset };
    const vectors = g.def.launcher.muzzle_vectors_m;
    const first = loadout.launcherMount(g, mount);
    assert.deepEqual(first.muzzleVector, vectors[0]);
    g.launcher.nextTube = 1;
    const second = loadout.launcherMount(g, mount);
    assert.deepEqual(second.muzzleVector, vectors[1]);
    assert.deepEqual(first.trunnion, second.trunnion, 'shared elevation hinge');
    const a = muzzleLocal(first, { yaw: 0.8, pitch: 0.35 });
    const b = muzzleLocal(second, { yaw: 0.8, pitch: 0.35 });
    const expected = Math.hypot(...vectors[0].map((x, k) => x - vectors[1][k]));
    assert.ok(Math.abs(Math.hypot(...a.pos.map((x, k) => x - b.pos[k])) - expected) < 1e-8);
    assert.deepEqual(a.dir, b.dir);
  }
});

test('the second tube stays loaded during the short launch interval and opens exactly at 0.25 seconds', () => {
  const g = make(twins[0]).turrets[0].guns[0], L = loading.newLoading(1, 1);
  fire(g, L);
  assert.equal(g.launcher.cooldown, 0.25);
  assert.equal(L.state[0], 'ready', 'cooldown is separate from loading');
  loadout.tickLauncher(g, 0.24);
  assert.equal(fire(g, L), false);
  assert.equal(g.launcher.ready, 1);
  loadout.tickLauncher(g, 0.01);
  assert.equal(fire(g, L), true);
  assert.equal(L.state[0], 'waiting');
});

test('ordinary guns and independent unguided rocket rails retain their loading behavior', () => {
  const cannon = make('de_tiger_e').turrets[0].guns[0];
  assert.equal(cannon.launcher, undefined);
  const rockets = make('su_bmpt34').turrets[0].guns.filter(g => g.def.missile);
  assert.equal(rockets.length, 2);
  for (const g of rockets) {
    assert.equal(g.launcher?.ready, 1);
    assert.equal(fire(g, loading.newLoading(1, 1)), true);
    assert.equal(g.launcher.ready, 0);
  }
});

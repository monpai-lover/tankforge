import test from 'node:test';
import assert from 'node:assert/strict';
import * as loading from '../src/sim/loading.js';
import { loadData } from '../tools/load-data.mjs';
import { buildToBundle, makeLoadout, newTurretSpec, reloadTime } from '../src/game/loadout.js';
const data = loadData();
for (const loaders of [0, 1]) test(`mixed workshop source weapons cycle independently of ${loaders}-loader cannon queue`, () => {
  const build = { base: 'de_hetzer', keepStock: false, turrets: [{ ...newTurretSpec(), loaders, guns: [{ cal: 75, len: 48 }, { weapon: 'xp_kda35' }, { weapon: 'xp_bmp_k64_atgm' }] }] };
  const c = buildToBundle(build, data), t = makeLoadout('custom', c.bundle, { ...data.projectiles, ...c.projectiles }, data.machineGuns).turrets[0];
  const L = loading.newLoading(t.guns.length, t.loaders.length, t.guns.map(g => !g.rack));
  for (let gi = 0; gi < 3; gi++) loading.fired(L, gi);
  const interval = reloadTime(t, 1, 0);
  assert.deepEqual(loading.tick(L, interval, (gi, li) => reloadTime(t, gi, li)), [1]);
  assert.equal(L.state[0], 'loading'); assert.equal(L.state[1], 'ready'); assert.equal(L.state[2], 'loading');
  assert.equal(loading.progress(L, 2).total, data.vehicles.xp_bmp_k64_atgm.weapons.main_gun.reload_s);
  assert.equal(loading.progress(L, 0).total, reloadTime(t, 0, 0) * (loaders === 0 ? 1.6 : 1));
  loading.fired(L, 1);
  assert.deepEqual(loading.tick(L, interval, (gi, li) => reloadTime(t, gi, li)), [1], 'automatic gun cannot steal or wait on the manual loader');
});
test('fully independent weapons have one clock per weapon and no idle manual pool', () => {
  const L = loading.newLoading(2, 0, [true, true]);
  assert.equal(L.loaders.length, 2); loading.fired(L, 0); loading.fired(L, 1);
  assert.deepEqual(loading.tick(L, .1, () => .1), [0, 1]);
});

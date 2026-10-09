import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/load-data.mjs';
import { PRESETS, MAX_TURRETS, MAX_GUNS_PER_TURRET } from '../src/game/loadout.js';
const api = await import('../src/game/workshopBuild.js').catch(() => ({}));
const data = loadData();
const build = () => ({ base: 'de_hetzer', keepStock: false, turrets: [{ guns: [{ cal: 75, len: 48 }] }] });
const normalize = b => { assert.equal(typeof api.normalizeWorkshopBuild, 'function'); return api.normalizeWorkshopBuild(b, data); };

test('legacy workshop builds receive defaults without mutating their input', () => {
  const b = build(), before = structuredClone(b), n = normalize(b);
  assert.deepEqual(b, before); assert.notEqual(n, b);
  assert.deepEqual(n.turrets[0], { x: 0, z: 0, lift: 0, facing: 0, arc: 360, ring: 1.4, loaders: 1, rack: 'ready', open: false, stabilizer: 'none', guns: [{ weapon: 'custom', cal: 75, len: 48 }] });
  for (const p of Object.values(PRESETS)) assert.equal(normalize(p.build).base, p.build.base);
});
test('workshop accepts its own export envelope and trusts only editable settings', () => {
  const b = build(); b.turrets[0].guns = [{ weapon: 'xp_kda35' }]; b.turrets[0].sightSource = 'us_m901_itv'; b.turrets[0].stabilizer = 'both';
  const n = normalize({ build: b, files: { 'weapons.json': { malicious: true } }, projectiles: { fake: true } });
  assert.equal(n.turrets[0].guns[0].weapon, 'xp_kda35'); assert.equal(n.turrets[0].sightSource, 'us_m901_itv'); assert.equal(n.turrets[0].stabilizer, 'both');
  assert.deepEqual(Object.keys(n).sort(), ['base', 'keepStock', 'turrets']);
});
test('source guns below the custom calibre range remain available', () => {
  const b = build(); b.turrets[0].guns = [{ weapon: 'xp_bmp_k64', cal: 14.5 }];
  assert.deepEqual(normalize(b).turrets[0].guns, [{ weapon: 'xp_bmp_k64' }]);
});
test('invalid numeric or source settings fail before changing the previous build', () => {
  const b = build(), original = JSON.stringify(b);
  for (const [field, value] of [['lift', NaN], ['ring', Infinity], ['loaders', 1.5], ['arc', 500], ['sightSource', 'unknown'], ['stabilizer', 'magic']]) {
    const bad = structuredClone(b); bad.turrets[0][field] = value; assert.throws(() => normalize(bad));
  }
  for (const gun of [{ weapon: 'unknown' }, { cal: '75', len: 48 }, { cal: 0, len: 48 }, { cal: 75, len: 100 }]) {
    const bad = structuredClone(b); bad.turrets[0].guns = [gun]; assert.throws(() => normalize(bad));
  }
  assert.throws(() => normalize({ ...b, base: '__proto__' })); assert.equal(JSON.stringify(b), original);
});
test('oversized or malformed structures cannot enter the workshop', () => {
  for (const b of [null, [], {}, { ...build(), keepStock: 'false' }, { ...build(), turrets: Array(MAX_TURRETS + 1).fill(build().turrets[0]) }, { ...build(), turrets: [{ guns: [] }] }, { ...build(), turrets: [{ guns: Array(MAX_GUNS_PER_TURRET + 1).fill({ cal: 75, len: 48 }) }] }]) assert.throws(() => normalize(b));
});
test('removing all new turrets retains the original weapon consistently', () => {
  assert.equal(normalize({ base: 'de_hetzer', keepStock: false, turrets: [] }).keepStock, true);
});

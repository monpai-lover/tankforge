import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../tools/load-data.mjs';
import { loadCoreSync } from '../src/design/core.js';
import { newDesign } from '../src/design/templates.js';
import { Combat, targetDef, emptyRacks } from '../src/game/combat.js';
import { makeLoadout, roundsLeft } from '../src/game/loadout.js';

const data = loadData();
// Override only for source-build verification; the normal suite uses the shipped core.
const core = loadCoreSync(fs.readFileSync(process.env.TG_TEST_WASM || new URL('../assets/tg_design.wasm', import.meta.url)),
  {materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains)});
function exportedEmpty() {
  const design = newDesign('medium', data.designCatalog);
  design.ammunition = [];
  const report = core.evaluate(design, {files: true, mobility: false});
  const files = JSON.parse(JSON.stringify(report.files));
  assert.ok(files, 'real design compiler must produce the ordinary folder');
  const bundle = Object.fromEntries(['vehicle', 'weapons', 'armor', 'modules', 'crew', 'engine', 'visual'].map(k => [k, files[k + '.json']]));
  return {report, bundle};
}
const racksOf = bundle => bundle.modules.map((m, i) => [m, i]).filter(([m]) => m.kind === 'ammo_rack');

test('real compiled empty-ammo folder reimports with zero JS rounds and native capacity', () => {
  const {bundle} = exportedEmpty(), gun = bundle.weapons.main_gun;
  assert.deepEqual(gun.ammo_count, gun.ammo.map(() => 0), 'empty counts must be authored, not omitted legacy defaults');
  const shells = Object.fromEntries(core.shells(gun.caliber_mm, gun.barrel_length_mm / gun.caliber_mm).map(s => [s.id, s]));
  const lo = makeLoadout('empty:export', bundle, shells, data.machineGuns);
  assert.equal(lo.turrets.flatMap(t => t.guns).reduce((n, g) => n + roundsLeft(g), 0), 0);
  assert.equal(targetDef('empty:export', bundle).ammo_capacity, 0);
  assert.ok(racksOf(bundle).length > 0);
  assert.ok(racksOf(bundle).every(([m]) => m.rounds === 0));
});

test('actual compiled zero racks remain empty when fresh, loaded or read from old state', () => {
  const {bundle} = exportedEmpty(), c = new Combat(core, data.machineGuns), key = 'empty:states';
  const fresh = c.fresh(key, bundle), racks = racksOf(c.describe(key));
  assert.deepEqual(c.describe(key).binding_errors, {});
  assert.ok(racks.every(([, i]) => fresh.state.rack_fill?.[i] === 0));
  assert.equal(emptyRacks(bundle, fresh.state).size, racks.length);
  assert.equal(emptyRacks(c.describe(key)).size, racks.length, 'an absent old state still draws authored zero racks empty');
  for (const fill of [undefined, Array(bundle.modules.length).fill(1)]) {
    const state = {...fresh.state, rack_fill: fill};
    assert.equal(emptyRacks(c.describe(key), state).size, racks.length, 'missing or stale fill cannot draw authored zero racks full');
    for (const [m, i] of racks) state.modules[i] = m.max_health * .25;
    assert.equal(c.advance(key, state, 0, 1).caps.weapons['gun:0:0'].reload_mult, 1, 'empty damaged racks never slow feeding');
    for (const carried of [0, 10]) {
      const loaded = c.ammo(key, state, carried);
      assert.ok(racks.every(([, i]) => loaded.state.rack_fill[i] === 0));
      assert.equal(loaded.caps.weapons['gun:0:0'].reload_mult, 1);
      assert.deepEqual(loaded.state.modules, state.modules, 'loading cannot restore health');
    }
  }
});

test('compiled empty racks cannot acquire shell damage or fire cookoff from stale fill', () => {
  const {bundle} = exportedEmpty(), c = new Combat(core, data.machineGuns), key = 'empty:hits';
  const fresh = c.fresh(key, bundle), racks = racksOf(c.describe(key)), rackIds = new Set(racks.map(([m]) => m.id));
  const shell = core.shells(75, 48).find(s => s.kind === 'ap');
  assert.ok(shell);
  for (const fill of [undefined, Array(bundle.modules.length).fill(1)]) {
    const state = {...fresh.state, modules: fresh.state.modules.slice(), rack_fill: fill};
    for (const [, i] of racks) state.modules[i] = 1;
    for (const [m, i] of racks) {
      const p = m.center;
      for (let seed = 1; seed <= 8; seed++) {
        const r = c.shoot(key, state, {shell, origin: [p.x + 10, p.y, p.z], dir: [-1, 0, 0], speed_ms: 800, distance_m: 0, seed, turret_yaw: 0});
        assert.ok(r.modules.every(m => !rackIds.has(m.id)), 'empty racks have nothing to hit');
        assert.ok(r.fragments.every(f => !rackIds.has(f.hit)), 'empty racks do not block fragments');
        assert.equal(r.state.modules[i], 1);
        assert.equal(r.state.ammo_detonated, false);
      }
      const burning = {...state, fire_s: 50, fire_at: p};
      const result = c.advance(key, burning, 40, 1);
      assert.equal(result.state.modules[i], 1);
      assert.equal(result.state.ammo_detonated, false);
      assert.ok(!result.events.includes('ammo_detonation'));
    }
  }
});

test('ordinary legacy omitted counts and rack capacities retain their original inference', () => {
  const {bundle} = exportedEmpty(), gun = bundle.weapons.main_gun;
  delete gun.ammo_count;
  for (const [m] of racksOf(bundle)) delete m.rounds;
  const shells = Object.fromEntries(core.shells(gun.caliber_mm, gun.barrel_length_mm / gun.caliber_mm).map(s => [s.id, s]));
  const lo = makeLoadout('empty:legacy', bundle, shells, data.machineGuns);
  assert.equal(roundsLeft(lo.turrets[0].guns[0]), 40);
  assert.equal(targetDef('empty:legacy', bundle).ammo_capacity, 40);
  const c = new Combat(core, data.machineGuns), key = 'empty:legacy', fresh = c.fresh(key, bundle);
  assert.equal(emptyRacks(bundle, fresh.state).size, 0, 'legacy inferred racks draw full without fill metadata');
  for (const rounds of [undefined, 20]) {
    const view = {...bundle, modules: bundle.modules.map(m => m.kind === 'ammo_rack' ? {...m, rounds} : m)};
    assert.equal(emptyRacks(view).size, 0, 'legacy and positive declared racks retain full defaults');
    const stale = {...fresh.state, rack_fill: Array(bundle.modules.length).fill(1)};
    const before = JSON.stringify(stale);
    assert.equal(emptyRacks(view, stale).size, 0);
    assert.equal(JSON.stringify(stale), before, 'presentation preserves supplied authoritative state');
  }
  const [rack, i] = racksOf(c.describe(key))[0];
  fresh.state.modules[i] = rack.max_health * .25;
  assert.equal(c.advance(key, fresh.state, 0, 1).caps.weapons['gun:0:0'].reload_mult, 1.25);
  const empty = c.ammo(key, fresh.state, 0);
  assert.ok(racksOf(bundle).every(([, i]) => empty.state.rack_fill[i] === 0));
  assert.equal(empty.caps.weapons['gun:0:0'].reload_mult, 1);
});

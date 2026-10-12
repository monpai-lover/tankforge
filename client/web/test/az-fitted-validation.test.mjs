import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/load-data.mjs';
import { makeLoadout } from '../src/game/loadout.js';
import { moduleDamageLabels } from '../src/game/weaponDamage.js';

const data = loadData();
const stock = data.vehicles.su_t72a;
const make = bundle => makeLoadout('su_t72a', bundle, data.projectiles, data.machineGuns);

test('the genuine stock AZ mount retains its two physical parts and 44 mm APFSDS flight body', () => {
  const gun = make(stock).turrets[0].guns[0];
  assert.equal(gun.loadingOwner, 'mechanized');
  assert.equal(gun.mechanizedLoading.mechanism, 'az_t72');
  assert.deepEqual(gun.mechanizedLoading.modules, ['az_drive', 'az_ram']);
  assert.deepEqual(gun.mechanizedLoading.modules.map(id => stock.modules.find(m => m.id === id).kind), ['horizontal_drive', 'vertical_drive']);
  assert.equal(gun.capacity, 22);
  assert.equal(gun.def.id, '2a46_1_125');
  assert.equal(gun.def.caliber_mm, 125);
  assert.equal(gun.shell.id, 'apfsds_125_3bm22');
  assert.equal(gun.shell.caliber_mm, 44);
  assert.deepEqual(gun.ammo.map(a => a.count), [8, 6, 8]);
});

// Match the native vehicle/combat validators: only horizontal/vertical drive
// kinds are physical AZ parts. Existing unrelated IDs must not grant a fit.
for (const part of stock.modules.filter(m => !['horizontal_drive', 'vertical_drive'].includes(m.kind))) {
  test(`actual loadout rejects forged AZ reference to existing ${part.id} (${part.kind})`, () => {
    const bundle = structuredClone(stock);
    assert.equal(bundle.modules.filter(m => m.id === part.id).length, 1);
    bundle.weapons.mechanized_loading.modules = [part.id];
    assert.throws(() => make(bundle), /mechanized|carousel/i);
  });
}

for (const id of stock.weapons.mechanized_loading.modules) {
  for (const kind of ['engine', 'turret_drive']) {
    test(`actual loadout rejects named AZ part ${id} retyped as ${kind}`, () => {
      const bundle = structuredClone(stock);
      bundle.modules.find(m => m.id === id).kind = kind;
      assert.throws(() => make(bundle), /mechanized|carousel/i);
    });
  }
}

test('actual loadout rejects a missing referenced AZ physical part', () => {
  const bundle = structuredClone(stock);
  bundle.modules = bundle.modules.filter(m => m.id !== 'az_drive');
  assert.throws(() => make(bundle), /mechanized|carousel/i);
});

test('actual loadout rejects an ambiguous duplicate referenced AZ physical part', () => {
  const bundle = structuredClone(stock);
  bundle.modules.push(structuredClone(bundle.modules.find(m => m.id === 'az_ram')));
  assert.throws(() => make(bundle), /mechanized|carousel/i);
});

test('production module damage labels present both fitted AZ parts with their human name', () => {
  const labels = moduleDamageLabels(make(stock), stock.modules);
  assert.equal(labels.get('az_drive'), 'AZ 自動裝彈機構');
  assert.equal(labels.get('az_ram'), 'AZ 自動裝彈機構');
  assert.equal(labels.get('engine'), '引擎');
  assert.ok(!labels.get('az_carousel').includes('自動裝彈機構'));
  assert.ok([...labels.values()].every(label => !label.includes('az_t72')));
});

test('the same gun without fitted metadata retains manual loading and ordinary part labels', () => {
  const bundle = structuredClone(stock);
  delete bundle.weapons.mechanized_loading;
  const loadout = make(bundle);
  assert.equal(loadout.turrets[0].guns[0].loadingOwner, 'manual');
  assert.equal(loadout.turrets[0].guns[0].mechanizedLoading, null);
  const labels = moduleDamageLabels(loadout, bundle.modules);
  assert.ok(!labels.get('az_drive').includes('自動裝彈機構'));
  assert.ok(!labels.get('az_ram').includes('自動裝彈機構'));
});

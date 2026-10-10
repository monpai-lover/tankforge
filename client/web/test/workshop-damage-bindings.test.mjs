import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../tools/load-data.mjs';
import { exportFolder, newTurretSpec, PRESETS } from '../src/game/loadout.js';
import { decodeAllImported } from '../src/gfx/imported.js';
const data = loadData();
await decodeAllImported(data.vehicles);
const cases = [
  {base: 'de_hetzer', keepStock: false, turrets: [{...newTurretSpec(), guns: [{weapon: 'us_m901_itv'}, {weapon: 'us_m901_itv'}]}]},
  PRESETS.porcupine.build,
  {base: 'su_t10m', keepStock: true, turrets: [{...newTurretSpec(), guns: [{weapon: 'us_m901_itv'}]}]},
];

test('real workshop exports bind authored module identities to their actual turret indices', () => {
  for (const build of cases) {
    const before = JSON.stringify(data.vehicles[build.base]);
    const {files, layouts} = exportFolder(build, data, data.vehicles[build.base], 'binding_export_test', 'bindings');
    const weapons = files['weapons.json'], modules = files['modules.json'];
    const stock = build.keepStock ? 1 + (data.vehicles[build.base].weapons.extra_turrets || []).length : 0;
    layouts.forEach((layout, i) => {
      const ti = stock + i;
      layout.guns.forEach((g, gi) => {
        const mount = ti === 0 ? gi === 0 ? weapons : weapons.extra_guns[gi - 1] : weapons.extra_turrets[ti - 1].guns[gi];
        const prefix = g.gun.missile ? 'launcher' : 'breech';
        assert.ok(mount.damage?.critical.includes(`${prefix}_${layout.id}_${gi}`));
        for (const id of [...mount.damage.critical, ...mount.damage.traverse, ...mount.damage.ammo_racks]) {
          assert.equal(modules.find(m => m.id === id).turret_index, ti, id);
        }
      });
    });
    assert.equal(JSON.stringify(data.vehicles[build.base]), before, 'export leaves the source bundle untouched');
  }
});

test('weapons schema covers root, gun, mount and secondary association fields', () => {
  const schema = JSON.parse(fs.readFileSync(new URL('../../../schemas/weapons.schema.json', import.meta.url), 'utf8'));
  for (const props of [schema.properties, schema.$defs.gun.properties, schema.$defs.gun_mount.properties]) {
    assert.equal(props.weapon_group.$ref, '#/$defs/weapon_group');
    assert.equal(props.damage.$ref, '#/$defs/damage');
  }
  assert.equal(schema.properties.secondary.items.properties.weapon_group.$ref, '#/$defs/weapon_group');
  assert.equal(schema.$defs.weapon_group.minLength, 1);
  assert.equal(schema.$defs.damage.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.$defs.damage.properties).sort(), ['ammo_racks', 'critical', 'elevation', 'traverse']);
  assert.equal(schema.$defs.damage.properties.critical.minItems, 1);
  assert.equal(schema.$defs.module_refs.items.type, 'string');
  assert.equal(schema.$defs.module_refs.items.minLength, 1);
});

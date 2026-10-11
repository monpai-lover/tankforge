import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextSightWeapon, machineGunTrigger, ammoKeyIndex,
  weaponControlKey, weaponControlSlots, nextWeaponControl, weaponControlSight,
  gunControlActive, mgControlActive, gunTrigger, weaponControlLabel,
} from '../src/game/weaponselection.js';

const all = { kind: 'all' };
const gun = (ti, gi) => ({ kind: 'gun', ti, gi });
const mg = mi => ({ kind: 'mg', mi });

function mixedLoadout() {
  const cannon = { id: 'duplicate-cannon', name: 'Twin cannon' };
  const machineGun = { id: 'duplicate-mg', name: '同型機槍' };
  return {
    turrets: [
      { guns: [{ def: cannon, stock: 0 }, { def: cannon, broken: true }] },
      { guns: [] },
      { guns: [{ def: cannon, loading: 'reloading' }] },
    ],
    machineGuns: [
      { def: machineGun, stock: 0 },
      { def: machineGun, broken: true },
      { def: machineGun, loading: 'reloading' },
    ],
  };
}

test('ammo slots 5 through 9 work on both number rows', () => {
  for (const prefix of ['Digit', 'Numpad']) for (let n = 1; n <= 9; n++) assert.equal(ammoKeyIndex(prefix + n), n - 1);
  for (const key of ['KeyG', 'Digit0', 'NumpadAdd', 'Digit10']) assert.equal(ammoKeyIndex(key), -1);
});

test('temporary legacy sight cycle still supports the existing runtime caller', () => {
  const lo = { turrets: [{ guns: [{}, {}] }, { guns: [{}] }], machineGuns: [{ mount: 'coax' }, { mount: 'pintle' }, { mount: 'hull' }] };
  let selection = { ti: 0, gi: 0, mi: -1 };
  const seen = [];
  for (let i = 0; i < 6; i++) { selection = nextSightWeapon(lo, selection); seen.push(selection); }
  assert.deepEqual(seen, [
    { ti: 0, gi: 1, mi: -1 }, { ti: 1, gi: 0, mi: -1 },
    { ti: 0, gi: 0, mi: 0 }, { ti: 0, gi: 0, mi: 1 }, { ti: 0, gi: 0, mi: 2 },
    { ti: 0, gi: 0, mi: -1 },
  ]);
});

test('temporary numeric MG callers retain their existing trigger behavior', () => {
  for (let i = 0; i < 3; i++) {
    assert.equal(machineGunTrigger(1, i, true, false), i === 1);
    assert.equal(machineGunTrigger(1, i, false, true), i === 1);
    assert.equal(machineGunTrigger(-1, i, true, false), false);
    assert.equal(machineGunTrigger(-1, i, false, true), true);
    assert.equal(machineGunTrigger(1, i, false, false), false);
  }
});

test('ALL and the first solo gun have distinct control identities', () => {
  assert.equal(weaponControlKey(all), 'all');
  assert.equal(weaponControlKey(gun(0, 0)), 'gun:0:0');
  assert.equal(weaponControlKey(gun(2, 1)), 'gun:2:1');
  assert.equal(weaponControlKey(mg(0)), 'mg:0');
  assert.equal(weaponControlKey(mg(1)), 'mg:1');
});

test('control slots include duplicate, empty-stock, broken and reloading weapons in loadout order', () => {
  assert.deepEqual(weaponControlSlots(mixedLoadout()), [
    all, gun(0, 0), gun(0, 1), gun(2, 0), mg(0), mg(1), mg(2),
  ]);
});

test('G repeats three complete ALL-to-solo cycles without skipping gun zero or any MG', () => {
  const lo = mixedLoadout();
  const expected = [gun(0, 0), gun(0, 1), gun(2, 0), mg(0), mg(1), mg(2), all];
  let control = all;
  for (let cycle = 0; cycle < 3; cycle++) {
    const seen = [];
    for (let step = 0; step < expected.length; step++) {
      control = nextWeaponControl(lo, control);
      seen.push(control);
    }
    assert.deepEqual(seen, expected, `complete cycle ${cycle + 1}`);
  }
});

test('missing or malformed gun and MG slots reset the next control to ALL', () => {
  const lo = mixedLoadout();
  for (const control of [gun(99, 0), gun(1, 0), gun(0, 99), { kind: 'gun', ti: 0 }, mg(-1), mg(99), { kind: 'mg' }]) {
    assert.deepEqual(nextWeaponControl(lo, control), all);
  }
});

test('an empty loadout stays at ALL through repeated cycles', () => {
  const lo = { turrets: [{ guns: [] }], machineGuns: [] };
  assert.deepEqual(weaponControlSlots(lo), [all]);
  let control = all;
  for (let i = 0; i < 3; i++) {
    control = nextWeaponControl(lo, control);
    assert.deepEqual(control, all);
  }
  assert.deepEqual(nextWeaponControl({ turrets: [], machineGuns: [] }, gun(0, 0)), all);
});

test('ALL sights the first gun even after an empty turret; solo sights the exact gun', () => {
  const lo = { turrets: [{ guns: [] }, { guns: [{}, {}] }, { guns: [{}] }], machineGuns: [] };
  assert.deepEqual(weaponControlSight(lo, all), { ti: 1, gi: 0, mi: -1 });
  assert.deepEqual(weaponControlSight(lo, gun(1, 0)), { ti: 1, gi: 0, mi: -1 });
  assert.deepEqual(weaponControlSight(lo, gun(1, 1)), { ti: 1, gi: 1, mi: -1 });
  assert.deepEqual(weaponControlSight(lo, gun(2, 0)), { ti: 2, gi: 0, mi: -1 });
});

test('MG control retains the first gun sight context and its own MG index', () => {
  const lo = { turrets: [{ guns: [] }, { guns: [{}] }], machineGuns: [{}, {}] };
  assert.deepEqual(weaponControlSight(lo, mg(0)), { ti: 1, gi: 0, mi: 0 });
  assert.deepEqual(weaponControlSight(lo, mg(1)), { ti: 1, gi: 0, mi: 1 });
});

test('a loadout without guns supplies a safe zero sight context', () => {
  const lo = { turrets: [], machineGuns: [{}] };
  assert.deepEqual(weaponControlSight(lo, all), { ti: 0, gi: 0, mi: -1 });
  assert.deepEqual(weaponControlSight(lo, mg(0)), { ti: 0, gi: 0, mi: 0 });
});

test('labels distinguish ALL from gun zero and duplicate MG slots', () => {
  const lo = mixedLoadout();
  assert.equal(weaponControlLabel(lo, all), '全炮開火');
  assert.equal(weaponControlLabel(lo, gun(0, 0)), '炮塔 1 · 火炮 1 單獨開火');
  assert.equal(weaponControlLabel(lo, gun(2, 0)), '炮塔 3 · 火炮 1 單獨開火');
  assert.equal(weaponControlLabel(lo, mg(0)), '機槍 1 · 同型機槍 單獨開火');
  assert.equal(weaponControlLabel(lo, mg(1)), '機槍 2 · 同型機槍 單獨開火');
  assert.equal(weaponControlLabel(lo, mg(2)), '機槍 3 · 同型機槍 單獨開火');
});

test('MG labels fall back from definition name to weapon name then definition ID', () => {
  const lo = {
    turrets: [],
    machineGuns: [
      { def: { name: 'Display name', id: 'definition' }, weapon: 'weapon' },
      { def: { name: '', id: 'definition' }, weapon: 'weapon' },
      { def: { id: 'definition' } },
    ],
  };
  assert.equal(weaponControlLabel(lo, mg(0)), '機槍 1 · Display name 單獨開火');
  assert.equal(weaponControlLabel(lo, mg(1)), '機槍 2 · weapon 單獨開火');
  assert.equal(weaponControlLabel(lo, mg(2)), '機槍 3 · definition 單獨開火');
});

test('solo gun motor eligibility excludes the other gun on its turret and every MG', () => {
  for (const [ti, gi] of [[0, 0], [0, 1], [2, 0]]) {
    assert.equal(gunControlActive(all, ti, gi), true);
    assert.equal(gunControlActive(gun(0, 1), ti, gi), ti === 0 && gi === 1);
    assert.equal(gunControlActive(mg(1), ti, gi), false);
  }
  for (let mi = 0; mi < 3; mi++) assert.equal(mgControlActive(gun(0, 1), mi), false);
});

test('solo MG motor eligibility excludes every other MG and every gun', () => {
  for (let mi = 0; mi < 3; mi++) {
    assert.equal(mgControlActive(all, mi), true);
    assert.equal(mgControlActive(mg(1), mi), mi === 1);
  }
  for (const [ti, gi] of [[0, 0], [0, 1], [2, 0]]) assert.equal(gunControlActive(mg(1), ti, gi), false);
});

test('solo primary fires only the exact selected gun regardless of its normal trigger group', () => {
  for (const def of [{}, { trigger: 'secondary' }, { autocannon: true }, { trigger: 'rocket' }]) {
    assert.equal(gunTrigger(gun(0, 1), 0, 1, def), true);
    assert.equal(gunTrigger(gun(0, 1), 0, 0, def), false);
    assert.equal(gunTrigger(gun(0, 1), 2, 1, def), false);
    assert.equal(gunTrigger(mg(1), 0, 1, def), false);
  }
});

test('solo secondary accepts explicit secondary guns and unmarked autocannons', () => {
  for (const [def, expected] of [[{}, false], [{ trigger: 'secondary' }, true], [{ autocannon: true }, true], [{ autocannon: false }, false]]) {
    assert.equal(gunTrigger(gun(0, 1), 0, 1, def, true), expected);
    assert.equal(gunTrigger(gun(0, 1), 0, 0, def, true), false);
  }
});

test('solo APS-owned gun accepts both triggers while other guns stay inactive', () => {
  assert.equal(gunTrigger(gun(2, 0), 2, 0, {}, false, false, 2), true);
  assert.equal(gunTrigger(gun(2, 0), 2, 0, {}, true, false, 2), true);
  assert.equal(gunTrigger(gun(2, 0), 0, 0, {}, false, false, 2), false);
  assert.equal(gunTrigger(gun(2, 0), 2, 1, {}, true, false, 2), false);
});

test('rocket trigger accepts only active rocket guns and takes precedence over secondary grouping', () => {
  const rocket = { trigger: 'rocket' };
  for (const secondary of [false, true]) {
    assert.equal(gunTrigger(all, 0, 0, rocket, secondary, true), true);
    assert.equal(gunTrigger(all, 0, 0, { trigger: 'secondary' }, secondary, true), false);
    assert.equal(gunTrigger(gun(0, 1), 0, 1, rocket, secondary, true), true);
    assert.equal(gunTrigger(gun(0, 1), 0, 0, rocket, secondary, true), false);
    assert.equal(gunTrigger(mg(0), 0, 0, rocket, secondary, true), false);
  }
});

test('ALL uses primary for normal and unmarked automatic guns, and secondary for explicit secondary and APS guns', () => {
  const cases = [
    [0, {}, true, false],
    [0, { autocannon: true }, true, false],
    [1, { autocannon: true }, true, false],
    [0, { trigger: 'secondary' }, false, true],
    [2, {}, false, true],
    [2, { autocannon: true }, false, true],
    [0, { trigger: 'rocket' }, false, false],
    [2, { trigger: 'rocket' }, false, false],
  ];
  for (const [ti, def, primary, secondary] of cases) {
    assert.equal(gunTrigger(all, ti, 0, def, false, false, 2), primary);
    assert.equal(gunTrigger(all, ti, 0, def, true, false, 2), secondary);
  }
});

test('ALL primary grouping is independent of retained sight indices', () => {
  for (const sight of [gun(0, 0), gun(0, 1), gun(1, 0), mg(2)]) {
    const control = { kind: 'all', ti: sight.ti, gi: sight.gi, mi: sight.mi };
    for (const ti of [0, 1]) {
      assert.equal(gunTrigger(control, ti, 0, { autocannon: true }), true);
      assert.equal(gunTrigger(control, ti, 0, { autocannon: true }, true), false);
    }
  }
});

test('object-state MG triggers fire only the selected MG with either input; gun SOLO suppresses all MGs', () => {
  for (let index = 0; index < 3; index++) {
    for (const [primary, secondary] of [[false, false], [true, false], [false, true], [true, true]]) {
      assert.equal(machineGunTrigger(mg(1), index, primary, secondary), index === 1 && (primary || secondary));
      assert.equal(machineGunTrigger(gun(0, 0), index, primary, secondary), false);
      assert.equal(machineGunTrigger(all, index, primary, secondary), secondary);
    }
  }
});

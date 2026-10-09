import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSightWeapon, machineGunTrigger, ammoKeyIndex } from '../src/game/weaponselection.js';

test('ammo slots 5 through 9 work on both number rows', () => {
  for (const prefix of ['Digit', 'Numpad']) for (let n = 1; n <= 9; n++) assert.equal(ammoKeyIndex(prefix + n), n - 1);
  for (const key of ['KeyG', 'Digit0', 'NumpadAdd', 'Digit10']) assert.equal(ammoKeyIndex(key), -1);
});

test('G cycles turret weapons then every independent machine gun and returns to main', () => {
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

test('selected MG fires alone on primary or secondary; original secondary fires all in cannon mode', () => {
  for (let i = 0; i < 3; i++) {
    assert.equal(machineGunTrigger(1, i, true, false), i === 1);
    assert.equal(machineGunTrigger(1, i, false, true), i === 1);
    assert.equal(machineGunTrigger(-1, i, true, false), false);
    assert.equal(machineGunTrigger(-1, i, false, true), true);
    assert.equal(machineGunTrigger(1, i, false, false), false);
  }
});

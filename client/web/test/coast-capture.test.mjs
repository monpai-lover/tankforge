import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../tools/load-data.mjs';
import { loadBattleMap } from '../src/game/battlemap.js';
import { Conquest, CAPTURE_TIME, captureMessage } from '../src/game/conquest.js';

const def = loadData().maps.coast;
const map = await loadBattleMap(def);

test('coast has three distinct ABC capture circles entirely on dry ground', () => {
  assert.deepEqual(map.points.map(p => p.id), ['A', 'B', 'C']);
  for (const p of map.points) {
    assert.equal(p.r, 45);
    assert.ok(Math.abs(p.x) + p.r < map.size / 2 && Math.abs(p.z) + p.r < map.size / 2);
    for (let dx = -p.r; dx <= p.r; dx += 5) for (let dz = -p.r; dz <= p.r; dz += 5) {
      if (dx * dx + dz * dz > p.r * p.r) continue;
      assert.notEqual(map.classAt(p.x + dx, p.z + dz), map.WATER, `${p.id} circle cannot lie in the river`);
      assert.ok(map.height(p.x + dx, p.z + dz) > map.waterLevel, `${p.id} circle must stand above water`);
    }
    for (const spawns of Object.values(map.spawns)) for (const spawn of spawns) {
      assert.ok(Math.hypot(p.x - spawn.x, p.z - spawn.z) > 4 * p.r, `${p.id} must be away from team spawns`);
    }
  }
});

test('every coast point participates in capture, contesting and ticket loss', () => {
  assert.equal(map.points.length, 3);
  for (const p of map.points) {
    const battle = new Conquest(map.points);
    const blue = { team: 'blue', x: p.x, z: p.z, alive: true };
    const red = { ...blue, team: 'red' };
    battle.step(CAPTURE_TIME / 2, [blue]);
    assert.equal(battle.points.find(pt => pt.id === p.id).progress, .5);
    assert.match(captureMessage(battle.points, 'blue', p.x, p.z), new RegExp(p.id));
    battle.step(CAPTURE_TIME, [blue, red]);
    assert.equal(battle.points.find(pt => pt.id === p.id).progress, .5, 'opposing teams contest the circle');
    const events = battle.step(CAPTURE_TIME / 2, [blue]);
    assert.deepEqual(events, [{ id: p.id, owner: 'blue' }]);
    assert.ok(battle.tickets[1] < battle.tickets[0], 'holding a coast point drains enemy tickets');
  }
});

test('the authored coast point sidecar matches the data used by client and server', () => {
  const source = JSON.parse(fs.readFileSync(new URL('../../../data/maps/coast/points.json', import.meta.url), 'utf8'));
  assert.deepEqual(def.points, source);
});

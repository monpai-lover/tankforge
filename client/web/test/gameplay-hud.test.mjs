import test from 'node:test';
import { Sound } from '../src/game/audio.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Hud } from '../src/game/hud.js';
const markers = await import('../src/game/gameplayMarkers.js').catch(e => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  return { isGameplayAlly: (e, team) => e.team === team, visibleGameplayMarker: () => true };
});
const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const fn = name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
};
const actors = [
  { id: 'same-spec', netId: 2, remote: true, team: 'red', alive: true },
  { id: 'same-spec', netId: 3, remote: true, team: 'blue', alive: true },
  { id: 'wreck', netId: 4, remote: true, team: 'red', alive: false },
  { id: 'unknown', remote: true, alive: true },
  { id: 'invalid', remote: true, team: 'green', alive: true },
  { id: 'training', rangeTarget: true, alive: true },
].map((e, i) => ({ ...e, x: i * 10, z: 100, heading: 0, name: e.id, player: `player-${i}`, box: { top: 2 }, veh: { body: { origin: () => [0, 0, 0] } } }));
test('historical tags filter enemies, wrecks and training before visibility and projection; validated same-spec ally remains', () => {
  for (const [mode, team, count] of [['historical', 'blue', 1], ['historical', undefined, 0], ['historical', 'green', 0], ['casual', 'blue', 6]]) {
    let projected = 0, visible = 0, tags;
    const G = { gameplayMode: mode, mode: 'battle', online: { team }, mapTick: 0, s: { x: 0, z: 0 }, enemies: structuredClone(actors.map(({ veh, ...e }) => e)).map(e => ({ ...e, veh: actors[0].veh })) };
    const deps = { G, ...markers, hud: { drawNameTags: list => tags = list }, groundRay: () => { visible++; return 1e9; }, surfaceAt() {}, buildingHit: () => null, project: () => { projected++; return [0, 0, 1]; } };
    new Function(...Object.keys(deps), `${fn('drawVehicleTags')}\ndrawVehicleTags([0, 0, 0], [], 1280, 800);`)(...Object.values(deps));
    assert.equal(tags.length, count, `${mode}/${team}`);
    assert.equal(projected, count, 'filtered actors must not reach projection');
    if (mode === 'historical') assert.equal(visible, 0, 'filtered actors never use visibility rays');
    if (count === 1) assert.equal(tags[0].name, actors[1].player, 'player identity is independent of same spec');
  }
});
function canvas(size) {
  const calls = [], ctx = new Proxy({ fillStyle: '', strokeStyle: '' }, { get(o, k) {
    if (k in o) return o[k];
    return (...args) => calls.push({ method: k, args, color: o.fillStyle });
  } });
  return { calls, ctx, map: { clientWidth: size, width: size, height: size } };
}
globalThis.window = { devicePixelRatio: 1 };
for (const size of [188, 320]) for (const name of ['drawMinimap', 'drawBattleMap']) {
  test(`${name} ${size}: historical Canvas hides enemy/wreck/unknown markers, retaining ally, self, range boards and ABC`, () => {
    const c = canvas(size), h = { map: c.map, mapCtx: c.ctx };
    const m = { gameplayMode: 'historical', team: 'blue', x: 0, z: 0, hull: 0, gun: 0, view: 0,
      zones: [], humps: [], targets: [{ x: 20, z: 120, hits: 0 }], others: actors, enemies: actors,
      image: {}, map: { x0: -500, z0: -500, size: 1000, grid: { cols: 1, rows: 1, col_labels: [], row_labels: [] } },
      spawns: { blue: [], red: [] }, points: ['A', 'B', 'C'].map((id, i) => ({ id, x: i * 100, z: 100, r: 30 })) };
    Hud.prototype[name].call(h, m);
    assert.equal(c.calls.filter(e => e.method === 'arc' && e.color === '#e8463a').length, 0);
    assert.equal(c.calls.filter(e => e.method === 'arc' && e.color === '#555').length, 0);
    assert.equal(c.calls.filter(e => e.method === 'arc' && e.color === '#4f8cff').length, 1);
    assert.ok(c.calls.some(e => e.method === 'fill' && ['#ffd34a', '#e2b34a'].includes(e.color)), 'self');
    if (name === 'drawMinimap') assert.ok(c.calls.some(e => e.method === 'fill' && e.color === '#e2664a'), 'fixed range board');
    else assert.deepEqual(c.calls.filter(e => e.method === 'fillText' && ['A', 'B', 'C'].includes(e.args[0])).map(e => e.args[0]), ['A', 'B', 'C']);
    c.calls.length = 0;
    Hud.prototype[name].call(h, { ...m, others: [], enemies: [] });
    assert.ok(c.calls.some(e => e.method === 'fillRect'), 'empty actor list still repaints the map');
    assert.equal(c.calls.filter(e => e.method === 'arc' && e.color === '#4f8cff').length, 0);
  });
}
test('mode transition clears cached enemy map and name markers immediately', () => {
  const c = canvas(188), overlay = canvas(1280), h = { map: c.map, mapCtx: c.ctx, ctx: overlay.ctx, overlay: { width: 1280, height: 800 }, hideHitMarker() {}, drawNameTags(tags) { assert.deepEqual(tags, []); } };
  h.resetGameplayMarkers = Hud.prototype.resetGameplayMarkers ?? (() => {});
  const G = { mapTick: 2, enemies: [{ seen: true }], ranging: {} };
  const deps = { G, hud: h, document: { body: { dataset: {} } }, sound: new Sound() };
  new Function(...Object.keys(deps), `${fn('setMode')}\nsetMode('battle');`)(...Object.values(deps));
  assert.equal(G.mapTick, 0);
  assert.equal(G.enemies[0].seen, null);
  assert.ok(c.calls.some(e => e.method === 'clearRect'), 'cached map must be cleared before next frame');
  assert.ok(overlay.calls.some(e => e.method === 'clearRect'), 'old Canvas name tags must be cleared immediately');
});

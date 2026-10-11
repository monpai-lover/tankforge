import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMEPLAY_RULES_VERSION } from '../src/game/gameplayRules.js';
const api = await import('../src/game/gameplaySession.js').catch(e => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  return {};
});
// A behavior-only stock stand-in allows the missing feature to fail its requirements in RED.
const GameplaySession = api.GameplaySession ?? class {
  chooseLocal() { return true; } beginBattle() {} endBattle() {} activeMode() { return 'historical'; }
};
function storage() {
  const values = new Map();
  return { values, get: k => values.get(k) ?? null, set: (k, v) => values.set(k, v) };
}
test('new local preference is casual, strict room profile locks battle, leaving restores local', () => {
  const s = new GameplaySession(storage());
  assert.equal(s.activeMode(), 'casual');
  s.beginBattle({ mode: 'historical', version: GAMEPLAY_RULES_VERSION });
  assert.equal(s.activeMode(), 'historical');
  assert.equal(s.chooseLocal('casual'), false);
  assert.equal(s.chooseLocal('historical'), false);
  s.endBattle();
  assert.equal(s.activeMode(), 'casual');
  assert.equal(s.chooseLocal('historical'), true);
  s.beginBattle();
  assert.equal(s.chooseLocal('casual'), false);
  assert.equal(s.activeMode(), 'historical');
});
test('preference persists, malformed saved values and unavailable storage recover to casual', () => {
  const st = storage(), s = new GameplaySession(st);
  s.chooseLocal('historical');
  assert.equal(new GameplaySession(st).activeMode(), 'historical');
  assert.ok(st.values.has('tankforge.gameplay.v1'));
  for (const value of ['bogus', '{', JSON.stringify({ mode: 'bogus' }), JSON.stringify({ mode: 'historical', version: 99 })]) {
    st.values.set('tankforge.gameplay.v1', value);
    assert.equal(new GameplaySession(st).activeMode(), 'casual');
  }
  const bad = new GameplaySession({ get() { throw Error(); }, set() { throw Error(); } });
  assert.equal(bad.chooseLocal('historical'), true);
  assert.equal(bad.activeMode(), 'historical');
});
test('invalid local/room modes and versions reject without locking or overwriting preference', () => {
  const s = new GameplaySession(storage());
  for (const mode of [null, undefined, 'bogus', 'Casual', 0]) assert.throws(() => s.chooseLocal(mode), /mode/i);
  for (const room of [{ mode: 'casual' }, { mode: 'historical', version: '1' }, { mode: 'historical', version: 0 }, { mode: 'bogus', version: 1 }, {}, [], 'casual']) {
    assert.throws(() => s.beginBattle(room), /profile|mode|version/i);
    assert.equal(s.activeMode(), 'casual');
    assert.equal(s.chooseLocal('casual'), true, 'invalid profile cannot leave lock behind');
  }
  s.beginBattle();
  assert.throws(() => s.beginBattle({ mode: 'historical', version: 1 }), /locked/i);
});

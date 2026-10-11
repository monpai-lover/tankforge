import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// An absent implementation is an assertion failure, so the first RED run still exercises
// the full rule contract instead of stopping at module resolution.
const api = await import('../src/game/gameplayRules.js').catch(e => {
  if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  return {};
});
const expected = {
  casual: { speed: 1.15, drive: 1.25, steer: 1.25, traverse: 1.30, elevate: 1.20, fire: 1.20, show_enemy_markers: true },
  historical: { speed: 1, drive: 1, steer: 1, traverse: 1, elevate: 1, fire: 1, show_enemy_markers: false },
};

test('one versioned JSON supplies exactly the two gameplay rules', () => {
  assert.equal(typeof api.gameplayRules, 'function');
  const config = JSON.parse(fs.readFileSync(new URL('../../../config/gameplay-modes.json', import.meta.url), 'utf8'));
  assert.equal(api.GAMEPLAY_RULES_VERSION, 1);
  assert.deepEqual(config, { version: 1, modes: expected });
  for (const mode of Object.keys(expected)) assert.deepEqual(api.gameplayRules(mode), expected[mode]);
});

test('rules are cached and immutable', () => {
  assert.equal(typeof api.gameplayRules, 'function');
  for (const mode of Object.keys(expected)) {
    const rules = api.gameplayRules(mode);
    assert.equal(rules, api.gameplayRules(mode));
    assert.ok(Object.isFrozen(rules));
    assert.throws(() => { rules.fire = 99; }, TypeError);
  }
});

test('invalid mode IDs cannot become a historical or casual room', () => {
  assert.equal(typeof api.isGameplayMode, 'function');
  for (const mode of Object.keys(expected)) assert.equal(api.isGameplayMode(mode), true);
  for (const mode of [undefined, null, '', 'CASUAL', 'historical ', 'garage', 1, {}, ['casual'], '__proto__', 'constructor']) {
    assert.equal(api.isGameplayMode(mode), false);
    assert.throws(() => api.gameplayRules(mode), /gameplay mode/i);
  }
});

test('room rules require an exact numeric version; explicit missing values are rejected', () => {
  assert.equal(typeof api.gameplayRules, 'function');
  assert.deepEqual(api.gameplayRules('casual', 1), expected.casual);
  for (const version of [undefined, null, '1', 0, 2, 1.1, NaN, Infinity, true, {}]) {
    assert.throws(() => api.gameplayRules('casual', version), /version/i);
  }
});

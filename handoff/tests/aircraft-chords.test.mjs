import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const s = fs.readFileSync(new URL('../bundle/app.js.html', import.meta.url), 'utf8');
const begin = s.indexOf('    const AIR_ACTIONS = ['), end = s.indexOf('    /** Weapon and sensor input is taken', begin);
assert.ok(begin > 0 && end > begin);
const calls = [], ups = [], G4 = {};
let open = true;
const c = vm.createContext({ G4, localStorage: { getItem: () => '{"fire":"Mouse1"}' },
  airInputOpen: () => open, airAction: (a, t) => calls.push([a, t]), airActionUp: a => ups.push(a) });
vm.runInContext(s.slice(begin, end) + 'globalThis.api={airKeyDown,airKeyUp,resetAirActionKeys,actionFor,AIR_KEY_DEFAULTS,comboOf};', c);
const api = c.api;
const ev = (code, extra = {}) => ({ code, timeStamp: 100, repeat: false, shiftKey: false, altKey: false, ctrlKey: false, ...extra });
function reset() { api.resetAirActionKeys(); G4.air = { active: true }; G4.airKeys = { ...api.AIR_KEY_DEFAULTS }; calls.length = ups.length = 0; open = true; }
test('Space+R is a rebindable default and existing saved bindings survive', () => {
  assert.equal(api.actionFor('Space+KeyR'), 'radarDogfight'); assert.equal(api.actionFor('Mouse1'), 'fire');
});
test('both chord release orders toggle exactly once without a Space weapon action or ordinary R lock', () => {
  for (const order of [['KeyR', 'Space'], ['Space', 'KeyR']]) {
    reset(); api.airKeyDown(ev('Space')); assert.equal(calls.length, 0);
    api.airKeyDown(ev('KeyR')); api.airKeyDown(ev('KeyR', { repeat: true }));
    api.airKeyDown(ev('Space', { repeat: true }));
    order.forEach(k => api.airKeyUp(ev(k)));
    assert.deepEqual(calls.map(c => c[0]), ['radarDogfight']); assert.ok(!ups.includes('space'));
  }
});
test('throttle modifiers do not hide Space+R or cause a delayed weapon action', () => {
  for (const modifier of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }]) {
    reset(); api.airKeyDown(ev('Space', modifier)); api.airKeyDown(ev('KeyR', modifier));
    api.airKeyUp(ev('Space')); assert.deepEqual(calls.map(c => c[0]), ['radarDogfight']);
  }
});
test('a single Space acts once on release; R and Shift+R retain their own actions', () => {
  reset(); api.airKeyDown(ev('Space')); api.airKeyDown(ev('Space', { repeat: true })); assert.equal(calls.length, 0);
  api.airKeyUp(ev('Space')); assert.deepEqual(calls.map(c => c[0]), ['space']); assert.deepEqual(ups, ['space']);
  reset(); api.airKeyDown(ev('KeyR')); api.airKeyUp(ev('KeyR')); api.airKeyDown(ev('KeyR', { shiftKey: true }));
  assert.deepEqual(calls.map(c => c[0]), ['radarLock', 'radarMode']);
});
test('focus/menu cancellation, changing aircraft and closed input cannot leave a future weapon action queued', () => {
  for (const cancel of [() => api.resetAirActionKeys(), () => { G4.air = { active: true }; }, () => { open = false; }]) {
    reset(); api.airKeyDown(ev('Space')); cancel(); api.airKeyUp(ev('Space')); assert.equal(calls.length, 0);
  }
  reset(); api.airKeyDown(ev('Space', { repeat: true })); api.airKeyUp(ev('Space')); assert.equal(calls.length, 0);
});
test('custom Space chords consume the prefix, and unbinding every Space chord restores held Space controls', () => {
  reset(); G4.airKeys.radarDogfight = 'Space+KeyF';
  api.airKeyDown(ev('Space')); api.airKeyDown(ev('KeyF')); api.airKeyUp(ev('Space'));
  assert.deepEqual(calls.map(c => c[0]), ['radarDogfight']);
  reset(); G4.airKeys.radarDogfight = 'KeyB'; api.airKeyDown(ev('Space'));
  assert.deepEqual(calls.map(c => c[0]), ['space']); api.airKeyUp(ev('Space')); assert.deepEqual(ups, ['space']);
});

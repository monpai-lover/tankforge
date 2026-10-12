import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as loading from '../src/sim/loading.js';
import { makeLoadout, nextAmmo, syncGunShell } from '../src/game/loadout.js';
import { Sound, SFX_SLOTS } from '../src/game/audio.js';

const runtime = await import('../src/game/audioReload.js').catch(() => null);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = p => JSON.parse(fs.readFileSync(root + p, 'utf8'));
const projectiles = Object.fromEntries(fs.readdirSync(root + 'data/projectiles').filter(f => f.endsWith('.json')).map(f => {
  const s = read('data/projectiles/' + f); return [s.id, s];
}));
function stock(id = 'de_tiger_e') {
  const base = 'data/vehicles/' + id + '/';
  const bundle = Object.fromEntries(['vehicle', 'weapons', 'engine', 'visual'].map(k => [k, read(base + k + '.json')]));
  return makeLoadout(id, bundle, projectiles);
}
function rig({ maxOwners = 8 } = {}) {
  assert.ok(runtime?.ReloadAudio, 'production ReloadAudio owner is required');
  const events = [], stopped = [];
  const audio = new runtime.ReloadAudio((cue, owner) => {
    events.push({ cue, owner }); return { stop: () => stopped.push(cue) };
  }, { maxOwners });
  const guns = stock().turrets[0].guns;
  const L = loading.newLoading(guns.length, 1);
  return { audio, events, stopped, guns, L };
}
function step(r, dt, total = 7.5, rate = 1) {
  const done = loading.tick(r.L, dt, () => total, gi => {
    runtime.observeReloadWork(r.audio, r.guns[gi], r.L, gi, rate);
    return rate;
  });
  for (const gi of done) {
    const g = r.guns[gi]; g.loaded = nextAmmo(g);
    if (g.loaded < 0) r.L.state[gi] = 'empty';
    syncGunShell(g);
    runtime.observeReloadReady(r.audio, g, r.L, gi);
  }
  return done;
}
const phases = r => r.events.map(e => e.cue.split('_').at(-1));
const mainSource = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');

test('bindings use actual installed weapon and whitelisted ammunition, independent of host country', () => {
  assert.ok(runtime?.reloadProfile, 'production binding resolver is required');
  for (const [id, style] of [['de_tiger_e', 'de'], ['su_t34_85', 'su'], ['us_m4a2', 'us'], ['us_m4a3_75w', 'us']]) {
    const g = stock(id).turrets[0].guns[0];
    for (const a of g.ammo) assert.equal(runtime.reloadProfile(g.def, a.shell)?.style, style);
    assert.equal(runtime.reloadProfile({ ...g.def, missile: 'tow' }, g.shell), null);
    assert.equal(runtime.reloadProfile({ ...g.def, autocannon: {} }, g.shell), null);
    assert.equal(runtime.reloadProfile(g.def, { ...g.shell, id: 'unknown_round' }), null);
    assert.equal(runtime.reloadProfile({ ...g.def, id: 'designed_88' }, g.shell), null);
    assert.equal(runtime.reloadProfile(g.def, { ...g.shell, caliber_mm: 122 }), null);
  }
});

test('real shared-loader queue keeps waiting guns silent and starts grab only after assignment', () => {
  const r = rig(); r.guns.push(stock().turrets[0].guns[0]); r.L = loading.newLoading(2, 1);
  loading.fired(r.L, 0); loading.fired(r.L, 1);
  step(r, .1, 5);
  assert.deepEqual(phases(r), ['grab']);
  assert.equal(r.events[0].owner, r.guns[0]);
  assert.equal(r.L.state[1], 'waiting');
  step(r, 5, 5);
  assert.equal(r.L.state[1], 'loading');
  assert.equal(r.events.filter(e => e.cue.endsWith('grab')).length, 2);
});

test('load milestone follows real assigned work rather than wall-clock duration', () => {
  const r = rig(); loading.fired(r.L, 0);
  step(r, .1, 72); step(r, 36, 72); step(r, .01, 72);
  assert.deepEqual(phases(r), ['grab', 'load']);
  for (let i = 0; i < 3; i++) step(r, 1000, 72, 0);
  assert.deepEqual(phases(r), ['grab', 'load']);
  step(r, 1, 72, 100);
  assert.deepEqual(phases(r), ['grab', 'load', 'lock']);
});

test('historical/casual and more than 132 seconds reuse one set without repeating insertion', () => {
  for (const duration of [7.5, 6.25, 52.8, 72, 132.315]) {
    const r = rig(); loading.fired(r.L, 0);
    for (let i = 0; i < 8; i++) step(r, duration / 8, duration);
    assert.deepEqual(phases(r), ['grab', 'load', 'lock']);
  }
});

test('zero-rate assignment is silent; a stall stops handling and resume never repeats grab', () => {
  const r = rig(); loading.fired(r.L, 0); step(r, 20, 8, 0);
  assert.deepEqual(phases(r), []);
  step(r, .1, 8); assert.deepEqual(phases(r), ['grab']);
  step(r, 100, 8, 0); assert.deepEqual(r.stopped, ['de_manual_grab']);
  step(r, 4, 8); step(r, .01, 8);
  assert.deepEqual(phases(r), ['grab', 'load']);
});

test('completion converted to empty never emits lock', () => {
  const r = rig(); loading.fired(r.L, 0); step(r, .1, 5);
  for (const a of r.guns[0].ammo) a.count = 0;
  step(r, 5, 5);
  assert.equal(r.L.state[0], 'empty');
  assert.equal(phases(r).includes('lock'), false);
});

test('initial ready state and completion without a loaded positive-count round stay silent', () => {
  const r = rig(); assert.equal(runtime.observeReloadReady(r.audio, r.guns[0], r.L, 0), false);
  loading.fired(r.L, 0); step(r, .1, 5);
  r.L.state[0] = 'ready'; r.guns[0].loaded = -1;
  assert.equal(runtime.observeReloadReady(r.audio, r.guns[0], r.L, 0), false);
  assert.equal(phases(r).includes('lock'), false);
});

test('ready is owned once and cancellation stops its retained lock source', () => {
  const r = rig(); loading.fired(r.L, 0); step(r, .1, 5); step(r, 5, 5);
  assert.equal(runtime.observeReloadReady(r.audio, r.guns[0], r.L, 0), true);
  assert.equal(phases(r).filter(p => p === 'lock').length, 1);
  r.audio.cancelAll(); assert.ok(r.stopped.includes('de_manual_lock'));
  assert.equal(r.audio.size, 0);
});

test('round replacement cancels old handling, while changed rate preserves the same job', () => {
  const r = rig(); loading.fired(r.L, 0); step(r, .1, 5);
  step(r, .1, 5, .25); assert.equal(phases(r).filter(p => p === 'grab').length, 1);
  r.guns[0].selected = 1; step(r, .1, 5);
  assert.ok(r.stopped.includes('de_manual_grab'));
  assert.equal(phases(r).filter(p => p === 'grab').length, 2);
});

test('rejected prediction blocks the canceled cycle until a new actual reload begins', () => {
  const r = rig(); loading.fired(r.L, 0); step(r, .1, 5);
  r.audio.cancel(r.guns[0], { blockCycle: true });
  step(r, .1, 5); step(r, 5, 5);
  assert.deepEqual(phases(r), ['grab']);
  loading.fired(r.L, 0); step(r, .1, 5);
  assert.deepEqual(phases(r), ['grab', 'grab']);
});

test('prediction rejection before assignment also blocks that cycle', () => {
  const r = rig(); loading.fired(r.L, 0);
  r.audio.cancel(r.guns[0], { blockCycle: true, cycle: r.L.waitedSince[0] });
  step(r, .1, 5); step(r, 5, 5);
  assert.deepEqual(phases(r), []);
});

test('a delayed rejection for an older cycle preserves newer loading and its lock', () => {
  const r = rig(); loading.fired(r.L, 0); const rejectedCycle = r.L.waitedSince[0]; step(r, .1, 5); step(r, 5, 5);
  loading.fired(r.L, 0); step(r, .1, 5);
  const stoppedBefore = r.stopped.length;
  r.audio.cancel(r.guns[0], { blockCycle: true, cycle: rejectedCycle });
  assert.equal(r.stopped.length, stoppedBefore);
  step(r, 5, 5);
  assert.deepEqual(phases(r), ['grab', 'lock', 'grab', 'lock']);
});

test('an older delayed rejection cannot unblock a newer already-rejected cycle', () => {
  const r = rig(); loading.fired(r.L, 0); const older = r.L.waitedSince[0]; step(r, .1, 5); step(r, 5, 5);
  loading.fired(r.L, 0); const newer = r.L.waitedSince[0]; step(r, .1, 5);
  r.audio.cancel(r.guns[0], { blockCycle: true, cycle: newer });
  r.audio.cancel(r.guns[0], { blockCycle: true, cycle: older });
  step(r, .1, 5); step(r, 5, 5);
  assert.deepEqual(phases(r), ['grab', 'lock', 'grab']);
});

test('actual fire and manual unload call sites stop the old lock even while the gun waits behind another loader job', () => {
  for (const action of ['fire', 'unload']) {
    const r = rig(); r.guns.push(stock().turrets[0].guns[0]); r.L = loading.newLoading(2, 1);
    loading.fired(r.L, 0); loading.fired(r.L, 1); step(r, .1, 5); step(r, 5, 5);
    assert.equal(r.L.state[1], 'loading');
    const sound = new Sound(); sound.reloadAudio = r.audio;
    const G = { shots: [], sightG: 0 }, rt = { loading: r.L }, g = r.guns[0];
    const begin = action === 'fire' ? mainSource.indexOf('    G.shots.push(shot);', mainSource.indexOf('  function fireGun(')) : mainSource.indexOf('      // Total aboard already includes');
    const end = action === 'fire' ? mainSource.indexOf('    const gy =', begin) : mainSource.indexOf('      hud.toast', begin);
    assert.ok(begin >= 0 && end > begin);
    new Function('G', 'shot', 'sound', 'g', 'loading', 'rt', 'gi', mainSource.slice(begin, end))(G, {}, sound, g, loading, rt, 0);
    assert.deepEqual(r.L.state, ['waiting', 'loading']);
    assert.ok(r.stopped.includes('de_manual_lock'), `${action} must stop the completed owner's lock while queued`);
  }
});

test('suspending stops current voices without repeating completed stages on resume', () => {
  const r = rig(); loading.fired(r.L, 0); step(r, .1, 5);
  r.audio.suspend(); step(r, .1, 5);
  assert.deepEqual(phases(r), ['grab']); assert.deepEqual(r.stopped, ['de_manual_grab']);
});

test('loading owner admission is bounded and unknown mechanisms remain unbound', () => {
  const r = rig({ maxOwners: 1 }); loading.fired(r.L, 0); step(r, .1, 5);
  const other = stock('su_t34_85').turrets[0].guns[0], L = loading.newLoading(1, 1);
  loading.fired(L, 0); loading.tick(L, .1, () => 8, gi => { runtime.observeReloadWork(r.audio, other, L, gi, 1); return 1; });
  assert.equal(r.audio.size, 1); assert.deepEqual(phases(r), ['grab']);
  const separate = { ...other, def: { ...other.def, id: 'd25t_122' } };
  assert.equal(runtime.observeReloadWork(r.audio, separate, L, 0, 1), false);
});

function fakeAudio() {
  const sources = [], gains = [];
  const ctx = { currentTime: 2, createBufferSource() {
    const s = { playbackRate: { value: 1 }, connect() {}, disconnect() { this.disconnected = true; }, start() { this.started = true; }, stop() { this.stopped = true; this.onended?.(); } };
    sources.push(s); return s;
  }, createGain() { const g = { gain: { value: 0 }, connect() {}, disconnect() { this.disconnected = true; } }; gains.push(g); return g; },
  createOscillator() { throw new Error('new loading bank must not synthesize a fallback'); } };
  return { ctx, sources, gains };
}
test('Sound keeps legacy slots and requires reviewed exports, without synthetic new-bank fallback', () => {
  assert.equal(SFX_SLOTS.length, 11);
  const s = new Sound(); assert.equal(typeof s.loadReloadBank, 'function', 'Sound loading facade is required');
  assert.equal(s.loadReloadBank({ schemaVersion: 1, reviewState: 'candidate', cues: {} }), false);
  const f = fakeAudio(); s.ctx = f.ctx; s.master = {};
  assert.equal(s.loadReloadBank({ schemaVersion: 1, reviewState: 'reviewed', cues: {} }), true);
  const r = rig(); loading.fired(r.L, 0);
  loading.tick(r.L, .1, () => 5, gi => { s.reloadWork(r.guns[gi], r.L, gi, 1); return 1; });
  assert.equal(f.sources.length, 0);
});

test('Sound plays fixed-pitch owned stages and disconnects nodes on cancellation and ended', () => {
  const s = new Sound(); assert.equal(typeof s.loadReloadBank, 'function', 'Sound loading facade is required');
  const f = fakeAudio(); s.ctx = f.ctx; s.master = {};
  s.loadReloadBank({ schemaVersion: 1, reviewState: 'reviewed', cues: {} });
  s.reloadSamples.de_manual_grab = { duration: .88 };
  const r = rig(); loading.fired(r.L, 0);
  loading.tick(r.L, .1, () => 5, gi => { s.reloadWork(r.guns[gi], r.L, gi, 1); return 1; });
  assert.equal(f.sources.length, 1); assert.equal(f.sources[0].playbackRate.value, 1); assert.equal(f.sources[0].loop, false);
  s.cancelReloads(); assert.equal(f.sources[0].stopped, true); assert.equal(f.sources[0].disconnected, true); assert.equal(f.gains[0].disconnected, true);
});

test('inaudible loading consumes milestones without playing catch-up stages after visibility resumes', () => {
  const s = new Sound(); assert.equal(typeof s.setReloadAudible, 'function', 'audibility owner is required');
  const f = fakeAudio(); s.ctx = f.ctx; s.master = {};
  s.loadReloadBank({ schemaVersion: 1, reviewState: 'reviewed', cues: {} });
  for (const phase of ['grab', 'load', 'lock']) s.reloadSamples[`de_manual_${phase}`] = { duration: 1 };
  s.setReloadAudible(false);
  const r = rig(); loading.fired(r.L, 0);
  const run = dt => {
    const done = loading.tick(r.L, dt, () => 5, gi => { s.reloadWork(r.guns[gi], r.L, gi, 1); return 1; });
    for (const gi of done) s.reloadReady(r.guns[gi], r.L, gi);
  };
  run(.1); run(3); run(.01); assert.equal(f.sources.length, 0);
  s.setReloadAudible(true); run(.01); assert.equal(f.sources.length, 0);
  run(2); assert.equal(f.sources.length, 1); assert.equal(f.sources[0].buffer, s.reloadSamples.de_manual_lock);
  f.sources[0].onended(); assert.equal(s.reloadVoices.size, 0); assert.equal(f.gains[0].disconnected, true);
});

test('Sound decodes only active compatible styles with at most two simultaneous decodes', async () => {
  const s = new Sound(); assert.equal(typeof s.prepareReloadBank, 'function', 'active-profile decode owner is required');
  const oldFetch = globalThis.fetch;
  let concurrent = 0, peak = 0, count = 0;
  const cues = Object.fromEntries(['de', 'su', 'us'].flatMap(style => ['grab', 'load', 'lock'].map(phase => [`${style}_manual_${phase}`, { url: `data:audio/wav;base64,${style}` }])));
  s.loadReloadBank({ schemaVersion: 1, reviewState: 'reviewed', cues });
  globalThis.fetch = async () => ({ arrayBuffer: async () => new ArrayBuffer(2) });
  s.ctx = { decodeAudioData: async () => {
    concurrent++; peak = Math.max(peak, concurrent); count++;
    await new Promise(resolve => setImmediate(resolve)); concurrent--;
    return { length: 100, numberOfChannels: 1 };
  } };
  try {
    s.prepareReloadBank(stock());
    while (s.reloadDecodeRunning) await new Promise(resolve => setImmediate(resolve));
    assert.equal(count, 3); assert.equal(peak, 2);
    assert.deepEqual(Object.keys(s.reloadSamples).sort(), ['de_manual_grab', 'de_manual_load', 'de_manual_lock']);
    s.prepareReloadBank(stock()); assert.equal(count, 3);
  } finally { globalThis.fetch = oldFetch; }
});

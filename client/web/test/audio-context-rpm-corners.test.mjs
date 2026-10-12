import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Sound } from '../src/game/audio.js';

// Keep authored bindings/levels/selection metadata; only the WebAudio payload is
// replaced, so these tests need neither an HTTP server nor a real audio device.
const dataUrl = 'data:audio/wav;base64,AA==';
const raw = JSON.parse(fs.readFileSync(new URL('../assets/full-audio.json', import.meta.url), 'utf8'));
const bank = { ...raw, cues: Object.fromEntries(Object.entries(raw.cues).map(([id, cue]) => [id, { ...cue, url: dataUrl }])) };
const reloadRaw = JSON.parse(fs.readFileSync(new URL('../assets/reload-audio.json', import.meta.url), 'utf8'));
const reloadBank = { ...reloadRaw, cues: Object.fromEntries(reloadRaw.cues.map(cue => [cue.id, { ...cue, url: dataUrl }])) };

function buffer(id, fill = .1) {
  const samples = new Float32Array(4).fill(fill);
  return { id, length: 4, numberOfChannels: 1, sampleRate: 4, getChannelData: () => samples };
}

function audioContext(id, events) {
  const ctx = { id, currentTime: 10, state: 'running', nodes: [], sources: [], pendingDecodes: [], close() {} };
  const param = () => ({ value: 0, setValueAtTime(v) { this.value = v; }, setTargetAtTime(v) { this.value = v; } });
  const node = kind => {
    const n = { context: ctx, kind, connections: [], disconnected: false,
      connect(target) {
        assert.ok(target && target.context === ctx, 'WebAudio cannot connect nodes from different contexts');
        this.connections.push(target);
        events.push({ kind: 'connect', context: id, source: this, target });
      },
      disconnect() { this.disconnected = true; this.connections.length = 0; events.push({ kind: 'disconnect', context: id, node: this }); } };
    ctx.nodes.push(n);
    return n;
  };
  ctx.createBuffer = (channels, length, sampleRate) => {
    const planes = Array.from({ length: channels }, () => new Float32Array(length));
    return { length, numberOfChannels: channels, sampleRate, getChannelData: i => planes[i] };
  };
  ctx.createBufferSource = () => {
    const source = Object.assign(node('source'), { playbackRate: param(), startAt: null, stopAt: null,
      start(at = ctx.currentTime) {
        this.startAt = at;
        const live = ctx.sources.filter(s => s.loop && s.startAt !== null && s.startAt <= at && (s.stopAt === null || s.stopAt > at));
        events.push({ kind: 'start', context: id, at, source: this, liveSteady: live.length });
      },
      stop(at = ctx.currentTime) {
        this.stopAt = at;
        events.push({ kind: 'stop', context: id, at, source: this });
        if (at <= ctx.currentTime) this.onended?.();
      } });
    ctx.sources.push(source);
    return source;
  };
  ctx.createGain = () => Object.assign(node('gain'), { gain: param() });
  ctx.createPanner = () => Object.assign(node('panner'), Object.fromEntries(['positionX', 'positionY', 'positionZ', 'orientationX', 'orientationY', 'orientationZ'].map(k => [k, param()])));
  ctx.decodeAudioData = () => new Promise(resolve => ctx.pendingDecodes.push(resolve));
  ctx.destination = node('destination');
  return ctx;
}

function fixture() {
  const sound = new Sound(), events = [], first = audioContext('old', events);
  sound.ctx = first;
  sound.master = first.createGain();
  assert.equal(sound.loadFullBank(bank), true);
  assert.equal(sound.loadReloadBank(reloadBank), true);
  const profiles = bank.profiles.filter(p => ['engine_E03', 'track_heavy', 'weapon_oplot_mo_14_5x6', 'weapon_mg34', 'weapon_bgm71a_tow'].includes(p.id) || p.kind === 'surface' || p.kind === 'flight' || p.kind === 'ui');
  for (const cue of new Set(profiles.flatMap(p => Object.values(p.cues)))) {
    sound.full.buffers.set(cue, buffer(cue));
    sound.full.cache.set(cue, { bytes: 16 });
    sound.full.bytes += 16;
    sound.full.pinned.add(cue);
  }
  for (const cue of Object.keys(reloadBank.cues)) {
    sound.reloadSamples[cue] = buffer(cue);
    sound.reloadDecoded.add(cue);
    sound.reloadBytes += 16;
  }
  sound.setListener({ position: [0, 0, 0], time: 1 });
  const vehicle = (overrides = {}) => sound.vehicleState({ emitterId: 'vehicle:1', vehicleId: 'de_tiger_e', running: true,
    rpm: 950, idleRpm: 600, maxRpm: 2000, load: 1, position: [0, 0, 0], velocity: [2, 0, 0], track: [2, 2], speed: 2, surface: 'grass', time: 1, ...overrides });
  const replace = (at = 100) => {
    const next = audioContext('new', events);
    next.currentTime = at;
    sound.ctx = next;
    return next;
  };
  return { sound, first, events, vehicle, replace };
}

test('context replacement retires vehicle nodes before admitting fresh vehicle sources', () => {
  const r = fixture();
  try {
    r.vehicle();
    const oldVoices = [...r.sound.full.voices], oldBuses = [...r.sound.full.buses.values()];
    assert.equal(r.first.sources.filter(s => s.loop).length, 4);
    const next = r.replace();
    r.sound.setListener({ position: [0, 0, 0], time: 1.1 });
    assert.ok(r.first.sources.every(s => s.stopAt !== null), 'all old-context vehicle sources, including engine start, must stop');
    assert.ok(oldVoices.every(v => v.source === null && v.gain === null && v.panner === null), 'retired voices must release node references');
    assert.ok(oldBuses.every(n => n.disconnected), 'old category buses must disconnect before replacement admission');
    assert.equal(r.sound.full.loops.size, 0);
    assert.equal(r.sound.full.rigs.size, 0);
    r.vehicle({ time: 1.1 });
    assert.equal(next.sources.filter(s => s.loop && s.stopAt === null).length, 4);
    assert.ok([...r.sound.full.voices].every(v => v.source.context === next && v.gain.context === next && (!v.panner || v.panner.context === next)));
    assert.ok([...r.sound.full.buses.values()].every(n => n.context === next));
    const firstNewStart = r.events.findIndex(e => e.kind === 'start' && e.context === 'new');
    assert.ok(r.events.every((e, i) => e.kind !== 'stop' || e.context !== 'old' || i < firstNewStart), 'old sources retire before any new source starts');
  } finally { r.sound.dispose(); }
});

test('RPM/load/surface transitions never admit a fifth live vehicle steady source', () => {
  const r = fixture();
  try {
    const transitions = [
      { rpm: 950, load: 1, surface: 'grass' },
      { rpm: 1800, load: 1, surface: 'grass' },
      { rpm: 950, load: 1, surface: 'gravel', velocity: [-2, 0, 0], track: [-2, -2], speed: -2 },
      { rpm: 1800, load: 0, surface: 'road' },
      { rpm: 600, load: 1, surface: 'grass' },
      { rpm: 1800, load: 1, surface: 'gravel' },
      { rpm: 2000, load: 0, surface: 'road', track: [0, 0], speed: 0 },
      { rpm: 950, load: 1, surface: 'grass' },
    ];
    for (const [i, state] of transitions.entries()) {
      r.first.currentTime = 10 + i / 60;
      const begin = r.events.length;
      r.vehicle({ ...state, time: 1 + i / 60 });
      assert.ok(r.sound.full.loops.size <= 4, `transition ${i} final loop count`);
      const keys = [...r.sound.full.loops.keys()];
      assert.ok(keys.filter(key => key.startsWith('engine:vehicle:1:')).length <= 3, `transition ${i} engine allocation`);
      assert.ok(keys.filter(key => key === 'gear:vehicle:1').length <= 1, `transition ${i} composed running-gear allocation`);
      assert.ok(!keys.some(key => key.startsWith('surface:')), 'terrain texture never needs a separate steady source');
      const starts = r.events.slice(begin).filter(e => e.kind === 'start' && e.source.loop);
      assert.ok(starts.every(e => e.liveSteady <= 4), `transition ${i} admitted ${Math.max(0, ...starts.map(e => e.liveSteady))} live steady sources at AudioBufferSource.start`);
    }
    assert.ok(r.first.sources.every(s => s.startAt !== null), 'instrumentation observes actual WebAudio admission');
  } finally { r.sound.dispose(); }
});

function acceptedGun() {
  return { def: { id: 'kwk36_88_l56', caliber_mm: 88, ammo: ['apcbc_88_l56'] }, selected: 0, loaded: -1,
    ammo: [{ count: 1, shell: { id: 'apcbc_88_l56', caliber_mm: 88 } }] };
}

function loadingState() {
  return { state: ['loading'], waitedSince: [1], loaders: [{ gun: 0, remaining: 8, total: 10 }] };
}

function fireRotary(sound, eventId = 1) {
  sound.rotaryState({ weaponId: 'oplot_mo_14_5x6', emitterId: 'player/rotary:1', spin: 1, firing: true, position: [0, 0, 0], time: 1 });
  sound.shot(14.5, { weaponId: 'oplot_mo_14_5x6', emitterId: 'player/rotary:1', eventId, position: [0, 0, 0], time: 1 });
}

test('context retirement stops rotary, one-shot, motor and accepted loading handles as well as vehicle handles', () => {
  const r = fixture(), gun = acceptedGun(), L = loadingState();
  try {
    r.vehicle();
    fireRotary(r.sound);
    r.sound.mg(7.92, { weaponId: 'mg34', emitterId: 'player/mg:1', eventId: 1, position: [0, 0, 0], time: 1 });
    r.sound.launch(0, false, { missileId: 'bgm71a_tow', projectileId: 'missile:1', emitterId: 'launcher:1', position: [0, 0, 0], time: 1 });
    // The accepted job reaches its real first handling phase before fire is
    // confirmed; this waiting admission must not retain the old context.
    assert.equal(r.sound.reloadWork(gun, L, 0, 1), true);
    assert.equal(r.sound.delayedReloads.size, 1);
    assert.ok(r.sound._playReloadCue('de_manual_load'));
    const oldVoices = [...r.sound.full.voices], oldNodes = r.first.nodes.filter(n => n.kind !== 'destination');
    assert.equal(r.sound.full.rotaries.size, 1);
    assert.equal(r.sound.reloadVoices.size, 1);
    const next = r.replace();
    r.sound.setListener({ position: [0, 0, 0], time: 1.1 });
    assert.ok(r.first.sources.every(s => s.stopAt !== null), 'every full-bank or accepted-loading source stops on context replacement');
    assert.ok(oldNodes.every(n => n.disconnected), 'source, gain, panner, category bus and old output handles all disconnect');
    assert.ok(oldVoices.every(v => v.source === null && v.gain === null && v.panner === null));
    assert.equal(r.sound.full.voices.size, 0);
    assert.equal(r.sound.full.loops.size, 0);
    assert.equal(r.sound.full.rigs.size, 0);
    assert.equal(r.sound.full.rotaries.size, 0);
    assert.equal(r.sound.reloadVoices.size, 0);
    assert.equal(r.sound.delayedReloads.size, 0);
    assert.ok([...r.sound.reloadAudio.jobs.values()].every(job => job.voices.length === 0));
    assert.ok(Math.abs(r.sound.full.clock - (next.currentTime - 1.1)) < 1e-9, 'the scheduling clock rebases to the replacement context');
    assert.equal(r.sound.reloadWork(gun, L, 0, 1), true);
    assert.equal(next.sources.length, 0, 'a consumed accepted loading phase must not replay after retirement');
    assert.ok(r.sound._playReloadCue('de_manual_load'));
    assert.equal(next.sources.length, 1, 'fresh accepted loading remains admissible on the new context');
    assert.ok(next.nodes.every(n => n.connections.every(target => target.context === next)));
  } finally { r.sound.dispose(); }
});

for (const [name, admit] of [
  ['vehicleState', r => r.vehicle({ time: 1.1 })],
  ['rotaryState', r => r.sound.rotaryState({ weaponId: 'oplot_mo_14_5x6', emitterId: 'player/rotary:1', spin: 1, firing: true, position: [0, 0, 0], time: 1.1 })],
  ['MG report', r => r.sound.mg(7.92, { weaponId: 'mg34', emitterId: 'player/mg:2', eventId: 2, position: [0, 0, 0], time: 1.1 })],
  ['accepted loading', r => r.sound._playReloadCue('de_manual_load')],
  ['UI cue', r => r.sound.uiCue('ready')],
]) {
  test(`${name} retires an old context before playback without a listener callback`, () => {
    const r = fixture();
    try {
      r.vehicle();
      fireRotary(r.sound);
      const next = r.replace();
      admit(r);
      assert.ok(r.first.sources.every(s => s.stopAt !== null), `${name} must retire every old source before its own admission`);
      assert.ok(r.first.nodes.filter(n => n.kind !== 'destination').every(n => n.disconnected));
      assert.ok(next.sources.length > 0, `${name} must still produce fresh playback`);
      const firstNewStart = r.events.findIndex(e => e.kind === 'start' && e.context === 'new');
      assert.ok(r.events.every((e, i) => e.kind !== 'stop' || e.context !== 'old' || i < firstNewStart));
      assert.ok(next.nodes.every(n => n.connections.every(target => target.context === next)));
      if (name === 'rotaryState') assert.ok(!next.sources.some(s => s.buffer.id === 'rotary_oplot_mo_14_5x6_fire_loop'), 'retired rotary fire cannot restart without a new actual round');
    } finally { r.sound.dispose(); }
  });
}

test('context retirement preserves accepted-fire dedupe, pending confirmation and physical flight history', () => {
  const r = fixture();
  try {
    const fire = { weaponId: 'mg34', emitterId: 'player/mg:1', eventId: 'accepted', position: [0, 0, 0], time: 1 };
    r.sound.mg(7.92, fire);
    r.sound.mg(7.92, { ...fire, accepted: false, eventId: 'predicted', seq: 7 });
    r.sound.launch(0, false, { missileId: 'bgm71a_tow', projectileId: 'missile:1', emitterId: 'launcher:1', position: [0, 0, 0], time: 1 });
    const segment = { id: 'cannon:1', p0: [-10, 0, 1], p1: [10, 0, 1], velocity: [700, 0, 0], caliber: 75, time: 1 };
    r.sound.projectileSegment(segment);
    const cannon = r.sound.full.trackers.get('cannon:1'), missile = r.sound.full.trackers.get('missile:1');
    assert.ok(cannon.crack && cannon.approach && cannon.recede);
    const next = r.replace();
    r.sound.setListener({ position: [0, 0, 0], time: 1.1 });
    assert.equal(r.sound.full.trackers.get('cannon:1'), cannon);
    assert.equal(r.sound.full.trackers.get('missile:1'), missile);
    assert.ok(cannon.crack && cannon.approach && cannon.recede);
    assert.equal(missile.motor, null);
    assert.equal(r.sound.full.motorReservations.size, 0);
    assert.ok(r.sound.full.pending.has(7), 'unconfirmed gameplay events outlive the presentation context');
    r.sound.mg(7.92, fire);
    r.sound.launch(0, false, { missileId: 'bgm71a_tow', projectileId: 'missile:1', emitterId: 'launcher:1', position: [0, 0, 0], time: 1 });
    r.sound.projectileSegment({ ...segment, time: 1.1 });
    assert.equal(next.sources.length, 0, 'old accepted fire/launch and physical pass-by phases stay deduplicated');
    r.sound.confirmFire(7);
    r.sound.confirmFire(7);
    assert.equal(next.sources.length, 1, 'a preserved pending event still confirms exactly once');
    r.sound.mg(7.92, { ...fire, eventId: 'new', position: [0, 0, 343], time: 1.2 });
    assert.ok(Math.abs(next.sources.at(-1).startAt - 101.1) < 1e-9, 'new arrivals use the rebased context clock and actual propagation distance');
  } finally { r.sound.dispose(); }
});

const turn = () => new Promise(setImmediate);
async function until(predicate, message) {
  for (let i = 0; i < 20 && !predicate(); i++) await turn();
  assert.ok(predicate(), message);
}
async function finishDecodes(r, next) {
  r.sound.dispose();
  for (const ctx of [r.first, next].filter(Boolean)) for (const resolve of ctx.pendingDecodes.splice(0)) resolve(buffer('cleanup'));
  await turn();
}

test('a full-bank decode from the retired context cannot enter the live cache or play', async () => {
  const r = fixture(), id = 'report_mg34_single';
  let next;
  try {
    r.sound.full.buffers.delete(id);
    r.sound.full.cache.delete(id);
    r.sound.full.bytes -= 16;
    r.sound.mg(7.92, { weaponId: 'mg34', emitterId: 'player/mg:1', eventId: 1, position: [0, 0, 0], time: 1 });
    await until(() => r.first.pendingDecodes.length === 1, 'the old context must have an in-flight real decode request');
    next = r.replace();
    r.sound.setListener({ position: [0, 0, 0], time: 1.1 });
    r.first.pendingDecodes.shift()({ ...buffer(id), decodedBy: r.first });
    await turn();
    assert.notEqual(r.sound.full.buffers.get(id)?.decodedBy, r.first, 'late old-context decode cannot be admitted');
    assert.equal(next.sources.length, 0, 'finishing old decode never replays the consumed report');
    r.sound.mg(7.92, { weaponId: 'mg34', emitterId: 'player/mg:1', eventId: 2, position: [0, 0, 0], time: 1.1 });
    await until(() => next.pendingDecodes.length === 1, 'the requested cue can decode again on the live context');
    next.pendingDecodes.shift()({ ...buffer(id), decodedBy: next });
    await until(() => r.sound.full.buffers.get(id)?.decodedBy === next, 'only the live-context result is admitted');
    r.sound.mg(7.92, { weaponId: 'mg34', emitterId: 'player/mg:1', eventId: 3, position: [0, 0, 0], time: 1.1 });
    assert.equal(next.sources.length, 1);
    assert.equal(next.sources[0].buffer.decodedBy, next);
  } finally { await finishDecodes(r, next); }
});

test('an accepted loading decode from the retired context cannot enter the live cache or play', async () => {
  const r = fixture(), id = 'de_manual_load';
  let next;
  try {
    delete r.sound.reloadSamples[id];
    r.sound.reloadDecoded.delete(id);
    r.sound.reloadBytes -= 16;
    r.sound.reloadWanted.add(id);
    void r.sound._decodeReloadPending();
    await until(() => r.first.pendingDecodes.length === 1, 'accepted loading must have an in-flight old-context decode');
    next = r.replace();
    r.sound.setListener({ position: [0, 0, 0], time: 1.1 });
    r.first.pendingDecodes.shift()({ ...buffer(id), decodedBy: r.first });
    await turn();
    assert.notEqual(r.sound.reloadSamples[id]?.decodedBy, r.first, 'late accepted loading decode cannot cross contexts');
    assert.equal(r.sound._playReloadCue(id), null, 'missing live-context loading remains silent');
    await until(() => next.pendingDecodes.length === 1, 'accepted loading can retry its stale request on the live context');
    next.pendingDecodes.shift()({ ...buffer(id), decodedBy: next });
    await until(() => r.sound.reloadSamples[id]?.decodedBy === next, 'live accepted loading result is admitted');
    assert.ok(r.sound._playReloadCue(id));
    assert.equal(next.sources.length, 1);
    assert.equal(next.sources[0].buffer.decodedBy, next);
  } finally { await finishDecodes(r, next); }
});

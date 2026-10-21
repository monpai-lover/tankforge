// Run against the actual bundled modules, not the older client/web/src copies.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const bundle = fs.readFileSync(new URL('../bundle/app.js.html', import.meta.url), 'utf8');
const moduleSource = (name, source = bundle) => {
  const marker = `  // client/web/src/game/${name}.js\n`, start = source.indexOf(marker);
  assert.ok(start >= 0, `bundled module ${name} exists`);
  return source.slice(start + marker.length, source.indexOf('\n  // client/web/', start + marker.length));
};
const { validateReplayEvidence, frozenReplayValues } = Function('structuredClone', `${moduleSource('replayEvidence')}\nreturn { validateReplayEvidence, frozenReplayValues };`)(structuredClone);
function frameFreezer(values = frozenReplayValues, observe = () => {}, source = bundle) {
  const countedObject = Object.create(Object);
  countedObject.values = value => { observe(value); return Object.values(value); };
  const module = moduleSource('replaySession', source);
  return Function('frozenReplayValues', 'Object', `${module.slice(0, module.indexOf('  var visibleEnd'))}\nreturn freeze2;`)(values, countedObject);
}
const { Enemy, combatHit } = Function('captureImpactPose', 'rememberImpactPose', `${moduleSource('enemies')}\nreturn { Enemy, combatHit };`)(() => ({}), () => {});
const { HitCam } = Function(`${moduleSource('hitcam')}\nreturn { HitCam };`)();
const { SuppliedReplayPresentation } = Function(`${moduleSource('suppliedReplayDraw')}\nreturn { SuppliedReplayPresentation };`)();
const vendorMarker = '  // client/web/src/vendor/suppliedHitReplayV3.js\n';
const vendorStart = bundle.indexOf(vendorMarker) + vendorMarker.length;
const { Renderer2 } = Function(`${bundle.slice(vendorStart, bundle.indexOf('\n  // client/web/', vendorStart))}\nreturn { Renderer2 };`)();
function evidence() {
  return {
    revision: 1, authority: 'offline', actor: { battle: 1, entity: 2, life: 3 }, shooter: { battle: 1, entity: 1, life: 1 },
    event_id: 'hit:1', shot_id: 'shot:1', weapon_instance: 'air:m61', projectile_id: '20mm_he', seed: '123',
    commit_seq: 1, state_before_version: 0, state_after_version: 1, pose_revision: 1, geometry_revision: 0,
    build_hash: 'test-build', anatomy_hash: 'test-anatomy', parent_mechanism_id: null,
    coordinates: 'target_hull_metres', launch_time_s: 0, impact_time_s: .5,
    accepted_pose: { trust: 'accepted', hull_origin: [0, 0, 0], ex: [1, 0, 0], ey: [0, 1, 0], ez: [0, 0, 1], joints: [], running_gear: [], payload: [], variants: [] },
    state_before: { destroyed: false }, report: { state: { destroyed: false }, caps: { track_left: true, track_right: true }, impact: [0, 1, 0], fragments: [] },
    flight: [], segments: [], flight_trust: 'unknown_cannon_flight', deaths: [], mechanism_records: [], mechanism_compaction: null, capabilities: []
  };
}
test('consecutive authoritative capability updates do not rebuild unchanged geometry', () => {
  let poses = 0;
  const accepted = [], enemy = Object.create(Enemy.prototype);
  enemy.model = {}; enemy.x = 0;
  enemy.veh = { setDamageCaps: caps => accepted.push(caps) };
  enemy.pose = () => poses++;
  for (let hit = 0; hit < 250; hit++) enemy.caps = { track_left: true, track_right: true, engine_mult: 1 - hit / 500 };
  assert.equal(accepted.length, 250, 'every core capability result reaches mechanics');
  assert.equal(enemy.caps, accepted.at(-1));
  assert.equal(poses, 0, 'no geometry changed during the burst');
  enemy.caps = { track_left: false, track_right: true };
  assert.equal(poses, 1, 'a new track break is visible immediately');
  enemy.caps = { track_left: false, track_right: true, engine_mult: .1 };
  assert.equal(poses, 1, 'further damage cannot rebuild the same broken belt');
  enemy.caps = { track_left: true, track_right: true };
  assert.equal(poses, 2, 'repair immediately restores geometry');
  enemy.caps = { track_left: true, track_right: false };
  assert.equal(poses, 3, 'the opposite side owns a distinct transition');
  enemy.caps = null;
  assert.equal(poses, 4, 'clearing damage restores the belt');
});
test('canonical evidence is immutable and reused across presentation consumers', () => {
  const raw = evidence(), first = validateReplayEvidence(raw, raw.actor);
  assert.equal(first.ok, true);
  assert.notEqual(first.evidence, raw);
  assert.ok(Object.isFrozen(first.evidence.report.state));
  assert.throws(() => first.evidence.report.state.destroyed = true, TypeError);
  for (let consumer = 0; consumer < 100; consumer++) {
    const next = validateReplayEvidence(first.evidence, raw.actor);
    assert.equal(next.evidence, first.evidence, 'reuse the already owned frozen record');
    next.capabilities.push('caller-local');
  }
  assert.deepEqual(validateReplayEvidence(first.evidence, raw.actor).capabilities, ['accepted_pose']);
  assert.equal(validateReplayEvidence(first.evidence, { ...raw.actor, life: 4 }).reason, 'wrong_actor_or_life');
});
test('accepted lethal combat reports still pose the wreck in the impact transaction', () => {
  let poses = 0;
  const enemy = Object.create(Enemy.prototype), report = { state: { destroyed: true }, caps: { destroyed: true, track_left: true, track_right: true } };
  enemy.model = {}; enemy.x = 0; enemy.alive = true; enemy.combatKey = 'target';
  enemy._caps = { track_left: true, track_right: true };
  enemy.veh = { body: { localPoint: p => p, localDir: d => d }, setDamageCaps() {} };
  enemy.pose = () => { poses++; assert.equal(enemy.alive, false); };
  enemy.combat = { shoot: () => report };
  const accepted = combatHit(enemy, [0, 1, 0], [0, 0, 1], {}, 1000, 250, 12);
  assert.equal(accepted, report);
  assert.equal(enemy.cstate, report.state);
  assert.equal(enemy.alive, false);
  assert.equal(poses, 1, 'the terminal pose is immediate, not deferred to another frame');
});
test('mutable, externally frozen and deserialized inputs still receive full validation', () => {
  const raw = evidence(), accepted = validateReplayEvidence(raw, raw.actor);
  raw.report.state.destroyed = true;
  assert.equal(accepted.evidence.report.state.destroyed, false);
  raw.state_after_version = 99;
  assert.equal(validateReplayEvidence(raw, raw.actor).reason, 'state_regression');
  const external = evidence();
  Object.freeze(external);
  assert.equal(validateReplayEvidence(external, external.actor).ok, true);
  external.report.impact[0] = NaN;
  assert.equal(validateReplayEvidence(external, external.actor).ok, false);
  const wire = structuredClone(accepted.evidence);
  assert.notEqual(validateReplayEvidence(wire, wire.actor).evidence, wire);
  wire.accepted_pose.ex = [2, 0, 0];
  assert.equal(validateReplayEvidence(wire, wire.actor).reason, 'invalid_pose');
});
test('canonical admission rejects nested Map, Set and Date values despite frozen containers', () => {
  for (const extra of [new Map([['x', { health: 100 }]]), new Set([{ health: 100 }]), new Date(0)]) {
    const raw = evidence();
    raw.report.extra = Object.freeze({ nested: Object.freeze(extra) });
    const result = validateReplayEvidence(raw, raw.actor);
    assert.equal(result.ok, false, `${extra.constructor.name} has mutable internal state outside JSON ownership`);
    assert.equal(result.evidence, null);
  }
});
test('canonical admission preserves ordinary and null-prototype JSON records', () => {
  const raw = evidence();
  raw.report.extra = Object.assign(Object.create(null), { health: 100, statuses: ['damaged'], detail: { side: 'left' } });
  const result = validateReplayEvidence(raw, raw.actor);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.report.extra.health, 100);
  assert.ok(Object.isFrozen(result.evidence.report.extra.detail));
  raw.report.extra.detail.side = 'right';
  assert.equal(result.evidence.report.extra.detail.side, 'left');
  assert.equal(validateReplayEvidence(result.evidence, raw.actor).evidence, result.evidence);
});
test('frame ownership freezes mutable descendants of externally frozen containers', () => {
  let visits = 0;
  const freeze = frameFreezer(new WeakSet(), () => visits++);
  const child = { damage: [1, 2, 3] }, external = Object.freeze({ child });
  freeze(external);
  assert.ok(Object.isFrozen(child));
  assert.ok(Object.isFrozen(child.damage));
  assert.throws(() => child.damage.push(4), TypeError);
  const first = visits;
  freeze({ old: external });
  assert.equal(visits, first + 1, 'a tree traversed and frozen by us can now be reused');
});
test('subsequent frames do not descend into immutable replay history as it grows', () => {
  const slopes = [];
  for (const count of [1, 32, 128]) {
    let visits = 0;
    const freeze = frameFreezer(frozenReplayValues, () => visits++);
    const events = Array.from({ length: count }, (_, id) => {
      const raw = evidence(); raw.event_id = `hit:${id}`;
      const canonical = validateReplayEvidence(raw, raw.actor).evidence;
      return { id, evidence: canonical, traces: [{ from: [0, 0, 0], to: [0, 1, 2] }] };
    });
    freeze({ records: events.slice() });
    visits = 0;
    freeze({ records: events.slice() });
    slopes.push({ events: count, stableFrameObjectVisits: visits });
    assert.equal(visits, 2, 'only the new frame and its new record list need recursive work');
    assert.ok(events.every(event => Object.isFrozen(event.traces[0].from)));
  }
  console.log('REPLAY_HISTORY_TRAVERSAL', JSON.stringify(slopes));
});
test('replay prewarming is reusable, stays hidden and leaves active playback alone', () => {
  let contexts = 0, hides = 0, surface = null;
  const cam = Object.create(HitCam.prototype);
  cam.cur = null;
  cam.presentation = Object.create(SuppliedReplayPresentation.prototype);
  cam.presentation.acquire = () => surface ||= { context: ++contexts, renderer: { warmUp() {} } };
  cam.presentation.hide = () => hides++;
  assert.equal(cam.warmUp(), true);
  assert.equal(cam.warmUp(), true);
  assert.equal(contexts, 1, 'subsequent acquisition reuses the prewarmed context');
  assert.equal(hides, 2, 'prewarming never displays an empty replay canvas');
  assert.equal(cam.cur, null, 'prewarming does not admit an event or create a replay session');
  cam.cur = { session: { finished: false } };
  assert.equal(cam.warmUp(), true);
  assert.equal(hides, 2, 'an active replay stays visible');
});
test('failed replay prewarming permits a later normal acquisition retry', () => {
  const cam = Object.create(HitCam.prototype);
  cam.cur = null;
  cam.presentation = { warmUp() { throw Error('GPU temporarily unavailable'); } };
  assert.equal(cam.warmUp(), false);
  assert.match(cam.warmupError.message, /temporarily/);
  cam.presentation = { warmUp() {} };
  assert.equal(cam.warmUp(), true);
  assert.equal(cam.warmupError, null);
});
test('graphics prewarming submits and drains the real renderer paths once and frees scratch uploads', () => {
  const calls = [], r = Object.create(Renderer2.prototype), gpu = { vao: 'vao', vb: 'vb', ib: 'ib', eb: 'eb' };
  r.gl = { NO_ERROR: 0, finish: () => calls.push('drain'), getError: () => { calls.push('error'); return 0; }, deleteVertexArray: v => calls.push(`delete:${v}`), deleteBuffer: v => calls.push(`delete:${v}`) };
  r.upload = data => { assert.ok(data.p.length > 0); calls.push('upload'); return gpu; };
  for (const name of ['resize', 'bakeShadow', 'begin', 'finish']) r[name] = () => calls.push(name);
  r.setSamples = (_, count) => { r.samples = count; calls.push('samples'); };
  r.view = (_, __, ___, settings) => calls.push(settings.ghost ? 'ghost/wire' : settings.fragments && settings.field ? 'mesh/sky/trace/shard/field' : 'view');
  r.warmUp();
  assert.ok(calls.includes('mesh/sky/trace/shard/field'));
  assert.ok(calls.includes('ghost/wire'));
  assert.ok(calls.indexOf('finish') < calls.indexOf('drain'));
  assert.ok(calls.indexOf('drain') < calls.indexOf('error'));
  assert.deepEqual(calls.slice(-4), ['delete:vao', 'delete:vb', 'delete:ib', 'delete:eb']);
  assert.equal(r.samples, 0, 'no calibration sample appears in a later replay');
  const count = calls.length;
  r.warmUp();
  assert.equal(calls.length, count, 'warm resources are reused');
});
test('failed graphics warmup cleans scratch uploads and keeps the presentation hidden', () => {
  const freed = [], r = Object.create(Renderer2.prototype);
  r.gl = { NO_ERROR: 0, finish() {}, getError: () => 1285, deleteVertexArray: v => freed.push(v), deleteBuffer: v => freed.push(v) };
  r.upload = () => ({ vao: 'vao', vb: 'vb', ib: 'ib', eb: 'eb' });
  for (const name of ['resize', 'setSamples', 'bakeShadow', 'begin', 'view', 'finish']) r[name] = () => {};
  const presentation = Object.create(SuppliedReplayPresentation.prototype);
  presentation.acquire = () => ({ renderer: r });
  let hidden = 0;
  presentation.hide = () => hidden++;
  assert.throws(() => presentation.warmUp(), /1285/);
  assert.deepEqual(freed, ['vao', 'vb', 'ib', 'eb']);
  assert.equal(r.warmed, undefined);
  assert.equal(r.samples, 0);
  assert.equal(hidden, 1);
});
test('partial warmup uploads release the tracked surface and retry with fresh resources', () => {
  const handles = new Set(), r = Object.create(Renderer2.prototype), presentation = Object.create(SuppliedReplayPresentation.prototype);
  r.gl = {};
  r.upload = () => { handles.add('partial-vao'); handles.add('partial-buffer'); throw Error('partial upload allocation failed'); };
  let released = 0, removed = 0, retried = 0;
  const releaseSurface = presentation.releaseSurface;
  presentation.releaseSurface = function () { released++; return releaseSurface.call(this); };
  presentation.surface = { renderer: r, tracked: { dispose: () => handles.clear() }, canvas: { remove: () => removed++ } };
  presentation.acquire = function () { return this.surface ||= { renderer: { warmUp: () => retried++ }, canvas: { style: {} } }; };
  assert.throws(() => presentation.warmUp(), /partial upload allocation/);
  assert.equal(released, 1);
  assert.equal(handles.size, 0, 'tracker frees allocations which upload never returned');
  assert.equal(removed, 1);
  assert.equal(presentation.surface, null);
  assert.equal(r.samples, 0);
  assert.doesNotThrow(() => presentation.warmUp());
  assert.equal(retried, 1);
  assert.equal(presentation.surface.canvas.style.display, 'none');
});
if (process.env.TF_IMPACT_BASELINE) test('report canonical replay handoff cost against a pristine bundle', () => {
  const raw = evidence();
  raw.accepted_pose.geometry_instances = Array.from({ length: 128 }, (_, i) => [`instance:mesh:${i}`, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, i / 10, 0, 0, 1]]);
  raw.report.fragments = Array.from({ length: 128 }, (_, i) => ({ id: `fragment:${i}`, origin: [0, 1, 0], end: [i / 100, 1, 2], energy: 100, hit: null }));
  const measure = source => {
    let copies = 0;
    const validate = Function('structuredClone', `${moduleSource('replayEvidence', source)}\nreturn validateReplayEvidence;`)(v => { copies++; return structuredClone(v); });
    const canonical = validate(raw, raw.actor);
    assert.equal(canonical.ok, true);
    copies = 0;
    const start = performance.now();
    for (let hit = 0; hit < 100; hit++) for (let consumer = 0; consumer < 3; consumer++) assert.equal(validate(canonical.evidence, raw.actor).ok, true);
    return { handoffs: 300, copies, elapsed_ms: +(performance.now() - start).toFixed(2) };
  };
  const result = { baseline: measure(fs.readFileSync(process.env.TF_IMPACT_BASELINE, 'utf8')), current: measure(bundle) };
  assert.equal(result.baseline.copies, 300);
  assert.equal(result.current.copies, 0);
  console.log('REPLAY_HANDOFF_BENCHMARK', JSON.stringify(result));
  const baseline = fs.readFileSync(process.env.TF_IMPACT_BASELINE, 'utf8');
  const history = [1, 32, 128].map(count => {
    const trace = source => {
      let visits = 0;
      const freeze = frameFreezer(new WeakSet(), () => visits++, source);
      const records = Array.from({ length: count }, (_, id) => {
        const event = structuredClone(raw); event.event_id = `history:${id}`;
        return { id, evidence: validateReplayEvidence(event, event.actor).evidence };
      });
      freeze({ records: records.slice() }); visits = 0;
      freeze({ records: records.slice() });
      return visits;
    };
    return { events: count, baselineObjectVisits: trace(baseline), currentObjectVisits: trace(bundle) };
  });
  assert.ok(history.every(row => row.currentObjectVisits === 2 && row.baselineObjectVisits > row.currentObjectVisits));
  console.log('REPLAY_HISTORY_BASELINE', JSON.stringify(history));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../bundle/app.js.html', import.meta.url), 'utf8');
const start = source.indexOf('  var FLIGHT_DIAGNOSTIC_COLUMNS = '), end = source.indexOf('  var Aircraft = class', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({ LANG: 'zh', aqRot: (_q, vector) => vector.map((value, axis) => value + (axis === 0 ? .125 : 0)) });
vm.runInContext(source.slice(start, end) + '\nglobalThis.fixture = { FlightDiagnostics, columns: FLIGHT_DIAGNOSTIC_COLUMNS };', context);
const { FlightDiagnostics, columns } = context.fixture;
const asObject = row => Object.fromEntries(columns.map((key, index) => [key, row[index]]));
function plane(extended = true) {
  const cur = new Float32Array(80);
  cur[10] = -.2; cur[11] = .3; cur[12] = -.4;
  cur[15] = .15; cur[17] = 1.5; cur[39] = 1; cur[40] = 6.5;
  cur[53] = .8; cur[62] = .7; cur[64] = .2; cur[65] = .4; cur[66] = .3;
  cur[77] = .6; cur[78] = .5; cur[79] = -3;
  return { cur, time: 0, type: { id: 'nf01' }, state: { throttle: .78 }, aim: [.1, .2, .97], api: { core_version: () => extended ? 203 : 202, ...(extended ? { configure_envelope() {} } : {}) } };
}
function sample(recorder, p, count, input = [.25, -.4, .1], flags = 1) {
  for (let i = 0; i < count; i++) {
    p.time += 1 / 120;
    p.cur[23] = p.time;
    recorder.capture(p, input, flags, 1 / 120);
  }
}

test('disabled diagnostics do not inspect the plane, allocate rows or call the kernel', () => {
  const recorder = new FlightDiagnostics();
  const poison = new Proxy({}, { get() { throw Error('disabled recorder read simulation state'); } });
  for (let i = 0; i < 120; i++) assert.equal(recorder.capture(poison, poison, 1, 1 / 120), false);
  assert.equal(recorder.count, 0);
  assert.equal(recorder.rows.length, 0);
  assert.equal(recorder.latest(), null);
});

test('120 Hz physics is sampled at 30 Hz into a fixed-capacity chronological ring', () => {
  const recorder = new FlightDiagnostics(7), p = plane();
  recorder.setEnabled(true);
  sample(recorder, p, 120);
  assert.equal(recorder.count, 7);
  assert.equal(recorder.rows.length, 7);
  const records = recorder.snapshot().map(asObject);
  assert.equal(records.length, 7);
  for (let i = 1; i < records.length; i++) assert.ok(Math.abs(records[i].host_time_s - records[i - 1].host_time_s - 1 / 30) < 1e-8);
  assert.ok(Math.abs(records.at(-1).host_time_s - 117 / 120) < 1e-8);
  assert.equal(recorder.snapshot(3).length, 3);
  assert.equal(recorder.snapshot(0).length, 0);
  // Retaining a minute stays bounded even after ten simulated minutes.
  const minute = new FlightDiagnostics(); minute.setEnabled(true);
  sample(minute, p, 120 * 600);
  assert.equal(minute.count, 1800);
  assert.equal(minute.rows.length, 1800);
});

test('samples own their input/state and use the command-rate sign convention for all axes', () => {
  const recorder = new FlightDiagnostics(), p = plane(), input = [.3, -.2, .1], flown = [.6, .1, .8];
  recorder.setEnabled(true);
  recorder.capture(p, input, 1 | 2 | 32, 1 / 120, flown);
  const record = asObject(recorder.latest());
  assert.equal(record.schema, 2);
  assert.equal(record.core_version, 203);
  assert.equal(record.instructor, 1); assert.equal(record.free_look, 1); assert.equal(record.level_hold, 1);
  assert.equal(record.input_pitch, .3); assert.equal(record.raw_aim_x, .1); assert.equal(record.kernel_input_target_x, .6);
  assert.ok(Math.abs(record.command_pitch_deg_s - record.actual_pitch_deg_s) < 1e-6);
  assert.ok(Math.abs(record.command_roll_deg_s - record.actual_roll_deg_s) < 1e-6);
  assert.ok(Math.abs(record.command_yaw_deg_s - record.actual_yaw_deg_s) < 1e-6);
  assert.equal(record.g_limit_negative, -3);
  assert.ok(Math.abs(record.aoa_gate_negative - .6) < 1e-6);
  assert.ok(Math.abs(record.g_gate_negative - .5) < 1e-6);
  input[0] = -1; flown[0] = -1; p.aim[0] = -1; p.cur[17] = 99;
  const saved = asObject(recorder.latest());
  assert.equal(saved.input_pitch, .3); assert.equal(saved.kernel_input_target_x, .6); assert.equal(saved.raw_aim_x, .1); assert.equal(saved.load_g, 1.5);
  const owned = recorder.snapshot(); owned[0][0] = 99;
  assert.equal(asObject(recorder.latest()).schema, 2);
});

test('legacy or short telemetry does not invent negative-envelope fields', () => {
  for (const p of [plane(false), { ...plane(), cur: new Float32Array(77) }]) {
    const recorder = new FlightDiagnostics(); recorder.setEnabled(true);
    recorder.capture(p, [0, 0, 0], 1, 1 / 120);
    const record = asObject(recorder.latest());
    assert.equal(record.aoa_gate_negative, ''); assert.equal(record.g_gate_negative, ''); assert.equal(record.g_limit_negative, '');
    assert.equal(record.core_version, p.api.core_version());
  }
});

test('schema 2 appends commanded flap stage and target while preserving actual extension', () => {
  assert.deepEqual(Array.from(columns.slice(-2)), ['flap_stage', 'flap_target']);
  assert.deepEqual(Array.from(columns.slice(-5, -2)), ['gear', 'flaps', 'crashed']);
  for (const [requested, stage, target] of [['up', 'up', 0], ['combat', 'combat', .25], ['takeoff', 'takeoff', .5], [true, 'takeoff', .5], [false, 'up', 0]]) {
    const recorder = new FlightDiagnostics(), p = plane();
    p.state.flaps = requested; p.cur[34] = .125;
    recorder.setEnabled(true); recorder.capture(p, [0, 0, 0], 1, 1 / 120);
    const record = asObject(recorder.latest());
    assert.equal(record.schema, 2);
    assert.equal(record.flap_stage, stage);
    assert.equal(record.flap_target, target);
    assert.equal(record.flaps, .125, 'accepted extension must remain distinct from commanded target');
    assert.equal(recorder.latest().length, columns.length);
  }
});

test('pausing collection retains history, clear restarts capture, and kernel clock rollback identifies a new segment', () => {
  const recorder = new FlightDiagnostics(), p = plane(); recorder.setEnabled(true);
  sample(recorder, p, 12); const before = recorder.count;
  recorder.setEnabled(false); sample(recorder, p, 120);
  assert.equal(recorder.count, before);
  recorder.setEnabled(true); sample(recorder, p, 1);
  assert.equal(recorder.count, before + 1);
  p.time = 0; sample(recorder, p, 4);
  assert.equal(asObject(recorder.latest()).segment, 1);
  recorder.clear(); assert.equal(recorder.enabled, true); assert.equal(recorder.count, 0);
  sample(recorder, p, 1); assert.equal(recorder.count, 1);
  assert.equal(asObject(recorder.latest()).segment, 0);
});

test('CSV keeps a stable schema, quotes identifiers, and uses accepted switches and numeric missing fields', () => {
  const recorder = new FlightDiagnostics(), p = plane(); p.type.id = 'a,"b\nc';
  recorder.setEnabled(true); recorder.capture(p, [1, 0, -1], 0, 1 / 120);
  const csv = recorder.toCSV(), header = csv.slice(0, csv.indexOf('\r\n'));
  assert.equal(header, Array.from(columns).join(','));
  assert.ok(csv.includes('"a,""b\nc"'));
  assert.equal(recorder.latest().length, columns.length);
  const record = asObject(recorder.latest());
  assert.equal(record.instructor, 0); assert.equal(record.protection, 1);
  recorder.clear(); assert.equal(recorder.toCSV(), header + '\r\n');
});

test('actual Aircraft._step records the post-step state and exact biased kernel target only when enabled', () => {
  const from = source.indexOf('    pilotIntent(dt) {', source.indexOf('  var Aircraft = class'));
  const to = source.indexOf('    /** Fixed 120 Hz steps', from);
  assert.ok(from > 0 && to > from);
  vm.runInContext('globalThis.stepMethods = (class {' + source.slice(from, to) + '}).prototype;globalThis.stepMethod=stepMethods._step;', context);
  const p = plane(), accepted = new Float32Array(80); accepted.set(p.cur);
  Object.assign(p, { S: accepted, prev: new Float32Array(80), keys: new Set(), damage: {}, aimBias: [0, 0, 0, 1], _inputs: () => [.2, 0, 0], pilotIntent: context.stepMethods.pilotIntent, diagnostics: { enabled: false, capture() { throw Error('disabled hook called'); } } });
  p.api.step = (dt, x, y, z, throttle, pitch) => { accepted[23] += dt; accepted[17] = 4.25; p.accepted = { x, y, z, throttle, pitch }; };
  context.stepMethod.call(p, 1 / 120);
  p.diagnostics = new FlightDiagnostics(); p.diagnostics.setEnabled(true);
  context.stepMethod.call(p, 1 / 120);
  const record = asObject(p.diagnostics.latest());
  assert.equal(record.load_g, 4.25);
  assert.equal(record.kernel_input_target_x, p.accepted.x);
  assert.equal(record.raw_aim_x + .125, record.kernel_input_target_x);
  assert.equal(record.input_pitch, p.accepted.pitch);
  assert.ok(record.kernel_time_s > 0);
  assert.equal(p.state.level, false);
});

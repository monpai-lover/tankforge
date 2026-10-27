import {aircraftPerformancePrelude} from '../tools/aircraft_performance/runtime.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Actual-kernel regression for retracted/combat/takeoff flaps and the legacy full-flap bit.
// node handoff/tests/flight_flaps.test.mjs [WASM_PATH]
const root = fileURLToPath(new URL('../../', import.meta.url));
const wasmPath = process.argv[2] === '--wasm' ? process.argv[3] : process.argv[2] || path.join(root, 'handoff/flight/flight_core.wasm');
assert.ok(wasmPath, 'Expected a WASM path after --wasm');
const source = fs.readFileSync(path.join(root, 'handoff/bundle/app.js.html'), 'utf8');
const context = vm.createContext({ AIR_PARTS: [], AIR_SKIN: [], AIR_PARTS_JET: [], AIR_SKIN_JET: [] });
function extract(from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `Delivered aircraft metadata missing: ${from}`);
  return source.slice(start, end);
}
vm.runInContext(aircraftPerformancePrelude()+extract('  var aircraftGeometry = (() => {', '  // NF-01 gear'), context);
vm.runInContext(extract('  var AIRCRAFT_TYPES = {', '  // ---- hangar fighters') + ';globalThis.type=AIRCRAFT_TYPES.nf01;', context);
const type = context.type;
assert.ok(type?.airframe && type.airframe[0] > 0, 'Delivered NF01 airframe unavailable');
const module = await WebAssembly.compile(fs.readFileSync(wasmPath));
const DT = 1 / 120, SLEW = 0.65, GRAVITY = 9.80665, THROTTLE = 0.5;
const imports = {
  math: { sin: Math.sin, cos: Math.cos, atan2: Math.atan2, exp: Math.exp, asin: Math.asin, acos: Math.acos },
  world: { ground: () => 0, landable: () => 1 }
};
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
async function make(onGround = false) {
  const api = (await WebAssembly.instantiate(module, imports)).exports;
  api.set_world(1); api.configure_control(1, 0, 0.22, 1);
  api.configure_airframe(...type.airframe);
  api.configure(0, 45, 1, type.gLimit, 0);
  api.spawn(0, 3000, 0, 0, 100, Number(onGround));
  const state = new Float32Array(api.memory.buffer, api.state_ptr(), api.state_len());
  const step = flags => {
    // Fixed zero elevator/aileron/rudder, instructor disabled and protection disabled.
    api.step(DT, 0, 0, 1, THROTTLE, 0, 0, 0, flags);
    assert.ok(state.every(Number.isFinite), 'Flap test produced a non-finite state');
    assert.equal(state[22], 0, 'Flap test crashed');
  };
  return { api, state, step };
}
function checkActuation(core, target, flags, steps = 240) {
  for (let i = 0; i < steps; i++) {
    const before = core.state[34];
    core.step(flags);
    const expected = before + Math.max(-SLEW * DT, Math.min(SLEW * DT, target - before));
    near(core.state[34], expected, 2e-7, `0.65/s flap actuation at step ${i}, flags ${flags}`);
  }
  near(core.state[34], target, 2e-6, `Flap convergence, flags ${flags}`);
}
const commands = [
  { label: 'retracted', flags: 0, target: 0 },
  { label: 'combat', flags: 64, target: 0.25 },
  { label: 'takeoff', flags: 128, target: 0.5 },
  { label: 'legacy-full', flags: 8, target: 1 },
  { label: 'combat-with-legacy-bit', flags: 64 | 8, target: 0.25 },
  { label: 'takeoff-with-legacy-bit', flags: 128 | 8, target: 0.5 },
  { label: 'takeoff-over-combat', flags: 128 | 64, target: 0.5 },
  { label: 'takeoff-over-both', flags: 128 | 64 | 8, target: 0.5 }
];
let checks = 0;
for (const command of commands) {
  const core = await make();
  checkActuation(core, command.target, command.flags);
  checks++;
}
{
  const core = await make();
  checkActuation(core, 1, 8);
  checkActuation(core, 0.25, 64 | 8);
  checkActuation(core, 0.5, 128 | 8);
  checkActuation(core, 0, 0);
  checks++;
}
{
  const core = await make(true);
  near(core.state[34], 0.5, 0, 'Parked spawn keeps its takeoff flap preset');
  near(core.state[33], 1, 0, 'Parked spawn starts with gear down');
  checkActuation(core, 0.5, 128 | 8 | 4, 10);
  checks++;
}
// The JS bridge combines the old bit with each partial setting. Confirm it
// gives the same physical trajectory as the corresponding standalone bit.
for (const bit of [64, 128]) {
  const standalone = await make(), combined = await make();
  for (let i = 0; i < 240; i++) {
    standalone.step(bit); combined.step(bit | 8);
    assert.deepEqual(Array.from(standalone.state), Array.from(combined.state), `Legacy-bit combination changes the ${bit} trajectory`);
  }
  checks++;
}
const aerodynamic = [];
let commonInitial = null;
for (const { label, flags, target } of commands.slice(0, 4)) {
  const core = await make(), s = core.state;
  const initial = Array.from(s);
  if (commonInitial) assert.deepEqual(initial, commonInitial, 'Aerodynamic comparisons must start in the same physical state');
  else commonInitial = initial;
  let samples = 0, meanSpeed = 0, meanLoadG = 0, meanVerticalSpeed = 0, meanDragDeceleration = 0;
  for (let i = 0; i < 240; i++) {
    const velocity = Array.from(s.slice(7, 10)), forward = Array.from(s.slice(48, 51));
    const speed = Math.hypot(...velocity), direction = velocity.map(x => x / speed);
    core.step(flags);
    if (i < 204) continue; // Measure 1.7–2.0 s, after even the full setting has physically deployed.
    near(s[34], target, 2e-6, `${label} is deployed before aerodynamic sampling`);
    near(s[24], 0, 1e-6, 'Fixed elevator during the aerodynamic comparison');
    near(s[25], 0, 1e-6, 'Fixed aileron during the aerodynamic comparison');
    near(s[26], 0, 1e-6, 'Fixed rudder during the aerodynamic comparison');
    assert.equal(s[39], 0, 'Protection must remain disabled');
    // Infer drag from measured acceleration along the pre-step velocity,
    // subtracting measured thrust and gravity. This uses no drag/lift coefficient formula.
    const alongAcceleration = direction.reduce((sum, x, k) => sum + x * (s[7 + k] - velocity[k]) / DT, 0);
    const alongThrust = s[37] / type.airframe[0] * direction.reduce((sum, x, k) => sum + x * forward[k], 0);
    meanDragDeceleration += alongThrust - GRAVITY * direction[1] - alongAcceleration;
    meanSpeed += Math.hypot(...s.slice(7, 10)); meanLoadG += s[17]; meanVerticalSpeed += s[8]; samples++;
  }
  aerodynamic.push({ setting: label, actualFlaps: s[34], meanSpeed_m_s: meanSpeed / samples, meanLoadG: meanLoadG / samples, meanVerticalSpeed_m_s: meanVerticalSpeed / samples, inferredDragDeceleration_m_s2: meanDragDeceleration / samples });
}
for (let i = 1; i < aerodynamic.length; i++) {
  const less = aerodynamic[i - 1], more = aerodynamic[i];
  assert.ok(more.meanLoadG > less.meanLoadG + 0.05, `${more.setting} must give more lift in this attached-flow window`);
  assert.ok(more.meanVerticalSpeed_m_s > less.meanVerticalSpeed_m_s + 0.5, `${more.setting} must change vertical response`);
  assert.ok(more.meanSpeed_m_s < less.meanSpeed_m_s - 0.1, `${more.setting} must reduce speed under the same inputs`);
  assert.ok(more.inferredDragDeceleration_m_s2 > less.inferredDragDeceleration_m_s2 + 0.1, `${more.setting} must produce additional drag`);
}
checks++;
console.log(JSON.stringify({ passed: true, checks, wasm: path.resolve(wasmPath), engine: (await make()).api.core_version(), conditions: { type: 'nf01', altitude_m: 3000, initialSpeed_m_s: 100, dt_s: DT, fixedThrottle: THROTTLE, fixedManualControls: [0, 0, 0], instructor: false, protection: false, aerodynamicWindow_s: [1.7, 2] }, commands, aerodynamic }));

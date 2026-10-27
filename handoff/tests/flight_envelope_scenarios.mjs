import {aircraftPerformancePrelude} from '../tools/aircraft_performance/runtime.mjs';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Characterize the actual flight kernel without asserting uncalibrated performance limits.
// node handoff/tests/flight_envelope_scenarios.mjs --wasm candidate.wasm --json results.json [--types all|nf01,p51d,f104g,mirage3e]
const root = fileURLToPath(new URL('../../', import.meta.url));
const options = { wasm: path.join(root, 'handoff/flight/flight_core.wasm'), json: null, types: 'nf01,p51d,f104g,mirage3e' };
for (let i = 2; i < process.argv.length; i++) {
  const name = process.argv[i];
  if (!['--wasm', '--json', '--types'].includes(name) || !process.argv[i + 1]) throw new Error('Expected --wasm PATH, optional --json PATH and --types all|comma-separated-ids');
  const value = process.argv[++i];
  options[name.slice(2)] = name === '--types' ? value : path.resolve(value);
}
const source = fs.readFileSync(path.join(root, 'handoff/bundle/app.js.html'), 'utf8');
const bytes = fs.readFileSync(options.wasm);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const embedded = Buffer.from(source.match(/var FLIGHT_CORE_WASM = "([^"]+)"/)[1], 'base64');
const context = vm.createContext({ AIR_PARTS: [], AIR_SKIN: [], AIR_PARTS_JET: [], AIR_SKIN_JET: [] });
function extract(from, to) {
  const a = source.indexOf(from), b = source.indexOf(to, a);
  if (a < 0 || b <= a) throw new Error(`Bundled metadata unavailable: ${from}`);
  return source.slice(a, b);
}
vm.runInContext(aircraftPerformancePrelude()+extract('  var aircraftGeometry = (() => {', '  // NF-01 gear'), context);
vm.runInContext(extract('  var AIRCRAFT_TYPES = {', '  // ---- hangar fighters') + '\nglobalThis.types = AIRCRAFT_TYPES;', context);
vm.runInContext(extract('  var AIR_FIGHTERS = {', '  function fighterDamageModel(f) {') + '\nglobalThis.fighters = AIR_FIGHTERS;', context);
const types = { ...context.types, ...context.fighters };
const flyable = type => Array.isArray(type?.airframe) && type.airframe.length >= 11 && type.airframe.every(Number.isFinite) && type.gLimit > 0;
const IDS = options.types === 'all' ? Object.keys(types).filter(id => flyable(types[id])) : [...new Set(options.types.split(',').map(id => id.trim()).filter(Boolean))];
if (!IDS.length || IDS.some(id => !flyable(types[id]))) throw new Error(`Unknown or non-flyable aircraft IDs: ${options.types}`);
const DT = 1 / 120, SPEEDS = [70, 140, 220];
const INTACT = [1, 1, 1, 1, 1, 1], DAMAGED = [1, 0.7, 0.85, 0.65, 0.8, 0.8];
const DAMAGE_NAMES = ['thrust', 'leftWingLift', 'rightWingLift', 'pitchAuthority', 'rollAuthority', 'yawAuthority'];
const module = await WebAssembly.compile(bytes);
const imports = { math: { sin: Math.sin, cos: Math.cos, atan2: Math.atan2, exp: Math.exp, asin: Math.asin, acos: Math.acos }, world: { ground: () => 0, landable: () => 1 } };
const round = x => Number.isFinite(x) ? +x.toFixed(6) : null;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
const toDegrees = x => x * 180 / Math.PI;
function stats(values) {
  if (!values.length) return null;
  const mean = values.reduce((sum, x) => sum + x, 0) / values.length;
  return { mean: round(mean), centeredRms: round(Math.sqrt(values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / values.length)), span: round(Math.max(...values) - Math.min(...values)) };
}
async function create(scenario) {
  const instance = await WebAssembly.instantiate(module, imports), api = instance.exports, type = types[scenario.type];
  if (!type?.airframe || !(type.gLimit > 0)) throw new Error(`Aircraft configuration missing: ${scenario.type}`);
  const limits = { maxG: type.gLimit, minG: -3, maxAoA_rad: type.airframe[10], minAoA_rad: -0.75 * type.airframe[10] };
  api.set_world(1);
  api.configure_control(scenario.profile, 0, 0.22, 1);
  api.configure_airframe(...type.airframe);
  api.configure(0, 45, 1, limits.maxG, scenario.protection ? 1 : 0);
  const envelopeAvailable = typeof api.configure_envelope === 'function';
  // ABI: configure_envelope(maxG, minG, maxAoA_rad, minAoA_rad); zero angles choose the kernel's automatic limits.
  if (envelopeAvailable) api.configure_envelope(limits.maxG, limits.minG, 0, 0);
  api.spawn(0, scenario.altitude, 0, 0, scenario.speed, 0);
  if (typeof api.set_damage !== 'function') throw new Error('Kernel lacks the damage API needed by this matrix');
  api.set_damage(...scenario.damage);
  return { api, state: new Float32Array(api.memory.buffer, api.state_ptr(), api.state_len()), limits, envelopeAvailable };
}
function stateSummary(s) {
  return { coreTime_s: round(s[23]), position_m: Array.from(s.slice(0, 3), round), speed_m_s: round(s[13]), aoa_deg: round(toDegrees(s[15])), loadG: round(s[17]), bank_deg: round(toDegrees(s[20])), pitch_deg: round(toDegrees(s[19])), bodyRates_rad_s: Array.from(s.slice(10, 13), round), crashed: s[22] > 0.5 };
}
function inversionSetup(api, s, throttle) {
  let stable = 0, elapsed = 0, reached = false, finite = true;
  for (let i = 0; i < 720; i++) {
    // A real manual roll and braking phase; never write orientation or velocity into WASM memory.
    const error = wrap(Math.PI - s[20]), roll = clamp(error * 2.4 + s[12] * 0.8, -1, 1);
    api.step(DT, 0, 0, 1, throttle, 0, roll, 0, 0);
    elapsed = (i + 1) * DT;
    finite = s.every(Number.isFinite);
    if (!finite || s[22] > 0.5) break;
    stable = Math.abs(wrap(Math.PI - s[20])) < 10 * Math.PI / 180 && Math.abs(s[12]) < 0.15 ? stable + 1 : 0;
    if (stable >= 24) { reached = true; break; }
  }
  return { reachedWithin10DegreesWithLowRollRate: reached, elapsed_s: round(elapsed), finite, state: stateSummary(s) };
}
const patterns = [
  { kind: 'full-pull', seconds: 15, input: () => 1 },
  { kind: 'full-push', seconds: 15, input: () => -1 },
  { kind: 'pull-then-push', seconds: 10, input: t => t < 5 ? 1 : -1 },
  { kind: 'push-then-pull', seconds: 10, input: t => t < 5 ? -1 : 1 }
];
const common = { altitude: 6000, throttle: 0.78, instructor: true, protection: true, profile: 1 };
const scenarios = [];
for (const type of IDS) for (const speed of SPEEDS) for (const [damageName, damage] of [['intact', INTACT], ['damaged', DAMAGED]]) for (const pattern of patterns) {
  scenarios.push({ ...common, ...pattern, type, speed, damageName, damage, group: 'upright-matrix' });
}
for (const [instructor, protection] of [[true, false], [false, true], [false, false]]) for (const pattern of patterns) {
  scenarios.push({ ...common, ...pattern, type: 'nf01', speed: 140, instructor, protection, damageName: 'intact', damage: INTACT, group: 'protection-control' });
}
for (const pattern of patterns.slice(0, 2)) scenarios.push({ ...common, ...pattern, type: 'nf01', speed: 140, profile: 0, damageName: 'intact', damage: INTACT, group: 'legacy-protected-control' });
for (const type of IDS) for (const speed of SPEEDS) for (const pattern of patterns.slice(0, 2)) {
  scenarios.push({ ...common, ...pattern, type, speed, damageName: 'intact', damage: INTACT, inverted: true, group: 'inverted-matrix' });
}
for (const type of IDS) scenarios.push({ ...common, type, speed: 140, kind: 'target-60deg', seconds: 30, input: () => 0, damageName: 'intact', damage: INTACT, group: 'tracking' });
const results = [];
let engine = null;
for (const scenario of scenarios) {
  const { api, state: s, limits, envelopeAvailable } = await create(scenario);
  engine ||= { version: api.core_version(), stateFloats: api.state_len(), exports: Object.keys(api).sort(), envelopeApiAvailable: envelopeAvailable };
  const inversion = scenario.inverted ? inversionSetup(api, s, scenario.throttle) : null;
  const initial = stateSummary(s), target = scenario.kind === 'target-60deg' ? [Math.sin(Math.PI / 3), 0, Math.cos(Math.PI / 3)] : [0, 0, 1];
  const samples = [], steps = Math.round(scenario.seconds / DT), tailSteps = Math.round(3 / DT), trackingTailSteps = Math.round(10 / DT), captureHoldSteps = Math.round(1 / DT);
  let finite = !inversion || inversion.finite, crashedAt = null, firstWithin3 = null, firstWithin3Held1s = null, within3Streak = 0, minG = Infinity, maxG = -Infinity, minAoA = Infinity, maxAoA = -Infinity;
  let overPositiveG = 0, overNegativeG = 0, overPositiveAoA = 0, overNegativeAoA = 0, measured = 0;
  let minPositiveAoAGate = 1, minPositiveGGate = 1, minNegativeAoAGate = 1, minNegativeGGate = 1;
  for (let i = 0; i < steps && finite && !(s[22] > 0.5); i++) {
    const pitch = scenario.input(i * DT);
    api.step(DT, ...target, scenario.throttle, pitch, 0, 0, scenario.instructor ? 1 : 0);
    measured = i + 1;
    finite = s.every(Number.isFinite);
    if (!finite) break;
    const g = s[17], aoa = s[15], error = toDegrees(Math.acos(clamp(target[0] * s[48] + target[1] * s[49] + target[2] * s[50], -1, 1)));
    minG = Math.min(minG, g); maxG = Math.max(maxG, g); minAoA = Math.min(minAoA, aoa); maxAoA = Math.max(maxAoA, aoa);
    overPositiveG += g > limits.maxG ? 1 : 0; overNegativeG += g < limits.minG ? 1 : 0;
    overPositiveAoA += aoa > limits.maxAoA_rad ? 1 : 0; overNegativeAoA += aoa < limits.minAoA_rad ? 1 : 0;
    minPositiveAoAGate = Math.min(minPositiveAoAGate, s[53]); minPositiveGGate = Math.min(minPositiveGGate, s[62]);
    if (envelopeAvailable && engine.version >= 203 && s.length >= 80) { minNegativeAoAGate = Math.min(minNegativeAoAGate, s[77]); minNegativeGGate = Math.min(minNegativeGGate, s[78]); }
    if (scenario.kind === 'target-60deg') {
      if (firstWithin3 === null && error <= 3) firstWithin3 = measured * DT;
      within3Streak = error <= 3 ? within3Streak + 1 : 0;
      // Record the beginning of the first qualifying 120-step interval, not when its 1 s dwell becomes known.
      if (firstWithin3Held1s === null && within3Streak >= captureHoldSteps) firstWithin3Held1s = (measured - captureHoldSteps) * DT;
    }
    samples.push({ g, aoa_deg: toDegrees(aoa), pitchRate_rad_s: s[10], error_deg: error });
    if (s[22] > 0.5) crashedAt = measured * DT;
  }
  const tail = samples.slice(-tailSteps), trackingTail = samples.slice(-trackingTailSteps);
  results.push({
    id: [scenario.group, scenario.type, scenario.speed, scenario.damageName, scenario.kind, `p${Number(scenario.protection)}`, `i${Number(scenario.instructor)}`, `v${scenario.profile}`].join('/'),
    group: scenario.group, type: scenario.type, kind: scenario.kind,
    settings: { dt_s: DT, altitude_m: scenario.altitude, speed_m_s: scenario.speed, throttle: scenario.throttle, requestedDuration_s: scenario.seconds, instructor: scenario.instructor, protection: scenario.protection, profile: scenario.profile, handoff: 0, releaseDelay_s: 0.22, damageName: scenario.damageName, damage: Object.fromEntries(DAMAGE_NAMES.map((k, i) => [k, scenario.damage[i]])), targetDirection: target, reversalAt_s: scenario.kind.includes('-then-') ? 5 : null },
    limits: { ...limits, maxAoA_deg: round(toDegrees(limits.maxAoA_rad)), minAoA_deg: round(toDegrees(limits.minAoA_rad)), aoaReference: 'automatic clean-airframe ceiling=stallAoA, floor=-0.75*ceiling; comparison policy for kernels without the new API', envelopeApplied: envelopeAvailable, envelopeCall: envelopeAvailable ? [limits.maxG, limits.minG, 0, 0] : null },
    initial, inversionSetup: inversion,
    measuredDuration_s: round(measured * DT), finite, crashed: s[22] > 0.5, crashedAt_s: round(crashedAt), completedRequestedSteps: measured === steps && finite,
    minG: round(minG), maxG: round(maxG), minAoA_deg: round(toDegrees(minAoA)), maxAoA_deg: round(toDegrees(maxAoA)),
    positiveGExcess: round(Math.max(0, maxG - limits.maxG)), negativeGExcess: round(Math.max(0, limits.minG - minG)),
    beyondLimitsDuration_s: { positiveG: round(overPositiveG * DT), negativeG: round(overNegativeG * DT), positiveAoA: round(overPositiveAoA * DT), negativeAoA: round(overNegativeAoA * DT) },
    tailVariation: { window_s: round(tail.length * DT), meaning: 'RMS about the tail mean and full span; includes trajectory trends, not a pure oscillation-frequency estimate', loadG: stats(tail.map(q => q.g)), aoa_deg: stats(tail.map(q => q.aoa_deg)), pitchRate_rad_s: stats(tail.map(q => q.pitchRate_rad_s)) },
    tracking: scenario.kind === 'target-60deg' ? { firstWithin3Degrees_s: round(firstWithin3), firstWithin3DegreesHeld1s_s: round(firstWithin3Held1s), held1sDefinition: 'Start of the first 120 consecutive 1/120 s step intervals whose post-step error is <=3 degrees', tailWindow_s: round(trackingTail.length * DT), last10sRmsError_deg: trackingTail.length ? round(Math.sqrt(trackingTail.reduce((n, q) => n + q.error_deg ** 2, 0) / trackingTail.length)) : null } : null,
    gates: { minPositiveAoA: round(minPositiveAoAGate), minPositiveG: round(minPositiveGGate), minNegativeAoA: envelopeAvailable && engine.version >= 203 ? round(minNegativeAoAGate) : null, minNegativeG: envelopeAvailable && engine.version >= 203 ? round(minNegativeGGate) : null, reportedMinG: envelopeAvailable && engine.version >= 203 ? round(s[79]) : null },
    final: stateSummary(s)
  });
}
const report = {
  purpose: 'Flight-envelope characterization; no calibrated safety/performance pass threshold is asserted',
  engine: { ...engine, wasmPath: options.wasm, wasmBytes: bytes.length, sha256: sha256(bytes), matchesCurrentEmbedded: bytes.equals(embedded), embeddedSha256: sha256(embedded), aircraftConfigurationBundleSha256: sha256(Buffer.from(source)) },
  conditions: { world: 'flat, landable, zero wind', dt_s: DT, altitude_m: 6000, speeds_m_s: SPEEDS, types: IDS, damagePreset: Object.fromEntries(DAMAGE_NAMES.map((k, i) => [k, DAMAGED[i]])), measuredFromActualKernel: true, invertedSetup: 'manual bank servo with instructor off, up to 6 seconds; reached state and actual start are recorded', reversalTime_s: 5 },
  summary: { scenarios: results.length, finite: results.filter(r => r.finite).length, crashed: results.filter(r => r.crashed).length, completedRequestedSteps: results.filter(r => r.completedRequestedSteps).length, inversionSetupsReached: results.filter(r => r.inversionSetup?.reachedWithin10DegreesWithLowRollRate).length, inversionSetupsRequested: results.filter(r => r.inversionSetup).length },
  results
};
const json = JSON.stringify(report, null, 2) + '\n';
if (options.json) { fs.mkdirSync(path.dirname(options.json), { recursive: true }); fs.writeFileSync(options.json, json); console.log(JSON.stringify({ output: options.json, engine: report.engine.version, envelopeApiAvailable: engine.envelopeApiAvailable, summary: report.summary })); }
else process.stdout.write(json);

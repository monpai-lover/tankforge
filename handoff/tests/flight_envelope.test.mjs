import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Behavioral checks for signed protection and live switch semantics. The
// broader characterization matrix deliberately reports residual soft-limit
// excursions instead of treating protection as an inviolable physical bound.
const root = fileURLToPath(new URL('../../', import.meta.url));
const bundle = fs.readFileSync(path.join(root, 'handoff/bundle/app.js.html'), 'utf8');
const fightersStart = bundle.indexOf('  var AIR_FIGHTERS = {');
const fightersEnd = bundle.indexOf('  /** Damage parts and skin of a hangar fighter', fightersStart);
assert.ok(fightersStart >= 0 && fightersEnd > fightersStart, 'Delivered airframes unavailable');
const metadata = vm.createContext({});
vm.runInContext(bundle.slice(fightersStart, fightersEnd) + ';globalThis.fighters=AIR_FIGHTERS;', metadata);
const wasmPath = process.argv[2] || path.join(root, 'handoff/flight/flight_core.wasm');
const module = await WebAssembly.compile(fs.readFileSync(wasmPath));
const dt = 1 / 120, imports = {
  math: { sin: Math.sin, cos: Math.cos, atan2: Math.atan2, exp: Math.exp, asin: Math.asin, acos: Math.acos },
  world: { ground: () => 0, landable: () => 1 }
};
async function make(protection = true, profile = 1, start = {}) {
  const api = (await WebAssembly.instantiate(module, imports)).exports;
  assert.equal(typeof api.configure_envelope, 'function', 'Signed envelope API required');
  api.set_world(1); api.configure_control(profile, 0, 0.22, 1);
  if (start.airframe) api.configure_airframe(...start.airframe);
  api.configure(0, 45, 1, start.gLimit ?? 6.5, Number(protection));
  api.configure_envelope(start.gLimit ?? 6.5, -3, 0, 0);
  api.spawn(0, start.altitude ?? 3000, 0, 0, start.speed ?? 140, 0);
  const s = new Float32Array(api.memory.buffer, api.state_ptr(), api.state_len());
  return { api, s, step: (pitch, flags = 1) => api.step(dt, 0, 0, 1, 0.78, pitch, 0, 0, flags) };
}
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 2e-6, `${message}: ${a} vs ${b}`);
const physical = s => Array.from(s.slice(0, 28));
let checks = 0;
const regressions = { highSpeedReversals: [] };
for (const profile of [0, 1]) {
  for (const pitch of [-1, 1]) {
    const protectedCore = await make(true, profile), rawCore = await make(false, profile);
    let peak = -Infinity, trough = Infinity, rawPeak = -Infinity, rawTrough = Infinity;
    for (let i = 0; i < 240; i++) {
      protectedCore.step(pitch); rawCore.step(pitch);
      assert.ok(protectedCore.s.every(Number.isFinite));
      peak = Math.max(peak, protectedCore.s[17]); trough = Math.min(trough, protectedCore.s[17]);
      rawPeak = Math.max(rawPeak, rawCore.s[17]); rawTrough = Math.min(rawTrough, rawCore.s[17]);
    }
    if (pitch > 0) { assert.ok(peak < 6.5, `NF01 protected positive pull: ${peak}`); assert.ok(rawPeak - peak > 2); }
    else { assert.ok(trough > -3, `NF01 protected negative push: ${trough}`); assert.ok(trough - rawTrough > 2); }
    checks++;
  }
  // Crossing an existing limit with protection disabled must not stop an
  // explicit unloading input when protection is switched on mid-maneuver.
  for (const direction of [-1, 1]) {
    const c = await make(false, profile);
    let crossed = false;
    for (let i = 0; i < 240; i++) {
      c.step(direction);
      if (direction > 0 ? c.s[17] > 7 : c.s[17] < -3.5) { crossed = true; break; }
    }
    assert.ok(crossed, 'Must establish a real physical limit excursion first');
    const before = c.s[24];
    c.api.configure(0, 45, 1, 6.5, 1); c.step(-direction);
    near(c.s[24], before - direction * 3.5 * dt, 'Unloading receives the full actuator slew');
    checks++;
  }
}
for (const instructor of [0, 1]) {
  const a = await make(false), b = await make(true);
  if (instructor) b.api.configure(0, 45, 1, 6.5, 0);
  // Either instructor off or protection off restores the same raw elevator.
  for (let i = 0; i < 1200; i++) {
    const pitch = i < 600 ? 1 : -1;
    a.step(pitch, instructor); b.step(pitch, instructor);
    assert.deepEqual(physical(a.s), physical(b.s), 'Disabled protection changes physical response');
    assert.equal(b.s[53], 1); assert.equal(b.s[62], 1);
    assert.equal(b.s[77], 1); assert.equal(b.s[78], 1);
  }
  checks++;
}
// Regression: a full-stick reversal at high dynamic pressure used to let the
// unloading side build unbounded opposite pitch momentum. A good two-second
// peak alone did not expose the resulting repeated +15 G/-5 G departures.
for (const firstDirection of [-1, 1]) {
  const c = await make(true, 1, { altitude: 6000, speed: 220 });
  let minG = Infinity, maxG = -Infinity;
  const tail = [];
  for (let i = 0; i < 1200; i++) {
    c.step(i < 600 ? firstDirection : -firstDirection);
    assert.ok(c.s.every(Number.isFinite));
    minG = Math.min(minG, c.s[17]); maxG = Math.max(maxG, c.s[17]);
    if (i >= 840) tail.push(c.s[17]);
  }
  const mean = tail.reduce((sum, g) => sum + g, 0) / tail.length;
  const rms = Math.sqrt(tail.reduce((sum, g) => sum + (g - mean) ** 2, 0) / tail.length);
  assert.ok(maxG < 7 && minG > -3.5, `High-speed reversal departs: ${minG}..${maxG} G`);
  assert.ok(rms < 0.5, `High-speed reversal keeps pumping: tail RMS ${rms} G`);
  regressions.highSpeedReversals.push({ firstDirection, minG, maxG, tailCenteredRmsG: rms });
  checks++;
}
// Regression: holding alpha during a low-q full pull must allow the airframe's
// natural recovery before it loses elevator authority in a nearly vertical
// climb. Check a full minute so a second energy cycle cannot hide after 15 s.
{
  const type = metadata.fighters.a6m2;
  const c = await make(true, 1, { altitude: 6000, speed: 70, airframe: type.airframe, gLimit: type.gLimit });
  let maxAoA = -Infinity, maxAoA15s = -Infinity, minSpeed = Infinity;
  for (let i = 0; i < 7200; i++) {
    c.step(1); assert.ok(c.s.every(Number.isFinite));
    const aoa = c.s[15] * 180 / Math.PI;
    maxAoA = Math.max(maxAoA, aoa); minSpeed = Math.min(minSpeed, c.s[13]);
    if (i < 1800) maxAoA15s = Math.max(maxAoA15s, aoa);
    assert.equal(c.s[22], 0, 'Low-speed recovery must retain physical flight');
  }
  assert.ok(maxAoA15s < 24.65, `Low-speed pull worsens the baseline 15 s stall: ${maxAoA15s} degrees`);
  assert.ok(maxAoA < 25.6, `Repeated low-speed pull deepens its stall: ${maxAoA} degrees`);
  assert.ok(minSpeed > 15, `Low-speed protection loses effective recovery authority: ${minSpeed} m/s`);
  regressions.lowSpeedPull = { type: 'a6m2', seconds: 60, maxAoA15s_deg: maxAoA15s, maxAoA60s_deg: maxAoA, minSpeed_m_s: minSpeed };
  checks++;
}
{
  const c = await make();
  c.api.configure_envelope(3, -1.5, 0.15, -0.1);
  c.api.spawn(0, 3000, 0, 0, 140, 0);
  assert.equal(c.s[40], 3); assert.equal(c.s[79], -1.5);
  c.api.configure_envelope(NaN, NaN, Infinity, -Infinity);
  c.api.spawn(0, 3000, 0, 0, 140, 0);
  assert.equal(c.s[40], 6.5); assert.equal(c.s[79], -3);
  for (let i = 0; i < 1200; i++) { c.step(i < 600 ? 1 : -1); assert.ok(c.s.every(Number.isFinite)); }
  checks++;
}
{
  const c = await make();
  for (let i = 0; i < 120; i++) c.step(1);
  for (const flags of [1, 0, 1]) {
    c.api.configure(0, 45, 1, 6.5, flags === 1 ? 0 : 1);
    const before = c.s[24]; c.step(1, flags);
    near(c.s[24], Math.min(1, before + 3.5 * dt), 'Live switch releases the elevator immediately');
    assert.equal(c.s[53], 1); assert.equal(c.s[78], 1);
  }
  c.api.configure(0, 45, 1, 6.5, 1);
  for (let i = 0; i < 1200; i++) { c.step(i < 600 ? -1 : 1); assert.ok(c.s.every(Number.isFinite)); }
  checks++;
}
console.log(JSON.stringify({ checks, passed: true, wasm: path.resolve(wasmPath), regressions }));

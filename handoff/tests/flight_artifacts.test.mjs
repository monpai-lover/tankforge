import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../bundle/app.js.html', import.meta.url), 'utf8');
const bytes = fs.readFileSync(new URL('../flight/flight_core.wasm', import.meta.url));
const base64 = fs.readFileSync(new URL('../flight/flight_core.wasm.b64', import.meta.url), 'utf8');
const embedded = source.match(/var FLIGHT_CORE_WASM = "([^"]+)";/)?.[1];

test('delivered flight core, standalone core and canonical base64 are identical', () => {
  assert.equal(base64, bytes.toString('base64'));
  assert.equal(embedded, base64);
});

test('delivered flight ABI matches the client and has bounded memory and finite live telemetry', async () => {
  const { instance: { exports: api } } = await WebAssembly.instantiate(bytes, {
    math: { sin: Math.sin, cos: Math.cos, atan2: Math.atan2, exp: Math.exp, asin: Math.asin, acos: Math.acos },
    world: { ground: () => 0, landable: () => 1 }
  });
  const expectedVersion = Number(source.match(/api\.core_version\(\) !== (\d+)/)?.[1]);
  assert.equal(api.core_version(), expectedVersion);
  for (const name of ['configure', 'configure_control', 'configure_airframe', 'configure_envelope', 'set_damage', 'set_world', 'spawn', 'step']) {
    assert.equal(typeof api[name], 'function', `${name} missing from delivered ABI`);
  }
  assert.equal(api.state_len(), 80, 'existing telemetry offsets must remain compatible');
  assert.equal(api.memory.buffer.byteLength, 131072);
  assert.throws(() => api.memory.grow(1), RangeError, 'flight memory must remain bounded');
  api.set_world(1);
  api.configure(0, 45, 1, 6.5, 1);
  api.configure_envelope(6.5, -3, 0, 0);
  api.spawn(0, 3000, 0, 0, 140, 0);
  const state = new Float32Array(api.memory.buffer, api.state_ptr(), api.state_len());
  for (let i = 0; i < 120; i++) {
    api.step(1 / 120, 0, 0, 1, .78, -1, 0, 0, 1);
    assert.ok(state.every(Number.isFinite), `nonfinite telemetry at step ${i}`);
  }
  assert.equal(state[79], -3, 'configured negative G limit must reach telemetry');
});

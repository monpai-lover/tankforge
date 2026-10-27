import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

// Evaluate the delivered definitions without starting a browser/game. No model is
// approximated by a fixture: makeAircraft builds the actual uploaded Float32 mesh.
const file = process.env.TF_LIVE_APP || new URL('../../bundle/app.js.html', import.meta.url);
export const source = fs.readFileSync(file, 'utf8');
export const sourceHash = createHash('sha256').update(source).digest('hex');
const start = source.indexOf('(() => {') + '(() => {'.length;
const end = source.indexOf('  // client/web/src/boot.js');
assert.ok(start > 8 && end > start, 'Delivered bundle boundaries unavailable');
assert.ok(source.includes('gone(id2)') && source.includes('s.surface ? 0.6 : 1'), 'This fixture requires the actual live212 structural damage class');
export const context = {console, TextEncoder, TextDecoder, WebAssembly, atob, btoa, performance,
  setTimeout, clearTimeout, URL, URLSearchParams, Blob, Buffer, structuredClone, DecompressionStream, Response,
  document: {createElement: () => ({getContext: () => new Proxy({}, {get: () => () => {}})})}};
vm.createContext(context);
// The upgrade is exercised explicitly by the tests; the fixture isolates the
// delivered author's damage/geometry from the host's optional installation hook.
const definitions = source.slice(start, end).replace(/\binstallAircraftGeometryUpgrade\(this\);/g, '/* installed explicitly by test */');
export const bundled = vm.runInContext(`(()=>{${definitions}
  return {Aircraft, AircraftDamage, AIRCRAFT_TYPES, AIR_PIECE_PART, AIR_PIECE_CARRIER,
    airSlab, airHitbox, airHitboxQuery, airMeshPart, aircraftGeometry, Node, decodeAircraftModels, decodePilotModel};
})()`, context, {filename: 'actual-live212-aircraft-definitions.js'});
export const types = bundled.AIRCRAFT_TYPES;

let upgraded;
function owner(upgrade) {
  let definitionsOwner = bundled;
  if (upgrade) {
    if (!upgraded) {
      const actualContext = {...context};
      delete actualContext.__tfRustFlight;
      vm.createContext(actualContext);
      upgraded = vm.runInContext(`(()=>{${source.slice(start, end)} return {Aircraft, AIRCRAFT_TYPES, decodeAircraftModels, decodePilotModel};})()`, actualContext,
        {filename:'actual-live212-installed-upgrade.js'});
    }
    definitionsOwner = upgraded;
  }
  return definitionsOwner;
}
export function makeAircraft(id = 'f86f', {upgrade = false} = {}) {
  const definitionsOwner = owner(upgrade);
  const state = new Float32Array(64);
  state[6] = 1; state[33] = 1; state[35] = 100;
  const api = {memory: {buffer: state.buffer}, state_ptr: () => 0, state_len: () => state.length,
    set_damage(...v) { this.damageFlight = v; },
    step() { this.damageSeenAtStep = this.damageFlight?.slice(); },
    configure_airframe() {}, configure() {}, configure_envelope() {}, spawn() {}};
  const renderer = {mesh: data => ({count: data.length / 13, _src: {kind: 'mesh', data}}),
    freeMesh() {}, texture: () => ({}), updateTexture() {}, freeTexture() {}};
  const plane = new definitionsOwner.Aircraft(renderer, api, id);
  plane.cur.set(state); plane.prev.set(state); plane.pose(1);
  return {plane, api, renderer, state};
}

const imported = new WeakMap();
export async function makeImportedAircraft(id, {upgrade = true} = {}) {
  const definitionsOwner = owner(upgrade);
  if (!imported.has(definitionsOwner)) imported.set(definitionsOwner, (async()=>{
    const payload=JSON.parse(fs.readFileSync(new URL('./live-imported-models-212.json',import.meta.url),'utf8'));
    await definitionsOwner.decodeAircraftModels(payload.models);
    await definitionsOwner.decodePilotModel(payload.pilot);
  })());
  await imported.get(definitionsOwner);
  const made=makeAircraft(id,{upgrade});
  assert.ok(made.plane.imported&&made.plane.type.model?.buf,`${id}: actual imported source model was not decoded`);
  return made;
}

// Additional exact source-model fixtures can use the delivered registration path
// without modifying the small baseline model fixture or approximating geometry.
export async function makeDecodedAircraft(id, model, {upgrade = true} = {}) {
  await owner(upgrade).decodeAircraftModels({[id]:model});
  return makeAircraft(id,{upgrade});
}

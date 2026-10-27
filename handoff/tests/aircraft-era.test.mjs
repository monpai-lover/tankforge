import {ORIGINAL_AIRCRAFT_IDS,R7_AIRCRAFT_IDS} from './fixtures/r7-aircraft-contract.mjs';
import {aircraftPerformancePrelude} from '../tools/aircraft_performance/runtime.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../bundle/app.js.html', import.meta.url), 'utf8');
const exporter = fs.readFileSync(new URL('./export_aircraft.js', import.meta.url), 'utf8');
const catalog = JSON.parse(fs.readFileSync(new URL('../../data/aircraft/aircraft.json', import.meta.url), 'utf8'));
function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `production source boundary: ${start}`);
  return source.slice(a, b);
}
function production() {
  const context = vm.createContext({
    // Prototype damage arrays are irrelevant here. Named fighter geometry/damage/type builders
    // and AIR_FIGHTERS all run from production; no drawing or flight simulation is required.
    G4: {}, net: { room: null },
    AIR_PARTS: [], AIR_SKIN: [], AIR_PARTS_JET: [], AIR_SKIN_JET: [],
  });
  vm.runInContext(aircraftPerformancePrelude()+
    between('  var aircraftGeometry = (() => {', '  // NF-01 gear') +
    between('  var AIRCRAFT_TYPES = {', '  // Optional flight diagnostics') +
    between('    const AIR_GUN_TEXT = ', '    const hangar = ') +
    between('    function airOnlineLineup() {', '    function airOnlineLoadouts(') +
    'globalThis.api={AIR_FIGHTERS,AIRCRAFT_TYPES,AIR_HANGAR,fighterType,airTypeInfo,airOnlineLineup};', context);
  return context;
}
function lineup(context, era) {
  context.net.room = { era };
  return context.api.airOnlineLineup();
}

test('actual fighterType nests metadata and the real lineup enforces room years inclusively', () => {
  const c = production(), entries = Object.entries(c.api.AIR_FIGHTERS);
  assert.deepEqual(entries.map(([id])=>id).sort(),R7_AIRCRAFT_IDS.filter(id=>!['nf01','nf02'].includes(id)));
  for (const [id, fighter] of entries) {
    assert.equal(c.api.AIRCRAFT_TYPES[id].fighter, fighter);
    assert.equal(c.api.AIRCRAFT_TYPES[id].era, undefined);
    assert.equal(c.api.airTypeInfo(id).era, fighter.era);
  }
  const koreanEra = lineup(c, [1950, 1953]);
  assert.equal(koreanEra.find(x => x.id === 'air:f86f').usable, true);
  assert.equal(koreanEra.find(x => x.id === 'air:f16v').usable, false);
  assert.equal(koreanEra.find(x => x.id === 'air:f16v').year, Number(c.api.AIR_FIGHTERS.f16v.era));
  for (const item of koreanEra) {
    const expected = Number(c.api.AIR_FIGHTERS[item.id.slice(4)].era);
    assert.equal(item.year, expected);
    assert.equal(item.usable, expected >= 1950 && expected <= 1953, item.id);
  }
  assert.equal(lineup(c, [1952, 1952]).find(x => x.id === 'air:f86f').usable, true);
  assert.equal(lineup(c, [1954, 1960]).find(x => x.id === 'air:f86f').usable, false);
  assert.equal(lineup(c,[1944,1944]).find(x=>x.id==='air:me262a2a').usable,true);
  assert.equal(lineup(c,[1944,1944]).find(x=>x.id==='air:me262u4').usable,false);
  assert.equal(lineup(c,[1945,1945]).find(x=>x.id==='air:me262u4').usable,true);
});

test('missing or invalid aircraft years fail closed only in an era-limited room', () => {
  const c = production();
  for (const value of [undefined, null, '', 'unknown', '1953extra', '1953.5', '19e2', 0, NaN, Infinity, 1953.5, 1899, 2101, {}, true]) {
    c.api.AIR_FIGHTERS.f86f.era = value;
    // A stale top-level property must never override the actual fighter metadata.
    c.api.AIRCRAFT_TYPES.f86f.era = '1953';
    const restricted = lineup(c, [1900, 2100]).find(x => x.id === 'air:f86f');
    assert.equal(restricted.year, null, `invalid year ${String(value)}`);
    assert.equal(restricted.usable, false, `invalid year ${String(value)}`);
    assert.ok(restricted.why);
    assert.equal(lineup(c, null).find(x => x.id === 'air:f86f').usable, true);
  }
});

test('legacy unrestricted hangar retains its original24 named fighters; native server pool has its separate complete catalog', () => {
  const c = production();
  c.api.AIR_HANGAR.push(['test entries', ['nf01', 'nf02']]);
  const all = lineup(c, null);
  assert.deepEqual(Array.from(all,x=>x.id.slice(4)).sort(),ORIGINAL_AIRCRAFT_IDS.filter(id=>!['nf01','nf02'].includes(id)));
  assert.ok(all.every(x => x.usable && x.why === ''));
  assert.ok(!all.some(x => x.id === 'air:nf01' || x.id === 'air:nf02'));
});

test('actual exporter and committed server catalog copy original24 plus two inherited production years; prototypes stay unknown', async () => {
  const c = production(), G = { airLoadout: {} }, chunks = [];
  const x = {
    AIRCRAFT_TYPES: c.api.AIRCRAFT_TYPES, AIR_STORE_DEFS: {}, flightCoreP: Promise.resolve(),
    exitAircraft: () => { G.air = null; }, aircraftGuns: () => [], airLoadouts: () => [],
  };
  const tf = { G, coreReady: async () => {}, pause: () => {}, finishThumbs: () => {}, advance: () => {} };
  const context = vm.createContext({ window: { __tf: tf, __tfx: x }, setTimeout,
    document: { querySelector: selector => ({ click: () => {
      const id = selector.match(/data-air=([^\]]+)/)[1];
      G.air = { active: true, plane: { type: x.AIRCRAFT_TYPES[id], damage: { parts: [], skin: [] } } };
    } }) },
    console: { log: line => { if (line.startsWith('@@JSON ')) chunks.push(line.replace(/^@@JSON \d+ /, '')); } },
  });
  await vm.runInContext(`(async()=>{${exporter}\n})()`, context);
  const exported = JSON.parse(chunks.join(''));
  assert.deepEqual(Object.keys(exported.types).sort(),R7_AIRCRAFT_IDS);
  for (const [id, fighter] of Object.entries(c.api.AIR_FIGHTERS)) {
    assert.equal(exported.types[id].year, Number(fighter.era), `exporter ${id}`);
    assert.equal(catalog.types[id].year, exported.types[id].year, `committed catalog ${id}`);
  }
  for (const id of ['nf01', 'nf02']) {
    assert.equal(Object.hasOwn(exported.types[id], 'year'), false);
    assert.equal(Object.hasOwn(catalog.types[id], 'year'), false);
  }
});

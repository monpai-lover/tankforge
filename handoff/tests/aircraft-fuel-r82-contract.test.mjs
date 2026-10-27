import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import * as contract from './fixtures/r8-aircraft-contract.mjs';

const helper=fs.readFileSync(new URL('../tools/aircraft_fuel_load.js',import.meta.url),'utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
const normalize=value=>{
  assert.equal(typeof contract.normalizeReviewedFullThrottleFuelSource,'function',
    'R8.2 must prove an exact source-bound migration back to the unchanged historical fuel helper');
  return contract.normalizeReviewedFullThrottleFuelSource(value);
};
test('reviewed R8.2 full-throttle helper proves the frozen R8.1 helper and R7 controller bytes',()=>{
  const prior=normalize(helper);
  assert.equal(sha(helper),'41469e40501e58992631f7a7a57d94a8ffd9628526e0182d15c50a8f5c00deb4');
  assert.equal(sha(prior),'3ca46ffe6a6c202d831f382859b6a40c5433705075cc19e1e309e41a2ea2f5a5');
  const a=prior.indexOf('  function html('),b=prior.indexOf('  function create(');
  assert.equal(sha(prior.slice(0,a)+prior.slice(b)),'bf11fb5bcc0c2602d411a59fb41fe6e0979ce5f20d378656089ee70c7a2cecf5');
});
test('fuel migration refuses unreviewed reference, units, capacity, storage and controller changes',()=>{
  // Establish that the normalizer exists before checking rejection behavior.
  normalize(helper);
  for(const [before,after] of [
    ['flow(1)','flow(.99)'],
    ['selected_minutes*60*source.nominalFlowKgS','selected_minutes*59*source.nominalFlowKgS'],
    ['Math.min(source.capacityKg,requested)','requested'],
    ["key='tf.airFuelMinutes.v1'","key='tf.airFuelMinutes.v2'"],
    ['capability.reference_throttle===1','capability.reference_throttle>=.65'],
    ['if(!fresh)return air.fuel;','if(false)return air.fuel;'],
    ['100% dry throttle','99% dry throttle']
  ]){
    assert.ok(helper.includes(before),before);
    assert.throws(()=>normalize(helper.replace(before,after)),/reviewed|exact|R8.2/i,before);
  }
});
test('the admitted migration uses exactly 100 percent dry-throttle flow and rejects the old host reference',()=>{
  normalize(helper);
  const context=vm.createContext({});vm.runInContext(helper,context);
  const api=context.TFAircraftFuelLoad,observed=[],source=api.spec(10000,throttle=>{observed.push(throttle);return .5+throttle;});
  assert.deepEqual(observed,[1]);assert.equal(source.referenceThrottle,1);
  assert.equal(api.load(source,10).kg,900);
  assert.equal(JSON.stringify(api.intent({airFuelMinutes:{f16v:10}},'f16v',{version:1,reference_throttle:.65})),'{}');
  assert.equal(JSON.stringify(api.intent({airFuelMinutes:{f16v:10}},'f16v',{version:1,reference_throttle:1})),JSON.stringify({fuel_minutes:10}));
});

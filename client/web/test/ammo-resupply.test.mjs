import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as api from '../src/game/ammoResupply.js';
const p = {id:'A',x:0,z:0,r:45,owner:'blue',progress:1,blue:1,red:0};
const actor = {team:'blue',x:45,z:0,alive:true,deployed:true,connected:true,active:true};
const requireApi = () => { for (const name of ['newResupplyState','eligiblePoint','stepResupply']) assert.equal(typeof api[name], 'function', `${name} implements capture-point policy`); };

test('shared ammo policy stays independent of gameplay mode version', () => {
  const path = new URL('../../../config/ammo-resupply.json', import.meta.url);
  assert.ok(fs.existsSync(path), 'shared ammo policy exists');
  assert.deepEqual(JSON.parse(fs.readFileSync(path)), {ammo_protocol_version:1,resupply_seconds:5,pose_max_age_seconds:1});
});
test('five continuous seconds grants once and overlap never multiplies dwell', () => {
  requireApi(); const s = api.newResupplyState();
  assert.equal(api.eligiblePoint([p,{...p,id:'B'}],actor),'A');
  assert.deepEqual(api.stepResupply(s,4.75,true,true),{progress:.95,complete:false});
  assert.deepEqual(api.stepResupply(s,.25,true,true),{progress:1,complete:true});
  assert.equal(s.elapsed,0);
});
test('enemy neutral partial contested and outside points cannot resupply', () => {
  requireApi();
  for (const bad of [{owner:null},{owner:'red'},{progress:.999},{red:1},{x:-.001}])
    assert.equal(api.eligiblePoint([{...p,...bad}],{...actor}),null);
  for (const flag of ['alive','deployed','connected','active'])
    for (const value of [false,0,1,'true',null]) assert.equal(api.eligiblePoint([p],{...actor,[flag]:value}),null,flag);
  for (const bad of [{x:45.001},{x:NaN},{z:Infinity},{team:'neutral'}]) assert.equal(api.eligiblePoint([p],{...actor,...bad}),null);
  assert.equal(api.eligiblePoint([{...p,owner:'red',progress:-1,blue:0,red:1}],{...actor,team:'red'}),'A');
});
test('exit and full stock reset dwell; invalid elapsed input is rejected', () => {
  requireApi(); const s=api.newResupplyState();
  api.stepResupply(s,4,true,true); api.stepResupply(s,.1,false,true);
  assert.deepEqual(api.stepResupply(s,1,true,true),{progress:.2,complete:false});
  api.stepResupply(s,4,true,false); assert.equal(s.elapsed,0);
  for(const dt of [-1,NaN,Infinity,'1']) assert.throws(()=>api.stepResupply(s,dt,true,true));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {runtime} from './live-network-rig.mjs';
import {loadData} from '../tools/load-data.mjs';
import {newShot} from '../src/sim/ballistics.js';
import {bulletShell} from '../src/game/combat.js';
import {TestRange} from '../src/game/testrange.js';
const data=loadData();
function rig(){const beams=[],fx=new Proxy({beam(...a){beams.push(a);}}, {get:(o,k)=>o[k]||(()=>{})});return {r:runtime('casual',{combat:null,fx}),beams};}

test('actual main cannon flight draws a luminous tracer only when the round explicitly carries one',()=>{
  const {r,beams}=rig();r.G.mode='battle';const shell=data.projectiles.aphe_122_br471;
  const record=tracer=>({shell:{...shell,tracer},s:newShot([0,30,0],[0,0,1],shell),age:0,origin:[0,30,0],travelled:0});
  r.G.shots=[record(false)];r.live.updateShots(1/120);assert.equal(beams.length,0);assert.equal(r.G.shots.length,1,'nontracer body remains in the live projectile owner');
  r.G.shots=[record(true)];r.live.updateShots(1/120);assert.equal(beams.length,1);
});

test('actual main MG flight keeps the per-round tracer decision',()=>{
  const {r,beams}=rig(),def=data.machineGuns.mg34,shell=bulletShell(def);r.G.mode='battle';
  const record=tracer=>({def,tracer,s:newShot([0,30,0],[0,0,1],shell),age:0,travelled:0});
  r.G.bullets=[record(false)];r.live.updateBullets(1/120);assert.equal(beams.length,0);
  r.G.bullets=[record(true)];r.live.updateBullets(1/120);assert.equal(beams.length,1);
});

test('actual design TestRange live flight uses the same explicit tracer boundary',()=>{
  const beams=[],shell=data.projectiles.aphe_122_br471,record=tracer=>({shell:{...shell,tracer},s:newShot([0,30,0],[0,0,1],shell),age:0,origin:[0,30,0],travelled:0,path:[{t:0,p:[0,30,0]}]});
  const range=Object.assign(Object.create(TestRange.prototype),{shots:[record(false)],zoom:0,env:{G:{model:{width:2,length:6,height:3},camPos:[0,0,0]},pose:()=>({pos:[0,0,500],heading:0}),fx:{beam(...args){beams.push(args);}}}});
  range.step(1/120);assert.equal(beams.length,0);range.shots=[record(true)];range.step(1/120);assert.equal(beams.length,1);
});

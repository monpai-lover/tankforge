import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const helper=new URL('../tools/frontline_gun_tracer_visual.js',import.meta.url);
function fixture(options={}){
  assert.ok(fs.existsSync(helper),'accepted native gun tracer visual helper must exist');
  const context=vm.createContext({console,Map,Set,Object,Array,Number,Math});
  vm.runInContext(fs.readFileSync(helper,'utf8')+'\nglobalThis.factory=createFrontlineGunTracerVisual;',context);
  const beams=[],fx={beam(...args){beams.push(args);}};
  return {owner:context.factory({fx,...options}),beams,factory:context.factory};
}
const reference=(battle=7,life=1)=>({battle,unit:23,life});
function row(overrides={}){
  return {shot_id:1,shooter:reference(),team:0,projectile_id:'hei_20_m56',pos:[0,30,100],velocity:[0,0,1200],age:.2,color:[1,.6,.25],caliber_mm:20,style:'bullet',...overrides};
}
const near=(actual,expected,tolerance=1e-8)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);

test('accepted native tracers submit the offline bullet beam on every draw without mutating the snapshot',()=>{
  const {owner,beams}=fixture(),sample=row(),before=JSON.stringify(sample);
  assert.equal(owner.accept([sample],{battle:7,tick:1}),true);
  owner.step(0,[0,30,0]);owner.step(0,[0,30,0]);
  assert.equal(beams.length,2,'Effects.build consumes beams, so every draw must resubmit');
  assert.deepEqual(Array.from(beams[0][0]),[0,30,73.6]);
  assert.deepEqual(Array.from(beams[0][1]),sample.pos);
  near(beams[0][2],.02+100*.0011);assert.deepEqual(Array.from(beams[0][3]),sample.color);assert.equal(beams[0][4],.9);
  assert.equal(JSON.stringify(sample),before);
  owner.step(.01,[0,30,0]);assert.deepEqual(Array.from(beams[0][1]),sample.pos,'queued beam arrays retain their original coordinates');
  assert.equal(owner.stats.live,1);
});

test('shell style honors accepted width scaling and color without guessing projectile kind',()=>{
  const {owner,beams}=fixture();
  owner.accept([row({style:'shell',width_scale:1.2,color:[.2,.4,1],age:.005})],{battle:7,tick:1});
  owner.step(0,[0,30,0]);
  near(beams[0][2],(.05+100*.0016)*1.2);assert.equal(beams[0][4],.95);
  assert.deepEqual(Array.from(beams[0][3]),[.2,.4,1]);near(beams[0][1][2]-beams[0][0][2],6);
});

test('1200 metre per second accepted samples stay continuous between 20 Hz frames',()=>{
  const {owner,beams}=fixture();owner.accept([row({pos:[0,30,0]})],{battle:7,tick:10});
  for(let i=0;i<5;i++)owner.step(.01,[0,30,-100]);
  near(beams.at(-1)[1][2],60);
  owner.accept([row({pos:[0,30,60],age:.25})],{battle:7,tick:11});
  for(let i=0;i<5;i++)owner.step(.01,[0,30,-100]);
  for(let i=0;i<beams.length;i++)near(beams[i][1][2],12*(i+1));
});

test('a new accepted sample blends the displayed correction and velocity over the snapshot interval',()=>{
  const {owner,beams}=fixture();owner.accept([row({pos:[0,30,0],velocity:[0,0,1000]})],{battle:7,tick:1});
  owner.step(.04,[0,30,-100]);near(beams.at(-1)[1][2],40);
  owner.accept([row({pos:[0,30,45],velocity:[0,0,900],age:.25})],{battle:7,tick:2});
  owner.step(.025,[0,30,-100]);near(beams.at(-1)[1][2],65);
  near(beams.at(-1)[1][2]-beams.at(-1)[0][2],950*.022);
  owner.step(.025,[0,30,-100]);near(beams.at(-1)[1][2],90);
});

test('prediction stops at 100 ms and stale samples stop drawing after 200 ms',()=>{
  const {owner,beams}=fixture();owner.accept([row({pos:[0,30,0]})],{battle:7,tick:1});
  owner.step(.1,[0,30,-100]);near(beams.at(-1)[1][2],120);
  owner.step(.05,[0,30,-100]);near(beams.at(-1)[1][2],120);
  const count=beams.length;owner.step(.051,[0,30,-100]);assert.equal(beams.length,count);
  owner.accept([row({pos:[0,30,240],age:.4})],{battle:7,tick:5});owner.step(0,[0,30,-100]);
  assert.equal(beams.length,count+1);near(beams.at(-1)[1][2],240);
});

test('absence in the newest accepted snapshot terminates a tracer immediately',()=>{
  const {owner,beams}=fixture();owner.accept([row()],{battle:7,tick:1});owner.step(.01,[0,30,0]);
  owner.accept([],{battle:7,tick:2});const count=beams.length;owner.step(.01,[0,30,0]);
  assert.equal(beams.length,count);assert.equal(owner.stats.live,0);
});

test('old ticks and battles cannot revive removed traces or replace the current battle',()=>{
  const {owner,beams}=fixture();owner.accept([row()],{battle:7,tick:10});owner.accept([],{battle:7,tick:11});
  assert.equal(owner.accept([row()],{battle:7,tick:10}),false);owner.step(0,[0,0,0]);assert.equal(beams.length,0);
  assert.equal(owner.accept([row({shooter:reference(8)})],{battle:8,tick:0}),true);
  assert.equal(owner.accept([row()],{battle:7,tick:999}),false);owner.step(0,[0,0,0]);assert.equal(beams.length,1);
  assert.equal(owner.stats.staleFrames,2);
});

test('a shot cannot change shooter life or accept a foreign battle reference',()=>{
  const {owner,beams}=fixture();owner.accept([row()],{battle:7,tick:1});
  assert.equal(owner.accept([row({shooter:reference(7,2)})],{battle:7,tick:2}),false);
  owner.step(0,[0,0,0]);assert.equal(beams.length,0,'identity corruption fails closed');
  assert.equal(owner.accept([row({shooter:reference(8)})],{battle:7,tick:3}),false);
  assert.equal(owner.stats.live,0);
});

test('invalid native samples and duplicate shot identities fail closed',()=>{
  for(const invalid of [row({pos:[NaN,0,0]}),row({velocity:[0,Infinity,0]}),row({age:-1}),row({style:'missile'}),row({color:[1,2,0]}),row({caliber_mm:0}),row({width_scale:-1})]){
    const {owner,beams}=fixture();owner.accept([row()],{battle:7,tick:1});assert.equal(owner.accept([invalid],{battle:7,tick:2}),false);
    owner.step(0,[0,0,0]);assert.equal(beams.length,0);
  }
  const {owner}=fixture();assert.equal(owner.accept([row(),row()],{battle:7,tick:1}),false);
});

test('the owner bounds retained records and submitted beams to its configured capacity',()=>{
  const {owner,beams}=fixture({maxEntries:2});
  owner.accept([row(),row({shot_id:2}),row({shot_id:3})],{battle:7,tick:1});owner.step(0,[0,0,0]);
  assert.equal(owner.stats.live,2);assert.equal(owner.stats.capped,1);assert.equal(beams.length,2);
});

test('large map translations preserve world-space beam shape and camera-relative width',()=>{
  const result=[];
  for(const offset of [[0,0,0],[250000,3000,-350000]]){
    const translate=p=>p.map((v,k)=>v+offset[k]),{owner,beams}=fixture();
    owner.accept([row({pos:translate([.123456,30.654321,100.987654]),velocity:[1.25,-2.5,1200]})],{battle:7,tick:1});
    owner.step(.016,translate([.5,29,-10]));
    result.push(beams[0].map((value,k)=>k<2?Array.from(value,(v,i)=>v-offset[i]):k===3?Array.from(value):value));
  }
  for(let k=0;k<2;k++)for(let i=0;i<3;i++)near(result[0][k][i],result[1][k][i]);
  near(result[0][2],result[1][2]);assert.deepEqual(result[0][3],result[1][3]);
});

test('clear resets admission and dispose stops subsequent snapshots and draws',()=>{
  const {owner,beams}=fixture();owner.accept([row()],{battle:7,tick:1});owner.clear();owner.step(.01,[0,0,0]);assert.equal(beams.length,0);
  assert.equal(owner.accept([row({shooter:reference(2)})],{battle:2,tick:0}),true);owner.dispose();owner.dispose();
  assert.equal(owner.stats.live,0);assert.equal(owner.accept([row()],{battle:7,tick:1}),false);assert.equal(owner.step(.01,[0,0,0]),false);
});

test('native travelled distance caps the exact young beam tail rather than speed times age',()=>{
  const {owner,beams}=fixture();
  owner.accept([row({distance_m:3,age:1})],{battle:7,tick:1});owner.step(0,[0,30,0]);
  near(beams[0][1][2]-beams[0][0][2],3);
  owner.step(.01,[0,30,0]);near(beams[1][1][2]-beams[1][0][2],15);
  assert.equal(owner.accept([row({distance_m:-1})],{battle:7,tick:2}),false);
});
test('fresh network samples use receipt time when a drawn frame spans many GPU-skipped callbacks',()=>{
  let now=10;const {owner,beams}=fixture({nowSeconds:()=>now});
  owner.accept([row({pos:[0,30,0]})],{battle:7,tick:1});
  now+=.05;owner.accept([row({pos:[0,30,60],age:.25})],{battle:7,tick:2});
  now+=.05;owner.accept([row({pos:[0,30,120],age:.3})],{battle:7,tick:3});
  now+=.01;owner.step(.8,[0,30,-100]);
  assert.equal(beams.length,1,'a fresh sample must remain visible despite a long interval since the last GPU draw');
  near(beams[0][1][2],132);
  now+=.21;owner.step(.001,[0,30,-100]);assert.equal(beams.length,1,'receipt age still expires during a delayed network');
});
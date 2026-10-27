import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const text=fs.readFileSync(new URL('../tools/frontline_guided_control.js',import.meta.url),'utf8');
function fixture(guidance='sarh'){
  const c={};vm.runInNewContext(text,c);const ref={battle:9,unit:4,life:2},target={unitRef:{battle:9,unit:8,life:1},bot:{plane:{}}},ground={unitRef:{battle:9,unit:10,life:3},enemy:{name:'tank'}},known=[target,ground],messages=[];
  const def={kind:'aam',guidance,burn:3},item={id:'test',def,count:2,gone:false};
  const air={active:true,plane:{type:{id:'test'},cur:new Float32Array(80)},stores:{items:[item]},ctl:{seeker:{state:'off',target:null,cand:null},radar:{on:true,stt:{state:'track',target}},pod:null,selected:target}},unit={unit:ref,weapon_control:{store_id:'test',store_index:null},seeker:{enabled:false,radar:false,status:'off',target:null,reason:null,progress_s:0}};
  const api=c.createFrontlineGuidedControl({group:()=>({id:'test',def,items:item.gone?[]:[item]}),resolve:v=>known.find(t=>JSON.stringify(t.unitRef)===JSON.stringify(v?.unitRef||v))||null,targets:()=>known,reason:(a,s)=>{messages.push(s);return false;},activate:a=>{a.ctl.seeker.state='prep';},pod:a=>a.ctl.pod,podTrack:a=>{a.ctl.pod.state='acq';a.ctl.pod.target=ground;return true;},capture:a=>{a.ctl.seeker.cand=ground;a.ctl.seeker.state='capturing';return true;},cancel:a=>{a.ctl.seeker.target=null;a.ctl.seeker.state='search';a.ctl.radio=null;},nose:()=>[0,0,1]});
  api.accept(air,unit,[]);return{api,air,unit,target,ground,item,def,known,messages};
}
const plain=v=>JSON.parse(JSON.stringify(v));
test('intent uses actual sensor switches and exact admitted UnitRef without coordinates',()=>{
  const f=fixture();f.api.action(f.air,f.unit,'seekerPower');const value=plain(f.api.intent(f.air,f.unit));
  assert.deepEqual(value,{enabled:true,radar:true,target:f.target.unitRef,laser:false,ecm:false,manual:[0,0]});assert.equal(f.item.gone,false);assert.equal(f.item.count,2);
  f.known.length=0;assert.equal(f.api.intent(f.air,f.unit).target,null);
});
test('native fire sets release intent and never spends a store or creates local ordnance',()=>{
  const f=fixture('ir');f.api.action(f.air,f.unit,'fire',1);assert.equal(f.air.storeTap,true);assert.equal(f.item.gone,false);assert.equal(f.item.count,2);
});
test('Space activates then releases only through native accepted ready/track status',()=>{
  const f=fixture('ir');f.api.action(f.air,f.unit,'space',1);assert.equal(f.api.intent(f.air,f.unit).enabled,true);assert.notEqual(f.air.storeTap,true);
  f.unit.seeker={enabled:true,radar:false,status:'track',target:f.target.unitRef,progress_s:1.2,reason:null};f.api.accept(f.air,f.unit,[]);f.api.action(f.air,f.unit,'space',2);assert.equal(f.air.storeTap,true);
});
test('accepted status/progress/reason drives existing seeker fields and cannot be forged by local prediction',()=>{
  const f=fixture();f.unit.seeker={enabled:true,radar:true,status:'capturing',target:f.target.unitRef,progress_s:.8,reason:'preparing'};f.api.accept(f.air,f.unit,[]);
  assert.equal(f.air.ctl.seeker.state,'capturing');assert.equal(f.air.ctl.seeker.t,.8);assert.equal(f.air.ctl.seeker.target,f.target);assert.match(f.air.ctl.seeker.why,/preparing/);
  f.air.ctl.seeker.state='track';f.api.project(f.air,f.unit);assert.equal(f.air.ctl.seeker.state,'capturing');
});
test('last-store depletion and seeker cancel preserve independent radar support request',()=>{
  const f=fixture();f.api.action(f.air,f.unit,'seekerPower');f.item.gone=true;f.air.ctl.seeker.state='off';assert.equal(f.api.intent(f.air,f.unit).enabled,true);
  f.api.action(f.air,f.unit,'cancel');const value=plain(f.api.intent(f.air,f.unit));assert.equal(value.enabled,false);assert.equal(value.radar,true);assert.deepEqual(value.target,f.target.unitRef);
});
test('pod tracking, existing ECM switch and ground references feed laser/ECM intent',()=>{
  const f=fixture('laser');f.def.kind='agm';f.air.ctl.radar=null;f.air.ctl.pod={state:'free',cfg:{laser:true}};f.air.stores.items.push({def:{kind:'ecm',jam:.5},gone:false});
  f.api.action(f.air,f.unit,'space');const v=plain(f.api.intent(f.air,f.unit));assert.equal(v.enabled,true);assert.equal(v.laser,true);assert.equal(v.ecm,true);assert.deepEqual(v.target,f.ground.unitRef);
  f.air.ecmOff=true;assert.equal(f.api.intent(f.air,f.unit).ecm,false);
});
test('radio input maps mouse right/up to validated native pitch/yaw, with lifecycle reset',()=>{
  const f=fixture('radio');f.api.accept(f.air,f.unit,[{shot_id:1,shooter:4,store_id:'test',phase:'radio'}]);assert.ok(f.air.ctl.radio?.native);
  f.api.radioSteer(f.air,100,-50,0);assert.deepEqual(plain(f.api.intent(f.air,f.unit).manual),[.2,.4]);
  f.api.radioSteer(f.air,Infinity,NaN,.01);assert.deepEqual(plain(f.api.intent(f.air,f.unit).manual),[.2,.4]);
  f.api.accept(f.air,f.unit,[]);assert.deepEqual(plain(f.api.intent(f.air,f.unit).manual),[0,0]);assert.equal(f.air.ctl.radio,null);
});
test('new life and explicit clear cannot carry seeker or manual intents across ownership',()=>{
  const f=fixture();f.api.action(f.air,f.unit,'seekerPower');f.api.clear();f.unit={...f.unit,unit:{...f.unit.unit,life:3}};f.api.accept(f.air,f.unit,[]);assert.equal(f.api.intent(f.air,f.unit).enabled,false);
});

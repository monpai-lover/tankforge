import fs from 'node:fs';import vm from 'node:vm';import test from 'node:test';import assert from 'node:assert/strict';
const s=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const cut=(a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);assert.ok(i>=0&&j>i);return s.slice(i,j);};
const calls={tone:[],views:[],cancel:0},c=vm.createContext({airCtl:a=>a.ctl,storeGroup:st=>st?.group,noseOf:()=>[0,0,1],seekerOf:()=>({prep:1}),L10N:(_,en)=>en,airReason:(a,m)=>(a.reason=m,false),airCancel:()=>calls.cancel++,seekerTone:v=>calls.tone.push(v),setAirView:(a,v)=>{a.ctl.view=v;a.ctl.sensor=null;calls.views.push(v);},G4:{},localStorage:{getItem:()=>'{"fire":"Mouse1"}'}});
vm.runInContext(cut('    function seekerReset(sk, def = null) {','    const airVelOf = ')+cut('    function seekerOff(air) {','    function seekerCancel(air) {')+cut('    const AIR_ACTIONS = [','    /** Weapon and sensor input is taken')+'globalThis.api={seekerPower,seekerOff,actionFor,AIR_ACTIONS};',c);
const fixture=()=>{const def={kind:'aam'},radar={on:true,stt:{id:'radar-target'}},pod={state:'track'};return{ctl:{seeker:{state:'off',def},seekerBy:new Map(),view:'third',radar,pod},plane:{},stores:{group:{def,items:[{count:1}]}},storeHeld:false};};
test('the seeker power action has a visible rebindable default and preserves existing saved bindings',()=>{assert.equal(c.api.actionFor('Shift+KeyX'),'seekerPower');assert.equal(c.api.actionFor('Mouse1'),'fire');assert.ok(c.api.AIR_ACTIONS.find(a=>a[0]==='seekerPower'&&a[1]==='Shift+KeyX'));});
test('seeker power closes every active state, clears remembered capture and stops sound without touching radar or pod',()=>{
 for(const state of ['prep','ready','search','capturing','track','memory']){
  const a=fixture(),sk=a.ctl.seeker,rd=a.ctl.radar,pod=a.ctl.pod;Object.assign(sk,{state,target:{id:'seeker-target'},cand:{},est:{},look:[1,2,3]});a.ctl.seekerBy.set(sk.def,{...sk});c.api.seekerPower(a);
  assert.equal(sk.state,'off',state);for(const k of ['target','cand','est','look'])assert.equal(sk[k],null,k);assert.equal(a.ctl.seekerBy.size,0);assert.equal(a.ctl.radar,rd);assert.equal(a.ctl.pod,pod);assert.equal(rd.on,true);assert.equal(pod.state,'track');assert.equal(a.storeHeld,false);
 }
 assert.ok(calls.tone.length>=6);assert.ok(calls.tone.every(v=>v===null));
});
test('seeker power enables preparation without firing and closes an imaging view cleanly',()=>{
 const a=fixture();c.api.seekerPower(a);assert.equal(a.ctl.seeker.state,'prep');assert.equal(a.storeHeld,false);
 a.ctl.view=a.ctl.sensor='seeker';c.api.seekerPower(a);assert.equal(a.ctl.view,'third');assert.equal(a.ctl.sensor,null);assert.equal(a.ctl.seeker.state,'off');
});
test('no guided weapon or an empty station cannot turn on a seeker or cancel an unrelated track',()=>{
 for(const st of [null,{group:{def:{kind:'bomb'},items:[{}]}},{group:{def:{kind:'aam'},items:[]}}]){const a=fixture();a.stores=st;c.api.seekerPower(a);assert.equal(a.ctl.seeker.state,'off');assert.equal(a.ctl.pod.state,'track');}
 assert.equal(calls.cancel,0);
});

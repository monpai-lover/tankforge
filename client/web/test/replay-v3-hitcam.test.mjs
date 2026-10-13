import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {HitCam} from '../src/game/hitcam.js';
import {Node} from '../src/gfx/math.js';
import {loadData} from '../tools/load-data.mjs';
const catalog=loadData(),receipt=JSON.parse(fs.readFileSync(process.env.TG_REPLAY_NETWORK_RECEIPT||new URL('../../../target/replay-network-r5-20261013.json',import.meta.url))),es=receipt.phases.filter(p=>p.name==='gap_1_3_late_2_fatal_older_cause').map(p=>p.recipients.find(q=>q.message.replay).message.replay);
function fixture(){let retain=0;const calls=[],renderer={mesh:data=>({data}),freeMesh(){},retainMesh(){retain++;},releaseMesh(){retain--;},renderInset(nodes,cam,rect,opts){calls.push({nodes,cam,rect,opts});}},hull=new Node('hull');hull.mesh={};hull.kind=9;hull.update();const elements=new Map(),root={style:{},dataset:{},querySelector(k){if(!elements.has(k))elements.set(k,{style:{},dataset:{}});return elements.get(k);}},target={model:{root:hull,shellNodes:[hull]},body:{worldPoint:p=>p.slice(),worldDir:p=>p.slice()},name:'native',length:6,actor:es[0].actor,interior:()=>null},hc=new HitCam({renderer,root,catalog});return {hc,target,calls,retains:()=>retain};}
test('actual native offensive reports append through HitCam without replacing target, resetting clock or suppressing MG',()=>{
  const f=fixture(),one={...es[0].report,replay:es[0]},three={...es[2].report,replay:es[2]};f.hc.show(f.target,one,catalog.projectiles.apcbc_88_l56,100);const target=f.hc.cur.target;f.hc.tick(.5);const t=f.hc.cur.t;f.hc.show(f.target,three,catalog.projectiles.apcbc_88_l56,100,true);
  assert.equal(f.hc.cur.target,target);assert.equal(f.hc.cur.t,t);assert.equal(f.retains(),1);assert.equal(f.hc.cur.session.diagnostics().events,2);
});
test('native fatal promotion owns full and corner V3 views from one prepared frame; outgoing cannot replace it',()=>{
  const f=fixture();assert.equal(typeof f.hc.showVictim,'function');f.hc.show(f.target,{...es[0].report,replay:es[0]},catalog.projectiles.apcbc_88_l56,100);
  const target=f.hc.cur.target;f.hc.showVictim(f.target,es[3],catalog.projectiles.apcbc_88_l56);assert.equal(f.hc.cur.target,target);assert.equal(f.hc.victimActive,true);
  const other={...f.target,actor:{...es[0].actor,entity:99}};f.hc.show(other,{...es[2].report,replay:{...es[2],actor:other.actor}},catalog.projectiles.apcbc_88_l56,100);
  assert.equal(f.hc.cur.target,target);assert.equal(f.hc.deferred.length,0,'outgoing feedback cannot schedule a view after active victim playback');f.hc.render3d({cw:1280,ch:720,scale:1,nodes:[],frameId:42});assert.equal(f.calls.length,2);assert.equal(f.calls[0].opts.frame,f.calls[1].opts.frame);assert.deepEqual(f.calls[0].rect,[0,0,1280,720]);
  assert.notDeepEqual(f.calls[0].cam.viewProj,f.calls[1].cam.viewProj);f.hc.draw2d(new Proxy({}, {get(){return()=>{throw Error('legacy outline draw');};}}),{scale:1});
});

test('actual replay renderer failure finishes victim playback and releases its snapshot once',()=>{
  const f=fixture();let finished=0;f.hc.env.onFinish=()=>finished++;f.hc.showVictim(f.target,es[3],catalog.projectiles.apcbc_88_l56);assert.equal(f.hc.victimActive,true);
  f.hc.env.renderer.renderInset=()=>{throw Error('inset unavailable');};
  assert.doesNotThrow(()=>f.hc.render3d({cw:1280,ch:720,scale:1,nodes:[],frameId:88}));assert.equal(f.hc.active,false);assert.equal(f.retains(),0);assert.equal(finished,1);
  f.hc.hide();assert.equal(finished,1);
});

test('queued consecutive native hits retain their records in one target session after another offensive playback',()=>{
  const f=fixture();f.hc.show(f.target,{...es[0].report,replay:es[0]},catalog.projectiles.apcbc_88_l56,100);
  const other={...f.target,actor:{...es[0].actor,entity:99}};
  for(const raw of es.slice(0,3)){const e={...raw,actor:other.actor};f.hc.show(other,{...e.report,replay:e},catalog.projectiles.apcbc_88_l56,100);}
  assert.equal(f.hc.deferred.length,1);f.hc.tick(f.hc.cur.total+1);
  assert.equal(f.hc.cur.session.actor.entity,99);assert.deepEqual(f.hc.cur.session.events.map(e=>e.id),es.slice(0,3).map(e=>e.event_id));
  assert.equal(f.retains(),1);f.hc.hide();assert.equal(f.retains(),0);
});

test('valid same-victim late history appends after fatal promotion without entering another-target queue',()=>{
  const f=fixture();f.hc.showVictim(f.target,es[3],catalog.projectiles.apcbc_88_l56);const target=f.hc.cur.target,clock=f.hc.cur.session.clock;
  assert.equal(f.hc.show(f.target,{...es[1].report,replay:es[1]},catalog.projectiles.apcbc_88_l56,100,false,'','offensive'),true);
  assert.equal(f.hc.victimActive,true);assert.equal(f.hc.cur.target,target);assert.equal(f.hc.cur.session.clock,clock);assert.ok(f.hc.cur.session.events.some(e=>e.id===es[1].event_id));assert.equal(f.hc.deferred.length,0);f.hc.hide();
});

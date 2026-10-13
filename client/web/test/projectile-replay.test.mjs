import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {HitCam} from '../src/game/hitcam.js';
import {Node} from '../src/gfx/math.js';
import {loadData} from '../tools/load-data.mjs';
const catalog=loadData(),receipt=JSON.parse(fs.readFileSync(new URL('../../../target/replay-network-r5-20261013.json',import.meta.url)));
function fixture(outcome='penetrated',extra={},shell={kind:'ap',caliber_mm:75}){
  const els=new Map(),root={style:{},dataset:{},querySelector(k){if(!els.has(k))els.set(k,{style:{},dataset:{}});return els.get(k);}};
  const renderer={uploads:0,last:[],mesh(data){this.uploads++;return{data};},freeMesh(){},renderInset(nodes,cam,rect,opts){this.last=nodes.slice();this.prepared=opts.replayDraw;}};
  const hc=new HitCam({root,renderer,catalog}),hull=new Node('hull');hull.mesh={};hull.kind=9;hull.update();
  const target={name:'target',body:{worldPoint:p=>p.slice(),worldDir:p=>p.slice()},model:{root:hull,shellNodes:[hull]},interior:()=>null};
  const rep={impact:[0,1,0],outcome,path:[[0,1,0],[0,1,1],[0,1,5]],shot:{dir:[0,0,1]},fragments:[],bursts:[],modules:[],crew:[],caps:{},title:outcome,...extra};
  const frame={cw:1280,ch:800,scale:1,nodes:[hull]};hc.show(target,rep,shell,100);
  const at=t=>{hc.cur.t=t;hc.render3d(frame);return renderer.last.find(n=>n.name==='replay_projectile');};return{hc,renderer,target,rep,frame,at};
}
const nose=n=>Array.from(n.world.slice(12,15));

test('hit feedback labels remain escaped while MG uses the actual caliber body',()=>{
  const f=fixture();f.target.moduleLabels=new Map([['mg:roof:barrel','Roof & <MG> 槍管']]);
  f.rep.modules=[{id:'mg:roof:barrel',kind:'machine_gun',health:20,max_health:40,damage:20,destroyed:false}];f.hc.hide();
  f.hc.show(f.target,f.rep,{kind:'mg',caliber_mm:12.7},100,true);assert.match(f.hc.el.mods.innerHTML,/Roof &amp; &lt;MG&gt; 槍管 受損/);
  const body=f.at(.15);assert.equal(body.projectileProfile.diameterM,.0127);assert.equal(f.hc.cur.frame.projectile.referenceOnly,true);
  f.rep.modules[0].destroyed=true;f.hc.show(f.target,f.rep,{kind:'mg',caliber_mm:12.7},100,true);assert.match(f.hc.el.mods.innerHTML,/data-dead="1".*損毀/);
});

test('untimed legacy penetration is a static contact explanation without an invented approach',()=>{
  const f=fixture(),before=JSON.stringify(f.rep),n=f.at(.45);assert.deepEqual(nose(n),[0,1,0]);assert.equal(n.castShadow,false);
  assert.equal(f.hc.cur.frame.projectile.timing,'unknown');assert.equal(f.hc.cur.frame.projectile.referenceOnly,true);assert.match(f.hc.el.trust.textContent,/接觸狀態示意/);
  assert.deepEqual(nose(f.at(2.8)),[0,1,0]);assert.equal(f.hc.cur.frame.traces.length,0);assert.equal(JSON.stringify(f.rep),before);
});

test('actual retained native missile sweeps drive nose and tangent without compaction-gap reconstruction',()=>{
  const e=receipt.phases.find(p=>p.name==='missile').recipients.find(q=>q.message.replay).message.replay,f=fixture();f.hc.hide();f.target.actor=e.actor;
  assert.equal(f.hc.show(f.target,{...e.report,replay:e},catalog.projectiles[e.projectile_id],100),true);
  const s=e.segments.at(-1),time=(s.start_time_s+s.end_time_s)/2,film=f.hc.cur.session.clock.filmAt(time),body=f.at(film);
  assert.ok(nose(body).every((v,i)=>Math.abs(v-(s.from[i]+s.to[i])/2)<1e-5));assert.equal(body.projectileProfile.id,'bgm71a_tow');
  assert.equal(f.hc.cur.frame.projectile.timing,'recorded');assert.ok(f.hc.cur.frame.event.omittedFlight>0);
});

test('shared V3 catalog shell retains a narrow distinct driving-band role',()=>{
  const f=fixture(),n=f.at(.45),geometry=[...f.hc.cur.draw.bodyLeases.values()][0].lease.geometry,band=geometry.parts.find(p=>p.role==='band');assert.ok(band);
  const zs=[];for(let i=band.vertexStart;i<band.vertexStart+band.vertexCount;i++)zs.push(geometry.vertices[i*13+2]);
  assert.ok(Math.max(...zs)-Math.min(...zs)<n.projectileProfile.lengthM*.2);assert.ok(geometry.parts.some(p=>p.role==='core'));
});

test('stopped and ricochet reports never manufacture an interior or reflected film trajectory',()=>{
  for(const outcome of ['stopped','ricochet']){
    const f=fixture(outcome,{path:[[0,1,0]],ricochet_dir:outcome==='ricochet'?[1,0,0]:null});
    assert.deepEqual(nose(f.at(.45)),[0,1,0]);assert.deepEqual(nose(f.at(2)),[0,1,0]);assert.equal(f.hc.cur.frame.traces.length,0);
  }
});

test('untimed HEAT stays a labeled contact reference without a synthetic jet mesh',()=>{
  const f=fixture('penetrated',{}, {kind:'heat',caliber_mm:90});assert.deepEqual(nose(f.at(2)),[0,1,0]);
  assert.equal(f.renderer.last.some(n=>n.name==='replay_jet'),false);assert.equal(f.hc.cur.frame.projectile.referenceOnly,true);
});

test('repeated views reuse each caliber/family prototype and preserve live material state',()=>{
  const f=fixture();f.at(.5);const meshes=new Map([['ap',f.hc.projectile.shell.mesh]]),uploads=f.renderer.uploads;
  for(let i=0;i<20;i++){
    const kind=i%2?'heat':'ap';f.hc.show(f.target,f.rep,{kind,caliber_mm:75},100);const n=f.at(.5);
    if(meshes.has(kind))assert.ok(n.mesh===meshes.get(kind));else meshes.set(kind,n.mesh);assert.equal(f.target.model.root.kind,9);
  }
  assert.equal(f.renderer.uploads,uploads+1);assert.ok(meshes.get('ap')!==meshes.get('heat'),'catalog families retain distinct geometry');
});

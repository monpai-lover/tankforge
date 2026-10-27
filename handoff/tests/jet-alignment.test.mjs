import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import zlib from 'node:zlib';
import {models,stores,source,section,c,api,point} from './jet-fixture.mjs';

test('all seventeen imported airframes decode and keep actual mesh geometry and optics',()=>{
  assert.equal(Object.keys(models).length,17);
  for(const [id,m] of Object.entries(models)){
    const T=api.AIRCRAFT_TYPES[id],g=T.geometry();
    assert.ok(g.body.length>0&&g.wings.l.length>0&&g.wings.r.length>0,id);
    if(id.startsWith('me262'))assert.equal(m.animationContract.version,1,id);
    else assert.equal(m.spec.alignmentVersion,id==='mig17f'?1:2,id);
    for(const a of [g.body,g.cockpit,g.glass,...g.controls.map(q=>q.data)])for(let i=0;i<a.length;i+=13)assert.ok(Number.isFinite(a[i])&&Number.isFinite(a[i+1])&&Number.isFinite(a[i+2]),`${id}: non-finite mesh`);
    const sight=m.spec.sight;
    assert.ok(sight?.points.length>=3,`${id}: real combiner missing`);
    assert.ok(g.imported.sightMesh.length>0,`${id}: glass lost from cockpit`);
    const ys=sight.points.map(p=>p[1]);
    assert.ok(T.eye[1]>Math.min(...ys)&&T.eye[1]<Math.max(...ys),`${id}: boresight outside combiner`);
    assert.ok(Math.min(...sight.points.map(p=>p[2]))>T.eye[2]+.1,`${id}: eye inside/beyond sight`);
    for(const p of T.parts)assert.ok(p.c.every(Number.isFinite)&&p.h.every(x=>Number.isFinite(x)&&x>0),`${id}: invalid damage envelope ${p.id}`);
  }
});

test('every standard jet loadout uses finite, side-correct, model-relative mounts',()=>{
  for(const [id,T] of Object.entries(api.AIRCRAFT_TYPES).filter(([,T])=>T.sound==='jet')){
    for(const lo of api.AIR_LOADOUTS[id]||[]){
      assert.equal(api.layoutStores(T,lo).length,lo[1].reduce((n,q)=>n+q[1],0),`${id}/${lo[0]}: missing store`);
      for(const it of api.layoutStores(T,lo)){
      assert.ok(it.p.every(Number.isFinite),`${id}/${lo[0]} ${it.id}`);
      if(it.side)assert.equal(Math.sign(it.p[0]),it.side,`${id}: crossed centreline`);
      if(it.pylon){const [top,bottom]=it.pylon;assert.ok(bottom[1]<=top[1]+.11,`${id}: rack rises through wing`);}
      if(it.def.model&&!it.rack){
        const socket=stores[it.def.model]?.lods?.['0']?.sockets?.socket_mount;
        if(socket&&it.pylon){const mount=[-socket[0],socket[1],socket[2]].map((v,k)=>v+it.p[k]);
          assert.ok(mount.every((v,k)=>Math.abs(v-it.pylon[1][k])<1e-6),`${id}/${it.id}: socket detached`);}
      }
    }
    }
  }
});

test('F-86 uses the supplied file, separates bomb/tank stations and preserves the measured wheel centres',()=>{
  assert.equal(models.f86f.sourceHashes.main,'151c4830621c40e9995d7a2aac57606525ded78200a18161d3aa52fecd2e06a1');
  const T=api.AIRCRAFT_TYPES.f86f,lo=api.AIR_LOADOUTS.f86f.find(q=>q[0]==='炸彈／副油箱'),items=api.layoutStores(T,lo);
  assert.equal(items.length,4);
  assert.ok(items.filter(q=>q.def.kind==='bomb').every(q=>q.id==='anm64'&&Math.abs(Math.abs(q.p[0])-1.7)<.01));
  assert.ok(items.filter(q=>q.def.kind==='tank').every(q=>Math.abs(Math.abs(q.p[0])-2.7)<.01));
  assert.equal(T.fighter.spec.gearAnimation.channels,49);
  assert.equal(T.fighter.spec.gearAnimation.clip,'gear_extend');
  assert.ok(Math.abs(T.fighter.spec.gear.main.r-.30924)<.0001);
  assert.ok(Math.abs(T.fighter.spec.gear.aux.r-.25250)<.0001);
});

test('fallback subsystem registration preserves old and measured fuselage endpoints',()=>{
  const old={fuselage:[[-5,.4,.5],[5,.4,.5]],wing:[[1,0,0,1,.1],[5,0,0,1,.1]]};
  const measured={fuselage:[[-3,.4,.5],[9,.4,.5]],fuseY:.2,wing:[[1,0,0,1,.1],[6,0,0,1,.1]]};
  const f=api.registerAircraftFrame(old,measured);
  assert.equal(f.point([0,0,-5])[2],-3);assert.equal(f.point([0,0,5])[2],9);
  assert.deepEqual(Array.from(f.point([2,0,0])),[2.4,.2,3]);
});

// Exercise the actual pose/camera methods, with accepted simulation arrays and no WebGL dependency.
const start=source.indexOf('  var Aircraft = class {');
const from=source.indexOf('    pose(alpha = 1) {',start),to=source.indexOf('    /** Sends the damage model',from);
const cameraFrom=source.indexOf('    camera(dt, groundAt) {',start),cameraTo=source.indexOf('    /** Screen position of the aim reticle',cameraFrom);
vm.runInContext(`globalThis.methods=({${source.slice(from,to)},${source.slice(cameraFrom,cameraTo)}});`,c);
function controlPoint(controls,q,p){
  const result=point(q.node.local,p);
  return q.parent!=null?controlPoint(controls,controls[q.parent],result):result;
}
const controlNodes=g=>g.controls.map(q=>({...q,node:{},parentP:q.parent!=null?g.controls[q.parent].p:undefined}));
test('F-86 complete gear sweep stays finite and all three actual wheel meshes contact the runway',()=>{
  const T=api.AIRCRAFT_TYPES.f86f,g=T.geometry(),cur=new Float32Array(85);cur[6]=1;cur[1]=2;cur[35]=2;cur[36]=4;
  const p={type:T,cur,prev:cur.slice(),root:{},controls:controlNodes(g),state:{camera:0},damage:{dead:()=>false},glass:{},cockpit:{}};
  for(const gear of [1,.75,.5,.25,0]){cur[33]=p.prev[33]=gear;c.methods.pose.call(p,1);
    for(const q of p.controls)assert.ok(Array.from(q.node.local).every(Number.isFinite),`gear ${gear}: invalid pose`);
    if(gear===1){
      for(const q of p.controls.filter(q=>['GEAR_Main_L_Pivot','GEAR_Main_R_Pivot','GEAR_Nose_Twist'].includes(q.name))){
        let low=Infinity;
        for(let i=0;i<q.data.length;i+=13)low=Math.min(low,point(p.root.local,controlPoint(p.controls,q,q.data.slice(i,i+3)))[1]);
        assert.ok(Math.abs(low)<.05,`${q.name}: visible gear contact ${low} m above runway`);
      }
    }
  }
});

test('F-86 wheel, door, twist and actuator vertices match the supplied GLB throughout extension and reversal',()=>{
  const fixture=JSON.parse(fs.readFileSync(new URL('fixtures/f86-gear-poses.json',import.meta.url),'utf8'));
  const M=models.f86f,T=api.AIRCRAFT_TYPES.f86f,g=T.geometry();
  assert.equal(M.sourceHashes.main,fixture.sourceSha256);
  const blob=zlib.inflateSync(Buffer.from(M.blob,'base64'));
  const cur=new Float32Array(85);cur[6]=1;cur[35]=100;
  const p={type:T,cur,prev:cur.slice(),root:{},controls:controlNodes(g),state:{camera:0},damage:{dead:()=>false},glass:{},cockpit:{}};
  const sequence=[...fixture.samples,...fixture.samples.slice().reverse()];
  for(const sample of sequence){cur[33]=p.prev[33]=sample.extension;c.methods.pose.call(p,1);
    for(const expected of sample.parts){
      const record=M.parts.find(q=>q.name===expected.name),q=p.controls.find(q=>q.mover===record.mover&&!q.glass);
      assert.ok(record&&q,`${expected.name}: missing authored gear part`);
      for(let k=0;k<3;k++){
        const index=blob.readUInt16LE(record.idx+2*k);
        const rest=[0,1,2].map(a=>blob.readInt16LE(record.pos+2*(index*3+a))*M.posScale-q.p[a]);
        const actual=controlPoint(p.controls,q,rest),error=Math.hypot(...actual.map((v,a)=>v-expected.points[k][a]));
        assert.ok(error<.002,`${expected.name} extension ${sample.extension}: source pose error ${error}m`);
      }
    }
  }
});

test('banked cockpit eye, forward and up use the airframe rather than the world horizon',()=>{
  const q=[0,0,Math.SQRT1_2,Math.SQRT1_2],T=api.AIRCRAFT_TYPES.f86f;
  const p={type:T,drawQ:q,drawPos:[50,800,20],state:{camera:1},keys:new Set(),free:{yaw:0,pitch:0},aim:[.2,.1,1],camQ:q,cur:new Float32Array(80)};
  const camera=c.methods.camera.call(p,1,()=>0);
  const eye=api.aqRot(q,T.eye).map((v,k)=>v+p.drawPos[k]);
  assert.ok(camera.camPos.every((v,k)=>Math.abs(v-eye[k])<1e-6));
  assert.ok(camera.fwd.every((v,k)=>Math.abs(v-[0,0,1][k])<1e-5));
  assert.ok(camera.up.every((v,k)=>Math.abs(v-[-1,0,0][k])<1e-5));
});

// Run the real release and ordnance integrators. UI, sound and final damage admission are inert here.
Object.assign(c,{G4:{time:0},sound:{},applyStoreLoad(){},drawOrdnance(){},ordnanceMotor(){},airBurstStep(){},
  vehicleNear:()=>false,scene:{children:[]},airBots:{contact:()=>null},surfaceAt:()=>0,G3:9.80665,
  disperse:dir=>dir.slice(),rng2:{},handoffs:[],ordnanceToShell:(o,p)=>c.handoffs.push({o:structuredClone(o),p:Array.from(p)})});
vm.runInContext(section('  function groundHit(','  function groundRay(')+
  section('    function storeGroup(st) {','    function cycleStore(')+
  section('    const airOrdnance = G4.airOrdnance = [];','    const PLAYER_TARGET = ')+
  section('    function stepOrdnance(dt) {','    /** Where the missile\'s seeker')+
  section('    function storeImpact(air) {','    // ---- enemy aircraft')+
  'globalThis.prediction={releaseStore,storeImpact,stepOrdnance,airOrdnance};',c);
test('CCIP predicts the next actual station, preserves flight state and follows live bomb/rocket motion',()=>{
  for(const id of ['mk82','hvar']){
    c.prediction.airOrdnance.length=0;c.handoffs.length=0;
    const S=new Float32Array(80);S[1]=600;S[7]=12;S[8]=-60;S[9]=210;
    const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,600,0,1];
    const plane={type:{id:'f4e'},cur:S,position:[0,600,0],damage:{},root:{local:matrix},worldPoint:p=>[p[0],600+p[1],p[2]]};
    const def=api.AIR_STORE_DEFS[id],items=[-1,1].map(side=>({id,def,side,p:[side*3,-1.2,2.4],count:1,station:'inner'}));
    const air={plane,stores:{groups:[id],sel:0,items,released:0,lastSide:-1}};
    const before=Array.from(S),prediction=c.prediction.storeImpact(air);
    assert.ok(prediction&&prediction.t>0&&prediction.at[0]>0);
    assert.deepEqual(Array.from(S),before,'prediction mutated accepted flight state');
    assert.ok(c.prediction.releaseStore(air));
    const launched=c.prediction.airOrdnance[0];
    assert.deepEqual(Array.from(launched.pos),[3,598.8,2.4]);
    // Let the actual integration reach its final shell handoff. Its track must approach the predicted point.
    for(let k=0;k<6000&&c.prediction.airOrdnance.length;k++)c.prediction.stepOrdnance(1/120);
    assert.equal(c.handoffs.length,1);
    const end=c.handoffs[0].o;
    const remaining=Math.hypot(prediction.at[0]-end.pos[0],prediction.at[2]-end.pos[2]);
    assert.ok(remaining<Math.hypot(...end.vel)*.16,`${id}: CCIP diverged before damage handoff (${remaining}m)`);
    assert.ok(prediction.t>=end.t&&prediction.t-end.t<.2,`${id}: incorrect impact time`);
  }
});

const calls=[],stack=[];
const ctx=new Proxy({globalAlpha:1,globalCompositeOperation:'source-over',clipped:false,
  save(){stack.push({globalAlpha:this.globalAlpha,globalCompositeOperation:this.globalCompositeOperation,clipped:this.clipped});},
  restore(){Object.assign(this,stack.pop());},clip(){this.clipped=true;},
  arc(x,y,r){calls.push({x,y,r,alpha:this.globalAlpha,blend:this.globalCompositeOperation,clipped:this.clipped});}},
  {get:(o,k)=>k in o?o[k]:()=>{}});
Object.assign(c,{renderer:{env:{elev:62}},performance:{now:()=>0},window:{devicePixelRatio:1},canvas:{clientWidth:1280,clientHeight:720},
  airEl:{ov:{width:1280,height:720,getContext:()=>ctx}},noseOf:()=>[0,0,1],L10N:(a,b)=>b,
  project:(_,p)=>{const e=c.G4.camPos,z=p[2]-e[2];return [(p[0]-e[0])/z/.8,(p[1]-e[1])/z/.45,z];}});
vm.runInContext(fs.readFileSync(new URL('../tools/aircraft_sight_optics.js',import.meta.url),'utf8')+section('  function aircraftSightAperture(','  // Collimated sight rendering:')+section('    function drawAirOverlay(','    /** Warnings over the screen centre')+'globalThis.overlay=drawAirOverlay;',c);
test('cockpit computing sight draws through its glass, vanishes behind the eye and stays collimated with head translation',()=>{
  const T=api.AIRCRAFT_TYPES.f15c,eye=Array.from(T.eye);
  const plane={type:T,cur:new Float32Array(80),state:{camera:1},cockpitEye:eye,position:[0,0,0],sightGlass:T.model.spec.sight.points,
    worldPoint:p=>Array.from(p),localPoint:p=>Array.from(p)};
  const air={plane,ctl:{eq:{lcos:true}},guns:[{}],pipper:{at:[0,0,500],range:500}};
  c.G4.camPos=eye;calls.length=0;c.overlay(air,null,1280,720,1);
  const original=calls.find(q=>q.blend==='lighter'&&q.r>=12);
  assert.ok(original?.clipped,'sight absent or not clipped to glass');
  c.G4.camPos=[eye[0]+.05,eye[1],eye[2]];calls.length=0;c.overlay(air,null,1280,720,1);
  const shifted=calls.find(q=>q.blend==='lighter'&&q.r>=12);
  assert.ok(shifted&&Math.hypot(shifted.x-original.x,shifted.y-original.y)<1e-5,'reticle has near-glass parallax');
  plane.sightGlass=plane.sightGlass.map(p=>[p[0],p[1],eye[2]-1]);calls.length=0;c.overlay(air,null,1280,720,1);
  assert.equal(calls.filter(q=>q.blend==='lighter').length,0,'hidden glass drew a full-screen sight');
});

const outputDir=process.env.TF_TEST_ARTIFACT_DIR?path.resolve(process.env.TF_TEST_ARTIFACT_DIR):fileURLToPath(new URL('out/',import.meta.url));
const out=path.join(outputDir,'jet-alignment-receipt.json');fs.mkdirSync(outputDir,{recursive:true});
fs.writeFileSync(out,JSON.stringify(Object.fromEntries(Object.entries(models).map(([id,m])=>[id,{sourceHashes:m.sourceHashes,eye:m.spec.eye,seatedEye:m.spec.eyeSeated,cg:m.cg_in_model,stations:m.spec.stations,pylonPoints:m.spec.pylonPoints,combinerPoints:m.spec.sight?.points.length} ])),null,2));

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {normalizeModel,MIG21_ORPHANS} from './source-cleanup.mjs';
import * as mounted from './details.mjs';
import {catalogDefinitions,radars,equipment} from './catalog.mjs';
import {createLayout,declaration} from '../hardpoints/actual-layout-fixture.mjs';
const app=process.env.TF_LIVE_APP||new URL('../../../reference/FROZEN_model_upgrade_app_script.html',import.meta.url).pathname;
process.env.TF_LIVE_APP=app;
const {bundled,makeAircraft,context}=await import('../../work/tankforge-live-flight-patch/source/handoff/tests/fixtures/live-aircraft.mjs');
const fixture=JSON.parse(fs.readFileSync(new URL('../all-interior/current-catalog-fixture.json',import.meta.url)));
const source=fs.readFileSync(app,'utf8'),raw=fixture.models.mig21,clean=normalizeModel('mig21',raw);
const digest=a=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
// The baseline executes the same production geometry with only this cleanup
// hook disabled, so comparisons remain valid after the repaired bundle ships.
const baseContext={...context};vm.createContext(baseContext);
const start=source.indexOf('(() => {')+'(() => {'.length,end=source.indexOf('  // client/web/src/boot.js');
const baseDefs=source.slice(start,end).replace('m = TFMountedDetails.normalizeModel(id2, m);','/* baseline source caps retained */');
const baseline=vm.runInContext('(()=>{'+baseDefs+';return {decodeAircraftModels,AIRCRAFT_TYPES,Aircraft};})()',baseContext);
function basePlane(){const state=new Float32Array(64);state[6]=1;state[33]=1;state[35]=100;const api={memory:{buffer:state.buffer},state_ptr:()=>0,state_len:()=>64,set_damage(){},configure_airframe(){},configure(){},configure_envelope(){},spawn(){}};const renderer={mesh:data=>({count:data.length/13,_src:{kind:'mesh',data}}),freeMesh(){},texture:()=>({}),updateTexture(){},freeTexture(){}};return new baseline.Aircraft(renderer,api,'mig21');}

test('exact source cleanup removes only the four isolated black cap remnants, preserving rail part indices and input bytes',()=>{
 assert.notEqual(clean,raw);assert.equal(clean.parts.length,raw.parts.length);assert.equal(clean.blob,raw.blob);assert.equal(clean.sourceOrphanCleanup,1);
 for(let i=0;i<raw.parts.length;i++)if([58,67].includes(i)){assert.equal(clean.parts[i].triangles,0);assert.equal(raw.parts[i].triangles,240);assert.equal(clean.parts[i].removedSourceOrphanTriangles,240);}else assert.equal(clean.parts[i],raw.parts[i]);
 assert.equal(clean.parts[51],raw.parts[51]);assert.equal(clean.parts[60],raw.parts[60]);assert.equal(normalizeModel('mig21',clean),clean);
 assert.equal(normalizeModel('other',raw),raw);const future={...raw,sourceHashes:{main:'other'}};assert.equal(normalizeModel('mig21',future),future);
 const changed={...raw,parts:raw.parts.map((p,i)=>i===58?{...p,textured:true}:p)};assert.equal(normalizeModel('mig21',changed),changed);
});

test('actual imported geometry loses all 480 unwanted triangles and retains every other static or moving source triangle',async()=>{
 await baseline.decodeAircraftModels({mig21:raw});const before=baseline.AIRCRAFT_TYPES.mig21.geometry(),oldPlane=basePlane();
 await bundled.decodeAircraftModels({mig21:clean});const after=bundled.AIRCRAFT_TYPES.mig21.geometry(),newPlane=makeAircraft('mig21').plane;
 assert.equal(oldPlane.hitbox.count-newPlane.hitbox.count,480);
 const blackCaps=hb=>{let n=0;for(let o=0;o<hb.tris.length;o+=9)if([0,3,6].every(j=>hb.tris[o+j+1]<-.43&&hb.tris[o+j+1]>-.51&&hb.tris[o+j+2]>.68&&hb.tris[o+j+2]<1.45&&Math.abs(hb.tris[o+j])>1.94&&Math.abs(hb.tris[o+j])<2.49))n++;return n;};
 assert.equal(blackCaps(oldPlane.hitbox)-blackCaps(newPlane.hitbox),480);
 for(const side of ['l','r']){
  assert.equal(before.wings[side].length-after.wings[side].length,240*39);
  const wanted=[];for(let o=0;o<before.wings[side].length;o+=39){const tri=before.wings[side].subarray(o,o+39),black=[0,13,26].every(j=>tri[j+6]===0&&tri[j+7]===0&&tri[j+8]===0),cap=[0,13,26].every(j=>tri[j+1]<-.43&&tri[j+1]>-.51&&tri[j+2]>.68&&tri[j+2]<1.45);if(!(black&&cap))wanted.push(...tri);}
  assert.equal(digest(new Float32Array(wanted)),digest(after.wings[side]));
 }
 for(const k of ['body','cockpit','glass'])assert.equal(digest(before[k]),digest(after[k]));
 assert.equal(before.controls.length,after.controls.length);for(let i=0;i<before.controls.length;i++)assert.equal(digest(before.controls[i].data),digest(after.controls[i].data));
});

test('actual custom menu exposes four separate MF pylons and supported missiles without changing old preset order',async()=>{
 await bundled.decodeAircraftModels({mig21:clean});const T=bundled.AIRCRAFT_TYPES.mig21,L=createLayout(source,bundled.AIRCRAFT_TYPES),slots=L.airSlots('mig21');
 assert.deepEqual(Array.from(slots,s=>s.key),['outer:-1','inner:-1','inner:1','outer:1']);
 for(const s of slots)for(const id of ['r3s','r3r','r60','fab250','ub16'])assert.equal(s.options.get(id),1);
 const entries=slots.map(s=>['r3r',1,s.station,s.side]),items=L.layoutStores(T,['four',entries]);assert.equal(items.length,4);assert.equal(new Set(items.map(it=>it.modelHardpoint)).size,4);assert.equal(new Set(items.map(it=>it.fittedMountKey)).size,4);
 for(const it of items){assert.ok(it.p.every(Number.isFinite));assert.equal(it.owner.replace(/_out$/,''),it.side<0?'wing_r':'wing_l');assert.equal(it.def.guidance,'sarh');assert.equal(it.pylon,null);}
 assert.deepEqual(JSON.parse(JSON.stringify(L.AIR_LOADOUTS.mig21)),[['空戰',[['r3s',2,'inner']]],['對地',[['fab250',2,'inner']]],['火箭',[['ub16',2,'inner']]]]);
});

function combat(){
 const defs=catalogDefinitions({},{}),R=radars({}),E=equipment({mig21:{gyro:true}}),G4={time:10,online:false},ordnance=[];
 const v={sub:(a,b)=>a.map((x,i)=>x-b[i]),dot:(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),norm:a=>{const n=Math.hypot(...a)||1;return a.map(x=>x/n)}};
 const ctx={...v,AIR_STORE_DEFS:defs,AIR_RADARS:R,AIR_EQUIP:E,WEAPON_STATUS:{r3r:{compat:'primary'}},G4,airOrdnance:ordnance,airBots:{list:[],flares:[],chaff:[]},LANG:'en',sound:{},surfaceAt:()=>0,airLos:()=>true,applyStoreLoad:()=>{},sensorSlew:()=>{},radioSteer:()=>{},airTone:()=>{},airReason:()=>false,targetName:()=> 'target',releaseStore:()=>{},decoysSeduce:()=>false};vm.createContext(ctx);
 const constants=['L10N','SEEKER_DEFAULTS','seekerOf','imagingSeeker','D2R','angleOf','noseOf','RADAR_SCALES','RADAR_ACM','twsTrack','targetAlive'];
 const funcs=['storeGroup','bodyDir','airCtl','radarCheck','radarAcmCheck','radarLockRequest','stepRadarSys','seekerReset','launchCheck','launchGuided','airTargetPos','airTargetVel','missileSees','launcherIlluminates','missileGuide'];
 const code=[...constants.map(n=>declaration(source,n,'const')),...funcs.map(n=>declaration(source,n)),`return {airCtl,radarLockRequest,stepRadarSys,launchCheck,launchGuided,missileGuide};`].join('\n');
 const api=vm.runInContext('(()=>{'+code+'})()',ctx);
 const cur=new Float32Array(64);cur[9]=250;cur[50]=1;const m=[1,0,0,0,0,1,0,0,0,0,1,0,0,1000,0,1];
 const plane={type:{id:'mig21'},cur,root:{local:m},position:[0,1000,0],damage:{pilotDead:false,dead:()=>false},worldPoint:p=>[p[0],1000+p[1],p[2]]};
 const items=[-1,1].map(side=>({id:'r3r',def:defs.r3r,count:1,p:[side*2,-.5,0],side,station:'inner'}));
 const air={plane,stores:{items,groups:['r3r'],sel:0,released:0}},bot={plane:{type:{name:'target'},position:[0,1000,4000],cur:new Float32Array(64)}};bot.target={bot};ctx.airBots.list.push(bot);G4.air=air;
 return{...api,ctx,G4,air,bot,ordnance};
}

test('R3R follows the actual RP22 radar acquisition, launch, count and illumination-loss path',()=>{
 const C=combat(),ctl=C.airCtl(C.air),d=C.air.stores.items[0].def;
 assert.equal(ctl.radar.R.name,'RP-22 Sapfir');assert.equal(ctl.eq.gyro,true);ctl.seeker.def=d;ctl.seeker.state='ready';
 assert.equal(C.launchCheck(C.air).ok,false); // no track yet
 const b=C.bot;ctl.radar.tracks.set(b,{p:b.plane.position.slice(),v:[0,0,0],t:C.G4.time,az:0,el:0});
 assert.equal(C.radarLockRequest(C.air),true);assert.equal(ctl.radar.stt.state,'acq');assert.equal(C.launchCheck(C.air).ok,false);
 C.G4.time+=.6;C.stepRadarSys(C.air,.6);assert.equal(ctl.radar.stt.state,'track');assert.equal(C.launchCheck(C.air).ok,true);
 assert.equal(C.launchGuided(C.air,'one'),true);assert.equal(C.ordnance.length,1);assert.equal(C.air.stores.items.filter(it=>!it.gone).length,1);assert.equal(C.ordnance[0].guide.phase,'sarh');assert.equal(C.ordnance[0].def,d);assert.equal(C.launchGuided(C.air,'one'),false);
 const o=C.ordnance[0];assert.ok(C.missileGuide(o));ctl.radar.on=false;C.G4.time+=3;assert.equal(C.missileGuide(o),null);assert.equal(o.guide.phase,'lost');
});

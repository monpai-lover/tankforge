import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadData, ORDER} from '../tools/load-data.mjs';
import {makeLoadout, buildToBundle, exportFolder, newTurretSpec} from '../src/game/loadout.js';
import {normalizeWorkshopBuild} from '../src/game/workshopBuild.js';
import {VehicleActions} from '../src/game/vehicleActions.js';
import {ammoKeyIndex} from '../src/game/weaponselection.js';
import {Rng} from '../src/sim/rng.js';
import {decodeImported} from '../src/gfx/imported.js';
import {loadCoreSync} from '../src/design/core.js';
import {Combat} from '../src/game/combat.js';
const apiPath=new URL('../src/game/rangefinderEquipment.js',import.meta.url);
const api=fs.existsSync(apiPath)?await import(apiPath):{};
const data=loadData();
data.vehicles.xp_bmp_k64.imported=await decodeImported(data.vehicles.xp_bmp_k64.model);
data.vehicles.su_t10m.imported=await decodeImported(data.vehicles.su_t10m.model);
const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const fn=name=>{const start=source.indexOf(`  function ${name}(`);assert.ok(start>=0,`${name} owner exists`);return source.slice(start,source.indexOf('\n  }',start)+4);};
const resolve=(s,id)=>{assert.equal(typeof api.resolveRangefinder,'function');return api.resolveRangefinder(s,id);};
const spec=(sightSource,rangefinderKind)=>({...newTurretSpec(),...(sightSource?{sightSource}:{}),...(rangefinderKind?{rangefinderKind}:{}),guns:[{weapon:'xp_kda35'}]});
const load=b=>makeLoadout('test',b,data.projectiles,data.machineGuns);

test('all 44 playable vehicles and their extra sights use equipment evidence, never inferred lasers',()=>{
 assert.equal(ORDER.length,44);
 for(const id of ORDER){
  const t=load(data.vehicles[id]).turrets;
  assert.equal(t[0].rangefinder.kind,id==='de_panther_f'?'stereoscopic':id==='su_t72a'?'laser':'manual',id);
  for(const extra of t.slice(1))assert.equal(extra.rangefinder.kind,'manual',`${id}:${extra.id}`);
 }
 const p=resolve(data.vehicles.de_panther_f.weapons.sight,'de_panther_f');
 assert.match(p.provenance,/planned|reconstruction/i);
 assert.equal(resolve(data.vehicles.de_panther_f.weapons.sight,'unrelated').kind,'manual');
 assert.equal(resolve({...data.vehicles.de_panther_f.weapons.sight,name:'TZF 13'},'de_panther_f').kind,'manual');
});
test('explicit equipment wins, anonymous numbers remain manual, and numeric validation is finite',()=>{
 const legacy={time_s:3,error_pct:2,max_range_m:4000};
 for(const kind of ['manual','coincidence','stereoscopic','laser']){
  const rf=resolve({rangefinder:{...legacy,kind}});
  assert.equal(rf.kind,kind);assert.equal(rf.time_s,3);assert.equal(rf.error_pct,2);assert.equal(rf.max_range_m,4000);
  assert.equal(rf.delay_s,kind==='laser'?null:kind==='manual'?3:1);
 }
 assert.equal(resolve({rangefinder:legacy}).kind,'manual');
 assert.equal(resolve({name:'laser + thermal + radar',rangefinder:{...legacy,kind:'LASER'}}).kind,'manual');
 assert.equal(resolve({name:'plain',rangefinder:{...legacy,time_s:.4,kind:'coincidence'}}).delay_s,.4);
 for(const bad of ['0',0,-1,NaN,Infinity])for(const field of ['time_s','max_range_m']){
  const rf=resolve({rangefinder:{...legacy,[field]:bad}});assert.ok(Number.isFinite(rf.delay_s)&&rf.delay_s>0);assert.ok(Number.isFinite(rf.max_range_m)&&rf.max_range_m>0);
 }
 for(const bad of ['5',-1,NaN,Infinity,51])assert.equal(resolve({rangefinder:{...legacy,error_pct:bad}}).error_pct,5);
 assert.equal(resolve({rangefinder:'laser'}).kind,'manual');
});
test('workshop inherited sight identity survives different base and gun donors, and explicit overrides preserve numbers',()=>{
 const before=JSON.stringify(data.vehicles);
 for(const base of ['de_hetzer','xp_bmp_k64'])for(const kind of ['inherit','manual','coincidence','stereoscopic','laser']){
  const b={base,keepStock:false,turrets:[spec('de_panther_f',kind),spec('xp_bmp_k64_kornet','inherit')]};
  const built=buildToBundle(b,data), rt=load(built.bundle);
  assert.equal(rt.turrets[0].rangefinder.kind,kind==='inherit'?'stereoscopic':kind);
  assert.equal(rt.turrets[1].rangefinder.kind,'manual');
  assert.equal(rt.turrets[0].rangefinder.time_s,3);assert.equal(rt.turrets[0].rangefinder.error_pct,2);assert.equal(rt.turrets[0].rangefinder.max_range_m,4000);
  const out=exportFolder(b,data,data.vehicles[base],'rf_export','RF',{includeModel:false});
  const files=JSON.parse(JSON.stringify(out.files)), bundle={vehicle:files['vehicle.json'],weapons:files['weapons.json'],engine:files['engine.json'],visual:files['visual.json']};
  assert.equal(load(bundle).turrets[0].rangefinder.kind,rt.turrets[0].rangefinder.kind);
 }
 const kept=load(buildToBundle({base:'de_panther_f',keepStock:true,turrets:[spec('de_hetzer','laser')]},data).bundle);
 assert.deepEqual(kept.turrets.map(t=>t.rangefinder.kind),['stereoscopic','laser']);
 const extras=load(buildToBundle({base:'su_t10m',keepStock:true,turrets:[spec(null,'laser')]},data).bundle);
 assert.deepEqual(extras.turrets.map(t=>t.rangefinder.kind),['manual','manual','laser']);
 assert.equal(JSON.stringify(data.vehicles),before,'all source definitions remain unchanged');
});
test('every sight donor is classified identically after workshop and folder roundtrips',()=>{
 for(const id of ORDER){
  const b={base:'de_hetzer',keepStock:false,turrets:[spec(id)]}, built=buildToBundle(b,data);
  const expected=id==='de_panther_f'?'stereoscopic':id==='su_t72a'?'laser':'manual';
  assert.equal(load(built.bundle).turrets[0].rangefinder.kind,expected,id);
  const {files}=exportFolder(b,data,data.vehicles.de_hetzer,'rf_audit','audit',{includeModel:false});
  assert.equal(files['weapons.json'].sight.rangefinder.kind,expected,id);
 }
});
test('settings normalization and serialized storage/export envelopes retain each equipment choice',()=>{
 for(const kind of ['inherit','manual','coincidence','stereoscopic','laser']){
  const b={base:'de_hetzer',keepStock:false,turrets:[spec('de_panther_f',kind)]};
  const n=normalizeWorkshopBuild(JSON.parse(JSON.stringify({build:b,files:{}})),data);
  assert.equal(n.turrets[0].rangefinderKind,kind);
  assert.deepEqual(normalizeWorkshopBuild(JSON.parse(JSON.stringify(n)),data),n);
 }
 const old=normalizeWorkshopBuild({base:'de_hetzer',keepStock:false,turrets:[spec()]},data);
 assert.equal(old.turrets[0].rangefinderKind,undefined,'old settings implicitly inherit');
 for(const kind of ['LASER','',null,0,'radar'])assert.throws(()=>normalizeWorkshopBuild({base:'de_hetzer',turrets:[spec(null,'manual')].map(t=>({...t,rangefinderKind:kind}))},data));
 assert.match(fs.readFileSync(new URL('../src/game/workshop.js',import.meta.url),'utf8'),/測距設備/);
});
test('generated full workshop weapons are accepted by the actual Rust WASM core',()=>{
 const core=loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm',import.meta.url)),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)}),combat=new Combat(core,data.machineGuns);
 for(const kind of ['inherit','manual','coincidence','stereoscopic','laser']){
  const b={base:'de_hetzer',keepStock:false,turrets:[spec('de_panther_f',kind)]};
  const {files}=exportFolder(b,data,data.vehicles.de_hetzer,`wasm_rf_${kind}`,'RF',{includeModel:false});
  const restored=JSON.parse(JSON.stringify(files)),bundle={vehicle:restored['vehicle.json'],weapons:restored['weapons.json'],engine:restored['engine.json'],visual:restored['visual.json'],armor:restored['armor.json'],crew:restored['crew.json'],modules:restored['modules.json']};
  assert.equal(combat.fresh(`wasm_rf_${kind}`,bundle).caps.destroyed,false);
  assert.equal(load(bundle).turrets[0].rangefinder.kind,kind==='inherit'?'stereoscopic':kind);
 }
});
test('only an explicitly coaxial machine gun shares the primary sight equipment',()=>{
 assert.equal(typeof api.rangefinderForWeapon,'function');
 const l=load(buildToBundle({base:'de_panther_f',keepStock:true,turrets:[]},data).bundle);
 l.turrets[0].rangefinder={...l.turrets[0].rangefinder,kind:'laser'};
 l.machineGuns=[{mount:'hull'},{mount:'pintle'},{mount:'coax'}];
 for(const mi of [0,1])assert.equal(api.rangefinderForWeapon(l,{ti:0,gi:0,mi}).kind,'manual');
 assert.equal(api.rangefinderForWeapon(l,{ti:0,gi:0,mi:2}).kind,'laser');
});

function rig(kind='manual',{autoZero=true,distance=1000}={}){
 const events={},calls=[],vehicleActions=new VehicleActions();let now=0;
 const rf={kind,time_s:3,error_pct:2,max_range_m:4000};
 const G={id:'test',model:{},ranging:null,rangeResult:null,mode:'battle',paused:false,workshop:false,thumbs:[],caps:{destroyed:false},online:null,cstate:{},s:{u:0},keys:new Set(),loadout:{turrets:[{rangefinder:rf,guns:[{}]}],machineGuns:[]},sightT:0,sightG:0,sightM:-1,MG:[],T:[{yaw:0}],ss:{},camPos:[0,0,0],cam:{yaw:0,pitch:0},autoZero,free:false,xray:false};
 const document={hidden:false,activeElement:{tagName:'CANVAS'},addEventListener:(k,f)=>events[k]=f};
 const deps={G,document,vehicleActions,vehicleActionIndicator:{update(){}},hud:{toast:(...a)=>calls.push(['toast',...a])},deploy:{visible:false},chatIn:{hidden:true},net:{open:true},sound:{ping:()=>calls.push(['ping'])},rng:new Rng(77),setZero:n=>calls.push(['zero',n]),sightTurret:()=>G.loadout.turrets[G.sightT],sightMuzzle:()=>({pos:[10,0,0]}),hullTilt:()=>0,dirFrom:()=>[0,0,1],groundRay:()=>distance,surfaceAt:()=>0,buildingHit:()=>null,hitTargets:()=>null,rangeTargets:()=>[],hitEnemy:()=>null,rangefinderForWeapon:api.rangefinderForWeapon,clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),performance:{now:()=>now*1000},KEYMAP:{},ammoKeyIndex,HTMLButtonElement:class{},setFreeLook(){},setXray(){},repairVehicle:()=>calls.push(['repair']),abandonVehicle:()=>calls.push(['abandon']),trigger(){},resetVehicle(){}};
 const names=['vehicleActionAllowed','performVehicleAction','losHit','sightRangefinder','rangingContextValid','startRanging','currentLos','finishRanging','updateRanging','rangingProgress'].filter(n=>source.includes(`  function ${n}(`));
 const keySource=source.slice(source.indexOf("  window.addEventListener('keydown'"),source.indexOf("  document.getElementById('help-toggle')"));
 const handlers=new Function(...Object.keys(deps),'window',`${names.map(fn).join('\n')}\n${keySource}\nreturn {startRanging,finishRanging,${names.includes('updateRanging')?'updateRanging,':''}${names.includes('rangingProgress')?'rangingProgress,':''}};`)(...Object.values(deps),{addEventListener:(k,f)=>events[k]=f});
 return {...handlers,G,events,calls,document,setTime:t=>now=t,event:(code,repeat=false)=>({code,repeat,target:{tagName:'CANVAS'},preventDefault(){}})};
}
test('real F release synchronously completes a laser once, keydown and three-second hold never range',()=>{
 const r=rig('laser');r.events.keydown(r.event('KeyF'));assert.equal(r.G.rangeResult,null);r.events.keydown(r.event('KeyF',true));
 r.setTime(.2);r.events.keyup(r.event('KeyF'));assert.equal(r.G.rangeResult?.ok,true);assert.equal(r.G.ranging,null);assert.equal(r.calls.filter(c=>c[0]==='ping').length,1);
 r.events.keyup(r.event('KeyF'));assert.equal(r.calls.filter(c=>c[0]==='ping').length,1);
 const h=rig('laser');h.events.keydown(h.event('KeyF'));h.setTime(3);h.events.keyup(h.event('KeyF'));assert.deepEqual(h.calls,[['repair']]);assert.equal(h.G.rangeResult,null);
});
test('real delayed optical/manual owners have finite durations and complete once using the same LOS math as laser',()=>{
 const laser=rig('laser');laser.startRanging();assert.equal(laser.G.rangeResult?.ok,true);
 for(const kind of ['manual','coincidence','stereoscopic']){
  const r=rig(kind);r.startRanging();assert.equal(r.G.rangeResult,null);assert.equal(r.G.ranging.total,kind==='manual'?3:1);
  assert.equal(typeof r.updateRanging,'function');r.updateRanging(r.G.ranging.total-.01);assert.equal(r.G.rangeResult,null);r.updateRanging(.02);r.updateRanging(10);
  assert.deepEqual(r.G.rangeResult,laser.G.rangeResult);assert.deepEqual(r.calls,laser.calls);assert.equal(r.G.rangeResult.measured%5,0);
  assert.equal(r.G.rangeResult.truth,Math.hypot(10,1000),'distance starts at the selected muzzle, not the camera');
 }
});
test('real laser and waiting failures retain range limits, sky miss, sound and autoZero rules',()=>{
 for(const kind of ['manual','laser'])for(const distance of [5000,Infinity]){
  const r=rig(kind,{distance});r.startRanging();if(r.G.ranging)r.updateRanging(10);
  assert.deepEqual(r.G.rangeResult,{ok:false});assert.equal(r.calls.some(c=>c[0]==='ping'||c[0]==='zero'),false);
 }
 for(const kind of ['manual','laser']){const r=rig(kind,{autoZero:false});r.startRanging();if(r.G.ranging)r.updateRanging(10);assert.equal(r.G.rangeResult.ok,true);assert.equal(r.calls.some(c=>c[0]==='zero'),false);assert.equal(r.calls.filter(c=>c[0]==='ping').length,1);}
});
test('pending measurement cancels on selected weapon, model, loadout, mode or control changes',()=>{
 const changes=[r=>r.G.sightG++,r=>r.G.sightT++,r=>r.G.sightM=0,r=>r.G.loadout.turrets[0].guns[0]={},r=>r.G.loadout.turrets[0]={...r.G.loadout.turrets[0]},r=>r.G.model={},r=>r.G.loadout={...r.G.loadout},r=>r.G.id='other',r=>r.G.mode='garage',r=>r.G.paused=true,r=>r.G.workshop=true,r=>r.G.caps.destroyed=true,r=>r.document.activeElement={tagName:'INPUT'},r=>r.document.hidden=true];
 for(const change of changes){const r=rig();r.startRanging();change(r);assert.equal(typeof r.updateRanging,'function');r.updateRanging(10);assert.equal(r.G.ranging,null);assert.equal(r.G.rangeResult,null);}
 for(const event of ['blur','visibilitychange','focusin']){const r=rig();r.startRanging();if(event==='visibilitychange')r.document.hidden=true;r.events[event]({target:{tagName:'INPUT'}});assert.equal(r.G.ranging,null,event);}
 for(const owner of ['cycleSightGun','setMode','openChat'])assert.match(fn(owner),/G\.ranging = null/);
 assert.match(fn('updateVehicleActions'),/G\.ranging = null/,'paused frame cancels before it skips simulation');
});
test('invalid legacy values never create zero/infinite progress and invalid controls cannot range',()=>{
 for(const v of [0,NaN,Infinity,'0']){const r=rig();r.G.loadout.turrets[0].rangefinder.time_s=v;r.startRanging();assert.ok(Number.isFinite(r.G.ranging.total)&&r.G.ranging.total>0);assert.equal(typeof r.rangingProgress,'function');r.G.ranging.t=Infinity;assert.equal(r.rangingProgress(),0);r.G.ranging.t=10;assert.equal(r.rangingProgress(),1);}
 for(const change of [r=>r.G.paused=true,r=>r.G.caps.destroyed=true,r=>r.G.mode='garage',r=>r.G.online={dead:true},r=>r.document.hidden=true]){const r=rig('laser');change(r);r.startRanging();assert.equal(r.G.rangeResult,null);assert.equal(r.G.ranging,null);}
});
test('weapons schema accepts exactly the supported optional kinds and still requires positive legacy delay',()=>{
 const schema=JSON.parse(fs.readFileSync(new URL('../../../schemas/weapons.schema.json',import.meta.url),'utf8'));
 const rf=schema.$defs.sight.properties.rangefinder;
 assert.deepEqual(rf.properties.kind.enum,['manual','coincidence','stereoscopic','laser']);assert.ok(!rf.required.includes('kind'));assert.equal(rf.properties.time_s.exclusiveMinimum,0);assert.match(rf.description,/crew estimation/i);
});

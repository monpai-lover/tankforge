import {aircraftPerformancePrelude} from '../tools/aircraft_performance/runtime.mjs';
// Actual delivered decoder/constructor/pose and mesh-upload calls, CPU only.
// Input frames are accepted-state geometry fixtures, not claimed live flights.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const [records,referencePath,outDir,appPath='handoff/bundle/app.js.html']=process.argv.slice(2);
const source=fs.readFileSync(appPath,'utf8'),reference=JSON.parse(fs.readFileSync(referencePath));
const section=(a,b)=>{const p=source.indexOf(a),q=source.indexOf(b,p);assert.ok(p>=0&&q>p,a);return source.slice(p,q);};
const ctx=vm.createContext({console,Float32Array,Float64Array,Uint16Array,Int16Array,Int8Array,Uint8Array,Map,Set,Math,ArrayBuffer,
 inflate:async v=>Uint8Array.from(zlib.inflateSync(Buffer.from(v,'base64'))).buffer});
vm.runInContext(aircraftPerformancePrelude()+section('  function m4() {','  // client/web/src/gfx/geo.js')+
 section('  var aircraftGeometry = (() => {','  // NF-01 gear')+
 section('  var aqMul = ','  var AIRCRAFT_KEYS')+
 section('  var AIR_PARTS = ','  // ---- hangar fighters')+
 section('  var AIR_FIGHTERS = {','  function fighterDamageModel(f) {')+
 section('  function fighterDamageModel(f) {','  var Aircraft = class {')+
 section('  function registerAircraftFrame(','  function aircraftInstrumentMeta(')+
 section('  function aircraftInstrumentMeta(','  /**\n   * A model\'s cockpit')+
 section('  function imageTexture(','  function partMesh(')+
 section('  var Aircraft = class {','  var DEG8 = ')+
 '\nvar AIR_SIGHT_GLASS=/HUD_GLASS:|A4Reflector|SightGlass|Reflector_Glass|sight_combiner|^hud__|GLASS_HUD|cristal_hud/i;'+
 '\nvar PILOT_MODEL=null;globalThis.audit={decodeAircraftModels,AIRCRAFT_TYPES,AIR_FIGHTERS,Aircraft,AircraftDamage,airClassify,configureAircraftSurfaces};',ctx);
const models=Object.fromEntries(reference.variants.map(v=>[v.type,JSON.parse(fs.readFileSync(path.join(records,v.type+'.json')))]));
const kernel=await WebAssembly.compile(Buffer.from(source.match(/var FLIGHT_CORE_WASM = "([^"]+)"/)[1],'base64'));
for(const id of Object.keys(models))assert.ok(ctx.audit.AIR_FIGHTERS[id],`Actual variant ${id} is not registered`);
await ctx.audit.decodeAircraftModels(models);fs.mkdirSync(outDir,{recursive:true});const summaries=[],catalogTypes={},catalogShells={};
ctx.fixtureProjectiles=Object.fromEntries(['he_30_mgesch','apc_50_pzgr39'].map(id=>[id,JSON.parse(fs.readFileSync('data/projectiles/'+id+'.json'))]));
vm.runInContext('var data={storeModels:{},projectiles:globalThis.fixtureProjectiles};var G4={};var renderer;var storeSocket=()=>null;var localStorage={getItem:()=>null,setItem(){}};'+
 section('  var RE_FACTOR = ','  /** The same charge with its filler')+
 section('    const AIR_GUN_KINDS = {','    function aimBiasOf(air) {')+
 section('    const AIR_STORE_DEFS = {','    const AIR_RADARS = {')+
 section('    const airLoadouts = ','    /** The game shell a store')+
 section('    function airStations(T) {','    /**\n     * Custom armament')+
 section('    const SLOT_ORDER = ','    const storeMeshes = ')+
 section('    const storeMeshes = ','    /** Total mass of the stores still hung')+
 '\nglobalThis.armsAudit={aircraftGuns,aircraftGunMount,mountStores,airLoadouts,AIR_STORE_DEFS,tntEquivalentKg,data};',ctx);
for(const ref of reference.variants){
 const id=ref.type,record=models[id],uploads=[];
 const renderer={mesh(data){const mesh={data:Float32Array.from(data)};uploads.push(mesh);return mesh;},freeMesh(){}};
 ctx.renderer=renderer;
 const memory=new WebAssembly.Memory({initial:2});
 const api={memory,state_ptr:()=>0,state_len:()=>80,aero_state_ptr:()=>320,aero_state_len:()=>48,core_version:()=>213,set_damage(){}};
 const plane=new ctx.audit.Aircraft(renderer,api,id);assert.ok(plane.type.model,'Actual decoder rejected native record');
 const geo=plane.type.geometry(),pieces=[],table=[],binary=[];let offset=0;
 const add=(name,data,partNames,mover=null,origin=null)=>{
  if(!data?.length)return;const b=Buffer.from(data.buffer,data.byteOffset,data.byteLength);
  table.push({name,offset,floats:data.length,parts:partNames,mover,origin});binary.push(b);offset+=b.length;
 };
 for(const [field,group]of [['body','body'],['cockpit','cockpit'],['glass','glass']])
  add(field,geo[field],record.parts.filter(p=>p.group===group&&p.mover==null).map(p=>p.name));
 for(const side of ['l','r'])add('wing_'+side,geo.wings[side],record.parts.filter(p=>p.group==='wing_'+side&&p.mover==null).map(p=>p.name));
 geo.controls.forEach((c,k)=>add('control:'+k+':'+c.name,c.data,record.parts.filter(p=>p.mover===c.mover&&(c.glass?p.group==='glass':p.group!=='glass')).map(p=>p.name),c.mover));
 for(const group of ['internalModules','crewModules'])for(const [k,m]of (geo.imported?.[group]||[]).entries())add(group+':'+k+':'+m.id,m.data,m.sourceParts);
 const expectedConstructor=record.parts.filter(p=>!['source_excluded','store','mount'].includes(p.group)).reduce((n,p)=>n+p.triangles,0);
 const sourceMeshes=[...plane.pieceNodes.map(n=>n.mesh),plane.body.mesh,plane.cockpit.mesh,plane.glass.mesh,...plane.controls.map(c=>c.node.mesh),...(plane.sourceInternalNodes||[]).map(n=>n.mesh)].filter(Boolean);
 const constructorTriangles=sourceMeshes.reduce((n,m)=>n+m.data.length/39,0),builderTriangles=table.reduce((n,t)=>n+t.floats/39,0);
 assert.equal(builderTriangles,expectedConstructor,'Actual builder loses/duplicates non-store source triangles');
 assert.equal(constructorTriangles,expectedConstructor,'Actual constructor loses/duplicates non-store source triangles');
 assert.ok(plane.sourceInternalNodes?.length>0,'Source internals were not constructed');
 assert.equal(plane.sourceModuleParts.has('pilot'),true,'Native source crew failed to suppress fallback pilot box');
 const guns=ctx.armsAudit.aircraftGuns(id);
 assert.equal(guns.length,record.weaponContract.gunSockets.length);
 assert.deepEqual(Array.from(guns,g=>g.ammo),id==='me262'?[100,100,80,80]:id==='me262a2a'?[100,100]:[32]);
 for(let i=0;i<guns.length;i++){
  assert.deepEqual(Array.from(guns[i].mount),record.spec.sourceSockets[record.weaponContract.gunSockets[i]]);
  assert.equal(guns[i].mounts,undefined,'An independent feed must not cycle among other gun barrels');
 }
 const r4=a=>Array.from(a,v=>Math.round(v*1e4)/1e4),T=plane.type,D=plane.damage;
 const year=Number(T.fighter.era);assert.ok(Number.isInteger(year));
 catalogTypes[id]={name:T.name,year,mass_kg:Math.round(T.airframe[0]),
  parts:D.parts.map(p=>({id:p.id,name:p.name,c:r4(p.c),h:r4(p.h),hp:p.max,...(p.armor!=null?{armor:p.armor}:{}),...(p.fire?{fire:p.fire}:{}),...(p.detach?{detach:true}:{}),...(p.parent?{parent:p.parent}:{}),...(p.blastK!=null?{blast_k:p.blastK}:{})})),
  skin:D.skin.map(s=>({c:r4(s.c),h:r4(s.h)})),
  guns:Array.from(guns,g=>({id:g.id,kind:g.kind,ammo:Math.round(g.ammo),rpm:g.rpm,owner:g.owner,shells:Array.from(g.belt)})),
  loadouts:Array.from(ctx.armsAudit.airLoadouts(id),(lo,index)=>{
   const stores={};for(const [sid,n]of lo[1])stores[sid]=(stores[sid]||0)+n;
   const kinds=Object.keys(stores).map(s=>ctx.armsAudit.AIR_STORE_DEFS[s]?.kind),cls=kinds.includes('agm')?'agm':kinds.some(k=>['bomb','rocket','pod'].includes(k))?'ground':kinds.includes('aam')?'aam':'guns';
   return{index,name:lo[0],class:cls,stores};
  })};
 for(const gun of guns)for(const id of gun.belt){const s=ctx.armsAudit.data.projectiles[id],tnt=ctx.armsAudit.tntEquivalentKg(s);
  catalogShells[id]={mass_kg:+(s.mass_kg??0).toFixed(5),speed_ms:Math.round(s.muzzle_velocity_ms||0),filler_kg:+tnt.toFixed(5),caliber_mm:s.caliber_mm||0,incendiary:tnt>0||/incend|hefi|hei|_i_|brand/i.test(`${id} ${s.name||''}`)};
 }
 const stores=[];
 for(let index=0;index<=1;index++){
  const mounted=ctx.armsAudit.mountStores(plane,id,index);plane.root.update();
  const count=id==='me262'?24:id==='me262a2a'?2:0;
  assert.equal(mounted.items.length,index===0?0:count);
  assert.equal(plane.storeNodes.filter(n=>n.sourceMount).length,index===0||count===0?0:2);
  assert.ok(mounted.items.every(it=>it.count===1&&it.sourceStore&&!it.pylon&&!it.rack));
  stores.push({index,items:mounted.items.map(it=>({source:it.sourceStore.id,origin:Array.from(it.p),socket:it.sourceSocket,triangles:it.node.mesh.data.length/39,owner:it.owner})),
   nodes:plane.storeNodes.map(n=>({mount:n.sourceMount||null,source:n.sourceStore?.id||null,triangles:n.mesh.data.length/39,local:Array.from(n.local)}))});
 }
 for(const group of ['sourceStores','sourceMounts'])for(const [k,m]of (geo.imported?.[group]||[]).entries())add(group+':'+k+':'+m.id,m.data,m.sourceParts,null,m.p);
 const fullBuilderTriangles=table.reduce((n,t)=>n+t.floats/39,0),fullConstructorTriangles=constructorTriangles+plane.storeNodes.reduce((n,s)=>n+s.mesh.data.length/39,0);
 assert.equal(fullBuilderTriangles,record.parts.filter(p=>p.group!=='source_excluded').reduce((n,p)=>n+p.triangles,0));
 assert.equal(fullConstructorTriangles,fullBuilderTriangles,'Real mounted stores and original racks must account for every visible source face exactly once');
 const frames=[];
 for(const f of ref.frames){
  const values=f.values,s=plane.cur;s.fill(0);s[6]=1;s[1]=1000;s[35]=1000;s[15]=.07+.14*(values.slat||0);
  s[24]=values.pitch||0;s[25]=values.roll||0;s[26]=values.yaw||0;s[34]=values.flap||0;
  for(const [param,slot]of Object.entries(record.animationContract.aeroStateSlots))plane.aero[slot]=values[param]??1;
  s[33]=(plane.aero[36]+plane.aero[38])/2;
  plane._canopyHold=true;plane.canopyK=values.canopy||0;
  if(f.clip==='wheel_spin'){
   const radius=plane.type.fighter.spec.gear.main.r;s[1]=2;s[35]=2;s[75]=10;
   s[23]=f.time===0?0:values.wheel_spin*Math.PI*2*radius/10;
   if(f.time===0)plane._wheelClock=1;
  }else {plane._wheelClock=1;s[23]=0;}
  plane.prev.set(s);plane.pose(1);plane.root.update();
  frames.push({...f,root:Array.from(plane.root.local),wheelPhaseByMover:Object.fromEntries(plane.controls.filter(c=>c.param==='wheel_spin').map(c=>{
    assert.equal(c.wheelRadius,record.movers[c.mover].wheelRadius);return[c.mover,((plane._wheelTravel||0)/c.wheelRadius/(Math.PI*2))%1];
   })),controls:plane.controls.map(c=>({mover:c.mover,name:c.name,glass:!!c.glass,parent:c.parent??null,local:Array.from(c.node.local),visible:c.node.visible}))});
 }
 plane.cur.fill(0);plane.cur[6]=1;plane.cur[1]=2;plane.cur[35]=2;plane.cur[33]=1;plane.prev.set(plane.cur);
 for(const slot of [36,37,38,39])plane.aero[slot]=1;
 plane._wheelClock=1;plane.canopyK=0;plane.pose(1);plane.root.update();
 const grounded={root:Array.from(plane.root.local),controls:plane.controls.map(c=>({mover:c.mover,name:c.name,parent:c.parent??null,local:Array.from(c.node.local)}))};
 // O/X-ray is a visibility projection: retained source module meshes are not
 // replaced by procedural boxes, and repeated pose never reallocates GPU data.
 const allocations=uploads.length;plane.xray=true;plane._showParts();plane.pose(1);assert.equal(uploads.length,allocations);
 const internal=plane.sourceInternalNodes.map(n=>({id:n.sourceModule.id,damageIds:n.damageIds,kind:n.kind,triangles:n.mesh.data.length/39,visible:n.visible}));
 const kernelSigns=[];
 const transform=(m,p)=>[0,1,2].map(k=>m[k]*p[0]+m[k+4]*p[1]+m[k+8]*p[2]+m[k+12]);
 async function fly(axis,input){
  const a=(await WebAssembly.instantiate(kernel,{math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:()=>0,landable:()=>1}})).exports;
  assert.equal(a.core_version(),213);a.set_world(1);a.configure_airframe(...plane.type.airframe);ctx.audit.configureAircraftSurfaces(a,plane.type);
  a.configure(0,45,1,plane.type.gLimit,0);a.configure_control(1,0,.22,1);a.spawn(0,5000,0,0,160,0);
  for(let k=0;k<30;k++)a.step(1/120,0,0,1,.8,axis==='pitch'?input:0,axis==='roll'?input:0,axis==='yaw'?input:0,0);
  return {s:Float32Array.from(new Float32Array(a.memory.buffer,a.state_ptr(),80)),a:Float32Array.from(new Float32Array(a.memory.buffer,a.aero_state_ptr(),48))};
 }
 for(const axis of ['pitch','roll','yaw']){
  const neutral=await fly(axis,0),omegaIndex={pitch:10,roll:12,yaw:11}[axis],controlIndex={pitch:24,roll:25,yaw:26}[axis];
  const c=plane.controls.find(c=>c.param===axis&&(axis==='yaw'||c.sign<0));let trailing=[0,0,Infinity];
  for(let k=0;k<c.data.length;k+=13)if(c.data[k+2]<trailing[2])trailing=Array.from(c.data.slice(k,k+3));
  for(const input of [-1,1]){
   const actual=await fly(axis,input);plane.cur.set(actual.s);plane.aero.set(actual.a);plane.prev.set(plane.cur);plane.pose(1);
   const deflected=transform(c.node.local,trailing);plane.cur[controlIndex]=0;plane.prev.set(plane.cur);plane.pose(1);
   const rest=transform(c.node.local,trailing),component=axis==='yaw'?0:1,delta=deflected[component]-rest[component],omegaDelta=actual.s[omegaIndex]-neutral.s[omegaIndex];
   assert.ok(Math.abs(delta)>1e-4&&Math.abs(omegaDelta)>1e-5);
   assert.equal(Math.sign(omegaDelta),Math.sign(delta)*(axis==='pitch'?-1:1),'Actual source trailing edge disagrees with real native control response');
   kernelSigns.push({axis,input,acceptedControl:actual.s[controlIndex],bodyAngularRateDelta:omegaDelta,trailingEdgeComponent:component,trailingEdgeDeltaM:delta});
  }
 }
 plane.damage.harm('wing_l',1e9,false,()=>1);plane.applyDamage();plane.pose(1);
 const wingLoss=plane.controls.filter(c=>['roll','flap','slat'].includes(c.param)).map(c=>({name:c.name,owner:c.owner,visible:c.node.visible}));
 assert.ok(wingLoss.filter(c=>c.owner==='wing_l').every(c=>!c.visible));assert.ok(wingLoss.filter(c=>c.owner==='wing_r').every(c=>c.visible));
 assert.ok(plane.controls.filter(c=>/Gear_Main_R/.test(c.name)).every(c=>c.node.visible));
 const result={type:id,appSha256:crypto.createHash('sha256').update(source).digest('hex'),recordSha256:ref.record_sha256,
  actualDecoder:true,actualConstructor:true,actualPose:true,gpu:false,fixture:'Accepted-state geometry samples; independent real core213 tests establish four-axis authority',
  constructorTriangles,builderTriangles,fullConstructorTriangles,fullBuilderTriangles,storeMountIntegrationExcluded:false,gunFactory:guns,stores,wingLoss,kernelSigns,uploadCalls:uploads.length,table,frames,grounded,internal,
  legacyBoxFallbackIds:plane.partNodes.map(n=>n.part.id),gear:plane.type.gear,eye:plane.type.eye,sourceModuleParts:[...plane.sourceModuleParts]};
 const dir=path.join(outDir,id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'actual-builder-uploads.f32'),Buffer.concat(binary));
 fs.writeFileSync(path.join(dir,'actual-aircraft-cpu.json'),JSON.stringify(result));
 summaries.push({type:id,constructorTriangles,builderTriangles,fullConstructorTriangles,sourceModuleNodes:internal.length,frames:frames.length,storeMountIntegrationExcluded:false});
}
fs.writeFileSync(path.join(outDir,'me262-accepted-catalog-export.json'),JSON.stringify({types:catalogTypes,shells:catalogShells,
 proof:{actualProductionDecoderConstructorAndGunFactory:true,legacyBoxesNotRenderTriangles:true,appSha256:crypto.createHash('sha256').update(source).digest('hex'),
 nativeSha256:Object.fromEntries(reference.variants.map(v=>[v.type,v.record_sha256])),
 projectileSourceSha256:Object.fromEntries(['he_30_mgesch','apc_50_pzgr39'].map(id=>[id,crypto.createHash('sha256').update(fs.readFileSync('data/projectiles/'+id+'.json')).digest('hex')])),
 customLoadouts:'Actual production customLoadout with empty browser storage; no arbitrary unregistered custom configuration implied'}},null,2)+'\n');
console.log(JSON.stringify({actualProductionClass:true,variants:summaries}));

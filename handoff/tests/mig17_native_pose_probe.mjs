import {aircraftPerformancePrelude} from '../tools/aircraft_performance/runtime.mjs';
// CPU audit of the delivered actual decoder, Aircraft constructor, mesh upload
// calls, damage hierarchy and pose method. No DOM/WebGL or package code runs.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const [recordPath, referencePath, outDir, appPath='handoff/bundle/app.js.html']=process.argv.slice(2);
const source=fs.readFileSync(appPath,'utf8'),record=JSON.parse(fs.readFileSync(recordPath,'utf8'));
const section=(a,b)=>{const p=source.indexOf(a),q=source.indexOf(b,p);assert.ok(p>=0&&q>p,a);return source.slice(p,q);};
const ctx=vm.createContext({console,Float32Array,Float64Array,Uint16Array,Int16Array,Int8Array,Uint8Array,Map,Set,Math,ArrayBuffer,
  inflate:async value=>{const b=zlib.inflateSync(Buffer.from(value,'base64'));return Uint8Array.from(b).buffer;}});
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
await ctx.audit.decodeAircraftModels({mig17f:record});
assert.ok(ctx.audit.AIRCRAFT_TYPES.mig17f.model?.buf,'actual decoder rejected record');
const optic=record.spec.opticsCalibration;
assert.equal(optic.version,4);assert.equal(optic.opaqueSupportWarp,false);
assert.ok(record.spec.eye.every((v,k)=>Math.abs(v-record.spec.eyeSeated[k]-optic.eyeOffset[k])<1e-6));
assert.equal(optic.sourceGeometry.mesh,'glass_source_13');assert.equal(optic.sourceGeometry.alphaMode,'BLEND');
assert.ok(optic.sourceGeometry.alpha>0&&optic.sourceGeometry.alpha<.7);
assert.equal(optic.sourceGeometry.sourceFaceRanges.reduce((n,r)=>n+r[1],0),194);
const uploads=[];
const renderer={mesh(data){const mesh={data:Float32Array.from(data)};uploads.push(mesh);return mesh;}};
const memory=new WebAssembly.Memory({initial:2});
const api={memory,state_ptr:()=>0,state_len:()=>80,aero_state_ptr:()=>320,aero_state_len:()=>48,set_damage(){}};
const plane=new ctx.audit.Aircraft(renderer,api,'mig17f');
const type=plane.type,geo=type.geometry();
vm.runInContext('var data={storeModels:{}};var storeSocket=()=>null;var RE_FACTOR={};'+
  section('    const AIR_STORE_DEFS = {','    const AIR_RADARS = {')+
  section('    function airStations(T) {','    /**\n     * Custom armament')+
  '\nglobalThis.layoutAudit={layoutStores,AIR_LOADOUTS};',ctx);
const stores=ctx.layoutAudit.AIR_LOADOUTS.mig17f.map(loadout=>({name:loadout[0],items:ctx.layoutAudit.layoutStores(type,loadout)}));
for(const loadout of stores){assert.equal(loadout.items.length,2);for(const item of loadout.items){
 assert.ok(item.nativePylon);assert.equal(item.pylon,null);assert.ok(item.owner===`wing_${item.side<0?'l':'r'}`);
 assert.ok(Math.abs(item.mount[1]-(record.spec.stations.inner.y-.015))<1e-6);
}}
const pose=(values={},ground=false)=>{
 const s=plane.cur;s.fill(0);s[6]=1;s[33]=ground?1:1-(values.gear??0);s[34]=values.flap??0;
 s[24]=values.pitch??0;s[25]=values.roll??0;s[26]=values.yaw??0;s[35]=ground?2:100;
 if(ground)s[1]=2;plane.prev.set(s);plane.pose(1);plane.root.update();
 return {root:Array.from(plane.root.local),controls:plane.controls.map(c=>({name:c.name,local:Array.from(c.node.local),visible:c.node.visible}))};
};
fs.mkdirSync(outDir,{recursive:true});
const meshes={body:geo.body,cockpit:geo.cockpit,glass:geo.glass,wing_l:geo.wings.l,wing_r:geo.wings.r};
for(const c of geo.controls)meshes[c.name]=c.data;
const binary=[],table={};let offset=0;
for(const [name,data]of Object.entries(meshes)){table[name]={offset,floats:data.length};const b=Buffer.from(data.buffer,data.byteOffset,data.byteLength);binary.push(b);offset+=b.length;}
fs.writeFileSync(path.join(outDir,'actual-builder-uploads.f32'),Buffer.concat(binary));
const reference=JSON.parse(fs.readFileSync(referencePath,'utf8'));
const clips=reference.clips??reference.animations;
assert.ok(Array.isArray(clips),'unknown reference clips schema');
const frames=[];
for(const clip of clips){
 const name=clip.clip??clip.name;if(!['gear','roll','pitch','yaw','flap'].includes(name))continue;
 const channels=clip.channels;
 const samples=channels[0].samples;
 for(let i=0;i<samples.length;i++){
   const sample=samples[i],value=name==='gear'?sample.value:sample.controlValueFromAngle*(name==='yaw'?(record.sourceBinding?.yawRuntimeSense??1):1);
   frames.push({clip:name,index:i,time_s:sample.time_s,value,...pose({[name]:value})});
 }
}
const neutral=pose(),grounded=pose({},true);
const wasmBytes=Buffer.from(source.match(/var FLIGHT_CORE_WASM = "([^"]+)"/)[1],'base64');
const yawKernel=[];
const yawControl=plane.controls.find(c=>c.param==='yaw');
let trailing=[0,0,Infinity];
for(let i=0;i<yawControl.data.length;i+=13)if(yawControl.data[i+2]<trailing[2])trailing=Array.from(yawControl.data.slice(i,i+3));
const transform=(m,p)=>[0,1,2].map(k=>m[k]*p[0]+m[k+4]*p[1]+m[k+8]*p[2]+m[k+12]);
for(const inputYaw of [-1,1]){
 const {instance}=await WebAssembly.instantiate(wasmBytes,{math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:()=>0,landable:()=>0}});
 const a=instance.exports;assert.equal(a.core_version(),212);a.set_world(1);a.configure_airframe(...type.airframe);ctx.audit.configureAircraftSurfaces(a,type);
 a.configure(0,45,1,type.gLimit,0);a.configure_control(1,0,.22,1);a.configure_envelope(type.gLimit,-3,0,0);a.spawn(0,1500,0,0,180,0);
 for(let n=0;n<30;n++)a.step(1/120,0,0,1,.8,0,0,inputYaw,0);
 const s=new Float32Array(a.memory.buffer,a.state_ptr(),80);
 plane.cur.set(s);plane.prev.set(s);plane.pose(1);
 const deflected=transform(yawControl.node.local,trailing),worldDeflected=transform(plane.root.local,deflected);
 plane.cur[26]=0;plane.prev.set(plane.cur);plane.pose(1);
 const undeformed=transform(yawControl.node.local,trailing),worldUndeformed=transform(plane.root.local,undeformed);
 yawKernel.push({inputYaw,acceptedYawControl:s[26],bodyAngularYaw:s[11],heading:s[18],forwardX:s[48],
   trailingLocalDeltaX:deflected[0]-undeformed[0],trailingWorldDeltaX:worldDeflected[0]-worldUndeformed[0]});
}
const yawConsistent=yawKernel.every(s=>Math.sign(s.bodyAngularYaw)===Math.sign(s.trailingLocalDeltaX));
if(record.sourceBinding?.yawRuntimeSense===-1)assert.ok(yawConsistent,'Actual native yaw and visual deflection disagree');
pose();
const before={};for(const n of plane.pieceNodes)before[n.name]=n.visible;
plane.damage.harm('wing_l',1e9,false,()=>1);plane.applyDamage();pose();
const wingLoss={pieces:plane.pieceNodes.map(n=>({name:n.name,part:n.part,visible:n.visible,triangles:n.mesh?.data.length/39||0})),
 controls:plane.controls.map(c=>({name:c.name,visible:c.node.visible,triangles:c.data.length/39}))};
assert.ok(wingLoss.pieces.filter(n=>n.part.startsWith('wing_l')).every(n=>!n.visible));
assert.ok(wingLoss.pieces.filter(n=>n.part.startsWith('wing_r')).every(n=>n.visible));
assert.ok(wingLoss.controls.filter(c=>/^(roll_l|flap_l)$/.test(c.name)).every(c=>!c.visible));
assert.ok(wingLoss.controls.filter(c=>/^gear_main_r/.test(c.name)).every(c=>c.visible));
const uploadedSources=[...plane.pieceNodes.map(n=>n.mesh),plane.body.mesh,plane.cockpit.mesh,plane.glass.mesh,...plane.controls.map(c=>c.node.mesh)].filter(Boolean);
const info={appSha256:crypto.createHash('sha256').update(source).digest('hex'),recordSha256:crypto.createHash('sha256').update(fs.readFileSync(recordPath)).digest('hex'),
 actualConstructor:true,actualDecoder:true,actualPose:true,gpu:false,uploadCalls:uploads.length,yawKernel,yawConsistent,
 sourceTriangles:Object.values(meshes).reduce((n,a)=>n+a.length/39,0),
 constructorSourceTriangles:uploadedSources.reduce((n,m)=>n+m.data.length/39,0),table,neutral,grounded,frames,wingLoss,
 gear:type.gear,eye:type.eye,canopy:type.canopy,spec:type.fighter.spec,stores,
 damage:{parts:plane.damage.parts.map(({max,detached,...p})=>({...p,hp:max})),skin:type.skin}};
assert.equal(info.constructorSourceTriangles,info.sourceTriangles,'Constructor source upload loses/duplicates geometry');
fs.writeFileSync(path.join(outDir,'actual-aircraft-cpu.json'),JSON.stringify(info));
fs.writeFileSync(path.join(outDir,'accepted-damage-patch.json'),JSON.stringify({type:'mig17f',parts:info.damage.parts,skin:info.damage.skin,
 source:{nativeSha256:info.recordSha256,appSha256:info.appSha256,method:'Actual Aircraft constructor/airHitbox accepted parts and skin, CPU renderer upload audit',
 scope:'Only mig17f type.parts/type.skin; preserve guns/ammo/year/loadouts and all other23types. Existing legacy box model, not visible-triangle combat.'}},null,2)+'\n');
console.log(JSON.stringify({actualConstructor:true,triangles:info.sourceTriangles,uploads:uploads.length,frames:frames.length,gear:info.gear,wingLossPassed:true}));

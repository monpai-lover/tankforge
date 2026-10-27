// Actual current source control/mesh paths in a CPU renderer fixture. This
// verifies drawing and source preservation, not a new native collision model.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {modelUpgradePrelude} from './fixture-model-upgrade.mjs';
import {models,source} from './jet-fixture.mjs';

const sha=data=>createHash('sha256').update(new Uint8Array(data.buffer,data.byteOffset,data.byteLength)).digest('hex');
async function fixture(id){
  const canvas={getContext:()=>new Proxy({},{get:(o,k)=>k in o?o[k]:(()=>{}),set:(o,k,v)=>(o[k]=v,true)})};
  const c=vm.createContext({performance,atob,document:{createElement:()=>canvas},inflate:async blob=>{const bytes=zlib.inflateSync(Buffer.from(blob,'base64'));return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}});
  const a=source.indexOf('  // the C flight core'),b=source.indexOf('  // client/web/src/main.js',a);
  vm.runInContext(modelUpgradePrelude(source)+source.slice(source.indexOf('  function m4()'),source.indexOf('  // client/web/src/game/relief.js'))+source.slice(source.lastIndexOf('\n',a)+1,b)+fs.readFileSync(new URL('../tools/frontline_aircraft_visual.js',import.meta.url),'utf8'),c);
  vm.runInContext(source.slice(source.indexOf('  function registerAircraftFrame('),source.indexOf('  /** The reference types re-created'))+source.slice(source.indexOf('  function imageTexture('),source.indexOf('  function partMesh(')),c);
  await c.decodeAircraftModels({[id]:models[id]});
  let uploads=0,frees=0;
  const renderer={mesh(data){uploads++;return{count:data.length/13,_src:{kind:'mesh',data}};},freeMesh(){frees++;},texture:()=>({}),freeTexture(){}};
  const model=c.createFrontlineAircraftVisual(renderer,id),p=model.plane;p.ensureDetailedInterior?.();p.setXray(false);
  return{c,model,p,dispose(){model.dispose();assert.equal(frees,uploads,id+' releases original and render-subset buffers once');}};
}
const draws=p=>{p.root.update();return new Set(p.root.collect([]));};
function originals(p){
  const rows=[];
  const visit=n=>{if(n.mesh&&!n.hitboxDisabled)rows.push({node:n,mesh:n.mesh,data:n.mesh._src.data,hash:sha(n.mesh._src.data),disabled:!!n.hitboxDisabled,local:Array.from(n.local||[])});for(const child of n.children)visit(child);};visit(p.root);
  return rows;
}
function unchanged(p,before){
  for(const row of before){assert.equal(row.node.mesh,row.mesh);assert.equal(row.mesh._src.data,row.data);assert.equal(sha(row.data),row.hash);assert.equal(!!row.node.hitboxDisabled,row.disabled);assert.deepEqual(Array.from(row.node.local||[]),row.local);}
  const current=originals(p);assert.equal(current.length,before.length);assert.ok(current.every(row=>before.some(old=>old.node===row.node)),'Render-only subsets never add a physical mesh');
}
function toggleFixture(f,keptNames,hiddenNames){
  const {p}=f;p.setXray(false);const normal=draws(p),before=originals(p),native=JSON.stringify([Array.from(p.cur),Array.from(p.aero),p.damage.parts]);
  const modules=p.sourceInternalNodes.map(n=>({node:n,mesh:n.mesh,data:n.mesh._src.data,module:n.sourceModule}));
  p.setXray(true);const open=draws(p);
  for(const name of keptNames){const c=p.controls.find(c=>c.name===name);assert.ok(c,name+' actual controller exists');assert.ok(open.has(c.node),name+' real gear/actuator remains drawn');}
  for(const name of hiddenNames){const c=p.controls.find(c=>c.name===name);assert.ok(c,name+' actual controller exists');assert.ok(open.has(c.node),name+' original door remains as the accepted transparent shell');assert.equal(c.node.aircraftHiddenSkin,false);assert.equal(c.node.kind,6);assert.ok(c.node.aircraftShell>0&&c.node.aircraftShell<1);}
  assert.equal(JSON.stringify([Array.from(p.cur),Array.from(p.aero),p.damage.parts]),native);unchanged(p,before);
  for(const row of modules){assert.ok(p.sourceInternalNodes.includes(row.node));assert.equal(row.node.mesh,row.mesh);assert.equal(row.mesh._src.data,row.data);assert.equal(row.node.sourceModule,row.module);}
  p.setXray(false);assert.deepEqual(draws(p),normal,'Release restores every original draw member');unchanged(p,before);
  return p.mechanismGearView;
}
test('Me262 four-axis source gear stays visible in O while all authored doors/covers become transparent shells and source interiors remain unchanged',async()=>{
  for(const id of ['me262','me262a2a','me262u4']){
    const f=await fixture(id);
    assert.deepEqual([...new Set(f.p.controls.filter(c=>f.c.TFMechanismView.isGearControl(c)).map(c=>c.param))].sort(),['gear_main','gear_main_doors','gear_nose','gear_nose_door']);
    const rows=toggleFixture(f,['CTRL_Gear_Main_L','CTRL_Gear_Main_R','CTRL_Gear_Nose','CTRL_NoseWheelTwist','ACT_Main_L_Cylinder','ACT_Main_L_Rod','ACT_Main_R_Cylinder','ACT_Main_R_Rod','ACT_Nose_Cylinder','ACT_Nose_Rod'],['CTRL_GearCover_Upper_L','CTRL_GearCover_Lower_L','CTRL_GearCover_Upper_R','CTRL_GearCover_Lower_R','CTRL_NoseFrontDoor','CTRL_GearBellyDoor_L','CTRL_GearBellyDoor_R','CTRL_NoseLongDoor']);
    assert.equal(rows.length,18,id+' every leg and door channel classified');assert.ok(f.p.sourceInternalNodes.length>0);f.dispose();
  }
});
test('F104 scalar gear retains real wheels/struts and keeps lowercase geardoor source parts in transparent shells',async()=>{
  const f=await fixture('f104g');const rows=toggleFixture(f,['GEAR_L','GEAR_R','GEAR_NOSE'],['GEAR_DOOR_MAIN_L','GEAR_DOOR_MAIN_R','GEAR_DOOR_NOSE_L','GEAR_DOOR_NOSE_R']);
  const sourceNames=new Set(f.p.type.model.movers.map(m=>m.name));
  assert.equal(new Set(rows.filter(r=>sourceNames.has(r.control.name)).map(r=>r.control.name)).size,7,'All seven authored source gear controllers are classified across material batches');
  assert.equal(f.c.TFMechanismView.mechanicalName('geardoor_002__85'),false);assert.equal(f.c.TFMechanismView.mechanicalName('geardoor_open__87'),false);f.dispose();
});
const triangleHashes=data=>{const rows=[];for(let i=0;i<data.length;i+=39)rows.push(sha(data.subarray(i,i+39)));return rows;};
test('actual mixed MiG17 leg/cover joints use exact original triangle subsets without duplicate physical geometry or pose changes',async()=>{
  const f=await fixture('mig17f'),p=f.p;p.setXray(false);const normal=draws(p),before=originals(p),count=p.meshes.length;
  const expected={gear_main_l:['gear_main_l_source_06__body','gear_main_l_wheel_source_07__body'],gear_main_r:['gear_main_r_source_06__body','gear_main_r_source_10__body','gear_main_r_wheel_source_07__body']};
  p.setXray(true);const open=draws(p);
  for(const [name,parts]of Object.entries(expected)){
    const row=p.mechanismGearView.find(r=>r.control.name===name);assert.ok(row?.node,name+' mixed joint has a render subset');assert.deepEqual(Array.from(row.sourceParts).sort(),parts.slice().sort());
    assert.ok(open.has(row.node)&&open.has(row.control.node));assert.equal(row.control.node.kind,6);assert.ok(row.control.node.aircraftShell>0&&row.control.node.aircraftShell<1);assert.equal(row.node.hitboxDisabled,true);assert.equal(row.node.aircraftMechanismSubset,true);
    const all=new Map();for(const key of triangleHashes(row.control.node.mesh._src.data))all.set(key,(all.get(key)||0)+1);
    for(const key of triangleHashes(row.node.mesh._src.data)){assert.ok(all.get(key)>0,'Every subset triangle retains all original position/normal/material/UV attributes');all.set(key,all.get(key)-1);}
    assert.ok(row.node.mesh.count>0&&row.node.mesh.count<row.control.node.mesh.count);assert.ok(row.control.node.children.includes(row.node));
  }
  unchanged(p,before);p.setXray(false);assert.deepEqual(draws(p),normal);p.setXray(true);assert.equal(p.meshes.length,count,'Repeated O never uploads another subset');p.setXray(false);unchanged(p,before);f.dispose();
});
test('gear-axis recognition and panel names distinguish door actuators from wheel covers',()=>{
  const c=vm.createContext({});vm.runInContext(modelUpgradePrelude(source),c);const view=c.TFMechanismView;
  for(const type of ['gear','tailgear','gear_main','gear_nose','gear_main_doors','gear_nose_door'])assert.equal(view.isGearControl({type}),true,type);
  assert.equal(view.isGearControl({type:'pitch',param:'gear_nose'}),true);assert.equal(view.isGearControl({type:'gearbox'}),false);
  for(const name of ['CTRL_GearCover_Upper_L','CTRL_NoseFrontDoor','leg_cover','wheel_cover','outer_cap','geardoor_open__87'])assert.equal(view.mechanicalName(name),false,name);
  for(const name of ['DoorActuator','gear_door_rod','gear_main_wheel','ACT_Nose_Cylinder','NoseFork'])assert.equal(view.mechanicalName(name),true,name);
});

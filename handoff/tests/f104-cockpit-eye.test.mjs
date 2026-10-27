import {modelUpgradePrelude} from './fixture-model-upgrade.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {models, source} from './jet-fixture.mjs';

const helper=fileURLToPath(new URL('../tools/repair_f104_cockpit.py',import.meta.url));
// The installed fixture may already contain this repair. Recreate just its
// documented previous eye metadata to exercise the migration on either version.
const input=JSON.parse(JSON.stringify(models.f104g));
if(input.spec.opticsCalibration.eyeRevision?.date==='2026-10-25'){
  input.spec.eye=input.spec.opticsCalibration.eyeRevision.previousEye.slice();
  input.spec.sight.eye=input.spec.eye.slice();
  input.spec.opticsCalibration.eyeOffset=[0,-.089594,.1];
  delete input.spec.opticsCalibration.eyeRevision;
}
const result=spawnSync(process.env.TF_TEST_PYTHON||'python3',['-c',
  "import json,runpy,sys; m=runpy.run_path(sys.argv[1]); print(json.dumps(m['repair_metadata'](json.load(sys.stdin))))",helper],
  {input:JSON.stringify(input),encoding:'utf8',maxBuffer:16*1024*1024});
assert.equal(result.status,0,result.stderr);
const repaired=JSON.parse(result.stdout);
// JSON's numeric zero has no geometry distinction; normalize JS's -0 for metadata comparison.
const original=input;

test('F-104 eye moves rearward 24cm while every non-camera model value remains identical',()=>{
  assert.deepEqual(repaired.spec.eye,[0,.520406,5.948]);
  assert.deepEqual(repaired.spec.sight.eye,repaired.spec.eye);
  assert.ok(Math.abs(original.spec.eye[2]-repaired.spec.eye[2]-.24)<1e-12);
  for(const k of Object.keys(original))if(k!=='spec')assert.deepEqual(repaired[k],original[k],k);
  for(const k of Object.keys(original.spec))if(!['eye','sight','opticsCalibration'].includes(k))assert.deepEqual(repaired.spec[k],original.spec[k],k);
  assert.deepEqual(repaired.spec.sight.points,models.f104g.spec.sight.points);
  assert.deepEqual(repaired.spec.eyeSeated.map((v,k)=>+(v+repaired.spec.opticsCalibration.eyeOffset[k]).toFixed(6)),repaired.spec.eye);
  assert.ok(repaired.spec.opticsCalibration.eyeRevision.seatTriangleClearanceM>.08);
});

test('actual imported Aircraft constructor and camera use the repaired eye with retained geometry',async()=>{
  const c=vm.createContext({performance,atob,document:{createElement:()=>({getContext:()=>({fillRect(){}})})},inflate:async b=>{const v=zlib.inflateSync(Buffer.from(b,'base64'));return v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength);}});
  const a=source.indexOf('  // the C flight core'),b=source.indexOf('  // client/web/src/main.js',a);
  vm.runInContext(modelUpgradePrelude(source)+source.slice(source.indexOf('  function m4()'),source.indexOf('  // client/web/src/game/relief.js'))+source.slice(source.lastIndexOf('\n',a)+1,b)+fs.readFileSync(new URL('../tools/frontline_aircraft_visual.js',import.meta.url),'utf8'),c);
  const importStart=source.indexOf('  function registerAircraftFrame('),importEnd=source.indexOf('  /** The reference types re-created',importStart);
  vm.runInContext(source.slice(importStart,importEnd),c);
  vm.runInContext(source.slice(source.indexOf('  function imageTexture('),source.indexOf('  function partMesh(')),c);
  await c.decodeAircraftModels({f104g:repaired});
  const renderer={mesh:data=>({count:data.length/13,_src:{data}}),texture:()=>({}),freeTexture(){},gl:{deleteTexture(){}},freeMesh(){}};
  const model=c.createFrontlineAircraftVisual(renderer,'f104g'),p=model.plane;
  assert.ok(p instanceof c.Aircraft&&p.imported&&p.meshes.some(m=>m.count>1000));
  assert.deepEqual(Array.from(p.cockpitEye),repaired.spec.eye);
  const s=Array(80).fill(0);s[1]=1000;s[6]=1;s[42]=s[46]=s[50]=1;s[35]=1000;
  model.accept({unit:{battle:1,unit:1,life:1},aircraft:'f104g',state:s,aero:Array(48).fill(0),damage:{parts:p.damage.parts.map(q=>[q.max,0])},pos:[0,1000,0],alive:true,team:'blue',guns:[],stores:[],fuel:{kg:1000,max:1200},epoch:1,resource_revision:1},1);
  model.pose(.016);p.state.camera=1;
  const cam=p.camera(.016,()=>0),local=p.localPoint(cam.camPos);
  assert.ok(local.every((v,k)=>Math.abs(v-repaired.spec.eye[k])<1e-4));
  assert.ok(p.sightGlass.length>=3&&p.sightGlass.every(q=>q[2]>local[2]+.5));
  model.dispose();
});

test('actual HUD suppresses both generic DOM steering marks only in the cockpit',()=>{
  const a=source.indexOf('    function updateAirHud('),b=source.indexOf('      // the pipper (computed',a);
  const src=source.slice(a,b)+'\n    }';
  const c=vm.createContext({canvas:{clientWidth:1000},project:()=>[0,0,1],airEl:{aim:{hidden:false,style:{}},nose:{hidden:false,style:{}}},G4:{air:{active:true,plane:{state:{camera:1},position:[0,0,0],hudState:()=>({aim:[0,0,1],nose:[0,0,1]})}}}});
  vm.runInContext(src,c);c.updateAirHud([],1000,600);
  assert.equal(c.airEl.aim.hidden,true);assert.equal(c.airEl.nose.hidden,true);
  c.G4.air.plane.state.camera=0;c.updateAirHud([],1000,600);
  assert.equal(c.airEl.aim.hidden,false);assert.equal(c.airEl.nose.hidden,false);
  c.G4.air.plane.state.camera=1;c.updateAirHud([],1000,600);
  assert.equal(c.airEl.aim.hidden,true);assert.equal(c.airEl.nose.hidden,true);
});

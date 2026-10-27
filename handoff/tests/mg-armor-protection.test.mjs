import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {rendererSink} from '../../client/web/tools/hit-mesh-capture.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
function embedded(){
  const dir=path.join(root,'handoff/bundle'),raw=fs.existsSync(path.join(dir,'data.line'))?fs.readFileSync(path.join(dir,'data.line')):zlib.gunzipSync(Buffer.concat(fs.readdirSync(dir).filter(n=>n.startsWith('data.line.gz.part')).sort().map(n=>fs.readFileSync(path.join(dir,n)))));
  function field(name){const marker=Buffer.from(JSON.stringify(name)+':');let i=raw.indexOf(marker)+marker.length;assert.ok(i>=marker.length,name);const start=i;let depth=0,quote=false,escape=false;for(;i<raw.length;i++){const b=raw[i];if(quote){if(escape)escape=false;else if(b===92)escape=true;else if(b===34)quote=false;continue;}if(b===34)quote=true;else if(b===123||b===91)depth++;else if((b===125||b===93)&&--depth===0)return JSON.parse(raw.subarray(start,i+1));}throw Error('unterminated '+name);}
  return Object.fromEntries(['materials','designCatalog','terrains','projectiles','machineGuns','vehicles','surfaceCatalog'].map(k=>[k,field(k)]));
}
// Original stock-engineering cohort with reviewed foldable source packets.
// This suite does not call the production installation hook, which also adds
// supplemental screen engineering. Final screen installation and its barrel
// descendants are exercised by the canonical CPU and native surface suites.
const data=embedded(),fold=read('handoff/qa/foldable-surface-packets-20261026.json');Object.assign(data.surfaceCatalog,fold);
const patch=path.join(root,'handoff/tools/patch_verified_surface_armor.py'),app=path.join(root,'handoff/bundle/app.js.html'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'tf-mg-armor-'));
let source=fs.readFileSync(app,'utf8');
try{if(fs.existsSync(patch)&&process.env.TF_MG_ARMOR_UNPATCHED!=='1'){const out=path.join(temp,'candidate.html'),p=spawnSync(process.env.TF_TEST_PYTHON||(process.platform==='win32'?'python':'python3'),[patch,'--input',app,'--output',out],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);source=fs.readFileSync(out,'utf8');}}
finally{assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));assert.match(path.basename(temp),/^tf-mg-armor-/);fs.rmSync(temp,{recursive:true,force:true});}
const c=vm.createContext({console,atob,btoa,TextEncoder,TextDecoder,performance,Float32Array,Float64Array,Uint32Array,Uint8Array,Uint16Array,Int32Array,Int16Array,Int8Array,ArrayBuffer,DataView,Map,Set,WeakMap,WeakSet,structuredClone});
vm.runInContext(source.replace(/^<script>/,'').split('  // client/web/src/main.js')[0]+'globalThis.A={buildTank,buildInterior,makeLoadout,generatedTurretParts,setCrewModel,setMgModels,Renderer,Combat,DesignCore,normalizeSurfacePacket,bulletShell};})();',c);
const A=c.A;A.setCrewModel(read('client/web/assets/crew_model.json'));A.setMgModels(read('client/web/assets/mg_models.json'));
const wasm=fs.readFileSync(path.join(root,'target/wasm32-unknown-unknown/release/tg_design_wasm.wasm')),compiled=new WebAssembly.Module(wasm);
const body=()=>({ex:[1,0,0],ey:[0,1,0],ez:[0,0,1],origin:()=>[0,0,0],localPoint:p=>p.slice(),worldPoint:p=>p.slice()});
const plain=v=>JSON.parse(JSON.stringify(v));
let entity=1;
function actor(id,route="candidate"){const core=new A.DesignCore(new WebAssembly.Instance(compiled,{}),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)}),combat=new A.Combat(core,data.machineGuns),sink=rendererSink(),renderer=Object.assign(Object.create(A.Renderer.prototype),{gl:sink.gl,_live:new Set(),_texSrc:new Map(),lost:false});if(route!=="legacy"){combat.setSurfaceCatalog(data.surfaceCatalog,renderer);if(route==="raw")combat.surfaceOwner.packet=spec=>combat.surfaceOwner.packets[spec];}const bundle=combat.prepare(id,data.vehicles[id]),fresh=combat.fresh(id,bundle),loadout=A.makeLoadout(id,bundle,data.projectiles,data.machineGuns),model=A.buildTank(renderer,loadout,A.generatedTurretParts),interior=A.buildInterior(renderer,model,loadout,bundle.modules,bundle.crew);model.setFold?.(0);model.root.update();const record=route==="legacy"?null:combat.registerSurfaceActor(id,id,{battle:92,entity:entity++,life:1},model,body());if(record)assert.equal(record.available,true,record.detail||record.reason);return{core,combat,bundle,model,interior,record,state:fresh.state,shoot(start,end,shell=A.bulletShell(data.machineGuns.mg34)){const d=end.map((v,i)=>v-start[i]),l=Math.hypot(...d),report=(route==="legacy"?core.combatShoot.bind(core):core.combatSurfaceShoot.bind(core))(id,this.state,{shell,origin:start,dir:d.map(v=>v/l),speed_ms:shell.muzzle_velocity_ms,distance_m:100,seed:'8',turret_yaw:0},route==="legacy"?null:end);this.state=report.state;return report;},dispose(){combat.surfaceOwner?.retire();interior.dispose();model.dispose();}};}

for(const[id,start,end,ref]of [
  ['de_pz3_j',[12,1.82,-.35],[-12,1.82,-.35],'turret_side_r'],
  ['de_pz4_h',[-12,1.9,.55],[12,1.9,.55],'turret_side_l'],
  ['us_m4a3_75w',[.45,2.09,12],[.45,2.09,-12],'gun_mantlet'],
  ['su_t34_85',[.5,1.8,12],[.5,1.8,-12],'turret_front'],
])test(`${id}: visible authored armor shields crew from a real MG bullet`,()=>{const a=actor(id);try{const before=plain(a.state.crew),r=a.shoot(start,end);assert.ok(r.layers.some(l=>l.plate===ref&&!l.passed),`${ref} must charge its existing authored resistance; got ${r.outcome} ${JSON.stringify(r.layers)}`);assert.deepEqual(plain(r.state.crew),before,'visible closed armor protects crew');assert.ok(!r.events.includes('unsupported_surface_resistance'),'reviewed face is resolved armor');}finally{a.dispose();}});

test('only pinned reviewed source features gain a registered module or explicit fitting response',()=>{const registry=read('handoff/qa/verified-surface-armor-registry-20261026.json');let resolved=0,quarantined=0;for(const packet of Object.values(data.surfaceCatalog)){const raw=JSON.parse(packet.catalog),p=A.normalizeSurfacePacket(packet),next=JSON.parse(p.catalog),review=registry.specs[raw.specId];for(const d of raw.declarations.filter(d=>d.resistancePolicy==='unsupported')){const mapped=next.declarations.filter(n=>n.meshKey===d.meshKey&&n.first>=d.first&&n.first+n.count<=d.first+d.count);assert.ok(mapped.length);for(const n of mapped){if(n.resistancePolicy==='no_authored_armor'){const rule=review.overrides.find(r=>r.declarationKey===d.key),run=rule?.runs.find(r=>n.first>=r.first&&n.first+n.count<=r.first+r.count);assert.ok(run&&(run.moduleRef||run.decoration===true)&&run.reason,raw.specId+': nonarmor requires an explicit pinned source decision');assert.equal(n.moduleRef,run.moduleRef||null);assert.equal(n.role,run.moduleRef?'module':'decoration');resolved++;}else if(n.role==='unknown'){assert.equal(n.resistancePolicy,'unsupported');assert.equal(n.armorBinding.status,'unknown');quarantined++;}}}}assert.ok(resolved>100);assert.ok(quarantined>100,'unreviewed surfaces retain explicit quarantine');});

test('all 26 packets preserve reviewed declarations, exact vertex payloads and accepted engineering',()=>{
  const trust=read('data/barrel-shapes/index.json'),preScreen=new Set(['de_pz4_h','de_panther_g','de_panther_f']);
  const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(Object.keys(data.surfaceCatalog).length,26);
  for(const[id,packet]of Object.entries(data.surfaceCatalog)){
    const before=JSON.parse(packet.catalog),p=A.normalizeSurfacePacket(packet),after=JSON.parse(p.catalog);
    assert.equal(p.payloads,packet.payloads,id);
    assert.deepEqual(plain(after.acceptedAnatomy),plain(before.acceptedAnatomy),id);
    for(const d of before.declarations.filter(d=>d.resistancePolicy!=='unsupported'))assert.deepEqual(plain(after.declarations.find(n=>n.key===d.key)),plain(d),id+':'+d.key);
    for(const l of after.layers){const a=after.acceptedAnatomy.armor.find(a=>a.id===l.armorRef);assert.equal(l.authoredThicknessMm,a.thickness_mm,id);assert.equal(l.authoredMaterial,a.material,id);}
    if(p.catalogHash===packet.catalogHash)assert.deepEqual(plain(p.variants),plain(packet.variants),id+' unchanged parents retain exact variant contents');
    if(preScreen.has(id)){
      // These three original-engineering parents deliberately cannot reuse
      // approvals belonging to the production supplemental-screen parents.
      assert.equal(p.variants.length,0,id+' pre-screen parent has no current descendant');
      assert.equal(p.disabledVariantReason,'modified_catalog_has_no_trusted_barrel_variant_parent');
      continue;
    }
    const current=trust.variants.filter(r=>r.specId===id&&r.parentStockManifestHash===p.manifestHash&&r.parentStockCatalogHash===p.catalogHash);
    assert.equal(p.variants.length,packet.variants.length,id+' retains every approved physical cut');
    assert.equal(p.variants.length,current.length,id+' exact current trusted parent');
    assert.ok(current.length>0,id+' must have a current trusted approval');
    for(const v of p.variants){
      const record=JSON.parse(v.record),pinned=current.find(r=>r.shapeId===record.shapeId&&r.shapeHash===record.shapeHash);
      assert.ok(pinned,id+' descendant shape identity belongs to the current trust bank');
      assert.deepEqual(record,pinned,id+' complete pinned record');
      assert.equal(v.recordHash,trust.recordFiles[record.shapeId],id+' pinned record file');
      assert.equal(hash(v.record),v.recordHash,id+' record bytes');
      assert.equal(fs.readFileSync(path.join(root,'data/barrel-shapes',v.recordHash+'.json'),'utf8'),v.record,id+' current trust artifact bytes');
      const body={...record};delete body.shapeHash;
      assert.equal(hash(canonical(body)),record.shapeHash,id+' canonical shape hash');
      assert.equal(record.parentStockManifestHash,p.manifestHash,id+' parent manifest');
      assert.equal(record.parentStockCatalogHash,p.catalogHash,id+' parent catalog');
      assert.equal(record.targetRegistrationHash,after.targetRegistrationHash,id+' current target engineering');
      assert.equal(record.damagedManifestHash,v.manifestHash,id+' descendant manifest pin');
      assert.equal(record.damagedCatalogHash,v.catalogHash,id+' descendant catalog pin');
      assert.equal(hash(v.manifest),v.manifestHash,id+' descendant manifest bytes');
      assert.equal(hash(v.catalog),v.catalogHash,id+' descendant catalog bytes');
    }
  }
});

test('changed source bytes cannot reuse a trusted registry entry or cached packet',()=>{const packet=data.surfaceCatalog.de_pz3_j;const changed={...packet,catalog:packet.catalog+' '};const p=A.normalizeSurfacePacket(changed);assert.equal(p.catalog,changed.catalog);assert.equal(p.armorBindingReview.sourcePinned,false);assert.equal(p.armorBindingReview.mappedDeclarations,0);});

test('repeated canonical-state machine-gun hits cannot accumulate hidden crew damage behind verified armor',()=>{const a=actor('de_pz3_j');try{const before=plain(a.state.crew);for(let i=0;i<12;i++){const r=a.shoot([12,1.82,-.35],[-12,1.82,-.35],A.bulletShell(data.machineGuns.mg34,i%2===1));assert.deepEqual(plain(r.state.crew),before);assert.equal(r.layers[0].passed,false);assert.equal(r.impact_state.remaining_pen_mm,0);}}finally{a.dispose();}});

test('high penetration AP still traverses unambiguous verified faces and wounds actual crew',()=>{for(const[id,start,end]of [['de_pz3_j',[12,1.82,-.35],[-12,1.82,-.35]],['us_m4a3_75w',[-12,2.09,.45],[12,2.09,.45]],['su_t34_85',[.5,1.8,12],[.5,1.8,-12]]]){const a=actor(id);try{const r=a.shoot(start,end,data.projectiles.apfsds_125_3bm22);assert.ok(r.layers.some(l=>l.passed),id);assert.ok(r.state.crew.some(hp=>hp<100),id+' real penetrating core or spall reaches crew '+JSON.stringify({events:r.events,layers:r.layers,contacts:r.primary_geometry_contacts.map(c=>({role:c.physicalRole,mesh:c.meshId,triangle:c.triangleId,point:c.point}))}));}finally{a.dispose();}}});

test('the unambiguous Sherman side retains actual legacy high-AP vulnerability while resolving raw unknowns',()=>{const results={};for(const route of ['raw','legacy','candidate']){const a=actor('us_m4a3_75w',route);try{results[route]=a.shoot([-12,2.09,.45],[12,2.09,.45],data.projectiles.apfsds_125_3bm22);}finally{a.dispose();}}assert.ok(results.raw.events.includes('unsupported_surface_resistance'));for(const route of ['legacy','candidate']){const r=results[route];assert.ok(r.layers.some(l=>l.plate==='turret_side_l'&&l.passed),route);assert.ok(r.state.crew.some(hp=>hp<100),route);assert.ok(!r.events.includes('rejected_impact_contact'),route);}});

test('a real open turret aperture and directly exposed crew remain vulnerable',()=>{const a=actor('us_m10');try{const r=a.shoot([.15,12,-.4],[.15,1.9,-.4]);assert.ok(r.state.crew.some(hp=>hp<100),'the open fighting compartment is not filled with invented armor');assert.equal(r.primary_geometry_contacts[0].physicalRole,'crew','the actual opening reaches exposed crew before any later hull contact');}finally{a.dispose();}});

test('an actual reviewed decorative fitting gains no main armor resistance',()=>{const a=actor('de_pz3_j');try{const packet=a.combat.surfaceOwner.packet('de_pz3_j'),catalog=JSON.parse(packet.catalog),d=catalog.declarations.find(d=>d.role==='decoration'&&/:part:3(?::mirror:\d+)?$/.test(d.sourceKey));assert.ok(d);const buffer=a.record.buffers.find(b=>'mesh:'+b.path===d.meshKey),p=new Float32Array(buffer.words.buffer,buffer.words.byteOffset,buffer.words.length),M=buffer.node.world,t=d.first,vs=[0,1,2].map(k=>[0,1,2].map(r=>M[12+r]+[0,1,2].reduce((n,j)=>n+M[j*4+r]*p[t*9+k*3+j],0))),center=[0,1,2].map(r=>vs.reduce((n,v)=>n+v[r],0)/3),u=vs[1].map((v,i)=>v-vs[0][i]),v=vs[2].map((v,i)=>v-vs[0][i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n),r=a.shoot(center.map((v,i)=>v+n[i]/length*.001),center.map((v,i)=>v-n[i]/length*.001));assert.equal(r.layers.length,0);assert.ok(r.primary_geometry_contacts.some(c=>c.physicalRole==='decoration'));}finally{a.dispose();}});

test('mirrored source turret panels keep their own engineering under rotated poses',()=>{for(const yaw of [-Math.PI/2,Math.PI/2]){const a=actor('de_pz3_j');try{a.model.turrets[0].node.yaw=yaw;a.model.root.update();assert.equal(a.combat.surfaceOwner.pose('de_pz3_j',null).available,true);const buffer=a.record.buffers.find(b=>b.path.endsWith('turret_shell')),p=new Float32Array(buffer.words.buffer,buffer.words.byteOffset,buffer.words.length),M=buffer.node.world;for(const[t,ref]of [[19,'turret_side_r'],[23,'turret_side_l']]){const vs=[0,1,2].map(k=>[0,1,2].map(r=>M[12+r]+[0,1,2].reduce((n,j)=>n+M[j*4+r]*p[t*9+k*3+j],0))),center=[0,1,2].map(r=>vs.reduce((n,v)=>n+v[r],0)/3),u=vs[1].map((v,i)=>v-vs[0][i]),v=vs[2].map((v,i)=>v-vs[0][i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...n),start=center.map((v,i)=>v+n[i]/length*.02),end=center.map((v,i)=>v-n[i]/length*.02),r=a.shoot(start,end);assert.ok(r.layers.some(l=>l.plate===ref&&!l.passed),ref+' yaw '+yaw);}}finally{a.dispose();}}});

test('all 26 exact stock packets register against their actual rendered model',()=>{for(const id of Object.keys(data.surfaceCatalog)){const a=actor(id);try{assert.equal(a.record.available,true,id);const packet=a.combat.surfaceOwner.packet(id);assert.ok(packet.armorBindingReview);assert.equal(packet.armorBindingReview.sourcePinned,true,id);assert.equal(packet.armorBindingReview.quarantinedDeclarations,JSON.parse(packet.catalog).declarations.filter(d=>d.resistancePolicy==='unsupported').length,id);}finally{a.dispose();}}});

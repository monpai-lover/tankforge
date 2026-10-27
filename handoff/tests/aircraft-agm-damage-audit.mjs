// Read-only measurements of delivered AGM definitions and actual combat owners.
// No damage coefficients or catalog values are changed by this audit.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {rendererSink} from '../../client/web/tools/hit-mesh-capture.mjs';
import {mountedDetailsPrelude} from './fixture-model-upgrade.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const appPath=process.env.TF_AGM_APP||path.join(root,'handoff/bundle/app.js.html');
const app=fs.readFileSync(appPath,'utf8'),profile=read('data/aircraft/frontline.json');
const digest=x=>createHash('sha256').update(x).digest('hex');
const output=process.env.TF_AGM_AUDIT_DIR||'D:/TankForge-validation/fuel-100-20261027/agm-damage';
fs.mkdirSync(output,{recursive:true});

function embedded(){
 const dir=path.join(root,'handoff/bundle'),raw=fs.existsSync(path.join(dir,'data.line'))?fs.readFileSync(path.join(dir,'data.line')):zlib.gunzipSync(Buffer.concat(fs.readdirSync(dir).filter(n=>n.startsWith('data.line.gz.part')).sort().map(n=>fs.readFileSync(path.join(dir,n)))));
 function field(name){
  const marker=Buffer.from(JSON.stringify(name)+':');let i=raw.indexOf(marker)+marker.length;assert.ok(i>=marker.length,name);const start=i;let depth=0,quote=false,escape=false;
  for(;i<raw.length;i++){const b=raw[i];if(quote){if(escape)escape=false;else if(b===92)escape=true;else if(b===34)quote=false;continue;}if(b===34)quote=true;else if(b===123||b===91)depth++;else if((b===125||b===93)&&--depth===0)return JSON.parse(raw.subarray(start,i+1));}
  throw Error('unterminated embedded field '+name);
 }
 return Object.fromEntries(['materials','designCatalog','terrains','projectiles','machineGuns','vehicles','surfaceCatalog'].map(k=>[k,field(k)]));
}
function throughSemicolon(start){
 let depth=0,quote=null,escape=false,line=false,block=false;
 for(let i=start;i<app.length;i++){const c=app[i],n=app[i+1];
  if(line){if(c==='\n')line=false;continue;}if(block){if(c==='*'&&n==='/'){block=false;i++;}continue;}
  if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote=null;continue;}
  if(c==='/'&&n==='/'){line=true;i++;continue;}if(c==='/'&&n==='*'){block=true;i++;continue;}
  if(c==='"'||c==="'"||c==='`'){quote=c;continue;}if('([{'.includes(c))depth++;else if(')]}'.includes(c))depth--;
  if(c===';'&&depth===0)return app.slice(start,i+1);
 }
 throw Error('unterminated source statement');
}
const globals={console,atob,btoa,TextEncoder,TextDecoder,performance,Float32Array,Float64Array,Uint32Array,Uint8Array,Uint16Array,Int32Array,Int16Array,Int8Array,ArrayBuffer,DataView,Map,Set,WeakMap,WeakSet,structuredClone};
const c=vm.createContext(globals),mainAt=app.indexOf('  // client/web/src/main.js');assert.ok(mainAt>0);
vm.runInContext(app.replace(/^<script>/,'').split('  // client/web/src/main.js')[0]+'globalThis.A={buildTank,buildInterior,makeLoadout,generatedTurretParts,setCrewModel,setMgModels,Renderer,Combat,DesignCore,heContactEffects,flushHeContactBursts,RE_FACTOR,tntEquivalentKg};})();',c);
const A=c.A,data=embedded();A.setCrewModel(read('client/web/assets/crew_model.json'));A.setMgModels(read('client/web/assets/mg_models.json'));
const warheadAt=app.indexOf('    function storeWarhead('),warheadEnd=app.indexOf('\n    /**',warheadAt+1);
const defs=vm.createContext({data,RE_FACTOR:A.RE_FACTOR,tntEquivalentKg:A.tntEquivalentKg,AIRCRAFT_TYPES:Object.fromEntries(Object.entries(profile.aircraft).map(([id,p])=>[id,{id,...p.metadata}]))});
vm.runInContext(mountedDetailsPrelude(app)+throughSemicolon(app.indexOf('    const AIR_STORE_DEFS ='))+app.slice(warheadAt,warheadEnd)+'\nglobalThis.defs=AIR_STORE_DEFS;',defs);
const stores=Object.entries(defs.defs).filter(([,d])=>d.kind==='agm');assert.equal(stores.length,13);
const table=stores.map(([id,d])=>{
 const shell=defs.storeWarhead(d),p=profile.shells[d.warhead.id];assert.ok(p,id+' actual native shell');
 for(const f of ['kind','caliber_mm','mass_kg','explosive_mass_kg','explosive_type','fuse_delay_s','fuse_sensitivity_mm'])assert.equal(shell[f],p[f],id+' source/native '+f);
 return{id,projectile:shell.id,kind:shell.kind,missileMassKg:d.mass,warheadMassKg:shell.mass_kg,fillerKg:shell.explosive_mass_kg,explosiveType:shell.explosive_type,presentationReFactor:A.RE_FACTOR[shell.explosive_type]??1,presentationTntKg:A.tntEquivalentKg(shell),damageFillerKg:shell.explosive_mass_kg,curvePenMm:shell.penetration_curve[0].pen_mm,fuseDelayS:shell.fuse_delay_s,fuseSensitivityMm:shell.fuse_sensitivity_mm};
});
console.log('AGM_DATA '+JSON.stringify(table));fs.writeFileSync(path.join(output,'agm-field-table.json'),JSON.stringify(table,null,2));
const wasm=Buffer.from(app.match(/var TF_APHE_SURFACE_CORE = "([^"]+)"/)[1],'base64'),compiled=new WebAssembly.Module(wasm);
const body=()=>({ex:[1,0,0],ey:[0,1,0],ez:[0,0,1],origin:()=>[0,0,0],localPoint:p=>p.slice(),localDir:p=>p.slice(),worldPoint:p=>p.slice()});
let entity=1;
function actor(id,route){
 const core=new A.DesignCore(new WebAssembly.Instance(compiled,{}),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)}),combat=new A.Combat(core,data.machineGuns),sink=rendererSink(),renderer=Object.assign(Object.create(A.Renderer.prototype),{gl:sink.gl,_live:new Set(),_texSrc:new Map(),lost:false});
 if(route==='surface')combat.setSurfaceCatalog(data.surfaceCatalog,renderer);
 const bundle=combat.prepare(id,data.vehicles[id]),fresh=combat.fresh(id,bundle),loadout=A.makeLoadout(id,bundle,data.projectiles,data.machineGuns),model=A.buildTank(renderer,loadout,A.generatedTurretParts),interior=A.buildInterior(renderer,model,loadout,bundle.modules,bundle.crew),frame=body();model.setFold?.(0);model.root.update();
 const record=route==='surface'?combat.registerSurfaceActor(id,id,{battle:181,entity:entity++,life:1},model,frame):null;
 if(record)assert.equal(record.available,true,id+' surface registration: '+record.detail);
 const arena=new Uint8Array(core.instance.exports.memory.buffer).slice();
 return{core,combat,bundle,model,interior,record,frame,fresh:()=>{new Uint8Array(core.instance.exports.memory.buffer).set(arena);return core.combatNew(id).state;},dispose(){combat.surfaceOwner?.retire();interior.dispose();model.dispose();}};
}
function summary(report,before){return{hit:report.hit,outcome:report.outcome,title:report.title,destroyed:report.caps.destroyed,crewAlive:report.caps.crew_alive,crewBefore:before.crew,crewAfter:report.state.crew,moduleLoss:before.modules.reduce((n,v,i)=>n+Math.max(0,v-report.state.modules[i]),0),crewLoss:before.crew.reduce((n,v,i)=>n+Math.max(0,v-report.state.crew[i]),0),layers:report.layers.map(l=>({plate:l.plate,required:l.required_mm,passed:l.passed})),bursts:report.bursts.map(b=>({kg:b.explosive_kg,inside:b.inside})),fragmentCount:report.fragments.length,fragmentHits:report.fragments.filter(f=>f.damage>0).map(f=>({kind:f.kind,hit:f.hit,damage:f.damage})),events:report.events};}
const measurements=[];
for(const route of (process.env.TF_AGM_AUDIT_ROUTES||'legacy,surface').split(','))for(const id of ['de_pzjg1','us_m8','de_tiger_e']){
 const a=actor(id,route);console.log('MEASURING '+route+' '+id);
 try{for(const [store,d]of stores){const shell=defs.storeWarhead(d),cx=a.bundle.crew.reduce((n,c)=>n+(Array.isArray(c.pos)?c.pos[0]:c.pos.x),0)/a.bundle.crew.length,cz=a.bundle.crew.reduce((n,c)=>n+(Array.isArray(c.pos)?c.pos[2]:c.pos.z),0)/a.bundle.crew.length;
  for(const [scenario,start,end]of [['direct-top',[cx,12,cz],[cx,-2,cz]],['direct-side',[12,1.3,cz],[-12,1.3,cz]],['near-2m',[4.5,.1,0],null],['near-5m',[7.5,.1,0],null]]){
   const before=a.fresh();let report,contact=null;
   if(end){const delta=end.map((v,i)=>v-start[i]),len=Math.hypot(...delta),shot={shell,origin:start,dir:delta.map(v=>v/len),speed_ms:d.dv||300,distance_m:500,seed:'37',turret_yaw:0};
    report=route==='surface'?a.core.combatSurfaceShoot(id,before,shot,end):a.core.combatShoot(id,before,shot);report.shot=shot;
    const e={combat:a.combat,combatKey:id,alive:!report.caps.destroyed,caps:report.caps,cstate:report.state,veh:{body:a.frame}};
    A.heContactEffects(e,shell,report.impact,shot.dir,report,0);A.flushHeContactBursts((_,r)=>{contact=summary(r,report.state);},true);
    measurements.push({route,id,store,scenario,direct:summary(report,before),contact,finalDestroyed:e.caps.destroyed,finalCrew:e.cstate.crew});
   }else{report=a.combat.nearBurst(id,before,start,shell,0,37,null,0);assert.ok(report,id+' near burst');measurements.push({route,id,store,scenario,near:summary(report,before),finalDestroyed:report.caps.destroyed,finalCrew:report.state.crew});}
  }
 }}finally{a.dispose();}
}
const result={appPath,appSha256:digest(app),embeddedWasmSha256:digest(wasm),scope:'Measured actual delivered storeWarhead, core WASM, registered rendered geometry, heContactEffects and nearBurst. No tuning applied. Native handler measurements are separate.',table,measurements};
fs.writeFileSync(path.join(output,'agm-damage-measurements.json'),JSON.stringify(result,null,2));
for(const route of [...new Set(measurements.map(m=>m.route))])for(const id of ['de_pzjg1','us_m8','de_tiger_e'])for(const scenario of ['direct-top','direct-side','near-2m','near-5m']){const rows=measurements.filter(m=>m.route===route&&m.id===id&&m.scenario===scenario);console.log(JSON.stringify({route,id,scenario,kills:rows.filter(m=>m.finalDestroyed).map(m=>m.store),survives:rows.filter(m=>!m.finalDestroyed).map(m=>m.store)}));}
console.log(JSON.stringify({measurements:measurements.length,output:path.join(output,'agm-damage-measurements.json')}));

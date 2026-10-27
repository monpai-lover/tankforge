import fs from'node:fs';
import {fileURLToPath} from'node:url';
import {createLayout}from'./actual-layout-fixture.mjs';
process.env.TF_LIVE_APP=fileURLToPath(new URL('../site-live-current-app.html',import.meta.url));
const{bundled}=await import('../../work/tankforge-live-flight-patch/source/handoff/tests/fixtures/live-aircraft.mjs');
const fixture=JSON.parse(fs.readFileSync(new URL('../all-interior/current-catalog-fixture.json',import.meta.url)));await bundled.decodeAircraftModels(fixture.models);
const base=createLayout(fs.readFileSync(new URL('../site-live-current-app.html',import.meta.url),'utf8'),bundled.AIRCRAFT_TYPES),fixed=createLayout(fs.readFileSync(process.env.TF_HARDPOINT_APP||new URL('./current-app-fixed.html',import.meta.url),'utf8'),bundled.AIRCRAFT_TYPES);
const models={};
for(const[id,T]of Object.entries(bundled.AIRCRAFT_TYPES)){
 const presets=[];
 for(const[index,lo]of(base.AIR_LOADOUTS[id]||[]).entries()){
  const a=base.layoutStores(T,lo),b=fixed.layoutStores(T,lo);
  if(!b.some((it,i)=>JSON.stringify(it.p)!==JSON.stringify(a[i].p)||it.owner!==a[i].owner))continue;
  presets.push({clientIndex:index+1,name:lo[0],items:b.map((it,i)=>({index:i,id:it.id,count:it.count,station:it.station,side:it.side,previousOwner:a[i].owner,revisedOwner:it.owner,previousP:a[i].p,revisedP:it.p,mount:it.mount||null,fittedMountKey:it.fittedMountKey||null,basis:it.modelMountBasis||(it.modelBellyBinding?'inferred_clearance_with_exact_exterior_contact':it.modelLauncherBinding?'measured_numbered_anchor_socket_chain':it.modelHardpoint?'source_rail_lower_face_center':'retained_existing'),hardware:it.modelHardpoint||null}))});
 }
 if(presets.length)models[id]={sourceMain:T.model?.sourceHashes?.main||T.model?.sourceBinding?.glbSha256||(id==='nf02'?'procedural:nf02-v1':null),presets};
}
const map={schema:2,purpose:'Spawn/loadout construction integration only; not a live accepted-state or browser override.',source:'Current tank.monpai.site snapshot ETag 17154d8d-6addb4f6',models,
 preserved:'Existing weapon IDs, sequence, counts, ammunition, mass, drag and capabilities. Su27 underengine owner becomes body. MiG21/F16 wing owners follow the actual source wing groups.',
 basis:'Source-component lower-face centers are geometric installation inferences, not registered author sockets. F4/F15 inner-store carriers and belly clearance adapters are explicitly procedural, fitted to existing model surfaces. Numbered launchers align existing adapter sockets.',
 integration:'Load this map in the local air-combat backend layout constructor, match complete initial item sequence + source model hash, then use revised P/owner before publishing/spawning units. Existing browser Native Frontline accept remains authoritative. For custom/new layouts use measured profile helper with the backend weapon socket schema; do not match client preset index alone.',
 limitation:'This package cannot modify an unseen local/VPS backend. The client native projection preserves accepted host owners and positions; old host positions continue until that backend adopts the map.'};
fs.writeFileSync(new URL('./native-layout-map.json',import.meta.url),JSON.stringify(map,null,2)+'\n');console.log('Native integration map models='+Object.keys(models).join(','));

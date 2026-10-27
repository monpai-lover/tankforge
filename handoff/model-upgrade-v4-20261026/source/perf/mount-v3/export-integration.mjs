import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as mounted from './details.mjs';
import {SOURCES,REVIEW_CASES} from './catalog.mjs';
import {createLayout} from '../hardpoints/actual-layout-fixture.mjs';
process.env.TF_LIVE_APP=new URL('./app-fixed.html',import.meta.url).pathname;
const{bundled,makeAircraft}=await import('../../work/tankforge-live-flight-patch/source/handoff/tests/fixtures/live-aircraft.mjs');
const fixture=JSON.parse(fs.readFileSync(new URL('../all-interior/current-catalog-fixture.json',import.meta.url)));await bundled.decodeAircraftModels(fixture.models);
const source=fs.readFileSync(process.env.TF_LIVE_APP,'utf8'),L=createLayout(source,bundled.AIRCRAFT_TYPES),collision={},catalog={};
function positions(data){const out=[];for(let i=0;i<data.length;i+=13)out.push(data[i],data[i+1],data[i+2]);return out;}
for(const[id,T]of Object.entries(bundled.AIRCRAFT_TYPES)){
 const {plane}=makeAircraft(id),g=T.geometry(),sourceMain=T.model?.sourceHashes?.main||T.model?.sourceBinding?.glbSha256||(['nf01','nf02','f4u1d'].includes(id)?'procedural:'+id+'-v1':null),owners=new Map(plane.hitbox.pieces.filter(p=>p.mountKey).map(p=>[p.mountKey,p.part]));
 const descriptors=(g.mountFitAdded||[]).map(p=>({key:p.key,owner:owners.get(p.key),station:p.station,side:p.side,positions:positions(p.data),activation:'Initial mounted items contain fittedMountKey; persists after weapon release; absent after carrier detachment.'}));
 const permanent=(g.mountHardware||[]).map(p=>({owner:p.owner,positions:positions(g.wings[p.side<0?'l':'r'].slice(-p.vertices*13)),activation:'Permanent source-wing rail, follows existing wing damage part.'}));
 const proceduralGeometry=['nf01','f4u1d'].includes(id)?mounted.proceduralGeometryFingerprint(g):undefined;
 if(descriptors.length||permanent.length)collision[id]={sourceMain,...(proceduralGeometry?{proceduralGeometry}:{}),potentialAdapters:descriptors,permanent};
 const base=L.airSlots(id).map(sl=>({key:sl.key,station:sl.station,side:sl.side,options:Object.fromEntries(sl.options),incomplete:Object.fromEntries(sl.incomplete||[])}));
 catalog[id]={name:T.name,sourceMain,...(proceduralGeometry?{proceduralGeometry}:{}),slots:base,reviewCombinations:(REVIEW_CASES[id]||[]).map(lo=>({name:lo[0],entries:lo[1],items:L.layoutStores(T,lo).map(it=>({id:it.id,count:it.count,owner:it.owner,p:it.p,storeRotation:it.storeRotation||null,mount:it.mount||null,fittedMountKey:it.fittedMountKey||null}))}))};
 plane.dispose();
}
const sha=createHash('sha256').update(source).digest('hex');
fs.writeFileSync(new URL('./mount-collision-map.json',import.meta.url),JSON.stringify({schema:1,appSha256:sha,models:collision,scope:'Exact triangles of rendered physical mount hardware; use existing damage IDs, mask unused adapters per aircraft, and retain original airframe triangles.'},null,2)+'\n');
const addedDefinitions=Object.fromEntries(['r3r','r60','samp250','sniper','litening'].map(id=>[id,L.AIR_STORE_DEFS[id]]));
fs.writeFileSync(new URL('./store-definitions.json',import.meta.url),JSON.stringify(L.AIR_STORE_DEFS,null,2)+'\n');
fs.writeFileSync(new URL('./catalog-capabilities.json',import.meta.url),JSON.stringify({schema:1,appSha256:sha,sources:SOURCES,models:catalog,addedDefinitions,addedRadars:mounted.radars({}),equipmentOverrides:mounted.equipment({}),scope:'Initial spawn/layout catalog integration. New game-fit definitions and MiG21 radar capability require matching local backend support. Client preset indices and menu availability do not authorize an existing native server capability.'},null,2)+'\n');
console.log(JSON.stringify({collisionModels:Object.keys(collision).length,catalogModels:Object.keys(catalog).length,potentialAdapters:Object.values(collision).reduce((n,m)=>n+m.potentialAdapters.length,0)}));

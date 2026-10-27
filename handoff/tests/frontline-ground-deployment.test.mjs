import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const ordnanceApp=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const ordnanceDefs=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8')).storeDefinitions;
const ordnancePrelude=ordnanceApp.slice(ordnanceApp.indexOf('  function m4()'),ordnanceApp.indexOf('  // client/web/src/game/relief.js'))+ordnanceApp.slice(ordnanceApp.indexOf('  var aqMul = '),ordnanceApp.indexOf('  var AIRCRAFT_KEYS'))+fs.readFileSync(new URL('../tools/frontline_ordnance_visual.js',import.meta.url),'utf8');
function installOrdnance(context){
  context.ordnanceStoreDefs=ordnanceDefs;
  vm.runInContext(ordnancePrelude+`f.ordnancePresentation=createFrontlineOrdnanceVisual({Node,storeDefs:ordnanceStoreDefs,storeMesh:id=>{throw Error('Unexpected ordnance geometry in this isolated fixture: '+id);},quatMatrix,aqLook});`,context);
}

const source=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const helpers=source.slice(0,source.indexOf('    // Production client for the versioned native frontline world.'));
const map=JSON.parse(fs.readFileSync(new URL('../../data/frontline/korea.json',import.meta.url),'utf8'));
const sources=map.staging.filter(s=>s.enabled).map(s=>({id:s.id,team:s.team===0?'blue':'red',front:s.lane,pos:s.pos,available:true}));
const plain=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 const f={staging:structuredClone(sources),room:{started:true,battle:1,members:[]},company:null,current:null,member:{team:'blue',observer:false}},elements=new Map(),sent=[],notes=[];
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'',dataset:{},replaceChildren(...children){this.options=children;}});return elements.get(id)};el('vehicle').value='su_t72a';
 const c=vm.createContext({f,el,Option:class{constructor(text,value){this.text=text;this.value=value;}},mine:()=>f.member,owned:()=>f.company,controlled:()=>f.current,send:m=>sent.push(plain(m)),note:m=>notes.push(m)});
 installOrdnance(c);
 const a=source.indexOf('      function refreshGroundDeployment(){'),b=source.indexOf('      function rebuildTerrain(){',a);vm.runInContext(helpers+source.slice(a,b),c);
 return {c,f,el,sent,notes};
}
test('actual deployment selector shows the three friendly fronts and sends only the chosen authoritative source',()=>{
 const x=fixture(),before=JSON.stringify(x.f);x.c.refreshGroundDeployment();
 assert.equal(x.el('ground-staging').options.length,3);assert.equal(x.el('ground-staging').value,'B-CENTRE-FRONT');assert.equal(x.el('deploy').disabled,false);
 x.el('ground-staging').value='B-EAST-FRONT';x.c.requestGroundDeployment();assert.deepEqual(x.sent,[{op:'deploy_at',vehicle:'su_t72a',staging:'B-EAST-FRONT'}]);assert.equal(JSON.stringify(x.f),before,'UI cannot mutate accepted companies/vehicles');
 x.f.member.team='red';x.c.refreshGroundDeployment();assert.equal(x.el('ground-staging').options.length,3);assert.ok(x.el('ground-staging').options.every(o=>o.value.startsWith('R-')));
});
test('source closure between rendering and click fails closed; observers/controlled players/no source never fall back to legacy deploy',()=>{
 for(const change of [x=>{x.f.staging.find(s=>s.id===x.el('ground-staging').value).available=false;},x=>x.f.member.observer=true,x=>x.f.current={unit:4},x=>x.f.room.started=false,x=>x.f.staging=[]]){
  const x=fixture();x.c.refreshGroundDeployment();change(x);x.c.requestGroundDeployment();assert.equal(x.sent.length,0);assert.equal(x.el('deploy').disabled,true);assert.ok(x.notes.length);
 }
});
test('retained company defaults to its source without granting a second company or inventing availability',()=>{
 const x=fixture();x.f.company={id:7,staging:'B-WEST-FRONT',front:'west',units:[{unit:12}]};
 x.c.refreshGroundDeployment();assert.equal(x.el('ground-staging').value,'B-WEST-FRONT');assert.match(x.el('ground-deployment-note').textContent,/幸存坦克/);assert.equal(x.el('deploy').textContent,'接管部署区原车');
 for(const s of x.f.staging)s.available=false;x.c.requestGroundDeployment();assert.equal(x.sent.length,0);assert.ok(x.el('ground-staging').options.every(o=>o.disabled));
});
test('actual frame receiver replaces source availability, clears empty sources and ignores a different battle',async()=>{
 const x=fixture(),f=x.f;Object.assign(x.c,{net:{id:7},ensureMap:async()=>{},updateAircraftModels(){},refreshUi:()=>x.c.refreshGroundDeployment()});
 f.room={battle:1,started:false};f.events=[];
 const a=source.indexOf('      async function receive(message){'),b=source.indexOf("      net.on('frontline'",a);vm.runInContext(source.slice(a,b),x.c);
 const frame={op:'frame',battle:1,tick:3,units:[],aircrafts:[],companies:[],objectives:[],staging:plain(sources)};
 frame.staging.find(s=>s.id==='B-EAST-FRONT').available=false;await x.c.receive({version:1,message:frame});assert.equal(f.staging.find(s=>s.id==='B-EAST-FRONT').available,false);
 await x.c.receive({version:1,message:{...frame,battle:2,staging:[]}});assert.equal(f.staging.length,6);
 await x.c.receive({version:1,message:{...frame,tick:4,staging:[]}});assert.equal(f.staging.length,0);assert.equal(x.el('deploy').disabled,true);
});
test('reinforcement display reads accepted incoming/pending/ETA without ticking time or restoring lost stock',()=>{
 const x=fixture(),company={reinforcement:{incoming:2,pending:3,status:'waiting',next_batch_s:12.2},units:[{ammo:7,alive:true}]},before=JSON.stringify(company);
 for(let i=0;i<100;i++){const text=x.c.frontlineReinforcementPresentation(company);assert.match(text,/增援在途 2.*待补 3/);assert.match(text,/13 秒/);}
 assert.equal(JSON.stringify(company),before);company.reinforcement.status='route_blocked';assert.match(x.c.frontlineReinforcementPresentation(company),/归队道路中断/);assert.doesNotMatch(x.c.frontlineReinforcementPresentation(company),/下批约/);
});
test('entire-theatre map contains every corner of full island-scale terrain and source markers show the actual friendly/observer set',()=>{
 const x=fixture(),t={x0:-200000,z0:-250000,cellX:1000,cellZ:1000,width:464,height:538,waterAreas:[]},view=x.c.frontlineTheatreMapView(t,480,340);
 for(const a of [t.x0,t.x0+(t.width-1)*t.cellX])for(const z of [t.z0,t.z0+(t.height-1)*t.cellZ]){assert.ok(Math.abs((a-view.centre[0])/view.scale)<240);assert.ok(Math.abs((z-view.centre[1])/view.scale)<170);}
 const labels=[],g={};for(const name of ['fillRect','strokeRect','beginPath','moveTo','lineTo','stroke','setLineDash','arc','fillText','save','restore','rect','clip','translate','scale','closePath','fill'])g[name]=(...args)=>{if(name==='fillText')labels.push(args[0]);};
 Object.assign(x.f,{mapCentre:[0,0],map:{terrain:t,roads:[],airfields:[]},facilities:[],objectives:[],units:[],aircrafts:[],companies:[]});x.el('map-range').value='theatre';x.el('ground-staging').value='B-CENTRE-FRONT';
 Object.assign(x.c,{mapG:g,mapCv:{width:480,height:340},net:{id:7}});
 vm.runInContext(fs.readFileSync(new URL('../tools/frontline_map_background.js',import.meta.url),'utf8'),x.c);
 const a=source.indexOf('      function drawMap(){'),b=source.indexOf('      function transmitInput(){',a);vm.runInContext(source.slice(a,b),x.c);
 const before=JSON.stringify(x.f.staging);x.c.drawMap();assert.equal(labels.filter(s=>s.includes('部署')).length,3);assert.deepEqual(plain(x.f.mapCentre),plain(view.centre));
 labels.length=0;x.f.member.observer=true;x.c.drawMap();assert.equal(labels.filter(s=>s.includes('部署')).length,6);assert.equal(JSON.stringify(x.f.staging),before);
});
test('map loader is keyed by actual room/server, retries a rejected fetch and never installs a stale response',async()=>{
 const x=fixture(),fetches=[],pending=[];x.f.room={map:'korea'};const net={url:'ws://first.example/'};
 Object.assign(x.c,{net,URL,sha256Text:s=>crypto.createHash('sha256').update(s).digest('hex'),height:()=>0,fetch:url=>new Promise((resolve,reject)=>{fetches.push(String(url));pending.push({resolve,reject});})});
 // This isolated fetch/cache fixture does not build renderer geometry.
 Object.assign(x.c,{GeoBuilder:class{},hexToLinear:()=>[.2,.3,.1],createFrontlineWaterCutout(){},createFrontlineFarTerrainGeometry:()=>({stats:{}})});
 const a=source.indexOf('      async function ensureMap(){'),b=source.indexOf('      function refreshGroundDeployment(){',a);vm.runInContext(source.slice(a,b),x.c);
 const old=x.c.ensureMap();net.url='ws://second.example/';const current=x.c.ensureMap();
 const value={schemaVersion:1,terrain:{heights:[0,0,0,0]},objectives:[{id:'X',pos:[1,2,3]}],initialScene:{objectiveIds:['X']},provenance:{terrain:'primary source',roads:'registered roads'}};
 pending[1].resolve({ok:true,text:async()=>JSON.stringify({...value,id:'second'})});await current;pending[0].resolve({ok:true,text:async()=>JSON.stringify({...value,id:'stale-first'})});await old;assert.equal(x.f.map.id,'second');
 x.f.room.map='taiwan';const failed=x.c.ensureMap();pending[2].reject(Error('temporary failure'));await assert.rejects(failed,/temporary/);assert.equal(x.f.mapLoad,null);
 const retry=x.c.ensureMap();pending[3].resolve({ok:true,text:async()=>JSON.stringify({...value,id:'taiwan'})});await retry;assert.equal(x.f.map.id,'taiwan');assert.deepEqual(fetches,['http://first.example/frontline/korea.json','http://second.example/frontline/korea.json','http://second.example/frontline/taiwan.json','http://second.example/frontline/taiwan.json']);
 const correct=JSON.stringify({...value,id:'changed-revision'});x.f.room.map_revision=crypto.createHash('sha256').update(correct).digest('hex');const mismatched=x.c.ensureMap();pending[4].resolve({ok:true,text:async()=>JSON.stringify({...value,id:'wrong'})});await assert.rejects(mismatched,/地图数据已变化/);assert.equal(x.f.map,null);
 const verified=x.c.ensureMap();pending[5].resolve({ok:true,text:async()=>correct});await verified;assert.equal(x.f.map.id,'changed-revision');
});
test('actual server map registry populates both maps, preserves user selection and rejects unsupported response paths',async()=>{
 const x=fixture(),registries=[],meta=id=>({id,name:id==='korea'?'三八线':'台海',path:`/frontline/${id}.json`,sha256:'a'.repeat(64)});x.el('map').value='korea';
 Object.assign(x.c,{URL,fetch:async url=>{registries.push(String(url));return{ok:true,json:async()=>({maps:[meta('korea'),meta('taiwan')]})};}});
 const a=source.indexOf('      async function ensureMapOptions('),b=source.indexOf('      async function ensureMap(){',a);vm.runInContext(source.slice(a,b),x.c);
 await x.c.ensureMapOptions('ws://native.example/');assert.equal(x.el('map').options.length,2);assert.equal(x.el('map').value,'korea');
 x.el('map').value='taiwan';await x.c.ensureMapOptions('ws://native.example/',true);assert.equal(x.el('map').value,'taiwan');assert.equal(registries.length,2);
 x.c.fetch=async()=>({ok:true,json:async()=>({maps:[{...meta('taiwan'),path:'http://different.example/other.json'}]})});await assert.rejects(x.c.ensureMapOptions('ws://native.example/',true),/地图列表无效/);
 assert.equal(x.f.availableMaps.length,0,'A stale registry cannot authorize a new request after failed refresh');
});

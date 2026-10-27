import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fuelSourceParts} from './fixtures/aircraft-fuel-source-fixture.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),appPath=path.join(root,'handoff/bundle/app.js.html'),original=fs.readFileSync(appPath,'utf8'),runtime=fs.readFileSync(new URL('../tools/frontline_existing_runtime.js',import.meta.url),'utf8'),profile=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url))),client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8'),adapter=fs.readFileSync(new URL('../tools/frontline_shared_lobby.js',import.meta.url),'utf8'),helpers=client.slice(0,client.indexOf('    // Production client for the versioned native frontline world.'));
const cut=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);assert.ok(i>=0&&j>i,a);return s.slice(i,j);};
const historicalPrelude=fs.readFileSync(new URL('../tools/historical_aircraft_loadouts.js',import.meta.url),'utf8');
let candidate;
function staged(){
 if(candidate)return candidate;const script=path.join(root,'handoff/tools/integrate_existing_aircraft.py');assert.match(fs.readFileSync(script,'utf8'),/def apply_patch\(/,'The original-aircraft installer must support candidate-only testing');const folder=fs.mkdtempSync(path.join(os.tmpdir(),'tf-garage-life-')),output=path.join(folder,'app.html');
 try{const r=spawnSync(process.env.TF_TEST_PYTHON||'python',[script,'--input',appPath,'--output',output],{encoding:'utf8'});assert.equal(r.status,0,r.stderr||r.stdout);candidate=fs.readFileSync(output,'utf8');assert.equal(fs.readFileSync(appPath,'utf8'),original);return candidate;}finally{fs.rmSync(folder,{recursive:true,force:true});}
}
function fixture(){
 const source=staged(),nodes=new Map(),fuel=fuelSourceParts(source),fuelStorage=new Map();
 assert.ok(source.includes(historicalPrelude.trim()),'Garage VM executes the exact delivered historical helper');
 assert.equal(Object.keys(profile.aircraft).length,28,'Historical identity guards need the complete 28-type source cohort');
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.dataset={};this.attrs={};this.hidden=false;this.handlers={};this.parentNode=null;this._html='';this._text='';}
  get id(){return this._id;}set id(v){this._id=v;}
  appendChild(n){if(n.parentNode)n.remove();n.parentNode=this;this.children.push(n);if(n.id)nodes.set(n.id,n);return n;}
  append(...a){a.forEach(n=>this.appendChild(n));}remove(){for(const n of [...this.children])n.remove();if(this.id)nodes.delete(this.id);if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}
  replaceChildren(...a){for(const n of [...this.children])n.remove();this.children=[];this.append(...a);}
  set innerHTML(v){this.replaceChildren();this._html=v;this._text=String(v).replace(/<[^>]*>/g,'');}get innerHTML(){return this._html;}
  set textContent(v){this.replaceChildren();this._text=v;this._html=v;}get textContent(){return this._text;}
  setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k];}
  querySelectorAll(tag){return this.children.flatMap(n=>[...(n.tagName===tag.toUpperCase()?[n]:[]),...n.querySelectorAll(tag)]);}querySelector(){return null;}
  closest(selector){const matches=(node,part)=>{const tag=part.match(/^[a-z]+/i)?.[0],classes=[...part.matchAll(/\.([\w-]+)/g)].map(m=>m[1]),attrs=[...part.matchAll(/\[([^\]]+)\]/g)].map(m=>m[1]);return(!tag||node.tagName===tag.toUpperCase())&&classes.every(c=>(node.className||'').split(/\s+/).includes(c))&&attrs.every(a=>a.startsWith('data-')?Object.hasOwn(node.dataset,a.slice(5)):Object.hasOwn(node.attrs,a));};for(let node=this;node;node=node.parentNode)if(selector.split(',').some(s=>matches(node,s.trim())))return node;return null;}
  addEventListener(k,fn){(this.handlers[k]??=[]).push(fn);}click(){const path=[];for(let node=this;node;node=node.parentNode)path.push(node);const e={currentTarget:this,target:this};for(const node of path){e.currentTarget=node;node.onclick?.(e);for(const fn of node.handlers.click||[])fn(e);}}blur(){}scrollIntoView(){}
 }
 const document={body:new Element('body'),createElement:t=>new Element(t),getElementById:id=>nodes.get(id)||null};for(const id of ['g-air','g-info','gameplay-rule','to-garage','veh-name']){const e=new Element('div');e.id=id;document.body.appendChild(e);}document.getElementById('veh-name').textContent='Panzerjäger I';document.getElementById('gameplay-rule').textContent='休閒';document.getElementById('to-garage').innerHTML='‹ 車庫 <kbd>Tab</kbd>';
 document.addEventListener=(name,handler)=>document.body.addEventListener(name,handler);
 document.getElementById('g-info').appendChild(document.getElementById('g-air'));
 const G4={id:'de_pzj1',mode:'garage',air:null,bulletShells:new Map(),airLoadout:{},airCustom:{},airArmMirror:false},airGarage={sel:'p51d',on:true,api:null,cards:new Map(['p51d','me262u4'].map(id=>[id,{button:new Element('button')}]))};
 const f={active:true,room:{battle_mode:'air_frontline',era:1945,team_score:[0,0],score_limit:1000},map:{name:'Taiwan · very long complete theatre name'},aircraftOptions:[{id:'p51d'},{id:'me262u4'}],garageSpawn:0},spawns=[{id:'air',label:'空中出生'},{id:'runway',label:'機場出生'}],armEd=new Element('div');let saved=0,returned=0,current=null;
 const c=vm.createContext({G4,f,document,airGarage,armEd,localStorage:{getItem:key=>fuelStorage.get(key)??null,setItem:(key,value)=>fuelStorage.set(key,value)},window:{addEventListener(){}},LANG:'en',AIR_STORE_DEFS:profile.storeDefinitions,AIRCRAFT_TYPES:Object.fromEntries(Object.entries(profile.aircraft).map(([id,a])=>[id,{...a.metadata,id,name:a.metadata.name,fighter:{nation:a.metadata.nation},airframe:a.physics.airframe,sound:id==='me262u4'?'jet':'piston',gLimit:6,rotateKmh:200}])),data:{projectiles:profile.shells},airHud:new Element('div'),hud:{el:{vehName:document.getElementById('veh-name')},toast(){}},performance:{now:()=>100},
  createEstablishedAircraftBridge:()=>({unbind(){G4.air=null;},getair:()=>G4.air,bind(model){return G4.air={plane:model.plane};}}),airTypeInfo:id=>({...profile.aircraft[id].metadata,engine:'engine',guns:'actual guns',mass:'7 t',wing:'22 m²'}),aircraftGuns:id=>profile.aircraft[id].guns,bulletShell:g=>profile.shells[g.id],
  airSlots:()=>[{key:'inner:-1',station:'inner',side:-1,options:new Map([['anm64',1]])}],customLoadout:id=>['自訂',Object.values(G4.airCustom[id]||{}).map(id=>[id,1])],SLOT_NAME:{inner:'內側'},KIND_CLASS:{bomb:'bomb'},slotsClash:()=>false,saveAirArms(){saved++;},resetAirActionKeys(){},toGarage(){G4.mode='garage';},setAirGarage:on=>airGarage.on=on,deploy:{close(){}},lobby:{show(){}},canvas:{focus(){}},cancelPilotInput(){},syncAircraftTouchControls(){},stepPlayerAircraftPilot(){},stepAirSystems(){},airAudio(){},airEffects(){},airViewCamera(){},updateAirHud(){},removeAircraft(){},dropAirPreview(){},setMode:m=>G4.mode=m,renderer:{setMap(){},zones:[]},frontlineRoundPresentation:()=>({text:'第1局 · 00:34'}),frontlineAircraftHud(){},frontlineAirServiceReason:s=>s,sound:{start(){}},requestLock(){},airReason(){},storeGroup(){},releaseProgram(){},AIR_WEAPON_KINDS:new Set()});
 c.deploy.o={};c.deploy.visible=false;
 vm.runInContext(fuel.helper+historicalPrelude+cut(source,'/* TF_GUIDED_AIRCRAFT_VARIANTS_BEGIN */','/* TF_GUIDED_AIRCRAFT_VARIANTS_END */')+cut(source,'/* TF_MOUNTED_DETAILS_BEGIN */','/* TF_MOUNTED_DETAILS_END */')+helpers+adapter+fuel.pure+fuel.controller+cut(source,'    const WEAPON_STATUS = ','    const AIR_LOADOUTS = ')+cut(source,'    const AIR_LOADOUTS = {','    RE_FACTOR.tritonal')+cut(source,'    const airLoadouts =','    /** The game shell')+fs.readFileSync(new URL('../tools/projectile_filler_info.js',import.meta.url),'utf8')+cut(source,'    function showAirType(', '    /** The aircraft on show')+cut(source,'    function renderAirInfo(', '    // ---- custom armament editor')+cut(source,'    function openArmEditor(', '    const locked =')+runtime+'\nglobalThis.actualAirLoadouts=airLoadouts;',c);
 const r=c.createFrontlineExistingRuntime({f,mine:()=>({team:'blue'}),controlled:()=>current,controlledAirModel:()=>current&&{plane:{type:{id:current.aircraft,name:profile.aircraft[current.aircraft].metadata.name},instrumentContext:{}}},send(){},height:()=>0,note(){},shared:{returnToDeployment(){returned++;},deploymentMap:()=>({name:f.map.name,spawns}),availability:()=>({allowed:true})}});G4.frontline=f;f.shared={room:()=>f.room,aircraftOptions:()=>f.aircraftOptions};f.refreshGarageControls=(...args)=>r.refreshGarageControls(...args);f.returnToGarage=()=>{returned++;};
 return {c,r,G4,f,airGarage,document,armEd,source,spawns,garages:()=>document.getElementById('native-air-garage'),saved:()=>saved,returned:()=>returned,setCurrent:u=>current=u};
}
function installLauncher(x){
 const sent=[],member={player:7,team:'blue',observer:false,air_sorties_remaining:1,air_sortie_eligible:true},net={id:7,open:true};
 Object.assign(x.f,{units:[],aircrafts:[],objectives:[],rooms:[],availableMaps:[{id:'taiwan',name:'Taiwan'}]});Object.assign(x.f.room,{id:8,battle:3,round_state:'battle',started:true,host:7,members:[member]});
 Object.assign(x.f.map,{terrain:{x0:-100,z0:-100,width:3,height:3,cellX:100,cellZ:100},airspawns:[{enabled:true,team:0,pos:[0,1000,0],yawRad:0}],airfields:[{enabled:true,team:0,runway:{center:[10,20],forward:[0,1]}}]});
 x.f.aircraftOptions=['p51d','me262u4'].map(id=>({id,name:profile.aircraft[id].metadata.name,loadouts:profile.aircraft[id].stores.loadouts,slots:profile.aircraft[id].stores.slots}));
 x.f.shared=x.c.createFrontlineSharedApi({f:x.f,net,send:m=>sent.push(JSON.parse(JSON.stringify(m))),ensureMapOptions:async()=>{},ensureMap:async()=>{},mine:()=>member,controlled:()=>null,clearInput(){},note(){}});x.f.establishedFlight=x.r;
 const base={hidden:true,querySelector:()=>null,querySelectorAll:()=>[],firstChild:{}};
 x.c.lobby={el:{...base},o:{},render(){},show(){},click(){},change(){},connect(){},sendVehicle(){}};
 x.c.deploy={el:{...base},o:{},visible:false,spawn:0,open(context){Object.assign(this,context);this.visible=true;},close(){this.visible=false;},click(){},airChoice(){},renderAmmo(){},renderTop(){},drawMap(){},update(){}};
 Object.assign(x.c,{frontline:x.f,net,airOnlineLineup:()=>['p51d','me262u4'].map(id=>({id:'air:'+id,name:profile.aircraft[id].metadata.name})),openNativeArmEditor:id=>x.c.openArmEditor(id)});
 vm.runInContext(cut(client,'    frontline.sharedLobby=installFrontlineSharedLobby(', '    const serviceChoice='),x.c);
 // These retained garage-component tests enter that component explicitly. The
 // online production adapter now enters the battlefield DeployScreen instead.
 x.r.garage({aircraftId:'p51d',map:x.f.shared.deploymentMap(),availability:{allowed:true}});
 return {sent,launch:id=>x.f.sharedLobby.launchFromGarage(id,x.f.garageSpawn||0),select(index){const markup=x.c.airLoadoutHtml(x.airGarage.sel),tag=markup.match(new RegExp(`<button\\b[^>]*data-lo="${index}"[^>]*>`))?.[0];assert.ok(tag,'actual airLoadoutHtml must emit the chosen button');const button=x.document.createElement('button');button.className=tag.match(/class="([^"]+)"/)[1];button.dataset.lo=tag.match(/data-lo="([^"]+)"/)[1];x.document.getElementById('g-air').appendChild(button);button.click();},closeEditor(){for(const handle of x.armEd.handlers.click||[])handle({target:{closest:selector=>selector==='.air-arm-close, .air-arm-done'?{}:null}});}};
}
test('actual g-info delegation ignores native spawn-button bubbling and still accepts the rendered loadout zero button',()=>{
 for(const saved of [undefined,0,1]){const x=fixture(),native=installLauncher(x);if(saved!==undefined)x.G4.airLoadout.me262u4=saved;x.c.showAirType('me262u4');const strip=x.garages(),before=x.saved();for(const index of [1,0]){strip.querySelectorAll('button')[index].click();assert.equal(x.f.garageSpawn,index);assert.ok(Object.is(x.G4.airLoadout.me262u4,saved),'Birthplace selection must not write NaN or change the saved loadout');assert.equal(x.saved(),before);assert.equal(x.garages(),strip);}native.select(0);assert.equal(x.G4.airLoadout.me262u4,0);assert.equal(x.saved(),before+1);native.launch('me262u4');assert.deepEqual(native.sent.pop(),{op:'deploy_air',aircraft:'me262u4',loadout:0,spawn:'air'});x.f.sharedLobby.dispose();}
});
test('actual aircraft selection retains native air/runway buttons and the chosen spawn when the info panel is rebuilt',()=>{
 const x=fixture();x.r.garage({aircraftId:'p51d',map:{name:'Taiwan',spawns:x.spawns},availability:{allowed:true}});x.garages().querySelectorAll('button')[1].click();assert.equal(x.f.garageSpawn,1);x.c.showAirType('me262u4');const strip=x.garages();assert.ok(strip,'Choosing a second aircraft must recreate the replaced native spawn controls');assert.equal(strip.querySelectorAll('button').length,2);assert.equal(strip.querySelectorAll('button')[1].getAttribute('aria-pressed'),'true');assert.ok(strip.children.some(n=>n.textContent==='己方跑道停妥、低油门，按K整备15秒（维修/补弹/加油）'));assert.match(x.document.getElementById('g-air').innerHTML,/17 g · PETN/);assert.equal(x.G4.id,'de_pzj1');
});
test('actual custom-editor open and armPick refresh keep native spawn ownership without changing a local tank',()=>{
 const x=fixture();x.r.garage({aircraftId:'p51d',map:{name:'Taiwan',spawns:x.spawns},availability:{allowed:true}});x.garages().querySelectorAll('button')[1].click();x.c.openArmEditor('p51d');assert.equal(x.armEd.hidden,false);x.c.armPick('p51d','inner:-1','anm64');assert.equal(x.saved(),1);assert.equal(x.f.garageSpawn,1);assert.ok(x.garages());assert.equal(x.G4.id,'de_pzj1');
});
test('garage controls are gated to the native garage context and are cleared when leaving the room',()=>{
 const x=fixture();x.r.garage({aircraftId:'p51d',map:{name:'Taiwan',spawns:x.spawns},availability:{allowed:true}});x.r.release(true);x.f.room=null;x.c.renderAirInfo('p51d');assert.equal(x.garages(),null);assert.equal(x.r.garageContext(),null);
});
test('native accepted aircraft owns the shared header and bounded score while the original garage button uses native return',()=>{
 const x=fixture();x.setCurrent({unit:{battle:1,unit:7,life:1},aircraft:'me262u4',service:null});x.r.sync();assert.match(x.document.getElementById('veh-name').textContent,/Me 262/);assert.match(x.document.getElementById('gameplay-rule').textContent,/空战/);assert.equal(x.G4.id,'de_pzj1');const score=x.document.getElementById('native-air-score');assert.ok(!score.textContent.includes(x.f.map.name));assert.ok(score.title.includes(x.f.map.name));assert.match(score.style.cssText,/pointer-events:auto/,'The bounded score must accept hover for its full map-name tooltip');
 const a=x.source.indexOf('    function toGarage() {'),b=x.source.indexOf('      removeAircraft();',a);vm.runInContext(x.source.slice(a,b)+'throw Error("Local tank garage route executed");}',x.c);x.G4.air={nativeAuthority:true};const start=x.source.indexOf('    document.getElementById("to-garage").addEventListener('),end=x.source.indexOf('    document.getElementById("battle-btn")',start);vm.runInContext(x.source.slice(start,end),x.c);x.document.getElementById('to-garage').click();assert.equal(x.returned(),1);x.r.release(true);assert.equal(x.document.getElementById('veh-name').textContent,'Panzerjäger I');assert.equal(x.document.getElementById('gameplay-rule').textContent,'休閒');
});
test('actual native loadout display never presents an invalid saved index as selected and launch requires an explicit valid choice',()=>{
 for(const invalid of [2,9,NaN,'2','1x',' 0','00','0.0','',-1,Infinity,true]){
  const x=fixture(),native=installLauncher(x);x.G4.airLoadout.me262u4=invalid;x.c.showAirType('me262u4');const html=x.document.getElementById('g-air').innerHTML;
  assert.ok(!/class="air-lo"[^>]*aria-pressed="true"/.test(html),'Invalid persisted state must not visually select guns');assert.match(html,/保存配置不可用，请重新选择/);assert.throws(()=>native.launch('me262u4'),/挂载/);assert.equal(native.sent.length,0);assert.ok(Object.is(x.G4.airLoadout.me262u4,invalid));
  native.select(0);native.launch('me262u4');assert.deepEqual(native.sent.pop(),{op:'deploy_air',aircraft:'me262u4',loadout:0,spawn:'air'});x.f.sharedLobby.dispose();
 }
});
test('a valid source index absent from native admission remains selected but rejected, including its canonical string representation',()=>{
 for(const saved of [1,'1']){
  const x=fixture(),native=installLauncher(x);x.G4.airLoadout.p51d=saved;x.f.aircraftOptions.find(o=>o.id==='p51d').loadouts=x.f.aircraftOptions.find(o=>o.id==='p51d').loadouts.filter(lo=>lo.index!==1);x.c.showAirType('p51d');assert.match(x.document.getElementById('g-air').innerHTML,/data-lo="1" aria-pressed="true"/);assert.throws(()=>native.launch('p51d'),/未开放/);assert.equal(native.sent.length,0);assert.equal(x.G4.airLoadout.p51d,saved);x.f.sharedLobby.dispose();
 }
 const x=fixture(),native=installLauncher(x);x.G4.airLoadout.p51d='1';x.c.showAirType('p51d');native.launch('p51d');assert.deepEqual(native.sent.pop(),{op:'deploy_air',aircraft:'p51d',loadout:1,spawn:'air'});assert.equal(x.G4.airLoadout.p51d,1);x.f.sharedLobby.dispose();
});
test('actual custom-editor open/close and aircraft switch retain each saved choice; canonical numeric strings preserve their exact index',()=>{
 for(const saved of [0,'0',1,'1']){
  const x=fixture(),native=installLauncher(x);x.G4.airLoadout.me262u4=saved;x.G4.airLoadout.p51d=1;x.c.showAirType('me262u4');x.garages().querySelectorAll('button')[1].click();x.c.showAirType('p51d');x.c.openArmEditor('p51d');native.closeEditor();assert.equal(x.armEd.hidden,true);x.c.showAirType('me262u4');x.garages().querySelectorAll('button')[0].click();
  assert.ok(x.document.getElementById('g-air').innerHTML.includes(`data-lo="${Number(saved)}" aria-pressed="true"`));assert.equal(x.G4.airLoadout.p51d,1);native.launch('me262u4');assert.deepEqual(native.sent.pop(),{op:'deploy_air',aircraft:'me262u4',loadout:0,...(Number(saved)===1?{custom:{}}:{}),spawn:'air'});assert.equal(x.G4.airLoadout.me262u4,Number(saved));x.f.sharedLobby.dispose();
 }
});

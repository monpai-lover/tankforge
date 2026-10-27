import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const adapterURL=new URL('../tools/frontline_shared_lobby.js',import.meta.url);
const adapter=fs.existsSync(adapterURL)?fs.readFileSync(adapterURL,'utf8'):'';
const helpers=client.slice(0,client.indexOf('    // Production client for the versioned native frontline world.'));
const plain=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 const sent=[],notices=[],member={player:7,team:'blue',observer:false,air_sorties_remaining:1,air_sortie_eligible:true};
 const f={room:{id:2,battle:4,host:7,battle_mode:'air_frontline',started:true,round_state:'battle',members:[member],team_score:[12,9],score_limit:1000},rooms:[],availableMaps:[{id:'korea',name:'Korea'}],map:{name:'Korea',terrain:{x0:-100,z0:-50,width:3,height:3,cellX:100,cellZ:100},airspawns:[{id:'BA',team:0,enabled:true,pos:[0,2000,-20],yawRad:0}],airfields:[{id:'BF',team:0,enabled:true,runway:{center:[1,2],forward:[0,1]}}]},objectives:[{id:'W2',label:'A',pos:[2,0,3],owner:'blue',radius:100}],units:[],aircrafts:[],aircraftOptions:[{id:'f86f',name:'F86',loadouts:[{index:0,name:'Guns'},{index:1,name:'Bombs'}],slots:[{key:'inner:-1',station:'inner',side:-1,options:{anm64:1,aim9b:1},unsupported:{aim9b:'Native AAM authority unavailable'}}]}]};
 const net={id:7,open:true,url:'ws://example/ws',room:null};
 const context=vm.createContext({console,Set,Map});vm.runInContext(helpers+'\nglobalThis.factory=typeof createFrontlineSharedApi===\'function\'?createFrontlineSharedApi:null;',context);
 assert.equal(typeof context.factory,'function','real frontline.shared API factory is required');
 const shared=context.factory({f,net,send:command=>sent.push(plain(command)),ensureMapOptions:async()=>f.availableMaps,ensureMap:async()=>f.map,mine:()=>member,controlled:()=>f.aircrafts.find(u=>u.controller===7)||null,clearInput(){},note:message=>notices.push(message)});
 return {f,net,member,shared,sent,context,notices};
}
test('real shared API validates native deployments and keeps custom slot choices isolated',()=>{
 const x=fixture(),before=JSON.stringify([x.f.room,x.f.map,x.f.aircrafts,x.f.aircraftOptions]);
 for(const name of ['room','rooms','maps','self','controlled','aircraftOptions','deploymentMap','list','create','join','start','leave','deployAir','returnToDeployment','subscribe'])assert.equal(typeof x.shared[name],'function',name);
 const map=x.shared.deploymentMap();assert.deepEqual(plain(map.spawns.map(p=>p.id)),['air','runway']);assert.equal(map.points[0].id,'A');
 const choice={'inner:-1':'anm64'};x.f.lastDeploymentError='Old rejection';x.shared.deployAir({aircraft:'f86f',spawn:'runway',loadout:99,custom:choice});choice['inner:-1']='aim9b';assert.equal(x.shared.deploymentError(),'');
 assert.deepEqual(x.sent,[{op:'deploy_air',aircraft:'f86f',loadout:0,custom:{'inner:-1':'anm64'},spawn:'runway'}]);assert.equal(JSON.stringify([x.f.room,x.f.map,x.f.aircrafts,x.f.aircraftOptions]),before);
 assert.throws(()=>x.shared.deployAir({aircraft:'f86f',spawn:'air',loadout:0}),/等待服务器/);x.f.airDeploymentPending=false;
 assert.throws(()=>x.shared.deployAir({aircraft:'f86f',spawn:'air',loadout:99}),/挂载|配置/);
 assert.throws(()=>x.shared.deployAir({aircraft:'f86f',spawn:'air',custom:{'inner:-1':'aim9b'}}),/AAM|未开放|不支持/);
 assert.throws(()=>x.shared.deployAir({aircraft:'f86f',spawn:'air',custom:{unknown:'anm64'}}),/挂点|配置/);
 assert.throws(()=>x.shared.deployAir({aircraft:'tank',spawn:'air',loadout:0}),/飞机/);
 assert.throws(()=>x.shared.deployAir({aircraft:'f86f',spawn:'invented',loadout:0}),/出生/);
});
test('shared mode only admits native air rooms, authoritative return, and disposable subscriptions',async()=>{
 const x=fixture();let notifications=0;const off=x.shared.subscribe(()=>notifications++);x.shared.notify();assert.equal(notifications,1);off();x.shared.notify();assert.equal(notifications,1);
 x.shared.returnToDeployment();assert.deepEqual(x.sent.pop(),{op:'return'});x.shared.leave();assert.deepEqual(x.sent.pop(),{op:'leave'});
 x.member.observer=true;assert.throws(()=>x.shared.deployAir({aircraft:'f86f',spawn:'air',loadout:0}),/观战|出击/);x.member.observer=false;
 x.f.room=null;await x.shared.list();assert.deepEqual(x.sent.pop(),{op:'list'});
 x.shared.create({map:'korea',era:1986,name:'Air',observer:false});assert.deepEqual(x.sent.pop(),{op:'create',map:'korea',era:1986,name:'Air',observer:false});
 x.f.rooms=[{id:9,battle_mode:'mixed'}];assert.throws(()=>x.shared.join({room:9}),/空战|空中|更新/);
});

test('one aircraft per round permits the retained original but cannot replace a lost aircraft',()=>{
 const x=fixture();x.member.air_sorties_remaining=0;x.member.air_sortie_eligible=false;
 assert.equal(x.shared.availability().allowed,false);
 assert.throws(()=>x.shared.deployAir({aircraft:'f86f',spawn:'air',loadout:0}),/本局|等待下一局/);
 assert.equal(x.sent.length,0);
 const original={unit:{battle:4,unit:8,life:1},owner:7,controller:null,aircraft:'f86f',loadout:1,custom:{'inner:-1':'anm64'},pos:[10,2000,20],alive:true};
 x.f.aircrafts=[original];x.member.air_sortie_eligible=true;
 x.shared.deployAir({aircraft:'f86f',spawn:'runway',loadout:0,custom:{}});
 assert.deepEqual(x.sent.pop(),{op:'deploy_air',aircraft:'f86f',loadout:0,custom:{'inner:-1':'anm64'},spawn:'runway'});
 assert.equal(original.loadout,1);assert.deepEqual(original.custom,{'inner:-1':'anm64'});assert.match(x.notices.at(-1),/接管原机/);
 x.f.airDeploymentPending=false;original.alive=false;x.member.air_sortie_eligible=false;
 assert.throws(()=>x.shared.deployAir({aircraft:'f86f',spawn:'air',loadout:0}),/本局|等待下一局/);
 x.member.air_sorties_remaining=1;x.member.air_sortie_eligible=true;
 assert.equal(x.shared.availability().allowed,true,'Only accepted next-round eligibility unlocks a new aircraft');
});

test('objective labels and score events use native A/B/C and accepted totals without computing client points',()=>{
 const x=fixture(),c=x.context;
 assert.match(c.frontlineObjectivePresentation({id:'W2',name:'A',progress:0},'blue').label,/^A /);
 assert.match(c.frontlineObjectivePresentation({id:'C2',progress:.4,contested:true},'blue').label,/^C2 争夺 蓝40%$/);
 assert.equal(typeof c.frontlineAcceptScoreEvents,'function');
 const totals={player:7,name:'Pilot',score:150,air_kills:1,ground_kills:1,deaths:0};
 const events=[{kind:'player_score',player:7,points:99999,totals,team_score:[160,20]},{kind:'team_score',team_score:[162,21],score_limit:1000}];
 c.frontlineAcceptScoreEvents(x.f.room,events);c.frontlineAcceptScoreEvents(x.f.room,events);
 assert.deepEqual(plain(x.f.room.scoreboard),[totals]);assert.deepEqual(plain(x.f.room.team_score),[162,21]);
 assert.equal(totals.score,150,'Repeated event presentation never adds points or mutates accepted totals');
 c.frontlineAcceptScoreEvents(x.f.room,[{kind:'destroyed',player:7,points:500},{kind:'player_score',player:7,detail:{totals:{...totals,score:90000}}}]);
 assert.deepEqual(plain(x.f.room.scoreboard),[totals]);
});
test('production source removes separate mixed entry and installs the shared lobby exactly once',()=>{
 assert.ok(adapter.includes('function installFrontlineSharedLobby('),'source-owned shared adapter is missing');
 assert.doesNotMatch(client,/open\.id\s*=\s*['"]frontline-open['"]/);
 assert.match(client,/installFrontlineSharedLobby\(/);assert.match(client,/shared:\s*sharedApi/);
 assert.match(client,/air_elimination/);assert.match(client,/team_score/);assert.match(client,/scoreboard/);
 assert.match(client,/mountAcceptedStores/);assert.match(client,/sharedLobby\.dispose/);
});
test('shared adapter routes the existing DeployScreen to native aircraft without personal SP',()=>{
 const x=fixture();vm.runInContext(adapter+'\nglobalThis.install=typeof installFrontlineSharedLobby===\'function\'?installFrontlineSharedLobby:null;',x.context);assert.equal(typeof x.context.install,'function');
 const nodes=new Map(),element=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',dataset:{},hidden:false,classList:{toggle(){}},querySelector(){return null}});return nodes.get(id);};
 const el={hidden:true,querySelector:element,querySelectorAll:()=>[],firstChild:{}};let legacyClicks=0,selected=0,pick={'inner:-1':'anm64'};
 const lobby={el:{...el,hidden:true},o:{},render(){},click(){legacyClicks++},change(){},show(){},connect(){},sendVehicle(){}};
 const deploy={el,o:{lineup:()=>[{id:'tank'}],airLineup:()=>[],map:()=>({}),sp:()=>500},vehicle:null,spawn:0,visible:false,airLo:0,isAir(){return this.vehicle?.startsWith('air:')},open({vehicle,spawn}){this.vehicle=vehicle;this.spawn=spawn;this.visible=true;this.renderAmmo();},close(){this.visible=false},click(e){if(e.target.dataset.act==='veh')this.vehicle=e.target.dataset.id},airChoice(){},update(){},renderAmmo(){},renderTop(){},drawMap(){}};
 const aircraft={lineup:()=>[{id:'air:f86f',name:'F86',usable:true}],selectedId:()=> 'f86f',selectedLoadout:()=>selected,select(){},selectLoadout(id,n){selected=n},loadouts:()=>[['Guns',[]],['Bombs',[['anm64',2,'inner']]],['自訂',[]]],custom:()=>({...pick}),openConfiguration(){}};
 const api=x.context.install({lobby,deploy,net:x.net,frontline:x.shared,aircraft});assert.equal(x.context.install({lobby,deploy,net:x.net,frontline:x.shared,aircraft}),api);
 assert.equal(deploy.vehicle,'air:f86f');assert.deepEqual(plain(deploy.o.lineup()),[]);assert.equal(deploy.airChoice().personalSpawnPoints,false);assert.doesNotMatch(element('#dp-ammo').innerHTML,/点数|點數|仅离线|只能离线/);
 selected=2;deploy.airLo=2;deploy.click({target:{dataset:{act:'go'},closest(){return this}},preventDefault(){}});assert.deepEqual(x.sent.pop(),{op:'deploy_air',aircraft:'f86f',loadout:0,custom:{'inner:-1':'anm64'},spawn:'air'});
 x.f.airDeploymentPending=false;pick={'inner:-1':'aim9b'};deploy.click({target:{dataset:{act:'go'},closest(){return this}},preventDefault(){}});assert.match(element('#dp-ammo').innerHTML,/role="status"/);assert.match(element('#dp-ammo').innerHTML,/AAM|未开放|不支持/);
 x.member.air_sorties_remaining=0;x.member.air_sortie_eligible=false;api.refresh();assert.match(element('#dp-ammo').innerHTML,/观战.*等待下一局/);assert.equal(element('#dp-go').disabled,true);
 x.f.room=null;api.refresh();lobby.click({target:{closest(){return {dataset:{act:'close'}}}}});assert.equal(legacyClicks,1);
 const original=deploy.o.lineup;api.dispose();api.dispose();assert.equal(lobby.__frontlineSharedLobby,undefined);assert.notEqual(deploy.o.lineup,original);
});

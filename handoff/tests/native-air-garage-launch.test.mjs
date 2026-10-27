import {R7_AIRCRAFT_IDS} from './fixtures/r7-aircraft-contract.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const adapter=fs.readFileSync(new URL('../tools/frontline_shared_lobby.js',import.meta.url),'utf8');
const helpers=client.slice(0,client.indexOf('    // Production client for the versioned native frontline world.'));
const catalog=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8'));
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture({battlefield=false}={}){
 const sent=[],notices=[],garageCalls=[],battlefieldCalls=[],nodes=new Map(),selectedLoadouts={},custom={f86f:{'inner:-1':'anm64'}};
 let selected='f86f',deployOpens=0,deployCloses=0;
 const member={player:7,team:'blue',observer:false,air_sorties_remaining:1,air_sortie_eligible:true};
 const options=Object.entries(catalog.aircraft).filter(([,value])=>value.metadata.year&&value.metadata.year<=2022).map(([id,value])=>({id,name:value.metadata.name,year:value.metadata.year,loadouts:[{index:0,name:'Guns'},{index:1,name:'Preset'}],slots:id==='f86f'?[{key:'inner:-1',station:'inner',side:-1,options:{anm64:1,aim9b:1},unsupported:{aim9b:'AAM native guidance unavailable'}}]:[]}));
 const f={room:{id:8,battle:3,battle_mode:'air_frontline',round_state:'battle',started:true,host:7,era:2022,members:[member],team_score:[0,0],score_limit:1000},rooms:[],units:[],aircrafts:[],objectives:[],aircraftOptions:options,availableMaps:[{id:'korea',name:'Korea'},{id:'taiwan',name:'Taiwan'}],map:{name:'Taiwan',terrain:{x0:-100,z0:-100,width:3,height:3,cellX:100,cellZ:100},airspawns:[{enabled:true,team:0,pos:[0,1000,0],yawRad:0}],airfields:[{enabled:true,team:0,runway:{center:[10,20],forward:[0,1]}}]},control:null};
 const net={id:7,open:true,room:null,rooms:[]};
 const c=vm.createContext({console});vm.runInContext(helpers+adapter,c);
 const shared=c.createFrontlineSharedApi({f,net,send:message=>sent.push(plain(message)),ensureMapOptions:async()=>{},ensureMap:async()=>{},mine:()=>member,controlled:()=>f.aircrafts.find(unit=>f.control&&unit.unit.unit===f.control.unit)||null,clearInput(){},note:message=>notices.push(message)});
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',dataset:{},hidden:false,classList:{toggle(){}},querySelector(){return null;},querySelectorAll:()=>[],closest(){return {hidden:false};},insertAdjacentHTML(){}});return nodes.get(id);};
 const base={hidden:true,querySelector:node,querySelectorAll:()=>[],firstChild:{}};
 const lobby={el:{...base},o:{},render(){},show(on){this.el.hidden=!on;},click(){},change(){},connect(){},sendVehicle(){}};
 const deploy={el:{...base},o:{lineup:()=>[],airLineup:()=>[]},visible:false,spawn:0,isAir(){return this.vehicle?.startsWith('air:');},open(details){deployOpens++;if(!battlefield)throw Error('Legacy garage callback fixture must not open deployment');Object.assign(this,details);this.visible=true;},close(){deployCloses++;this.visible=false;},click(){},airChoice(){},renderAmmo(){},renderTop(){},drawMap(){},update(){}};
 const aircraft={lineup:()=>Object.entries(catalog.aircraft).map(([id,value])=>({id:'air:'+id,name:value.metadata.name,nation:value.metadata.nation,usable:false})),selectedId:()=>selected,selectedLoadout:id=>selectedLoadouts[id]??0,select:id=>{selected=id;},selectLoadout:(id,index)=>{selectedLoadouts[id]=index;},loadouts:()=>[['Guns',[]],['Preset',[]],['自訂',[]]],custom:id=>({...custom[id]}),openConfiguration(){},openGarage:details=>{garageCalls.push(details);}};
 if(battlefield)aircraft.openBattlefield=details=>battlefieldCalls.push(details);
 const api=c.installFrontlineSharedLobby({lobby,deploy,net,frontline:shared,aircraft});
 return {c,f,net,member,shared,api,aircraft,lobby,deploy,sent,notices,garageCalls,battlefieldCalls,node,selectedLoadouts,custom,get deployOpens(){return deployOpens;},get deployCloses(){return deployCloses;}};
}

test('native air battle uses the existing in-map DeployScreen even when an old garage callback exists',()=>{
 const x=fixture({battlefield:true});assert.equal(x.deployOpens,1);assert.equal(x.deploy.visible,true);assert.equal(x.deploy.vehicle,'air:f86f');assert.equal(x.garageCalls.length,0);assert.equal(x.battlefieldCalls.length,1);assert.equal(x.battlefieldCalls[0].map.name,'Taiwan');
 for(let i=0;i<5;i++)x.shared.notify();assert.equal(x.deployOpens,1,'Snapshots do not reset selection or spawn');assert.equal(x.battlefieldCalls.length,1);
 x.f.aircrafts=[{unit:{battle:3,unit:20,life:1},controller:7,owner:7,aircraft:'f86f',alive:true,loadout:0,pos:[10,2,20]}];x.f.control=x.f.aircrafts[0].unit;x.shared.notify();assert.equal(x.deploy.visible,false);assert.equal(x.f.deploymentVisible,false);
 x.f.control=null;x.f.aircrafts[0].controller=null;x.shared.notify();assert.equal(x.deploy.visible,true);assert.equal(x.deployOpens,2);assert.equal(x.garageCalls.length,0);x.api.dispose();
});

test('native admission opens original aircraft garage callback once and never alternate deployment UI',()=>{
 const x=fixture();assert.equal(x.deployOpens,0);assert.equal(x.deploy.visible,false);assert.ok(x.deployCloses>0);assert.equal(x.garageCalls.length,1);
 const detail=x.garageCalls[0];assert.equal(detail.aircraftId,'f86f');assert.equal(detail.map.name,'Taiwan');assert.deepEqual(plain(detail.map.spawns.map(spawn=>spawn.id)),['air','runway']);assert.equal(detail.availability.allowed,true);assert.equal(x.f.deploymentVisible,true);
 for(let i=0;i<5;i++)x.shared.notify();assert.equal(x.garageCalls.length,1,'Snapshots must not reopen/reset the original garage');
 x.api.dispose();
});

test('original garage launch uses selected preset/custom and native spawn choice without touching resources',()=>{
 const x=fixture();assert.equal(typeof x.api.launchFromGarage,'function');x.selectedLoadouts.f86f=2;const before=JSON.stringify([x.f.room,x.f.aircrafts,x.f.aircraftOptions]);
 x.api.launchFromGarage('f86f',1);assert.deepEqual(x.sent.pop(),{op:'deploy_air',aircraft:'f86f',loadout:0,custom:{'inner:-1':'anm64'},spawn:'runway'});assert.equal(JSON.stringify([x.f.room,x.f.aircrafts,x.f.aircraftOptions]),before);assert.equal(x.deployOpens,0);
 x.f.airDeploymentPending=false;const original={unit:{battle:3,unit:20,life:1},owner:7,controller:null,aircraft:'f86f',loadout:0,custom:{'inner:-1':'anm64'},alive:true,pos:[10,2,20],guns:[{id:'original',ammo:73}],fuel:{kg:200},stores:[{id:'anm64',count:0,gone:true}]};x.f.aircrafts=[original];x.member.air_sorties_remaining=0;x.selectedLoadouts.f86f=0;const resources=JSON.stringify(original);
 x.api.launchFromGarage('f86f');assert.deepEqual(x.sent.pop(),{op:'deploy_air',aircraft:'f86f',loadout:0,custom:{'inner:-1':'anm64'},spawn:'air'});assert.equal(JSON.stringify(original),resources,'Reclaim cannot replenish or replace accepted resources');
 x.api.dispose();
});

test('original garage launch preserves one-life, unsupported store, admission and spawn validation',()=>{
 const x=fixture();x.member.air_sorties_remaining=0;x.member.air_sortie_eligible=false;assert.throws(()=>x.api.launchFromGarage('f86f'),/本局|等待下一局/);assert.equal(x.sent.length,0);
 x.member.air_sorties_remaining=1;x.member.air_sortie_eligible=true;x.selectedLoadouts.f86f=2;x.custom.f86f={'inner:-1':'aim9b'};assert.throws(()=>x.api.launchFromGarage('f86f'),/AAM|guidance/);assert.equal(x.sent.length,0);
 x.custom.f86f={};assert.throws(()=>x.api.launchFromGarage('f86f',99),/出生/);assert.throws(()=>x.api.launchFromGarage('nf01'),/飞机/);assert.equal(x.sent.length,0);
 x.api.launchFromGarage('f86f');assert.deepEqual(x.sent.pop(),{op:'deploy_air',aircraft:'f86f',loadout:0,custom:{},spawn:'air'});assert.throws(()=>x.api.launchFromGarage('f86f'),/等待服务器/);
 x.api.dispose();
});

test('native aircraft garage admits the complete dated server pool across nations and ages',()=>{
 const x=fixture(),cards=x.deploy.o.airLineup(),ids=cards.map(card=>card.id);assert.deepEqual(ids.slice().sort(),R7_AIRCRAFT_IDS.filter(id=>!['nf01','nf02'].includes(id)).map(id=>'air:'+id).sort());assert.ok(cards.every(card=>card.usable));
 for(const id of ['a6m2','bf109g','me262','f86f','mig21','f16v'])assert.ok(ids.includes('air:'+id),id+' incorrectly filtered by nation or lower-era limit');assert.ok(!ids.includes('air:nf01'));assert.ok(!ids.includes('air:nf02'));x.api.dispose();
});

test('native room creation defaults to Taiwan and 2022 while preserving subsequent explicit map choice',()=>{
 const x=fixture();x.f.room=null;x.api.refresh();x.api.setMode('air_frontline');assert.equal(x.node('#lb-map').value,'taiwan');assert.equal(x.node('#lb-era').value,'2022');
 x.node('#lb-map').value='korea';x.lobby.change({target:{id:'lb-map',value:'korea'}});x.api.setMode('air_frontline');assert.equal(x.node('#lb-map').value,'korea');x.api.dispose();
});
test('deferred or temporarily empty map catalogs preserve Taiwan default and a later explicit Korea choice',()=>{
 const x=fixture();x.f.room=null;x.f.availableMaps=[];x.lobby.el.hidden=false;x.api.refresh();x.api.setMode('air_frontline');assert.equal(x.node('#lb-map').value,'');
 x.f.availableMaps=[{id:'korea',name:'Korea'},{id:'taiwan',name:'Taiwan'}];x.shared.notify();assert.equal(x.node('#lb-map').value,'taiwan','Loading the catalog must retain the intended Taiwan default');
 x.node('#lb-map').value='korea';x.lobby.change({target:{id:'lb-map',value:'korea'}});x.f.availableMaps=[];x.shared.notify();assert.equal(x.node('#lb-map').value,'');
 x.f.availableMaps=[{id:'taiwan',name:'Taiwan'},{id:'korea',name:'Korea'}];x.shared.notify();assert.equal(x.node('#lb-map').value,'korea','Refreshing the catalog must retain the player’s explicit Korea choice');x.api.dispose();
});

test('actual native room rows reserve a full second row for scores instead of squeezing the player name into one character',()=>{
 const x=fixture();x.lobby.el.hidden=false;const member=x.f.room.members[0];member.name='測試玩家名字';member.connected=true;x.f.room.scoreboard=[{player:member.player,score:300,air_kills:1,ground_kills:0,deaths:0}];x.lobby.render();const html=x.lobby.el.innerHTML;
 assert.match(html,/<span class="lb-mk" style="[^"]*grid-column:1 \/ -1;grid-row:2/);assert.match(html,/<span class="lb-mv" style="[^"]*grid-column:2;grid-row:1/);assert.match(html,/<span class="lb-mn"[^>]*white-space:nowrap/);assert.ok(html.includes('測試玩家名字'));x.api.dispose();
});

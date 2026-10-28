import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {patchR85Loadout} from '../tools/patch_r85_loadout.mjs';

const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function shared(){
 const source=patchR85Loadout(client),c=vm.createContext({console,Set,Map});
 vm.runInContext(source.slice(0,source.indexOf('    // Production client for the versioned native frontline world.')),c);
 const sent=[],member={player:7,team:'blue',observer:false,air_sorties_remaining:1};
 const f={room:{battle_mode:'air_frontline',battle:1,round_state:'battle',members:[member]},aircrafts:[],aircraftOptions:[{id:'f15c',custom_counts_version:1,slots:[{key:'mid:-1',options:{aim9l:2},quantity_options:{aim9l:[1,2]}}],loadouts:[{index:0}]}],map:{terrain:{x0:0,z0:0,width:2,height:2,cellX:100,cellZ:100},airspawns:[{enabled:true,team:0,pos:[0,1000,0]}]}};
 const api=c.createFrontlineSharedApi({f,net:{id:7,open:true},send:command=>sent.push(plain(command)),mine:()=>member,controlled:()=>f.aircrafts.find(a=>a.controller===7),clearInput(){}});
 return {api,f,sent,c};
}
test('custom quantity survives the real shared configuration and deploy boundary',()=>{
 const x=shared(),custom={'mid:-1':'aim9l'},custom_counts={'mid:-1':1};
 assert.deepEqual(plain(x.api.configuration('f15c',{custom,custom_counts})),{loadout:0,custom,custom_counts});
 x.api.deployAir({aircraft:'f15c',spawn:'air',custom,custom_counts});
 assert.deepEqual(x.sent.at(-1),{op:'deploy_air',aircraft:'f15c',loadout:0,custom,custom_counts,spawn:'air'});
});
test('invalid or unadvertised quantity is rejected instead of silently granting maximum stores',()=>{
 for(const counts of [{'mid:-1':0},{'mid:-1':3},{'mid:-1':1.5},{'mid:-1':'1'},{unknown:1}]){
  const x=shared();assert.throws(()=>x.api.configuration('f15c',{custom:{'mid:-1':'aim9l'},custom_counts:counts}),/数量|quantity|挂点/);
 }
 const x=shared();delete x.f.aircraftOptions[0].custom_counts_version;
 assert.throws(()=>x.api.configuration('f15c',{custom:{'mid:-1':'aim9l'},custom_counts:{'mid:-1':1}}),/数量|quantity|更新/);
});
test('reclaim resends accepted quantities and preserves requested service intent separately',()=>{
 const x=shared();x.f.aircrafts=[{unit:{battle:1,unit:2,life:1},pos:[0,1000,0],owner:7,controller:null,alive:true,aircraft:'f15c',loadout:0,custom:{'mid:-1':'aim9l'},custom_counts:{'mid:-1':1}}];
 x.api.deployAir({aircraft:'f15c',spawn:'air',loadout:0});
 assert.deepEqual(x.sent.at(-1).custom_counts,{'mid:-1':1});
 assert.equal(x.f.aircrafts[0].custom_counts['mid:-1'],1);
});
test('airport service carries quantity only as a validated native request and cancel carries no loadout grant',()=>{
 const x=shared();x.f.epoch=2;x.f.seq=0;
 x.f.aircrafts=[{unit:{battle:1,unit:2,life:1},pos:[0,1,0],owner:7,controller:7,alive:true,aircraft:'f15c',loadout:0,custom:{}}];
 const before=JSON.stringify(x.f.aircrafts),custom={'mid:-1':'aim9l'},custom_counts={'mid:-1':1};
 x.api.serviceAir({custom,custom_counts});
 assert.deepEqual(x.sent.at(-1),{op:'service_air',unit:{battle:1,unit:2,life:1},epoch:2,seq:1,loadout:0,custom,custom_counts});
 assert.equal(JSON.stringify(x.f.aircrafts),before,'Service intent does not materialize stores, ammo or fuel locally');
 x.api.serviceAir({cancel:true,custom,custom_counts:{'mid:-1':99}});
 assert.deepEqual(x.sent.at(-1),{op:'cancel_air_service',unit:{battle:1,unit:2,life:1},epoch:2,seq:2});
});
test('existing service controls move into the original HUD while the same legality gates stay in force',()=>{
 const patched=patchR85Loadout(app);
 assert.ok(patched.includes("serviceAccess.append(serviceSummary,servicePanel);airHud.appendChild(serviceAccess)"));
 assert.ok(patched.includes("el('service-air').disabled=!service?.eligible||service.status==='servicing'||!sameAircraft"));
 assert.ok(patched.includes("const el = key => sharedControls.get(key)||ui.querySelector"));
 assert.ok(patched.includes("custom_counts:typeof frontlineCustomCountPick==='function'?frontlineCustomCountPick(id):undefined"));
});
test('deployment refresh preserves fuel and loadout DOM nodes despite browser-normalized selected attributes',()=>{
 const x=shared(),source=fs.readFileSync(new URL('../tools/frontline_shared_lobby.js',import.meta.url),'utf8');
 vm.runInContext(source,x.c);
 let writes=0,serialized='',fuel='full',selected=0;
 const target={get innerHTML(){return serialized;},set innerHTML(value){writes++;serialized=value.replace(/ selected(?=[ >])/g,' selected=""');}};
 const nodes=new Map(),node=key=>{if(key==='#dp-ammo')return target;if(!nodes.has(key))nodes.set(key,{innerHTML:'',dataset:{},classList:{toggle(){}}});return nodes.get(key);};
 const el={hidden:true,querySelector:node,querySelectorAll:()=>[],firstChild:{}};
 const lobby={el:{...el,hidden:true},o:{},render(){},click(){},change(){},show(){},connect(){},sendVehicle(){}};
 const deploy={el,o:{},vehicle:null,spawn:0,visible:false,airLo:0,isAir(){return this.vehicle?.startsWith('air:');},open({vehicle}){this.vehicle=vehicle;this.visible=true;this.renderAmmo();},close(){this.visible=false;},click(){},airChoice(){},update(){},renderAmmo(){},renderTop(){},drawMap(){}};
 const aircraft={lineup:()=>[{id:'air:f15c'}],selectedId:()=> 'f15c',selectedLoadout:()=>selected,select(){},selectLoadout(_id,n){selected=n;},loadouts:()=>[['Guns',[]]],custom:()=>({}),fuelHtml:()=>`<select><option value="${fuel}" selected>${fuel}</option></select>`,openConfiguration(){}};
 x.c.installFrontlineSharedLobby({lobby,deploy,net:{id:7},frontline:x.api,aircraft});
 assert.equal(writes,1);
 deploy.renderAmmo();deploy.renderAmmo();x.api.notify();
 assert.equal(writes,1,'Repeated native refresh must preserve the actual select/button nodes between pointerdown and click');
 fuel='20';deploy.renderAmmo();assert.equal(writes,2,'A changed source fuel choice still updates the controls');
});
test('airport fuel refresh preserves its existing select node with browser-normalized markup',()=>{
 const patched=patchR85Loadout(app),begin=patched.indexOf("        const fuelHtml=airOption&&typeof aircraftFuelLoad!=="),end=patched.indexOf('\n',begin);
 assert.ok(begin>=0&&end>begin);
 let writes=0,serialized='';const node={get innerHTML(){return serialized;},set innerHTML(value){writes++;serialized=value.replace(' selected>',' selected="">');}};
 const c=vm.createContext({airOption:{id:'f15c'},aircraftFuelLoad:{htmlFor:()=>'<select><option selected>Full</option></select>'},el:()=>node});
 vm.runInContext('function refresh(){'+patched.slice(begin,end)+'}',c);c.refresh();c.refresh();c.refresh();
 assert.equal(writes,1,'Accepted frame refresh must keep the open airport fuel select connected');
});
test('service preset refresh preserves an open select and synchronizes changed saved preference after blur',()=>{
 const patched=patchR85Loadout(app),begin=patched.indexOf('        const retained=f.aircrafts.find'),end=patched.indexOf('\n',begin);
 assert.ok(begin>=0&&end>begin);
 let value='1',writes=0;const choice={get value(){return value;},set value(next){writes++;value=next;}};
 const document={activeElement:choice},c=vm.createContext({f:{aircrafts:[]},net:{id:7},G4:{airLoadout:{f15c:0}},airOption:{id:'f15c'},el:()=>choice,document});
 vm.runInContext('function refresh(){'+patched.slice(begin,end)+'}',c);c.refresh();
 assert.equal(value,'1','An open native select must not be reset before its change event commits');
 assert.equal(writes,0);document.activeElement=null;c.refresh();assert.equal(value,'0');assert.equal(writes,1);
 c.refresh();assert.equal(writes,1,'An unchanged saved choice must not rewrite the select value every accepted frame');
});
test('shared lobby refresh retains map options and an open map choice until it commits',()=>{
 const source=fs.readFileSync(new URL('../tools/frontline_shared_lobby.js',import.meta.url),'utf8'),begin=source.indexOf('  function mapOptions('),end=source.indexOf('\n  function syncModeFields(',begin);
 assert.ok(begin>=0&&end>begin);
 let writes=0,html='',value='';const select={get innerHTML(){return html;},set innerHTML(v){writes++;html=v;},get value(){return value;},set value(v){value=v;}};
 const document={activeElement:null},c=vm.createContext({esc:String,optionMarkup:new WeakMap(),focused:node=>document.activeElement===node});
 vm.runInContext(source.slice(begin,end),c);
 const maps=[{id:'korea',name:'Korea'},{id:'taiwan-escort',name:'Taiwan'}];
 c.mapOptions(select,maps,'taiwan-escort');assert.equal(writes,1);assert.equal(value,'taiwan-escort');
 document.activeElement=select;value='korea';c.mapOptions(select,maps,'taiwan-escort');
 assert.equal(writes,1,'Room-list refresh must not replace options while a player is choosing a map');
 assert.equal(value,'korea','The focused provisional map must survive until its change event');
 document.activeElement=null;c.mapOptions(select,maps,'taiwan-escort');assert.equal(value,'taiwan-escort');
});
test('shared lobby refresh preserves unchanged Join and Observe room buttons',()=>{
 const x=shared();x.f.room=null;x.f.rooms=[{id:9,name:'Air room',map:'korea',era:1986,members:[],started:false}];
 const source=fs.readFileSync(new URL('../tools/frontline_shared_lobby.js',import.meta.url),'utf8');vm.runInContext(source,x.c);
 let inserts=0,nativeRows=0;
 const rows={querySelectorAll(selector){return selector==='[data-shared-native]'?Array.from({length:nativeRows},()=>({remove(){nativeRows--;}})):[];},insertAdjacentHTML(_where,html){inserts++;nativeRows+=(html.match(/data-shared-native="1"/g)||[]).length;}};
 const el={hidden:true,querySelector(){return null;},querySelectorAll:()=>[]};
 const lobby={el:{...el,hidden:false,querySelector:selector=>selector==='.lb-rooms'?rows:null},o:{},render(){},click(){},change(){},show(){},connect(){},sendVehicle(){}};
 const deploy={el,o:{},visible:false,close(){},click(){},airChoice(){},update(){},renderAmmo(){},renderTop(){},drawMap(){}};
 const aircraft={lineup:()=>[],selectedId:()=>'',selectedLoadout:()=>0,select(){},selectLoadout(){},loadouts:()=>[],openConfiguration(){}};
 x.c.installFrontlineSharedLobby({lobby,deploy,net:{id:7,open:true,room:null},frontline:x.api,aircraft});
 assert.equal(inserts,1);x.api.notify();x.api.notify();
 assert.equal(inserts,1,'An unchanged room list must preserve live Join/Observe buttons');
 x.f.rooms[0].name='Updated room';x.api.notify();assert.equal(inserts,2,'Actual room changes remain visible');
});
test('service preset option signature updates custom admission and explanation after editor changes',()=>{
 const patched=patchR85Loadout(app),begin=patched.indexOf('        const airOption=f.aircraftOptions.find'),end=patched.indexOf('\n',begin);
 assert.ok(begin>=0&&end>begin);
 const choices=[{index:0,name:'Guns',online:true},{index:1,name:'Custom',online:true}],c=vm.createContext({f:{aircraftOptions:[{id:'f15c'}],sharedLobby:{loadouts:()=>choices}},el:()=>({value:'f15c'})});
 vm.runInContext('function signature(){'+patched.slice(begin,end)+'return loadoutSignature;}',c);
 const allowed=c.signature();choices[1].online=false;choices[1].why='Unsupported custom store';
 assert.notEqual(c.signature(),allowed,'A custom admission change must update disabled/title, even when index/name stay unchanged');
});
test('canonical patch is guarded and idempotent without replacing unrelated client extensions',()=>{
 const patched=patchR85Loadout(app);assert.ok(patchR85Loadout(patched)===patched,'Patch must be idempotent');
 assert.ok(patched.includes('TF_R85_LOADOUT'));
 assert.ok(patched.includes('custom_counts'));
 assert.throws(()=>patchR85Loadout(app.replace('function configuration(id,','function changedConfiguration(id,')),/configuration|anchor|reviewed/);
});

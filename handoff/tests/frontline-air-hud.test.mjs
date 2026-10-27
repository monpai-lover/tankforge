import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const hud=fs.readFileSync(new URL('../tools/air_hud_inventory.js',import.meta.url),'utf8');
const helpers=client.slice(0,client.indexOf('    // Production client for the versioned native frontline world.'));
function fixture(){
 const c=vm.createContext({});vm.runInContext(hud+helpers,c);const defs={tank:{kind:'tank',fuel:50},bomb:{kind:'bomb',name:'实弹炸弹'}};
 const reader=c.createAirHudInventory({projectiles:{shell:{caliber_mm:30}},storeDefs:defs}),plane={type:{name:'实际机型'},damage:{dead:()=>false},crashed:false},model={plane};
 const unit={unit:{battle:1,unit:9,life:1},aircraft:'me262',alive:true,state:Array(80).fill(0),loadout:1,resource_revision:1,guns:[{id:'gun',owner:'body',ammo:100}],fuel:{kg:1000,max:1000,flow:2},stores:[{id:'tank',owner:'body',count:1,fuel:50,gone:false},{id:'bomb',owner:'body',count:1,gone:false}]};
 const read=()=>c.frontlineAircraftHud(unit,model,reader,()=>[{id:'gun',belt:['shell']}],defs);return{unit,read,model,plane};
}
test('shared-mode left readout groups native ammunition and warms endurance across changing network JSON identities',()=>{
 const x=fixture();let r=x.read();assert.match(r.text,/机炮 30 mm 100/);assert.equal(r.report.fuel.state,'calculating');
 const projection=x.model.hudProjection,guns=projection.guns,fuel=projection.fuel,stores=projection.stores;
 for(let i=1;i<=20;i++){
  x.unit.state[23]=i*.05;x.unit.guns=x.unit.guns.map(g=>({...g,ammo:100-i}));x.unit.fuel={...x.unit.fuel,kg:1000-i*.1};x.unit.stores=x.unit.stores.map(s=>({...s}));x.unit.resource_revision++;r=x.read();
 }
 assert.equal(projection.guns,guns);assert.equal(projection.fuel,fuel);assert.equal(projection.stores,stores);assert.equal(r.report.fuel.state,'current');assert.equal(r.report.fuel.resetReason,null);
 assert.match(r.text,/机炮 30 mm 80/);assert.match(r.text,/预计续航 \d{2}:\d{2} · 當前功率估算/);assert.equal(r.report.fuel.usableKg,1048);
 const before=JSON.stringify(x.unit);for(let i=0;i<100;i++)x.read();assert.equal(JSON.stringify(x.unit),before,'Rendering never spends or grants native inventory');
});
test('accepted external-tank release, restock, no-flow and runtime loss cannot show stale or infinite endurance',()=>{
 const x=fixture();x.read();x.unit.state[23]=1;x.read();x.unit.stores[0].gone=true;x.unit.state[23]=1.05;let r=x.read();assert.equal(r.report.fuel.usableKg,1000);assert.equal(r.report.fuel.resetReason,'tank_change');
 x.unit.state[23]=2;x.unit.fuel={kg:1000,max:1000,flow:0};r=x.read();assert.equal(r.report.fuel.state,'no_flow');assert.match(r.text,/预计续航 —/);
 x.unit.state[23]=3;x.unit.fuel.flow=2;x.unit.guns[0].ammo=101;r=x.read();assert.equal(r.report.fuel.resetReason,'rearm');assert.equal(r.report.fuel.state,'calculating');
 x.unit.state[23]=4;x.unit.fault='native runtime fault';r=x.read();assert.match(r.text,/预计续航 — · 模拟暂不可用/);assert.doesNotMatch(r.text,/Infinity/);
});
test('a missing accepted external fuel quantity cannot be filled from the published tank capacity',()=>{
 const x=fixture();delete x.unit.stores[0].fuel;const r=x.read();assert.equal(r.report.fuel.usableKg,null);assert.equal(r.report.fuel.enduranceSeconds,null);assert.match(r.text,/外置油箱数据未就绪/);assert.match(r.text,/外 —/);assert.equal(x.unit.stores[0].fuel,undefined);
});

test('actual SU25 SPPU22 accepted feed is a23mm260-round gunpod and disappears with its pod or carrier',()=>{
 const c=vm.createContext({});vm.runInContext(hud+helpers,c);
 const catalog=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8')),profile=catalog.aircraft.su25;
 const source=profile.stores.loadouts.flatMap(loadout=>loadout.items).find(item=>item.id==='sppu22'&&item.pylonN===2);assert.ok(source);
 const pod={...structuredClone(source),gone:false},podId=`air_pod_${pod.pylonN??pod.station}_${pod.side}`,dead=new Set(),gone=new Set();
 const plane={type:{name:'Su25'},damage:{dead:owner=>dead.has(owner),gone:owner=>gone.has(owner)},crashed:false},model={plane};
 const unit={unit:{battle:3,unit:7,life:1},aircraft:'su25',alive:true,state:Array(80).fill(0),loadout:0,custom:{'p2:-1':'sppu22'},resource_revision:1,stores:[pod],guns:[...profile.guns.map(gun=>({id:gun.id,owner:gun.owner,ammo:gun.ammo})),{id:podId,owner:pod.owner,ammo:260}],fuel:{kg:1000,max:3000,flow:2}};
 const reader=c.createAirHudInventory({projectiles:catalog.shells,storeDefs:catalog.storeDefinitions}),read=()=>c.frontlineAircraftHud(unit,model,reader,()=>profile.guns,catalog.storeDefinitions);
 const before=JSON.stringify(unit);let result=read(),group=result.report.guns.find(group=>group.scope==='pod');assert.ok(group,'Native pod feed must retain its external reservoir');assert.equal(group.caliberMm,23);assert.equal(group.rounds,260);assert.match(result.text,/吊舱机炮 23 mm 260/);assert.ok(result.report.guns.some(group=>group.scope==='internal'&&group.caliberMm===30));
 unit.guns.at(-1).ammo=117;result=read();assert.equal(result.report.guns.find(group=>group.scope==='pod').rounds,117,'Host ammo remains authoritative');
 pod.gone=true;result=read();assert.ok(!result.report.guns.some(group=>group.scope==='pod'),'Lost pod feed is excluded');
 pod.gone=false;gone.add(pod.owner);result=read();assert.ok(!result.report.guns.some(group=>group.scope==='pod'),'Detached carrier is excluded even before gone store projection');gone.clear();
 dead.add(pod.owner);result=read();assert.ok(!result.report.guns.some(group=>group.scope==='pod'));dead.clear();
 unit.stores=[];result=read();assert.ok(!result.report.guns.some(group=>group.scope==='pod'),'An orphan accepted feed never becomes a generic internal gun');
 unit.stores=[pod];unit.guns.at(-1).ammo=260;assert.equal(JSON.stringify(unit),before,'HUD never changes any native state or inventory');
});

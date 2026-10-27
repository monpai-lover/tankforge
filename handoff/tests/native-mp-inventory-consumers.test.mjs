import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const inventory=fs.readFileSync(new URL('../tools/air_hud_inventory.js',import.meta.url),'utf8');
const helpers=client.slice(0,client.indexOf('    // Production client for the versioned native frontline world.'));
const hudAt=app.indexOf('    function updateAirHud('),reportAt=app.indexOf('      const inventory = airHudInventory.report(',hudAt),reportEnd=app.indexOf('\n',reportAt);
assert.ok(hudAt>0&&reportAt>hudAt&&reportEnd>reportAt,'Actual original HUD inventory consumer is required');
const originalHudReport=app.slice(reportAt,reportEnd)+'\nglobalThis.hudReport=inventory;';
test('the actual native inventory panel and original HUD warm independently while accepted fuel changes without a resource revision',()=>{
 const c=vm.createContext({G4:{time:100}});vm.runInContext(inventory+helpers+'\nvar airHudInventory=createAirHudInventory({projectiles:{},storeDefs:{}});',c);
 const plane={type:{name:'Native test aircraft'},damage:{dead:()=>false},crashed:false},model={plane,stores:{items:[]}},unit={unit:{battle:1,unit:7,life:1},aircraft:'f86f',alive:true,state:Array(80).fill(0),loadout:0,resource_revision:2,guns:[],stores:[],fuel:{kg:1000,max:1300,flow:1}};
 const air={plane,active:true,nativeAuthority:true,boardedAt:12,resourceRevision:2,stores:model.stores};c.air=air;
 let panel;
 for(let i=0;i<=40;i++){
  unit.state[23]=i*.05;unit.fuel={...unit.fuel,kg:1000-i*.05};c.G4.time=100+i*.05;
  panel=c.frontlineAircraftHud(unit,model,c.airHudInventory,()=>[],{});air.guns=model.hudProjection.guns;air.fuel=model.hudProjection.fuel;
  vm.runInContext('{'+originalHudReport+'}',c);
 }
 assert.equal(panel.report.fuel.state,'current','Original HUD reads must not reset the native panel history');
 assert.equal(c.hudReport.fuel.state,'current','Native panel reads must not reset the original HUD history');
 assert.equal(c.hudReport.fuel.usableKg,998);assert.equal(panel.report.fuel.usableKg,998);assert.match(panel.text,/燃油 998 kg/);
 assert.equal(unit.resource_revision,2,'Ordinary burn does not require a synthetic inventory revision');
 assert.equal(c.hudReport.fuel.resetReason,null);assert.equal(panel.report.fuel.resetReason,null);
});

test('the inventory history integration is guarded and idempotent without touching other runtime owners',async()=>{
 const url=new URL('../tools/patch_native_inventory_history.mjs',import.meta.url);assert.ok(fs.existsSync(url),'A reviewed in-memory integration patch is required');
 const {patchNativeInventoryHistory:patch}=await import(url);
 for(const eol of ['\n','\r\n']){
  const input=app.replaceAll('\r\n','\n').replaceAll('\n',eol),result=patch(input);assert.equal(patch(result),result);
  assert.equal(result.split('object(context.historyKey) ? context.historyKey').length,2);assert.equal(result.split('historyKey:p,timeSeconds:unit.state[23]').length,2);
  new vm.Script(result.slice(result.indexOf('<script>')+8,result.lastIndexOf('</script>')));
 }
 assert.equal(fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8'),app);
 assert.throws(()=>patch(app+app),/one|unique/i);
});

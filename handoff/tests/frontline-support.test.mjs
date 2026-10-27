import fs from 'node:fs';import vm from 'node:vm';import test from 'node:test';import assert from 'node:assert/strict';
const helper=fs.readFileSync(new URL('../tools/frontline_support_visual.js',import.meta.url),'utf8'),client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
function context(){const c=vm.createContext({});vm.runInContext(helper,c);return c;}
const ref={battle:3,unit:9,life:1};
test('support conversion removes original source weapon assemblies without changing original hull/running gear',()=>{
 const c=context();for(const vehicle of ['de_pzjg1','de_rso_pak40','su_att_m46'])for(const role of ['engineer','supply']){
  const visual=JSON.parse(fs.readFileSync(new URL(`../../data/vehicles/${vehicle}/visual.json`,import.meta.url),'utf8'));
  const modelPath=new URL(`../../data/vehicles/${vehicle}/model.json`,import.meta.url),parts=fs.existsSync(modelPath)?JSON.parse(fs.readFileSync(modelPath,'utf8')).parts:[];
  const loadout={visual,imported:parts.length?{parts}:null,turrets:[{guns:[{}]}],machineGuns:[{}],gunCount:1},before=JSON.stringify(loadout);
  const unit={vehicle,role,campaign_conversion:{kind:'campaign_support_conversion',role,chassis:vehicle,prototype:true,mass_basis:'registered_chassis'}};
  const converted=c.frontlineSupportLoadout(loadout,unit);assert.equal(converted.turrets.length,0);assert.equal(converted.machineGuns.length,0);assert.equal(converted.gunCount,0);
  assert.ok(converted.visual.parts.every(p=>!['turret','gun','barrel'].includes(p.mount)));assert.ok(converted.imported?.parts.every(p=>!['turret','gun','barrel'].includes(p.mount))??true);
  assert.equal(converted.visual.running_gear,visual.running_gear);assert.equal(JSON.stringify(loadout),before);assert.equal(c.frontlineSupportLoadout(loadout,{role:'combat'}),loadout);
 }
});
test('work display uses accepted native job time; rendering cannot grant completion or supplies',()=>{
 const c=context(),task={status:'travelling'},job={status:'working',elapsed_s:5,duration_s:20,boosted:true};const before=JSON.stringify(job);
 for(let i=0;i<20;i++)assert.match(c.frontlineSupportStatus(task,job),/25%.*护送补给/);assert.equal(JSON.stringify(job),before);assert.match(c.frontlineSupportStatus(task,null),/驶向/);assert.match(c.frontlineSupportStatus(null,{...job,elapsed_s:20}),/作业中 100%/);
});
test('actual support producer uses current facility revision and accepted sequence, rejecting foreign and wrong-role work',()=>{
 const unit={unit:ref,alive:true,team:'blue',role:'engineer',support_order_seq:30},target={facility_id:'korea:bridge:1',team:null,revision:14},sent=[];
 const f={units:[unit],facilities:[target],supportSeq:2},elements={'support-unit':{value:'3:9:1'},'support-target':{value:target.facility_id}};
 const c=vm.createContext({f,mine:()=>({team:'blue',observer:false}),unitKey:r=>`${r.battle}:${r.unit}:${r.life}`,el:k=>elements[k],send:m=>sent.push(JSON.parse(JSON.stringify(m)))});
 const a=client.indexOf('      function requestSupport('),b=client.indexOf('      function rebuildTerrain(',a);vm.runInContext(client.slice(a,b),c);c.requestSupport('repair');assert.equal(sent.length,1);assert.deepEqual(sent[0],{op:'support_order',unit:ref,kind:'repair',facility_id:target.facility_id,expected_revision:14,seq:31});
 c.requestSupport('deliver_supply');target.team=1;c.requestSupport('repair');unit.team='red';target.team=null;c.requestSupport('repair');assert.equal(sent.length,1);
});

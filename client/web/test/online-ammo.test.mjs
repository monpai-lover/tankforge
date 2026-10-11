import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/load-data.mjs';
import { makeLoadout, roundsLeft } from '../src/game/loadout.js';
import { applyAmmo } from '../src/game/deploy.js';
import { newLoading } from '../src/sim/loading.js';
import { OnlineLaunches } from '../src/game/onlineLaunch.js';
const api = await import('../src/game/onlineAmmo.js').catch(() => null);
const data = loadData();
function fixture() {
  assert.equal(typeof api?.OnlineAmmo, 'function', 'OnlineAmmo must own authoritative stock');
  const id='us_m901_itv', lo=makeLoadout(id,data.vehicles[id],data.projectiles,data.machineGuns);
  applyAmmo(lo,{[id]:{'0.0':[2]}});
  const L=lo.turrets.map(t=>newLoading(t.guns.length,t.loaders.length));
  const inventory=new api.OnlineAmmo();
  const frame={t:'ammo',ammo_protocol_version:1,battle:7,life:2,revision:1,processed_through:0,counts:{'gun:0:0':[2]},targets:{'gun:0:0':[2]},resupply_progress:0,refilled:false};
  inventory.begin(frame,lo,L);
  return {inventory,lo,L,frame};
}
test('confirmed counts overlay only uncovered predictions across acceptance rejection refill and old scope',()=>{
  const {inventory,lo,frame}=fixture(), g=lo.turrets[0].guns[0];
  assert.deepEqual(inventory.scope(),{battle:7,life:2});
  assert.equal(inventory.predictCannon(41,'gun:0:0',g.ammo[0].shell.id),true);assert.equal(roundsLeft(g),1);
  assert.equal(inventory.receive({...frame,revision:2,processed_through:41,counts:{'gun:0:0':[1]}}),true);assert.equal(roundsLeft(g),1);
  assert.equal(inventory.receive({...frame,revision:3,processed_through:41}),true);assert.equal(roundsLeft(g),2);
  assert.equal(inventory.receive({...frame,revision:2,processed_through:41,counts:{'gun:0:0':[1]}}),false);assert.equal(roundsLeft(g),2);
  assert.equal(inventory.predictCannon(42,'gun:0:0',g.ammo[0].shell.id),true);assert.equal(roundsLeft(g),1);
  inventory.receive({...frame,revision:4,processed_through:42});assert.equal(roundsLeft(g),2);
  assert.equal(inventory.receive({...frame,battle:6,revision:99,counts:{'gun:0:0':[0]}}),false);assert.equal(roundsLeft(g),2);
  assert.equal(inventory.predictCannon(41,'gun:0:0',g.ammo[0].shell.id),false);
});
test('all mandatory wire fields vectors scope counts and progress validate atomically',()=>{
  const {inventory,lo,frame}=fixture(), before=JSON.stringify(inventory.counts());
  const malformed=[{ammo_protocol_version:0},{ammo_protocol_version:'1'},{battle:7.5},{life:Infinity},{revision:Number.MAX_SAFE_INTEGER+1},{processed_through:2**32},{counts:{}},{targets:{}},{counts:{'gun:0:0':[1,0]}},{counts:{'gun:0:0':['1']}},{counts:{'gun:0:0':[-1]}},{counts:{'gun:0:0':[.5]}},{counts:{'gun:0:0':[3]}},{targets:{'gun:0:0':[1]}},{targets:{'gun:0:0':[13]}},{resupply_progress:-1},{resupply_progress:1.1},{resupply_progress:NaN},{refilled:1}];
  for(const change of malformed){assert.throws(()=>inventory.receive({...frame,revision:2,...change}));assert.equal(JSON.stringify(inventory.counts()),before);assert.equal(roundsLeft(lo.turrets[0].guns[0]),2);}
  for(const key of Object.keys(frame)){const bad={...frame,revision:2};delete bad[key];assert.throws(()=>inventory.receive(bad),key);assert.equal(JSON.stringify(inventory.counts()),before);}
});
test('same life targets and mounted identities are immutable and only begin may replace scope',()=>{
  const {inventory,lo,L,frame}=fixture();
  assert.equal(inventory.receive({...frame,life:3,revision:99}),false);assert.deepEqual(inventory.scope(),{battle:7,life:2});
  assert.throws(()=>inventory.begin({...frame,revision:2,targets:{'gun:0:0':[1]},counts:{'gun:0:0':[1]}},lo,L));
  const replacement={...frame,life:3};inventory.begin(replacement,lo,L);
  assert.deepEqual(inventory.scope(),{battle:7,life:3});assert.equal(inventory.receive({...frame,revision:99}),false);
  lo.turrets[0].guns[0].ammo[0].shell={...lo.turrets[0].guns[0].ammo[0].shell,id:'foreign'};
  assert.throws(()=>inventory.receive({...replacement,revision:2}));
});
test('prediction survives missing replies and exposed snapshots cannot mutate the owner',()=>{
  const {inventory,lo,frame}=fixture(), gun=lo.turrets[0].guns[0];
  inventory.predictCannon(5,'gun:0:0',gun.ammo[0].shell.id);
  assert.equal(inventory.predictCannon(5,'gun:0:0',gun.ammo[0].shell.id),false);
  assert.equal(inventory.predictCannon(4,'gun:0:0',gun.ammo[0].shell.id),false);
  inventory.receive({...frame,revision:2,resupply_progress:.5});assert.equal(roundsLeft(gun),1);
  const counts=inventory.counts();counts['gun:0:0'][0]=99;const scope=inventory.scope();scope.life=99;
  assert.equal(inventory.counts()['gun:0:0'][0],1);assert.equal(inventory.scope().life,2);
  inventory.clear();assert.equal(inventory.scope(),null);assert.equal(inventory.predictCannon(6,'gun:0:0',gun.ammo[0].shell.id),false);
});
test('a covered last tube acknowledgement advances once after absolute zero and a refill',()=>{
  for(const refill of [false,true]) {
    const {inventory,lo,L,frame}=fixture(),g=lo.turrets[0].guns[0],session={},launches=new OnlineLaunches();
    const msg={t:'launch',seq:41,ammo_scope:{battle:7,life:2},instance:'gun:0:0',missile:g.def.missile,ammo:g.ammo[0].shell.id};
    assert.equal(launches.begin({gun:g,loading:L[0],gi:0,ti:0,msg,session},0),true);
    inventory.receive({...frame,revision:2,processed_through:41,counts:{'gun:0:0':[0]}});
    assert.equal(g.launcher.ready,2,'absolute inventory never advances the tubes');
    if(refill) inventory.receive({...frame,revision:3,processed_through:41,refilled:true});
    assert.ok(launches.confirm(41,g.def.missile,g,session,{consumeAmmo:false,scope:inventory.scope()}));
    assert.equal(g.launcher.nextTube,1);assert.equal(g.launcher.cooldown,.25);
    assert.equal(roundsLeft(g),refill?2:0);assert.equal(g.launcher.ready,refill?1:0);
    assert.equal(launches.confirm(41,g.def.missile,g,session,{consumeAmmo:false,scope:inventory.scope()}),null);assert.equal(g.launcher.nextTube,1);
  }
});

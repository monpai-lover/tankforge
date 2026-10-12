import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/load-data.mjs';
import * as loadout from '../src/game/loadout.js';
import * as loading from '../src/sim/loading.js';
import * as mg from '../src/sim/mg.js';
import { applyAmmo } from '../src/game/deploy.js';
import * as api from '../src/game/ammoInventory.js';
const data=loadData();
function setup(id,cfg={}) {
  const lo=loadout.makeLoadout(id,data.vehicles[id],data.projectiles,data.machineGuns); applyAmmo(lo,cfg);
  const L=lo.turrets.map(t=>loading.newLoading(t.guns.length,t.loaders.length,t.guns.map(g=>!g.rack)));
  lo.turrets.forEach((t,ti)=>t.guns.forEach((g,gi)=>{if(g.loaded<0)L[ti].state[gi]='empty';}));
  return {lo,L};
}
function requireApi() {for(const n of ['captureAmmoPlan','ammoMix','needsAmmo','refillAmmo','applyAmmoCounts','consumeApsRounds'])assert.equal(typeof api[n],'function',`${n} owns finite inventories`);}
function finish(lo,L,seconds=100) {lo.turrets.forEach((t,ti)=>{for(const gi of loading.tick(L[ti],seconds,(gi,li)=>loadout.reloadTime(t,gi,li))){const g=t.guns[gi];loadout.refillBelt(g);g.loaded=loadout.nextAmmo(g);loadout.syncGunShell(g);loadout.refillLauncher(g);}});}

test('saved short and zero lives start with belts bounded by chosen stock',()=>{
  const before=JSON.stringify(data.vehicles),id='su_bmpt34';
  const short=setup(id,{[id]:{'0.0':[7,0],'0.1':[0,0]}}).lo;
  assert.deepEqual(short.turrets[0].guns.slice(0,2).map(g=>g.belt),[7,0]);
  const fresh=setup(id).lo;
  const source=data.vehicles[id].weapons;
  assert.deepEqual(fresh.turrets[0].guns.slice(0,2).map(g=>g.belt),[source.main_gun.autocannon.belt_rounds,source.extra_guns[0].gun.autocannon.belt_rounds]);
  assert.equal(JSON.stringify(data.vehicles),before);
});

test('all 44 stock loadouts capture immutable selected targets without source mutation',()=>{
  requireApi(); const before=JSON.stringify(data.vehicles); assert.equal(data.order.length,44);
  for(const id of data.order){const {lo,L}=setup(id);const plan=api.captureAmmoPlan(lo);assert.ok(Object.isFrozen(plan));
    for(const [key,p]of Object.entries(plan)){assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.ammo)&&Object.isFrozen(p.targets));const [,ti,gi]=key.split(':').map(Number);assert.deepEqual(p.targets,lo.turrets[ti].guns[gi].ammo.map(a=>a.max));assert.deepEqual(p.ammo,lo.turrets[ti].guns[gi].ammo.map(a=>a.shell.id));}
    assert.equal(api.needsAmmo(lo,plan),false);assert.deepEqual(api.refillAmmo(lo,plan,L),[]);
    assert.deepEqual(api.ammoMix(lo),Object.fromEntries(Object.entries(plan).map(([k,p])=>[k,p.targets])));
    for(const t of lo.turrets)for(const g of t.guns)for(const a of g.ammo)a.count=0;
    api.refillAmmo(lo,plan,L);assert.equal(api.needsAmmo(lo,plan),false);
  }assert.equal(JSON.stringify(data.vehicles),before);
});
test('both BMPT rails spend real rounds and refill the chosen short zero mix only',()=>{
  requireApi();const id='su_bmpt34', {lo,L}=setup(id,{[id]:{'0.0':[7,0],'0.1':[0,5],'0.2':[0],'0.3':[1]}});
  const plan=api.captureAmmoPlan(lo),g=lo.turrets[0].guns[3];assert.equal(loadout.fireLauncherRound(g,L[0],3),true);assert.equal(L[0].state[3],'empty');
  lo.turrets[0].guns[0].ammo[0].count--;lo.turrets[0].guns[1].ammo[1].count--;
  assert.deepEqual(api.refillAmmo(lo,plan,L),['gun:0:0','gun:0:1','gun:0:3']);
  assert.deepEqual(lo.turrets[0].guns.map(g=>g.ammo.map(a=>a.count)),[[7,0],[0,5],[0],[1]]);assert.equal(g.launcher.ready,0);assert.equal(L[0].state[3],'waiting');
  assert.equal(loadout.fireLauncherRound(g,L[0],3),false);finish(lo,L);assert.equal(loadout.fireLauncherRound(g,L[0],3),true);
  const full=setup(id),fp=api.captureAmmoPlan(full.lo);for(const gi of [2,3])assert.equal(loadout.fireLauncherRound(full.lo.turrets[0].guns[gi],full.L[0],gi),true);
  assert.deepEqual(api.refillAmmo(full.lo,fp,full.L),['gun:0:2','gun:0:3']);
});
test('partially loaded twin tubes and active loader jobs remain exactly intact',()=>{
  requireApi();for(const id of ['us_m901_itv','xp_bmp_k64_atgm']){const {lo,L}=setup(id),g=lo.turrets[0].guns[0],plan=api.captureAmmoPlan(lo);
    loadout.fireLauncherRound(g,L[0],0);const launcher=structuredClone(g.launcher),saved=structuredClone(L);api.refillAmmo(lo,plan,L);assert.deepEqual(g.launcher,launcher);assert.deepEqual(L,saved);
    loadout.tickLauncher(g,.25);loadout.fireLauncherRound(g,L[0],0);loading.tick(L[0],.2,()=>g.def.reload_s);const active=structuredClone(L);api.refillAmmo(lo,plan,L);assert.deepEqual(L,active);
  }
});
test('absolute applications reject malformed vectors atomically and obey per-gun total capacity',()=>{
  requireApi();const {lo,L}=setup('su_bmpt34'),valid=api.ammoMix(lo),before=JSON.stringify(lo);
  const sparse=new Array(2);sparse[0]=1;
  const bads=[{}, {...valid,'gun:99:0':[1]}, {...valid,'gun:0:0':[1]}, {...valid,'gun:0:0':[-1,0]}, {...valid,'gun:0:0':[.5,0]}, {...valid,'gun:0:0':['1',0]}, {...valid,'gun:0:0':[Infinity,0]}, {...valid,'gun:0:0':[Number.MAX_SAFE_INTEGER+1,0]}, {...valid,'gun:0:0':sparse}, {...valid,'gun:0:0':[lo.turrets[0].guns[0].capacity,1]}];
  for(const bad of bads){assert.throws(()=>api.applyAmmoCounts(lo,bad,L));assert.equal(JSON.stringify(lo),before);}
  const counts=structuredClone(valid);counts['gun:0:0']=[1,0];api.applyAmmoCounts(lo,counts,L);assert.deepEqual(lo.turrets[0].guns[0].ammo.map(a=>a.count),[1,0]);
});
test('both Oplot variants use one declaration-order pool and preserve thermal and MG state',()=>{
  requireApi();for(const id of ['su_t10m','su_t10m_oplot23']){const {lo,L}=setup(id),plan=api.captureAmmoPlan(lo),ti=lo.weapons.aps.turret??1,g=lo.turrets[ti].guns[0];
    const mgs=lo.machineGuns.map(m=>mg.newMg(m.def));for(const m of mgs){m.heat=.8;m.reload=3;m.belt=7;}const saved=structuredClone(mgs);
    g.spin=.71;g.heat=.63;const counts=g.ammo.map(a=>a.count),take=counts[0]+3;
    api.consumeApsRounds(lo,`gun:${ti}:0`,take);assert.deepEqual(g.ammo.map(a=>a.count),counts.map((n,i)=>i===0?0:i===1?n-3:n));
    for(const bad of [-1,.5,loadout.roundsLeft(g)+1])assert.throws(()=>api.consumeApsRounds(lo,`gun:${ti}:0`,bad));
    api.consumeApsRounds(lo,`gun:${ti}:0`,loadout.roundsLeft(g));g.belt=0;g.loaded=-1;L[ti].state[0]='empty';api.refillAmmo(lo,plan,L);
    assert.equal(g.spin,.71);assert.equal(g.heat,.63);assert.equal(g.belt,0);assert.equal(g.beltChange,true);assert.equal(L[ti].state[0],'waiting');assert.deepEqual(mgs,saved);
  }
});
test('real workshop multi-turret pools refill independently and remain bounded through loading',()=>{
  requireApi();
  const built=loadout.buildToBundle(loadout.PRESETS.hexa.build,data),lo=loadout.makeLoadout('custom',built.bundle,{...data.projectiles,...built.projectiles},data.machineGuns);applyAmmo(lo,{});
  const plan=api.captureAmmoPlan(lo),L=lo.turrets.map(t=>loading.newLoading(t.guns.length,t.loaders.length,t.guns.map(g=>!g.rack)));
  assert.equal(Object.keys(plan).length,6);for(const t of lo.turrets)for(const g of t.guns)g.ammo[0].count--;
  assert.equal(api.refillAmmo(lo,plan,L).length,6);finish(lo,L);assert.deepEqual(api.ammoMix(lo),Object.fromEntries(Object.entries(plan).map(([k,p])=>[k,p.targets])));
});

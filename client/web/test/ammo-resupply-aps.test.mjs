import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../tools/load-data.mjs';
import { loadCoreSync } from '../src/design/core.js';
import * as loadout from '../src/game/loadout.js';
import * as loading from '../src/sim/loading.js';
import { deriveLoadoutPerformance } from '../src/game/gameplayPerformance.js';
import { applyAmmo } from '../src/game/deploy.js';
import { weaponReloadRate } from '../src/game/weaponDamage.js';
import * as inventory from '../src/game/ammoInventory.js';
import * as policy from '../src/game/ammoResupply.js';
const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n'),data=loadData();
function body(name){const start=source.indexOf(`  function ${name}(`);assert.ok(start>=0);return source.slice(start,source.indexOf('\n  }',start)+4);}
function runtime(id,mode){
  const lo=deriveLoadoutPerformance(loadout.makeLoadout(id,data.vehicles[id],data.projectiles,data.machineGuns),mode);applyAmmo(lo,{});
  const ti=lo.weapons.aps.turret??1,G={loadout:lo,mode:'battle',online:null,aps:lo.weapons.aps,apsOn:true,sightM:-1,sightT:0,
    T:lo.turrets.map(t=>({loading:loading.newLoading(t.guns.length,t.loaders.length,t.guns.map(g=>!g.rack))}))};
  const core=loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm',import.meta.url)),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)});
  core.call({op:'mw_reset',defs:Object.values(data.missiles)});core.call({op:'mw_aps',owner:1,team:0,def:G.aps,seed:10});
  G.missiles={setAps(owner,enabled,rate_rpm=null,rounds=null){core.call({op:'mw_aps',owner,enabled,rate_rpm,rounds});}};
  const live=new Function('G','ME','roundsLeft','net','hud',`${body('apsAutomatic')}\n${body('syncApsControl')}\n${body('cycleApsRate')}\nreturn {syncApsControl,cycleApsRate};`)(G,1,loadout.roundsLeft,{send(){}},{toast(){}});
  const actor={id:1,team:0,alive:true,center:[0,1.3,0],aps_pivot:[.502,2.715,.557],aps_base_yaw:0,aps_gun_ok:true,aps_radar_ok:true};
  const step=dt=>core.call({op:'mw_step',dt,actors:[actor]});
  const threat=seed=>core.call({op:'mw_launch',def:'bgm71a_tow',owner:99,team:1,pos:[0,2,600],dir:[0,0,-1],seed});
  return {G,core,live,step,threat,ti,g:lo.turrets[ti].guns[0],L:G.T[ti].loading};
}
test('actual APS control and rate changes inhibit a healthy gun during normal loading',()=>{
  const r=runtime('su_t10m','historical');loading.fired(r.L,0);r.live.syncApsControl();assert.equal(r.step(0).aps[0].enabled,false,'requested on must wait for normal loader');
  r.live.cycleApsRate();assert.equal(r.step(0).aps[0].enabled,false,'rate selection must keep the reload gate');assert.equal(r.G.apsOn,true);
});
test('real WASM incoming missiles cannot use replenished Oplot stock before the source belt cycle',()=>{
  assert.equal(typeof inventory.captureAmmoPlan,'function','selected life targets exist');assert.equal(typeof policy.stepResupply,'function','five-second dwell exists');
  for(const id of ['su_t10m','su_t10m_oplot23'])for(const mode of ['historical','casual']){
    const r=runtime(id,mode),plan=inventory.captureAmmoPlan(r.G.loadout),state=policy.newResupplyState();
    r.threat(1);let warm;for(let i=0;i<1200;i++){warm=r.step(1/120);if(warm.fired.length)break;}
    assert.ok(warm.fired.length&&warm.aps[0].heat>0&&warm.aps[0].spin>0,'grant preservation starts from actual warm interception state');
    inventory.consumeApsRounds(r.G.loadout,`gun:${r.ti}:0`,loadout.roundsLeft(r.g));r.g.belt=0;r.g.loaded=-1;r.L.state[0]='empty';
    r.live.syncApsControl();const before=r.step(0).aps[0];assert.equal(policy.stepResupply(state,5,true,true).complete,true);
    inventory.refillAmmo(r.G.loadout,plan,r.G.T.map(t=>t.loading));r.live.syncApsControl();const granted=r.step(0).aps[0];
    for(const key of ['yaw','pitch','rate_rpm','heat','spin'])assert.equal(granted[key],before[key],`${id} ${key} at grant`);
    assert.equal(r.G.apsOn,true);assert.equal(granted.enabled,false);assert.equal(r.L.state[0],'waiting');
    const duration=r.g.def.autocannon.belt_reload_s;let last=granted,threats=0;
    for(let i=0;i<Math.ceil(duration*120)-1;i++){
      if(i%120===0){r.threat(3+threats++);}
      r.live.syncApsControl();last=r.step(1/120);assert.deepEqual(last.fired,[],`${id} ${mode} no fire before loader completion`);
      assert.deepEqual(loading.tick(r.L,1/120,(gi,li)=>loadout.reloadTime(r.G.loadout.turrets[r.ti],gi,li,mode),()=>weaponReloadRate(null,r.g.damageKey)),[]);
    }
    assert.ok(threats>0);assert.ok(last.aps[0].heat<=granted.heat);assert.ok(last.aps[0].spin<=granted.spin);assert.deepEqual(last.aps[0].track_pos||[],[],'disabled core reacquires tracks on re-enable');
    const done=loading.tick(r.L,1/120,(gi,li)=>loadout.reloadTime(r.G.loadout.turrets[r.ti],gi,li,mode));assert.deepEqual(done,[0]);
    loadout.refillBelt(r.g);r.g.loaded=loadout.nextAmmo(r.g);loadout.syncGunShell(r.g);r.live.syncApsControl();assert.equal(r.step(0).aps[0].enabled,true);
    r.threat(900);let fired=[];for(let i=0;i<1200&&!fired.length;i++)fired=r.step(1/120).fired;assert.ok(fired.length,`${id} ${mode} resumes genuine interception after reacquisition/spin-up`);
    r.G.apsOn=false;r.live.syncApsControl();assert.equal(r.step(0).aps[0].enabled,false);r.live.cycleApsRate();assert.equal(r.step(0).aps[0].enabled,false);
  }
});

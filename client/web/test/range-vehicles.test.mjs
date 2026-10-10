import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../tools/load-data.mjs';
import { buildTank } from '../src/gfx/tankmodel.js';
import { STRIDE } from '../src/gfx/geo.js';
import { decodeImported } from '../src/gfx/imported.js';
import { makeLoadout, generatedTurretParts } from '../src/game/loadout.js';
import { Enemy, useCombat, combatHit } from '../src/game/enemies.js';
import { Terrain } from '../src/game/terrain.js';
import { groundRay, hitTargets, humpLift, COURSE, FIELD } from '../src/game/world.js';
import { loadCoreSync } from '../src/design/core.js';
import { Combat } from '../src/game/combat.js';

const data = loadData();
const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const layoutPath = new URL('../src/game/rangeVehicles.js', import.meta.url);
async function layout() {
  assert.ok(fs.existsSync(layoutPath), 'single-player range needs an authored vehicle target layout');
  return (await import(layoutPath)).rangeVehicleTargets();
}
const functionSource = name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `live ${name} function present`);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
};
function live(names, deps) {
  return new Function(...Object.keys(deps), `${names.map(functionSource).join('\n')}\nreturn {${names.join(',')}};`)(...Object.values(deps));
}

test('single-player range actually invokes vehicle spawning when entering battle', () => {
  let spawns = 0;
  const G = {mode:'garage',thumbs:[],mapId:'range',maps:new Map(),map:null,online:null,loadout:{name:'test'}};
  const deps = {G,hud:{toast(){},freeLook(){}},useWorld(){},setMode(mode){G.mode=mode;},spawnEnemies(){spawns++;},resetPose(){},missileBattleStart(){},updateNetHud(){}};
  live(['startBattle'],deps).startBattle();
  assert.equal(spawns,1,'the range must spawn real vehicles as well as paper targets');
});

test('range distances and frontal hull protection progress from thin armour to modern chassis', async () => {
  const rows = await layout();
  assert.deepEqual(rows.map(t=>t.rangeM),[100,200,400,600,800,1200,1600,2000]);
  assert.equal(new Set(rows.map(t=>t.id)).size,8);
  let prev = 0;
  for(const t of rows) {
    const b = data.vehicles[t.id];
    assert.ok(b,'target uses an existing stock vehicle');
    assert.ok(Math.abs(Math.hypot(t.x,t.z)-t.rangeM)<1e-7,'label is true distance from the firing origin');
    assert.ok(Math.abs(Math.sin(t.heading)+t.x/t.rangeM)<1e-7 && Math.abs(Math.cos(t.heading)+t.z/t.rangeM)<1e-7,'frontal hull faces the firing origin');
    const plate = b.armor.find(p=>p.id==='hull_upper_front');
    const los = plate.thickness_mm / Math.abs(plate.normal.z);
    assert.ok(los > prev,`${t.id} frontal hull must be more protected than the preceding target`);
    prev = los;
    for(const rect of [COURSE.rect,FIELD.rect]) assert.ok(t.x<rect[0]-6||t.x>rect[2]+6||t.z<rect[1]-6||t.z>rect[3]+6,'no vehicle stands on course obstacles or cross-country relief');
  }
  assert.equal(rows.at(-1).id,'xp_bmp_k64','furthest target has the existing T-64 chassis armour');
});

test('actual range models settle, have clear firing lanes and independent combat state, and are released', async () => {
  const rows=await layout();
  for(const row of rows) {
    const b=data.vehicles[row.id];
    if(b.model) b.imported=await decodeImported(b.model);
  }
  const core=loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm',import.meta.url)),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)});
  const combat=new Combat(core), terrain=new Terrain(data.terrains,humpLift);
  let freed=0;
  const renderer={mesh:d=>({data:d,count:d.length/STRIDE}),instancedMesh:(d,capacity)=>({data:d,count:d.length/STRIDE,capacity}),setInstances(){},freeMesh(){freed++;},texture(){return {};},freeTexture(){}};
  const scene={children:[],add(root){this.children.push(root);}};
  const G={map:null,id:'xp_bmp_k64',enemies:[],combat:null};
  const deps={G,data,renderer,scene,terrain,makeLoadout,buildTank,generatedTurretParts,Enemy,useCombat,rangeVehicleTargets:()=>rows,ENEMY_POOL:['su_t54'],hitcam:{hide(){}}};
  const app=live(['clearEnemies','spawnEnemies','hitEnemy','bindCombatReady'],deps);
  app.spawnEnemies();
  assert.equal(G.enemies.length,8);
  assert.equal(scene.children.length,8);
  const originalModels=G.enemies.map(e=>e.model);
  const readyStart=source.indexOf('  coreP.then((c) => {');
  const readySource=source.slice(readyStart,source.indexOf('\n  });',readyStart)+6);
  const readyDeps={G,Combat,useCombat,bindCombatReady:app.bindCombatReady,coreP:{then(callback){callback(core);}},Missiles:class {constructor(){}},data,renderer,scene,fx:{},sound:{},missileGround(){},refreshDesigns(){}};
  new Function(...Object.keys(readyDeps),readySource)(...Object.values(readyDeps));
  assert.ok(G.enemies.every(e=>e.combat&&e.cstate&&e.caps),'a late core binds all existing targets to real armour, modules and crew');
  assert.deepEqual(G.enemies.map(e=>e.model),originalModels,'core readiness never recreates the visible models');
  const paper=[200,400,600,800,1000,1200,1600,2000].map((range,i)=>{const big=range>=1600?1.6:range>=1000?1.25:1;return {x:(i%2===0?1:-1)*(range>=1000?19:13),y:.5+1.3*big,z:range,hw:1.6*big,hh:1.3*big};});
  const keys=new Set();
  for(let i=0;i<G.enemies.length;i++) {
    const e=G.enemies[i], o=e.veh.body.origin();
    assert.equal(e.rangeTarget,true);
    assert.equal(e.rangeM,rows[i].rangeM);
    assert.notEqual(e.combatKey,G.id,'target and player never share fold/armour registration');
    assert.ok(e.cstate&&e.caps,'stock modules and crew participate in Combat');
    keys.add(e.combatKey);
    assert.ok(Math.abs(o[0]-rows[i].x)<.2 && Math.abs(o[2]-rows[i].z)<.2,'settling does not roll a target out of its lane');
    assert.ok(o.every(Number.isFinite),'physical body remains finite');
    assert.ok(Math.abs(e.veh.attitude().pitch)<.1,'target hull is settled on ordinary ground');
    const center=e.veh.body.worldPoint([.1,1,0]);
    const from=[0,1.8,0], d=center.map((v,k)=>v-from[k]), len=Math.hypot(...d), dir=d.map(v=>v/len);
    assert.ok(groundRay(from,dir,len,(x,z)=>terrain.height(x,z))>=len-3,'ground does not block hull centre');
    assert.equal(hitTargets(paper,from,center),null,'paper targets do not obstruct vehicle targets');
    assert.equal(app.hitEnemy(from,center)?.e,e,'no nearer vehicle blocks this target');
  }
  assert.equal(keys.size,8,'every target has its own combat registry key');
  const near=G.enemies[0],far=G.enemies.at(-1), untouched=JSON.stringify(far.cstate);
  const a=[0,1.8,0], b=near.veh.body.worldPoint([.1,1,0]), delta=b.map((v,k)=>v-a[k]), n=Math.hypot(...delta), dir=delta.map(v=>v/n), hit=near.intersect(a,b);
  assert.ok(hit?.plate,'live projectile intersects actual armour');
  const report=combatHit(near,a,dir,data.projectiles.apcbc_88_l56,800,100,13);
  assert.notEqual(report.outcome,'miss','real WASM core resolves the target hit');
  assert.equal(JSON.stringify(far.cstate),untouched,'shooting one target does not damage another');
  app.clearEnemies();
  assert.equal(G.enemies.length,0);
  assert.equal(scene.children.length,0);
  assert.ok(freed>0,'leaving frees the actual target model meshes');
  app.spawnEnemies();
  assert.equal(G.enemies.length,8,'re-entering regenerates every range target');
  assert.ok(G.enemies.every(e=>e.combat&&e.cstate&&e.alive),'already-ready Combat binds fresh targets immediately');
  assert.deepEqual(new Set(G.enemies.map(e=>e.combatKey)),keys,'range registry keys remain stable across entries');
  G.map={spawns:{blue:[{x:0,z:0}],red:[{x:20,z:700,heading:Math.PI},{x:-20,z:900,heading:Math.PI}]}};
  app.spawnEnemies();
  assert.equal(G.enemies.length,2,'a battle map still uses only its red spawn points');
  assert.ok(G.enemies.every(e=>!e.rangeTarget&&e.id==='su_t54'),'map targets retain their original enemy pool');
  app.clearEnemies();
  assert.equal(scene.children.length,0,'switching modes never leaves stale range models');
});

test('range targets cannot autonomously fire missiles even if a launcher is fitted', () => {
  const e={alive:true,remote:false,rangeTarget:true,get loadout(){throw new Error('training target reached offensive AI');}};
  const G={missiles:{ready:true},mode:'battle',enemies:[e],online:null};
  const ai=live(['aiMissiles'],{G,playerMiddle:()=>[0,1,0]}).aiMissiles;
  assert.doesNotThrow(()=>ai(10));
});

test('range targets do not activate defensive guns, while map enemies retain active protection', () => {
  const registered=[];
  const G={missiles:{reset(){},addAps(...args){registered.push(args);}},enemies:[{bundle:{weapons:{aps:{name:'training APS'}}},rangeTarget:true},{bundle:{weapons:{aps:{name:'map APS'}}}}]};
  live(['missileBattleStart'],{G,missileTerrain:()=>null,onlineLaunches:{clear(){}},missileVehicle(){},enemyOwner:i=>100+i}).missileBattleStart();
  assert.deepEqual(registered.map(a=>a[0]),[101]);
});

test('far range target tags remain visible and ordinary map and online tag rules are preserved', () => {
  let tags=[];
  const make = (x,flags={}) => ({x,z:100,veh:{body:{origin:()=>[x,0,100]}},box:{top:2},name:'vehicle',alive:true,rangeM:2000,...flags});
  const G={mode:'battle',online:null,map:null,mapTick:0,s:{x:0,z:0},enemies:[make(2000,{rangeTarget:true}),make(2000),make(5,{rangeTarget:true,rangeM:100})]};
  const deps={G,project:()=>[0,0,1],groundRay:()=>Infinity,buildingHit:()=>null,surfaceAt:()=>0,hud:{drawNameTags(t){tags=t;}}};
  const draw=live(['drawVehicleTags'],deps).drawVehicleTags;
  draw([0,2,0],null,1280,800);
  assert.equal(tags.length,2,'2000 m training target and near target labelled, unrelated enemies excluded');
  assert.match(tags[0].name,/2000/);
  G.map={};tags=[];draw([0,2,0],null,1280,800);
  assert.equal(tags.length,0,'ordinary offline battle map receives no new tags');
  G.online={team:'blue'};G.enemies=[make(2000,{remote:true,team:'red',player:'far enemy'}),make(2000,{remote:true,team:'blue',player:'friend'}),make(5,{remote:true,team:'red',player:'near enemy'})];
  draw([0,2,0],null,1280,800);
  assert.deepEqual(tags.map(t=>t.name),['friend','near enemy'],'online spotting distance and friendly tags remain unchanged');
});

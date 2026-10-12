import { LocalReplayAdmission } from "../src/game/localReplayAdmission.js";
import * as selection from '../src/game/weaponselection.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NetClient } from '../src/game/net.js';
import * as netApi from '../src/game/net.js';
import { LobbyUi } from '../src/game/lobbyui.js';
import { GameplaySession } from '../src/game/gameplaySession.js';
import { GAMEPLAY_RULES_VERSION } from '../src/game/gameplayRules.js';
import { Hud } from '../src/game/hud.js';
import { loadData } from '../tools/load-data.mjs';
import * as loadout from '../src/game/loadout.js';
import * as performanceApi from '../src/game/gameplayPerformance.js';
import * as phys from '../src/sim/physics.js';
import * as loading from '../src/sim/loading.js';
import * as mgSim from '../src/sim/mg.js';
import { OnlineFires } from '../src/game/onlineFire.js';
import { applyAmmo } from '../src/game/deploy.js';
import { VehicleSim } from '../src/game/vehicle.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { ground } from './tankrig.mjs';
import * as inventory from '../src/game/ammoInventory.js';
import * as resupply from '../src/game/ammoResupply.js';

import { OnlineAmmo } from "../src/game/onlineAmmo.js";
import { OnlineLaunches } from "../src/game/onlineLaunch.js";
import * as gunnery from "../src/sim/gunnery.js";
import * as damage from "../src/game/weaponDamage.js";
import { emptyRacks, launcherCanFire, CREW_NAME, EVENT_NAME } from "../src/game/combat.js";
import * as ballistics from '../src/sim/ballistics.js';
import { hullTilt } from '../src/sim/tank/tank.js';
import { GARAGE } from '../src/game/world.js';
import { captureMessage } from '../src/game/conquest.js';
import { useCombat,combatHit,RESULT_LABEL } from '../src/game/enemies.js';
import {reviveRangeTarget} from '../src/game/rangeTargetRevival.js';
import { buildInterior } from '../src/gfx/interior.js';
import { Missiles } from '../src/game/missiles.js';
import { loadCoreSync } from '../src/design/core.js';
import { presentationNode, presentationDocument, weaponHud } from './weapon-control-hud-rig.mjs';
const data=loadData();
const source=fs.readFileSync(new URL("../src/main.js",import.meta.url),"utf8").replaceAll("\r\n","\n");
const fn = name => { const a = source.indexOf(`  function ${name}(`); return a < 0 ? '' : source.slice(a, source.indexOf('\n  }', a) + 4); };
const storage = () => { const values = new Map(); return { values, get: k => values.get(k), set: (k, v) => values.set(k, v) }; };
const node = presentationNode;
export function runtime(local, options = {}) {
  const store = storage(), gameplay = new GameplaySession(store),localReplay=new LocalReplayAdmission();
  gameplay.chooseLocal(local);
  const G = { localReplay,weaponControl: { kind: 'all' }, id: 'su_t34_85', mode: 'garage', gameplayMode: gameplay.activeMode(), s: phys.newState(), pending: [], shots:[], bullets:[], guided:[],aim:{}, cam: {shake:0}, thumbs: [], mapId: 'range', maps: new Map(options.loadMap?[]:Object.entries(data.maps)), enemies: [], keys: new Set(),camPos:[0,0,0] };
  const notices=[],cqBar=node(),cqMsg=node();G.combat=options.combat||null;G.cstate=null;G.caps=null;G.carried=-1;
  const document = presentationDocument(), getElementById = document.getElementById;
  document.getElementById = id => id === 'cq-msg' ? cqMsg : id === 'cq-bar' ? cqBar : getElementById(id);
  const weaponDisplay = weaponHud(document, (text, seconds) => notices.push({ text, seconds }));
  const hudState = { el: Object.fromEntries(['kind','name','vehName','based','outline','spec'].map(k => [k,node()])) };
  const hud = new Proxy({ el: weaponDisplay.el,
    buildGunList: weaponDisplay.buildGunList.bind(weaponDisplay), buildAmmo: weaponDisplay.buildAmmo.bind(weaponDisplay),
    weaponControl: weaponDisplay.weaponControl.bind(weaponDisplay),
    toast(text,seconds){notices.push({text,seconds});}, showSpec(...args) { hudState.el.spec.children=[]; Hud.prototype.showSpec.call(hudState,...args); } }, { get(o,k) { return o[k] || (() => {}); } });
  const net = new NetClient();
  const receive=net._receive.bind(net);net._receive=m=>receive(structuredClone(m));
  const scene = { children: [], add(n) { this.children.push(n); } };
  const renderer = { mesh: vertices => ({ vertices }), instancedMesh: vertices => ({ vertices }), setInstances() {}, freeMesh() {} };
  const deps = { G, localReplay, performance:options.clock||performance, gameplay, GAMEPLAY_RULES_VERSION, ...netApi, ...selection, ...loadout, ...performanceApi, ...inventory, ...resupply, ...damage, launcherCanFire, phys, gunnery, ballistics, hullTilt, captureMessage, CREW_NAME, EVENT_NAME, DEG:Math.PI/180, RECOIL_ROCK:1,GARAGE,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),cameraObstruction:{reset(){}},vehicleActionIndicator:{update(){}},rng:{nextF32:()=>.5}, surfaceAt:()=>0,impactColor:()=>[0,0,0], ME:1, dirFrom:(y,p)=>[Math.sin(y)*Math.cos(p),Math.sin(p),Math.cos(y)*Math.cos(p)], data, document, store, STORE_VEHICLE: 'vehicle', LANG_INDEX: 0,
    isDesign: () => false, bundleFor: options.bundleFor || (id => ({ bundle: data.vehicles[id], projectiles: data.projectiles })), AMMO_CFG: {}, applyAmmo,
    onlineFires: new OnlineFires(), onlineLaunches:new OnlineLaunches(), onlineAmmo:new OnlineAmmo(), OnlineAmmo, emptyRacks, loading, mgSim, renderer, buildTank, VehicleSim, terrain: ground(() => 0), scene, hud,
    syncRacks(){}, Exhaust: class {}, fx: new Proxy({}, {get:()=>()=>{}}), exhaustOf() {}, applyXray() {}, rebuildInterior() {}, useCombat, buildInterior, statusShape() {}, selectAmmo() {},
    mods: { choose() {}, cardOf: id => id, slots: () => [] }, measureInsets() {}, missileVehicle() {G.aps=data.vehicles[G.id].weapons.aps||null;}, missileBattleStart() {G.aps=data.vehicles[G.id].weapons.aps||null;},
    net, lobby: { render() {}, sendVehicle() {}, show() {} }, MAP_IDS: ['range','coast'], RESPAWN_DELAY: 5, missileTerrain:()=>null,enemyOwner:i=>100+i,
    reviveRangeTarget,combatHit,RESULT_LABEL,arr3:p=>Array.isArray(p)?p:[p.x,p.y,p.z],buildingHit:()=>null,hitSelf:()=>null,splashNear(){},showHit(){},
    useWorld(id){G.map=data.maps[id]||null;}, spawnEnemies() {options.spawnEnemies?.(G,renderer,ground(()=>0),scene);}, spawnRemotes() {}, resetPose(){G.veh.place(0,0,0);G.veh.compat(G.s);deps.combatInit();}, updateNetHud() {}, testRange: { exit() {} }, setProtect() {}, setWorkshop() {}, setXray() {}, thumbStep() {}, setMapChoice(id) { G.mapId=id; }, loadMap: options.loadMap, mapName: () => 'range', feed() {},
    deploy: { close() {} }, openDeploy() {}, cqBar, cqMsg, clearEnemies() { G.enemies=[]; }, hitcam: { hide() {} }, canvas: {}, sound: new Proxy({}, {get:()=>()=>{}}), vehicleActions:{cancel(){},reset(){}},toggleSight(){},playerName:id=>String(id),remoteOf: () => null, removeRemote() {}, addRemote() {}, benchedMember: () => true,
  };
  const a=source.indexOf("  net.on('start',"),b=source.indexOf("  net.on('snap',",a);
  const ra=source.indexOf("  net.on('respawned',"),rb=source.indexOf("  net.on('ended',",ra);
  const la=source.indexOf("  for (const t of ['closed', 'left_room'])"),lb=source.indexOf("  const chatIn =",la);
  const sa=source.indexOf("  net.on('snap',"),sb=source.indexOf("  // a missile or rocket left",sa);
  const ma=source.indexOf("  const moduleOk ="),mb=source.indexOf("\n  };",ma)+5;
  const ha=source.indexOf("  net.on('capture',"),hb=source.indexOf("  function markDead(",ha);
  const ta=source.indexOf("  net.on('status',"),tb=source.indexOf("  net.on('respawned',",ta);
  const da=source.indexOf("  net.on('damage',"),eb=source.indexOf("  /** One selection point",source.indexOf('  net.replayActorProvider='));
  const ea=source.indexOf('  net.replayActorProvider=');
  const qa=source.indexOf("  net.on('reconnecting',"),qb=source.indexOf("  for (const t of ['closed'",qa);
  const fa=source.indexOf('  const currentFireGun ='),fb=source.indexOf("  net.on('fire',",fa);
  const missileCore=options.combat?.core || (Object.hasOwn(options,'combat') ? null : loadCoreSync(fs.readFileSync(process.env.TG_TEST_WASM||new URL('../assets/tg_design.wasm',import.meta.url)),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)}));
  G.missiles=new Missiles({core:missileCore,defs:data.missiles,projectiles:data.projectiles});
  G.missiles._launchLook=()=>{G.launchEffects=(G.launchEffects||0)+1;};
  G.missiles.present=res=>{for(const a of res.aps||[])G.missiles.aps.set(a.owner,a);};
  const spawns=source.slice(source.indexOf('  const RANGE_SPAWNS ='),source.indexOf('  /** Where a team')) ;
  const mounts=source.slice(source.indexOf('  const pose ='),source.indexOf('  // ----------------------------------------------------------------- workshop'));
  delete deps.sightLevels;
  const live = new Function(...Object.keys(deps), `${mounts}\n${spawns}\n${['replayActorFor','localReplayPose','bindLocalReplay','resetPose','combatInit','bindCombatReady','missileVehicle','missileBattleStart','apsHullPose','apsFrame','heldApsPose','sendOnlineState','acceptApsPose','suspendApsPose','syncApsControl','toggleAps','spawnPoint','onlineSpawn','conquestStep','resupplyStep','announcePoint','markDead','cycleSightGun','trigger','fireGun','layMg','stepMachineGuns','launchFromGun','retryPendingLaunches','select','onlineSky','applyAps','apsAutomatic','validateOnlineLife','carriedRounds','syncRacks','reloadShown','setMode','gameplayLabel','updateGameplayDisplay','chooseGameplayMode','applyRoomGameplay','startBattle','toGarage','resetVehicle','reviveRangeEnemy','hitSelf','missileImpacts','selfMissileHit','advanceCombat'].map(fn).join('\n')}\n${source.slice(ea,eb)}\n${source.slice(a,b)}\n${source.slice(ra,rb)}\n${source.slice(la,lb)}\n${source.slice(ma,mb)}\n${source.slice(sa,sb)}\n${source.slice(fa,fb)}\n${source.slice(ha,hb)}\n${source.slice(da,ta)}\n${source.slice(ta,tb)}\n${source.slice(qa,qb)}\nselect(G.id); return {select,chooseGameplayMode,toGarage,startBattle,conquestStep,cycleSightGun,trigger,fireGun,stepMachineGuns,retryPendingLaunches,markDead,bindCombatReady,toggleAps,syncApsControl,sendOnlineState,onlineSky,bindLocalReplay,resetVehicle,reviveRangeEnemy,missileImpacts,selfMissileHit,advanceCombat};`)(...Object.values(deps));
  G.bindReplay=live.bindLocalReplay;
  net.replayActorProvider=()=>{const scope=deps.onlineAmmo.scope();return G.online&&scope?{...scope,entity:net.id}:null;};
  return { G, net, gameplay, localReplay, store, live, hud, scene,onlineAmmo:deps.onlineAmmo, onlineFires:deps.onlineFires, onlineLaunches:deps.onlineLaunches, notices,ui:{cqBar,cqMsg},spec: () => hudState.el.spec.children.map(n => n.textContent).join(' ') };
}

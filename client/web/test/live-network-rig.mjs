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
import { weaponDamage } from "../src/game/weaponDamage.js";
import { emptyRacks } from "../src/game/combat.js";
const data=loadData();
const source=fs.readFileSync(new URL("../src/main.js",import.meta.url),"utf8").replaceAll("\r\n","\n");
const fn = name => { const a = source.indexOf(`  function ${name}(`); return a < 0 ? '' : source.slice(a, source.indexOf('\n  }', a) + 4); };
const storage = () => { const values = new Map(); return { values, get: k => values.get(k), set: (k, v) => values.set(k, v) }; };
function node() { return { children: [], dataset: {}, style: {}, textContent: '', append(...c) { this.children.push(...c); } }; }
export function runtime(local, options = {}) {
  const store = storage(), gameplay = new GameplaySession(store);
  gameplay.chooseLocal(local);
  const G = { id: 'su_t34_85', mode: 'garage', gameplayMode: gameplay.activeMode(), s: phys.newState(), pending: [], shots:[], guided:[], cam: {shake:0}, thumbs: [], mapId: 'range', maps: new Map(), enemies: [], keys: new Set(),camPos:[0,0,0] };
  const elements = new Map();
  globalThis.document = { body: { dataset: {} }, getElementById(id) { if (!elements.has(id)) elements.set(id,node()); return elements.get(id); }, createElement: node, createTextNode: text => ({ textContent: text }) };
  const hudState = { el: Object.fromEntries(['kind','name','vehName','based','outline','spec'].map(k => [k,node()])) };
  const hud = new Proxy({ showSpec(...args) { hudState.el.spec.children=[]; Hud.prototype.showSpec.call(hudState,...args); } }, { get(o,k) { return o[k] || (() => {}); } });
  const net = new NetClient();
  const receive=net._receive.bind(net);net._receive=m=>receive(structuredClone(m));
  const scene = { children: [], add(n) { this.children.push(n); } };
  const renderer = { mesh: vertices => ({ vertices }), instancedMesh: vertices => ({ vertices }), setInstances() {}, freeMesh() {} };
  const deps = { G, gameplay, GAMEPLAY_RULES_VERSION, ...netApi, ...loadout, ...performanceApi, ...inventory, ...resupply, phys, gunnery, weaponDamage, ME:1, data, document, store, STORE_VEHICLE: 'vehicle', LANG_INDEX: 0,
    isDesign: () => false, bundleFor: id => ({ bundle: data.vehicles[id], projectiles: data.projectiles }), AMMO_CFG: {}, applyAmmo,
    onlineFires: new OnlineFires(), onlineLaunches:new OnlineLaunches(), onlineAmmo:new OnlineAmmo(), OnlineAmmo, emptyRacks, loading, mgSim, renderer, buildTank, VehicleSim, terrain: ground(() => 0), scene, hud,
    syncRacks(){}, Exhaust: class {}, fx: {}, exhaustOf() {}, applyXray() {}, rebuildInterior() {}, combatInit() {}, statusShape() {}, selectAmmo() {}, sightGun: () => G.loadout.turrets[0].guns[0],
    mods: { choose() {}, cardOf: id => id, slots: () => [] }, measureInsets() {}, missileVehicle() {G.aps=data.vehicles[G.id].weapons.aps||null;}, missileBattleStart() {G.aps=data.vehicles[G.id].weapons.aps||null;},
    net, lobby: { render() {}, sendVehicle() {}, show() {} }, MAP_IDS: ['range','coast'], RESPAWN_DELAY: 5,
    useWorld() {}, spawnEnemies() {}, spawnRemotes() {}, resetPose() {}, updateNetHud() {}, testRange: { exit() {} }, setProtect() {}, setWorkshop() {}, setXray() {}, thumbStep() {}, setMapChoice(id) { G.mapId=id; }, loadMap: options.loadMap, mapName: () => 'range', feed() {},
    deploy: { close() {} }, openDeploy() {}, cqBar: {}, cqMsg: {}, clearEnemies() { G.enemies=[]; }, hitcam: { hide() {} }, canvas: {}, sound: new Proxy({}, {get:()=>()=>{}}), markDead(){}, remoteOf: () => null, removeRemote() {}, addRemote() {}, benchedMember: () => true,
  };
  const a=source.indexOf("  net.on('start',"),b=source.indexOf("  net.on('snap',",a);
  const ra=source.indexOf("  net.on('respawned',"),rb=source.indexOf("  net.on('ended',",ra);
  const la=source.indexOf("  for (const t of ['closed', 'left_room'])"),lb=source.indexOf("  const chatIn =",la);
  const sa=source.indexOf("  net.on('snap',"),sb=source.indexOf("  // a missile or rocket left",sa);
  const ma=source.indexOf("  const moduleOk ="),mb=source.indexOf("\n  };",ma)+5;
  const fa=source.indexOf('  const currentFireGun ='),fb=source.indexOf("  net.on('fire',",fa);
  G.missiles={ready:true,nodes:new Map(),reset(){},present(){},_launchLook(){G.launchEffects=(G.launchEffects||0)+1;}};
  const live = new Function(...Object.keys(deps), `${['select','onlineSky','applyAps','apsAutomatic','validateOnlineLife','carriedRounds','syncRacks','reloadShown','setMode','gameplayLabel','updateGameplayDisplay','chooseGameplayMode','applyRoomGameplay','startBattle','toGarage'].map(fn).join('\n')}\n${source.slice(a,b)}\n${source.slice(ra,rb)}\n${source.slice(la,lb)}\n${source.slice(ma,mb)}\n${source.slice(sa,sb)}\n${source.slice(fa,fb)}\nselect(G.id); return {select,chooseGameplayMode,toGarage,startBattle};`)(...Object.values(deps));
  return { G, net, gameplay, store, live, onlineAmmo:deps.onlineAmmo, onlineFires:deps.onlineFires, onlineLaunches:deps.onlineLaunches, notices:[], spec: () => hudState.el.spec.children.map(n => n.textContent).join(' ') };
}

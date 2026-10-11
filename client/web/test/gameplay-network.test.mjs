// Local native→browser integration. Generate the receipt explicitly:
// TG_GAMEPLAY_NETWORK_RECEIPT=<repo>/target/gameplay-network.json cargo test -p tg-server browser_protocol_receipt_from_actual_handlers --lib
// node --test client/web/test/gameplay-network.test.mjs
import test from 'node:test';
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

const root = new URL('../../../', import.meta.url);
const receiptPath = process.env.TG_GAMEPLAY_NETWORK_RECEIPT || new URL('target/gameplay-network.json', root);
assert.ok(fs.existsSync(receiptPath), 'Generate the actual native handler receipt before this suite');
const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
assert.deepEqual(Object.keys(receipt.sources).sort(), ['crates/server/src/lobby.rs','crates/server/src/gameplay.rs','crates/server/src/server.rs','crates/server/src/missiles.rs','crates/server/src/gameplay_tests.rs','crates/gameplay/src/lib.rs','Cargo.toml','crates/server/Cargo.toml','crates/gameplay/Cargo.toml','config/gameplay-modes.json'].sort(), 'Every source/config tag is mandatory');
for (const [path, bytes] of Object.entries(receipt.sources)) assert.ok(fs.readFileSync(new URL(path, root), 'utf8') === bytes, `Stale native receipt: ${path}`);
const data = loadData();
const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const fn = name => { const a = source.indexOf(`  function ${name}(`); return a < 0 ? '' : source.slice(a, source.indexOf('\n  }', a) + 4); };
const packet = (phase, id, t) => receipt.phases[phase].find(([to, m]) => to === id && m.t === t)?.[1];
const storage = () => { const values = new Map(); return { values, get: k => values.get(k), set: (k, v) => values.set(k, v) }; };
function socket() {
  class Socket {
    constructor() { this.readyState = 1; this.sent = []; Socket.last = this; }
    send(text) { this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; }
    receive(m) { this.onmessage({ data: JSON.stringify(m) }); }
  }
  globalThis.WebSocket = Socket;
  return Socket;
}
test('hello advertises numeric support and a resumed socket accepts its single authoritative welcome', async () => {
  const Socket = socket(), net = new NetClient();
  const connecting = net.connect('ws://fixture/ws', 'local');
  Socket.last.onopen();
  assert.equal(Socket.last.sent[0].gameplay_rules_version, 1);
  Socket.last.receive(packet('welcome_a', receipt.a, 'welcome'));
  await connecting;
  net.close();
  const opening = net._open('ws://fixture/ws', { t: 'hello', name: 'local', resume: 'seat', gameplay_rules_version: 1 }).catch(e => e);
  Socket.last.onopen();
  Socket.last.receive(packet('resume', receipt.a, 'welcome'));
  const result = await Promise.race([opening, new Promise(r => setTimeout(() => r(null), 100))]);
  net.close();
  assert.equal(result?.id, receipt.a, 'no placeholder welcome or skipped-first workaround');
});
test('old or invalid server support disables new room creation/start and reports update needed', () => {
  for (const version of [undefined, null, '1', 2, 0]) {
    const net = new NetClient(), sent = [], errors = [];
    net.ws = { readyState: 1, send: x => sent.push(x) };
    net.on('error', m => errors.push(m.msg));
    net._receive({ t: 'welcome', id: 1, gameplay_rules_version: version });
    net.send({ t: 'create', gameplay_mode: 'casual', gameplay_rules_version: 1 });
    net.send({ t: 'start' });
    assert.equal(sent.length, 0, `unsupported server ${version}`);
    assert.ok(errors.some(e => /更新/.test(e)));
  }
});
test('room/start/deploy messages require exact room rules and cannot silently replace an immutable room', () => {
  const net = new NetClient(), rooms = [], starts = [], deploys = [], errors = [];
  net._receive(packet('welcome_a', receipt.a, 'welcome'));
  net.on('room', m => rooms.push(m)); net.on('start', m => starts.push(m)); net.on('respawned', m => deploys.push(m)); net.on('error', m => errors.push(m));
  const valid = packet('room', receipt.a, 'room');
  for (const [mode,version] of [[undefined,1],['casual',undefined],['bogus',1],['historical','1'],['historical',2]]) {
    net._receive({ ...valid, room: { ...valid.room, gameplay_mode: mode, gameplay_rules_version: version } });
    assert.equal(net.room,null);
  }
  net._receive(valid);
  assert.equal(rooms.length,1);
  net._receive({ ...valid, room: { ...valid.room, gameplay_mode: 'casual' } });
  assert.equal(rooms.length,1, 'same room cannot change its profile');
  net._receive({ ...packet('start', receipt.a, 'start'), gameplay_mode: 'casual' });
  net._receive({ ...packet('deploy_a', receipt.a, 'respawned'), gameplay_rules_version: 2 });
  assert.equal(starts.length,0); assert.equal(deploys.length,0);
  net._receive(packet('start', receipt.a, 'start'));
  net._receive(packet('deploy_a', receipt.a, 'respawned'));
  assert.equal(starts.length,1); assert.equal(deploys.length,1); assert.ok(errors.length>=7);
});
function node() { return { children: [], dataset: {}, style: {}, textContent: '', append(...c) { this.children.push(...c); } }; }
function runtime(local, options = {}) {
  const store = storage(), gameplay = new GameplaySession(store);
  gameplay.chooseLocal(local);
  const G = { id: 'su_t34_85', mode: 'garage', gameplayMode: gameplay.activeMode(), s: phys.newState(), pending: [], cam: {}, thumbs: [], mapId: 'range', maps: new Map(), enemies: [], keys: new Set() };
  const elements = new Map();
  globalThis.document = { body: { dataset: {} }, getElementById(id) { if (!elements.has(id)) elements.set(id,node()); return elements.get(id); }, createElement: node, createTextNode: text => ({ textContent: text }) };
  const hudState = { el: Object.fromEntries(['kind','name','vehName','based','outline','spec'].map(k => [k,node()])) };
  const hud = new Proxy({ showSpec(...args) { hudState.el.spec.children=[]; Hud.prototype.showSpec.call(hudState,...args); } }, { get(o,k) { return o[k] || (() => {}); } });
  const net = new NetClient(), scene = { children: [], add(n) { this.children.push(n); } };
  const renderer = { mesh: vertices => ({ vertices }), instancedMesh: vertices => ({ vertices }), setInstances() {}, freeMesh() {} };
  const deps = { G, gameplay, GAMEPLAY_RULES_VERSION, ...netApi, ...loadout, ...performanceApi, phys, data, document, store, STORE_VEHICLE: 'vehicle', LANG_INDEX: 0,
    isDesign: () => false, bundleFor: id => ({ bundle: data.vehicles[id], projectiles: data.projectiles }), AMMO_CFG: {}, applyAmmo,
    onlineFires: new OnlineFires(), loading, mgSim, renderer, buildTank, VehicleSim, terrain: ground(() => 0), scene, hud,
    Exhaust: class {}, fx: {}, exhaustOf() {}, applyXray() {}, rebuildInterior() {}, combatInit() {}, statusShape() {}, selectAmmo() {}, sightGun: () => G.loadout.turrets[0].guns[0],
    mods: { choose() {}, cardOf: id => id, slots: () => [] }, measureInsets() {}, missileVehicle() {}, missileBattleStart() {},
    net, lobby: { render() {}, sendVehicle() {}, show() {} }, MAP_IDS: ['range','coast'], RESPAWN_DELAY: 5,
    useWorld() {}, spawnEnemies() {}, spawnRemotes() {}, resetPose() {}, updateNetHud() {}, testRange: { exit() {} }, setProtect() {}, setWorkshop() {}, setXray() {}, thumbStep() {}, setMapChoice(id) { G.mapId=id; }, loadMap: options.loadMap, mapName: () => 'range', feed() {},
    deploy: { close() {} }, openDeploy() {}, cqBar: {}, cqMsg: {}, clearEnemies() { G.enemies=[]; }, hitcam: { hide() {} }, canvas: {}, sound: {}, remoteOf: () => null, removeRemote() {}, addRemote() {}, benchedMember: () => true,
  };
  const a=source.indexOf("  net.on('start',"),b=source.indexOf("  net.on('snap',",a);
  const ra=source.indexOf("  net.on('respawned',"),rb=source.indexOf("  net.on('ended',",ra);
  const la=source.indexOf("  for (const t of ['closed', 'left_room'])"),lb=source.indexOf("  const chatIn =",la);
  const live = new Function(...Object.keys(deps), `${['select','reloadShown','setMode','gameplayLabel','updateGameplayDisplay','chooseGameplayMode','applyRoomGameplay','startBattle','toGarage'].map(fn).join('\n')}\n${source.slice(a,b)}\n${source.slice(ra,rb)}\n${source.slice(la,lb)}\nselect(G.id); return {select,chooseGameplayMode,toGarage,startBattle};`)(...Object.values(deps));
  return { G, net, gameplay, store, live, spec: () => hudState.el.spec.children.map(n => n.textContent).join(' ') };
}
test('actual native room→NetClient→main selection/session→HUD fixes two local preferences through reconnect and respawn then restores local on leave', () => {
  for (const [id,local,welcome] of [[receipt.a,'casual','welcome_a'],[receipt.b,'historical','welcome_b']]) {
    const r=runtime(local), saved=r.store.values.get('tankforge.gameplay.v1');
    r.net._receive(packet(welcome,id,'welcome'));
    r.net._receive(packet('room',id,'room'));
    assert.equal(r.G.gameplayMode,'historical','room preview precedes selection');
    assert.match(r.spec(),/歷史：原始性能/);
    assert.equal(r.store.values.get('tankforge.gameplay.v1'),saved,'room does not overwrite local preference');
    r.net._receive(packet('start',id,'start'));
    assert.equal(r.G.mode,'battle'); assert.equal(r.gameplay.activeMode(),'historical');
    assert.equal(r.G.params.vTop,r.G.stockParams.vTop);
    assert.equal(r.live.chooseGameplayMode('casual'),false);
    r.net._receive(packet(id===receipt.a?'deploy_a':'deploy_b',id,'respawned'));
    assert.equal(r.G.params.vTop,r.G.stockParams.vTop);
    if (id===receipt.a) {
      for (const [to,m] of receipt.phases.respawn) if(to===id) r.net._receive(m);
      const gun=r.G.loadout.turrets[0].guns[0]; gun.ammo[0].count--;
      const spent=gun.ammo[0].count;
      for (const [to,m] of receipt.phases.resume) if(to===id) r.net._receive(m);
      assert.equal(r.G.loadout.turrets[0].guns[0],gun,'valid same-profile resume does not rebuild the mount');
      assert.equal(gun.ammo[0].count,spent,'valid same-profile resume never replenishes spent ammunition');
    }
    assert.equal(r.gameplay.activeMode(),'historical'); assert.equal(r.G.params.vTop,r.G.stockParams.vTop);
    r.net._receive({t:'left_room'});
    assert.equal(r.G.gameplayMode,local);
    assert.equal(r.G.params.vTop,r.G.stockParams.vTop*(local==='casual'?1.15:1));
  }
});
test('lobby selector creates strict rule fields and badges match supported rooms while unsupported server disables controls', () => {
  const net=new NetClient(); net._receive(packet('welcome_a',receipt.a,'welcome')); net.status='open';
  net.rooms=[packet('room',receipt.a,'room').room];
  const inputs={ '#lb-room-name':{value:'歷史房'},'#lb-map':{value:'range'},'#lb-max':{value:'8'},'#lb-era':{value:'any'},'#lb-gameplay':{value:'historical'} };
  const el={hidden:false,addEventListener() {},querySelector: id => inputs[id] || null,querySelectorAll:()=>[],contains:()=>false,innerHTML:''};
  const ui=new LobbyUi(el,net,{mapName:x=>x,vehicleName:x=>x,currentVehicle:()=>'',usable:()=>true});
  assert.match(el.innerHTML,/lb-gameplay/); assert.match(el.innerHTML,/歷史/);
  const sent=[]; net.ws={readyState:1,send:m=>sent.push(JSON.parse(m))};
  ui.click({target:{closest:()=>({dataset:{act:'create'},blur(){}})}});
  assert.equal(sent[0].gameplay_mode,'historical'); assert.equal(sent[0].gameplay_rules_version,1);
  net._receive({t:'welcome',id:receipt.a}); ui.render();
  assert.match(el.innerHTML,/data-act="create"[^>]*disabled/); assert.match(el.innerHTML,/更新/);
  net.room=packet('room',receipt.a,'room').room; ui.render();
  assert.match(el.innerHTML,/data-act="start"[^>]*disabled/);
});
test('leaving a battle immediately restores local performance', () => {
  const r=runtime('casual');
  for(const phase of ['welcome_a','room','start']) for(const [to,m] of receipt.phases[phase]) if(to===receipt.a) r.net._receive(m);
  r.live.toGarage();
  assert.equal(r.G.gameplayMode,'casual');
  assert.equal(r.gameplay.activeMode(),'casual');
  assert.equal(r.G.params.vTop,r.G.stockParams.vTop*1.15);
});
test('active casual reconnect fails closed for unsupported Welcome or malformed/changed Room/Start before battle early returns', () => {
  const welcome=packet('welcome_c',receipt.c,'welcome'), room=packet('room_c',receipt.c,'room'), start=packet('start_c',receipt.c,'start');
  for (const bad of [
    {...welcome,gameplay_rules_version:undefined}, {...welcome,gameplay_rules_version:'1'}, {...welcome,gameplay_rules_version:2},
    {...room,room:{...room.room,gameplay_mode:'historical'}}, {...room,room:{...room.room,gameplay_rules_version:undefined}},
    {...start,gameplay_mode:'bogus'}, {...start,gameplay_rules_version:'1'}, {...start,gameplay_mode:'historical'},
  ]) {
    const r=runtime('historical'), saved=r.store.values.get('tankforge.gameplay.v1');
    for(const phase of ['welcome_c','room_c','start_c']) for(const [to,m] of receipt.phases[phase]) if(to===receipt.c) r.net._receive(m);
    assert.equal(r.G.mode,'battle'); assert.equal(r.G.gameplayMode,'casual');
    r.net._receive(bad);
    assert.equal(r.G.mode,'garage','unsynchronized battle must terminate');
    assert.equal(r.G.online,null);
    assert.equal(r.G.gameplayMode,'historical');
    assert.equal(r.store.values.get('tankforge.gameplay.v1'),saved);
    assert.equal(r.net.room,null);
  }
});
test('room preview validates and fixes the next battle without touching saved preference', () => {
  const st=storage(), s=new GameplaySession(st); s.chooseLocal('casual');
  const saved=st.values.get('tankforge.gameplay.v1');
  s.setRoomProfile({mode:'historical',version:1});
  assert.equal(s.activeMode(),'historical');
  assert.equal(s.chooseLocal('casual'),false);
  assert.throws(()=>s.beginBattle({mode:'casual',version:1}),/room|profile/i);
  assert.equal(s.battle,null);
  assert.equal(st.values.get('tankforge.gameplay.v1'),saved);
  s.beginBattle(); assert.equal(s.activeMode(),'historical');
  assert.throws(()=>s.setRoomProfile({mode:'casual',version:1}),/locked/i);
  s.endBattle(); assert.equal(s.activeMode(),'historical');
  s.setRoomProfile(null); assert.equal(s.activeMode(),'casual');
});
test('joining an online room from a local battle ends that sortie before applying the room profile', () => {
  const r=runtime('casual');
  r.live.startBattle(); assert.equal(r.G.mode,'battle');
  r.net._receive(packet('welcome_a',receipt.a,'welcome'));
  const errors=[]; const original=console.error; console.error=(...args)=>errors.push(args);
  try { r.net._receive(packet('room',receipt.a,'room')); } finally { console.error=original; }
  assert.equal(errors.length,0,'actual handler cannot keep a conflicting local battle lock');
  assert.equal(r.G.mode,'garage'); assert.equal(r.G.gameplayMode,'historical');
  r.net._receive(packet('start',receipt.a,'start'));
  assert.equal(r.G.mode,'battle'); assert.equal(r.G.gameplayMode,'historical');
});

async function reconnectReply(r, replies, event) {
  const Original=globalThis.WebSocket;
  globalThis.WebSocket=class extends Original {
    constructor() { super(); queueMicrotask(()=>{ this.onopen(); for(const reply of replies) this.receive(reply); }); }
  };
  let timer;
  const finished=new Promise((resolve,reject)=>{
    timer=setTimeout(()=>reject(new Error(`No ${event} from actual reconnect`)),3000);
    r.net.on(event,resolve);
  });
  try {
    const dropped=r.net.ws; dropped.readyState=3; dropped.onclose();
    await finished;
    return r.net.ws;
  } finally { clearTimeout(timer); globalThis.WebSocket=Original; }
}
async function openSortie(r, id, welcome, phases) {
  const Socket=socket(), opening=r.net.connect('ws://fixture/ws','local');
  const ws=Socket.last; ws.onopen(); ws.receive(packet(welcome,id,'welcome')); await opening;
  for(const phase of phases) for(const [to,m] of receipt.phases[phase]) if(to===id) ws.receive(m);
  return ws;
}
test('expired-token reconnect accepts a new seat, restores local garage and can join another legal mode', async () => {
  const r=runtime('historical'), saved=r.store.values.get('tankforge.gameplay.v1');
  try {
    await openSortie(r,receipt.c,'welcome_c',['room_c','start_c']);
    assert.equal(r.G.gameplayMode,'casual'); assert.equal(r.G.mode,'battle');
    const freshId=receipt.c+1000;
    const welcome={...packet('welcome_a',receipt.a,'welcome'),id:freshId,token:'fresh-seat-token'};
    const ws=await reconnectReply(r,[welcome],'closed');
    assert.equal(r.G.mode,'garage'); assert.equal(r.G.gameplayMode,'historical');
    assert.equal(r.store.values.get('tankforge.gameplay.v1'),saved);
    assert.equal(r.net.open,true,'accepted replacement connection stays open');
    assert.equal(r.net.id,freshId); assert.equal(r.net.token,welcome.token);
    const member={...packet('room',receipt.a,'room').room.members[0],id:freshId,alive:false};
    const room={...packet('room',receipt.a,'room'),room:{...packet('room',receipt.a,'room').room,id:900,host:freshId,members:[member]}};
    ws.receive(room);
    ws.receive({...packet('start',receipt.a,'start'),members:[member]});
    assert.equal(r.G.mode,'battle','stale casual profile cannot reject the new historical sortie');
    assert.equal(r.G.gameplayMode,'historical'); assert.equal(r.net.open,true);
    assert.deepEqual(r.net.battleProfile,{mode:'historical',version:1});
  } finally { r.net.close(); }
});
test('actual valid socket reconnect preserves the current mount and spent ammunition', async () => {
  const r=runtime('casual');
  try {
    await openSortie(r,receipt.a,'welcome_a',['room','start','deploy_a']);
    const gun=r.G.loadout.turrets[0].guns[0]; gun.ammo[0].count--;
    const spent=gun.ammo[0].count;
    await reconnectReply(r,receipt.phases.resume.filter(([to])=>to===receipt.a).map(([,m])=>m),'resumed');
    assert.equal(r.G.mode,'battle'); assert.equal(r.G.gameplayMode,'historical');
    assert.equal(r.G.loadout.turrets[0].guns[0],gun); assert.equal(gun.ammo[0].count,spent);
    assert.equal(r.net.open,true); assert.equal(r.net.id,receipt.a);
  } finally { r.net.close(); }
});
function pendingSortie() {
  let resolve;
  const loaded=new Promise(r=>{resolve=r;});
  const r=runtime('casual',{loadMap:()=>loaded});
  r.net._receive(packet('welcome_a',receipt.a,'welcome'));
  r.net._receive(packet('room',receipt.a,'room'));
  const start={...packet('start',receipt.a,'start'),map:'coast'};
  r.net._receive(start);
  return {r,start,async finish() { r.G.maps.set('coast',{}); resolve(); await loaded; await Promise.resolve(); }};
}
test('cancelled pending online map starts restore local effective garage stats and cannot restart an old sortie', async () => {
  for(const cancel of ['leave','unsupported_welcome','invalid_room','new_room']) {
    const {r,finish}=pendingSortie();
    assert.equal(r.G.mode,'garage'); assert.ok(r.G.online); assert.equal(r.G.gameplayMode,'historical');
    if(cancel==='unsupported_welcome') r.net._receive({t:'welcome',id:receipt.a});
    else if(cancel==='invalid_room') r.net._receive({t:'room',room:{...r.net.room,gameplay_rules_version:2}});
    else {
      r.net._receive({t:'left_room'});
      if(cancel==='new_room') r.net._receive({t:'room',room:{...packet('room_c',receipt.c,'room').room,id:901,host:receipt.a,members:[{...packet('room',receipt.a,'room').room.members[0]}]}});
    }
    assert.equal(r.G.online,null);
    assert.equal(r.G.gameplayMode,'casual',`${cancel}: local/next-room profile must repaint even when already garage`);
    assert.equal(r.G.params.vTop,r.G.stockParams.vTop*1.15);
    assert.match(r.spec(),/休閒/);
    await finish();
    assert.equal(r.G.mode,'garage',`${cancel}: old map completion cannot start a battle`);
    assert.equal(r.gameplay.battle,null); assert.equal(r.G.gameplayMode,'casual');
  }
});
test('valid duplicated pending online starts lock one battle only after its map becomes ready', async () => {
  for(const duplicate of [false,true]) {
    const {r,start,finish}=pendingSortie();
    let begins=0; const begin=r.gameplay.beginBattle.bind(r.gameplay);
    r.gameplay.beginBattle=(...args)=>{begins++;return begin(...args);};
    const sortie=r.G.online, sameRoom=packet('start',receipt.a,'room');
    r.net._receive({...sameRoom,room:{...sameRoom.room,map:'coast'}});
    assert.equal(r.G.online,sortie,'same-room update retains the valid pending sortie');
    if(duplicate) r.net._receive(start);
    assert.equal(r.G.mode,'garage'); assert.equal(begins,0);
    await finish();
    assert.equal(r.G.mode,'battle'); assert.equal(r.G.gameplayMode,'historical');
    assert.equal(begins,1); assert.equal(r.gameplay.local,'casual');
  }
});
test('a different valid room with the same profile retires the pending sortie before old map completion', async () => {
  const {r,finish}=pendingSortie();
  const room={...packet('room',receipt.a,'room'),room:{...packet('room',receipt.a,'room').room,id:902}};
  r.net._receive(room);
  assert.equal(r.net.room.id,902); assert.equal(r.G.online,null,'old room cannot retain a pending battle owner');
  assert.equal(r.G.mode,'garage'); assert.equal(r.G.gameplayMode,'historical');
  assert.match(r.spec(),/歷史：原始性能/);
  await finish();
  assert.equal(r.G.mode,'garage'); assert.equal(r.gameplay.battle,null);
  r.net._receive(packet('start',receipt.a,'start'));
  assert.equal(r.G.mode,'battle'); assert.equal(r.G.gameplayMode,'historical');
});

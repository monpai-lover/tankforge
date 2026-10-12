// Local native→browser integration. Generate the receipt explicitly:
// TG_GAMEPLAY_NETWORK_RECEIPT=<repo>/target/weapon-control-gameplay-network.json cargo test -p tg-server browser_protocol_receipt_from_actual_handlers --lib
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
import * as inventory from '../src/game/ammoInventory.js';
import * as resupply from '../src/game/ammoResupply.js';
import * as selection from '../src/game/weaponselection.js';
import { runtime } from './live-network-rig.mjs';

const root = new URL('../../../', import.meta.url);
const receiptPath = process.env.TG_GAMEPLAY_NETWORK_RECEIPT || new URL('target/weapon-control-gameplay-network.json', root);
assert.ok(fs.existsSync(receiptPath), 'Generate the actual native handler receipt before this suite');
const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
assert.deepEqual(Object.keys(receipt.sources).sort(), ['crates/server/src/lobby.rs','crates/server/src/gameplay.rs','crates/server/src/server.rs','crates/server/src/missiles.rs','crates/server/src/gameplay_tests.rs','crates/gameplay/src/lib.rs','Cargo.toml','crates/server/Cargo.toml','crates/gameplay/Cargo.toml','config/gameplay-modes.json','crates/server/src/ammo.rs','crates/server/src/ammo_tests.rs','config/ammo-resupply.json','crates/combat/src/lib.rs','crates/combat/src/weapon_damage.rs','crates/missile/src/world.rs','crates/missile/src/def.rs','crates/design-wasm/src/lib.rs','crates/missile/src/tests.rs','config/stabilizer-drives.json'].sort(), 'Every source/config tag is mandatory');
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
for (const resume of [false, true]) for (const version of [1, undefined, null, '2', 2.5, GAMEPLAY_RULES_VERSION + 1, true, [2], {version:2}]) test(`an incompatible Welcome (${JSON.stringify(version)}) rejects the actual open promise before ${resume ? 'held-seat replacement' : 'fresh admission'}`, async () => {
  const Socket = socket(), net = new NetClient(), welcomes = [], errors = [];
  net.id = 73; net.token = 'held-seat-token';
  if (resume) {
    net.gameplaySupported = true; net.ammoSupported = true;
    net.room = { id: 9, playing: true };
    net.battleProfile = { mode: 'historical', version: GAMEPLAY_RULES_VERSION };
  }
  net.on('welcome', msg => welcomes.push(msg));
  net.on('error', msg => errors.push(msg.msg));
  const opening = net._open('ws://fixture/ws', { t: 'hello', name: 'local', gameplay_rules_version: GAMEPLAY_RULES_VERSION, ammo_protocol_version: netApi.AMMO_PROTOCOL_VERSION, ...(resume ? { resume: net.token } : {}) });
  const ws = Socket.last;
  ws.onopen();
  ws.receive({ t: 'welcome', id: 99, name: 'legacy', token: 'legacy-replacement', gameplay_rules_version: version, ammo_protocol_version: netApi.AMMO_PROTOCOL_VERSION });
  const result = await opening.then(welcome => ({ welcome }), error => ({ error }));
  try {
    assert.ok(result.error instanceof Error, 'incompatible version must reject, never resolve an accepted Welcome');
    assert.equal(result.error.message, netApi.GAMEPLAY_UPDATE_NEEDED);
    assert.equal(ws.readyState, 3, 'incompatible open closes its socket');
    assert.equal(welcomes.length, 0, 'no accepted Welcome reaches main');
    assert.ok(errors.includes(netApi.GAMEPLAY_UPDATE_NEEDED));
    assert.equal(net.id, 73); assert.equal(net.token, 'held-seat-token');
    assert.equal(net.gameplaySupported, false);
    assert.equal(net.battleProfile, null);
  } finally { net.close(); }
});
test('hello advertises numeric support and a resumed socket accepts its single authoritative welcome', async () => {
  const Socket = socket(), net = new NetClient();
  const connecting = net.connect('ws://fixture/ws', 'local');
  Socket.last.onopen();
  assert.equal(Socket.last.sent[0].gameplay_rules_version, GAMEPLAY_RULES_VERSION);
  Socket.last.receive(packet('welcome_a', receipt.a, 'welcome'));
  await connecting;
  net.close();
  const opening = net._open('ws://fixture/ws', { t: 'hello', name: 'local', resume: 'seat', gameplay_rules_version: GAMEPLAY_RULES_VERSION }).catch(e => e);
  Socket.last.onopen();
  Socket.last.receive(packet('resume', receipt.a, 'welcome'));
  const result = await Promise.race([opening, new Promise(r => setTimeout(() => r(null), 100))]);
  net.close();
  assert.equal(result?.id, receipt.a, 'no placeholder welcome or skipped-first workaround');
});
test('old or invalid server support disables new room creation/start and reports update needed', () => {
  for (const version of [undefined, null, '2', 1, GAMEPLAY_RULES_VERSION + 1, 0, 2.5]) {
    const net = new NetClient(), sent = [], errors = [];
    net.ws = { readyState: 1, send: x => sent.push(x) };
    net.on('error', m => errors.push(m.msg));
    net._receive({ t: 'welcome', id: 1, gameplay_rules_version: version, ammo_protocol_version: netApi.AMMO_PROTOCOL_VERSION });
    net.send({ t: 'create', gameplay_mode: 'casual', gameplay_rules_version: GAMEPLAY_RULES_VERSION });
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
  for (const [mode,version] of [[undefined,GAMEPLAY_RULES_VERSION],['casual',undefined],['bogus',GAMEPLAY_RULES_VERSION],['historical','2'],['historical',1],['historical',GAMEPLAY_RULES_VERSION + 1]]) {
    net._receive({ ...valid, room: { ...valid.room, gameplay_mode: mode, gameplay_rules_version: version } });
    assert.equal(net.room,null);
  }
  net._receive(valid);
  assert.equal(rooms.length,1);
  net._receive({ ...valid, room: { ...valid.room, gameplay_mode: 'casual' } });
  assert.equal(rooms.length,1, 'same room cannot change its profile');
  net._receive({ ...packet('start', receipt.a, 'start'), gameplay_mode: 'casual' });
  net._receive({ ...packet('deploy_a', receipt.a, 'respawned'), gameplay_rules_version: GAMEPLAY_RULES_VERSION + 1 });
  assert.equal(starts.length,0); assert.equal(deploys.length,0);
  net._receive(packet('start', receipt.a, 'start'));
  net._receive(packet('deploy_a', receipt.a, 'respawned'));
  assert.equal(starts.length,1); assert.equal(deploys.length,1); assert.ok(errors.length>=7);
});
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
      const gun=r.G.loadout.turrets[0].guns[0]; r.onlineAmmo.predictCannon(41,gun.damageKey,gun.ammo[0].shell.id);r.G.online.seq=41;
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
test('fresh selection resets SOLO control and its persistent label for all real Hetzer source and workshop heads', () => {
  const cases = ['de_hetzer', 'de_hetzer_sdkfz1401', 'de_hetzer_flak', 'de_hetzer_mk103', 'de_hetzer_mk103_camo']
    .map(id => ({ id, bundle: data.vehicles[id], projectiles: data.projectiles }));
  for (const keepStock of [false, true]) {
    const compiled = loadout.buildToBundle({ base: 'de_hetzer', keepStock,
      turrets: [{ ...loadout.newTurretSpec(), guns: [{ weapon: 'xp_kda35' }] }] }, data);
    cases.push({ id: 'custom', bundle: compiled.bundle, projectiles: { ...data.projectiles, ...compiled.projectiles } });
  }
  for (const entry of cases) {
    const r = runtime('historical', { bundleFor: id => id === entry.id ? entry : { bundle: data.vehicles[id], projectiles: data.projectiles } });
    r.live.select(entry.id);
    const plan = structuredClone(r.G.ammoPlan), source = structuredClone(r.G.sourceBundle);
    const fitted = G => ({
      turrets: G.loadout.turrets.map(t => ({ sourceVehicle: t.sourceVehicle, pivot: t.pivot, parent: t.parent,
        guns: t.guns.map(g => ({ def: g.def, trunnion: g.trunnion, damageKey: g.damageKey })) })),
      mgs: G.loadout.machineGuns.map(m => ({ id: m.id, def: m.def, anchor: m.anchor, pos: m.pos, damageKey: m.damageKey })),
    });
    const bindings = fitted(r.G);
    r.live.cycleSightGun();
    assert.equal(selection.weaponControlKey(r.G.weaponControl), 'gun:0:0');
    r.live.trigger();
    assert.ok(r.G.pending.length > 0, 'real trigger leaves a queued intent to be cleared by a fresh selection');
    r.live.select(entry.id, true);
    assert.deepEqual(r.G.weaponControl, { kind: 'all' });
    assert.deepEqual([r.G.sightT, r.G.sightG, r.G.sightM], [0, 0, -1]);
    assert.deepEqual(r.G.pending, []);
    assert.deepEqual(r.G.ammoPlan, plan);
    assert.deepEqual(r.G.ammoPlan, inventory.captureAmmoPlan(r.G.loadout));
    assert.deepEqual(r.G.sourceBundle, source);
    assert.deepEqual(fitted(r.G), bindings);
    assert.equal(r.hud.el.control.textContent, '全炮開火');
    assert.equal(r.hud.el.control.dataset.control, 'all');
    assert.ok(r.scene.children.includes(r.G.model.root));
  }
});

test('actual native Start and Respawned reset SOLO while a same-life resume retains actual control, stock and readiness', () => {
  const r = runtime('casual');
  for (const phase of ['welcome_a', 'room']) for (const [to, m] of receipt.phases[phase]) if (to === receipt.a) r.net._receive(m);
  r.live.cycleSightGun();
  r.net._receive(packet('start', receipt.a, 'start'));
  assert.deepEqual(r.G.weaponControl, { kind: 'all' });
  r.live.cycleSightGun();
  r.net._receive(packet('deploy_a', receipt.a, 'respawned'));
  assert.deepEqual(r.G.weaponControl, { kind: 'all' });
  assert.deepEqual(r.G.pending, []);
  assert.deepEqual(r.G.ammoPlan, inventory.captureAmmoPlan(r.G.loadout));
  // The original receipt's retained life is its actual respawn incarnation.
  for (const [to, m] of receipt.phases.respawn) if (to === receipt.a) r.net._receive(m);
  r.live.cycleSightGun();
  r.net.status = 'open'; r.net.ws = { readyState: 1, send() {} };
  assert.equal(r.live.fireGun(0, 0), true);
  const control = r.G.weaponControl, gun = r.G.loadout.turrets[0].guns[0], L = r.G.T[0].loading;
  const stock = gun.ammo.map(a => a.count), readiness = structuredClone(L), pendingFire = r.onlineFires.pending[0];
  assert.ok(pendingFire);
  for (const [to, m] of receipt.phases.resume) if (to === receipt.a) r.net._receive(m);
  assert.equal(r.G.weaponControl, control);
  assert.equal(r.G.loadout.turrets[0].guns[0], gun);
  assert.equal(r.G.T[0].loading, L);
  assert.deepEqual(L, readiness, 'same life never grants readiness');
  assert.deepEqual(gun.ammo.map(a => a.count), stock, 'same life never grants stock');
  assert.equal(r.onlineFires.pending[0], pendingFire, 'same life retains the already sent firing request');
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
  assert.equal(sent[0].gameplay_mode,'historical'); assert.equal(sent[0].gameplay_rules_version,GAMEPLAY_RULES_VERSION);
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
    {...welcome,gameplay_rules_version:undefined}, {...welcome,gameplay_rules_version:'1'}, {...welcome,gameplay_rules_version:GAMEPLAY_RULES_VERSION + 1},
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
  s.setRoomProfile({mode:'historical',version:GAMEPLAY_RULES_VERSION});
  assert.equal(s.activeMode(),'historical');
  assert.equal(s.chooseLocal('casual'),false);
  assert.throws(()=>s.beginBattle({mode:'casual',version:GAMEPLAY_RULES_VERSION}),/room|profile/i);
  assert.equal(s.battle,null);
  assert.equal(st.values.get('tankforge.gameplay.v1'),saved);
  s.beginBattle(); assert.equal(s.activeMode(),'historical');
  assert.throws(()=>s.setRoomProfile({mode:'casual',version:GAMEPLAY_RULES_VERSION}),/locked/i);
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
    assert.deepEqual(r.net.battleProfile,{mode:'historical',version:GAMEPLAY_RULES_VERSION});
  } finally { r.net.close(); }
});
test('actual valid socket reconnect preserves the current mount and spent ammunition', async () => {
  const r=runtime('casual');
  try {
    await openSortie(r,receipt.a,'welcome_a',['room','start','deploy_a','respawn']);
    const gun=r.G.loadout.turrets[0].guns[0]; r.onlineAmmo.predictCannon(41,gun.damageKey,gun.ammo[0].shell.id);r.G.online.seq=41;
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
    else if(cancel==='invalid_room') r.net._receive({t:'room',room:{...r.net.room,gameplay_rules_version:GAMEPLAY_RULES_VERSION + 1}});
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

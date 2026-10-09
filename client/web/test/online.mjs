// Two players online, end to end: starts the real server (crates/server) on a free port, opens
// the game it serves in two headless browsers, and goes through the lobby (connect, create a
// room, join it, host starts), the deploy screen (each chooses a vehicle, its rounds and a spawn
// point, then 加入戰鬥), then the battle: each sees the other's vehicle where it drives, a shot
// from one is seen by the other, the hit is scored by the server and the target is knocked out,
// chooses another vehicle on the deploy screen after the wait, and the host ends the battle.
//   node test/online.mjs [output_dir] [map]          (build first: npm run build; cargo build -p tg-server)
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/npm-tools/node_modules/playwright');
}
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../../..');
const out = process.argv[2] || path.join(here, '../dist/shots');
const mapId = process.argv[3] || 'range';
fs.mkdirSync(out, { recursive: true });

const results = {};
const errors = [];
const check = (name, cond, detail) => {
  results[name] = cond ? 'ok' : 'FAIL ' + (detail ?? '');
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + (detail ?? '')));
};

// ---- the server
const port = await new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const bin = [path.join(root, 'target/release/tg-server'), path.join(root, 'target/debug/tg-server')].find((p) => fs.existsSync(p));
if (!bin) {
  console.log('tg-server not built: cargo build -p tg-server');
  process.exit(1);
}
const server = spawn(bin, ['--port', String(port), '--bind', '127.0.0.1', '--data', path.join(root, 'data'), '--page', path.join(here, '../dist/tankforge-range.html')], { stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
for (let i = 0; i < 100 && !serverLog.includes('/ws'); i++) await new Promise((r) => setTimeout(r, 50));
check('server starts and lists the data it loaded', /炮彈/.test(serverLog) && /coast/.test(serverLog), serverLog);
const rooms0 = await fetch(`http://127.0.0.1:${port}/rooms`).then((r) => r.json());
check('the room list is served as JSON', rooms0.t === 'rooms' && rooms0.rooms.length === 0, JSON.stringify(rooms0));

// ---- two browsers on the page the server serves
const browser = await playwright.chromium.launch({
  executablePath: fs.existsSync('/opt/pw-browsers/chromium') && fs.statSync('/opt/pw-browsers/chromium').isFile() ? '/opt/pw-browsers/chromium' : undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});
async function open(tag) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 640 } });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.googleapis|Failed to load resource/.test(m.text())) errors.push(tag + ': ' + m.text());
  });
  page.on('pageerror', (e) => errors.push(tag + ' pageerror: ' + e.message));
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await page.goto(`http://127.0.0.1:${port}/?lang=zh`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__tf, null, { timeout: 30000 });
  await page.evaluate(() => {
    const t = window.__tf;
    t.pause();
    t.setQuality('low');
    t.finishThumbs();
    t.advance(0.1);
  });
  return page;
}
const A = await open('A');
const B = await open('B');
const wait = (p, fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 50 });
// the frame loop is paused in the tests: step both games by hand
const run = (p, seconds, keys = []) => p.evaluate(([s, k]) => window.__tf.advance(s, k, false), [seconds, keys]);

// ---- lobby: the panel's own buttons
const server0 = await A.evaluate(() => window.__tf.lobby.server);
check('the lobby points at the server that served the page', server0 === `ws://127.0.0.1:${port}/ws`, server0);
for (const [p, name, veh] of [
  [A, '甲車長', 'su_t34_85'],
  [B, '乙車長', 'de_pz4_h'],
]) {
  await p.evaluate(([v]) => window.__tf.select(v), [veh]);
  await p.click('#net-btn');
  await p.fill('#lb-name', name);
  await p.click('#lobby [data-act="connect"]');
  await wait(p, () => window.__tf.net.open);
}
check('both players are connected under their names', (await A.evaluate(() => window.__tf.net.name)) === '甲車長' && (await B.evaluate(() => window.__tf.net.name)) === '乙車長');
await A.fill('#lb-room-name', '河口決戰');
await A.selectOption('#lb-map', mapId);
await A.selectOption('#lb-max', '4');
await A.click('#lobby [data-act="create"]');
await wait(A, () => window.__tf.net.inRoom);
await wait(B, () => document.querySelector('#lobby [data-act="join"]'));
const listed = await B.evaluate(() => document.querySelector('#lobby .lb-rooms').textContent);
check('the other player sees the new room in the list', listed.includes('河口決戰') && listed.includes('1/4'), listed);
await B.click('#lobby [data-act="join"]');
await wait(B, () => window.__tf.net.inRoom);
await wait(A, () => window.__tf.net.room.members.length === 2 && window.__tf.net.room.members.every((m) => m.vehicle));
const room = await A.evaluate(() => window.__tf.net.room);
check('both are in the room, on opposite sides, with their garage vehicles', room.members.length === 2 && room.members[0].team !== room.members[1].team && room.members.some((m) => m.vehicle === 'su_t34_85') && room.members.some((m) => m.vehicle === 'de_pz4_h'), JSON.stringify(room.members));
// a vehicle change in the garage reaches the room
await B.evaluate(() => window.__tf.select('us_m4a3_75w'));
await wait(A, () => window.__tf.net.room.members.some((m) => m.vehicle === 'us_m4a3_75w'));
check('changing card in the garage changes the vehicle in the room', true);
// chat
await B.fill('#lb-chat-in', '準備好了');
await B.press('#lb-chat-in', 'Enter');
await wait(A, () => document.querySelector('#lb-chat-log')?.textContent.includes('準備好了'));
check('chat in the room reaches the other player', true);
await B.click('#lobby [data-act="ready"]');
await wait(A, () => window.__tf.net.room.members.some((m) => m.ready));
await A.screenshot({ path: path.join(out, 'online_lobby.png') });
// only the host has the start button
check('only the host can start', (await A.$('#lobby [data-act="start"]')) !== null && (await B.$('#lobby [data-act="start"]')) === null);
await A.click('#lobby [data-act="start"]');
await wait(A, () => window.__tf.state().mode === 'battle' && window.__tf.online(), null, 60000);
await wait(B, () => window.__tf.state().mode === 'battle' && window.__tf.online(), null, 60000);

// ---- the deploy screen: into the map first, then the vehicle, its rounds and the spawn point
await wait(A, () => !document.getElementById('deploy').hidden);
await wait(B, () => !document.getElementById('deploy').hidden);
const benched = await Promise.all([A, B].map((p) => p.evaluate(() => ({ o: window.__tf.online(), enemies: window.__tf.enemies().length, cards: document.querySelectorAll('#deploy .dp-card').length }))));
check('the battle opens on the deploy screen, nobody on the field yet', benched.every((b) => b.o.dead && b.enemies === 0 && b.cards >= 10), JSON.stringify(benched.map((b) => [b.o.dead, b.enemies, b.cards])));
// A takes the T-34-85 with fewer rounds of the first type; B the Pz IV H at its second spawn point
await A.click('#deploy .dp-card[data-id="su_t34_85"]');
const before = await A.evaluate(() => [...document.querySelectorAll('#dp-ammo .dp-round output')].map((o) => Number(o.textContent)));
for (let i = 0; i < 5; i++) await A.click('#dp-ammo .dp-round [data-act="dec"]');
const afterDec = await A.evaluate(() => [...document.querySelectorAll('#dp-ammo .dp-round output')].map((o) => Number(o.textContent)));
check('the deploy screen lists the rounds and − takes rounds off', before.length >= 2 && afterDec[0] === before[0] - 5, JSON.stringify([before, afterDec]));
await A.screenshot({ path: path.join(out, 'online_deploy.png') });
await B.click('#deploy .dp-card[data-id="de_pz4_h"]');
const spawnsB = await B.evaluate(() => document.querySelectorAll('#deploy .dp-spawn').length);
if (spawnsB > 1) await B.click('#deploy .dp-spawn[data-i="1"]');
await A.click('#dp-go');
await B.click('#dp-go');
await wait(A, () => !window.__tf.online().dead && document.getElementById('deploy').hidden, null, 10000);
await wait(B, () => !window.__tf.online().dead && document.getElementById('deploy').hidden, null, 10000);
const spawnB = await B.evaluate(() => ({ x: window.__tf.state().x, z: window.__tf.state().z }));
if (mapId !== 'range') {
  // the two sides start out of sight of each other on a battle map: while B is still in its
  // spawn grace (the server takes any move then), put B 160 m in front of A, facing it, with no
  // building between them
  const a = await A.evaluate(() => {
    const t = window.__tf;
    const s = t.state();
    const m = t.G.map;
    const y = (x, z) => t.terrain.height(x, z) + 1.8;
    for (const off of [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.1, -1.1])
      for (const d of [160, 130, 190, 110]) {
        const h = s.heading + off;
        const bx = s.x + Math.sin(h) * d;
        const bz = s.z + Math.cos(h) * d;
        if (!m.segmentHit([s.x, y(s.x, s.z), s.z], [bx, y(bx, bz), bz]) && !m.boxesNear(bx, bz, 8).length) return { x: bx, z: bz, h: h + Math.PI };
      }
    return { x: s.x + Math.sin(s.heading) * 160, z: s.z + Math.cos(s.heading) * 160, h: s.heading + Math.PI };
  });
  await B.evaluate(([x, z, hd]) => window.__tf.place(x, z, hd), [a.x, a.z, a.h]);
  await run(B, 0.2);
}
const rounds = await A.evaluate(() => window.__tf.G.loadout.turrets[0].guns[0].ammo.map((a) => a.count));
check('A deploys in the T-34-85 carrying the rounds chosen', (await A.evaluate(() => window.__tf.state().id)) === 'su_t34_85' && rounds[0] === afterDec[0], JSON.stringify(rounds));
check('B deploys in the Pz IV H', (await B.evaluate(() => window.__tf.state().id)) === 'de_pz4_h');
await run(A, 0.3);
await run(B, 0.3);
await new Promise((r) => setTimeout(r, 300));
await run(A, 0.1);
await run(B, 0.1);
const st = await Promise.all([A, B].map((p) => p.evaluate(() => ({ online: window.__tf.online(), map: window.__tf.mapState().active, enemies: window.__tf.enemies(), x: window.__tf.state().x, z: window.__tf.state().z, id: window.__tf.state().id }))));
check(`the battle starts on ${mapId} for both`, st.every((s) => s.map === mapId), JSON.stringify(st.map((s) => s.map)));
check('each has the other as a remote vehicle and no computer enemies', st.every((s) => s.enemies.length === 1 && s.enemies[0].remote), JSON.stringify(st.map((s) => s.enemies)));
check('each starts at its own side', mapId !== 'range' || Math.hypot(st[0].x - st[1].x, st[0].z - st[1].z) > 100, JSON.stringify(st.map((s) => [s.x, s.z])));
const idA = await A.evaluate(() => window.__tf.net.id);
const idB = await B.evaluate(() => window.__tf.net.id);

// ---- B drives forward; A sees it where B is
for (let i = 0; i < 12; i++) {
  await run(B, 0.25, ['fwd']);
  await run(A, 0.25);
}
await new Promise((r) => setTimeout(r, 300));
await run(A, 0.1);
const bPos = await B.evaluate(() => ({ x: window.__tf.state().x, z: window.__tf.state().z, heading: window.__tf.state().heading }));
const seen = await A.evaluate(() => window.__tf.enemies()[0]);
const off = Math.hypot(seen.x - bPos.x, seen.z - bPos.z);
check('A sees B where B has driven (within a couple of metres)', off < 2.5, `B at ${bPos.x.toFixed(1)},${bPos.z.toFixed(1)}; A sees ${seen.x.toFixed(1)},${seen.z.toFixed(1)}`);
const startB = st[1];
check('B really moved', Math.hypot(bPos.x - startB.x, bPos.z - startB.z) > 3, JSON.stringify([bPos, startB.x, startB.z]));

// ---- A shoots B: B sees the shot, the server scores the hit
// bring A's vehicle within easy range of B, aim at B's hull and fire (the server allows the move
// as the start of the battle has its grace period over, so place it before any state is sent: we
// move B instead towards A, a few metres a step)
const aPos = await A.evaluate(() => ({ x: window.__tf.state().x, z: window.__tf.state().z }));
const hits0 = await B.evaluate(() => window.__tf.online().hp);
// aim A's turret at B and fire until the server reports damage
let damaged = false;
let shotsSeen = 0;
await B.evaluate(() => {
  window.__fires = 0;
  window.__tf.net.on('fire', () => window.__fires++);
});
const aimAtB = () =>
  A.evaluate(([tid]) => {
    const t = window.__tf;
    const e = t.enemies().find((x) => x.player === tid);
    const G = t.G;
    // point the camera (and so the guns) at the middle of B's hull, and set the range
    const c = G.camPos;
    const ty = t.terrain.height(e.x, e.z) + 1.2;
    G.cam.yaw = Math.atan2(e.x - c[0], e.z - c[2]);
    G.cam.pitch = Math.atan2(ty - c[1], Math.hypot(e.x - c[0], e.z - c[2]));
    t.setZero(Math.hypot(e.x - G.s.x, e.z - G.s.z));
  }, [idB]);
for (let attempt = 0; attempt < 10 && !damaged; attempt++) {
  await aimAtB();
  await run(A, 0.1);
  await aimAtB();
  await run(A, 2.5);
  await A.evaluate(() => window.__tf.trigger());
  await run(A, 1.5);
  await new Promise((r) => setTimeout(r, 400));
  await run(B, 0.2);
  shotsSeen = await B.evaluate(() => window.__fires);
  damaged = (await B.evaluate(() => window.__tf.online().hp)) < hits0;
}
const lastHit = await A.evaluate(() => window.__tf.state().lastHit);
check('B sees A\'s shots', shotsSeen >= 1, `fires seen ${shotsSeen}`);
check('A\'s shell strikes B and the server takes B\'s hit points', damaged, JSON.stringify({ lastHit, a: aPos }));
// the steps above skip drawing: draw one frame for the pictures
for (const p of [A, B]) await p.evaluate(() => window.__tf.advance(1 / 60, [], true));
await A.screenshot({ path: path.join(out, 'online_battle_A.png') });
await B.screenshot({ path: path.join(out, 'online_battle_B.png') });

// knock B out (more shots if needed), then the wait and the respawn
for (let attempt = 0; attempt < 10 && !(await B.evaluate(() => window.__tf.online().dead)); attempt++) {
  await aimAtB();
  await run(A, 2.5);
  await A.evaluate(() => window.__tf.trigger());
  await run(A, 1.5);
  await new Promise((r) => setTimeout(r, 300));
  await run(B, 0.1);
}
const dead = await B.evaluate(() => window.__tf.online());
check('B is knocked out and A is credited', dead.dead && dead.members.find((m) => m.id === idA)?.kills >= 1, JSON.stringify(dead));
const wreck = await A.evaluate(([tid]) => window.__tf.enemies().find((e) => e.player === tid).alive, [idB]);
check('A sees B as a wreck', wreck === false);
// R brings the deploy screen up at once; 加入戰鬥 waits out the delay
await B.focus('#view');
await B.keyboard.press('KeyR');
await wait(B, () => !document.getElementById('deploy').hidden, null, 3000).catch(() => {});
const waiting = await B.evaluate(() => ({ open: !document.getElementById('deploy').hidden, cards: document.querySelectorAll('#deploy .dp-card').length }));
check('after a knock-out R brings the deploy screen back', waiting.open && waiting.cards > 0, JSON.stringify(waiting));
await B.click('#deploy .dp-card[data-id="us_m4a3_75w"]');
await new Promise((r) => setTimeout(r, 5300));
await run(B, 0.05);
if (spawnsB > 1) await B.click('#deploy .dp-spawn[data-i="1"]');
await B.click('#dp-go');
await wait(B, () => !window.__tf.online().dead, null, 5000).catch(() => {});
const back = await B.evaluate(() => ({ o: window.__tf.online(), id: window.__tf.state().id, x: window.__tf.state().x, z: window.__tf.state().z }));
check('after the wait B comes back in another vehicle, at its chosen start, full hit points', !back.o.dead && back.o.hp === 100 && back.id === 'us_m4a3_75w' && Math.hypot(back.x - spawnB.x, back.z - spawnB.z) < 4, JSON.stringify([back, spawnB]));
await wait(A, ([tid]) => window.__tf.enemies().find((e) => e.player === tid && e.id === 'us_m4a3_75w')?.alive, [idB], 5000).catch(() => {});
check('A sees B back in the battle in the new vehicle', await A.evaluate(([tid]) => window.__tf.enemies().find((e) => e.player === tid && e.id === 'us_m4a3_75w')?.alive, [idB]));

// chat in battle (Enter, type, Enter)
await A.focus('#view');
await A.keyboard.press('Enter');
await A.keyboard.type('好球');
await A.keyboard.press('Enter');
await wait(B, () => document.getElementById('net-feed').textContent.includes('好球'), null, 5000).catch(() => {});
check('chat in battle shows in the other player\'s feed', await B.evaluate(() => document.getElementById('net-feed').textContent.includes('好球')));
check('the score line shows the kill', /藍方 \d+ : \d+ 紅方/.test(await A.evaluate(() => document.getElementById('net-score').textContent)));

// ---- B's connection drops in the battle: B reconnects on its own and takes the seat back
const idBefore = await B.evaluate(() => window.__tf.net.id);
await B.evaluate(() => window.__tf.net.ws.close());
await wait(B, () => window.__tf.net.open && !window.__tf.net.reconnecting, null, 20000).catch(() => {});
const resumed = await B.evaluate(() => ({ id: window.__tf.net.id, open: window.__tf.net.open, mode: window.__tf.state().mode, online: !!window.__tf.online() }));
check('a dropped connection in battle reconnects and keeps the seat', resumed.id === idBefore && resumed.open && resumed.mode === 'battle' && resumed.online, JSON.stringify([idBefore, resumed]));
await wait(A, ([tid]) => window.__tf.enemies().some((e) => e.player === tid), [idB], 5000).catch(() => {});
check('the other player still has it in the battle', await A.evaluate(([tid]) => window.__tf.enemies().some((e) => e.player === tid), [idB]));

// ---- the host ends the battle: both back in the room with the scores
// 加入戰鬥 locked the cursor to the view (as Esc would, let it go before clicking a button)
await A.evaluate(() => document.exitPointerLock && document.exitPointerLock());
await A.click('#net-end');
await wait(A, () => window.__tf.state().mode === 'garage', null, 10000);
await wait(B, () => window.__tf.state().mode === 'garage', null, 10000);
const after = await B.evaluate(() => ({ inRoom: window.__tf.net.inRoom, playing: window.__tf.net.room?.playing, lobby: !document.getElementById('lobby').hidden, board: document.querySelector('#lobby .lb-teams')?.textContent }));
check('the host ends the battle; both are back in the room with the scores shown', after.inRoom && !after.playing && after.lobby && /1\/0|0\/1/.test(after.board || ''), JSON.stringify(after));
await B.screenshot({ path: path.join(out, 'online_after.png') });

// ---- leaving: B leaves, A is alone; A leaves, the room is gone
await B.click('#lobby [data-act="leave"]');
await wait(A, () => window.__tf.net.room.members.length === 1);
await A.click('#lobby [data-act="leave"]');
await new Promise((r) => setTimeout(r, 300));
const rooms1 = await fetch(`http://127.0.0.1:${port}/rooms`).then((r) => r.json());
check('the empty room is removed', rooms1.rooms.length === 0, JSON.stringify(rooms1));

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.kill();
const failed = Object.values(results).filter((v) => v !== 'ok').length;
console.log(`${Object.keys(results).length - failed}/${Object.keys(results).length} ok`);
process.exit(failed ? 1 : 0);

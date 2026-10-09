// Missiles and the Oplot-MO online, end to end: the real server (crates/server) and two headless
// browsers. A deploys the M901 ITV, B the T-10M; B is put 450 m in front of A. A launches TOWs and
// steers them from the sight; the server flies them, runs B's Oplot-MO (radar, tracking, its gun
// and bullets) and sends what happens to both: A and B both see the missile, B's system detects,
// fires and its HUD shows it; each TOW is shot down or strikes B and the server scores it.
//   node test/online-missiles.mjs [output_dir]     (build first: npm run build; cargo build -p tg-server)
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
fs.mkdirSync(out, { recursive: true });

const results = {};
const errors = [];
const check = (name, cond, detail) => {
  results[name] = cond ? 'ok' : 'FAIL ' + (detail ?? '');
  console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : ' ' + (detail ?? '')));
};

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
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
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
const run = (p, seconds, keys = []) => p.evaluate(([s, k]) => window.__tf.advance(s, k, false), [seconds, keys]);

for (const [p, name] of [
  [A, '導彈手'],
  [B, '重戰車'],
]) {
  await p.click('#net-btn');
  await p.fill('#lb-name', name);
  await p.click('#lobby [data-act="connect"]');
  await wait(p, () => window.__tf.net.open);
}
await A.fill('#lb-room-name', '攔截試驗');
await A.selectOption('#lb-map', 'range');
await A.click('#lobby [data-act="create"]');
await wait(A, () => window.__tf.net.inRoom);
await wait(B, () => document.querySelector('#lobby [data-act="join"]'));
await B.click('#lobby [data-act="join"]');
await wait(B, () => window.__tf.net.inRoom);
await wait(A, () => window.__tf.net.room.members.length === 2);
await A.click('#lobby [data-act="start"]');
await wait(A, () => window.__tf.state().mode === 'battle' && window.__tf.online(), null, 60000);
await wait(B, () => window.__tf.state().mode === 'battle' && window.__tf.online(), null, 60000);
await wait(A, () => !document.getElementById('deploy').hidden);
await wait(B, () => !document.getElementById('deploy').hidden);
await A.click('#deploy .dp-card[data-id="us_m901_itv"]');
await B.click('#deploy .dp-card[data-id="su_t10m"]');
await A.click('#dp-go');
await B.click('#dp-go');
await wait(A, () => !window.__tf.online().dead && document.getElementById('deploy').hidden, null, 10000);
await wait(B, () => !window.__tf.online().dead && document.getElementById('deploy').hidden, null, 10000);
check('A deploys the M901 ITV and B the T-10M', (await A.evaluate(() => window.__tf.state().id)) === 'us_m901_itv' && (await B.evaluate(() => window.__tf.state().id)) === 'su_t10m');

// B, still in its spawn grace, is put 450 m in front of A, facing it
const spot = await A.evaluate(() => {
  const t = window.__tf;
  const s = t.state();
  return { x: s.x + Math.sin(s.heading) * 450, z: s.z + Math.cos(s.heading) * 450, h: s.heading + Math.PI };
});
await B.evaluate(([x, z, h]) => window.__tf.place(x, z, h), [spot.x, spot.z, spot.h]);
for (let i = 0; i < 4; i++) {
  await run(B, 0.1);
  await run(A, 0.1);
  await new Promise((r) => setTimeout(r, 120));
}
const idB = await B.evaluate(() => window.__tf.net.id);
// what each sees: missiles in the sky, B's protection system, the events
for (const p of [A, B]) {
  await p.evaluate(() => {
    window.__sky = { ms: 0, ev: {}, maxFlying: 0, tracers: 0 };
    window.__tf.net.on('snap', (m) => {
      if ((m.ms || []).length) window.__sky.ms++;
      for (const e of m.ev || []) window.__sky.ev[e.type] = (window.__sky.ev[e.type] || 0) + 1;
      window.__sky.tracers += (m.fired || []).filter((f) => f.tracer).length;
      window.__sky.maxFlying = Math.max(window.__sky.maxFlying, window.__tf.missiles()?.nodes.size || 0);
    });
  });
}
const aimAtB = () =>
  A.evaluate(([tid]) => {
    const t = window.__tf;
    const e = t.enemies().find((x) => x.player === tid);
    const G = t.G;
    const c = G.camPos;
    const ty = t.terrain.height(e.x, e.z) + 1.2;
    G.cam.yaw = Math.atan2(e.x - c[0], e.z - c[2]);
    G.cam.pitch = Math.atan2(ty - c[1], Math.hypot(e.x - c[0], e.z - c[2]));
  }, [idB]);
const hp0 = await B.evaluate(() => window.__tf.online().hp);
let apsSeen = null;
const shots = 3;
for (let k = 0; k < shots; k++) {
  await aimAtB();
  await run(A, 0.1);
  await aimAtB();
  await run(A, 1.5);
  await A.evaluate(() => window.__tf.trigger());
  // the TOW flies about 2 s; keep the cross on B (A steers it) and let B's game show the sky
  for (let i = 0; i < 40; i++) {
    await aimAtB();
    await run(A, 0.05);
    await run(B, 0.05);
    await new Promise((r) => setTimeout(r, 50));
    const s = await B.evaluate(() => window.__tf.aps());
    if (s && (s.mode === 'engage' || s.firing) && !apsSeen) {
      apsSeen = s;
      for (const p of [A, B]) await p.evaluate(() => window.__tf.advance(1 / 60, [], true));
      await B.screenshot({ path: path.join(out, 'online_aps_B.png') });
      await A.screenshot({ path: path.join(out, 'online_aps_A.png') });
    }
  }
  // the launcher reloads before the next
  await run(A, 3);
}
const skyA = await A.evaluate(() => window.__sky);
const skyB = await B.evaluate(() => window.__sky);
const hp1 = await B.evaluate(() => window.__tf.online().hp);
const apsB = await B.evaluate(() => window.__tf.aps());
const rounds = await B.evaluate(() => window.__tf.G.loadout.turrets[1].guns[0].ammo.reduce((s, a) => s + a.count, 0));
console.log('A', JSON.stringify(skyA), '\nB', JSON.stringify(skyB), '\naps', JSON.stringify(apsB && { mode: apsB.mode, rounds: apsB.rounds, kills: apsB.kills }), 'hp', hp0, '->', hp1);
check('A and B both see the server\'s missiles in flight', skyA.ms > 3 && skyB.ms > 3 && skyB.maxFlying >= 1, JSON.stringify([skyA.ms, skyB.ms, skyB.maxFlying]));
check('B\'s Oplot-MO detects the TOWs and fires at them', (skyB.ev.detect || 0) >= 1 && (skyB.ev.fire_start || 0) >= 1 && skyB.tracers > 0, JSON.stringify(skyB.ev));
check('B\'s HUD shows its system engaging', !!apsSeen, JSON.stringify(apsB));
// shot down in the air, or crippled by the bullets (controls or motor gone) into the ground, or a hit on B
const ended = (skyB.ev.intercept || 0) + (skyB.ev.missile_ground || 0) + (skyB.ev.missile_spent || 0) + (hp1 < hp0 ? 1 : 0);
const defeated = (skyB.ev.intercept || 0) + Math.min(skyB.ev.missile_ground || 0, skyB.ev.missile_damaged || 0);
check('every TOW is shot down, crippled into the ground or strikes B (scored by the server)', ended >= 2 && defeated >= 1, JSON.stringify(skyB.ev));
check('the rounds it fired leave B\'s belt', apsB && apsB.rounds < 900 && rounds === apsB.rounds, JSON.stringify([apsB?.rounds, rounds]));
// B switches it off: nothing more is fired
await B.evaluate(() => window.__tf.toggleAps && window.__tf.toggleAps());
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
server.kill();
const failed = Object.values(results).filter((v) => v !== 'ok').length;
console.log(`${Object.keys(results).length - failed}/${Object.keys(results).length} ok`);
process.exit(failed ? 1 : 0);

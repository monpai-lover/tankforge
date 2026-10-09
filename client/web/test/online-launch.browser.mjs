// Real browser WebSocket traffic against a launch-protocol fixture, including transport jitter,
// actual Rust/WASM missile creation, server-rate rejection, lost ACKs and reconnect retries.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { loadData } from '../tools/load-data.mjs';
import { loadCoreSync } from '../src/design/core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, '../dist/online-launch-shots');
fs.mkdirSync(out, { recursive: true });
const data = loadData();
const core = loadCoreSync(fs.readFileSync(path.join(here, '../assets/tg_design.wasm')), { materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains) });
const timers = new Set();
const later = (fn, ms) => {
  const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms);
  timers.add(timer);
};
class LaunchServer {
  reset(id) {
    this.ammo = data.vehicles[id].weapons.main_gun.ammo_count[0];
    this.carried = data.vehicles[id].weapons.main_gun.missile;
    this.lastLaunch = -Infinity;
    this.receipts = new Map(); this.requests = []; this.accepted = []; this.rejected = [];
    this.pos = [0, 0, 0]; this.alive = this.inRoom = this.playing = this.worldReady = true;
    this.rateReject = this.invalidDirection = this.dropAck = this.disconnect = false;
    this.ignoreState = false;
    this.epoch = Date.now();
    core.call({ op: 'mw_reset', defs: Object.values(data.missiles), terrain: null });
  }
  now() { return (Date.now() - this.epoch) / 1000; }
  send(ws, packet) { ws.send(JSON.stringify(packet)); }
  snapshot(ws) {
    const res = core.call({ op: 'mw_step', dt: 1 / 60, actors: [] });
    this.send(ws, { t: 'snap', tick: 0, players: [], ms: res.missiles || [], aps: [], ev: [], fired: [] });
  }
  receive(msg, ws) {
    if (msg.t === 'hello') {
      if (msg.resume) this.send(ws, { t: 'welcome', id: 900, name: 'placeholder', maps: ['range'] });
      this.send(ws, { t: 'welcome', id: 501, name: 'launcher-test', maps: ['range'], token: 'launcher-test-token-123456' });
    } else if (msg.t === 'state') { if (!this.ignoreState) this.pos = msg.s.pos; }
    else if (msg.t === 'guide') core.call({ op: 'mw_guide', id: msg.id, owner: 501, sight: msg.sight, aim: msg.aim });
    else if (msg.t === 'ping') this.send(ws, { t: 'pong', at: msg.at });
    else if (msg.t === 'launch') {
      this.requests.push(structuredClone(msg));
      const delay = this.requests.length === 1 ? 100 : 50;
      later(() => this.launch(msg, ws), delay);
    }
  }
  launch(original, ws) {
    const now = this.now();
    const old = this.receipts.get(original.seq);
    if (old) {
      later(() => { this.send(ws, old); this.snapshot(ws); }, 50);
      return;
    }
    const msg = this.invalidDirection ? { ...original, d: [0, 0, 0] } : original;
    const reject = (reason, retry = 0) => {
      this.rejected.push({ seq: msg.seq, reason, at: now });
      later(() => this.send(ws, { t: 'launch_rejected', seq: msg.seq, reason, retry_after_s: retry }), 50);
    };
    if (!this.inRoom) return reject('not_in_room');
    if (!this.alive) return reject('destroyed');
    if (![...msg.o, ...msg.d].every(Number.isFinite) || Math.hypot(...msg.d) < 1e-6) return reject('invalid_launch');
    if (Math.hypot(this.pos[0] - msg.o[0], this.pos[2] - msg.o[2]) >= 12) return reject('invalid_origin');
    if (msg.missile !== this.carried || this.ammo <= 0) return reject('no_ammo');
    if (this.rateReject) { this.lastLaunch = now; this.rateReject = false; }
    if (now - this.lastLaunch < 0.25) return reject('rate_limited', 0.25 - (now - this.lastLaunch));
    if (!this.playing || !this.worldReady) return reject('not_in_battle');
    const res = core.call({ op: 'mw_launch', def: msg.missile, owner: 501, team: 0, pos: msg.o, dir: msg.d, seed: msg.seq, id: null });
    if (res.id == null) return reject('launch_failed');
    this.ammo--; this.lastLaunch = now;
    const receipt = { t: 'launched', from: 501, seq: msg.seq, id: res.id, missile: msg.missile, o: msg.o, d: msg.d };
    this.receipts.set(msg.seq, receipt); this.accepted.push({ seq: msg.seq, id: res.id, at: now });
    if (this.disconnect) { this.disconnect = false; void ws.close({ code: 1001, reason: 'transport interruption before ACK' }); return; }
    if (this.dropAck) { this.dropAck = false; return; }
    later(() => { this.send(ws, receipt); this.snapshot(ws); }, 50);
  }
}
const server = new LaunchServer();
server.reset('us_m901_itv');
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: process.env.TF_BROWSER || (fs.existsSync(edge) ? edge : undefined), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'] });
const errors = [], results = [];
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.routeWebSocket('ws://launcher-regression.test/ws', ws => ws.onMessage(text => server.receive(JSON.parse(String(text)), ws)));
  await page.goto(pathToFileURL(path.join(here, '../dist/tankforge-range.html')).href);
  await page.waitForFunction(() => window.__tf, null, { timeout: 120000 });
  await page.evaluate(async () => {
    const t = window.__tf;
    t.pause(); await t.coreReady(); t.setQuality('low');
    t.renderer.q = { ...t.renderer.q, dome: 256 }; t.renderer._buildDome(256);
    t.G.thumbs.length = 0; t.setMapChoice('range');
    document.getElementById('g-loading').hidden = true;
    await t.net.connect('ws://launcher-regression.test/ws', 'launcher-test');
  });
  const stage = async (id = 'us_m901_itv') => {
    await page.evaluate(id => {
      const t = window.__tf;
      t.pause(); t.toGarage(); t.select(id); t.startBattle();
      t.G.enemies = []; // the online start path creates an empty remote roster on the range
      const member = { id: 501, name: 'launcher-test', vehicle: id, team: 'blue', slot: 0, alive: true, hp: 100 };
      t.G.online = { seq: 0, team: 'blue', slot: 0, members: new Map([[501, member]]), sendAcc: 0, dead: false, benched: false, hp: 100, deployAt: Infinity };
      t.net.room = { id: 1, host: 501, playing: true, members: [member] };
    }, id);
    server.reset(id);
  };
  const state = () => page.evaluate(() => {
    const t = window.__tf, g = t.G.loadout.turrets[0].guns[0];
    return { ammo: g.ammo[0].count, ready: g.launcher.ready, cooldown: g.launcher.cooldown, loading: t.G.T[0].loading.state[0], pending: (t.G.pendingLaunch || []).length, guided: t.G.guided.map(m => m.id) };
  });
  const fire = () => page.evaluate(() => window.__tf.fireGun(0, 0));
  const awaitAmmo = async ammo => {
    await page.evaluate(() => window.__tf.pause(false));
    await page.waitForFunction(ammo => {
      const t = window.__tf;
      if (t.G.loadout.turrets[0].guns[0].ammo[0].count === ammo && !(t.G.pendingLaunch || []).length) { t.pause(); return true; }
      return false;
    }, ammo, { timeout: 10000 }).catch(async error => {
      console.log(JSON.stringify({ state: await state(), errors, accepted: server.accepted, rejected: server.rejected, requests: server.requests, loop: await page.evaluate(() => ({ paused: window.__tf.G.paused, time: window.__tf.G.time, mode: window.__tf.G.mode, net: window.__tf.net.status, pendingSentAt: window.__tf.G.pendingLaunch?.[0]?.sentAt })) }));
      throw error;
    });
  };
  const awaitSpacing = async () => {
    await page.evaluate(() => window.__tf.pause(false));
    await page.waitForFunction(() => {
      const t = window.__tf;
      if (t.G.loadout.turrets[0].guns[0].launcher.cooldown <= 1e-9) { t.pause(); return true; }
      return false;
    }, null, { timeout: 10000 }).catch(async error => {
      console.log(JSON.stringify({ state: await state(), errors, loop: await page.evaluate(() => ({ paused: window.__tf.G.paused, time: window.__tf.G.time, mode: window.__tf.G.mode, thumbs: window.__tf.G.thumbs.length })) }));
      throw error;
    });
  };
  for (const id of ['us_m901_itv', 'xp_bmp_k64_atgm', 'xp_bmp_k64_kornet']) {
    await stage(id);
    const initial = await state();
    assert.equal(await fire(), true);
    const beforeAck = await state();
    assert.equal(beforeAck.ammo, initial.ammo, 'sending a request cannot spend an unconfirmed missile');
    assert.equal(beforeAck.ready, 2);
    assert.equal(beforeAck.loading, 'ready');
    assert.equal(await fire(), false, 'a second request waits for the first acknowledgement');
    await awaitAmmo(initial.ammo - 1);
    assert.equal(await fire(), false, 'the launch interval starts at ACK arrival');
    await awaitSpacing();
    assert.equal(await fire(), true);
    assert.equal((await state()).ammo, initial.ammo - 1);
    await awaitAmmo(initial.ammo - 2);
    const final = await state();
    assert.equal(final.ready, 0);
    assert.equal(new Set(final.guided).size, 2);
    assert.equal(server.accepted.length, 2);
    assert.ok(server.accepted[1].at - server.accepted[0].at >= 0.25);
    assert.equal(server.ammo, initial.ammo - 2);
    results.push({ case: '100ms/50ms delay inversion', id, beforeAck, final, accepted: structuredClone(server.accepted) });
  }
  await stage();
  assert.equal(await fire(), true);
  await awaitAmmo(11);
  await awaitSpacing();
  server.rateReject = true; // another launcher can update the server's player-wide receive clock
  assert.equal(await fire(), true);
  assert.equal((await state()).ammo, 11);
  await page.evaluate(() => window.__tf.pause(false));
  await page.waitForFunction(() => !(window.__tf.G.pendingLaunch || []).length, null, { timeout: 10000 });
  await page.evaluate(() => window.__tf.pause());
  const secondRejected = await state();
  assert.equal(server.rejected.at(-1)?.reason, 'rate_limited');
  assert.equal(server.ammo, 11);
  assert.equal(secondRejected.ammo, 11);
  assert.equal(secondRejected.ready, 1);
  assert.equal(secondRejected.loading, 'ready', 'rejecting the second missile cannot start a full reload');
  await awaitSpacing();
  assert.equal(await fire(), true);
  await awaitAmmo(10);
  assert.equal(server.ammo, 10);
  results.push({ case: 'second tube rate rejection then retry', kept: secondRejected, final: await state() });
  for (const reason of ['rate_limited', 'invalid_origin', 'invalid_launch', 'no_ammo', 'not_in_room', 'not_in_battle', 'destroyed']) {
    await stage();
    if (reason === 'rate_limited') server.rateReject = true;
    if (reason === 'invalid_origin') { server.pos = [1000, 0, 1000]; server.ignoreState = true; }
    if (reason === 'invalid_launch') server.invalidDirection = true;
    if (reason === 'no_ammo') server.ammo = 0;
    if (reason === 'not_in_room') server.inRoom = false;
    if (reason === 'not_in_battle') server.worldReady = false;
    if (reason === 'destroyed') server.alive = false;
    assert.equal(await fire(), true);
    await page.evaluate(() => window.__tf.pause(false));
    await page.waitForFunction(() => !(window.__tf.G.pendingLaunch || []).length, null, { timeout: 10000 });
    await page.evaluate(() => window.__tf.pause());
    const kept = await state();
    assert.equal(kept.ammo, 12, reason);
    assert.equal(kept.ready, 2, reason);
    assert.equal(kept.loading, 'ready', reason);
    assert.equal(server.rejected.at(-1)?.reason, reason);
    results.push({ case: reason, kept });
  }
  for (const mode of ['lost_ack', 'reconnect']) {
    await stage();
    server.dropAck = mode === 'lost_ack'; server.disconnect = mode === 'reconnect';
    assert.equal(await fire(), true);
    await awaitAmmo(11);
    assert.equal(server.accepted.length, 1);
    assert.ok(server.requests.length >= 2, 'the pending sequence is retried');
    assert.deepEqual(server.requests[0], server.requests.at(-1), 'retrying cannot choose a new sequence or tube');
    assert.equal(server.ammo, 11);
    assert.equal((await state()).ready, 1);
    results.push({ case: mode, requests: structuredClone(server.requests), state: await state() });
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, errors, transport: 'real browser WebSocket with a launch-protocol fixture; missile world runs the committed Rust/WASM core' }, null, 2));
  console.log('PASS: ACK-gated twin ATGM launches survive delay inversion, rejection, lost ACKs and reconnect without duplicate ammunition consumption');
} finally {
  for (const timer of timers) clearTimeout(timer);
  await browser.close();
}

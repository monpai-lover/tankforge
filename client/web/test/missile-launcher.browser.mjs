import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { buildSync } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, '../dist/missile-launcher-shots');
fs.mkdirSync(out, { recursive: true });
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: process.env.TF_BROWSER || (fs.existsSync(edge) ? edge : undefined), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'] });
const errors = [], results = [];
const cooldownFixture = buildSync({ stdin: { contents: "import { tickLauncher } from '../src/game/loadout.js'; window.stepTestLauncherCooldown = dt => tickLauncher(window.__tf.G.loadout.turrets[0].guns[0], dt);", resolveDir: here }, bundle: true, write: false, format: 'iife', logLevel: 'silent' }).outputFiles[0].text;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && /shader|link:|framebuffer|WebGL/i.test(m.text())) errors.push(m.text());
  });
  await page.goto(pathToFileURL(path.join(here, '../dist/tankforge-range.html')).href);
  await page.waitForFunction(() => window.__tf, null, { timeout: 120000 });
  await page.addScriptTag({ content: cooldownFixture });
  await page.evaluate(async () => {
    const t = window.__tf;
    t.pause();
    await t.coreReady();
    t.setQuality('low');
    t.renderer.q = { ...t.renderer.q, dome: 256 };
    t.renderer._buildDome(256);
    t.G.thumbs.length = 0;
    t.setMapChoice('range');
    document.getElementById('g-loading').hidden = true;
  });
  for (const id of ['us_m901_itv', 'xp_bmp_k64_atgm', 'xp_bmp_k64_kornet']) {
    await page.evaluate(id => {
      const t = window.__tf;
      t.toGarage(); t.select(id); t.startBattle();
      t.G.thumbs.length = 0;
      t.G.camOverride = { fov: 0.65, dist: 13, pivot: [t.G.s.x, 2, t.G.s.z + 2] };
      t.G.cam.yaw = t.G.s.heading + Math.PI / 2 + 0.35;
      t.G.cam.pitch = -0.15;
      t.G.view = 'orbit';
      t.G.T[0].guns[0].pitch = 0.08;
      t.advance(0.05);
    }, id);
    const initial = await page.evaluate(() => {
      const t = window.__tf, g = t.G.loadout.turrets[0].guns[0];
      return { ammo: g.ammo.reduce((s, a) => s + a.count, 0), reload: g.def.reload_s };
    });
    const first = await page.evaluate(() => {
      const t = window.__tf;
      t.trigger(); t.advance(1 / 60);
      const g = t.G.loadout.turrets[0].guns[0];
      return { loading: t.G.T[0].loading.state[0], ammo: g.ammo.reduce((s, a) => s + a.count, 0), guided: t.G.guided.map(m => m.id), missiles: [...t.missiles().nodes.values()].map(v => v.pos), ready: g.launcher?.ready };
    });
    assert.equal(first.ammo, initial.ammo - 1);
    assert.equal(first.loading, 'ready', `${id}: the loaded second tube must remain ready after the first launch`);
    assert.equal(first.ready, 1);
    assert.equal(first.guided.length, 1);
    const rapid = await page.evaluate(() => {
      const t = window.__tf, g = t.G.loadout.turrets[0].guns[0];
      return { fired: t.fireGun(0, 0), ammo: g.ammo[0].count, ready: g.launcher.ready, loading: t.G.T[0].loading.state[0] };
    });
    assert.equal(rapid.fired, false, 'a click inside 0.25 s cannot consume the second tube');
    assert.equal(rapid.ammo, first.ammo);
    assert.equal(rapid.ready, 1);
    assert.equal(rapid.loading, 'ready');
    const second = await page.evaluate(() => {
      const t = window.__tf;
      t.advance(0.3, [], false);
      t.trigger(); t.advance(1 / 60);
      const g = t.G.loadout.turrets[0].guns[0];
      return { loading: t.G.T[0].loading.state[0], remaining: t.G.T[0].loading.loaders[0].remaining, ammo: g.ammo.reduce((s, a) => s + a.count, 0), guided: t.G.guided.map(m => m.id), missiles: [...t.missiles().nodes.values()].map(v => v.pos), ready: g.launcher?.ready };
    });
    assert.equal(second.ammo, initial.ammo - 2, 'two separate trigger presses launch two missiles');
    assert.equal(second.ready, 0);
    assert.equal(second.loading, 'loading');
    assert.ok(second.remaining > initial.reload - 0.1, 'full reload starts after the second tube only');
    assert.equal(second.guided.length, 2, 'both missiles keep their own guidance entry');
    assert.equal(new Set(second.guided).size, 2);
    assert.equal(second.missiles.length, 2, 'both missiles are visibly in flight');
    await page.screenshot({ path: path.join(out, `${id}-two-in-flight.png`) });
    const reload = await page.evaluate(seconds => {
      const t = window.__tf;
      const blocked = t.fireGun(0, 0);
      t.advance(seconds, [], false);
      const g = t.G.loadout.turrets[0].guns[0];
      return { blocked, state: t.G.T[0].loading.state[0], ready: g.launcher.ready, ammo: g.ammo.reduce((s, a) => s + a.count, 0) };
    }, initial.reload);
    assert.equal(reload.blocked, false);
    assert.equal(reload.state, 'ready');
    assert.equal(reload.ready, 2);
    assert.equal(reload.ammo, initial.ammo - 2);
    results.push({ id, initial, first, rapid, second, reload });
  }
  const online = await page.evaluate(() => {
    const t = window.__tf;
    t.toGarage(); t.select('us_m901_itv'); t.startBattle();
    const priorSend = t.net.send, priorId = t.net.id, priorStatus = t.net.status;
    const sent = [];
    t.net.send = msg => sent.push(msg);
    t.net.id = 501;
    t.net.status = 'open';
    t.G.online = { seq: 0 };
    try {
      const g = t.G.loadout.turrets[0].guns[0];
      const first = t.fireGun(0, 0), rapid = t.fireGun(0, 0);
      const firstRequest = sent.find(m => m.t === 'launch');
      t.net._emit('launched', { from: 501, seq: firstRequest.seq, id: 700, missile: firstRequest.missile });
      const between = { state: t.G.T[0].loading.state[0], ready: g.launcher.ready, cooldown: g.launcher.cooldown };
      window.stepTestLauncherCooldown(0.25);
      const second = t.fireGun(0, 0);
      const launches = sent.filter(m => m.t === 'launch');
      t.net._emit('launched', { from: 501, seq: launches[1].seq, id: 701, missile: launches[1].missile });
      return { first, rapid, second, between, launches, state: t.G.T[0].loading.state[0], ready: g.launcher.ready, guided: t.G.guided.map(m => m.id) };
    } finally {
      t.G.online = null; t.net.send = priorSend; t.net.id = priorId; t.net.status = priorStatus;
    }
  });
  assert.equal(online.first, true);
  assert.equal(online.rapid, false);
  assert.equal(online.second, true);
  assert.equal(online.between.state, 'ready');
  assert.equal(online.between.ready, 1);
  assert.equal(online.between.cooldown, 0.25);
  assert.equal(online.launches.length, 2);
  assert.notDeepEqual(online.launches[0].o, online.launches[1].o, 'distinct tube origins go to the server');
  assert.equal(online.state, 'waiting');
  assert.equal(online.ready, 0);
  assert.deepEqual(online.guided, [700, 701], 'separate launch acknowledgements retain both guidance IDs');
  const unavailable = await page.evaluate(() => {
    const t = window.__tf;
    t.toGarage(); t.select('us_m901_itv'); t.startBattle();
    const g = t.G.loadout.turrets[0].guns[0], world = t.G.missiles;
    const before = g.ammo[0].count;
    t.G.missiles = null;
    const fired = t.fireGun(0, 0);
    t.G.missiles = world;
    return { fired, before, after: g.ammo[0].count, state: t.G.T[0].loading.state[0], ready: g.launcher.ready };
  });
  assert.equal(unavailable.fired, false);
  assert.equal(unavailable.before, unavailable.after);
  assert.equal(unavailable.state, 'ready', 'an unavailable launch must not consume or start a reload');
  assert.equal(unavailable.ready, 2);
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, online, unavailable, errors, renderer: 'software WebGL regression; no performance claim; online transport and acknowledgements are staged' }, null, 2));
  console.log('PASS: all three twin ATGM launchers fire two separately guided missiles before one full reload; unavailable launches preserve readiness');
} finally {
  await browser.close();
}

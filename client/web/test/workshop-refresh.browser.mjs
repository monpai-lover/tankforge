// Exercises the actual workshop controls and their live WebGL vehicle, not a UI mock.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, '../dist/verification/workshop-refresh');
fs.mkdirSync(out, { recursive: true });
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: process.env.TF_BROWSER || edge, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'] });
const results = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(here, '../dist/tankforge-range.html')).href + '?lang=zh');
  await page.waitForFunction(() => window.__tf, null, { timeout: 120000 });
  await page.evaluate(() => {
    const t = window.__tf; t.pause(); t.setQuality('low');
    t.renderer.q = { ...t.renderer.q, dome: 256 }; t.renderer._buildDome(256);
    t.G.thumbs.length = 0; t.G.spinHold = 1000;
    document.getElementById('g-loading').hidden = true; t.setWorkshop(true);
  });
  assert.equal(await page.locator('#ws-preset-bmpTwin').count(), 1, 'practical missile preset must be available');
  for (const [preset, weapon, count] of [['hetzer20', 'de_hetzer_sdkfz1401', 3], ['bmpTwin', 'xp_bmp_k64_atgm', 1], ['kda35', 'xp_kda35', 5]]) {
    await page.locator('#ws-preset-' + preset).click();
    const r = await page.evaluate(() => {
      const t = window.__tf, g = t.G.loadout.turrets[0].guns[0]; t.G.thumbs.length = 0; t.advance(1 / 60);
      return { base: t.G.build.base, weapon: t.G.build.turrets[0].guns[0].weapon, ammo: g.ammo.length, tubes: g.launcher?.ready || 0, imported: !!t.G.loadout.imported, stabilizer: t.G.loadout.turrets[0].stabilizer };
    });
    assert.equal(r.weapon, weapon); assert.equal(r.ammo, count);
    if (preset === 'bmpTwin') { assert.equal(r.imported, true); assert.equal(r.tubes, 2); }
    if (preset === 'kda35') assert.equal(r.stabilizer, 'two_plane');
    results.push({ preset, ...r });
  }
  await page.locator('#ws-t0-sight').selectOption('us_m901_itv');
  await page.locator('#ws-t0-stabilizer').selectOption('vertical');
  const optics = await page.evaluate(() => window.__tf.G.loadout.turrets[0]);
  assert.equal(optics.sight.name, 'M27 TOW sight'); assert.equal(optics.sight.levels[1].magnification, 13); assert.equal(optics.stabilizer, 'vertical');
  await page.locator('#ws-t0-g0-weapon').selectOption('custom');
  assert.equal(await page.locator('#ws-t0-g0-cal').count(), 1);
  await page.locator('#ws-t0-g0-weapon').selectOption('xp_kda35');
  assert.equal(await page.locator('#ws-t0-g0-cal').count(), 0);
  await page.locator('.ws-export > summary').click();
  await page.locator('#ws-export-btn').click();
  const exported = await page.locator('#ws-export').inputValue();
  const before = await page.evaluate(() => JSON.stringify(window.__tf.G.build));
  await page.locator('#ws-import').fill(JSON.stringify({ ...JSON.parse(before), turrets: [{ guns: [{ weapon: 'bad' }] }] }));
  await page.locator('#ws-import-btn').click();
  assert.equal(await page.evaluate(() => JSON.stringify(window.__tf.G.build)), before, 'rejected import cannot change the current vehicle');
  assert.match(await page.locator('#ws-export-status').textContent(), /匯入失敗/);
  await page.locator('#ws-import').fill(exported); await page.locator('#ws-import-btn').click();
  assert.equal(await page.evaluate(() => JSON.stringify(window.__tf.G.build)), before, 'own exported envelope must import');
  assert.match(await page.locator('#ws-export-status').textContent(), /已匯入/);
  await page.locator('#ws-t0-g0-weapon').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, 'workshop-weapons-optics.png') });
  await page.locator('#ws-base').selectOption('xp_bmp_k64');
  await page.locator('#ws-keep').check();
  const retained = await page.evaluate(() => {
    const t = window.__tf; t.G.thumbs.length = 0; t.advance(1 / 60);
    const geometry = n => (n.mesh?.count || 0) + n.children.reduce((a, c) => a + geometry(c), 0);
    return { imported: !!t.G.loadout.imported, turrets: t.G.loadout.turrets.length, generatedVertices: geometry(t.G.model.turrets.at(-1).node), barrelVertices: geometry(t.G.model.turrets.at(-1).guns[0].node) };
  });
  assert.equal(retained.imported, true); assert.equal(retained.turrets, 2); assert.ok(retained.generatedVertices > 0); assert.ok(retained.barrelVertices > 0);
  results.push({ retained });
  await page.screenshot({ path: path.join(out, 'workshop-desktop.png') });
  await page.setViewportSize({ width: 430, height: 820 });
  await page.evaluate(() => window.__tf.advance(1 / 60));
  const layout = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth, panel: document.getElementById('workshop').getBoundingClientRect().toJSON() }));
  assert.ok(layout.scroll <= layout.viewport, JSON.stringify(layout)); assert.ok(layout.panel.x >= 0 && layout.panel.right <= layout.viewport + 1);
  await page.screenshot({ path: path.join(out, 'workshop-mobile.png') });
  results.push({ layout });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('#ws-preset-bmpTwin').click();
  const missileFire = await page.evaluate(async () => {
    const t = window.__tf; await t.coreReady(); t.setMapChoice('range');
    t.setWorkshop(false); t.G.thumbs.length = 0; t.startBattle();
    const g = t.G.loadout.turrets[0].guns[0], ammo = () => g.ammo.reduce((n, a) => n + a.count, 0);
    const before = ammo(); const first = t.fireGun(0, 0); const readyAfterFirst = g.launcher.ready;
    t.advance(.3, [], false); const second = t.fireGun(0, 0); t.advance(1 / 60);
    return { first, second, before, after: ammo(), readyAfterFirst, ready: g.launcher.ready, loading: t.G.T[0].loading.state[0], guided: t.G.guided.length, visible: t.missiles().nodes.size };
  });
  assert.equal(missileFire.first, true); assert.equal(missileFire.second, true);
  assert.equal(missileFire.readyAfterFirst, 1); assert.equal(missileFire.ready, 0);
  assert.equal(missileFire.after, missileFire.before - 2); assert.equal(missileFire.loading, 'loading');
  assert.equal(missileFire.guided, 2); assert.equal(missileFire.visible, 2);
  results.push({ missileFire });
  await page.evaluate(() => { const t = window.__tf; t.toGarage(); t.G.thumbs.length = 0; t.setWorkshop(true); });
  await page.locator('#ws-preset-kda35').click();
  await page.evaluate(() => {
    const t = window.__tf; t.setWorkshop(false); t.G.thumbs.length = 0; t.startBattle();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit5' })); t.advance(1 / 60);
  });
  const fifthAmmo = await page.evaluate(() => ({ index: window.__tf.state().ammo.selected, slot: document.querySelectorAll('#ammo-bar .ammo-slot')[4].getAttribute('aria-checked') }));
  assert.equal(fifthAmmo.index, 4); assert.equal(fifthAmmo.slot, 'true'); results.push({ fifthAmmo });
  await page.evaluate(() => { const t = window.__tf; t.toGarage(); t.G.thumbs.length = 0; t.setWorkshop(true); });
  await page.locator('.ws-export > summary').click();
  const mixedBuild = { base: 'de_hetzer', keepStock: false, turrets: [{ loaders: 0, guns: [{ cal: 75, len: 48 }, { weapon: 'xp_kda35' }] }] };
  await page.locator('#ws-import').fill(JSON.stringify(mixedBuild)); await page.locator('#ws-import-btn').click();
  const mixedFire = await page.evaluate(() => {
    const t = window.__tf; t.setWorkshop(false); t.G.thumbs.length = 0; t.startBattle();
    const cannon = t.fireGun(0, 0), automatic = t.fireGun(0, 1); t.advance(.15, [], false);
    return { cannon, automatic, states: t.G.T[0].loading.state.slice() };
  });
  assert.equal(mixedFire.cannon, true); assert.equal(mixedFire.automatic, true);
  assert.deepEqual(mixedFire.states, ['loading', 'ready']); results.push({ mixedFire });
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, errors, renderer: 'Edge software WebGL; no hardware FPS claim' }, null, 2));
  console.log('PASS: workshop source weapons, optics, import recovery, source model retention and responsive controls');
} finally { await browser.close(); }

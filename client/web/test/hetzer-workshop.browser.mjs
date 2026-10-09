// Real workshop UI -> buildToBundle -> makeLoadout -> buildTank WebGL regression.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, '../dist/hetzer-workshop-shots');
fs.mkdirSync(out, { recursive: true });
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: process.env.TF_BROWSER || (fs.existsSync(edge) ? edge : undefined),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'] });
const errors = [], results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /shader|link:|framebuffer|WebGL/i.test(m.text())) errors.push(m.text()); });
  await page.goto(pathToFileURL(path.join(here, '../dist/tankforge-range.html')).href);
  await page.waitForFunction(() => window.__tf, null, { timeout: 120000 });
  await page.evaluate(() => {
    const t = window.__tf;
    t.pause(); t.setQuality('low');
    t.renderer.q = { ...t.renderer.q, dome: 256 }; t.renderer._buildDome(256);
    t.G.thumbs.length = 0; t.G.spinHold = 1000;
    document.getElementById('g-loading').hidden = true;
  });
  for (const id of ['de_hetzer', 'de_hetzer_flak', 'de_hetzer_mk103', 'de_hetzer_mk103_camo', 'de_hetzer_sdkfz1401']) {
    const state = await page.evaluate(id => {
      const t = window.__tf;
      t.select(id); t.G.thumbs.length = 0; t.advance(1 / 60);
      const gun = t.G.model.turrets[0].guns[0].node;
      const geometry = node => (['gun_mount', 'gun_model', 'barrel', 'barrel_model'].includes(node.name) ? node.mesh?.count || 0 : 0) + node.children.reduce((s, n) => s + geometry(n), 0);
      return { id: t.state().id, guns: t.state().gunCount, imported: t.G.model.imported,
        weaponVertices: geometry(gun) };
    }, id);
    assert.equal(state.id, id); assert.equal(state.guns, 1); assert.ok(state.weaponVertices > 0, JSON.stringify(state));
    assert.equal(state.imported, !['de_hetzer', 'de_hetzer_flak'].includes(id), 'source GLB fits retain their independent imported model');
    results.push(state);
  }
  await page.evaluate(() => {
    const t = window.__tf;
    t.select('de_hetzer'); t.setWorkshop(true);
  });
  for (const keepStock of [false, true]) {
    const state = await page.evaluate(keepStock => {
      const t = window.__tf;
      const before = [t.G.s.x, t.G.s.z];
      const build = { base: 'de_hetzer', keepStock, turrets: [{ x: 0, z: -0.05, lift: 0.15,
        facing: 0, arc: 360, ring: 1.2, loaders: 1, rack: 'ready', open: false, guns: [{ cal: 57, len: 50 }] }] };
      document.getElementById('ws-import').value = JSON.stringify(build);
      document.getElementById('ws-import-btn').click();
      t.G.thumbs.length = 0;
      t.G.cam.yaw = t.G.s.heading + Math.PI * 0.7; t.G.cam.pitch = -0.24;
      t.G.camOverride = { fov: 0.5, dist: 13, pivot: [t.G.s.x, 1.45, t.G.s.z] };
      t.advance(0.05);
      const files = t.exportBuild().files;
      const index = keepStock ? 1 : 0;
      const gun = t.G.loadout.turrets[index].guns[0];
      const m = t.G.model.turrets[index].guns[0].node.world;
      const pos = [0, 1, 2].map(k => m[12 + k] + m[8 + k] * gun.muzzleOffset);
      const line = t.gunLine(index);
      return { keepStock, id: t.state().id, guns: t.state().gunCount, problems: t.checkFolder(files),
        barrelVertices: t.G.model.turrets[index].guns[0].barrel.mesh?.count,
        base: t.G.build.base, trunnion: gun.trunnion, muzzleError: Math.hypot(...pos.map((v, k) => v - line.pos[k])),
        stockParts: t.G.loadout.visual.parts.filter(p => p.mount === 'gun').length,
        modules: files['modules.json'].filter(m => m.kind === 'gun_breech').map(m => m.id),
        poseShift: Math.hypot(t.G.s.x - before[0], t.G.s.z - before[1]) };
    }, keepStock);
    assert.equal(state.id, 'custom'); assert.equal(state.base, 'de_hetzer');
    assert.equal(state.guns, keepStock ? 2 : 1); assert.ok(state.barrelVertices > 0);
    assert.deepEqual(state.problems, []); assert.ok(state.muzzleError < 0.002, JSON.stringify(state));
    assert.ok(state.poseShift < 0.05, `workshop rebuild must retain its placed vehicle: ${state.poseShift} m shift`);
    assert.ok(state.modules.some(id => id.startsWith('breech_t')));
    if (!keepStock) assert.equal(state.stockParts, 0, 'original Saukopf and barrel are removed by the workshop');
    await page.screenshot({ path: path.join(out, keepStock ? 'keep-original-and-add-head.png' : 'replace-original-head.png') });
    results.push(state);
    await page.evaluate(() => {
      const t = window.__tf;
      t.G.cam.yaw = t.G.s.heading + Math.PI / 2;
      t.G.cam.pitch = -0.12;
      t.advance(1 / 60);
    });
    await page.screenshot({ path: path.join(out, keepStock ? 'keep-original-side.png' : 'replacement-side.png') });
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, errors, renderer: 'Edge software WebGL; no hardware-performance claim' }, null, 2));
  console.log('PASS: original family fits and both real Hetzer workshop paths, screenshots in', out);
} finally { await browser.close(); }

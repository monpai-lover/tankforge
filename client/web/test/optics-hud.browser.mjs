import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '../dist/optics-hud-shots');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'] });
const errors = [], results = [], rows = [];
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(here, '../dist/tankforge-range.html')).href);
    await page.waitForFunction(() => window.__tf, null, { timeout: 120000 });
    await page.evaluate(() => {
      const t = window.__tf;
      t.pause(); t.setQuality('low'); t.renderer.q = { ...t.renderer.q, dome: 256 }; t.renderer._buildDome(256);
      t.G.thumbs.length = 0; document.getElementById('g-loading').hidden = true;
      const draw = t.hud.drawSight.bind(t.hud);
      t.hud.drawSight = (radius, pxPerRad, o) => {
        draw(radius, pxPerRad, o);
        const win = t.G.statusWin, k = t.hud.overlay.width / t.hud.overlay.clientWidth;
        const statusAlpha = win ? t.hud.ctx.getImageData(Math.round(win.cx * k), Math.round(win.cy * k), 1, 1).data[3] : null;
        window.__opticSample = { radius, pxPerRad, edgeOpacity: o.edgeOpacity, magnification: o.magnification, name: o.name, statusAlpha };
      };
    });
    for (const id of ['de_hetzer', 'de_tiger_e', 'us_m4a3_75w', 'de_gepard', 'us_m901_itv', 'xp_bmp_k64_kornet']) {
      const count = await page.evaluate(id => {
        const t = window.__tf;
        t.toGarage(); t.select(id); t.G.thumbs.length = 0; t.startBattle(); t.pause();
        t.G.view = 'sight'; t.G.free = false; t.G.cam.yaw = t.G.s.heading; t.G.cam.pitch = 0;
        t.G.autoZero = false; t.G.zero = 100; t.advance(.2);
        return t.G.loadout.turrets[0].sight.levels.length;
      }, id);
      for (let zoom = 0; zoom < count; zoom++) {
        const s = await page.evaluate(zoom => {
          const t = window.__tf;
          t.G.zoomIdx = zoom; t.advance(.1);
          return { ...window.__opticSample, level: t.G.loadout.turrets[0].sight.levels[zoom],
            width: t.hud.overlay.width, height: t.hud.overlay.height, fovY: t.G.cam.fov };
        }, zoom);
        assert.ok(s.radius > 0 && s.radius <= Math.min(s.width, s.height) / 2);
        assert.equal(s.statusAlpha, 0, 'scope mask must keep the actual vehicle status camera visible');
        const focal = s.height / 2 / Math.tan(s.fovY / 2);
        assert.ok(Math.abs(focal - s.pxPerRad) < 1e-6);
        assert.ok(Math.abs(focal * Math.tan(s.level.fov_deg * Math.PI / 360) - s.radius) < 1e-6,
          'actual camera and overlay agree at the specified true-field edge');
        results.push({ id, zoom, dpr, ...s });
        if (dpr === 1) await page.screenshot({ path: path.join(out, `${id}-zoom-${zoom}.png`) });
      }
    }
    const row = await page.evaluate(() => {
      const t = window.__tf, info = { ...t.G.info }, samples = [];
      for (const [slip, sink] of [[0, 0], [.01, .06], [.029, .014], [.031, .016], [.5, .12], [0, 0]]) {
        t.hud.drive({ ...info, slipL: slip, slipR: 0, sink, rpmShown: 1000 }, 'road', 2600, 600, null);
        const e = document.getElementById('slip'), r = e.getBoundingClientRect();
        samples.push({ hidden: e.hidden, text: e.textContent, top: r.top, height: r.height, hard: e.dataset.hard });
      }
      return samples;
    });
    assert.ok(row.every(r => !r.hidden && r.height > 0));
    assert.ok(row.every(r => r.top === row[0].top && r.height === row[0].height), 'threshold changes do not move the driving HUD');
    assert.equal(row[0].text, '滑轉 0%　下陷 0 cm');
    assert.equal(row[1].text, '滑轉 1%　下陷 6 cm');
    assert.equal(row[4].hard, '1');
    assert.equal(row[5].hard, '0');
    rows.push({ dpr, samples: row });
    await page.evaluate(() => { const t = window.__tf; t.G.view = 'third'; t.advance(.1); });
    await page.screenshot({ path: path.join(out, `hud-stopped-dpr-${dpr}.png`) });
    await page.close();
  }
  const m70 = results.find(r => r.id === 'us_m4a3_75w' && r.zoom === 0 && r.dpr === 1);
  const m27 = results.find(r => r.id === 'us_m901_itv' && r.zoom === 0 && r.dpr === 1);
  assert.ok(m27.radius > m70.radius * 1.4, 'same 3x power shows the modern wide-field optic difference');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, rows, errors,
    note: 'software WebGL visual regression; aperture/vignette are presentation mappings, not measured eye-relief dimensions' }, null, 2));
  console.log('PASS: 24 real scope views, actual true-FOV projection and persistent slip/sink HUD across two DPRs');
} finally { await browser.close(); }

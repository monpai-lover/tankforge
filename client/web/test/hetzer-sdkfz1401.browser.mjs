// Focused real WebGL regression for the custom conversion; captures are QA artifacts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, '../dist/hetzer-sdkfz1401-shots');
fs.mkdirSync(out, { recursive: true });
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({
  executablePath: process.env.TF_BROWSER || (fs.existsSync(edge) ? edge : undefined),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && /shader|link:|framebuffer|WebGL/i.test(m.text())) errors.push(m.text());
  });
  await page.goto(pathToFileURL(path.join(here, '../dist/tankforge-range.html')).href);
  await page.waitForFunction(() => window.__tf, null, { timeout: 120000 });
  await page.evaluate(() => {
    const t = window.__tf;
    t.pause();
    t.setQuality('low');
    t.renderer.q = { ...t.renderer.q, dome: 256 };
    t.renderer._buildDome(256);
    t.G.thumbs.length = 0;
    t.select('de_hetzer_sdkfz1401');
    t.G.spinHold = 1000;
    t.advance(0.05);
    document.getElementById('g-loading').hidden = true;
  });
  const state = await page.evaluate(() => window.__tf.state());
  assert.equal(state.id, 'de_hetzer_sdkfz1401');
  assert.ok(state.triangles > 10000);
  assert.equal(state.gunCount, 1);
  assert.ok(state.mg.some(m => m.id === 'coax_mg42'));
  await page.screenshot({ path: path.join(out, 'garage.png') });
  for (const [name, yaw] of [['front', Math.PI], ['side', Math.PI / 2], ['rear', 0]]) {
    await page.evaluate(yaw => {
      const t = window.__tf;
      t.G.cam.yaw = yaw;
      t.G.cam.pitch = -0.12;
      t.G.camOverride = { fov: 0.5, dist: 13, pivot: [t.G.s.x, 1.8, t.G.s.z] };
      t.advance(1 / 60);
    }, yaw);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
  }
  await page.evaluate(() => {
    const t = window.__tf;
    t.G.T[0].guns[0].pitch = 70 * Math.PI / 180;
    t.G.aim.pitch = 70 * Math.PI / 180;
    t.G.cam.yaw = Math.PI / 2;
    t.advance(1 / 60);
  });
  await page.screenshot({ path: path.join(out, 'elevated.png') });
  assert.deepEqual(errors, [], 'no game or shader errors');
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ state, errors, renderer: 'software WebGL regression; no performance claim' }, null, 2));
  console.log('PASS: custom variant selected, model and weapons instantiated, WebGL captures saved to', out);
} finally {
  await browser.close();
}

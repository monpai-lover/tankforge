// Repeatable WebGL QA views of the original casemate Hetzer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const vehicleId = process.argv[3] || 'de_hetzer';
const out = process.argv[2] || path.join(here, '../dist/hetzer-original-shots/after');
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
  await page.evaluate(vehicleId => {
    const t = window.__tf;
    t.pause();
    t.setQuality('low');
    t.renderer.q = { ...t.renderer.q, dome: 256 };
    t.renderer._buildDome(256);
    t.G.thumbs.length = 0;
    t.select(vehicleId);
    t.G.spinHold = 1000;
    t.advance(0.05);
    document.getElementById('g-loading').hidden = true;
  }, vehicleId);
  const state = await page.evaluate(() => window.__tf.state());
  assert.equal(state.id, vehicleId);
  assert.equal(state.gunCount, 1);
  for (const [name, yaw, pitch, dist] of [
    ['side', Math.PI / 2, -0.08, 10],
    ['front-quarter', Math.PI * 0.72, -0.15, 10],
    ['front', Math.PI, -0.12, 10],
    ['rear', 0, -0.15, 10],
    ['rear-quarter', Math.PI * 0.22, -0.15, 10],
    ['above', Math.PI * 0.72, -0.5, 10],
    ['mantlet', Math.PI * 0.73, -0.12, 5.6],
  ]) {
    await page.evaluate(({ yaw, pitch, dist, name }) => {
      const t = window.__tf;
      t.G.cam.yaw = t.G.s.heading + yaw;
      t.G.cam.pitch = pitch;
      const pivot = name === 'mantlet'
        ? [t.G.s.x + Math.sin(t.G.s.heading) * 1.55, 1.48, t.G.s.z + Math.cos(t.G.s.heading) * 1.55]
        : [t.G.s.x, 1.2, t.G.s.z];
      t.G.camOverride = { fov: 0.5, dist, pivot };
      t.advance(1 / 60);
    }, { yaw, pitch, dist, name });
    await page.screenshot({ path: path.join(out, `${name}.png`) });
  }
  if (vehicleId === 'de_flakpz38t') {
    for (const [name, fold] of [['interior-raised', 0], ['interior-folded', 1]]) {
      await page.evaluate(fold => {
        const t = window.__tf;
        t.G.cam.yaw = t.G.s.heading + Math.PI * 0.23;
        t.G.cam.pitch = -0.5;
        t.G.camOverride = { fov: 0.5, dist: 7, pivot: [t.G.s.x, 1.7, t.G.s.z - 0.8] };
        t.fold(fold);
        t.advance(1 / 60);
      }, fold);
      await page.screenshot({ path: path.join(out, `${name}.png`) });
    }
  }
  assert.deepEqual(errors, [], 'no game or shader errors');
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ state, errors, renderer: 'software WebGL; no performance claim' }, null, 2));
  console.log(`PASS: ${vehicleId} selected, WebGL views saved to`, out);
} finally {
  await browser.close();
}

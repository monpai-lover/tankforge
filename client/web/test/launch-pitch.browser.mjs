// Real game W-key launch: chassis motion, suspension contacts and render/physics agreement.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, '../dist/launch-pitch-shots/after');
const verifyTakeUp = process.argv[3] !== 'baseline';
fs.mkdirSync(out, { recursive: true });
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: edge,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [], results = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(here, '../dist/tankforge-range.html')).href);
  await page.waitForFunction(() => window.__tf, null, { timeout: 120000 });
  await page.evaluate(() => {
    const t = window.__tf;
    t.pause(); t.setQuality('low');
    t.renderer.q = { ...t.renderer.q, dome: 256 }; t.renderer._buildDome(256);
    t.G.thumbs.length = 0;
  });
  for (const id of ['de_flakpz38t', 'de_hetzer', 'de_tiger_e', 'us_m8', 'de_sdkfz234_2', 'xp_bmp_k64']) {
    const result = await page.evaluate(id => {
      const t = window.__tf, G = t.G;
      t.toGarage(); t.select(id); G.thumbs.length = 0; t.startBattle();
      t.place(0, 0, 0); t.advance(2.5, [], false);
      const rest = t.state(), samples = [];
      for (let i = 0; i < 120; i++) {
        t.advance(1 / 60, ['fwd'], false);
        samples.push({ t: (i + 1) / 60, pitch: G.ss.pitch, ax: G.info.ax, u: G.s.u,
          grounded: G.veh.t.ss.grounded.filter(Boolean).length, wheels: G.veh.t.ss.grounded.length,
          force: G.info.forceL + G.info.forceR, obstacles: G.veh.t.obstacleContacts.length });
      }
      const peak = samples.reduce((a, b) => b.pitch > a.pitch ? b : a);
      t.place(0, 0, 0); t.advance(2.5, [], false);
      t.setFreeLook(true); G.cam.yaw = Math.PI / 2; G.cam.pitch = -0.12;
      G.cam.dist = G.cam.distTarget = 11;
      t.advance(peak.t, ['fwd']);
      const body = G.veh.body, rendered = G.model.body.world;
      const renderPitch = Math.asin(rendered[9]);
      return { id, restPitch: rest.body.pitch, peak, samples, renderPitch,
        poseError: Math.max(...body.ez.map((v, k) => Math.abs(v - rendered[8 + k]))),
        mass: G.veh.tm.mass };
    }, id);
    assert.ok(result.poseError < 1e-5, `${id}: visible chassis must match physics axes`);
    if (verifyTakeUp) {
      assert.ok(Math.abs(result.samples[0].ax) < 1, `${id}: W-key start still applies an immediate peak force`);
      if (id === 'de_flakpz38t') assert.ok(result.peak.pitch * 180 / Math.PI < 3.5, 'light-tank launch pitch must be reduced');
    }
    await page.screenshot({ path: path.join(out, `${id}.png`) });
    results.push(result);
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify(results.map(r => ({ id: r.id, peakDeg: r.peak.pitch * 180 / Math.PI,
    t: r.peak.t, grounded: `${r.peak.grounded}/${r.peak.wheels}`, maxAx: Math.max(...r.samples.map(s => s.ax)), poseError: r.poseError })), null, 2));
} finally { await browser.close(); }

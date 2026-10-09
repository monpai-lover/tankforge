// Real WebGL regression: the live vehicle fits the status disc at every UI scale and DPR.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, '../dist/hud-status-shots');
fs.mkdirSync(out, { recursive: true });
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({
  executablePath: process.env.TF_BROWSER || (fs.existsSync(edge) ? edge : undefined),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'],
});
const results = [];
const errors = [];
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: dpr === 1 ? { width: 1280, height: 800 } : { width: 1024, height: 768 }, deviceScaleFactor: dpr });
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
      // Measure every actual mesh vertex using the camera submitted to the real renderer.
      const renderInset = t.renderer.renderInset;
      t.renderer.renderInset = function(nodes, cam, rect, opts) {
        if (opts.disc) {
          const transform = (m, p) => [
            m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
            m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
            m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
          ];
          const vp = cam.viewProj;
          let maxRadius = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const node of nodes) {
            const mesh = node.mesh;
            const src = mesh?._src;
            if (!src?.data || node.visible === false) continue;
            const instances = mesh.instanced ? mesh.instances : 1;
            for (let instance = 0; instance < instances; instance++) {
              const im = mesh.instanced ? src.matrices.subarray(instance * 16, instance * 16 + 16) : null;
              for (let i = 0; i < src.data.length; i += 13) {
                let p = [src.data[i], src.data[i + 1], src.data[i + 2]];
                if (im) p = transform(im, p);
                p = transform(node.world, p);
                const q = transform(vp, p);
                const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
                const x = q[0] / w, y = q[1] / w;
                maxRadius = Math.max(maxRadius, Math.hypot(x, y));
                minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                minY = Math.min(minY, y); maxY = Math.max(maxY, y);
              }
            }
          }
          window.__statusSample = { maxRadius, minX, maxX, minY, maxY, rect: rect.slice() };
        }
        return renderInset.call(this, nodes, cam, rect, opts);
      };
    });
    for (const id of ['de_tiger_e', 'de_hetzer', 'de_hetzer_sdkfz1401']) {
      await page.evaluate(id => {
        const t = window.__tf;
        t.toGarage(); t.select(id); t.startBattle();
        t.advance(1 / 60); t.advance(1 / 60);
      }, id);
      for (const scale of [1, 0.8, 0.6]) {
        const result = await page.evaluate(scale => {
          const t = window.__tf;
          document.getElementById('vs').style.setProperty('--vs-scale', scale);
          t.advance(1 / 60); t.advance(1 / 60);
          const c = document.getElementById('status-pic');
          const b = c.getBoundingClientRect();
          const k = t.renderer.canvas.width / t.renderer.canvas.clientWidth;
          return {
            id: t.G.id, scale, dpr: window.devicePixelRatio, panelWidth: b.width,
            windowRadius: t.G.statusWin.r, rendererScale: k, ...window.__statusSample,
          };
        }, scale);
        results.push(result);
        assert.equal(result.id, id, 'the requested vehicle was selected');
        await page.locator('#vs').screenshot({ path: path.join(out, `${id}-${scale}-dpr${dpr}.png`) });
      }
      // The status picture is live: a turned turret must not push the gun through its rim.
      for (const yaw of [Math.PI / 2, Math.PI]) {
        const result = await page.evaluate(yaw => {
          const t = window.__tf;
          t.G.T[0].yaw = yaw;
          t.G.aim.yaw = t.G.s.heading + yaw;
          t.advance(1 / 60);
          const b = document.getElementById('status-pic').getBoundingClientRect();
          return {
            id: t.G.id, scale: 0.6, yaw, dpr: window.devicePixelRatio, panelWidth: b.width,
            windowRadius: t.G.statusWin.r,
            rendererScale: t.renderer.canvas.width / t.renderer.canvas.clientWidth,
            ...window.__statusSample,
          };
        }, yaw);
        results.push(result);
      }
    }
    for (const panelSize of [180, 320]) {
      const result = await page.evaluate(panelSize => {
        const t = window.__tf;
        const c = document.getElementById('status-pic');
        c.style.width = c.style.height = `${panelSize}px`;
        t.G.T[0].yaw = 0;
        t.G.aim.yaw = t.G.s.heading;
        t.advance(1 / 60); t.advance(1 / 60);
        const b = c.getBoundingClientRect();
        return {
          id: t.G.id, panelSize, scale: 0.6, dpr: window.devicePixelRatio, panelWidth: b.width,
          windowRadius: t.G.statusWin.r,
          rendererScale: t.renderer.canvas.width / t.renderer.canvas.clientWidth,
          ...window.__statusSample,
        };
      }, panelSize);
      results.push(result);
    }
    const touchResult = await page.evaluate(() => {
      const t = window.__tf;
      const c = document.getElementById('status-pic');
      c.style.width = c.style.height = '';
      document.body.dataset.touch = '1';
      // A larger text readout must not set the model's camera scale.
      document.getElementById('crew-count').style.fontSize = '30px';
      t.advance(1 / 60); t.advance(1 / 60);
      const b = c.getBoundingClientRect();
      return {
        id: t.G.id, touch: true, scale: 0.6, dpr: window.devicePixelRatio, panelWidth: b.width,
        windowRadius: t.G.statusWin.r,
        rendererScale: t.renderer.canvas.width / t.renderer.canvas.clientWidth,
        ...window.__statusSample,
      };
    });
    results.push(touchResult);
    await page.locator('#vs').screenshot({ path: path.join(out, `touch-dpr${dpr}.png`) });
    await page.close();
  }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, errors }, null, 2));
  assert.deepEqual(errors, [], 'no game errors');
  for (const r of results) {
    assert.ok(Math.abs(r.rect[2] / r.rendererScale - r.windowRadius * 2) < 0.01, 'renderer viewport follows the actual CSS window');
    assert.ok(Math.abs(r.windowRadius / r.panelWidth - 0.33) < 0.0001, 'window follows the scaled panel');
    assert.ok(r.maxRadius <= 0.9, `${r.id} scale=${r.scale} dpr=${r.dpr}: model radius ${r.maxRadius.toFixed(3)} leaves at least 10% radial margin`);
    assert.ok(Math.abs(r.panelWidth - (r.panelSize || 260) * r.scale) < 0.01, 'the panel uses its requested size and scale');
  }
  const ordinary = results.filter(r => r.yaw == null && !r.panelSize && !r.touch);
  for (const r of ordinary) {
    const base = ordinary.find(b => b.id === r.id && b.dpr === r.dpr && b.scale === 1);
    assert.ok(Math.abs(r.maxRadius - base.maxRadius) < 0.01, 'model and window shrink in the same proportion');
  }
  console.log(`PASS: ${results.length} status views across UI scales, panel sizes, DPR, touch, and turret rotations`);
} finally {
  await browser.close();
}

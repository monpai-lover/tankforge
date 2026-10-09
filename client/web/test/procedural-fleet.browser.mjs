// A repeatable view ledger for every non-imported model, using the real game renderer.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { loadData } from '../tools/load-data.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, '../dist/verification/procedural-fleet');
const requested = process.argv[3]?.split(',');
const data = loadData(), all = data.order.filter(id => !data.vehicles[id].model);
const ids = requested || all;
assert.ok(ids.every(id => all.includes(id)), 'capture scope excludes imported vehicle models');
fs.mkdirSync(out, { recursive: true });
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: process.env.TF_BROWSER || edge,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'] });
const errors = [], results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 720 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /shader|WebGL|framebuffer/i.test(m.text())) errors.push(m.text()); });
  await page.goto(pathToFileURL(path.join(here, '../dist/tankforge-range.html')).href + '?lang=zh');
  await page.waitForFunction(() => window.__tf, null, { timeout: 120000 });
  await page.addStyleTag({ content: '#garage,#battle-ui,#hud,#overlay,#toast,#workshop{display:none!important} #fleet-title{position:fixed;top:10px;left:14px;color:#fff;background:#182015dd;padding:7px 11px;font:15px sans-serif;z-index:1000;pointer-events:none}' });
  await page.evaluate(() => {
    const t = window.__tf; t.pause(); t.setQuality('low');
    t.renderer.q = { ...t.renderer.q, dome: 256 }; t.renderer._buildDome(256);
    t.G.thumbs.length = 0; t.G.spinHold = 1e6; document.getElementById('g-loading').hidden = true;
    const title = document.createElement('div'); title.id = 'fleet-title'; document.body.append(title);
    window.dispatchEvent(new Event('resize'));
  });
  const views = [['front-left', Math.PI * .72, -.24], ['left', Math.PI / 2, -.05], ['front', Math.PI, -.09], ['rear', 0, -.09], ['top', Math.PI / 2, -1.4]];
  for (const id of ids) {
    const state = await page.evaluate(id => {
      const t = window.__tf; t.select(id); t.G.thumbs.length = 0; t.advance(1, [], false);
      return { id: t.state().id, imported: t.G.model.imported, triangles: t.G.model.triangles, height: t.G.model.height, gunLine: t.gunLine(), dims: t.G.dims };
    }, id);
    assert.equal(state.id, id); assert.equal(state.imported, false); assert.ok(state.triangles > 0);
    const files = [];
    for (const [name, yaw, pitch] of views) {
      await page.evaluate(({ id, name, yaw, pitch }) => {
        const t = window.__tf, G = t.G;
        const mid = (G.dims.front + G.dims.rear) / 2;
        const length = G.dims.front - G.dims.rear;
        const extent = Math.max(length, G.dims.width * 1.5, G.model.height * 2);
        const fov = .42, dist = extent / (2 * Math.tan(fov / 2) * (1024 / 720)) * 1.3;
        G.camOverride = { fov, dist, pivot: [G.s.x + Math.sin(G.s.heading) * mid, G.model.height * .5, G.s.z + Math.cos(G.s.heading) * mid] };
        G.cam.yaw = G.s.heading + yaw; G.cam.pitch = pitch; G.cam.shake = G.cam.kick = 0;
        document.getElementById('fleet-title').textContent = `${id} · ${name}`;
        t.advance(1 / 60);
      }, { id, name, yaw, pitch });
      const file = `${id}-${name}.png`;
      await page.screenshot({ path: path.join(out, file) }); files.push(file);
    }
    results.push({ ...state, files }); console.log('Captured', id, files.length, 'views');
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, errors, excluded: data.order.filter(id => data.vehicles[id].model), renderer: 'Edge software WebGL; no hardware FPS claim' }, null, 2));
  console.log(`PASS: ${ids.length} procedural vehicles, ${ids.length * views.length} views`);
} finally { await browser.close(); }

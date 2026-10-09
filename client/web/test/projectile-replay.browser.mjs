// Real Edge/WebGL replay regression using authoritative WASM combat reports and an actual range shot.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { loadData } from '../tools/load-data.mjs';
import { loadCoreSync } from '../src/design/core.js';
import { Combat, arr3 } from '../src/game/combat.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, '../dist/projectile-replay-shots');
fs.mkdirSync(out, { recursive: true });
const data = loadData();
const core = loadCoreSync(fs.readFileSync(path.join(here, '../assets/tg_design.wasm')), { materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains) });
const combat = new Combat(core);
function report(id, shellId, origin, dir) {
  const bundle = data.vehicles[id];
  const shell = data.projectiles[shellId];
  const shot = { shell, origin, dir, speed_ms: shell.muzzle_velocity_ms, distance_m: 100, seed: 3, turret_yaw: 0 };
  const rep = combat.shoot(id, combat.fresh(id, bundle).state, shot);
  rep.shot = shot;
  return { id, shell, rep, roles: bundle.crew.map(c => c.role), armor: bundle.armor };
}
const gunner = data.vehicles.us_m4a3_75w.crew.find(c => c.role === 'gunner');
const side = [40, gunner.pos.y, gunner.pos.z];
const cases = [
  { name: 'penetrated', ...report('us_m4a3_75w', 'apcbc_88_l56', side, [-1, 0, 0]) },
  { name: 'stopped', ...report('de_tiger_e', 'ap_37_m74', [.2, 1.1, 40], [0, 0, -1]) },
  { name: 'heat', ...report('us_m4a3_75w', 'heat_90_m348', side, [-1, 0, 0]) },
];
const plate = data.vehicles.de_tiger_e.armor.find(p => p.normal.x > .9 && p.zone === 'hull_side');
const angle = 75 * Math.PI / 180;
const reflectedInput = [-Math.cos(angle), 0, -Math.sin(angle)];
cases.push({ name: 'ricochet', ...report('de_tiger_e', 'apcbc_88_l56', arr3(plate.center).map((x, i) => x - reflectedInput[i] * 40), reflectedInput) });
for (const c of cases) assert.equal(c.rep.outcome, c.name === 'heat' ? 'penetrated' : c.name, `real ${c.name} fixture`);

const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: process.env.TF_BROWSER || (fs.existsSync(edge) ? edge : undefined), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'] });
const errors = [];
const warnings = [];
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'warning' && /GPU stall due to ReadPixels/.test(m.text())) { warnings.push(m.text()); return; }
    if (/inset GL error|shader|link:|framebuffer|WebGL/i.test(m.text()) && (m.type() === 'error' || m.type() === 'warning')) errors.push(m.text());
  });
  await page.goto(pathToFileURL(path.join(here, '../dist/tankforge-range.html')).href);
  await page.waitForFunction(() => window.__tf?.hitcamController && window.__tf.G.combat, null, { timeout: 120000 });
  await page.evaluate(() => {
    const t = window.__tf;
    t.pause(); t.setQuality('low');
    t.renderer.q = { ...t.renderer.q, dome: 256 }; t.renderer._buildDome(256);
    t.G.thumbs.length = 0;
    document.getElementById('g-loading').hidden = true;
    t.renderer.debugGL = true;
  });

  for (const c of cases) {
    await page.evaluate(c => {
      const t = window.__tf;
      t.toGarage(); t.select(c.id); t.setXray(true); t.setXray(false);
      t.G.thumbs.length = 0;
      t.startBattle(); if (t.G.enemies) t.G.enemies.length = 0;
      t.advance(.05, [], false);
      t.hitcamController.show({ model: t.G.model, body: t.G.veh.body, armor: c.armor, name: t.G.loadout.name, crewRoles: c.roles, length: t.G.dims.front - t.G.dims.rear, interior: () => t.G.interior }, c.rep, c.shell, 100);
    }, c);
    const stages = c.name === 'ricochet'
      ? [['approach', .45], ['impact', 1.1], ['reflected-half', 2.1], ['hold', 3.4]]
      : [['approach', .45], ['impact', 1.1], ['travel-half', c.name === 'stopped' ? 2.1 : 2.286], ['hold', c.name === 'stopped' ? 3.4 : 4.3]];
    for (const [name, time] of stages) {
      const state = await page.evaluate(time => {
        const t = window.__tf, h = t.hitcamController;
        h.cur.t = time - 1 / 60;
        t.advance(1 / 60);
        const n = h.projectile.shell, cam = h.cur.cam, m = n.world;
        const x = m[12], y = m[13], z = m[14], vp = cam.viewProj;
        const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
        const ndc = [(vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w, (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w];
        const bounds = [Infinity, Infinity, -Infinity, -Infinity];
        const vertices = n.mesh._src.data;
        for (let i = 0; i < vertices.length; i += 13) {
          const a = vertices[i], b = vertices[i + 1], c = vertices[i + 2];
          const px = m[0] * a + m[4] * b + m[8] * c + x, py = m[1] * a + m[5] * b + m[9] * c + y, pz = m[2] * a + m[6] * b + m[10] * c + z;
          const w = vp[3] * px + vp[7] * py + vp[11] * pz + vp[15];
          const nx = (vp[0] * px + vp[4] * py + vp[8] * pz + vp[12]) / w, ny = (vp[1] * px + vp[5] * py + vp[9] * pz + vp[13]) / w;
          bounds[0] = Math.min(bounds[0], nx); bounds[1] = Math.min(bounds[1], ny); bounds[2] = Math.max(bounds[2], nx); bounds[3] = Math.max(bounds[3], ny);
        }
        return { phase: h.stage().name, shellPos: h.cur.motion.shellPos, head: h.cur.motion.pos, progress: h.cur.motion.progress, jet: h.projectile.jet.visible, ndc, bounds, meshes: t.renderer._live.size, stage: document.getElementById('hitcam').dataset.stage, nodesRestored: h.cur.target.model.shellNodes.every(n => n.kind !== 10) };
      }, time);
      assert.ok(state.ndc.every(x => Math.abs(x) < .98), `${c.name} ${name}: projectile is in the picture ${state.ndc}`);
      assert.ok(state.bounds.every(x => Math.abs(x) < .98), `${c.name} ${name}: the complete shell must fit ${state.bounds}`);
      assert.equal(state.nodesRestored, true);
      assert.equal(state.stage, state.phase);
      if (c.name === 'heat' && name === 'travel-half') {
        assert.equal(state.jet, true);
        assert.deepEqual(state.shellPos, arr3(c.rep.impact));
        assert.ok(Math.hypot(...state.head.map((x, i) => x - state.shellPos[i])) > .05);
      }
      if (c.name === 'stopped' && name === 'hold') assert.deepEqual(state.shellPos, arr3(c.rep.path.at(-1)));
      if (c.name === 'penetrated' && name === 'hold') assert.deepEqual(state.shellPos, arr3(c.rep.path.at(-1)));
      await page.locator('#hitcam').screenshot({ path: path.join(out, `${c.name}-${name}.png`) });
      results.push({ mode: 'battle', outcome: c.name, name, ...state });
    }
    // The sight's full-screen mask must leave the replay visible, including the 3D shell.
    await page.evaluate(() => { const t = window.__tf; t.toggleSight(); t.hitcamController.cur.t = 2.1; t.advance(1 / 60); });
    await page.screenshot({ path: path.join(out, `${c.name}-sight.png`) });
    const resources = await page.evaluate(() => {
      const t = window.__tf, h = t.hitcamController, c = h.cur;
      const before = t.renderer._live.size, shell = h.projectile.shell.mesh, jet = h.projectile.jet.mesh;
      for (let i = 0; i < 12; i++) { h.show(c.target, c.rep, c.shell, c.dist); h.cur.t = 2.1; t.advance(1 / 60); }
      return { before, after: t.renderer._live.size, same: shell === h.projectile.shell.mesh && jet === h.projectile.jet.mesh };
    });
    assert.equal(resources.before, resources.after, 'repeated reports must not allocate GPU meshes');
    assert.equal(resources.same, true);
  }

  // Use the garage's real analysis panel and click its surface: no synthetic UI-only report.
  await page.evaluate(() => {
    const t = window.__tf;
    t.toGarage(); t.select('us_m4a3_75w'); t.G.thumbs.length = 0;
    t.G.cam.yaw = t.G.s.heading + Math.PI / 2; t.G.cam.pitch = -.15; t.G.spinHold = 1000;
    t.advance(.05);
    document.getElementById('prot-btn').click();
  });
  // The body center is visible in the garage; choose a plate from the renderer's surface ray.
  await page.mouse.click(620, 435);
  await page.evaluate(() => { const t = window.__tf; if (t.hitcamController.active) t.hitcamController.cur.t = 2.1; t.advance(1 / 60); });
  const analysis = await page.evaluate(() => ({ active: window.__tf.hitcamController.active, text: document.getElementById('prot-info').textContent,
    rootWidth: document.getElementById('hitcam').getBoundingClientRect().width, rootDisplay: getComputedStyle(document.getElementById('hitcam')).display,
    overlayVisibility: getComputedStyle(document.getElementById('overlay')).visibility, title: document.querySelector('.hc-title').textContent }));
  assert.equal(analysis.active, true, JSON.stringify(analysis));
  assert.ok(analysis.rootWidth >= 200 && analysis.rootDisplay !== 'none', 'analysis replay title is outside the hidden battle HUD');
  assert.equal(analysis.overlayVisibility, 'visible', 'analysis trajectory overlay stays visible in the garage');
  assert.ok(analysis.title.length);
  await page.screenshot({ path: path.join(out, 'garage-analysis.png') });

  // Enter the real design range, fire, resolve with the design WASM core, then use its replay callback.
  await page.evaluate(() => { const t = window.__tf; t.toGarage(); t.openBureau(); });
  await page.waitForFunction(() => window.__tf.bureau.report?.battle_ready, null, { timeout: 30000 });
  await page.evaluate(() => {
    const t = window.__tf; t.bureau.testFire();
    const shell = document.getElementById('tr-shell');
    shell.value = 'apcbc_88_l56'; shell.dispatchEvent(new Event('change', { bubbles: true }));
    t.testRange.fire();
  });
  for (let i = 0; i < 60; i++) {
    const hit = await page.evaluate(() => { const t = window.__tf; t.advance(.05, [], false); return !!t.testRange.last; });
    if (hit) break;
  }
  const range = await page.evaluate(() => {
    const t = window.__tf;
    if (!t.testRange.last) throw new Error('the actual design-range shot did not hit');
    t.testRange.startReplay(); t.hitcamController.cur.t = 2.1; t.advance(1 / 60);
    return { last: !!t.testRange.last, outcome: t.testRange.last?.resp.event.penetration_result, phase: t.hitcamController.stage().name, bursts: t.hitcamController.cur.rep.bursts.length, shot: t.hitcamController.cur.rep.shot, path: t.hitcamController.cur.rep.path, fragments: t.hitcamController.cur.rep.fragments.filter(f => f.kind === 'shell'),
      rootWidth: document.getElementById('hitcam').getBoundingClientRect().width, rootDisplay: getComputedStyle(document.getElementById('hitcam')).display,
      overlayVisibility: getComputedStyle(document.getElementById('overlay')).visibility, title: document.querySelector('.hc-title').textContent };
  });
  assert.equal(range.last, true);
  assert.equal(range.bursts, 0);
  assert.ok(range.shot?.dir && range.path.length);
  assert.ok(range.rootWidth >= 200 && range.rootDisplay !== 'none', 'range replay title is outside the hidden battle HUD');
  assert.equal(range.overlayVisibility, 'visible');
  assert.ok(range.title.length);
  await page.screenshot({ path: path.join(out, 'range-replay.png') });
  assert.deepEqual(errors, [], 'no game, shader or inset WebGL errors');
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, analysis, range, errors, warnings, renderer: 'Edge software WebGL; no performance claim' }, null, 2));
  console.log('PASS: real combat flight/penetration/stop/ricochet/HEAT, sight replay, protection click and range replay; shared GPU meshes');
} finally { await browser.close(); }

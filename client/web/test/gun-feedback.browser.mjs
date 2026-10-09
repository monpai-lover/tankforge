// Focused real WebGL fire-path regression; particle tests cover the geometry and lifetime budget.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, '../dist/gun-feedback-shots');
fs.mkdirSync(out, { recursive: true });
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({
  executablePath: process.env.TF_BROWSER || (fs.existsSync(edge) ? edge : undefined),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'],
});
const errors = [];
const results = [];
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
    document.getElementById('g-loading').hidden = true;
  });
  for (const id of ['de_hetzer_sdkfz1401', 'de_hetzer_mk103', 'xp_kda35']) {
    const setup = await page.evaluate(id => {
      const t = window.__tf;
      t.toGarage();
      t.select(id);
      t.G.spinHold = 1000;
      t.G.cam.yaw = t.G.s.heading + Math.PI + 0.55;
      t.G.cam.pitch = -0.12;
      t.G.camOverride = { fov: 0.45, dist: 10, pivot: [t.G.s.x, 2, t.G.s.z + 1.2] };
      t.advance(0.05, [], false);
      t.fx.particles.length = 0;
      const def = t.G.loadout.turrets[0].guns[0].def;
      return { caliber: def.caliber_mm, stroke: def.recoil_mm / 1000, interval: 60 / def.autocannon.rate_rpm };
    }, id);
    const rounds = [];
    for (let round = 0; round < 3; round++) {
      const shot = await page.evaluate(() => {
        const t = window.__tf;
        const gs = t.G.T[0].guns[0];
        const before = t.fx.particles.length;
        const fired = t.fireGun(0, 0);
        const started = gs.recoilT;
        const particles = t.fx.particles.slice(before).map(p => ({ additive: p.additive, life: p.life, vel: p.vel }));
        t.advance(1 / 60);
        return { fired, started, particles, recoil: gs.recoil, barrelZ: t.G.model.turrets[0].guns[0].barrel.pos[2] };
      });
      assert.equal(shot.fired, true, `${id} round ${round + 1} must fire`);
      assert.equal(shot.started, 0, 'every shot must restart the travel');
      assert.ok(shot.recoil > 0 && shot.recoil <= setup.stroke, 'a real data-defined barrel stroke');
      assert.equal(shot.barrelZ, -shot.recoil, 'the visible barrel follows the recoil');
      assert.equal(shot.particles.filter(p => p.additive && Math.hypot(...p.vel) > 0).length, 4, 'both brake ports flash');
      assert.ok(shot.particles.length <= 10 && shot.particles.every(p => p.life <= 0.28), 'bounded brief blast');
      if (round === 0) await page.screenshot({ path: path.join(out, `${id}-firing.png`) });
      const returned = await page.evaluate(interval => {
        const t = window.__tf;
        t.advance(interval - 1 / 60);
        return { recoil: t.G.T[0].guns[0].recoil, t: t.G.T[0].guns[0].recoilT, loading: t.G.T[0].loading.state[0] };
      }, setup.interval);
      assert.equal(returned.recoil, 0, 'return before the next round');
      assert.equal(returned.t, -1);
      assert.equal(returned.loading, 'ready', 'test uses the real cyclic loading');
      if (round === 0) await page.screenshot({ path: path.join(out, `${id}-smoke-returned.png`) });
      rounds.push({ shot, returned });
    }
    results.push({ id, setup, rounds });
  }
  const mg = await page.evaluate(() => {
    const t = window.__tf;
    t.toGarage();
    t.select('xp_bmp_k64');
    t.advance(0.05, [], false);
    t.fx.particles.length = 0;
    t.fireGun(0, 0);
    return { caliber: t.G.loadout.turrets[0].guns[0].def.caliber_mm, flashes: t.fx.particles.filter(p => p.additive).length, particles: t.fx.particles.length };
  });
  assert.equal(mg.caliber, 14.5);
  assert.equal(mg.flashes, 1, 'automatic heavy MG must keep its ordinary flash');
  assert.ok(mg.particles <= 2);
  const online = await page.evaluate(() => {
    const t = window.__tf;
    t.toGarage(); t.select('de_hetzer_sdkfz1401'); t.advance(.05, [], false);
    const saved = { mode: t.G.mode, online: t.G.online };
    t.G.mode = 'battle'; t.G.online = {};
    t.fx.particles.length = 0;
    t.net._receive({ t: 'fire', from: t.net.id, shell: t.G.loadout.turrets[0].guns[0].def.ammo[0],
      o: [0, 2.274, 2.008], d: [0, 0, 1] });
    const result = { jets: t.fx.particles.filter(p => p.additive && Math.hypot(...p.vel) > 0).length,
      maxLife: Math.max(...t.fx.particles.map(p => p.life)) };
    t.G.mode = saved.mode; t.G.online = saved.online;
    return result;
  });
  assert.equal(online.jets, 4, 'network fire uses the configured automatic gun brake ports');
  assert.ok(online.maxLife <= .28, 'network fire retains the short particle budget');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, mg, online, errors, renderer: 'software WebGL regression; no performance claim' }, null, 2));
  console.log('PASS: 20/30/35 mm fire on every real loading cycle, show side jets and return the barrel; 14.5 mm MG retains its flash');
} finally {
  await browser.close();
}

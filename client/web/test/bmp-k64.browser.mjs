// Real WebGL articulation regression for the shared BMP-K-64 chassis and three weapon fits.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, '../dist/bmp-k64-shots');
fs.mkdirSync(out, { recursive: true });
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({
  executablePath: process.env.TF_BROWSER || (fs.existsSync(edge) ? edge : undefined),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'],
});
const errors = [];
const reports = [];
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
  for (const id of ['xp_bmp_k64', 'xp_bmp_k64_atgm', 'xp_bmp_k64_kornet']) {
    await page.evaluate(id => {
      const t = window.__tf;
      t.toGarage();
      t.select(id);
      t.G.spinHold = 1000;
      t.G.aim.pitch = 0;
      t.G.T[0].guns[0].pitch = 0;
      t.G.cam.yaw = t.G.s.heading + Math.PI * .7;
      t.G.cam.pitch = -.4;
      t.G.camOverride = { fov: .5, dist: 10, pivot: [t.G.s.x, 1.45, t.G.s.z] };
      t.advance(.5);
    }, id);
    await page.screenshot({ path: path.join(out, `${id}-closed-hatches.png`) });
    const before = await page.evaluate(() => {
      const t = window.__tf;
      return {
        gun: Array.from(t.G.model.turrets[0].guns[0].node.world),
        fixed: Array.from(t.G.model.turrets[0].node.world),
        pitch: t.G.T[0].guns[0].pitch,
        wheelTriangles: t.G.model.wheels.map(w => t.G.loadout.imported.parts
          .filter(p => p.mount === 'road_wheel' && p.side === w.side && p.index === w.axle)
          .reduce((n, p) => n + p.triangles, 0)),
        hatches: t.G.loadout.imported.parts.filter(p => p.rest_pose?.startsWith('Hatch_')).map(p => ({ triangles: p.triangles, hi: p.hi })),
        cupolaHatch: t.G.loadout.imported.parts.filter(p => p.rest_pose === 'Cupola_Hatch').map(p => ({ triangles: p.triangles, hi: p.hi })),
      };
    });
    assert.ok(before.wheelTriangles.every(n => n === 13128));
    assert.equal(before.hatches.reduce((n, p) => n + p.triangles, 0), 3392);
    assert.ok(before.hatches.every(p => p.hi[1] < 2.02));
    if (id === 'xp_bmp_k64') {
      assert.equal(before.cupolaHatch.reduce((n, p) => n + p.triangles, 0), 1656);
      assert.ok(before.cupolaHatch.every(p => p.hi[1] < 2.18));
    }
    const elevation = await page.evaluate(() => {
      const t = window.__tf;
      t.G.aim.pitch = 18 * Math.PI / 180;
      t.G.T[0].guns[0].pitch = 18 * Math.PI / 180;
      t.G.cam.yaw = t.G.s.heading + Math.PI / 2;
      t.G.cam.pitch = -.12;
      t.G.camOverride = { fov: .5, dist: 9, pivot: [t.G.s.x, 1.6, t.G.s.z] };
      t.advance(1 / 60);
      return {
        gun: Array.from(t.G.model.turrets[0].guns[0].node.world),
        fixed: Array.from(t.G.model.turrets[0].node.world),
        pitch: t.G.T[0].guns[0].pitch,
        gunLine: t.gunLine(),
      };
    });
    assert.ok(Math.abs(elevation.pitch) > .2, `${id} gun receives actual elevated state`);
    assert.notDeepEqual(elevation.gun, before.gun, `${id} imported weapon really elevates in the WebGL scene`);
    // The fixed mount has no pitch of its own, even when its gun is elevated.
    assert.ok(await page.evaluate(() => window.__tf.G.model.turrets[0].node.pitch === 0));
    await page.screenshot({ path: path.join(out, `${id}-elevated.png`) });
    const drive = await page.evaluate(() => {
      const t = window.__tf;
      t.startBattle();
      t.pause();
      t.place(0, -10, 0);
      t.advance(.5);
      const spin0 = t.G.model.wheels.map(w => w.node.pitch);
      const world0 = t.G.model.wheels.map(w => w.node.children.map(n => Array.from(n.world)));
      t.advance(2.0, ['fwd', 'right']);
      return { spin0, world0, spin: t.G.model.wheels.map(w => w.node.pitch),
        steer: t.G.model.wheels.map(w => w.node.yaw),
        world: t.G.model.wheels.map(w => w.node.children.map(n => Array.from(n.world))), state: t.state() };
    });
    assert.ok(drive.spin.some((v, i) => Math.abs(v - drive.spin0[i]) > .05), `${id} wheels spin while actually driving`);
    assert.ok(drive.steer.some(v => Math.abs(v) > .05), `${id} front tyres steer while actually driving`);
    assert.notDeepEqual(drive.world, drive.world0, `${id} complete imported wheel meshes travel with their animated wheel nodes`);
    await page.evaluate(() => {
      const t = window.__tf;
      t.G.cam.yaw = t.G.s.heading + Math.PI * .65;
      t.G.cam.pitch = -.17;
      t.G.camOverride = { fov: .5, dist: 11, pivot: [t.G.s.x, 1.3, t.G.s.z] };
      t.advance(1 / 60);
    });
    await page.screenshot({ path: path.join(out, `${id}-driving.png`) });
    reports.push({ id, before, elevation, drive });
  }
  assert.deepEqual(errors, [], 'no game or shader errors');
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ reports, errors,
    renderer: 'Edge software WebGL activity regression; no performance claim' }, null, 2));
  console.log('PASS: three BMP variants retain closed hatches, actually elevate, drive and steer; saved', out);
} finally {
  await browser.close();
}

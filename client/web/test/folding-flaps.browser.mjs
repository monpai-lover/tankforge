// Real I-key movement, firing-arc and combat-armour regression for source panels.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, '../dist/folding-flaps-shots');
fs.mkdirSync(out, { recursive: true });
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: process.env.TF_BROWSER || (fs.existsSync(edge) ? edge : undefined),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'] });
const errors = [], reports = [];
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
    t.pause(); t.setQuality('low');
    t.renderer.q = { ...t.renderer.q, dome: 256 }; t.renderer._buildDome(256);
    t.G.thumbs.length = 0; document.getElementById('g-loading').hidden = true;
  });
  for (const id of ['su_att_m46', 'de_hetzer_mk103', 'de_hetzer_mk103_camo']) {
    await page.evaluate(id => {
      const t = window.__tf;
      t.toGarage(); t.select(id); t.G.spinHold = 1000;
      t.G.T[0].yaw = t.G.aim.yaw = 0;
      t.G.T[0].guns[0].pitch = t.G.aim.pitch = 20 * Math.PI / 180;
      t.G.cam.yaw = t.G.s.heading + Math.PI * .62; t.G.cam.pitch = -.28;
      t.G.camOverride = { fov: .5, dist: id === 'su_att_m46' ? 18 : 12, pivot: [t.G.s.x, 1.7, t.G.s.z + (id === 'su_att_m46' ? .8 : 0)] };
      t.advance(.2);
    }, id);
    const raised = await page.evaluate(() => {
      const t = window.__tf;
      return { hasFlaps: t.G.model.hasFlaps, pose: t.G.fold.pose,
        matrices: t.G.model.body.children.filter(n => n.name === 'imported_flap').map(n => Array.from(n.world)),
        limits: t.G.loadout.turrets[0].foldYawStages[0].limits,
        fullLimits: t.G.loadout.turrets[0].foldYawStages.at(-1).limits };
    });
    assert.equal(raised.hasFlaps, true);
    assert.equal(raised.pose, 0);
    assert.equal(raised.matrices.length, id === 'su_att_m46' ? 6 : 7, 'real high cab sides and rear boards share the I control');
    await page.screenshot({ path: path.join(out, `${id}-raised.png`) });
    await page.keyboard.press('i');
    assert.equal(await page.evaluate(() => window.__tf.G.fold.target), 1, 'real I-key requests folding');
    const moving = await page.evaluate(() => {
      const t = window.__tf;
      t.advance(.4);
      return { cur: t.G.fold.cur, pose: t.G.fold.pose,
        matrices: t.G.model.body.children.filter(n => n.name === 'imported_flap').map(n => Array.from(n.world)) };
    });
    assert.ok(moving.pose > 0 && moving.pose < 1, `${id} animates through actual intermediate hinge poses`);
    assert.notDeepEqual(moving.matrices, raised.matrices);
    await page.screenshot({ path: path.join(out, `${id}-moving.png`) });
    const folded = await page.evaluate(() => {
      const t = window.__tf;
      t.advance(1.5);
      return { cur: t.G.fold.cur, pose: t.G.fold.pose,
        matrices: t.G.model.body.children.filter(n => n.name === 'imported_flap').map(n => Array.from(n.world)),
        tool: t.G.loadout.imported.parts.filter(p => p.source_node === 'front_stowed_tool').map(p => ({ lo: p.lo, hi: p.hi, triangles: p.triangles })) };
    });
    assert.equal(folded.cur, 1, `${id} finishes the folding movement`);
    assert.equal(folded.pose, 1);
    assert.notDeepEqual(folded.matrices, raised.matrices);
    assert.ok(raised.fullLimits[1] - raised.fullLimits[0] > raised.limits[1] - raised.limits[0], 'lowered panels unlock a larger real traverse arc');
    await page.screenshot({ path: path.join(out, `${id}-folded.png`) });
    if (id === 'su_att_m46') {
      await page.evaluate(() => {
        const t = window.__tf;
        document.getElementById('garage').style.visibility = 'hidden';
        document.getElementById('toast').style.visibility = 'hidden';
        t.G.cam.yaw = t.G.s.heading - Math.PI * .62;
        t.advance(1 / 60);
      });
      await page.screenshot({ path: path.join(out, `${id}-six-panels-folded-no-front-tool.png`) });
      await page.evaluate(() => {
        document.getElementById('garage').style.visibility = '';
        document.getElementById('toast').style.visibility = '';
      });
    }
    // Closing with the gun laid outside the raised arc must pause before it
    // reaches a conflicting stage, then continue after the gun is returned.
    await page.evaluate(id => {
      const t = window.__tf, yaw = (id === 'su_att_m46' ? 70 : 170) * Math.PI / 180;
      t.startBattle(); t.pause();
      t.G.T[0].yaw = t.G.aim.yaw = yaw;
      t.G.T[0].guns[0].pitch = t.G.aim.pitch = 20 * Math.PI / 180;
      t.G.camOverride = null; t.G.cam.yaw = t.G.s.heading + yaw; t.G.cam.pitch = -20 * Math.PI / 180;
      t.G.aimPoint = [t.G.s.x + Math.sin(t.G.s.heading + yaw) * 500, 190, t.G.s.z + Math.cos(t.G.s.heading + yaw) * 500];
      t.advance(1 / 60);
    }, id);
    await page.keyboard.press('i');
    const stopped = await page.evaluate(() => {
      const t = window.__tf; t.advance(1.5);
      return { cur: t.G.fold.cur, pose: t.G.fold.pose, waiting: t.G.fold.waiting, yaw: t.G.T[0].yaw };
    });
    assert.ok(stopped.cur > 0 && stopped.waiting, `${id} pauses closing before its panel would touch the gun`);
    const closed = await page.evaluate(() => {
      const t = window.__tf;
      t.G.T[0].yaw = t.G.aim.yaw = 0;
      t.G.T[0].guns[0].pitch = t.G.aim.pitch = 20 * Math.PI / 180;
      t.G.cam.yaw = t.G.s.heading; t.G.cam.pitch = -20 * Math.PI / 180;
      t.G.aimPoint = [t.G.s.x + Math.sin(t.G.s.heading) * 500, 190, t.G.s.z + Math.cos(t.G.s.heading) * 500];
      t.advance(1.5);
      return { cur: t.G.fold.cur, pose: t.G.fold.pose, waiting: t.G.fold.waiting };
    });
    assert.equal(closed.cur, 0);
    if (id === 'su_att_m46') {
      assert.equal(folded.tool.length, 0, 'the front shovel and former side rack are removed');
      await page.evaluate(() => {
        const t = window.__tf;
        t.G.cam.yaw = t.G.s.heading + Math.PI; t.G.cam.pitch = -.2;
        t.G.camOverride = { fov: .5, dist: 13, pivot: [t.G.s.x, 1.8, t.G.s.z + 1] };
        t.advance(1 / 60);
      });
      await page.screenshot({ path: path.join(out, `${id}-front-tool-cleared.png`) });
    }
    reports.push({ id, raised, moving, folded, stopped, closed });
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ reports, errors,
    renderer: 'Edge software WebGL regression; no performance claim' }, null, 2));
  console.log('PASS: real I-key panel animation, wider folded arcs, safe closing and no M46 front shovel; saved', out);
} finally {
  await browser.close();
}

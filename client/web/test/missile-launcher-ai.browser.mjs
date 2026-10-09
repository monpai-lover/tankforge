// Stage real Enemy, VehicleSim, model and loadout instances; no production test hook is needed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, '../dist/missile-launcher-ai');
fs.mkdirSync(out, { recursive: true });
const fixture = buildSync({ stdin: { contents: `
  import { Enemy } from '../src/game/enemies.js';
  import { makeLoadout, generatedTurretParts } from '../src/game/loadout.js';
  import { buildTank } from '../src/gfx/tankmodel.js';
  window.stageLauncherEnemy = (aux = false) => {
    const t = window.__tf, original = t.G.loadout;
    const projectiles = Object.fromEntries(original.turrets.flatMap(t => t.guns.flatMap(g => g.ammo.map(a => [a.shell.id, a.shell]))));
    const weapons = structuredClone(original.weapons), visual = structuredClone(original.visual);
    if (aux) {
      const launcher = structuredClone(weapons.main_gun);
      delete weapons.main_gun.missile; delete weapons.main_gun.launcher; delete weapons.main_gun.guided;
      weapons.extra_turrets = [{ id: 'aux-launcher', position_m: original.turrets[0].pivot, ring_diameter_m: 0.7, size_m: [1.3, 1.1, 1], traverse_deg_s: 25, guns: [{ gun: launcher, mount_m: weapons.mount_m, muzzle_offset_m: weapons.muzzle_offset_m }] }];
      for (const p of visual.parts) if (p.mount === 'gun') p.turret = 1;
    }
    const bundle = { vehicle: original.vehicle, weapons, visual, engine: original.engine, imported: original.imported };
    const lo = makeLoadout(original.id, bundle, projectiles);
    const model = buildTank(t.renderer, lo, generatedTurretParts);
    const e = new Enemy(original.id, bundle, model, t.terrain, { x: 600, z: 0, heading: aux ? 0 : -Math.PI / 2 }, [0, 0]);
    e.loadout = lo; e.mslT = 0;
    t.G.enemies = [e];
    const world = t.missiles();
    if (!world.testOriginalLaunch) world.testOriginalLaunch = world.launch.bind(world);
    window.testEnemyLaunches = [];
    world.launch = (...args) => { window.testEnemyLaunches.push({ origin: args[3], dir: args[4] }); return world.testOriginalLaunch(...args); };
    return lo.turrets[aux ? 1 : 0].guns[0].ammo[0].count;
  };
`, resolveDir: here }, bundle: true, write: false, format: 'iife', logLevel: 'silent' }).outputFiles[0].text;
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browser = await chromium.launch({ executablePath: process.env.TF_BROWSER || (fs.existsSync(edge) ? edge : undefined), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'] });
const errors = [], results = [];
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(here, '../dist/tankforge-range.html')).href);
  await page.waitForFunction(() => window.__tf, null, { timeout: 120000 });
  await page.addScriptTag({ content: fixture });
  await page.evaluate(async () => {
    const t = window.__tf;
    t.pause(); await t.coreReady(); t.setQuality('low');
    t.renderer.q = { ...t.renderer.q, dome: 256 }; t.renderer._buildDome(256);
    t.G.thumbs.length = 0; t.setMapChoice('range');
    document.getElementById('g-loading').hidden = true;
  });
  for (const id of ['us_m901_itv', 'xp_bmp_k64_atgm', 'xp_bmp_k64_kornet']) {
    const result = await page.evaluate(id => {
      const t = window.__tf;
      t.toGarage(); t.select(id); t.startBattle();
      const before = window.stageLauncherEnemy();
      t.advance(0.4);
      const e = t.G.enemies[0], g = e.loadout.turrets[0].guns[0];
      return { before, after: g.ammo[0].count, ids: e.mslIds, loading: e.mslLoading?.state[0], remaining: e.mslLoading?.loaders[0].remaining, reload: g.def.reload_s, ready: g.launcher.ready, flying: [...t.missiles().nodes.values()].filter(v => v.owner === 100).map(v => ({ pos: v.pos, guided: v.guided })) };
    }, id);
    assert.equal(result.after, result.before - 2, `${id}: the AI must launch both loaded tubes`);
    assert.equal(result.ids.length, 2);
    assert.equal(new Set(result.ids).size, 2);
    assert.equal(result.flying.length, 2);
    assert.ok(result.flying.every(m => m.guided));
    assert.equal(result.ready, 0);
    assert.equal(result.loading, 'loading');
    assert.ok(result.remaining > result.reload - 0.3);
    results.push({ id, ...result });
  }
  const auxiliary = await page.evaluate(() => {
    const t = window.__tf;
    t.toGarage(); t.select('us_m901_itv'); t.startBattle();
    window.stageLauncherEnemy(true); t.advance(0.4);
    const e = t.G.enemies[0];
    return { ids: e.mslIds, pitches: e.gunPitch, modelPitches: e.model.turrets.map(mt => mt.guns[0].node.pitch), modelYaws: e.model.turrets.map(mt => mt.node.yaw), yaws: e.turretYaws, launches: window.testEnemyLaunches };
  });
  assert.equal(auxiliary.ids.length, 2);
  assert.ok(Math.abs(auxiliary.modelPitches[0]) < 1e-9, 'the main cannon is not tilted by an auxiliary launcher');
  assert.ok(Math.abs(auxiliary.modelPitches[1]) > 0.001, 'the actual launcher model follows its elevation');
  assert.equal(auxiliary.modelPitches[1], -auxiliary.pitches[1]);
  assert.equal(auxiliary.modelYaws[1], auxiliary.yaws[1], 'the auxiliary model follows the applied turret yaw');
  assert.ok(auxiliary.modelYaws[1] < -1.5 && auxiliary.modelYaws[1] > -1.7, 'the launcher turns toward the player across the range');
  assert.ok(Math.abs(auxiliary.launches[1].dir[1] - Math.sin(auxiliary.pitches[1])) < 1e-8, 'launch direction matches the visible elevation');
  assert.ok(auxiliary.launches[1].dir[0] < -0.99, 'the auxiliary missile bears on the player');
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, auxiliary, errors }, null, 2));
  console.log('PASS: real AI instances fire and guide both tubes of all three twin ATGM launchers before full reload');
} finally {
  await browser.close();
}

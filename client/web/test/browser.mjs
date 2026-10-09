// Runtime check in headless Chromium: loads the built page, goes through the garage (picture
// cards, filter, start of battle), drives every vehicle, exercises free look, the gunner sight
// (same aiming as third person, range table, rangefinder, sight setting), the machine guns, the
// workshop and multi-gun firing, the running gear (suspension, track slip, sinkage), the renderer
// settings, the pixel-art option and the touch layout, and saves screenshots.
//   node test/browser.mjs [output_dir] [only_vehicle_id]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require('/opt/npm-tools/node_modules/playwright');
}
const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, '../dist/shots');
fs.mkdirSync(out, { recursive: true });
const only = process.argv[3];
const pageUrl = 'file://' + (process.env.TF_PAGE || path.join(here, '../dist/tankforge-range.html'));

const browser = await playwright.chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') && fs.statSync('/opt/pw-browsers/chromium').isFile() ? '/opt/pw-browsers/chromium' : undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const results = {};
const check = (name, cond, detail) => {
  results[name] = cond ? 'ok' : 'FAIL ' + (detail ?? '');
};

async function open(contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.googleapis|Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await page.goto(pageUrl);
  await page.waitForFunction(() => window.__tf, null, { timeout: 15000 }).catch(() => {});
  if (!(await page.evaluate(() => !!window.__tf))) {
    console.log('FAILED TO START', errors);
    await page.screenshot({ path: path.join(out, 'failed.png') });
    await browser.close();
    process.exit(1);
  }
  return page;
}

const page = await open({ viewport: { width: 1280, height: 720 } });
const shot = (name, p = page) => p.screenshot({ path: path.join(out, name + '.png'), timeout: 180000 });

await page.evaluate(() => {
  const t = window.__tf;
  t.pause();
  // the software GPU used here is slow: keep every pass on but shrink the sky dome
  window.__fast = (name = 'medium') => {
    const r = t.renderer;
    t.setQuality(name);
    r.q = { ...r.q, dome: 384 };
    if (r.dome.size !== 384) r._buildDome(384);
  };
  window.__fast();
  t.finishThumbs();
  t.advance(0.2);
});
const shaders = await page.evaluate(() => ({ float: window.__tf.renderer.floatTargets, noise: window.__tf.renderer.noiseRange, quality: window.__tf.state().quality }));
check('renderer started with every pass compiled', shaders.quality === 'medium' && shaders.noise[1] > shaders.noise[0], JSON.stringify(shaders));

// --- garage: the game opens here, every vehicle has a picture card, battle starts on request
const ids = await page.evaluate(() => JSON.parse(document.getElementById('tf-data').textContent).order);
const garage = await page.evaluate(() => {
  const t = window.__tf;
  const cards = [...document.querySelectorAll('#vehicle-list .card')];
  // a rendered picture is not one flat colour
  const painted = cards.filter((c) => {
    const d = c.querySelector('canvas').getContext('2d').getImageData(0, 0, 344, 194).data;
    let lo = 255;
    let hi = 0;
    for (let i = 0; i < d.length; i += 4 * 97) {
      lo = Math.min(lo, d[i]);
      hi = Math.max(hi, d[i]);
    }
    return hi - lo > 40;
  }).length;
  const start = t.state();
  document.getElementById('filter-ussr').click();
  const shown = t.hud.shownIds();
  document.getElementById(`veh-${shown[0]}`).click();
  const picked = t.state().id;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }));
  const next = t.state().id;
  document.getElementById('filter-all').click();
  const hudHidden = getComputedStyle(document.getElementById('hud')).display === 'none';
  return { cards: cards.length, painted, mode: start.mode, x: start.x, shown, picked, next, hudHidden, overflow: document.documentElement.scrollWidth > window.innerWidth };
});
check('game opens in the garage with the vehicle on its bay', garage.mode === 'garage' && garage.x < -20 && garage.hudHidden, JSON.stringify([garage.mode, garage.x, garage.hudHidden]));
check('every vehicle has a rendered picture card', garage.cards === ids.length + 1 && garage.painted === garage.cards, JSON.stringify([garage.cards, garage.painted]));
check('nation filter and arrow keys choose vehicles', garage.shown.length >= 2 && garage.shown.every((id) => id.startsWith('su_')) && garage.picked === garage.shown[0] && garage.next === garage.shown[1], JSON.stringify(garage));
await page.evaluate(() => {
  window.__tf.select('de_tiger_e');
  window.__tf.advance(0.3);
});
await shot('00_garage');
const begun = await page.evaluate(() => {
  const t = window.__tf;
  document.getElementById('battle-btn').click();
  t.advance(0.3);
  const st = t.state();
  const garageHidden = getComputedStyle(document.getElementById('garage')).display === 'none';
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab' }));
  t.advance(0.1);
  return { mode: st.mode, x: st.x, z: st.z, garageHidden, back: t.state().mode, backX: t.state().x };
});
check('"start battle" puts the chosen vehicle on the range, Tab returns to the garage', begun.mode === 'battle' && Math.abs(begun.x) < 0.5 && begun.garageHidden && begun.back === 'garage' && begun.backX < -20, JSON.stringify(begun));

for (const id of ids) {
  if (only && id !== only) continue;
  await page.evaluate((id) => {
    const t = window.__tf;
    t.toGarage();
    t.select(id);
    t.G.spinHold = 60;
    t.G.cam.yaw = t.G.s.heading + Math.PI + 0.75;
    t.G.cam.pitch = -0.2;
    t.advance(0.2);
  }, id);
  await shot(`${id}_1_front`);
  await page.evaluate(() => {
    const t = window.__tf;
    t.G.cam.yaw = t.G.s.heading + Math.PI / 2;
    t.G.cam.pitch = -0.05;
    t.advance(0.1);
  });
  await shot(`${id}_3_side`);
  const st0 = await page.evaluate(() => {
    const t = window.__tf;
    t.startBattle();
    t.setFreeLook(true);
    t.G.cam.yaw = 2;
    t.advance(0.2);
    t.setFreeLook(false);
    t.advance(0.5);
    return t.state();
  });
  check(`${id} free look returns`, !st0.free && Math.abs(st0.camYaw) < 1e-3, JSON.stringify([st0.camYaw, st0.camPitch]));
  const st1 = await page.evaluate(() => {
    const t = window.__tf;
    t.advance(8, ['fwd']);
    return t.state();
  });
  check(`${id} drives forward`, st1.z > 15 && st1.speedKmh > 10 && Math.abs(st1.x) < 0.5, JSON.stringify([st1.z, st1.speedKmh]));
  results[`${id} stats`] = `tris ${Math.round(st1.triangles)}, draw calls ${st1.drawCalls}, 8 s: ${st1.z.toFixed(0)} m @ ${st1.speedKmh.toFixed(0)} km/h`;
}

// --- running gear: links, suspension, slip and sinkage
const gear = await page.evaluate((id) => {
  const t = window.__tf;
  const G = t.G;
  t.toGarage();
  t.select(id);
  t.startBattle();
  t.advance(2.5);
  const rest = t.state();
  t.advance(1.0, ['fwd']);
  const accel = t.state();
  t.advance(6, ['fwd']);
  t.advance(0.4, ['brake']);
  const brake = t.state();
  // pulling away: the worst track slip on the road, then in the mud
  const launchSlip = (x, z) => {
    t.place(x, z, 0);
    t.advance(2);
    let worst = 0;
    for (let i = 0; i < 20; i++) {
      t.advance(0.05, ['fwd']);
      const s = t.state();
      worst = Math.max(worst, s.slipL, s.slipR);
    }
    return worst;
  };
  const launch = { road: launchSlip(0, 300), mud: launchSlip(-60, 60) };
  t.advance(5, ['fwd']);
  const mud = t.state();
  // the ruts the tracks left behind them
  const back = 4;
  const hx = mud.x - Math.sin(mud.heading) * back;
  const hz = mud.z - Math.cos(mud.heading) * back;
  const cx = Math.cos(mud.heading);
  const sx = -Math.sin(mud.heading);
  const tx = G.veh.tm.ct.trackX;
  mud.rut = Math.min(t.terrain.deform(hx + cx * tx, hz + sx * tx), t.terrain.deform(hx - cx * tx, hz - sx * tx));
  mud.between = t.terrain.deform(hx, hz);
  t.setFreeLook(true);
  G.cam.yaw = Math.PI * 1.2;
  G.cam.pitch = -0.14;
  G.cam.distTarget = G.cam.dist = 9;
  t.advance(0.05, ['fwd']);
  return { rest, accel, brake, launch, mud };
}, only || 'de_tiger_e');
check('tracks are made of separate links', gear.rest.links > 60, gear.rest.links);
check('hull sits level at rest', Math.abs(gear.rest.body.pitch) < 3e-3 && Math.abs(gear.rest.body.roll) < 3e-3 && Math.abs(gear.rest.body.y) < 0.01, JSON.stringify(gear.rest.body));
check('accelerating lifts the nose, braking dips it', gear.accel.body.pitch > 0.001 && gear.brake.body.pitch < -0.005, JSON.stringify([gear.accel.body.pitch, gear.brake.body.pitch]));
check('pulling away the tracks slip more in mud than on the road', gear.launch.mud > 0.03 && gear.launch.mud > 1.5 * gear.launch.road, JSON.stringify(gear.launch));
check('under way in mud the tracks run a little ahead of the ground, sink and leave ruts', gear.mud.u > 1 && gear.mud.trackSpeedL >= gear.mud.u - 0.01 && gear.mud.sink > 0.02 && gear.mud.rut < -0.02 && gear.mud.between > gear.mud.rut + 0.02, JSON.stringify([gear.mud.u, gear.mud.trackSpeedL, gear.mud.sink, gear.mud.rut, gear.mud.between]));
await shot('gear_1_mud');
await page.evaluate(() => {
  const t = window.__tf;
  t.setFreeLook(false);
  t.place(0, 0, 0);
  t.advance(1);
});

// --- hump course: every wheel rides the humps, the hull heaves and pitches, the track stays whole
const humps = await page.evaluate(() => {
  const t = window.__tf;
  const G = t.G;
  t.place(13, 20, 0);
  t.advance(1.5);
  let lo = 1;
  let hi = -1;
  let top = -1;
  let spread = 0;
  for (let i = 0; i < 100; i++) {
    t.advance(0.1, ['fwd'], false);
    const st = t.state();
    lo = Math.min(lo, st.body.pitch);
    hi = Math.max(hi, st.body.pitch);
    top = Math.max(top, st.body.y);
    const half = st.wheelLift.slice(0, st.wheelLift.length / 2);
    spread = Math.max(spread, Math.max(...half) - Math.min(...half));
  }
  t.setFreeLook(true);
  G.cam.yaw = G.s.heading - Math.PI / 2;
  G.cam.pitch = -0.04;
  G.cam.distTarget = G.cam.dist = 8;
  G.cam.pivot = null;
  t.advance(0.02, ['fwd']);
  return { lo, hi, top, spread, z: G.s.z };
});
check('hump course: wheels at different heights, hull heaves and pitches both ways', humps.spread > 0.15 && humps.top > 0.05 && humps.hi > 0.02 && humps.lo < -0.02, JSON.stringify(humps));
await shot('gear_2_humps');
await page.evaluate(() => {
  const t = window.__tf;
  t.setFreeLook(false);
  t.place(0, 0, 0);
  t.advance(1.5);
});

// --- interior view (O): shell goes see-through, modules and crew are shown and named
const inner = await page.evaluate(() => {
  const t = window.__tf;
  t.setXray(true);
  t.G.cam.yaw = Math.PI * 1.2;
  t.G.cam.pitch = -0.38;
  t.G.cam.distTarget = t.G.cam.dist = 9;
  t.advance(0.3);
  const on = t.state();
  const shell = t.G.model.shellNodes.map((n) => n.kind);
  const shown = t.G.interior.nodes.filter((n) => n.visible).length;
  const tags = t.G.interior.labels.map((l) => l.text);
  return { on, shell, shown, tags };
});
check('interior view: shell see-through, modules and crew shown with names', inner.on.xray && inner.on.free && inner.shell.every((k) => k === 6) && inner.shown >= 10 && inner.tags.includes('引擎') && inner.tags.includes('車長'), JSON.stringify([inner.shown, inner.tags]));
await shot('xray_1_tiger');
const outer = await page.evaluate(() => {
  const t = window.__tf;
  t.setXray(false);
  t.advance(0.5);
  return { xray: t.state().xray, free: t.state().free, shell: t.G.model.shellNodes.map((n) => n.kind), shown: t.G.interior.nodes.filter((n) => n.visible).length };
});
check('interior view switches back off', !outer.xray && !outer.free && outer.shell.every((k) => k === 0) && outer.shown === 0, JSON.stringify(outer));

// --- renderer settings: time of day, quality
const gfx = await page.evaluate(() => {
  const t = window.__tf;
  const times = [];
  for (let i = 0; i < 4; i++) {
    t.setTime(i);
    t.advance(0.05);
    times.push(t.state().time);
  }
  window.__fast('low');
  t.advance(0.05);
  const low = t.state().quality;
  window.__fast('high');
  t.advance(0.05);
  const high = t.state().quality;
  window.__fast();
  t.setTime(2);
  t.setFreeLook(true);
  t.G.cam.yaw = (-48 * Math.PI) / 180;
  t.G.cam.pitch = 0.12;
  t.advance(0.3);
  return { times, low, high };
});
check('time of day has four settings', new Set(gfx.times).size === 4, JSON.stringify(gfx.times));
check('quality switches between low and high', gfx.low === 'low' && gfx.high === 'high', JSON.stringify([gfx.low, gfx.high]));
await shot('sky_1_dusk');
await page.evaluate(() => {
  const t = window.__tf;
  t.setTime(3);
  t.G.cam.yaw = (70 * Math.PI) / 180;
  t.advance(0.2);
});
await shot('sky_2_morning');
await page.evaluate(() => {
  const t = window.__tf;
  t.setTime(0);
  t.setFreeLook(false);
  t.advance(0.5);
});

// --- gunnery: rangefinder -> automatic sight setting -> centre mark on the target -> hit
const gid = only || 'de_tiger_e';
const ranged = await page.evaluate((id) => {
  const t = window.__tf;
  t.toGarage();
  t.select(id);
  t.startBattle();
  t.advance(0.1);
  const G = t.G;
  const turret = G.loadout.turrets[0];
  turret.rangefinder.error_pct = 0; // deterministic for the check; the error model is covered below
  turret.guns[0].def.dispersion_mrad = 0;
  const target = t.targets.find((g) => g.range === 800);
  t.toggleSight();
  t.advance(0.1);
  // put the middle of the sight picture on the board; the eyepiece rides on the gun, so settle in passes
  for (let i = 0; i < 5; i++) {
    const c = G.camPos;
    G.cam.yaw = Math.atan2(target.x - c[0], target.z - c[2]);
    G.cam.pitch = Math.atan2(target.y - c[1], Math.hypot(target.x - c[0], target.z - c[2]));
    t.advance(1.5);
  }
  t.startRanging();
  t.advance(turret.rangefinder.time_s + 0.2);
  const afterRange = t.state();
  t.advance(3); // gun rises to the new sight setting while the sight line stays on the target
  return { afterRange, settled: t.state() };
}, gid);
check('rangefinder measures the 800 m target', ranged.afterRange.rangeResult?.ok && Math.abs(ranged.afterRange.rangeResult.measured - 800) <= 10, JSON.stringify(ranged.afterRange.rangeResult));
check('automatic sight setting follows the measurement', ranged.afterRange.zero === 800, ranged.afterRange.zero);
check('gun elevates above the sight line by the table value', ranged.settled.gunPitch > ranged.settled.aimPitch + 0.004, JSON.stringify([ranged.settled.gunPitch, ranged.settled.aimPitch]));
check('with the gun laid, the graticule sits on the middle of the sight picture', Math.hypot(...ranged.settled.sightOffset) < 2.5, JSON.stringify(ranged.settled.sightOffset));
await shot('sight_1_zeroed_800');
const landed = await page.evaluate(() => {
  const t = window.__tf;
  t.fireGun(0, 0);
  t.advance(2.5);
  return t.state();
});
check('centre mark hits at the set range', landed.lastHit && landed.lastHit.type === 'target' && landed.lastHit.range === 800 && Math.abs(landed.lastHit.dy) < 0.35 && Math.abs(landed.lastHit.dx) < 0.3, JSON.stringify(landed.lastHit));
results['hit detail'] = JSON.stringify(landed.lastHit);
await shot('sight_2_after_hit');
const errModel = await page.evaluate(() => {
  const t = window.__tf;
  const G = t.G;
  G.loadout.turrets[0].rangefinder.error_pct = 5;
  const seen = [];
  for (let i = 0; i < 12; i++) {
    t.startRanging();
    t.advance(G.loadout.turrets[0].rangefinder.time_s + 0.1);
    seen.push(G.rangeResult.measured);
  }
  t.setZero(0);
  return seen;
});
check('rangefinder error stays inside its data limit and varies', errModel.every((m) => Math.abs(m - 798) <= 798 * 0.05 + 5) && new Set(errModel).size > 3, JSON.stringify(errModel));

// --- sight view aims like third person: the picture turns at once, the gun follows
const lag = await page.evaluate(() => {
  const t = window.__tf;
  const G = t.G;
  const before = t.state();
  G.mdx = 300; // a flick of the mouse to the right
  t.advance(1 / 60);
  const flick = t.state();
  t.advance(0.3);
  const mid = t.state();
  return { before, flick, mid };
});
await shot('sight_3_gun_catching_up');
const caught = await page.evaluate(() => {
  const t = window.__tf;
  t.advance(12);
  return t.state();
});
check('sight: the view turns with the mouse at once', lag.flick.camYaw - lag.before.camYaw > 0.02 && Math.abs(lag.flick.turretYaw - lag.before.turretYaw) < 0.01, JSON.stringify([lag.before.camYaw, lag.flick.camYaw, lag.flick.turretYaw]));
check('sight: the graticule trails behind and the gun catches up', lag.mid.sightOffset[0] < -40 && Math.hypot(...caught.sightOffset) < 2.5 && Math.abs(caught.turretYaw - caught.aimYaw) < 3e-3, JSON.stringify([lag.mid.sightOffset, caught.sightOffset, caught.turretYaw, caught.aimYaw]));

// --- third person: aim at a target with the camera, turret follows
const third = await page.evaluate(() => {
  const t = window.__tf;
  t.toggleSight();
  const G = t.G;
  const tg = t.targets.find((g) => g.range === 400);
  G.cam.yaw = Math.atan2(tg.x, tg.z);
  G.cam.pitch = -0.012;
  t.advance(5);
  return t.state();
});
check('third person: turret follows the camera aim', Math.abs(third.turretYaw - third.aimYaw) < 3e-3, JSON.stringify([third.turretYaw, third.aimYaw]));
await shot('third_1_aim_400');

// --- machine guns: coaxial and hull guns fire bursts at the aim point, belts run down, barrels heat
const mg = await page.evaluate(() => {
  const t = window.__tf;
  const G = t.G;
  const tg = t.targets.find((g) => g.range === 200);
  t.setZero(0);
  for (let i = 0; i < 5; i++) {
    const c = G.camPos;
    G.cam.yaw = Math.atan2(tg.x - c[0], tg.z - c[2]);
    G.cam.pitch = Math.atan2(tg.y - c[1], Math.hypot(tg.x - c[0], tg.z - c[2]));
    t.advance(1.2);
  }
  const before = t.state();
  G.mgHeld = true;
  t.advance(2);
  const burst = t.state();
  return { before, burst };
});
await shot('mg_1_burst');
const mgAfter = await page.evaluate(() => {
  const t = window.__tf;
  const G = t.G;
  t.advance(1.5);
  const hits = t.state();
  t.advance(10, [], false); // keep the trigger down until the belts run out
  const empty = t.state();
  G.mgHeld = false;
  t.advance(0.2);
  return { hits, empty };
});
const rate = mg.burst.mg[0].fired / 2;
check('machine guns fire at their cyclic rate while the trigger is held', mg.before.mg.length === 2 && mg.before.mg.every((m) => m.fired === 0) && Math.abs(rate * 60 - 850) < 40 && mg.burst.mg[1].fired > 20, JSON.stringify(mg.burst.mg));
check('machine-gun bullets fly and hit the board', mg.burst.bullets > 3 && mgAfter.hits.mgHits > 10 && Math.abs(mgAfter.hits.lastMgHit.range - 200) < 1, JSON.stringify([mg.burst.bullets, mgAfter.hits.mgHits, mgAfter.hits.lastMgHit]));
check('belts run out and are changed, barrels heat up', mg.burst.mg[0].heat > 0.08 && mgAfter.empty.mg.some((m) => m.reload > 0 || m.fired > 150), JSON.stringify(mgAfter.empty.mg));
const roofGun = await page.evaluate(() => {
  const t = window.__tf;
  const G = t.G;
  t.toGarage();
  t.select('us_m4a3_75w');
  t.startBattle();
  G.cam.yaw = 1.2;
  G.cam.pitch = 0.1;
  t.advance(4);
  const pm = G.model.mgs[0];
  const e = G.MG[pm.index];
  G.mgHeld = true;
  t.advance(0.6);
  G.mgHeld = false;
  const st = t.state();
  t.setFreeLook(true);
  G.cam.yaw = 1.2 + Math.PI - 0.6;
  G.cam.pitch = -0.25;
  G.cam.distTarget = G.cam.dist = 8;
  t.advance(0.1);
  return { mount: e.m.mount, aimYaw: e.aim.yaw, node: pm.node.yaw + G.T[0].yaw, fired: e.st.fired, mg: st.mg };
});
check('roof machine gun swings to the aim point on its pintle and fires', roofGun.mount === 'pintle' && Math.abs(roofGun.aimYaw - 1.2) < 0.08 && Math.abs(roofGun.node - roofGun.aimYaw) < 1e-6 && roofGun.fired > 3, JSON.stringify(roofGun));
await shot('mg_2_roof_gun');
await page.evaluate(() => {
  window.__tf.setFreeLook(false);
  window.__tf.advance(0.3);
});

// --- open-topped turret: no roof, crew in view without the interior view
const openTop = await page.evaluate(() => {
  const t = window.__tf;
  const G = t.G;
  t.toGarage();
  t.select('us_m10');
  G.spinHold = 60;
  G.cam.yaw = G.s.heading + Math.PI + 0.5;
  G.cam.pitch = -0.5;
  G.cam.distTarget = G.cam.dist = 13;
  t.advance(0.2);
  // the crew (and the breech, which an open top also shows)
  const crewNodes = G.interior.labels.filter((l) => l.crew).map((l) => l.node);
  const always = crewNodes.filter((n) => n.always).length;
  const seen = crewNodes.filter((n) => n.visible).length;
  return { openTop: G.loadout.turrets[0].openTop, always, seen, xray: t.state().xray };
});
check('open-topped turret shows its crew', openTop.openTop && openTop.always === 3 && openTop.seen === 3 && !openTop.xray, JSON.stringify(openTop));
await shot('open_1_m10');

if (!only) {
  // --- custom build: six guns in three turrets
  const custom = await page.evaluate(() => {
    const t = window.__tf;
    try {
      localStorage.removeItem('tankforge.build.v1');
    } catch {}
    t.toGarage();
    t.select('custom');
    t.startBattle();
    t.setFreeLook(true);
    t.G.cam.yaw = Math.PI + 0.8;
    t.G.cam.pitch = -0.3;
    t.G.cam.distTarget = t.G.cam.dist = 12;
    t.advance(0.3);
    return t.state();
  });
  check('custom build has six guns in three turrets', custom.gunCount === 6 && custom.turrets.length === 3, JSON.stringify([custom.gunCount, custom.turrets.length]));
  await shot('custom_1_hexa');
  const salvo = await page.evaluate(() => {
    const t = window.__tf;
    const G = t.G;
    t.setFreeLook(false);
    const tg = t.targets.find((g) => g.range === 400);
    G.cam.yaw = Math.atan2(tg.x, tg.z);
    G.cam.pitch = -0.012;
    t.setZero(400); // every gun adds its own superelevation for the set range
    t.advance(6);
    // put the crosshair on the board itself (a level camera ray from above the tank meets the
    // ground short of it); the camera orbits, so settle in a few passes
    for (let i = 0; i < 4; i++) {
      const c = G.camPos;
      G.cam.yaw = Math.atan2(tg.x - c[0], tg.z - c[2]);
      G.cam.pitch = Math.atan2(tg.y - c[1], Math.hypot(tg.x - c[0], tg.z - c[2]));
      t.advance(0.5);
    }
    t.advance(2);
    const before = t.state();
    t.trigger();
    t.advance(0.6);
    const after = t.state();
    t.advance(3);
    return { before, after, later: t.state() };
  });
  const loadingStates = salvo.after.turrets.map((t) => t.loading);
  check('rear turret cannot bear forward', salvo.before.turrets[2].bearing === false && salvo.before.turrets[0].bearing && salvo.before.turrets[1].bearing, JSON.stringify(salvo.before.turrets.map((t) => t.bearing)));
  check('salvo fires the four guns that bear, not the rear pair', loadingStates[0].every((s) => s !== 'ready') && loadingStates[1].every((s) => s !== 'ready') && loadingStates[2].every((s) => s === 'ready'), JSON.stringify(loadingStates));
  check('one loader serves one gun at a time', loadingStates[0].filter((s) => s === 'loading').length === 1 && loadingStates[0].filter((s) => s === 'waiting').length === 1 && loadingStates[1].filter((s) => s === 'loading').length === 2, JSON.stringify(loadingStates));
  check('recoil shoves the hull backwards', salvo.after.z < salvo.before.z - 0.002, JSON.stringify([salvo.before.z, salvo.after.z]));
  // a ripple salvo rocks the hull, and these unstabilized guns go with it: not every round lands
  check('shells from different guns reach the target', salvo.later.hits >= 2, salvo.later.hits);
  await shot('custom_2_after_salvo');

  // --- workshop UI (in the garage)
  await page.evaluate(() => window.__tf.toGarage());
  await page.click('#ws-open');
  await page.evaluate(() => window.__tf.advance(0.3));
  await shot('workshop_1_open');
  const ws = await page.evaluate(() => {
    const t = window.__tf;
    const set = (id, v) => {
      const e = document.getElementById(id);
      e.value = String(v);
      e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    };
    const m0 = t.state().mass;
    set('ws-t1-g0-cal', 150);
    const m1 = t.state().mass;
    const info = document.querySelector('#ws-body .ws-gun .ws-info').textContent;
    document.getElementById('ws-addturret').click();
    const turrets = t.state().turrets.length;
    document.getElementById('ws-preset-twin').click();
    const twin = t.state();
    set('ws-t0-rack', 'hull_floor');
    const slow = document.querySelector('#ws-body .ws-gun .ws-info').textContent;
    set('ws-t0-rack', 'ready');
    const fast = document.querySelector('#ws-body .ws-gun .ws-info').textContent;
    const closedMass = t.state().mass;
    set('ws-t0-roof', 'open');
    const openTop = { mass: t.state().mass, flag: t.G.loadout.turrets[0].openTop, crew: t.G.interior.nodes.filter((n) => n.always).length };
    document.getElementById('ws-export-btn').click();
    const text = document.getElementById('ws-export').value;
    let problems = ['not parsed'];
    let files = 0;
    try {
      const parsed = JSON.parse(text);
      files = Object.keys(parsed.files).length;
      problems = t.checkFolder(parsed.files);
    } catch (e) {
      problems = [e.message];
    }
    document.getElementById('ws-preset-porcupine').click();
    t.advance(0.3);
    return { m0, m1, info, turrets, twinGuns: twin.gunCount, slow, fast, closedMass, openTop, files, problems, summary: document.getElementById('ws-summary').textContent };
  });
  check('workshop: a bigger gun makes the vehicle heavier', ws.m1 > ws.m0 + 500, JSON.stringify([ws.m0, ws.m1]));
  check('workshop: adding a turret rebuilds the vehicle', ws.turrets === 4, ws.turrets);
  check('workshop: preset loads', ws.twinGuns === 2, ws.twinGuns);
  check('workshop: a far ammo rack reloads slower', parseFloat(ws.slow.replace(/[^0-9.]/g, '')) > parseFloat(ws.fast.replace(/[^0-9.]/g, '')) + 1, `${ws.slow} / ${ws.fast}`);
  check('workshop: an open-topped turret is lighter and shows its crew', ws.openTop.flag && ws.openTop.mass < ws.closedMass - 300 && ws.openTop.crew >= 2, JSON.stringify([ws.closedMass, ws.openTop]));
  check('workshop: export is a complete, valid vehicle folder', ws.files === 7 && ws.problems.length === 0, JSON.stringify([ws.files, ws.problems]));
  results['workshop summary'] = ws.summary;
  await shot('workshop_2_porcupine');
  await page.click('#ws-close');
  const wsDone = await page.evaluate(() => {
    const t = window.__tf;
    const queued = t.state().thumbs;
    t.finishThumbs();
    t.advance(0.1);
    return { queued, id: t.state().id, mode: t.state().mode };
  });
  check('leaving the workshop redraws the custom vehicle card', wsDone.queued === 1 && wsDone.id === 'custom' && wsDone.mode === 'garage', JSON.stringify(wsDone));

  // --- pixel-art mode
  const px = await page.evaluate(() => {
    const t = window.__tf;
    t.select('su_t34_85');
    t.startBattle();
    t.setPixel(1);
    t.G.cam.yaw = 0.5;
    t.advance(2, ['fwd']);
    return t.state().pixelSize;
  });
  check('pixel option renders through the low-resolution target', px >= 2, px);
  await shot('pixel_1_fine');
  await page.evaluate(() => {
    window.__tf.setPixel(3);
    window.__tf.advance(0.1);
  });
  await shot('pixel_2_coarse');
  await page.evaluate(() => window.__tf.setPixel(0));

  // --- recorded sound slot: a generated WAV decodes and plays without errors
  const snd = await page.evaluate(async () => {
    const t = window.__tf;
    const rate = 8000;
    const n = 800;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF');
    v.setUint32(4, 36 + n * 2, true);
    w(8, 'WAVEfmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    w(36, 'data');
    v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / 5) * 12000, true);
    const url = 'data:audio/wav;base64,' + btoa(String.fromCharCode(...new Uint8Array(buf)));
    t.sound.start();
    if (!t.sound.ctx) return { ctx: false };
    await t.sound.loadSamples({ shot_medium: url, engine_loop: url });
    t.sound.shot(88);
    t.sound.drive(0.5, 0.5, 5);
    return { ctx: true, decoded: Object.keys(t.sound.samples) };
  });
  check('sound: recorded samples decode and replace the synth', snd.ctx && snd.decoded.includes('shot_medium') && snd.decoded.includes('engine_loop'), JSON.stringify(snd));

  // --- narrow desktop window: battle and garage
  await page.setViewportSize({ width: 400, height: 760 });
  await page.evaluate(() => window.__tf.advance(0.1));
  await shot('narrow_1_battle');
  check('no horizontal overflow at 400 px (battle)', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  const narrow = await page.evaluate(() => {
    const t = window.__tf;
    t.toGarage();
    window.dispatchEvent(new Event('resize'));
    t.advance(0.2);
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth > window.innerWidth, button: r('battle-btn'), list: r('vehicle-list'), info: r('g-info'), h: window.innerHeight, w: window.innerWidth };
  });
  await shot('narrow_2_garage');
  check('narrow garage: cards, sheet and the battle button all fit on screen', !narrow.overflow && narrow.button.bottom <= narrow.h && narrow.button.width > 200 && narrow.info.bottom <= narrow.list.top + 1 && narrow.info.right <= narrow.w, JSON.stringify(narrow));

  // --- touch layout on a phone-sized touch screen (landscape and portrait)
  const phone = await open({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const touch = await phone.evaluate(() => {
    const t = window.__tf;
    t.pause();
    t.renderer.q = { ...t.renderer.q, dome: 384 };
    t.renderer._buildDome(384);
    t.finishThumbs();
    t.advance(0.1);
    window.__garageTouch = { mode: t.state().mode, touchUi: getComputedStyle(document.getElementById('touch')).display };
    t.startBattle();
    const joy = document.getElementById('joy');
    const r = joy.getBoundingClientRect();
    const ev = (type, x, y) => joy.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
    ev('pointerdown', r.left + r.width / 2, r.top + 4); // push the stick fully forward
    const throttle = t.G.touch.throttle;
    t.advance(4);
    const moved = t.state();
    ev('pointerup', r.left + r.width / 2, r.top + 4);
    const fire = document.getElementById('tb-fire');
    fire.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, pointerType: 'touch', bubbles: true }));
    t.advance(0.2);
    fire.dispatchEvent(new PointerEvent('pointerup', { pointerId: 8, pointerType: 'touch', bubbles: true }));
    const fired = t.state().turrets[0].loading[0];
    document.getElementById('tb-sight').click();
    t.advance(0.2);
    const view = t.state().view;
    document.getElementById('tb-sight').click();
    t.advance(0.2);
    const mgBtn = document.getElementById('tb-mg');
    mgBtn.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, pointerType: 'touch', bubbles: true }));
    t.advance(0.5);
    mgBtn.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, pointerType: 'touch', bubbles: true }));
    const mgFired = t.state().mg.reduce((a, m) => a + m.fired, 0);
    return { touch: document.body.dataset.touch, garage: window.__garageTouch, throttle, z: moved.z, released: t.G.touch.throttle, fired, mgFired, view, overflow: document.documentElement.scrollWidth > window.innerWidth };
  });
  check('touch: sticks and buttons appear only in battle', touch.garage.mode === 'garage' && touch.garage.touchUi === 'none', JSON.stringify(touch.garage));
  check('touch machine-gun button fires', touch.mgFired > 2, touch.mgFired);
  check('touch layout switches on for touch screens', touch.touch === '1');
  check('touch stick drives the tank and releases', touch.throttle > 0.9 && touch.z > 3 && touch.released === 0, JSON.stringify(touch));
  check('touch fire and sight buttons work', touch.fired !== 'ready' && touch.view === 'sight', JSON.stringify([touch.fired, touch.view]));
  check('touch layout has no horizontal overflow', !touch.overflow);
  await shot('touch_1_landscape', phone);
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.evaluate(() => window.__tf.advance(0.1));
  await shot('touch_2_portrait', phone);
  check('touch portrait has no horizontal overflow', !(await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  await phone.evaluate(() => {
    window.__tf.toGarage();
    window.dispatchEvent(new Event('resize'));
    window.__tf.advance(0.2);
  });
  await shot('touch_3_garage_portrait', phone);
  await phone.setViewportSize({ width: 844, height: 390 });
  const land = await phone.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    window.__tf.advance(0.2);
    const b = document.getElementById('battle-btn').getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth > window.innerWidth, bottom: b.bottom, h: window.innerHeight };
  });
  await shot('touch_4_garage_landscape', phone);
  check('touch garage (landscape) fits', !land.overflow && land.bottom <= land.h, JSON.stringify(land));
}

// --- ammunition selector, cruise control, the battle map, enemies, collisions, trees, water
const war = await page.evaluate(async () => {
  const t = window.__tf;
  const G = t.G;
  const key = (code) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  };
  t.toGarage();
  t.setMapChoice('range');
  t.select('de_tiger_e');
  t.startBattle();
  t.advance(1);
  const a0 = t.state().ammo;
  t.fireGun(0, 0);
  t.advance(0.2);
  const a1 = t.state().ammo;
  key('Digit2');
  t.advance(12);
  const a2 = t.state().ammo;
  key('Digit3');
  key('Digit3');
  t.advance(0.2);
  const a3 = t.state().ammo;
  const slots = document.querySelectorAll('#ammo-bar .ammo-slot').length;
  key('Equal');
  key('Equal');
  t.advance(4);
  const cruise = { level: t.state().cruise, speed: t.state().speedKmh, label: document.getElementById('cruise').textContent };
  key('Minus');
  key('Minus');
  key('Minus');
  // the motor pool shed: driving at its side wall, nothing goes through
  t.place(-80, -74, 0);
  t.advance(0.5);
  for (let i = 0; i < 12; i++) t.advance(0.5, ['fwd']);
  const shed = { z: t.state().z, speed: t.state().speedKmh };
  // the battle map
  t.toGarage();
  t.setMapChoice('coast');
  await t.loadMap('coast');
  t.startBattle();
  t.advance(1);
  const st = t.state();
  const spawn = { x: st.x, z: st.z, map: t.mapState(), enemies: t.enemies().length, minimap: document.getElementById('minimap').width };
  // shoot the first enemy from where it can be seen
  const e = t.enemies()[0];
  t.place(e.x - 110, e.z + 30, Math.PI / 2);
  t.advance(1.5);
  const ey = G.enemies[0].veh.body.origin()[1] + 1.3;
  const results = [];
  for (let k = 0; k < 4 && t.enemies()[0].alive; k++) {
    for (let j = 0; j < 2; j++) {
      const c = G.camPos;
      G.cam.yaw = Math.atan2(e.x - c[0], e.z - c[2]);
      G.cam.pitch = Math.atan2(ey - c[1], Math.hypot(e.x - c[0], e.z - c[2]));
      t.advance(j ? 0.5 : 9);
    }
    key('Digit1');
    t.fireGun(0, 0);
    t.advance(1.2);
    results.push(G.lastHit && G.lastHit.result);
  }
  const shotAt = { results, alive: t.enemies()[0].alive };
  // drive into the burning wreck: the tracks and hull stop against it
  t.place(e.x - 16, e.z, Math.PI / 2);
  t.advance(0.5);
  for (let i = 0; i < 16; i++) t.advance(0.5, ['fwd']);
  const ram = { gap: Math.hypot(G.s.x - e.x, G.s.z - e.z), speed: t.state().speedKmh };
  // trees: drive into the nearest one
  const trees = G.mapEntry.map.trees;
  let best = 0;
  let bd = Infinity;
  trees.forEach((tr, i) => {
    const d = Math.hypot(tr.x + 600, tr.z - 150);
    if (d < bd && tr.fall === 0) {
      bd = d;
      best = i;
    }
  });
  const tr = trees[best];
  t.place(tr.x, tr.z - 14, 0);
  t.advance(0.5);
  for (let i = 0; i < 10; i++) t.advance(0.5, ['fwd']);
  const felled = t.mapState().treesDown;
  // the sea: wading in the shallows is fine; past the fording depth the engine floods
  const m = G.mapEntry.map;
  let wx = -470;
  let wz = 352;
  while (m.waterDepth(wx, wz) < 0.6) {
    wx += Math.sin(0.35) * 2;
    wz += Math.cos(0.35) * 2;
  }
  t.place(wx, wz, 0.35);
  t.advance(1.5);
  const shallow = t.mapState();
  while (m.waterDepth(wx, wz) < 1.6) {
    wx += Math.sin(0.35) * 2;
    wz += Math.cos(0.35) * 2;
  }
  t.place(wx, wz, 0.35);
  t.advance(1.5, ['fwd']);
  const sea = { ...t.mapState(), shallowFlooded: shallow.flooded, shallowWater: shallow.water };
  t.toGarage();
  t.setMapChoice('range');
  return { a0, a1, a2, a3, slots, cruise, shed, spawn, shotAt, ram, felled, sea };
});
await shot('war_map');
check('ammunition: firing uses a round, the selected type is loaded next, a double press reloads at once', war.slots === 3 && war.a1.counts[0] === war.a0.counts[0] - 1 && war.a2.loaded === 1 && war.a3.selected === 2 && war.a3.loaded === -1 && war.a3.counts[1] === war.a2.counts[1] + 1, JSON.stringify([war.a0, war.a1, war.a2, war.a3]));
check('cruise control holds a throttle setting', war.cruise.level === 3 && war.cruise.speed > 5 && war.cruise.label === '二段', JSON.stringify(war.cruise));
// the shed's south wall face is at z = -64.4; the Tiger's centre must stay about half its length short of it
check('tracks collide: the shed wall stops the tank', war.shed.z < -66.4 && war.shed.z > -74 && Math.abs(war.shed.speed) < 3, JSON.stringify(war.shed));
check('battle map: starts at a blue start point with the enemies and the grid minimap', war.spawn.map.active === 'coast' && war.spawn.enemies === 2 && Math.hypot(war.spawn.x + 622.7, war.spawn.z - 218.7) < 3 && war.spawn.map.standing > 5000, JSON.stringify(war.spawn));
check('enemy armour: shells penetrate or not by plate, angle and range, and knock the vehicle out', war.shotAt.results.every((r) => ['pen', 'kill', 'nopen', 'ricochet', 'track'].includes(r)) && !war.shotAt.alive, JSON.stringify(war.shotAt));
check('tracks collide: a vehicle stops against another vehicle', war.ram.gap > 3.5 && Math.abs(war.ram.speed) < 3, JSON.stringify(war.ram));
check('trees go over when driven into', war.felled > 0, war.felled);
check('water: wading in the shallows, past the fording depth the engine floods', !war.sea.shallowFlooded && war.sea.shallowWater > 0.4 && war.sea.flooded && war.sea.water > 1.3, JSON.stringify(war.sea));

check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log(JSON.stringify(results, null, 1));
await browser.close();
process.exit(Object.values(results).some((v) => String(v).startsWith('FAIL')) ? 1 : 0);

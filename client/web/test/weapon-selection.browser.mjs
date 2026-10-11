import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '../dist/weapon-selection-shots');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.TF_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl'] });
const errors = [], results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(here, '../dist/tankforge-range.html')).href);
  await page.waitForFunction(() => window.__tf, null, { timeout: 120000 });
  await page.evaluate(() => {
    const t = window.__tf;
    t.pause(); t.setQuality('low'); t.G.thumbs.length = 0;
    t.select('xp_kda35'); t.G.thumbs.length = 0; t.startBattle();
    document.body.dataset.touch = '1'; document.getElementById('g-loading').hidden = true;
    t.advance(.1);
  });
  for (const code of ['Digit5', 'Numpad5']) {
    await page.evaluate(code => window.dispatchEvent(new KeyboardEvent('keydown', { code })), code);
    await page.evaluate(() => window.__tf.advance(1 / 60));
    const selected = await page.evaluate(() => ({ index: window.__tf.state().ammo.selected,
      checked: document.querySelectorAll('#ammo-bar [aria-checked="true"]').length,
      slot: document.querySelectorAll('#ammo-bar .ammo-slot')[4].getAttribute('aria-checked') }));
    assert.equal(selected.index, 4); assert.equal(selected.slot, 'true'); assert.equal(selected.checked, 1);
    results.push({ code, selected });
  }
  await page.screenshot({ path: path.join(out, 'ammo-5.png') });
  await page.evaluate(() => {
    const t = window.__tf; t.toGarage(); t.select('de_tiger_e'); t.G.thumbs.length = 0;
    t.startBattle(); t.G.cam.yaw = t.G.s.heading; t.G.cam.pitch = 0; t.advance(2);
  });
  const count = await page.evaluate(() => window.__tf.G.MG.length);
  assert.ok(count >= 2, 'exercise multiple MG mounts');
  const gunCount = await page.evaluate(() => window.__tf.G.loadout.turrets.reduce((n, t) => n + t.guns.length, 0));
  for (let i = 0; i < gunCount; i++) {
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' })));
    assert.equal(await page.evaluate(() => window.__tf.G.weaponControl.kind), 'gun', 'all real gun slots precede the MG slots');
  }
  for (let mi = 0; mi < count; mi++) {
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' })));
    const selection = await page.evaluate(() => window.__tf.G.sightM);
    assert.equal(selection, mi);
    const before = await page.evaluate(() => ({ fired: window.__tf.G.MG.map(e => e.st.fired),
      ammo: window.__tf.G.loadout.turrets.map(t => t.guns.map(g => g.ammo.map(a => a.count))) }));
    await page.evaluate(() => {
      const t = window.__tf; t.G.fireHeld = true; t.advance(.4); t.G.fireHeld = false;
    });
    const after = await page.evaluate(() => ({ fired: window.__tf.G.MG.map(e => e.st.fired),
      ammo: window.__tf.G.loadout.turrets.map(t => t.guns.map(g => g.ammo.map(a => a.count))),
      highlight: Array.from(document.querySelectorAll('.mg-row')).map(row => row.dataset.sighting) }));
    assert.ok(after.fired[mi] > before.fired[mi], `selected MG ${mi} fires on left trigger`);
    for (let i = 0; i < count; i++) if (i !== mi) assert.equal(after.fired[i], before.fired[i], 'unselected MG stays silent');
    assert.deepEqual(after.ammo, before.ammo, 'left trigger must not consume cannon ammo while an MG is selected');
    assert.equal(after.highlight[mi], '1');
    results.push({ mi, before, after });
  }
  await page.evaluate(() => { const t = window.__tf; t.toggleSight(); t.advance(.2); });
  await page.screenshot({ path: path.join(out, 'mg-sight.png') });
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' })));
  assert.equal(await page.evaluate(() => window.__tf.G.sightM), -1, 'full cycle restores cannon');
  assert.equal(await page.evaluate(() => window.__tf.G.weaponControl.kind), 'all');
  for (let i = 0; i <= gunCount; i++) await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' })));
  const zeroing = await page.evaluate(() => {
    const t = window.__tf;
    const pose = () => ({ yaw: t.G.T[0].yaw, pitch: t.G.T[0].guns[0].pitch });
    const bore = () => Array.from(t.G.model.turrets[0].guns[0].node.world).slice(8, 11);
    t.G.autoZero = false; t.G.zero = 0; t.G.cam.yaw = t.G.s.heading; t.G.cam.pitch = 0;
    t.advance(.1);
    const held = pose(), straight = t.G.sightOffset.slice();
    t.G.zero = 1000;
    t.advance(4);
    const { yaw, pitch } = pose();
    const expectedBore = t.G.veh.body.worldDir([Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)]);
    return { held, after: pose(), expectedBore, bore: bore(), straight, offset: t.G.sightOffset.slice() };
  });
  assert.deepEqual(zeroing.after, zeroing.held, 'selected fixed coax holds both cannon motors');
  assert.ok(zeroing.bore.every(Number.isFinite) && zeroing.offset.every(Number.isFinite));
  zeroing.bore.forEach((v, i) => assert.ok(Math.abs(v - zeroing.expectedBore[i]) < 1e-6, 'actual rendered coax/cannon bore follows the held joint and current hull'));
  assert.ok(Math.abs(zeroing.offset[1] - zeroing.straight[1]) > 1, 'actual reticle uses the selected MG ballistic zero independently of the held bore');
  const damagedCannon = await page.evaluate(() => {
    const t = window.__tf;
    const before = t.G.MG[0].st.fired;
    t.G.caps = { ...t.G.caps, can_fire: false, destroyed: false };
    t.G.fireHeld = true; t.advance(.1); t.G.fireHeld = false;
    return { before, after: t.G.MG[0].st.fired };
  });
  assert.ok(damagedCannon.after > damagedCannon.before, 'a disabled cannon must not disable an intact MG');
  results.push({ zeroing, damagedCannon });
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ results, errors }, null, 2));
  console.log('PASS: fifth ammo keyboard selection, MG cycling, individual fire and sight rendering');
} finally { await browser.close(); }

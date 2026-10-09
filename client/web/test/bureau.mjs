// Runtime check of the design bureau and test range in headless Chromium.
//   node test/bureau.mjs [output_dir]
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
const pageUrl = 'file://' + (process.env.TF_PAGE || path.join(here, '../dist/tankforge-range.html'));
const browser = await playwright.chromium.launch({ executablePath: fs.existsSync('/opt/pw-browsers/chromium') && fs.statSync('/opt/pw-browsers/chromium').isFile() ? '/opt/pw-browsers/chromium' : undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const errors = [];
const results = {};
const check = (name, cond, detail) => (results[name] = cond ? 'ok' : 'FAIL ' + (detail ?? ''));
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' && !/fonts\.googleapis|Failed to load resource/.test(m.text())) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + e.stack));
await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
await page.goto(pageUrl);
await page.waitForFunction(() => window.__tf, null, { timeout: 20000 });
await page.evaluate(() => {
  const t = window.__tf;
  t.pause();
  t.setQuality('medium');
  const r = t.renderer;
  r.q = { ...r.q, dome: 384 };
  if (r.dome.size !== 384) r._buildDome(384);
  t.finishThumbs();
  t.advance(0.2);
});
const shot = (name) => page.screenshot({ path: path.join(out, name + '.png'), timeout: 180000 });
await shot('garage');

await page.evaluate(() => window.__tf.coreReady);
const ready = await page.evaluate(async () => !!(await window.__tf.coreReady));
check('design core loaded', ready);
await page.evaluate(() => window.__tf.openBureau());
await page.waitForTimeout(1500);
const bu = await page.evaluate(() => {
  const b = window.__tf.bureau;
  return { visible: getComputedStyle(document.getElementById('bureau')).display !== 'none', report: !!b.report, issues: b.report?.issues?.length, mass: b.report?.mass?.total_kg, steps: document.querySelectorAll('#bureau .bu-step, #bureau [data-step]').length };
});
check('bureau opens with a report', bu.visible && bu.report, JSON.stringify(bu));
await shot('bureau-open');
for (const k of ['hull', 'turret', 'armor', 'interior', 'analysis']) {
  const ok = await page.evaluate((k) => { try { window.__tf.bureau.setStep(k); return true; } catch (e) { return e.message; } }, k);
  if (ok !== true) check('step ' + k, false, ok);
  await page.waitForTimeout(400);
}
await shot('bureau-analysis');
// --- Suspension Debug Mode: the design settled by the game's tank model, per wheel
const sd = await page.evaluate(() => {
  const b = window.__tf.bureau;
  b.setStep('suspension');
  const out = {};
  for (const c of ['rest', 'accel', 'brake', 'slope', 'kerb']) {
    b.setSuspDebug(c);
    const d = b.suspDbg;
    if (!d || d.error) return { error: d?.error || 'none', c };
    const per = d.wheels.length / 2;
    const right = d.wheels.slice(0, per);
    const left = d.wheels.slice(per);
    out[c] = { front: right[0].loadT, rear: right[per - 1].loadT, left: left.reduce((a, w) => a + w.loadT, 0), right: right.reduce((a, w) => a + w.loadT, 0), total: d.wheels.reduce((a, w) => a + w.loadT, 0) * 9.81, weight: d.weightKN, pitch: d.pitch, roll: d.roll, fields: ['loadT', 'compPct', 'springKN', 'damperKN'].every((k) => d.wheels.every((w) => Number.isFinite(w[k]))) };
  }
  out.rows = document.querySelectorAll('#bu-panel .bu-kv').length;
  out.toolbar = !!document.getElementById('bu-sd-kerb');
  return out;
});
check('suspension debug: every wheel shows load, compression, spring and damper force', !sd.error && sd.rest.fields && Math.abs(sd.rest.total / sd.rest.weight - 1) < 0.03 && sd.toolbar && sd.rows > 8, JSON.stringify(sd));
check('suspension debug: weight moves back accelerating, forward braking, downhill on a slope, off the raised side', !sd.error && sd.accel.rear > sd.accel.front && sd.brake.front > sd.brake.rear && sd.slope.rear > sd.slope.front && sd.kerb.left < sd.kerb.right && sd.kerb.roll < -0.02, JSON.stringify(sd));
await page.evaluate(() => window.__tf.bureau.setSuspDebug('brake'));
await page.waitForTimeout(300);
await shot('bureau-suspension-debug');
await page.evaluate(() => window.__tf.bureau.setSuspDebug(null));
await page.evaluate(() => window.__tf.bureau.testFire());
await page.waitForTimeout(500);
const tr = await page.evaluate(() => ({ mode: window.__tf.state().mode, hidden: document.getElementById('testrange').hidden }));
check('test range opens', !tr.hidden, JSON.stringify(tr));
await page.evaluate(() => { const t = window.__tf; t.advance(0.3); t.testRange.fire(); for (let i = 0; i < 40; i++) t.advance(0.05); });
const hit = await page.evaluate(() => ({ log: window.__tf.testRange.log.length, replay: !!window.__tf.testRange.replay }));
check('test shot hits and logs', hit.log > 0, JSON.stringify(hit));
await shot('testrange-hit');
await page.evaluate(() => { const t = window.__tf; if (t.testRange.log.length) t.testRange.startReplay(); for (let i = 0; i < 30; i++) t.advance(0.05); });
await shot('testrange-replay');

// --- test drive from the bureau
await page.evaluate(async () => {
  const t = window.__tf;
  t.testRange.env.onBack('bureau');
  await new Promise((r) => setTimeout(r, 800));
  t.bureau.drive();
  t.advance(4, ['fwd']);
});
const drv = await page.evaluate(() => window.__tf.state());
check('designed tank drives', drv.mode === 'battle' && drv.speedKmh > 5, `${drv.mode} ${drv.speedKmh}`);
await shot('drive');

// --- garage lists saved designs
await page.evaluate(() => {
  const t = window.__tf;
  t.toGarage();
  t.refreshDesigns();
});
const cards = await page.evaluate(() => [...document.querySelectorAll('#vehicle-list .card')].map((c) => c.dataset.id || c.textContent.slice(0, 30)));
console.log('cards', cards.slice(-4));

console.log(JSON.stringify(results, null, 1));
console.log('errors', errors.slice(0, 10));
await browser.close();

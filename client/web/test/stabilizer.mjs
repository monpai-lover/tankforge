// How well each stabilizer holds the gun on a level line while the vehicle drives at ~20 km/h
// over the suspension course (staggered waves, gravel, continuous waves): the gun's error from
// its aim point in milliradians (RMS, 90th percentile, worst), for no stabilizer, the vertical
// one and the two-plane one. Checks the two-plane holds within a few milliradians.
//   node test/stabilizer.mjs [vehicle]          (build first: npm run build)
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const playwright = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const veh = process.argv[2] || 'su_t10m';
const rows = [];
const exe = '/opt/pw-browsers/chromium';
const browser = await playwright.chromium.launch({ executablePath: (await import('node:fs')).existsSync(exe) && (await import('node:fs')).statSync(exe).isFile() ? exe : undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
await page.goto('file://' + path.join(here, '../dist/tankforge-range.html'));
await page.waitForFunction(() => window.__tf, null, { timeout: 60000 });
for (const lane of [-94, -80, -108]) for (const stab of ['none', 'vertical', 'two_plane']) {
  const r = await page.evaluate(([v, stab, lane]) => {
    const t = window.__tf; const G = t.G;
    t.pause(); t.setQuality('low'); t.finishThumbs(); t.select(v); t.startBattle();
    G.loadout.turrets[0].stabilizer = stab;
    t.place(lane + 4, 296, 0);
    t.advance(1, [], false);
    const errs = [];
    for (let i = 0; i < 90; i++) {
      G.cam.yaw = 0.003; G.cam.pitch = 0.004;
      t.advance(0.1, ['fwd'], false);
      const m = t.gunLine(0);
      const a = G.aimPoint;
      const d = [a[0] - m.pos[0], a[1] - m.pos[1], a[2] - m.pos[2]];
      const l = Math.hypot(...d);
      const c = (d[0] * m.dir[0] + d[1] * m.dir[1] + d[2] * m.dir[2]) / l;
      if (i > 10) errs.push(Math.acos(Math.min(1, c)) * 1000);
    }
    errs.sort((a, b) => a - b);
    const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
    return { stab, lane, speed: +(G.s.u * 3.6).toFixed(1), rms: +rms.toFixed(1), p90: +errs[Math.floor(errs.length * 0.9)].toFixed(1), max: +errs[errs.length - 1].toFixed(1) };
  }, [veh, stab, lane]);
  console.log(JSON.stringify(r));
  rows.push(r);
}
await browser.close();
const two = rows.filter((r) => r.stab === 'two_plane');
const none = rows.filter((r) => r.stab === 'none');
const ok = two.every((r) => r.rms < 4 && r.max < 12) && two.every((r, i) => r.rms < none[i].rms / 4);
console.log(ok ? 'ok   the two-plane stabilizer holds the gun within a few mrad' : 'FAIL two-plane stabilizer error too large');
process.exit(ok ? 0 : 1);

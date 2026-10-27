// One round from __DIST m (default 1500) into a range target; consecutive frames of the X-ray replay
// window from when it opens (user report: at long range the ballistic replay flickers).
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.finishThumbs(); await frames(2); tf.select('su_t72a'); await frames(3); tf.startBattle(); await frames(3); tf.pause(true);
const e = G.enemies.find(q => q.id === (window.__TGT || 'de_tiger_e')); x.reviveRangeEnemy(e); tf.advance(0.1, [], false);
const shell = x.data.projectiles[window.__SHELL || x.data.vehicles.su_t72a.weapons.main_gun.ammo[0]];
const D = window.__DIST || 1500, b = e.veh.body, c = b.worldPoint([0, 1.2, 0.5]), o = b.worldPoint([30, 4, D]), d0 = c.map((q, i) => q - o[i]), tof = Math.hypot(...d0) / shell.muzzle_velocity_ms, d = [d0[0], d0[1] + 0.5 * 9.81 * tof * tof * 1.08, d0[2]], L = Math.hypot(...d), dir = d.map(q => q / L);
const sh = { s: x.newShot(o, dir, shell), shell, age: 0, origin: o.slice(), travelled: 0, projectile_source: null };
sh.replayDischarge = G.localReplay?.acceptDischarge(1, { weapon_instance: G.loadout.turrets[0].guns[0].damageKey, projectile_id: shell.id, seed: 701, time_s: G.time || 0, origin: o, direction: dir, velocity_m_s: sh.s.vel, flight_trust: 'local_ballistic_world_segments_legacy_contact', projectile_source: null });
sh.replayLease = G.localReplay?.retainProjectile(sh.replayDischarge);
G.shots.push(sh);
const hc = x.hitcam, log = [];
for (let s = 0; s < 60 * 6 && !hc.cur; s++) tf.advance(1 / 60, [], false);
const out = { shell: shell.id, opened: !!hc.cur };
let k = 0; const cv = document.createElement('canvas'), g2 = cv.getContext('2d', { willReadFrequently: true }); let prev = null; const stats = [];
document.querySelectorAll('#hitcam .hc-title, #hitcam .hc-foot, #hitcam .hc-who, #hitcam .hc-zoom, #hitcam small, #hitcam p').forEach(q => q.style.visibility = 'hidden');
for (let s = 0; s < 60 * 7 && hc.cur; s++) {
  const draw = s < (window.__UNTIL || 1e9);
  const snap = draw && s >= (window.__FROM || 20) && k < (window.__SHOTS || 16) && s % (window.__EVERY || 1) === 0;
  tf.advance(1 / 60, [], draw);
  const S = hc.cur?.session, fr = hc.cur?.frame;
  const cm = hc.cur?.cam; log.push([s, +(S?.filmTimeS ?? -1).toFixed(2), cm ? +cm.near?.toFixed(3) : null, cm ? Math.round(cm.far) : null, cm && cm.near ? +((cm.far * cm.far) / (cm.near * 16777216)).toFixed(3) : null]);
  if (draw && window.__STATS) {
    const el2 = document.querySelector('#hitcam .hc-frame'), R2 = el2?.getBoundingClientRect(), c3 = document.getElementById('view'), sc = c3.width / c3.clientWidth;
    if (R2 && R2.width > 0) {
      const w = 96, h = 54; cv.width = w; cv.height = h; g2.drawImage(c3, R2.left * sc, R2.top * sc, R2.width * sc, R2.height * sc, 0, 0, w, h);
      const px = g2.getImageData(0, 0, w, h).data; let lum = 0, diff = 0; const cur = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) { cur[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11; lum += cur[i]; if (prev) diff += Math.abs(cur[i] - prev[i]); }
      stats.push([s, +(lum / (w * h)).toFixed(1), prev ? +(diff / (w * h)).toFixed(2) : null]); prev = cur;
    }
  }
  if (snap) { await pyShot('f' + String(k).padStart(2, '0')); k++; }
}
const el = document.querySelector('#hitcam .hc-frame'), r = el?.getBoundingClientRect();
out.rect = r ? [r.left, r.top, r.width, r.height].map(Math.round) : null;
out.stats = stats; out.log = log.filter((q, i) => i % 5 === 0).slice(0, 60); out.canvases = [...document.querySelectorAll('#hitcam canvas')].length;
return out;

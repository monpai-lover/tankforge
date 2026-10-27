// Several rounds on one target: how long after each round's hit is its impact shown on the X-ray
// replay (user report: rounds after the first appear only after a whole animation's wait)?
// __GAP: seconds between rounds (default 1.5); __SHELL; __TGT.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.finishThumbs(); await frames(2); tf.select('su_t72a'); await frames(3); tf.startBattle(); await frames(3); tf.pause(true);
const e = G.enemies.find(q => q.id === (window.__TGT || 'de_tiger_e')); x.reviveRangeEnemy(e); tf.advance(0.1, [], false);
const shell = x.data.projectiles[window.__SHELL || 'heatfs_35'], hc = x.hitcam, gap = window.__GAP || 1.5, n = window.__N || 4;
const fire = (k) => {
  const b = e.veh.body, c = b.worldPoint([0.3 * (k % 3 - 1), 1.1 + 0.1 * (k % 2), 2.4]), o = b.worldPoint([3 + 0.2 * k, 1.6, 100]), d = c.map((q, i) => q - o[i]), L = Math.hypot(...d), dir = d.map(q => q / L);
  const sh = { s: x.newShot(o, dir, shell), shell, age: 0, origin: o.slice(), travelled: 0, projectile_source: null };
  sh.replayDischarge = G.localReplay?.acceptDischarge(1, { weapon_instance: G.loadout.turrets[0].guns[0].damageKey, projectile_id: shell.id, seed: 700 + k, time_s: G.time || 0, origin: o, direction: dir, velocity_m_s: sh.s.vel, flight_trust: 'local_ballistic_world_segments_legacy_contact', projectile_source: null });
  sh.replayLease = G.localReplay?.retainProjectile(sh.replayDischarge);
  G.shots.push(sh);
};
let hits = []; const so = e.combat.shoot.bind(e.combat); e.combat.shoot = (...a) => { const r = so(...a); if (r) hits.push(+(G.time).toFixed(2)); return r; };
const seen = new Map(), info = new Map();
let t = 0, fired = 0;
for (let s = 0; s < 60 * (gap * n + 8); s++) {
  if (fired < n && t >= fired * gap) fire(fired++);
  tf.advance(1 / 60, [], s % 15 === 0); t += 1 / 60;
  const S = hc.cur?.session;
  if (!S) continue;
  const fr = hc.cur.frame; if (s % 3 === 0) (window.__TR = window.__TR || []).push([+t.toFixed(2), fr?.traces?.length ?? null, fr?.projectiles?.length ?? null, S.events.length]);
  if (window.__SHOT_AT && Math.abs(t - window.__SHOT_AT) < 0.009) await pyShot('followup');
  const phys = S.clock.physicalAt(S.filmTimeS);
  for (const ev of S.events) {
    if (!info.has(ev.id)) info.set(ev.id, { accepted: +t.toFixed(2), local: S.localStart.has(ev.id), contact: +ev.contact_s.toFixed(2) });
    const start = S.localStart.get(ev.id), now = start === undefined ? phys : (() => { const f = S.filmTimeS - start, launch = Number.isFinite(ev.launch_s) ? ev.launch_s : ev.contact_s; return ev.contact_s + Math.max(0, f); })();
    if (!seen.has(ev.id) && now >= ev.contact_s) seen.set(ev.id, +t.toFixed(2));
  }
}
return { trace: (window.__TR || []).filter((r, i) => i % 4 === 0).slice(0, 30), gap, hits, events: [...info.entries()].map(([id, v]) => ({ ...v, shown: seen.get(id) ?? null, delay: seen.has(id) ? +(seen.get(id) - v.accepted).toFixed(2) : null })), session: hc.cur ? { film: +hc.cur.session.filmTimeS.toFixed(2), end: +hc.cur.session.endFilm.toFixed(2) } : null };

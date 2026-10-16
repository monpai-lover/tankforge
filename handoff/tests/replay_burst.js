// An autocannon burst at one target: does the X-ray replay show the successive rounds?
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.finishThumbs(); await frames(2); tf.select('su_t72a'); await frames(3); tf.startBattle(); await frames(3); tf.pause(true);
const e = G.enemies.find(q => q.id === (window.__TGT || 'de_tiger_e')); x.reviveRangeEnemy(e); tf.advance(0.1, [], false);
const shell = x.data.projectiles[window.__SHELL || 'heatfs_35'], hc = x.hitcam, log = [];
const fire = (k) => {
  const b = e.veh.body, c = b.worldPoint([0.3 * (k % 3 - 1), 1.1 + 0.1 * (k % 2), 2.4]), o = b.worldPoint([3 + 0.2 * k, 1.6, 100]), d = c.map((q, i) => q - o[i]), L = Math.hypot(...d), dir = d.map(q => q / L);
  const sh = { s: x.newShot(o, dir, shell), shell, age: 0, origin: o.slice(), travelled: 0, projectile_source: null };
  sh.replayDischarge = G.localReplay?.acceptDischarge(1, { weapon_instance: G.loadout.turrets[0].guns[0].damageKey, projectile_id: shell.id, seed: 500 + k, time_s: G.time || 0, origin: o, direction: dir, velocity_m_s: sh.s.vel, flight_trust: 'local_ballistic_world_segments_legacy_contact', projectile_source: null });
  sh.replayLease = G.localReplay?.retainProjectile(sh.replayDischarge);
  G.shots.push(sh);
};
let shots = 0, hits = 0; const so = e.combat.shoot.bind(e.combat); e.combat.shoot = (...a) => { const r = so(...a); if (r) hits++; return r; };
for (let s = 0; s < 8 * 30; s++) {
  if (s % 6 === 0 && shots < 10) { fire(shots); shots++; }
  tf.advance(1 / 30, [], s % 10 === 0);
  const cur = hc.cur, f = cur?.frame || null;
  if (s % 10 === 0) log.push({ t: +(G.time || 0).toFixed(2), shots, hits, active: !!cur, events: cur?.session.events.length ?? 0, film: cur ? +cur.session.filmTimeS.toFixed(2) : null, phys: cur ? +cur.session.clock.physicalAt(cur.session.filmTimeS).toFixed(2) : null, bodies: f?.projectiles?.length ?? null, traces: f?.traces?.length ?? null, alive: e.alive });
  if (s === 60 || s === 120) await pyShot('burst_' + s);
}
return log;

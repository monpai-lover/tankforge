// Three rounds at one target 7 s apart: the replay should stay in one session with all three hits.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.select('su_t72a'); await frames(2); tf.finishThumbs(); tf.startBattle(); await frames(3); tf.pause(true);
const e = G.enemies.find(q => q.id === 'de_tiger_e');
const shell = x.data.projectiles[window.__SHELL || 'apc_50_pzgr39'];
x.reviveRangeEnemy(e); tf.advance(0.1, [], false);
const hc = x.hitcam, log = [];
let sessions = new Set();
const fire = (k) => {
  const b = e.veh.body, c = b.worldPoint([-0.4 + k * 0.4, 1.35, 2.6]), o = b.worldPoint([2 + k, 2.0, 30]), d = c.map((q, i) => q - o[i]), L = Math.hypot(...d), dir = d.map(q => q / L);
  const sh = { s: x.newShot(o, dir, shell), shell, age: 0, origin: o.slice(), travelled: 0, projectile_source: null };
  sh.replayDischarge = G.localReplay?.acceptDischarge(1, { weapon_instance: G.loadout.turrets[0].guns[0].damageKey, projectile_id: shell.id, seed: 1000 + k, time_s: G.time || 0, origin: o, direction: dir, velocity_m_s: sh.s.vel, flight_trust: 'local_ballistic_world_segments_legacy_contact', projectile_source: null });
  sh.replayLease = G.localReplay?.retainProjectile(sh.replayDischarge);
  G.shots.push(sh);
};
for (let k = 0; k < 3; k++) {
  fire(k);
  for (let s = 0; s < 7 * 30; s++) {
    tf.advance(1 / 30, [], s % 30 === 0);
    const cur = hc.cur;
    if (cur) sessions.add(cur.session);
    if (s % 30 === 0) log.push({ t: +(G.time || 0).toFixed(1), active: !!cur, events: cur?.session.events.length ?? 0, film: cur ? +cur.session.filmTimeS.toFixed(2) : null, end: cur ? +cur.session.endFilm.toFixed(2) : null, finished: cur?.session.finished ?? null, alive: e.alive });
    if (k === 2 && s === 45) await pyShot('third_hit');
    if (k === 1 && s === 45) await pyShot('second_hit');
  }
}
return { sessions: sessions.size, log };

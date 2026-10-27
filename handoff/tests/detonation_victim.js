const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const log = (...a) => console.log('@@', ...a.map(v => typeof v === 'string' ? v : JSON.stringify(v)));
await tf.coreReady().catch(e => null);
tf.select(window.__VEH || 'su_t72a'); await frames(2);
tf.finishThumbs(); tf.startBattle(); await frames(3); log('mode', G.mode, 'enemies', (G.enemies||[]).length);
tf.pause(true);
const e = G.enemies.find(q => q.alive && q.replayEntity != null) || G.enemies[0];
log('player', G.id, 'shooter', e.id, e.replayEntity, 'actor', G.localReplay.actor(e.replayEntity));
const shell = x.data.projectiles['apfsds_125_3bm22'] || Object.values(x.data.projectiles).find(s => s.kind === 'apfsds');
const racks = G.bundle.modules.map((m, i) => ({ m, i })).filter(q => q.m.kind === 'ammo_rack');
log('racks', racks.map(q => q.m.id));
const b = G.veh.body;
let rep = null;
const orig = G.combat.shoot.bind(G.combat); G.combat.shoot = (...a) => { const r = orig(...a); rep = r; return r; };
for (let k = 0; k < racks.length && !G.cstate.destroyed; k++) {
  const c = racks[k].m.center, cw = b.worldPoint(Array.isArray(c) ? c : [c.x, c.y, c.z]);
  const side = b.worldDir([1, 0.15, 0.1]);
  const o = cw.map((v, i) => v + side[i] * 30), dir = cw.map((v, i) => v - o[i]); const L = Math.hypot(...dir); for (let i = 0; i < 3; i++) dir[i] /= L;
  const t0 = G.time, v = dir.map(q => q * 1700);
  const d = G.localReplay.acceptDischarge(e.replayEntity, { weapon_instance: 'gun:0:0', projectile_id: shell.id, seed: 777 + k, time_s: t0, origin: o, direction: dir, velocity_m_s: v, flight_trust: 'local_ballistic_world_segments_legacy_contact' });
  G.localReplay.retainProjectile(d);
  const p1 = cw.map((q, i) => q + dir[i] * 2), p0 = o;
  const tEnd = t0 + Math.hypot(...p1.map((q, i) => q - o[i])) / 1700;
  G.localReplay.recordProjectileStep(d, { start_time_s: t0, end_time_s: tEnd, from: o, to: p1, velocity_m_s: v });
  x.selfMissileHit(cw.map((q, i) => q - dir[i] * 3), dir, shell, 1700, { name: 'test' }, d, 30, tEnd, p1);
  log('hit', k, rep && { title: rep.title, events: rep.events, destroyed: rep.caps?.destroyed, replay: !!rep.replay, unavailable: rep.replay_unavailable }, 'hitcam', tf.hitcam(), 'victim', x.hitcam.victimActive);
}
const N = window.__STEPS || 8;
for (let s = 0; s < N; s++) {
  const t0 = performance.now();
  tf.advance(2.5, [], s % 4 === 0);
  log('step', s, 'ms', Math.round(performance.now() - t0), 'hitcam', tf.hitcam(), 'victim', x.hitcam.victimActive, 'fire_s', G.cstate?.fire_s, 'destroyed', G.caps?.destroyed);
  if (s === 1) await pyShot('victim_s1');
}
tf.pause(false);
return 'done';

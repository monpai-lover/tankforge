const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const log = (...a) => console.log('@@', ...a.map(v => typeof v === 'string' ? v : JSON.stringify(v)));
await tf.coreReady().catch(e => null);
tf.finishThumbs(); tf.select(window.__VEH || 'su_t72a'); await frames(2);
tf.finishThumbs(); tf.startBattle(); await frames(3);
tf.pause(true);
const targetId = window.__TARGET || 'de_pz3_j';
const e = G.enemies.find(q => q.id === targetId && q.alive);
log('mode', G.mode, 'enemies', G.enemies.map(q => q.id + (q.alive ? '' : '+dead') + (q.combat ? 'c' : '')));
if (!e) return 'no target';
const g = G.loadout.turrets[0].guns[0];
const ammo = g.ammo.map(a => a.shell); const shell = ammo.find(s => /apfsds/.test(s.kind)) || ammo[0];
const racks = e.bundle.modules.map((m, i) => ({ m, i })).filter(q => q.m.kind === 'ammo_rack');
log('shell', shell.id, shell.kind, 'racks', racks.map(q => [q.m.id, q.m.rounds, e.cstate?.rack_fill?.[q.i]]));
const out = { shots: [] };
for (let k = 0; k < racks.length && e.alive; k++) {
  const c = racks[k].m.center, cw = e.veh.body.worldPoint(Array.isArray(c) ? c : [c.x, c.y, c.z]);
  const side = e.veh.body.worldDir([1, 0.15, 0.1]);
  const o = cw.map((v, i) => v + side[i] * 40), dir = cw.map((v, i) => v - o[i]); const L = Math.hypot(...dir); for (let i = 0; i < 3; i++) dir[i] /= L;
  const sh = { s: x.newShot(o, dir, shell), shell, age: 0, origin: o.slice(), travelled: 0, projectile_source: null };
  const seed = 12345 + k;
  sh.replayDischarge = G.localReplay?.acceptDischarge(1, { weapon_instance: g.damageKey, projectile_id: shell.id, seed, time_s: G.time || 0, origin: o, direction: dir, velocity_m_s: sh.s.vel, flight_trust: 'local_ballistic_world_segments_legacy_contact', projectile_source: null });
  sh.replayLease = G.localReplay?.retainProjectile(sh.replayDischarge);
  G.shots.push(sh);
  const t0 = performance.now();
  tf.advance(0.2, [], false);
  log('shot', k, 'ms', Math.round(performance.now() - t0), 'last', G.lastCombat, 'alive', e.alive, 'hitcam', tf.hitcam());
  out.shots.push(G.lastCombat);
}
out.alive = e.alive;
const H = x.hitcam;
for (const t of [1.2, 2.2, 3.2]) { if (!H.active) break; H.cur.t = Math.max(H.cur.t, t); tf.advance(1 / 60, [], true); await frames(2); out['stage' + t] = H.stage().name; await pyShot('look_t' + t); }
tf.pause(false);
return out;

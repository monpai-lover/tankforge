// Ammo-rack detonation of a target while the player is in gunner sight (aim) mode, drawing every frame.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const log = (...a) => console.log('@@', ...a.map(v => typeof v === 'string' ? v : JSON.stringify(v)));
const errors = []; const oe = console.error.bind(console); console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 300)); oe(...a); };
window.addEventListener('error', (e) => errors.push('window.error ' + e.message));
await tf.coreReady().catch(e => null);
tf.finishThumbs(); tf.select(window.__VEH || 'su_t72a'); await frames(2); tf.startBattle(); await frames(3);
const e = G.enemies.find(q => q.id === (window.__TARGET || 'de_pz3_j') && q.alive);
// lay the gun on the target and enter the sight
const tb = e.veh.body.origin();
G.cam.yaw = Math.atan2(tb[0] - G.s.x, tb[2] - G.s.z); G.cam.pitch = Math.atan2(tb[1] + 1 - 2.2, Math.hypot(tb[0] - G.s.x, tb[2] - G.s.z));
tf.toggleSight(); tf.advance(2, [], false); tf.advance(1 / 60, [], true); await frames(2);
log('view', G.view, 'zoom', G.zoomIdx);
await pyShot('sight_before');
tf.pause(true);
const g = G.loadout.turrets[0].guns[0], shell = g.ammo.map(a => a.shell).find(s => /apfsds|apcbc|apc|ap/.test(s.kind)) || g.ammo[0].shell;
const racks = e.bundle.modules.filter(m => m.kind === 'ammo_rack');
const v3a = (p) => Array.isArray(p) ? p : [p.x, p.y, p.z];
let k = 0;
for (const r of racks) {
  if (!e.alive) break;
  const cw = e.veh.body.worldPoint(v3a(r.center)), side = e.veh.body.worldDir([1, 0.15, 0.1]);
  const o = cw.map((v, i) => v + side[i] * 40), dir = cw.map((v, i) => v - o[i]); const L = Math.hypot(...dir); for (let i = 0; i < 3; i++) dir[i] /= L;
  const sh = { s: x.newShot(o, dir, shell), shell, age: 0, origin: o.slice(), travelled: 0, projectile_source: null };
  sh.replayDischarge = G.localReplay?.acceptDischarge(1, { weapon_instance: g.damageKey, projectile_id: shell.id, seed: 4000 + k++, time_s: G.time || 0, origin: o, direction: dir, velocity_m_s: sh.s.vel, flight_trust: 'local_ballistic_world_segments_legacy_contact', projectile_source: null });
  sh.replayLease = G.localReplay?.retainProjectile(sh.replayDischarge);
  G.shots.push(sh);
  for (let f = 0; f < 6; f++) tf.advance(1 / 60, [], true);
  log('after shot', G.lastCombat?.title, 'alive', e.alive, 'view', G.view, 'hitcam', tf.hitcam(), 'errors', errors.length);
}
const t0 = performance.now(); let drawn = 0;
for (let s = 0; s < 40; s++) { const a = performance.now(); tf.advance(1 / 60, [], true); drawn++; if (s % 10 === 0) log('frame', s, 'ms', Math.round(performance.now() - a), 'hitcam', tf.hitcam(), 'errors', errors.length); }
await frames(2); await pyShot('sight_after');
tf.pause(false); await frames(10);
return { view: G.view, alive: e.alive, errors: errors.slice(0, 10), frameError: G.frameError || null, fpsLoop: G.fps };

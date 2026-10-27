const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); const st = document.createElement('style'); st.textContent = '#hud, .hud, [id^=hud], #lock-hint, #toast, .toast {display:none !important}'; document.head.append(st);
tf.select('su_t72a'); await frames(2); tf.finishThumbs(); tf.startBattle(); await frames(3); tf.pause(true);
const e = G.enemies[0], shell = x.data.projectiles[x.data.vehicles.de_pz3_j.weapons.main_gun.ammo[0]], b = G.veh.body;
const v3a = (p) => Array.isArray(p) ? p : [p.x, p.y, p.z];
const track = G.bundle.modules.find(m => m.kind === 'track' && v3a(m.center)[0] > 0) || G.bundle.modules.find(m => m.kind === 'track');
const out = { player: G.id, track: track?.id };
for (let k = 0; k < 4 && G.caps?.track_right !== false && G.caps?.track_left !== false; k++) {
  const c = v3a(track.c || track.center), cw = b.worldPoint(c), side = b.worldDir([Math.sign(c[0]) || 1, 0.1, 0.05]);
  const o = cw.map((v, i) => v + side[i] * 30), dir = cw.map((v, i) => v - o[i]); const L = Math.hypot(...dir); for (let i = 0; i < 3; i++) dir[i] /= L;
  const t0 = G.time, vel = dir.map(q => q * 800);
  const d = G.localReplay.acceptDischarge(e.replayEntity, { weapon_instance: 'gun:0:0', projectile_id: shell.id, seed: 31 + k, time_s: t0, origin: o, direction: dir, velocity_m_s: vel, flight_trust: 'local_ballistic_world_segments_legacy_contact' });
  G.localReplay.retainProjectile(d); const p1 = cw.map((q, i) => q + dir[i] * 2), tEnd = t0 + Math.hypot(...p1.map((q, i) => q - o[i])) / 800;
  G.localReplay.recordProjectileStep(d, { start_time_s: t0, end_time_s: tEnd, from: o, to: p1, velocity_m_s: vel });
  x.selfMissileHit(cw.map((q, i) => q - dir[i] * 3), dir, shell, 800, { name: 'test' }, d, 30, tEnd, p1);
}
x.hitcam.hide('test'); if (G.caps?.track_right !== false) { G.caps = { ...G.caps, track_right: false }; out.forced = true; } tf.advance(1/60, [], false); G.veh.trackChains[1] = null; G.veh.trackViews[1] = { unsupported: true, reason: 'test_unsupported' };
out.caps = { l: G.caps?.track_left, r: G.caps?.track_right, move: G.caps?.can_move };
out.support = G.veh.trackSupport; out.views = Object.fromEntries([1, -1].map(s => [s, G.veh.trackViews[s] && { unsupported: G.veh.trackViews[s].unsupported, cut: G.veh.trackViews[s].cutPin, reason: G.veh.trackViews[s].reason }]));
const p0 = [G.s.x, G.s.z];
tf.advance(3, ['fwd'], false);
out.moved = Math.hypot(G.s.x - p0[0], G.s.z - p0[1]); out.speeds = { L: G.info.trackSpeedL, R: G.info.trackSpeedR };
const o2 = b.origin(), rs = b.worldDir([1, 0, 0]);
G.camOverride = { pivot: [o2[0], o2[1] + 0.6, o2[2]], fov: 0.8, dist: 9 }; G.cam.yaw = Math.atan2(-rs[0], -rs[2]) + 0.6; G.cam.pitch = -0.3;
tf.advance(1 / 60, [], true); await frames(2); await pyShot('ptrack_fallback');
return out;

const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const log = (...a) => console.log('@@', ...a.map(v => typeof v === 'string' ? v : JSON.stringify(v)));
await tf.coreReady().catch(e => null); const st = document.createElement('style'); st.textContent = '#hud, .hud, #battle-hud, [id^=hud], #lock-hint, #toast, .toast {display:none !important}'; document.head.append(st);
tf.select('su_t72a'); await frames(2); tf.finishThumbs(); tf.startBattle(); await frames(3); tf.pause(true);
const e = G.enemies.find(q => q.id === (window.__TARGET || 'de_pz3_j'));
const shell = x.data.projectiles[x.data.vehicles.de_pz3_j.weapons.main_gun.ammo[0]];
const v3a = (p) => Array.isArray(p) ? p : [p.x, p.y, p.z];
let last = null; const orig = G.combat.shoot.bind(G.combat); G.combat.shoot = (...a) => { const r = orig(...a); last = r; return r; };
window.__fire = null; const fire = (localPoint, localFrom) => {
  const b = e.veh.body, cw = b.worldPoint(localPoint), ow = b.worldPoint(localFrom), dir = cw.map((q, i) => q - ow[i]); const L = Math.hypot(...dir); for (let i = 0; i < 3; i++) dir[i] /= L;
  const sh = { s: x.newShot(ow, dir, shell), shell, age: 0, origin: ow.slice(), travelled: 0, projectile_source: null };
  sh.replayDischarge = G.localReplay?.acceptDischarge(1, { weapon_instance: G.loadout.turrets[0].guns[0].damageKey, projectile_id: shell.id, seed: 99 + Math.floor(Math.random() * 1e6), time_s: G.time || 0, origin: ow, direction: dir, velocity_m_s: sh.s.vel, flight_trust: 'local_ballistic_world_segments_legacy_contact', projectile_source: null });
  sh.replayLease = G.localReplay?.retainProjectile(sh.replayDischarge);
  last = null; G.shots.push(sh); tf.advance(0.15, [], false); x.hitcam.hide('test');
  return last && { outcome: last.outcome, events: last.events, modules: last.modules?.map(m => [m.id, m.kind, Math.round(m.health), m.destroyed]) };
};
const mods = e.bundle.modules.map(m => ({ id: m.id, kind: m.kind, c: v3a(m.center) }));
log('modules', mods.filter(m => /track|barrel|breech/.test(m.kind)));
const track = mods.find(m => m.kind === 'track' && m.c[0] < 0) || mods.find(m => m.kind === 'track');
const barrel = mods.find(m => m.kind === 'gun_barrel');
const out = {};
for (let i = 0; i < 3 && e.caps?.track_left !== false && e.caps?.track_right !== false; i++) out['track' + i] = fire(track.c, [track.c[0] - 30 * Math.sign(track.c[0] || -1) * -1, track.c[1] + 0.3, track.c[2] + 2]);
out.capsAfterTrack = { left: e.caps?.track_left, right: e.caps?.track_right };
out.trackSupport = e.veh.trackSupport; out.views = Object.fromEntries([1, -1].map(s => [s, e.veh.trackViews[s] && { unsupported: e.veh.trackViews[s].unsupported, cut: e.veh.trackViews[s].cutPin, reason: e.veh.trackViews[s].reason }]));
if (barrel) for (let i = 0; i < 3; i++) { const b = barrel.c; out['barrel' + i] = fire(b, [b[0] + 25, b[1] + 1, b[2] + 3]); }
const bi = e.bundle.modules.findIndex(m => m.kind === 'gun_barrel'); out.barrelHealth = e.cstate?.modules?.[bi]; out.caps = e.caps;
const tb = e.veh.body.origin(); const side = e.veh.body.worldDir([1, 0, 0]);
tf.advance(3, [], false);
const shotAt = async (name, sideSign, pitch = -0.25, dist = 9) => { G.camOverride = { pivot: [tb[0], tb[1] + 1.2, tb[2]], fov: 0.75, dist }; G.cam.yaw = Math.atan2(-side[0] * sideSign, -side[2] * sideSign) + 0.5; G.cam.pitch = pitch; tf.advance(1 / 60, [], true); await frames(2); await pyShot(name); };
await shotAt('damage_right', 1); await shotAt('damage_left', -1); G.camOverride = { pivot: [tb[0], tb[1] + 1.8, tb[2]], fov: 0.5, dist: 6 }; G.cam.yaw = Math.atan2(-side[0], -side[2]) + 1.9; G.cam.pitch = -0.2; tf.advance(1 / 60, [], true); await frames(2); await pyShot('damage_close');

out.surfaceAvail = G.combat.surfaceOwner.actors.get(e.combatKey)?.available; out.visualBroken = e.model.damageVisuals?.key; out.barrelVisible = e.model.turrets[0].guns[0].barrel.visible; out.repAfter = fire(track.c, [track.c[0] + 30, track.c[1] + 0.3, track.c[2] + 2]); return out;

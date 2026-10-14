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
const fire2 = (localPoint, localFrom) => {
  const b = e.veh.body, cw = b.worldPoint(localPoint), ow = b.worldPoint(localFrom), dir = cw.map((q, i) => q - ow[i]); const L = Math.hypot(...dir); for (let i = 0; i < 3; i++) dir[i] /= L;
  const sh = { s: x.newShot(ow, dir, shell), shell, age: 0, origin: ow.slice(), travelled: 0, projectile_source: null };
  sh.replayDischarge = G.localReplay?.acceptDischarge(1, { weapon_instance: G.loadout.turrets[0].guns[0].damageKey, projectile_id: shell.id, seed: 777, time_s: G.time || 0, origin: ow, direction: dir, velocity_m_s: sh.s.vel, flight_trust: 'local_ballistic_world_segments_legacy_contact', projectile_source: null });
  sh.replayLease = G.localReplay?.retainProjectile(sh.replayDischarge);
  last = null; G.shots.push(sh); tf.advance(0.1, [], false);
  return last && { outcome: last.outcome, events: last.events };
};
const bc = barrel.c; out.hit = fire2(bc, [bc[0] + 25, bc[1] + 1, bc[2] + 3]);
const H = x.hitcam; out.active = H.active;
for (const t of [0.8, 3.0]) { if (!H.active) break; H.cur.t = Math.max(H.cur.t, t); tf.advance(1 / 60, [], true); await frames(2); out['stage' + t] = H.stage().name; await pyShot('rb_t' + t); }
const walk = (n, acc) => { if (n.brokenGun) acc.push(['mirror', n.visible]); if (n.barrelGun) acc.push(['barrel', n.visible]); n.children.forEach(c => walk(c, acc)); return acc; };
out.snapNodes = H.cur ? walk(H.cur.target.model.root, []) : null;
return out;

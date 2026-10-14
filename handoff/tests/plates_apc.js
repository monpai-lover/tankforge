const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const log = (...a) => console.log('@@', ...a.map(v => typeof v === 'string' ? v : JSON.stringify(v)));
await tf.coreReady().catch(e => null);
tf.select('su_t72a'); await frames(2);
tf.finishThumbs(); tf.startBattle(); await frames(3);
tf.pause(true);
const shellId = x.data.vehicles.de_pz3_j.weapons.main_gun.ammo[0];
const shell = x.data.projectiles[shellId];
const v3a = (p) => Array.isArray(p) ? p : [p.x, p.y, p.z];
let last = null; const orig = G.combat.shoot.bind(G.combat); G.combat.shoot = (...a) => { const r = orig(...a); last = r; return r; };
const rows = [];
for (const e of G.enemies) {
  const plates = e.bundle.armor || [];
  for (const p of plates) {
    e.alive = false; const ok = x.reviveRangeEnemy(e); if (!ok) { rows.push({ veh: e.id, plate: p.id, zone: p.zone, t_mm: p.thickness_mm, outcome: 'revive_failed', firstContact: '' }); continue; }
    let c = v3a(p.center), n = v3a(p.normal);
    const turret = p.zone.startsWith('turret') || p.zone === 'gun_mantlet';
    if (turret && e.turretYaw && e.turret) { const piv = e.turret.position_m, cy = Math.cos(e.turretYaw), sy = Math.sin(e.turretYaw), rot = (v) => [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy]; const r = rot([c[0] - piv[0], c[1], c[2] - piv[2]]); c = [r[0] + piv[0], r[1], r[2] + piv[2]]; n = rot(n); }
    const b = e.veh.body, cw = b.worldPoint(c), nw = b.worldDir(n);
    const dir = nw.map(q => -q), o = cw.map((q, i) => q + nw[i] * 25);
    if (o[1] < 0.3) continue; // floor plates: no shot from underground
    const sh = { s: x.newShot(o, dir, shell), shell, age: 0, origin: o.slice(), travelled: 0, projectile_source: null };
    sh.replayDischarge = G.localReplay?.acceptDischarge(1, { weapon_instance: G.loadout.turrets[0].guns[0].damageKey, projectile_id: shell.id, seed: 4242, time_s: G.time || 0, origin: o, direction: dir, velocity_m_s: sh.s.vel, flight_trust: 'local_ballistic_world_segments_legacy_contact', projectile_source: null });
    sh.replayLease = G.localReplay?.retainProjectile(sh.replayDischarge);
    last = null; G.shots.push(sh);
    try { tf.advance(0.1, [], false); } catch (err) { rows.push({ veh: e.id, plate: p.id, zone: p.zone, t_mm: p.thickness_mm, outcome: 'THROW ' + err.message, firstContact: '' }); continue; }
    x.hitcam.hide('test');
    const r = last, l = r?.layers?.[0];
    rows.push({ veh: e.id, plate: p.id, zone: p.zone, t_mm: p.thickness_mm, outcome: r?.outcome ?? 'none', hitPlate: l?.plate, hitT: l?.thickness_mm, ang: l && +l.angle_deg.toFixed(1), req: l && +l.required_mm.toFixed(0), pen: l && +l.pen_before_mm.toFixed(0), n_layers: r?.layers?.length, firstContact: r?.primary_geometry_contacts?.[0]?.physicalRole + ':' + (r?.primary_geometry_contacts?.[0]?.surfaceId || '').replace(/surface:vehicle\/0:/, '') });
  }
}
tf.pause(false);
return { shell: shell.id, pen: shell.penetration_curve?.slice(0, 3), rows };

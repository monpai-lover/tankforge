// Rifle-calibre MG on the M8 (user report: small machine guns go through its armour): the MG 34's
// AP and ball rounds at 100 m into every armor.json plate of the range M8 (its centre, along the
// normal and 30 deg off), through the live combat path (combatHit), the target revived each shot.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); tf.finishThumbs();
tf.select('su_t72a'); await frames(3); tf.startBattle(); await frames(5); tf.pause(true);
const E = G.enemies.find(e => e.id === 'us_m8');
const mg = x.data.machineGuns[window.__MG || 'mg34'], pen = mg.pen_mm_100m;
const shell = (ball) => ({ id: 'bullet_' + mg.id + (ball ? '_ball' : ''), name: mg.name, kind: 'ap', caliber_mm: mg.caliber_mm, mass_kg: mg.bullet_mass_g / 1e3, muzzle_velocity_ms: mg.muzzle_velocity_ms, explosive_mass_kg: 0, explosive_type: 'none', penetrator_material: 'steel', length_mm: mg.caliber_mm * 4, drag_coefficient: mg.drag_coefficient || 0.3,
  penetration_curve: [[0, 1.1], [100, 1], [500, 0.55], [1e3, 0.3]].map(([d, k]) => ({ distance_m: d, pen_mm: pen * k * (ball ? 0.4 : 1) })), ricochet_angle_deg: ball ? 62 : 70, normalization_deg: 0, fuse_delay_s: 0, fuse_sensitivity_mm: 0 });
const v3a = (p) => Array.isArray(p) ? p : [p.x, p.y, p.z], out = {};
let seed = 11;
for (const p of E.bundle.armor || []) {
  for (const ball of [false, true]) for (const off of [0, 30]) {
    E.alive = false; x.reviveRangeEnemy(E);
    let c = v3a(p.center), n = v3a(p.normal);
    const turret = p.zone.startsWith('turret') || p.zone === 'gun_mantlet';
    if (turret && E.turretYaw && E.turret) { const piv = E.turret.position_m, cy = Math.cos(E.turretYaw), sy = Math.sin(E.turretYaw), rot = (v) => [v[0] * cy + v[2] * sy, v[1], -v[0] * sy + v[2] * cy]; const r = rot([c[0] - piv[0], c[1], c[2] - piv[2]]); c = [r[0] + piv[0], r[1], r[2] + piv[2]]; n = rot(n); }
    // in along the normal, or turned 30 deg about the vertical
    const a = off * Math.PI / 180, nn = [n[0] * Math.cos(a) - n[2] * Math.sin(a), n[1], n[0] * Math.sin(a) + n[2] * Math.cos(a)];
    const b = E.veh.body, cw = b.worldPoint(c), nw = b.worldDir(nn), dir = nw.map(q => -q), o = cw.map((q, i) => q + nw[i] * 3);
    if (o[1] < 0.3) continue;
    let r = null;
    try { r = x.combatHit(E, o, dir, shell(ball), 740, 100, seed++, null, undefined, null, cw.map((q, i) => q + dir[i] * 0.6)); } catch (err) { r = { outcome: 'ERR' }; }
    const L = r?.layers?.[0];
    (out[`${p.id} ${p.thickness_mm}mm`] ||= []).push(`${ball ? 'ball' : 'AP'}${off}: ${r?.outcome}${L ? ` (${L.plate} need ${(L.required_mm ?? 0).toFixed(1)})` : ''} crew${r?.crew?.length || 0} mod${r?.modules?.length || 0}`);
  }
}
E.alive = false; x.reviveRangeEnemy(E);
return out;

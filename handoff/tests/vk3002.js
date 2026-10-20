// VK 30.02 (DB) (user's model and hitbox reference): the garage picture and X-ray, every plate shot
// along its normal through the protection analysis (75 mm Pzgr. 39/42 at 500 m, an MG 34 AP bullet
// at 100 m), then on the range: top speed on the road and a round from the main gun.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); tf.finishThumbs();
const id = window.__VEH || 'de_vk3002_db', out = { id };
tf.select(id); await frames(30);
out.selected = G.id; out.name = G.loadout?.name; out.plates = (x.data.vehicles[id].armor || []).length;
await pyShot('garage');
tf.setXray(true); await frames(10); await pyShot('xray'); tf.setXray(false); await frames(3);
x.setProtect(true); await frames(3);
const P = x.protection, v3 = (p) => [p.x, p.y, p.z], b = G.veh.body, mg = x.data.machineGuns.mg34;
const bullet = { id: 'bullet_mg34', name: 'MG 34', kind: 'ap', caliber_mm: 7.92, mass_kg: mg.bullet_mass_g / 1e3, muzzle_velocity_ms: mg.muzzle_velocity_ms, explosive_mass_kg: 0, explosive_type: 'none', penetrator_material: 'steel', length_mm: 31.7, drag_coefficient: 0.3, penetration_curve: [[0, 1.1], [100, 1], [500, 0.55], [1e3, 0.3]].map(([d, k]) => ({ distance_m: d, pen_mm: mg.pen_mm_100m * k })), ricochet_angle_deg: 70, normalization_deg: 0, fuse_delay_s: 0, fuse_sensitivity_mm: 0 };
const rows = [];
for (const [shell, dist] of [[x.data.projectiles.apcbc_75_pzgr39_42, 500], [bullet, 100]]) {
  P.shell = shell; P.dist = dist;
  for (const p of x.data.vehicles[id].armor) {
    if (p.half_u * p.half_v < 0.02) continue;
    const c = v3(p.center), n = v3(p.normal), o = c.map((q, i) => q + n[i] * 6), d = n.map(q => -q); // the analysis works in the hull frame
    let r = null; try { r = P.shoot(G.combatKey, o, d, 0); } catch (e) { r = { outcome: 'ERR ' + e.message.slice(0, 50) }; }
    const L = r?.layers?.[0];
    rows.push(`${shell.id.slice(0, 12)} ${p.id} ${p.thickness_mm}: ${r?.outcome}${L ? ` (${L.plate} ${L.thickness_mm} need ${Math.round(L.required_mm)} pen ${Math.round(r.pen_mm)})` : ''}`);
  }
}
out.rows = rows;
x.setProtect(false); await frames(3);
tf.startBattle(); await frames(10); tf.pause(true);
let vmax = 0; for (let k = 0; k < 60 * 40; k++) { tf.advance(1 / 60, ['fwd'], false); vmax = Math.max(vmax, Math.abs(G.s.u || 0)); }
out.top_kmh = Math.round(vmax * 3.6);
tf.advance(2, ['brake'], false);
let fired = 0; tf.fireGun(0, 0); for (let k = 0; k < 60 && !fired; k++) { tf.advance(1 / 60, [], false); fired = G.shots.length; } out.fired = fired; out.shell = G.shots[0]?.shell?.id;
tf.advance(1 / 60, [], true); await frames(2); await pyShot('battle');
return out;

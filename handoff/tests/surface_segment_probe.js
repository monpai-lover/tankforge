// Which finite flight segments does combat_surface_shoot reject ("invalid incoming surface segment")?
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.select('su_t72a'); await frames(2);
tf.finishThumbs(); tf.startBattle(); await frames(3);
tf.pause(true);
const shell = x.data.projectiles['apfsds_125_3bm22'];
const rows = [];
const norm = (v) => { const l = Math.hypot(...v); return v.map(q => q / l); };
const rot = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
for (const e of G.enemies.slice(0, 5)) {
  const surface = e.combat?.surfaceOwner?.actors.has(e.combatKey);
  const try1 = (name, o, d, end) => {
    x.reviveRangeEnemy(e);
    const shot = { shell, origin: o, dir: d, speed_ms: 1600, distance_m: 100, seed: 7, turret_yaw: e.turretYaw || 0, finite_end: end };
    try { const r = e.combat.shoot(e.combatKey, e.cstate, shot); rows.push({ veh: e.id, surface, name, outcome: r ? r.outcome : 'null' }); }
    catch (err) { rows.push({ veh: e.id, surface, name, outcome: 'THROW ' + err.message }); }
  };
  const tgt = [0, 1.2, 0];
  for (const [label, o] of [['front', [0, 1.2, 30]], ['side', [30, 1.2, 0]]]) {
    const d = norm(tgt.map((q, i) => q - o[i]));
    const at = (t) => o.map((q, i) => q + d[i] * t);
    try1(label + ' full 60m', o, d, at(60));
    try1(label + ' ends outside 10m', o, d, at(10));
    try1(label + ' short 0.05m step at surface', at(26), d, at(26.05));
    try1(label + ' zero length', o, d, o);
    try1(label + ' starts inside', at(30), d, at(60));
    for (const ang of [1e-6, 1e-5, 1e-4, 1e-3, 1e-2]) try1(label + ` dir off ${ang}rad`, o, rot(d, ang), at(60));
    try1(label + ' dir reversed', o, d.map(q => -q), at(60));
    try1(label + ' 2000m', at(-1940), d, at(60));
  }
}
tf.pause(false);
const sum = {}; for (const r of rows) { const k = r.name.replace(/^(front|side) /, "") + " => " + r.outcome; sum[k] = (sum[k] || 0) + 1; } return sum;

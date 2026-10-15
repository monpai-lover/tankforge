// Do filled AP rounds burst inside after penetrating? Compare outcome, bursts and crew per round.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.select('su_t72a'); await frames(2); tf.finishThumbs(); tf.startBattle(); await frames(3); tf.pause(true);
const P = x.data.projectiles, out = [];
const e = G.enemies.find(q => q.id === (window.__VEH || 'de_pz3_j'));
for (const id of (window.__SHELLS || 'apcbc_75_pzgr39,apcbc_75_m61_m3,apcbc_75_m61,apcbc_88_l56,aphe_76_br350a_l11,apbc_100_br412,apcbc_130_br482b').split(',')) {
  const sh = P[id]; let rows = [];
  let last = null; const so = e.combat.shoot.bind(e.combat); e.combat.shoot = (...a) => { const r = so(...a); last = r; return r; };
  for (let k = 0; k < 4; k++) {
    x.reviveRangeEnemy(e); tf.advance(0.05, [], false); last = null;
    const b = e.veh.body, c = b.worldPoint([0, 1.0, -0.6 + 0.4 * k]), o = b.worldPoint([30, 1.2, -0.6 + 0.4 * k]), d = c.map((q, i) => q - o[i]), L = Math.hypot(...d), dir = d.map(q => q / L);
    const s = { s: x.newShot(o, dir, sh), shell: sh, age: 0, origin: o.slice(), travelled: 0, projectile_source: null }; G.shots.push(s);
    for (let t = 0; t < 20 && G.shots.includes(s); t++) tf.advance(1 / 30, [], false);
    rows.push(last ? [last.outcome, (last.bursts || []).map(b => [b.inside, +(b.kg ?? b.explosive_kg ?? 0).toFixed(3)]), last.caps.crew_alive + '/' + last.caps.crew_total, last.caps.destroyed, last.events.filter(v => /fuse|burst|aphe|filler|detonat/.test(v))] : null);
  }
  e.combat.shoot = so;
  out.push({ id, kind: sh.kind, kg: sh.explosive_mass_kg, fuse: [sh.fuse_delay_s, sh.fuse_sensitivity_mm], rows });
}
return out;

window.__SHELL='he_300_tt_rocket'; window.__VEHS='de_pz3_j';
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.select('su_t72a'); await frames(2); tf.finishThumbs(); tf.startBattle(); await frames(3); tf.pause(true);
const sh = x.data.projectiles[window.__SHELL || 'he_122_of471'], out = [];
const calls = []; const nb = G.combat.nearBurst.bind(G.combat); G.combat.nearBurst = (...a) => { let r; try { r = nb(...a); } catch (err) { calls.push('THROW ' + err.message); throw err; } calls.push(r ? [r.title, r.caps.destroyed, a[2], a[3].explosive_mass_kg] : 'null'); return r; };
const shots = []; const so = G.combat.shoot.bind(G.combat); G.combat.shoot = (...a) => { const r = so(...a); shots.push(r ? [r.outcome, r.title, r.layers?.[0]?.thickness_mm, r.layers?.[0]?.plate, !!r.normal] : null); return r; };
const errs = []; const oe = console.error; console.error = (...a) => { errs.push(String(a[0]) + ' ' + String(a[1]?.message || '')); oe(...a); };
for (const e of G.enemies.filter(q => (window.__VEHS || 'us_m8,de_pz3_j').split(',').includes(q.id))) for (let k = 0; k < 3; k++) {
  x.reviveRangeEnemy(e); tf.advance(0.05, [], false);
  const b = e.veh.body, c = b.worldPoint([0, 1.0, 0]), o = b.worldPoint([30, 1.6, 2 * k - 3]), d = c.map((q, i) => q - o[i]), L = Math.hypot(...d), dir = d.map(q => q / L);
  const s = { s: x.newShot(o, dir, sh), shell: sh, age: 0, origin: o.slice(), travelled: 0, projectile_source: null };
  calls.length = 0; shots.length = 0;
  G.shots.push(s); for (let t = 0; t < 30 && G.shots.includes(s); t++) tf.advance(1 / 30, [], false);
  out.push({ veh: e.id, alive: e.alive, destroyed: e.caps?.destroyed, crew: e.caps?.crew_alive + '/' + e.caps?.crew_total, shots: shots.slice(), bursts: calls.slice(), last: G.lastCombat });
}
return { out, errs };

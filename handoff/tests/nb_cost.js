// The combat core's near burst: cost by charge on a range vehicle (__TGT), 12 calls each.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); tf.finishThumbs(); tf.setQuality('low');
tf.select('de_gepard'); await frames(3); tf.startBattle(); await frames(5); tf.pause(true);
const out = {};
for (const id of (window.__TGTS || 'us_m8,de_tiger_e').split(',')) {
  const E = G.enemies.find(e => e.id === id), b = E.veh.body, shell = x.data.projectiles.hei_35_kda;
  out[id] = {};
  const pt = b.worldPoint([0, 1.2, (E.box?.hl || 3) + 0.6]);
  out[id].box = E.box;
  for (const kg of [0.04, 0.15, 0.6, 2.4]) {
    const ts = [];
    for (let k = 0; k < 12; k++) {
      E.alive = false; x.reviveRangeEnemy(E);
      const t0 = performance.now();
      try { E.combat.nearBurst(E.combatKey, E.cstate, b.localPoint(pt), { ...shell, kind: 'he', explosive_mass_kg: kg, mass_kg: Math.max(shell.mass_kg, kg * 3) }, E.turretYaw || 0, 1000 + k, null, G.time); } catch (e) { out[id].err = String(e).slice(0, 160); }
      ts.push(performance.now() - t0);
    }
    ts.sort((a, c) => a - c);
    out[id][kg] = { median: +ts[6].toFixed(1), max: +ts.at(-1).toFixed(1) };
  }
}
return out;

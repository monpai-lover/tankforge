// The two near-burst paths of the combat core on a range vehicle: the surface catalog's
// (combat_surface_near_burst, what the game uses) and the armour-plate one (combat_near_burst):
// cost and damage of the same 35 mm HE contact burst, 40 times each.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); tf.finishThumbs(); tf.setQuality('low');
tf.select('de_gepard'); await frames(3); tf.startBattle(); await frames(5); tf.pause(true);
const out = {}, C = G.core, shell = x.data.projectiles.hei_35_kda;
for (const id of (window.__TGTS || 'us_m8,de_tiger_e').split(',')) {
  const E = G.enemies.find(e => e.id === id), b = E.veh.body;
  out[id] = {};
  for (const surface of [true, false]) {
    let ms = 0, crew = 0, mods = 0, err = null;
    for (let k = 0; k < 40; k++) {
      E.alive = false; x.reviveRangeEnemy(E);
      // around the hull front and sides, 0.15 m off the skin
      const pts = [[0, 1.2, E.box.hl + 0.15], [E.box.hw + 0.15, 1.0, 0.5], [-E.box.hw - 0.15, 1.4, -0.8], [0.3, E.box.top + 0.15, 0.2]], p = pts[k % 4];
      if (surface) E.combat.surfaceOwner?.pose(E.combatKey, G.time);
      const t0 = performance.now();
      let r = null;
      try { r = C.combatNearBurst(E.combatKey, E.cstate, p, { id: shell.id, ...shell, kind: 'he', explosive_type: 'tnt', explosive_mass_kg: 0.149 }, E.turretYaw || 0, 7000 + k, null, surface); } catch (e) { err = String(e).slice(0, 140); }
      ms += performance.now() - t0;
      if (r) { crew += r.crew?.length || 0; mods += (r.modules || []).filter(m => m.damage > 0).length; }
    }
    out[id][surface ? 'surface' : 'plates'] = { msPer: +(ms / 40).toFixed(1), crewHits: crew, moduleHits: mods, err };
  }
}
return out;

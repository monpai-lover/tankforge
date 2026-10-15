// HE vs targets: direct hits and ground bursts at distance; report kills, crew, modules.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.select('su_t72a'); await frames(2); tf.finishThumbs(); tf.startBattle(); await frames(3); tf.pause(true);
const P = x.data.projectiles;
const he = Object.values(P).filter(p => (p.kind === 'he') && p.explosive_mass_kg > 0).sort((a, b) => a.explosive_mass_kg - b.explosive_mass_kg);
const pick = [0.05, 0.3, 0.7, 1.5, 3.5, 6, 20].map(kg => he.reduce((b, p) => Math.abs(Math.log(p.explosive_mass_kg / kg)) < Math.abs(Math.log(b.explosive_mass_kg / kg)) ? p : b));
const shells = [...new Map(pick.map(p => [p.id, p])).values()];
const out = { shells: shells.map(s => [s.id, s.caliber_mm, s.explosive_mass_kg]), rows: [] };
const N = 4;
for (const e of G.enemies.filter(q => ['us_m8', 'de_pz3_j', 'su_t72a'].includes(q.id))) {
  for (const sh of shells) {
    const row = { veh: e.id, shell: sh.id, kg: sh.explosive_mass_kg };
    // direct hit on the side, centre
    let kills = 0, crew = 0;
    for (let k = 0; k < N; k++) {
      x.reviveRangeEnemy(e); tf.advance(0.05, [], false);
      const b = e.veh.body, c = b.worldPoint([0, 1.0, 0]), o = b.worldPoint([30, 1.6, 2 * k - 3]), d = c.map((q, i) => q - o[i]), L = Math.hypot(...d), dir = d.map(q => q / L);
      const s = { s: x.newShot(o, dir, sh), shell: sh, age: 0, origin: o.slice(), travelled: 0, projectile_source: null };
      G.shots.push(s); for (let t = 0; t < 30 && G.shots.includes(s); t++) tf.advance(1 / 30, [], false);
      if (!e.alive || e.caps?.destroyed) kills++;
      crew += (e.caps?.crew_total ?? 0) - (e.caps?.crew_alive ?? 0);
    }
    row.direct = `${kills}/${N} kills, ${(crew / N).toFixed(1)} crew lost`;
    for (const dist of [1.5, 3, 6, 12]) {
      let kk = 0, cc = 0;
      for (let k = 0; k < N; k++) {
        x.reviveRangeEnemy(e); tf.advance(0.05, [], false);
        const b = e.veh.body, side = b.worldDir([1, 0, 0]), half = (e.box?.hw || 1.4);
        const ang = k * 1.3, dl = [Math.cos(ang) * (half + dist), 0, Math.sin(ang) * (dist + 2)];
        const pw = b.worldPoint(dl); pw[1] = tf.world ? pw[1] : pw[1];
        const g = x.groundAt ? x.groundAt(pw[0], pw[2]) : null; if (g != null) pw[1] = g + 0.1;
        const rep = G.combat.nearBurst(e.combatKey, e.cstate, b.localPoint(pw), sh, e.turretYaw || 0, 77 + k, null, G.time);
        if (rep) { e.cstate = rep.state; e.caps = rep.caps; if (rep.caps.destroyed) kk++; cc += (rep.caps.crew_total ?? 0) - (rep.caps.crew_alive ?? 0); }
      }
      row['burst_' + dist + 'm'] = `${kk}/${N} kills, ${(cc / N).toFixed(1)} crew`;
    }
    out.rows.push(row);
  }
}
return out;

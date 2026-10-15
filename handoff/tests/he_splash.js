// HE rounds landing on the ground at a set standoff from a target's side: kills and crew lost.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.select('su_t72a'); await frames(2); tf.finishThumbs(); tf.startBattle(); await frames(3); tf.pause(true);
const P = x.data.projectiles, out = [];
for (const e of G.enemies.filter(q => ['us_m8', 'de_pz3_j'].includes(q.id))) for (const id of ['he_88_sprgr', 'he_122_of471', 'he_300_tt_rocket']) {
  const sh = P[id], row = { veh: e.id, shell: id };
  for (const d of [0.4, 1, 2, 4, 8]) {
    let kills = 0, lost = 0, n = 3, fresh = '';
    for (let k = 0; k < n; k++) {
      x.reviveRangeEnemy(e); tf.advance(0.1, [], false);
      fresh = e.caps.crew_alive + '/' + e.caps.crew_total;
      const b = e.veh.body, tgtL = [e.box.hw + d, 0, -1 + k], tgt = b.worldPoint(tgtL); tgt[1] = b.origin()[1] - 0.2;
      const o = b.worldPoint([e.box.hw + d + 12, 14, -1 + k]), dd = tgt.map((q, i) => q - o[i]), L = Math.hypot(...dd), dir = dd.map(q => q / L);
      const s = { s: x.newShot(o, dir, sh), shell: sh, age: 0, origin: o.slice(), travelled: 0, projectile_source: null };
      G.shots.push(s); for (let t = 0; t < 60 && G.shots.includes(s); t++) tf.advance(1 / 30, [], false);
      if (e.caps.destroyed) kills++;
      lost += e.caps.crew_total - e.caps.crew_alive;
    }
    row[d + 'm'] = `${kills}/${n} kill, ${(lost / n).toFixed(1)} crew (fresh ${fresh})`;
  }
  out.push(row);
}
return out;

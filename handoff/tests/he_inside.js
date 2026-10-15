const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.select('su_t72a'); await frames(2); tf.finishThumbs(); tf.startBattle(); await frames(3); tf.pause(true);
const P = x.data.projectiles, out = [];
for (const e of G.enemies.filter(q => ['us_m8', 'de_pz3_j', 'su_t72a', 'de_tiger_e'].includes(q.id))) for (const id of ['he_88_sprgr', 'he_122_of471']) for (const where of [[0, 1.0, 0], [0, 1.3, 0.8], [0, 1.6, -0.5]]) {
  x.reviveRangeEnemy(e); tf.advance(0.05, [], false);
  const rep = G.combat.nearBurst(e.combatKey, e.cstate, where, P[id], 0, 5, null, G.time);
  out.push([e.id, id, where.join(','), rep ? [rep.outcome, rep.title, rep.caps.destroyed, rep.caps.crew_alive + '/' + rep.caps.crew_total, rep.events?.slice(0, 6)] : null]);
}
return out;

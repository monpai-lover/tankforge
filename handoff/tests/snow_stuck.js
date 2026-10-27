const tf = window.__tf, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
const out = {};
for (const id of (window.__VEH || 'su_t72a,de_tiger_e').split(',')) {
  tf.select(id); await frames(2); tf.finishThumbs(); tf.startBattle(); await frames(2); tf.pause(true);
  tf.place(-62, 180, 0); tf.advance(1, [], false);
  const seq = [['fwd', 8], ['', 4], ['fwd', 6], ['left', 4], ['fwd', 4], ['back', 4], ['right', 4], ['fwd', 6]];
  const log = [];
  for (const [k, s] of seq) {
    const p0 = G.veh.body.origin(), h0 = G.s.heading;
    tf.advance(s, k ? [k] : [], false);
    const p1 = G.veh.body.origin(), v = G.veh.body.v;
    log.push([k || 'idle', s, +Math.hypot(p1[0] - p0[0], p1[2] - p0[2]).toFixed(1), +(Math.hypot(v[0], v[2]) * 3.6).toFixed(1), +((G.s.heading - h0) * 57.3).toFixed(0), G.veh.sinkage != null ? +(G.veh.sinkage * 100).toFixed(0) : null, +G.veh.body.origin()[1].toFixed(2)]);
  }
  out[id] = log;
}
return out;

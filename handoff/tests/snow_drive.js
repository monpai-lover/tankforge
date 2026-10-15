// Drive each vehicle straight on each soft surface; report speed reached and sinkage.
const tf = window.__tf, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
const spots = { road: [0, 400], grass: [150, 100], mud: [-62, 60], snow: [-62, 190], sand: [62, 60], dirt: [62, 190] };
const out = {};
for (const id of (window.__VEH || 'su_t72a,de_tiger_e,de_pz3_j,us_m8').split(',')) {
  tf.select(id); await frames(2); tf.finishThumbs(); tf.startBattle(); await frames(2); tf.pause(true);
  const row = {};
  for (const [name, [x, z]] of Object.entries(spots)) {
    tf.place(x, z, 0); tf.advance(1, [], false);
    const p0 = G.veh.body.origin();
    tf.advance(12, ['fwd'], false);
    const p1 = G.veh.body.origin(), v = G.veh.body.v;
    const st = tf.state ? tf.state() : {};
    row[name] = { dist_m: +Math.hypot(p1[0] - p0[0], p1[2] - p0[2]).toFixed(1), kmh: +(Math.hypot(v[0], v[2]) * 3.6).toFixed(1), sink_cm: G.veh.sinkage != null ? +(G.veh.sinkage * 100).toFixed(1) : (st.sinkage ?? null), surf: G.veh.t?.terrainId ?? null };
  }
  out[id] = row;
}
return out;

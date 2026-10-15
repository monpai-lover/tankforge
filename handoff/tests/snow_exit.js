const tf = window.__tf, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
const out = {};
for (const id of ['su_t72a', 'de_pz3_j']) {
  tf.select(id); await frames(2); tf.finishThumbs(); tf.startBattle(); await frames(2); tf.pause(true);
  const runs = {};
  for (const [name, x, z, h] of [['exit_north', -62, 245, 0], ['exit_south', -62, 185, Math.PI], ['exit_east', -40, 215, Math.PI / 2], ['exit_west', -84, 215, -Math.PI / 2], ['enter_from_grass', -62, 290, Math.PI]]) {
    tf.place(x, z, h); tf.advance(2, [], false);
    const log = [];
    for (let s = 0; s < 10; s++) { tf.advance(2, ['fwd'], false); const v = G.veh.body.v; log.push([+G.s.x.toFixed(0), +G.s.z.toFixed(0), +(Math.hypot(v[0], v[2]) * 3.6).toFixed(0), +(G.veh.sinkage * 100).toFixed(0)]); }
    runs[name] = log;
  }
  out[id] = runs;
}
return out;

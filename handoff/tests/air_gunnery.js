// Gunnery: the aim ring held on a ground point in a dive; where one round lands vs the point, with the
// gunnery aim bias (the impact flown onto the ring) and without (the nose flown onto the ring).
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs();
const out = {};
for (const btn of ['jet-btn', 'air-btn']) {
  if (G.air?.active) { x.exitAircraft(); x.exitAircraft(); }
  tf.pause(false); document.querySelector(`.hangar-card[data-air=${btn === 'jet-btn' ? 'nf02' : 'nf01'}]`).click();
  for (let i = 0; i < 80 && !(G.air?.active && G.air.plane.type.id === (btn === 'jet-btn' ? 'nf02' : 'nf01')); i++) await frames(1);
  tf.pause(true);
  const P = G.air.plane, jet = P.type.id === 'nf02';
  for (const bias of [true, false]) {
    const target = [40, 0, jet ? 1400 : 900];
    P.spawn(0, jet ? 520 : 330, -200, 0, jet ? 170 : 80, false); P.state.throttle = jet ? 0.6 : 0.7;
    if (!bias) { P._bias = P.aimBias; Object.defineProperty(P, 'aimBias', { configurable: true, get: () => [0, 0, 0, 1], set: () => {} }); }
    for (let k = 0; k < 60 * 3.5; k++) { const c = P.position, d = [target[0] - c[0], target[1] - c[1], target[2] - c[2]], l = Math.hypot(...d); P.aim = d.map(v => v / l); tf.advance(1 / 60, [], k % 30 === 29); }
    const n0 = G.bullets.length + G.shots.length; G.air.fireAll = true;
    for (let k = 0; k < 40 && G.bullets.length + G.shots.length === n0; k++) tf.advance(1 / 60, [], false);
    G.air.fireAll = false;
    const r = G.bullets[G.bullets.length - 1] || G.shots[G.shots.length - 1];
    let last = r.s.pos.slice();
    for (let k = 0; k < 300 && (G.bullets.includes(r) || G.shots.includes(r)); k++) { last = r.s.pos.slice(); tf.advance(1 / 60, [], false); }
    if (!bias) delete P.aimBias, P.aimBias = [0, 0, 0, 1];
    out[P.type.id + (bias ? '_bias' : '_nose')] = { miss_m: +Math.hypot(last[0] - target[0], last[2] - target[2]).toFixed(1), landed: last.map(Math.round), range: Math.round(Math.hypot(target[0] - P.position[0], target[1] - P.position[1], target[2] - P.position[2])) };
  }
}
return out;

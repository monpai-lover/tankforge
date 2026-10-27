// Large mouse moves (user report: the controls do not follow the hand): heading changes of 30, 90 and
// 180 deg (time until the nose is within 5 deg / 1 deg of the aim), peak G and roll; and how far the
// camera trails the aim after a quick mouse flick (the reticle leaves the screen centre).
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs();
const D = Math.PI / 180, out = {};
for (const btn of (window.__TYPES || 'air-btn,jet-btn').split(',')) {
  if (G.air?.active) { x.exitAircraft(); x.exitAircraft(); }
  tf.pause(false); document.querySelector(`.hangar-card[data-air=${btn === 'jet-btn' ? 'nf02' : 'nf01'}]`).click();
  for (let i = 0; i < 80 && !(G.air?.active && G.air.plane.type.id === (btn === 'jet-btn' ? 'nf02' : 'nf01')); i++) await frames(1);
  tf.pause(true);
  const P = G.air.plane, jet = P.type.id === 'nf02', speed = jet ? 220 : 90, res = {};
  const nose = () => [P.cur[48], P.cur[49], P.cur[50]];
  const off = () => { const n = nose(), a = P.aim; return Math.acos(Math.max(-1, Math.min(1, n[0] * a[0] + n[1] * a[1] + n[2] * a[2]))) / D; };
  const level = () => { P.spawn(-6000, 1500, -6000, Math.PI, speed, false); P.state.throttle = jet ? 1 : 0.85; P.aim = nose(); for (let k = 0; k < 150; k++) tf.advance(1 / 60, [], false); };
  for (const deg of [30, 90, 180]) {
    level();
    const n = nose(), h = Math.atan2(n[0], n[2]) + deg * D * 0.999;
    P.aim = [Math.sin(h), 0, Math.cos(h)];
    let t = 0, t5 = null, t1 = null, g = 0, bank = 0;
    for (let k = 0; k < 60 * 25 && t1 == null; k++) {
      tf.advance(1 / 60, [], false); t += 1 / 60;
      const e = off(); g = Math.max(g, P.cur[17]); bank = Math.max(bank, Math.abs(P.cur[20]) / D);
      if (t5 == null && e < 5) t5 = t;
      if (t1 == null && e < 1) t1 = t;
    }
    res[deg] = { t5: t5 && +t5.toFixed(2), t1: t1 && +t1.toFixed(2), peakG: +g.toFixed(1), peakBank: Math.round(bank), kmh: Math.round(P.cur[13] * 3.6), altLoss: Math.round(1500 - P.cur[1]) };
  }
  // camera lag: a 20 deg mouse flick sideways, then the camera's angle from the aim over time
  level();
  P.camera(1 / 60, () => 0);
  P.look(20 * D / 17e-4, 0);
  const lag = [];
  for (let k = 0; k < 30; k++) { const c = P.camera(1 / 60, () => 0), a = P.aim; if (k % 5 === 0) lag.push(+(Math.acos(Math.max(-1, Math.min(1, c.fwd[0] * a[0] + c.fwd[1] * a[1] + c.fwd[2] * a[2]))) / D).toFixed(1)); }
  res.camLagDeg = lag;
  out[P.type.id] = res;
}
return out;

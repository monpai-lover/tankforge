// Mouse-aim tracking (user report: cannot hold the jet's nose on a target). For each type, flying
// level far from the AA: step the aim 1, 3, 8 and 30 deg off the nose (right, up, diagonal) and
// record how fast the nose gets within 0.3 deg, its overshoot and the error left; then track an
// aim point sweeping 4 deg/s sideways and 2 deg/s up and down (a crossing target), RMS error.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs();
const D = Math.PI / 180, nrm = (v) => { const l = Math.hypot(...v); return v.map(c => c / l); };
const out = {};
for (const btn of (window.__TYPES || 'air-btn,jet-btn').split(',')) {
  if (G.air?.active) { x.exitAircraft(); x.exitAircraft(); }
  tf.pause(false);
  document.getElementById(btn).click();
  for (let i = 0; i < 80 && !(G.air?.active && G.air.plane.type.id === (btn === 'jet-btn' ? 'nf02' : 'nf01')); i++) await frames(1);
  tf.pause(true);
  const P = G.air.plane, jet = P.type.id === 'nf02', speed = jet ? 220 : 90;
  const nose = () => [P.cur[48], P.cur[49], P.cur[50]], right = () => [P.cur[42], P.cur[43], P.cur[44]], up = () => [P.cur[45], P.cur[46], P.cur[47]];
  const off = () => { const n = nose(), a = P.aim; return Math.acos(Math.max(-1, Math.min(1, n[0] * a[0] + n[1] * a[1] + n[2] * a[2]))) / D; };
  const level = () => { P.spawn(-6000, 1500, -6000, Math.PI, speed, false); P.state.throttle = jet ? 0.92 : 0.8; P.aim = nose(); for (let k = 0; k < 120; k++) tf.advance(1 / 60, [], false); P.aim = nose(); for (let k = 0; k < 60; k++) tf.advance(1 / 60, [], false); };
  const res = {};
  for (const [name, dx, dy] of [['1r', 1, 0], ['1u', 0, 1], ['3r', 3, 0], ['3d', 2.1, 2.1], ['8r', 8, 0], ['30r', 30, 0]]) {
    level();
    // the aim stepped in the camera-like frame: around world up (right) and around the nose's right (up)
    const n = nose(), h = Math.atan2(n[0], n[2]) + dx * D, p = Math.asin(n[1]) + dy * D;
    P.aim = [Math.sin(h) * Math.cos(p), Math.sin(p), Math.cos(h) * Math.cos(p)];
    let t = 0, tin = null, peak = 0, crossed = false, errs = [], lastSign = null, overshoot = 0;
    for (let k = 0; k < 60 * 6; k++) {
      tf.advance(1 / 60, [], false); t += 1 / 60;
      const e = off(); peak = Math.max(peak, e);
      if (tin == null && e < 0.3) tin = t;
      // signed lateral / vertical error (aim in body frame)
      const a = P.aim, lx = a[0] * right()[0] + a[1] * right()[1] + a[2] * right()[2], ly = a[0] * up()[0] + a[1] * up()[1] + a[2] * up()[2];
      const s = Math.abs(dx) >= Math.abs(dy) ? Math.sign(lx) : Math.sign(ly);
      if (lastSign != null && s !== lastSign && s !== 0) crossed = true;
      if (crossed) overshoot = Math.max(overshoot, e);
      lastSign = s || lastSign;
      if (t > 3) errs.push(e);
    }
    res[name] = { t03: tin == null ? null : +tin.toFixed(2), overshoot: +overshoot.toFixed(2), rms3to6: +Math.sqrt(errs.reduce((q, e) => q + e * e, 0) / errs.length).toFixed(2), crashed: P.crashed };
  }
  // tracking a crossing target
  level();
  let h0 = Math.atan2(nose()[0], nose()[2]), p0 = Math.asin(nose()[1]), errs = [];
  for (let k = 0; k < 60 * 10; k++) {
    const t = k / 60, h = h0 + 4 * D * t, p = p0 + 3 * D * Math.sin(t * 0.8);
    P.aim = [Math.sin(h) * Math.cos(p), Math.sin(p), Math.cos(h) * Math.cos(p)];
    tf.advance(1 / 60, [], false);
    if (t > 3) errs.push(off());
  }
  res.track = { rms: +Math.sqrt(errs.reduce((q, e) => q + e * e, 0) / errs.length).toFixed(2), max: +Math.max(...errs).toFixed(2) };
  out[P.type.id] = res;
}
return out;

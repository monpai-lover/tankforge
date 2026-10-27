// A 30 m tracer beam flying away from the camera, nearly along the view (user report: tracers drawn
// as flat squares), at 0.5 / 2 / 6 deg off the view axis.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); tf.finishThumbs();
tf.select('su_t72a'); await frames(3); tf.startBattle(); await frames(5); tf.pause(true);
document.querySelectorAll('#hud, #toast, .toast').forEach(el => el.style.visibility = 'hidden');
G.cam.pitch = 0.4; tf.advance(0.3, [], true);
for (const deg of [0.5, 2, 6]) {
  const c = G.camPos, f = G.camFwd, side = [f[2], 0, -f[0]].map(v => v / Math.hypot(f[2], f[0])), off = Math.tan(deg * Math.PI / 180);
  for (let k = 0; k < 2; k++) {
    const a = [0, 1, 2].map(i => c[i] + f[i] * 40 + side[i] * 40 * off), b = [0, 1, 2].map(i => c[i] + f[i] * 90 + side[i] * 90 * off);
    tf.fx.beam(a, b, 1.5, [1, 0.55, 0.2], 0.95);
    tf.advance(1 / 60, [], true);
  }
  await frames(1); await pyShot('deg' + deg);
}
return { ok: true };

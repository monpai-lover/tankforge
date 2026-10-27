// A tank round's tracer seen from behind the gun (user report: tracers were drawn as flat squares).
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); tf.finishThumbs();
tf.select(window.__VEH || 'su_t72a'); await frames(3); tf.startBattle(); await frames(5);
tf.pause(true);
document.querySelectorAll('#toast, .toast').forEach(el => el.style.visibility = 'hidden');
G.cam.pitch = 0.02; tf.advance(0.5, [], false);
tf.fireGun(0, 0);
const out = { shots: [] };
for (let k = 0; k < 40; k++) {
  tf.advance(1 / 60, [], k % 6 === 2);
  if (k % 6 === 2) { await frames(1); await pyShot('t' + k); out.shots.push([k, G.shots.length, G.shots[0] ? Math.round(G.shots[0].travelled) : null]); }
}
return out;

// Far terrain as the grid follows the view (user report: wave-like shading crawling in the distance):
// the same view with the grid moved one step (0.3 m) and two, pictures for a difference of the far
// ground. The camera is fixed in the air looking over the range; only the grid's focus moves.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs(); tf.setMapChoice(window.__MAP || 'normandy'); await frames(2); document.querySelector('.hangar-card[data-air=nf01]').click();
for (let i = 0; i < 400 && !G.air?.active; i++) await frames(1);
tf.pause(true);
const P = G.air.plane;
document.querySelectorAll('#air-hud, #toast, .toast, #minimap, .minimap').forEach(el => el.style.visibility = 'hidden');
const base = P.position.slice(), hd = P.heading, f0 = [Math.sin(hd), 0, Math.cos(hd)];
const eye = [base[0] + f0[0] * 15, base[1] + 25, base[2] + f0[2] * 15], fwd = (() => { const d = [f0[0], -0.07, f0[2]]; const l = Math.hypot(...d); return d.map(v => v / l); })();
P.camera = () => ({ camPos: eye.slice(), fwd, fovY: 0.75 });
const shots = [];
const side = [f0[2], 0, -f0[0]];
for (const dz of [0, 0.3, 0.6]) {
  // the grid where it was; the camera moved sideways by dz (the view's own motion)
  P.camera = () => ({ camPos: eye.map((v, i) => v + side[i] * dz), fwd, fovY: 0.75 });
  for (let k = 0; k < 3; k++) tf.advance(1 / 60, [], true);
  await frames(2); await pyShot('swim_' + dz);
}
return { ok: true, map: G.mapId, at: base.map(Math.round) };

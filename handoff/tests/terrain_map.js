// The map terrain as the view moves (user report: the wave-like shading is back): __MAP, __QUALITY;
// views 2.5, 25, 400 and 1500 m above the ground, each twice, 0.5 m apart sideways.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs(); tf.setQuality(window.__QUALITY || 'low');
tf.setMapChoice(window.__MAP || 'coast'); await frames(2); tf.startBattle();
for (let i = 0; i < 300 && G.mode !== 'battle'; i++) await frames(1);
await frames(5);
x.enterAircraft(false, 'nf01');
for (let i = 0; i < 100 && !G.air?.active; i++) await frames(1);
tf.pause(true);
const P = G.air.plane;
document.querySelectorAll('#air-hud, #toast, .toast, #minimap, .minimap, #hud').forEach(el => el.style.visibility = 'hidden');
const base = P.position.slice(), hd = P.heading, f0 = [Math.sin(hd), 0, Math.cos(hd)], side = [f0[2], 0, -f0[0]];
P.root.visible = false;
for (const [h, down] of (window.__VIEWS || [[2.5, 0.03], [25, 0.08], [400, 0.25], [1500, 0.35]])) {
  const d = [f0[0], -down, f0[2]], l = Math.hypot(...d), fwd = d.map(v => v / l);
  for (const dz of [0, 0.5]) {
    const eye = [base[0] + side[0] * dz, base[1] + h, base[2] + side[2] * dz];
    P.camera = () => ({ camPos: eye, fwd, fovY: 0.9 });
    for (let k = 0; k < 3; k++) tf.advance(1 / 60, [], true);
    await frames(3); await pyShot(`${window.__MAP || 'coast'}_${h}_${dz}`);
  }
}
return { map: G.mapId, at: base.map(Math.round) };

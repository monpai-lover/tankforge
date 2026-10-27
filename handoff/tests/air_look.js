// Close looks at hangar types in the garage: __IDS, from above-front-left and from below.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs();
document.querySelector('#g-mode .tab[data-g=air]').click();
for (let i = 0; i < 30 && !G.airGarage.plane; i++) await frames(1);
document.querySelectorAll('#g-info, #g-bottom, #g-top').forEach(el => el.style.visibility = 'hidden');
const out = {};
for (const id of (window.__IDS || 'fw190a8').split(',')) {
  document.querySelector(`#air-list .card[data-air=${id}]`).click();
  await frames(3);
  const p = G.airGarage.plane, c = p.drawPos;
  out[id] = { wings: [p.wings.l.visible, p.wings.r.visible], pos: c.map(v => +v.toFixed(2)) };
  for (const [tag, yaw, pitch, dist] of (window.__VIEWS || [['top', 0.9, -0.75, 1.25], ['side', 1.57, -0.12, 1.1]])) {
    const L = Math.max(G.airGarage.size.len, G.airGarage.size.span);
    G.camOverride = { pivot: [c[0], c[1], c[2]], dist: L * dist, fov: 0.75 };
    G.cam.yaw = p.heading + yaw; G.cam.pitch = pitch;
    await frames(4);
    await pyShot(id + '_' + tag);
  }
}
G.camOverride = null;
return out;

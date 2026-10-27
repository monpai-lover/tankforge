// The modelled pilot in each type's cockpit (user request: the USSR pilot model in every aircraft):
// close looks at the cockpit from the front-left above and from the side, __IDS. Also whether the
// figure was built (its node, triangles, scale to the canopy).
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs();
document.querySelector('#g-mode .tab[data-g=air]').click();
for (let i = 0; i < 30 && !G.airGarage.plane; i++) await frames(1);
document.querySelectorAll('#g-info, #g-bottom, #g-top').forEach(el => el.style.visibility = 'hidden');
const out = {};
for (const id of (window.__IDS || 'f15c,p51d,mig21,nf02').split(',')) {
  document.querySelector(`#air-list .card[data-air=${id}]`).click();
  await frames(3);
  const p = G.airGarage.plane, T = p.type, canopy = T.canopy || T.fighter?.spec.canopy;
  const pilot = p.cockpit.children.find(n => n.name === 'aircraft_pilot');
  const eyeL = [canopy[0][0], canopy[0][1] + canopy[1][1] * 0.42, canopy[0][2] + canopy[1][2] * 0.08], eye = p.worldPoint(eyeL);
  out[id] = { pilot: !!pilot, textured: !!pilot?.texture, visor: p.cockpit.children.some(n => n.name === 'aircraft_pilot_visor') };
  if (window.__NOGLASS) p.glass.mesh = null;
  for (const [tag, yaw, pitch, dist] of (window.__VIEWS || [['cockpit', 0.75, -0.35, 3.2], ['side', 1.57, -0.08, 3.5]])) {
    G.camOverride = { pivot: eye, dist, fov: 0.75 };
    G.cam.yaw = p.heading + yaw; G.cam.pitch = pitch;
    await frames(4);
    await pyShot(id + '_' + tag);
  }
}
G.camOverride = null;
return out;

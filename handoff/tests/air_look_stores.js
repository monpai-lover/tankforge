// Fighters in the garage hangar with a loadout hung (__LOOK: id:loadout,...), from above and from the
// side, chosen with the loadout panel's own buttons.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs();
document.querySelector('#g-mode .tab[data-g=air]').click();
for (let i = 0; i < 30 && !G.airGarage.plane; i++) await frames(1);
const out = {};
for (const pair of (window.__LOOK || 'f4e:1,f15c:1,mig29:1,su27:2,p51d:2,f104g:1').split(',')) {
  const [id, lo] = pair.split(':');
  document.querySelector(`#air-list .card[data-air=${id}]`).click();
  await frames(3);
  document.querySelector(`#g-air .air-lo[data-lo="${lo}"]`).click();
  await frames(3);
  const p = G.airGarage.plane, c = p.drawPos;
  out[id] = { loadout: document.querySelector('#g-air .air-lo[aria-pressed=true]').textContent, what: document.querySelector('#g-air .air-lo-what').textContent, stores: p.storeNodes.filter(n => n.name.startsWith('aircraft_store')).length };
  document.querySelectorAll('#g-bottom, #g-top, #g-info').forEach(el => el.style.visibility = 'hidden');
  for (const [tag, yaw, pitch, dist] of [['top', 0.9, -0.55, 1.15], ['side', 2.0, -0.1, 0.95]]) {
    const L = Math.max(G.airGarage.size.len, G.airGarage.size.span);
    G.camOverride = { pivot: [c[0], c[1], c[2]], dist: L * dist, fov: 0.75 };
    G.cam.yaw = p.heading + yaw; G.cam.pitch = pitch;
    await frames(4);
    await pyShot(id + '_' + tag);
  }
  document.querySelectorAll('#g-bottom, #g-top, #g-info').forEach(el => el.style.visibility = '');
}
G.camOverride = null;
return out;

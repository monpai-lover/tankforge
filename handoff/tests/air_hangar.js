// The garage's hangar tab: tabs, aircraft cards with pictures, the aircraft on show, its data, the
// arrow keys, and 起飛 taking off in the chosen type. __IDS: types to picture in the garage.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs();
const out = {};
document.querySelector('#g-mode .tab[data-g=air]').click();
for (let i = 0; i < 30 && !G.airGarage.plane; i++) await frames(1);
await frames(20);
const cards = [...document.querySelectorAll('#air-list .card')];
out.cards = cards.length;
out.blankPics = cards.filter(c => { const g = c.querySelector('canvas').getContext('2d').getImageData(0, 0, 344, 194).data; let mn = 255, mx = 0; for (let i = 0; i < g.length; i += 97) { mn = Math.min(mn, g[i]); mx = Math.max(mx, g[i]); } return mx - mn < 20; }).map(c => c.dataset.air);
out.tankHidden = G.model.root.visible === false;
out.btn = document.getElementById('battle-btn').textContent;
out.info = document.getElementById('g-air').innerText.slice(0, 200);
out.vehicleListShown = getComputedStyle(document.getElementById('vehicle-list')).display;
await pyShot('garage_' + G.airGarage.sel);
for (const id of (window.__IDS || '').split(',').filter(Boolean)) {
  document.querySelector(`#air-list .card[data-air=${id}]`).click();
  await frames(25);
  await pyShot('garage_' + id);
}
// arrow key steps the selection
const s0 = G.airGarage.sel; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight', bubbles: true })); out.arrow = [s0, G.airGarage.sel];
await pyShot('cards');
if (window.__FLY) {
  document.getElementById('battle-btn').click();
  for (let i = 0; i < 200 && !G.air?.active; i++) await frames(1);
  out.flying = G.air?.active && G.air.plane.type.id; out.mode = G.mode; out.preview = !!G.airGarage.plane;
}
return out;

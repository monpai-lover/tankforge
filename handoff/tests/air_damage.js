// What the NF-01's damage does to its flight (engine, wing, pilot), away from the AA; and the O X-ray.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs(); document.getElementById('air-btn').click();
for (let i = 0; i < 40 && !G.air?.active; i++) await frames(1);
tf.pause(true);
const P = G.air.plane, rnd = () => 0.99;
const run = (harm, secs) => {
  P.spawn(-3000, 900, -3000, Math.PI, 95, false); P.aim = [0, 0, -1];
  for (const id of harm) P.damage.harm(id, 1e3, false, rnd);
  P.applyDamage();
  const out = [];
  for (let k = 0; k < secs * 60 && !P.crashed; k++) { tf.advance(1 / 60, [], false); if (k % 120 === 119) { const h = P.hudState(); out.push([Math.round(h.tas), Math.round(h.alt), Math.round(Math.atan2(-(2 * (P.cur[3] * P.cur[4] - P.cur[6] * P.cur[5])), 1 - 2 * (P.cur[3] ** 2 + P.cur[5] ** 2)) * 57.3)]); } }
  return { harm, out, crashed: P.crashed };
};
const res = [run([], 10), run(['engine'], 10), run(['wing_l'], 6), run(['pilot'], 10), run(['tail'], 6)];
// X-ray with some damage
P.spawn(-3000, 900, -3000, Math.PI, 95, false); P.aim = [0, 0, -1];
P.damage.harm('engine', 50, false, rnd); P.damage.harm('wing_r', 1e3, false, rnd); P.damage.harm('fuel', 50, false, rnd); P.applyDamage();
tf.advance(0.3, [], true);
window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyO' }));
const cam0 = P.camera.bind(P); P.camera = () => { const c = P.drawPos, eye = [c[0] + 7, c[1] + 6, c[2] + 5], d = [c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]], l = Math.hypot(...d); return { camPos: eye, fwd: d.map(v => v / l), fovY: 0.75 }; };
document.querySelectorAll('#air-hud, #toast, .toast').forEach(el => el.style.visibility = 'hidden');
for (let k = 0; k < 4; k++) tf.advance(1 / 60, [], true); await frames(2);
const xr = { xray: P.xray, partsShown: P.partNodes.filter(n => n.visible).length, bodyKind: P.body.kind, levels: P.partNodes.map(n => P.damage.level(n.part)).join('') };
await pyShot('air_xray');
await pyShot('air_xray_off_pre'); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyO' })); tf.advance(1 / 60, [], true); await frames(2); await pyShot('air_plain'); P.camera = cam0;
tf.advance(1 / 60, [], true);
return { res, xr, after: { xray: P.xray, bodyKind: P.body.kind, shown: P.partNodes.filter(n => n.visible).length }, flags: document.querySelector('#air-hud .air-flags')?.textContent };

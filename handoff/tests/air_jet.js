// NF-02 jet: take-off run on the range road at full afterburner, top speed in level flight, the
// M61's rate of fire and spin-up, and pictures of it on the ground and in the X-ray.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs(); document.getElementById('jet-btn').click();
for (let i = 0; i < 60 && !G.air?.active; i++) await frames(1);
tf.pause(true);
const P = G.air.plane, out = { type: P.type.id, guns: G.air.guns.map(g => [g.id, g.rpm, g.ammo]) };
document.querySelectorAll('#air-hud, #toast, .toast').forEach(el => el.style.visibility = 'hidden');
const cam0 = P.camera.bind(P), close = (dx, dy, dz) => () => { const c = P.drawPos, eye = [c[0] + dx, c[1] + dy, c[2] + dz], d = [c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]], l = Math.hypot(...d); return { camPos: eye, fwd: d.map(v => v / l), fovY: 0.8 }; };
// on the runway: a picture, then the take-off run
tf.advance(0.3, [], false);
P.camera = close(11, 4, 13); tf.advance(1 / 60, [], true); await frames(2); await pyShot('jet_ground');
P.camera = cam0;
const z0 = P.position[2]; P.state.throttle = 1.12; P.state.flaps = true; let lift = null, t = 0, vmax = 0;
for (let k = 0; k < 60 * 40 && !lift; k++) {
  if (P.cur[13] > 80) P.aim = [0, 0.2, 1].map(v => v / Math.hypot(0, 0.2, 1));
  tf.advance(1 / 60, [], false); t += 1 / 60;
  if (P.cur[35] > 3) lift = { t: +t.toFixed(1), kmh: Math.round(P.cur[13] * 3.6), run_m: Math.round(P.position[2] - z0) };
}
out.takeoff = lift; out.crashedOnTakeoff = P.crashed;
// level flight far from the AA, full afterburner: top speed
P.spawn(-6000, 1000, -6000, Math.PI, 200, false); P.aim = [0, 0, -1]; P.state.throttle = 1.12;
for (let k = 0; k < 60 * 60; k++) { tf.advance(1 / 60, [], false); vmax = Math.max(vmax, P.cur[13]); }
out.ab1000m = { kmh: Math.round(vmax * 3.6), mach: +(vmax / 340).toFixed(2), alt: Math.round(P.cur[1]) };
P.state.throttle = 1.0; vmax = 0; for (let k = 0; k < 60 * 50; k++) { tf.advance(1 / 60, [], false); vmax = P.cur[13]; }
out.dry1000m = { kmh: Math.round(vmax * 3.6) };
// the M61: 1 s burst, rounds in the first 0.25 s (spin-up) and in all
const g = G.air.guns[0], a0 = g.ammo; G.air.fireAll = true;
for (let k = 0; k < 15; k++) tf.advance(1 / 60, [], false); const early = a0 - g.ammo;
for (let k = 0; k < 45; k++) tf.advance(1 / 60, [], false); G.air.fireAll = false;
out.m61 = { first025s: early, in1s: a0 - g.ammo, bullets: G.bullets.length, spin: +g.spin.toFixed(2) };
for (let k = 0; k < 60; k++) tf.advance(1 / 60, [], false);
// X-ray picture
P.camera = close(9, 5, 9); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyO' })); tf.advance(1 / 60, [], true); await frames(2); await pyShot('jet_xray');
window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyO' })); P.camera = close(-10, 3, -16); tf.advance(1 / 60, [], true); await frames(2); await pyShot('jet_flight');
P.camera = cam0;
out.crashed = P.crashed; out.hud = document.querySelector('#air-hud .air-flags')?.textContent;
return out;

// Every hangar type: on the runway (picture), a full-power take-off, top speed at 3,000 m, the sonic
// boom where it goes supersonic, a 1 s burst of every gun, and a picture in flight.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs();
const S = tf.sound, booms = []; const op = S.full?.play?.bind(S.full); if (op) S.full.play = (id, e, l) => { if (id === 'air_sonic_boom') booms.push(G.air?.plane.type.id); return op(id, e, l); };
const out = { cards: [...document.querySelectorAll('.hangar-card')].map(c => c.dataset.air) };
const ids = (window.__IDS || out.cards.join(',')).split(',');
for (const id of ids) {
  if (G.air?.active) { x.exitAircraft(true); }
  tf.pause(false);
  document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for (let i = 0; i < 90 && !(G.air?.active && G.air.plane.type.id === id); i++) await frames(1);
  tf.pause(true);
  const P = G.air.plane, r = {}, cam0 = P.camera.bind(P);
  const close = (dx, dy, dz) => () => { const c = P.drawPos, m = P.root.local, w = (v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]], o = w([dx, dy, dz]), eye = [c[0] + o[0], c[1] + o[1], c[2] + o[2]], d = [c[0] - eye[0], c[1] - eye[1], c[2] - eye[2]], l = Math.hypot(...d); return { camPos: eye, fwd: d.map(v => v / l), fovY: 0.8 }; };
  document.querySelectorAll('#air-hud, #toast, .toast').forEach(el => el.style.visibility = 'hidden');
  tf.advance(0.3, [], false);
  if (window.__SHOTS !== 0) { P.camera = close(9, 3.5, 9); tf.advance(1 / 60, [], true); await frames(2); await pyShot(id + '_ground'); P.camera = cam0; }
  if (window.__PICS) { P.camera = close(-7, 2.5, -14); P.spawn(-8000, 2000, -8000, Math.PI, P.type.sound === 'jet' ? 300 : 130, false); P.aim = [0, 0, -1]; P.state.throttle = 1.12; P.state.gear = false; for (let k = 0; k < 120; k++) tf.advance(1 / 60, [], k > 115); await frames(2); await pyShot(id + '_flight'); P.camera = cam0; out[id] = 'pics'; continue; }
  // take-off
  const z0 = P.position[2], vr = P.type.rotateKmh / 3.6; P.state.throttle = 1.12; P.state.flaps = true; let lift = null, t = 0;
  for (let k = 0; k < 60 * 45 && !lift && !P.crashed; k++) { if (P.cur[13] > vr) P.aim = [0, 0.2, 1].map(v => v / Math.hypot(0, 0.2, 1)); tf.advance(1 / 60, [], false); t += 1 / 60; if (P.cur[35] > 4) lift = { t: +t.toFixed(1), kmh: Math.round(P.cur[13] * 3.6), run_m: Math.round(P.position[2] - z0) }; }
  r.takeoff = lift || { crashed: P.crashed, kmh: Math.round(P.cur[13] * 3.6) };
  // top speed, level at 3,000 m
  P.spawn(-8000, 3000, -8000, Math.PI, P.type.sound === 'jet' ? 250 : 130, false); P.aim = [0, 0, -1]; P.state.throttle = 1.12; P.state.gear = false; P.state.flaps = false;
  let vmax = 0; const nb = booms.length;
  for (let k = 0; k < 60 * 70; k++) { tf.advance(1 / 60, [], false); vmax = Math.max(vmax, P.cur[13]); }
  r.top = { kmh: Math.round(vmax * 3.6), mach: +(vmax / 340).toFixed(2), alt: Math.round(P.cur[1]), boom: booms.length > nb };
  // guns
  const a0 = G.air.guns.map(g => g.ammo); G.air.fireAll = true; for (let k = 0; k < 60; k++) tf.advance(1 / 60, [], false); G.air.fireAll = false;
  r.fired = Object.entries(G.air.guns.reduce((m, g, i) => (m[g.sound] = (m[g.sound] || 0) + a0[i] - g.ammo, m), {}));
  if (window.__SHOTS !== 0) { P.camera = close(-7, 2.5, -14); tf.advance(1 / 60, [], true); await frames(2); await pyShot(id + '_flight'); P.camera = cam0; }
  r.crashed = P.crashed;
  out[id] = r;
}
return out;

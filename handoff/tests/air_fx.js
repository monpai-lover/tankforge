// Afterburner flame and the sonic boom (user requests): __TYPE (default f104g) flown level at full
// afterburner through Mach 1; pictures from the chase view and from the side as it goes through.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP; tf.finishThumbs();
tf.select('su_t72a'); await frames(3); tf.startBattle(); await frames(3);
document.querySelector('.hangar-card[data-air=' + (window.__TYPE || 'f104g') + ']').click();
for (let i = 0; i < 90 && !G.air?.active; i++) await frames(1);
tf.pause(true);
document.querySelectorAll('#toast, .toast').forEach(el => el.style.visibility = 'hidden');
const P = G.air.plane, cam0 = P.camera.bind(P), out = { booms: 0 };
const side = (dx, dy, dz) => () => { const c = P.drawPos, m = P.root.local, o = [0, 1, 2].map(k => m[k] * dx + m[4 + k] * dy + m[8 + k] * dz), eye = c.map((v, i) => v + o[i]), d = c.map((v, i) => v - eye[i]), l = Math.hypot(...d); return { camPos: eye, fwd: d.map(v => v / l), fovY: 0.7 }; };
const op = tf.sound.full?.play?.bind(tf.sound.full); if (op) tf.sound.full.play = (id, e, l) => { if (id === 'air_sonic_boom') out.booms++; return op(id, e, l); };
P.spawn(-6000, 2500, -6000, Math.PI * 0.5, 300, false); P.aim = [1, 0, 0]; P.state.throttle = 1.12; P.state.gear = false; P.state.flaps = false;
tf.advance(0.5, [], false);
// flame from behind and from the side at full afterburner
tf.advance(1 / 60, [], true); await frames(2); await pyShot('ab_chase');
P.camera = side(12, 2, -6); tf.advance(1 / 60, [], true); await frames(2); await pyShot('ab_side'); P.camera = cam0;
// on to Mach 0.97, then pictures every few frames through the crossing
for (let k = 0; k < 60 * 90 && P.cur[13] / 340 < 0.965; k++) tf.advance(1 / 60, [], false);
out.mach0 = +(P.cur[13] / 340).toFixed(3);
let n = 0, crossed = -1;
document.querySelectorAll('#air-hud .air-panel, .lock-hint, #lock-hint').forEach(el => el.style.visibility = 'hidden');
for (let k = 0; k < 60 * 120 && n < 9; k++) {
  const m = P.cur[13] / 340;
  if (crossed < 0 && G.air.lastMach >= 1) crossed = k;
  const want = (crossed < 0 && m > 0.982 && k % 45 === 0 && n < 3) || (crossed >= 0 && (k - crossed) % 4 === 0 && n < 9);
  tf.advance(1 / 60, [], want || (crossed >= 0 && k - crossed < 40));
  if (want) { P.camera = n % 2 ? side(14, 3, 4) : cam0; tf.advance(1 / 60, [], true); await frames(1); await pyShot('boom_' + n + '_m' + Math.round(P.cur[13] / 3.4)); n++; P.camera = cam0; }
}
out.crossedAt = crossed;
out.mach1 = +(P.cur[13] / 340).toFixed(3);
return out;

const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const log = (...a) => console.log('@@', ...a.map(v => typeof v === 'string' ? v : JSON.stringify(v)));
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs(); tf.startBattle(); await frames(3);
const key = (code, type = 'keydown') => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
key('F8'); for (let i = 0; i < 20 && !G.air?.active; i++) await frames(1);
tf.pause(true);
const P = G.air.plane, out = { entered: G.air.active, airData: document.body.dataset.air };
const tank0 = [G.s.x, G.s.z];
// approach: 70 m above the road, 2.4 km out... use 900 m out heading north at 62 m/s
P.spawn(0, 55, 250, 0, 62, false); Object.assign(P.state, { gear: true, flaps: true, throttle: 0.32 });
const st = () => { const h = P.hudState(); return { t: +P.time.toFixed(1), z: +P.position[2].toFixed(0), x: +P.position[0].toFixed(1), ias: +h.ias.toFixed(0), agl: +h.agl.toFixed(1), vs: +h.vs.toFixed(1), mode: h.mode, crashed: h.crashed }; };
let touched = -1;
for (let s = 0; s < 80; s++) {
  const h = P.hudState(), glide = h.agl > 9 ? -0.06 : h.agl > 3 ? -0.015 : 0.02;
  P.aim = [ -P.position[0] * 0.004, glide, 1 ].map((v, i, a) => v / Math.hypot(...a));
  if (h.agl < 4) P.state.throttle = 0;
  if (P.onGround && touched < 0) touched = P.time;
  if (touched >= 0 && P.time - touched > 1) { P.state.brake = true; P.aim = [0, 0, 1]; }
  tf.advance(0.5, [], false);
  if (s % 4 === 0 || P.onGround) log('t', st());
  if (h.crashed || (P.onGround && P.groundSpeed < 1)) break;
}
out.landed = st(); out.groundSpeed = +P.groundSpeed.toFixed(2);
tf.advance(1 / 60, [], true); await frames(2); await pyShot('landed');
key('F8'); tf.advance(0.2, [], false);
out.afterExit = { active: G.air?.active, airData: document.body.dataset.air, parked: !!G.air };
const t0 = [G.s.x, G.s.z]; tf.advance(2, ['fwd'], false); out.tankMoved = +Math.hypot(G.s.x - t0[0], G.s.z - t0[1]).toFixed(2);
tf.advance(1 / 60, [], true); await frames(2); await pyShot('back_in_tank');
key('F8'); for (let i = 0; i < 10 && !G.air?.active; i++) await frames(1); out.reenter = { active: G.air?.active, sameNear: Math.hypot(G.air.plane.position[0] - G.s.x, G.air.plane.position[2] - G.s.z) < 40 };
tf.pause(false);
return out;

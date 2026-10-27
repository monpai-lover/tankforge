// User report (2026-10-23): every landing ended as a crash. Each type in __IDS flown onto flat ground
// on a steady approach (gear and take-off flaps down, 1.12 x its rotation speed, the glide slope __SLOPE deg,
// default 3, no flare, throttle back below 4 m), then braking: touchdown sink rate, attitude, and whether
// the flight core called it a landing or a crash; the canopy's state after it stopped.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs(); tf.startBattle(); await frames(3); tf.pause(true);
const out = {}, slope = (window.__SLOPE || 3) * Math.PI / 180;
for (const id of (window.__IDS || 'me262,mig15,f86f,hunter6,f104g,mig21,mig29,mirage3e,su25').split(',')) {
  if (G.air?.active) x.exitAircraft(true);
  await x.enterAircraft(false, id);
  for (let i = 0; i < 30 && !G.air?.active; i++) await frames(1);
  const P = G.air.plane, T = P.type, v = (T.rotateKmh || 230) / 3.6 * 1.12, h0 = 60;
  const gx = G.s.x + 40, gz = G.s.z + 60, gy = tf.terrain?.height?.(gx, gz) ?? 0;
  P.spawn(gx, gy + h0, gz - h0 / Math.tan(slope) - 1500, 0, v, false);
  Object.assign(P.state, { gear: true, flaps: 'takeoff', throttle: 0.5, instructor: true });
  // a steady approach: the aim's pitch held on the glide slope's sink rate (__FLARE: the sink rate held
  // from 8 m), the throttle on the approach speed, idle from 4 m
  let touch = null, crashed = false, k = 0, prevVs = 0, trim = 0, flare = window.__FLARE;
  for (; k < 60 * 70; k++) {
    const h = P.hudState(), hs = Math.hypot(P.cur[7], P.cur[9]) || 1;
    const want = flare != null && h.agl < 8 ? -flare : -hs * Math.tan(slope);
    trim = Math.max(-0.25, Math.min(0.25, trim + (want - h.vs) * 0.0006));
    const gam = Math.atan2(want, hs) + trim;
    // the aim along the ground track (no turn), its climb angle on the wanted sink rate
    P.aim = [P.cur[7] / hs * Math.cos(gam), Math.sin(gam), P.cur[9] / hs * Math.cos(gam)];
    P.state.throttle = h.agl < 4 ? 0 : Math.max(0, Math.min(1, P.state.throttle + (v - hs) * 0.003));
    tf.advance(1 / 60, [], false);
    const h2 = P.hudState();
    if (!touch && (P.onGround || h2.crashed)) {
      const px = P.prev[0], pz = P.prev[2], th = (a, b) => tf.terrain.height(a, b);
      touch = { sink: +(-prevVs).toFixed(2), pitchDeg: +(P.prev[19] * 57.3).toFixed(1), bankDeg: +(P.prev[20] * 57.3).toFixed(1), ias: +h.ias.toFixed(0), gear: +P.prev[33].toFixed(2), slope: +(Math.abs(th(px + 2, pz) - th(px - 2, pz)) + Math.abs(th(px, pz + 2) - th(px, pz - 2))).toFixed(3), vyCore: +P.prev[8].toFixed(2), agl: +P.prev[35].toFixed(2), k };
    }
    prevVs = h2.vs;
    if (h2.crashed) {
      const px = P.prev[0], pz = P.prev[2], th = (a, b) => tf.terrain.height(a, b);
      crashed = { afterTouchS: touch ? +((k - touch.k) / 60).toFixed(2) : null, gs: +Math.hypot(P.prev[7], P.prev[9]).toFixed(1), vy: +P.prev[8].toFixed(2), pitchDeg: +(P.prev[19] * 57.3).toFixed(1), bankDeg: +(P.prev[20] * 57.3).toFixed(1), gear: +P.prev[33].toFixed(2), agl: +P.prev[35].toFixed(2), slope: +(Math.abs(th(px + 2, pz) - th(px - 2, pz)) + Math.abs(th(px, pz + 2) - th(px, pz - 2))).toFixed(3), water: G.map?.waterDepth?.(px, pz) ?? null };
      break;
    }
    if (touch) { P.state.brake = true; P.aim = [P.cur[7] / hs, 0, P.cur[9] / hs]; }
    if (touch && P.groundSpeed < 1) break;
  }
  for (let i = 0; i < 200; i++) { tf.advance(1 / 60, [], false); }
  out[id] = { touch, crashed, rolledS: +(k / 60).toFixed(1), stoppedKmh: +(P.groundSpeed * 3.6).toFixed(1), canopy: P.canopyK != null ? +P.canopyK.toFixed(2) : null, gearH: T.gear?.h ?? null };
}
return out;

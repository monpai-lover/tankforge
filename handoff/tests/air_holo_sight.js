// The cockpit view's gunsight on its combining glass (user request: the reflector / HUD sight's effect):
// each type in __IDS flown straight and level, seen from the seat; the combiner's outline on the screen
// and a shot of it.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs(); tf.startBattle(); await frames(3);
G.airBotsOn = false; G.airDefenceOn = false;
const out = {};
for (const id of (window.__IDS || 'f86f').split(',')) {
  if (G.air?.active) x.exitAircraft(true);
  await x.enterAircraft(false, id);
  for (let i = 0; i < 30 && !G.air?.active; i++) await frames(1);
  const P = G.air.plane, T = P.type;
  P.spawn(G.s.x, (tf.terrain?.height?.(G.s.x, G.s.z) ?? 0) + 900, G.s.z, 0, 170, false);
  Object.assign(P.state, { gear: false, throttle: 0.8, camera: 1 });
  P.aim = [0, 0.02, 1];
  await frames(90);
  for (let i = 0; i < 400 && P.cockpitHi && !P.cockpitHi.node; i++) await frames(1);
  await frames(10);
  // the glass seen from the cockpit eye: its middle's angle off the nose, its angular size (aircraft frame)
  const E = P.cockpitEye || T.eye, gl = P.sightGlass || [], c = [0, 1, 2].map(k => gl.reduce((a, q) => a + q[k], 0) / (gl.length || 1));
  const ang = (v) => [Math.atan2(v[0], v[2]) * 57.3, Math.atan2(v[1], Math.hypot(v[0], v[2])) * 57.3].map(a => +a.toFixed(2));
  const dirs = gl.map(q => ang([q[0] - E[0], q[1] - E[1], q[2] - E[2]]));
  const pw = G.air.pipper ? P.localPoint(G.air.pipper.at) : null;
  out[id] = { glass: gl.length, lcos: !!G.air.ctl?.eq?.lcos, pipper: !!G.air.pipper, eye: E.map(v => +v.toFixed(3)), seatEye: T.eye, glassMid: c.map(v => +v.toFixed(3)), glassDeg: ang([c[0] - E[0], c[1] - E[1], c[2] - E[2]]),
    glassYawRange: [Math.min(...dirs.map(d => d[0])), Math.max(...dirs.map(d => d[0]))], glassPitchRange: [Math.min(...dirs.map(d => d[1])), Math.max(...dirs.map(d => d[1]))], pipperDeg: pw ? ang([pw[0] - E[0], pw[1] - E[1], pw[2] - E[2]]) : null };
  await pyShot(`holo_${id}`);
  // __OUT: the closed canopy from outside, close on the cockpit
  if (window.__OUT) {
    P.state.camera = 0;
    G.camOverride = { pivot: P.worldPoint(T.eye), dist: 3.2, fov: 0.6 };
    for (const [tag, yaw, pitch] of [['side', 1.57, -0.15], ['front', 0.5, -0.3], ['rear', 2.6, -0.35]]) {
      G.cam.yaw = P.heading + yaw; G.cam.pitch = pitch;
      await frames(4);
      await pyShot(`canopy_${id}_${tag}`);
    }
    G.camOverride = null;
  }
}
return out;

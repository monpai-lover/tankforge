// What the HE contact burst (heContactEffects) adds for a small autocannon round: __VEH fires at the
// range __TGT from __DIST m for __STEPS steps (target revived when destroyed), with the burst on and
// off (__noContactBurst: only on a test page patched with that switch around the contact burst);
// kills, time to the first kill, crew hit, module health lost, and the core's time.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); tf.finishThumbs(); tf.setQuality('low');
tf.select(window.__VEH || 'de_gepard'); await frames(3); tf.startBattle(); await frames(5); tf.pause(true);
const E = G.enemies.find(e => e.id === (window.__TGT || 'us_m8'));
if (!E) return { missing: window.__TGT, have: G.enemies.map(e => e.id) };
const modSum = () => { const m = tf.enemyCombat(G.enemies.indexOf(E))?.state?.modules; return Array.isArray(m) ? m.reduce((a, v) => a + (typeof v === 'number' ? v : v?.health ?? 0), 0) : null; };
const out = { veh: G.id, target: E.id };
const H = x.hitcam; H.show = () => false;
const C = G.core, oc = C.call.bind(C);
for (const off of [false, true]) {
  globalThis.__noContactBurst = off;
  E.alive = false; x.reviveRangeEnemy(E);
  tf.place(E.x, E.z - (window.__DIST || 150), 0); G.cam.yaw = 0; G.cam.pitch = window.__PITCH ?? -0.012; tf.advance(1.5, [], false);
  let kills = 0, first = null, crew = 0, mods = 0, hits = 0, coreMs = 0, nb = 0;
  C.call = (req) => { const t0 = performance.now(); try { const r = oc(req); if (req.op === 'combat_surface_shoot' || req.op === 'combat_surface_near_burst') { if (req.op === 'combat_surface_shoot') hits++; else nb++; } return r; } finally { coreMs += performance.now() - t0; } };
  const seen = new Set();
  let prevCrew = null, mod0 = modSum(), modLost = 0;
  G.fireHeld = true;
  for (let k = 0; k < (window.__STEPS || 240); k++) {
    tf.advance(1 / 60, [], false);
    const caps = tf.enemyCombat(G.enemies.indexOf(E))?.caps;
    if (caps) {
      if (prevCrew != null && caps.crew_alive < prevCrew) crew += prevCrew - caps.crew_alive;
      prevCrew = caps.crew_alive;
    }
    if (caps?.destroyed || !E.alive) { const m = modSum(); if (m != null && mod0 != null) modLost += mod0 - m; kills++; if (first == null) first = +(k / 60).toFixed(2); E.alive = false; x.reviveRangeEnemy(E); prevCrew = null; mod0 = modSum(); }
  }
  G.fireHeld = false;
  { const m = modSum(); if (m != null && mod0 != null) modLost += mod0 - m; }
  C.call = oc;
  out[off ? 'burstOff' : 'burstOn'] = { hits, nearBursts: nb, kills, firstKillS: first, crewHit: crew, moduleHealthLost: Math.round(modLost), coreMs: Math.round(coreMs) };
}
return out;

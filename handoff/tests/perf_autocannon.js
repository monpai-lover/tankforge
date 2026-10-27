// A high-rate autocannon on a range target (user report: still stutters when it hits, mostly the
// hit replay): __VEH (default the Gepard), __RENDER (draw each step); per-step cost firing with the hit
// replay on and off, the replay's own methods timed, and (__PROF) the profile's top self-time.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); tf.finishThumbs();
tf.setQuality('low');
tf.select(window.__VEH || 'de_gepard'); await frames(3); tf.startBattle(); await frames(5); tf.pause(true);
document.querySelectorAll('#toast, .toast').forEach(el => el.style.visibility = 'hidden');
const render = !!window.__RENDER, out = { veh: G.id, render };
const E = G.enemies.filter(e => e.alive && e.id !== 'proto_a').sort((a, b) => a.z - b.z)[0];
out.target = E.id;
const H = x.hitcam, timers = {};
const wrap = (obj, name, label = name) => { const f = obj[name]; if (typeof f !== 'function') return; obj[name] = function (...a) { const t0 = performance.now(); try { return f.apply(this, a); } finally { const t = timers[label] ||= { n: 0, ms: 0, max: 0 }; const d = performance.now() - t0; t.n++; t.ms += d; t.max = Math.max(t.max, d); } }; };
wrap(H, 'show', 'hitcam.show'); wrap(H, 'render3d', 'hitcam.render3d'); wrap(H, 'tick', 'hitcam.tick');
const LR = G.localReplay; for (const m of ['acceptDischarge', 'recordProjectileStep', 'prepare', 'commit', 'commitEvidence', 'evidence']) wrap(LR, m, 'replay.' + m);
async function burst(label, steps, replayOn) {
  E.alive = false; x.reviveRangeEnemy(E);
  tf.place(E.x, E.z - (window.__DIST || 260), 0); G.cam.yaw = 0; G.cam.pitch = 0;
  for (const k in timers) delete timers[k];
  const off = H.show; if (!replayOn) H.show = () => false;
  tf.advance(1.5, [], false);
  // session prototype methods (the first session made while firing)
  let wrappedSession = false;
  const ts = []; G.fireHeld = true;
  for (let k = 0; k < steps; k++) {
    if (!wrappedSession && H.cur) { const proto = Object.getPrototypeOf(H.cur.session); if (!proto.__timed) { wrap(proto, 'append', 'session.append'); wrap(proto, 'prepareFrame', 'session.prepareFrame'); const dp = Object.getPrototypeOf(H.cur.draw); wrap(dp, 'prepare', 'draw.prepare'); wrap(dp, 'renderViews', 'draw.renderViews'); proto.__timed = true; } wrappedSession = true; }
    const t0 = performance.now(); tf.advance(1 / 60, [], render); ts.push(performance.now() - t0);
    if (render && k % 10 === 0) await frames(1);
  }
  G.fireHeld = false;
  H.show = off;
  ts.sort((a, b) => a - b);
  const caps = tf.enemyCombat(G.enemies.indexOf(E))?.caps;
  return { mean: +(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1), p95: +ts[Math.floor(ts.length * 0.95)].toFixed(1), max: +ts.at(-1).toFixed(1), timers: Object.fromEntries(Object.entries(timers).map(([k, v]) => [k, { n: v.n, ms: Math.round(v.ms), max: +v.max.toFixed(1) }])), replayEvents: H.cur?.session?.events?.length ?? null, destroyed: !!caps?.destroyed };
}
out.idle = await burst('idle', 30, true); G.fireHeld = false;
if (window.__PROF) await pyProfile('start');
out.replayOn = await burst('on', window.__STEPS || 120, true);
// two more replays of the same vehicle (revived: a new replay each), the context's uploads reused
out.replayOn2 = await burst('on2', window.__STEPS || 120, true);
out.replayOn3 = await burst('on3', window.__STEPS || 120, true);
if (window.__PROF) out.top = (await pyProfile('stop')).slice(0, 20);
out.replayOff = await burst('off', window.__STEPS || 120, false);
out.showT = (globalThis.__showT || []).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +v.toFixed(1)])));
out.showErr = globalThis.__showErr || [];
return out;

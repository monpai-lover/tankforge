// The NF-02's M61 on a range target tank (user report: the Vulcan stutters when it hits): per-update
// cost while the rounds strike, worst updates, the core calls by op, the callers of the surface
// traces and the hit camera's cost per hit; __PROF adds the profile's top self-time functions.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs(); await frames(2);
tf.select('su_t72a'); await frames(3); tf.startBattle(); await frames(3);
document.querySelector('.hangar-card[data-air=' + (window.__TYPE || 'nf02') + ']').click();
for (let i = 0; i < 80 && !G.air?.active; i++) await frames(1);
tf.pause(true);
const out = {}, E = G.enemies.filter(e => !e.dead).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
out.target = [E.x, E.z].map(Math.round);
const P = G.air.plane, run = (label, steps) => {
  const ts = [];
  for (let k = 0; k < steps; k++) {
    // keep the aim on the target, the jet at 300 m slant range
    const c = P.position, o = E.veh.body.origin(), d = [o[0] - c[0], o[1] + 1 - c[1], o[2] - c[2]], l = Math.hypot(...d); P.aim = d.map(v => v / l);
    const t0 = performance.now(); tf.advance(1 / 60, [], false); ts.push(performance.now() - t0);
  }
  ts.sort((a, b) => a - b);
  return { mean: +(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(2), p95: +ts[Math.floor(ts.length * 0.95)].toFixed(1), max: +ts.at(-1).toFixed(1) };
};
const place = () => { const o = E.veh.body.origin(); P.spawn(o[0], o[1] + 70, o[2] - 520, 0, 140, false); P.state.throttle = 0.45; run('aim', 75); };
place(); out.cruise = run('cruise', 40);
place(); G.air.fireAll = true;
if (window.__PROF) await pyProfile('start');
const ops = {}, stacks = {}; const C = G.core, oc = C.call.bind(C); C.call = (req) => { const t0 = performance.now(), n = JSON.stringify(req).length, r = oc(req), o = ops[req.op] ||= { n: 0, kb: 0, ms: 0 }; o.n++; o.kb += n / 1024; if (req.op === 'combat_surface_trace' && Math.random() < 0.02) { const st = new Error().stack.split('\n').slice(2, 7).map(l => l.trim().replace(/\(.*:(\d+):\d+\)/, '$1').replace(/^at /, '')).join(' < '); stacks[st] = (stacks[st] || 0) + 1; } o.ms += performance.now() - t0; return r; };
const hs = [], H = x.hitcam, hsh = H.show.bind(H); H.show = (...a) => { const t0 = performance.now(), r = hsh(...a); hs.push([+(performance.now() - t0).toFixed(1), r, !!a[1].replay]); return r; };
const a0 = G.air.guns.reduce((n, g) => n + g.ammo, 0);
const targetPose = E.pose, surfaceOwner = G.combat.surfaceOwner, surfacePose = surfaceOwner?.pose;
const poseWork = { targetRebuilds: 0, targetMs: 0, surfaceQueries: 0, surfaceMs: 0 };
E.pose = function (...args) { const start = performance.now(); try { return targetPose.apply(this, args); } finally { poseWork.targetRebuilds++; poseWork.targetMs += performance.now() - start; } };
if (surfacePose) surfaceOwner.pose = function (...args) { const start = performance.now(); try { return surfacePose.apply(this, args); } finally { poseWork.surfaceQueries++; poseWork.surfaceMs += performance.now() - start; } };
out.firing = run('firing', 90); out.slant = Math.round(Math.hypot(...P.position.map((v, i) => v - E.veh.body.origin()[i])));
E.pose = targetPose;
if (surfacePose) surfaceOwner.pose = surfacePose;
out.poseWork = { ...poseWork, targetMs: +poseWork.targetMs.toFixed(2), surfaceMs: +poseWork.surfaceMs.toFixed(2) };
if (window.__PROF) out.top = (await pyProfile('stop')).slice(0, 18);
G.air.fireAll = false; out.fired = a0 - G.air.guns.reduce((n, g) => n + g.ammo, 0);
C.call = oc; for (const o of Object.values(ops)) { o.kb = Math.round(o.kb); o.ms = Math.round(o.ms); } out.ops = ops; H.show = hsh; out.hitcam = hs; out.stacks = Object.entries(stacks).sort((a, b) => b[1] - a[1]).slice(0, 8); out.targetDead = !!E.dead;
return out;

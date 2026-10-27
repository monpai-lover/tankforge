// Where a high-rate autocannon's hits cost (user report: still stutters attacking a target): __VEH
// (default the Gepard) on a range target at __DIST m, every round hitting; steps without drawing.
// Per step: its time; per kind of work: the combat core's calls by op, the hit replay's methods, the
// hit path's own functions; and the slow steps (over 30 ms) with what ran in them. __PROF adds the
// profile's top self-time.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); tf.finishThumbs();
tf.setQuality('low');
tf.select(window.__VEH || 'de_gepard'); await frames(3); tf.startBattle(); await frames(5); tf.pause(true);
const H = x.hitcam, out = { veh: G.id };
const E = G.enemies.filter(e => e.alive && e.id !== 'proto_a').sort((a, b) => a.z - b.z)[0];
out.target = E.id;
let step = null;
const timers = {};
const note = (label, ms) => { const t = timers[label] ||= { n: 0, ms: 0, max: 0 }; t.n++; t.ms += ms; t.max = Math.max(t.max, ms); if (step) step[label] = (step[label] || 0) + ms; };
const wrap = (obj, name, label = name) => { const f = obj?.[name]; if (typeof f !== 'function' || f.__timed) return; const w = function (...a) { const t0 = performance.now(); try { return f.apply(this, a); } finally { note(label, performance.now() - t0); } }; w.__timed = true; obj[name] = w; };
const C = G.core, oc = C.call.bind(C);
C.call = (req) => { const t0 = performance.now(); try { return oc(req); } finally { note('core.' + req.op, performance.now() - t0); } };
wrap(H, 'show', 'hitcam.show');
for (const m of ['acceptDischarge', 'recordProjectileStep', 'prepare', 'commit']) wrap(G.localReplay, m, 'replay.' + m);
wrap(tf.sound, 'resolvedContact', 'sound.resolvedContact'); wrap(tf.sound, 'blast', 'sound.blast'); wrap(tf.sound, 'shot', 'sound.shot');
for (const m of ['shellArmor', 'explosion', 'shellGround', 'armorImpact']) wrap(tf.fx, m, 'fx.' + m);
wrap(tf.hud, 'toast', 'hud.toast'); wrap(tf.hud, 'hitMarker', 'hud.hitMarker');
E.alive = false; x.reviveRangeEnemy(E);
tf.place(E.x, E.z - (window.__DIST || 150), 0); G.cam.yaw = 0; G.cam.pitch = window.__PITCH ?? -0.012;
tf.advance(1.5, [], false);
for (const k in timers) delete timers[k];
const steps = [], slow = [];
if (window.__PROF) await pyProfile('start');
G.fireHeld = true;
for (let k = 0; k < (window.__STEPS || 180); k++) {
  if (H.cur && !H.cur.session.__w) { const p = Object.getPrototypeOf(H.cur.session); wrap(p, 'append', 'session.append'); wrap(p, 'prepareFrame', 'session.prepareFrame'); H.cur.session.__w = true; }
  step = {};
  const t0 = performance.now(); tf.advance(1 / 60, [], false); const d = performance.now() - t0;
  steps.push(d);
  if (d > 30) slow.push({ k, ms: +d.toFixed(1), ...Object.fromEntries(Object.entries(step).filter(([, v]) => v > 1).map(([a, v]) => [a, +v.toFixed(1)])) });
  // the target revived when destroyed, so the rounds keep hitting
  if (!E.alive || E.caps?.destroyed) { E.alive = false; x.reviveRangeEnemy(E); }
}
G.fireHeld = false; step = null;
if (window.__PROF) out.top = (await pyProfile('stop')).slice(0, 25);
steps.sort((a, b) => a - b);
out.steps = { n: steps.length, mean: +(steps.reduce((a, b) => a + b, 0) / steps.length).toFixed(1), p50: +steps[steps.length >> 1].toFixed(1), p95: +steps[Math.floor(steps.length * 0.95)].toFixed(1), max: +steps.at(-1).toFixed(1) };
out.work = Object.fromEntries(Object.entries(timers).sort((a, b) => b[1].ms - a[1].ms).map(([k, v]) => [k, { n: v.n, ms: Math.round(v.ms), per: +(v.ms / v.n).toFixed(2), max: +v.max.toFixed(1) }]));
out.slow = slow.slice(0, 12);
C.call = oc;
return out;

// Simulation cost per update (no drawing: SwiftShader rendering would swamp it), with the CPU
// profile's top self-time functions: A tank on the range, B the jet over the AA (AA firing),
// C the jet strafing with the M61.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs(); await frames(2);
const time = (n, fn) => { const t0 = performance.now(); for (let k = 0; k < n; k++) fn(k); return +((performance.now() - t0) / n).toFixed(2); };
const out = {};
tf.select('su_t72a'); await frames(3); tf.startBattle(); await frames(3); tf.pause(true);
tf.advance(1, [], false);
out.A_tank_ms = time(120, () => tf.advance(1 / 60, ['fwd'], false));
if (window.__PROF) { await pyProfile('start'); time(60, () => tf.advance(1 / 60, ['fwd'], false)); out.A_top = (await pyProfile('stop')).slice(0, 12); }
tf.pause(false); document.getElementById('jet-btn').click();
for (let i = 0; i < 80 && !(G.air?.active && G.air.plane.type.id === 'nf02'); i++) await frames(1);
tf.pause(true);
const P = G.air.plane; P.spawn(-200, 300, -600, 0.25, 200, false); P.aim = [Math.sin(0.25), 0, Math.cos(0.25)];
tf.advance(1, [], false);
if (window.__PROF) await pyProfile('start'); out.B_jet_aa_ms = time(window.__PROF ? 60 : 120, () => tf.advance(1 / 60, [], false)); if (window.__PROF) out.B_top = (await pyProfile('stop')).slice(0, 14);
out.B_shots = G.shots.length; out.B_bullets = G.bullets.length;
P.spawn(0, 120, -200, 0, 180, false); P.aim = [0, -0.25, 1].map(v => v / Math.hypot(0, 0.25, 1));
tf.advance(0.3, [], false); G.air.fireAll = true;
if (window.__PROF) await pyProfile('start'); out.C_strafe_ms = time(window.__PROF ? 60 : 120, () => tf.advance(1 / 60, [], false)); if (window.__PROF) out.C_top = (await pyProfile('stop')).slice(0, 14);
G.air.fireAll = false; out.C_bullets = G.bullets.length; out.C_shots = G.shots.length;
return out;

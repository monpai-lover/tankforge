// The gun pipper: diving at the range targets in the jet, where it says the rounds will land.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs(); document.getElementById('jet-btn').click();
for (let i = 0; i < 80 && !G.air?.active; i++) await frames(1);
tf.pause(true);
const P = G.air.plane; P.spawn(0, 420, -900, 0, 170, false); P.aim = [0, -0.35, 1].map(v => v / Math.hypot(0, 0.35, 1)); P.state.throttle = 0.7;
for (let k = 0; k < 150; k++) tf.advance(1 / 60, [], k % 5 === 4);
await frames(2);
const el = document.querySelector('#air-hud .air-pipper');
const out = { pipper: G.air.pipper && { ground: G.air.pipper.ground, range: Math.round(G.air.pipper.range), at: G.air.pipper.at.map(Math.round) }, shown: !el.hidden, label: el.textContent, left: el.style.left, top: el.style.top };
await pyShot('pipper');
// one round fired now: where it lands against where the pipper said
const n0 = G.bullets.length; let pred = null; G.air.fireAll = true;
for (let k = 0; k < 40 && G.bullets.length === n0; k++) { pred = G.air.pipper && G.air.pipper.at.slice(); tf.advance(1 / 60, [], true); }
G.air.fireAll = false;
const b = G.bullets[n0]; let last = b.s.pos.slice();
for (let k = 0; k < 200 && G.bullets.includes(b); k++) { last = b.s.pos.slice(); tf.advance(1 / 60, [], false); }
out.predicted = pred.map(Math.round); out.landed = last.map(Math.round); out.miss_m = +Math.hypot(pred[0] - last[0], pred[2] - last[2]).toFixed(1); out.agl = Math.round(P.cur[35]); out.pitch = +(Math.asin(P.cur[49]) * 57.3).toFixed(1);
return out;

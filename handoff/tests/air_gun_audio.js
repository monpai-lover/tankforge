// Firing the NF-01's guns from the chase camera and from the cockpit: which sounds start (the rounds'
// flight whiz / crack must not play for its own guns), and the trackers they take.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
await tf.coreReady().catch(e => null); await x.flightCoreP;
const S = tf.sound, started = [];
const nameOf = (buf) => { for (const [k, v] of S.full?.buffers || []) if (v === buf) return k; return 'other'; };
const bs = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (...a) { started.push(nameOf(this.buffer)); return bs.apply(this, a); };
const count = () => { const c = {}; for (const s of started.splice(0)) { const k = s.replace(/_\d$/, '_*'); c[k] = (c[k] || 0) + 1; } return c; };
const run = (secs) => { for (let k = 0; k < secs * 10; k++) tf.advance(0.1, [], true); };
tf.finishThumbs(); await frames(2); tf.startBattle(); await frames(3); S.start();
document.querySelector('.hangar-card[data-air=nf01]').click();
for (let i = 0; i < 40 && !G.air?.active; i++) await frames(1);
tf.pause(true); S.setFullAudible = () => S.full?.suspend(false); S.full?.suspend(false);
const P = G.air.plane, out = {};
for (const cam of [0, 0, 1]) {
  P.spawn(-3000, 600, -3000, Math.PI, 90, false); P.aim = [0, 0, -1]; P.state.camera = cam;
  run(0.3); await wait(4000); run(0.2); count();
  G.air.fireAll = true; let peak = 0; for (let k = 0; k < 60; k++) { tf.advance(1 / 60, [], k % 6 === 0); await wait(16); peak = Math.max(peak, [...S.full.voices].filter(v => !v.loop).length); } G.air.fireAll = false; run(0.5);
  out[(cam ? 'cockpit' : 'chase') + Object.keys(out).length] = { sounds: count(), trackers: S.full.trackers.size, fired: G.air.guns.map(g => g.fired), peakOneShotVoices: peak };
}
return out;

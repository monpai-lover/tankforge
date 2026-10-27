// Hold the machine-gun trigger: which sounds start besides the gun report?
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
const S = tf.sound, started = [];
const nameOf = (buf) => { for (const [k, v] of S.full?.buffers || []) if (v === buf || v?.buffer === buf) return 'full:' + k; for (const [k, v] of Object.entries(S.reloadSamples || {})) if (v === buf) return 'reload:' + k; return 'other(' + (buf ? buf.duration.toFixed(2) : '') + ')'; };
const bs = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (...a) { started.push(nameOf(this.buffer) + (this.loop ? ' [loop]' : '')); return bs.apply(this, a); };
const os = OscillatorNode.prototype.start; OscillatorNode.prototype.start = function (...a) { started.push('synth:' + this.type); return os.apply(this, a); };
const out = {};
for (const id of ['de_pz3_j', 'su_t72a']) {
  tf.finishThumbs(); await frames(2); tf.select(id); await frames(4); tf.startBattle(); await frames(3); S.start();
  await new Promise(r => setTimeout(r, 3000));
  started.length = 0; await new Promise(r => setTimeout(r, 1000)); const idle = started.splice(0);
  G.mgHeld = true; await new Promise(r => setTimeout(r, 1500)); G.mgHeld = false; await new Promise(r => setTimeout(r, 1500));
  const c = {}; for (const s of started) c[s] = (c[s] || 0) + 1;
  const ci = {}; for (const s of idle) ci[s] = (ci[s] || 0) + 1;
  out[id] = { idle: ci, mgBurst: c, mgs: tf.state().mg.map(m => [m.id, m.fired, m.heat]) };
}
return out;

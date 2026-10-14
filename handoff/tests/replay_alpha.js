const tf = window.__tf, x = window.__tfx, G = tf.G;
const out0 = {};
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.select('de_tiger_e'); await frames(3); x.setProtect(true); await frames(3);
for (const ndc of [[0.05, 0], [0, -0.1], [-0.1, -0.05], [0.1, -0.15], [0, 0.05], [-0.2, -0.1]]) { x.protFire(ndc); if (x.hitcam.active) break; await frames(1); } tf.pause(true); out0.lastCam = !!G.lastCam; out0.info = document.getElementById('prot-info').textContent;
const H = x.hitcam, out = { active: H.active, ...out0 };
if (!H.active) { tf.pause(false); return out; }
const stats = () => {
  const c = document.querySelector('canvas.supplied-replay-v3'); if (!c || c.style.display === 'none') return { canvas: !!c, shown: false };
  const gl = c.getContext('webgl2'); const w = c.width, h = c.height, px = new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let partial = 0, zero = 0, full = 0, minA = 255;
  for (let i = 3; i < px.length; i += 4) { const a = px[i]; if (a === 255) full++; else if (a === 0) zero++; else partial++; minA = Math.min(minA, a); }
  return { w, h, full, zero, partial, minA, style: c.style.cssText };
};
for (const t of [0.6, 2.4, 3.4]) {
  H.cur.t = t; tf.advance(1/60, [], true); await frames(2);
  out['t' + t] = { stage: H.stage().name, ...stats() };
  await pyShot('replay_t' + t);
}
tf.pause(false); return out;

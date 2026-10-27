// Hover one spot while the view sways slightly each frame: does the label flip to "computing"?
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.select('su_t72a'); await frames(3); x.setProtect(true); await frames(3);
const P = x.protection;
let r = null;
for (const py of [0, 0.1, -0.1, 0.2, 0.3, -0.2]) { for (const px of [0, 0.1, -0.1, 0.2, -0.2, 0.3]) { const q = x.protRay([px, py]); P.inspectionAt = -1e9; P.inspectionCache = null; const v = P.pick(q.o, q.d, G.T[0].yaw); if (v && Number.isFinite(v.need)) { r = q; break; } } if (r) break; }
if (!r) return { error: 'no armour point' };
P.inspectionAt = -1e9; P.inspectionCache = null;
P.cursor.pointer = { x: 400, y: 300, down: false };
const seen = []; let last = null, flips = 0;
for (let k = 0; k < 90; k++) {
  const j = 0.002 * Math.sin(k * 0.7);
  P.pick(r.o.map((v, i) => v + (i === 0 ? j : 0)), r.d, G.T[0].yaw);
  const text = P.cursor.primary?.textContent || '';
  const pending = /—$/.test(text);
  if (last !== null && pending !== last) flips++;
  last = pending; if (k % 10 === 0) seen.push(text);
  await new Promise(res => setTimeout(res, 16));
}
return { flips, seen };

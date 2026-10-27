const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
const res = {};
for (const id of (window.__IDS || ['su_t72a', 'de_tiger_e', 'de_pz3_j', 'proto_a'])) {
  tf.select(id); await frames(3); x.setProtect(true); await frames(2);
  const P = x.protection, cnt = {}, samples = [];
  for (let i = -4; i <= 4; i++) for (let j = -3; j <= 2; j++) {
    const r = x.protRay([i * 0.08, j * 0.08]); if (!r) continue;
    P.inspectionAt = -1e9; P.inspectionCache = null;
    const v = P.pick(r.o, r.d, G.T[0].yaw);
    const k = v ? v.verdict + (v.reason ? ':' + v.reason : '') : 'miss';
    cnt[k] = (cnt[k] || 0) + 1;
    if (v && v.need != null && samples.length < 4) samples.push(P.describe(v) + ' [' + v.geometrySource + ']');
  }
  res[id] = { cnt, samples };
  x.setProtect(false); await frames(1);
}
return res;

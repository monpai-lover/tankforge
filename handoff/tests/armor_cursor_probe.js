const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.select('su_t72a');
await frames(3);
x.setProtect(true);
await frames(3);
const P = x.protection, out = {};
out.combat = !!G.combat; out.core = !!G.combat?.core; out.rev = G.combat?.core?.combatSurfaceRevision;
out.spec = P.bundle?.vehicle?.id; out.packet = !!x.data.surfaceCatalog[out.spec];
const r = x.protRay([0, 0]);
out.ray = r;
try { const posed = P._analysisScene(G.combat, x.data.surfaceCatalog[out.spec], out.spec); out.posed = { available: posed?.available, reason: posed?.reason, detail: posed?.detail }; } catch (e) { out.sceneErr = String(e.stack || e); }
try { const end = r.o.map((v, k) => v + r.d[k] * 200); const c = G.combat.core.combatSurfaceTrace(P.analysisKey, r.o, end).crossings; out.crossings = c.slice(0, 4); 
  try { const rep = P._analysisShot(G.combat, r.o, r.d, G.T[0].yaw, end); out.rep = { hit: rep.hit, outcome: rep.outcome, layers: rep.layers, pen: rep.pen_mm, keys: Object.keys(rep) }; } catch (e) { out.shotErr = String(e.stack || e); }
} catch (e) { out.traceErr = String(e.stack || e); }
P.inspectionAt = -1e9; P.inspectionCache = null;
const v = P.pick(r.o, r.d, G.T[0].yaw);
out.pick = v && { verdict: v.verdict, need: v.need, pen: v.pen, reason: v.reason, src: v.geometrySource };
out.describe = P.describe(v);
return out;

// For every vehicle on the page that has a surface catalog: the corrected catalog registers with the
// native core (analysis registration, as the protection analysis uses), and 3BM22 fired along the
// inward normal of two plates is checked for "unsupported_surface_resistance" stops.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const log = (...a) => console.log('@@', ...a.map(v => typeof v === 'string' ? v : JSON.stringify(v)));
await tf.coreReady().catch(e => null);
tf.finishThumbs();
const v3a = (p) => Array.isArray(p) ? p : [p.x, p.y, p.z], out = [];
for (const id of Object.keys(x.data.surfaceCatalog)) {
  if (!x.data.vehicles[id]) continue;
  tf.select(id); await frames(3); x.setProtect(true); await frames(2);
  const P = x.protection, row = { id, selected: G.id };
  try {
    const posed = P._analysisScene(G.combat, x.data.surfaceCatalog[id], id);
    row.available = posed?.available; row.detail = posed?.detail || posed?.reason || null;
    row.unaudited = P.analysisOwner?.packet(id)?.unauditedSurfaces ?? 0;
    P.shell = x.data.projectiles.apfsds_125_3bm22;
    row.shots = [];
    for (const p of (P.bundle.armor || []).filter(q => /side_r$|turret_front|hull_rear/.test(q.id)).slice(0, 3)) {
      const c = v3a(p.center), n = v3a(p.normal), o = c.map((q, i) => q + n[i] * 25), d = n.map(q => -q), end = o.map((q, i) => q + d[i] * 200);
      const r = P._analysisShot(G.combat, o, d, 0, end);
      row.shots.push([p.id, p.thickness_mm, r.outcome, (r.events || []).includes('unsupported_surface_resistance') ? 'UNSUPPORTED_STOP' : '']);
    }
  } catch (e) { row.error = String(e.message || e); }
  x.setProtect(false); await frames(1);
  log('row', row); out.push(row);
}
return out;

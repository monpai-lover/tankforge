/* TF_AIRCRAFT_HUD_LADDER_BEGIN */
// Presentation only. Keep the existing collimation, eye box and physical glass
// clip; pitch values come from the accepted aircraft nose, not the camera aim.
var TFAircraftHudLadder = (() => {
  const sourceId = type => type?.variantSourceId || type?.id || '';
  function draw(g, plane, position, projectPoint, font, pane) {
    const state = plane.cur;
    if (!state || !Number.isFinite(state[49]) || !Number.isFinite(state[18])) return 0;
    const size = Math.max(8, Math.min(17, Number.isFinite(font) ? font : 10));
    const pitch = Math.asin(Math.max(-1, Math.min(1, state[49]))) * 180 / Math.PI;
    const center = Math.round(pitch / 5) * 5;
    const first = Math.max(-90, center - 35), last = Math.min(90, center + 35);
    const heading = state[18], sx = Math.sin(heading), cz = Math.cos(heading);
    const half = .035, cs = Math.cos(half), sn = Math.sin(half), pad = size * 1.45;
    let left = -Infinity, top = -Infinity, right = Infinity, bottom = Infinity;
    if (pane?.length >= 3) {
      left = top = Infinity; right = bottom = -Infinity;
      for (const p of pane) {
        left = Math.min(left, p[0]); right = Math.max(right, p[0]);
        top = Math.min(top, p[1]); bottom = Math.max(bottom, p[1]);
      }
    }
    let painted = 0;
    g.save();
    try {
      g.font = `${size}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let degrees = first; degrees <= last; degrees += 5) {
        const r = degrees * Math.PI / 180, cr = Math.cos(r), sr = Math.sin(r);
        // A horizontal tangent stays nonzero at either pole. Varying longitude
        // instead made the old +/-90 degree bar collapse to a single point.
        const a = projectPoint([position[0] + (sx * cr * cs - cz * sn) * 1e6,
          position[1] + sr * cs * 1e6, position[2] + (cz * cr * cs + sx * sn) * 1e6]);
        const b = projectPoint([position[0] + (sx * cr * cs + cz * sn) * 1e6,
          position[1] + sr * cs * 1e6, position[2] + (cz * cr * cs - sx * sn) * 1e6]);
        if (!a || !b || !a.every(Number.isFinite) || !b.every(Number.isFinite)) continue;
        if (Math.max(a[0], b[0]) < left - pad * 4 || Math.min(a[0], b[0]) > right + pad * 4 ||
            Math.max(a[1], b[1]) < top - pad * 4 || Math.min(a[1], b[1]) > bottom + pad * 4) continue;
        const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
        if (!(length > .5)) continue;
        const ux = dx / length, uy = dy / length;
        g.setLineDash(degrees < 0 ? [size * .35, size * .35] : []);
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        g.setLineDash([]);
        g.fillText(String(degrees), a[0] - ux * pad, a[1] - uy * pad);
        g.fillText(String(degrees), b[0] + ux * pad, b[1] + uy * pad);
        painted++;
      }
    } finally { g.restore(); }
    return painted;
  }
  return Object.freeze({sourceId, draw});
})();
/* TF_AIRCRAFT_HUD_LADDER_END */

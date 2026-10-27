// The types drawn from their models (data.aircraftModels, tools/aircraft_glb): __IDS in the hangar from
// several sides, the control surfaces deflected (roll, pitch, yaw, flaps), the X-ray with the internal
// modules, the cockpit view from the pilot's eye; and in numbers: the parts, the movers, the hitbox and the
// damage parts.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs();
document.querySelector('#g-mode .tab[data-g=air]').click();
for (let i = 0; i < 30 && !G.airGarage.plane; i++) await frames(1);
document.querySelectorAll('#g-info, #g-bottom, #g-top').forEach(el => el.style.visibility = 'hidden');
const out = {};
const shot = async (name, pivot, yaw, pitch, dist, fov = 0.75) => {
  const p = G.airGarage.plane;
  G.camOverride = { pivot, dist, fov };
  G.cam.yaw = p.heading + yaw; G.cam.pitch = pitch;
  await frames(4);
  await pyShot(name);
};
for (const id of (window.__IDS || 'mig29').split(',')) {
  document.querySelector(`#air-list .card[data-air=${id}]`).click();
  await frames(3);
  const p = G.airGarage.plane, T = p.type, c = p.drawPos, L = Math.max(G.airGarage.size.len, G.airGarage.size.span);
  const hb = p.hitbox;
  out[id] = {
    imported: !!p.imported, textured: p.texNodes?.length, texture: !!p.body.texture, internal: !!p.internalNode,
    movers: p.controls.map(k => `${k.type}${k.posed ? '*' : ''}`).join(' '),
    hitbox: { tris: hb.count, pieces: hb.pieces.map(pc => pc.name).join(' ') },
    parts: p.damage.parts.map(q => `${q.id}`).join(' '),
    eye: T.eye, gear: T.gear, nozzle: T.nozzle
  };
  for (const [tag, yaw, pitch, dist] of (window.__VIEWS || [['q', 0.8, -0.35, 1.15], ['side', 1.57, -0.05, 1.0], ['under', 2.4, 0.45, 1.05], ['rear', 3.6, -0.2, 1.05]])) await shot(`${id}_${tag}`, c, yaw, pitch, L * dist);
  // __CANOPY: the canopy closed (canopyK 0), close on the cockpit from three sides
  if (window.__CANOPY && p.canopyK != null) {
    const keepK = p.canopyK, eyeW = p.worldPoint(T.eye || [0, 0, 0]);
    p.canopyK = 0; p._canopyHold = true; p.pose(1);
    for (const [tag, yaw, pitch] of [['cside', 1.57, -0.25], ['cfront', 0.6, -0.35], ['crear', 2.5, -0.45], ['ctop', 1.2, -1.2]]) {
      p.canopyK = 0; p.pose(1);
      await shot(`${id}_${tag}`, eyeW, yaw, pitch, 3.0, 0.6);
    }
    p.canopyK = keepK; p._canopyHold = false; p.pose(1);
  }
  // __GEAR: the gear half way and up (the retraction's poses), from below
  if (window.__GEAR) for (const [tag, g] of [['gear50', 0.5], ['gear0', 0]]) {
    const S = p.cur, keep = S[33];
    S[33] = g; p.pose(1);
    await shot(`${id}_${tag}`, c, 2.4, 0.45, L * 0.9);
    S[33] = keep; p.pose(1);
  }
  // the controls deflected: roll right, nose up, yaw right, flaps down
  const S = p.cur, keep = [S[24], S[25], S[26], S[34]];
  S[24] = 1; S[25] = 1; S[26] = 1; S[34] = 1; p.pose(1);
  await shot(`${id}_controls`, c, 2.6, -0.45, L * 0.9);
  S[24] = keep[0]; S[25] = keep[1]; S[26] = keep[2]; S[34] = keep[3]; p.pose(1);
  tf.setXray(true); await frames(2);
  await shot(`${id}_xray`, c, 1.2, -0.5, L * 0.95);
  tf.setXray(false); p.setXray(false);
  // the cockpit from the pilot's eye
  p.state.camera = 1; p.pose(1);
  // the full cockpit loads on the first look from the seat
  for (let i = 0; i < 600 && p.cockpitHi && !p.cockpitHi.node; i++) { await frames(1); p.pose(1); }
  p.pose(1);
  out[id].cockpitHi = p.cockpitHi ? !!p.cockpitHi.node : null;
  const eye = p.worldPoint(T.eye);
  await shot(`${id}_cockpit`, eye, 0, -0.18, 0.02, 1.25);
  p.state.camera = 0; p.pose(1);
}
G.camOverride = null;
return out;

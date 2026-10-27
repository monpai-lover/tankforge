// What a new hit replay uploads to the replay context (user report: a fast autocannon stutters on
// hits, mostly the hit replay): __VEH (default the Gepard) fires bursts at a range target, revived
// between them so each burst opens a new replay; drawn each step (the replay publishes when it draws).
// Per replay: the meshes and vertices uploaded, the time its show took,
// and the replays shown; then a replay with every upload cached is drawn and pictured.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); tf.finishThumbs();
tf.setQuality('low');
tf.select(window.__VEH || 'de_gepard'); await frames(3); tf.startBattle(); await frames(5); tf.pause(true);
document.querySelectorAll('#toast, .toast').forEach(el => el.style.visibility = 'hidden');
const H = x.hitcam, out = { veh: G.id, bursts: [] };
const E = G.enemies.filter(e => e.alive && e.id !== 'proto_a').sort((a, b) => a.z - b.z)[0];
out.target = E.id;
let stats = null, wrapped = false;
const shows = [];
const show = H.show.bind(H);
let showCalls = 0, showOk = 0;
H.show = (...a) => { showCalls++; const before = H.cur; const t0 = performance.now(); const r = show(...a); if (r) showOk++; if (r && H.cur !== before) shows.push(+(performance.now() - t0).toFixed(1)); return r; };
function wrapRenderer() {
  const surface = H.presentation.surface;
  if (wrapped || !surface) return;
  wrapped = true;
  const r = surface.renderer, up = r.upload.bind(r);
  r.upload = (g) => { stats.meshes++; stats.vertices += g.p.length / 3; return up(g); };
}
for (let b = 0; b < (window.__BURSTS || 3); b++) {
  E.alive = false; x.reviveRangeEnemy(E);
  tf.place(E.x, E.z - (window.__DIST || 150), 0); G.cam.yaw = 0; G.cam.pitch = window.__PITCH ?? -0.012;
  tf.advance(1.5, [], false);
  stats = { meshes: 0, vertices: 0 };
  const shown0 = shows.length, calls0 = showCalls, ok0 = showOk, shots0 = G.localReplay?.dischargeSerial ?? 0;
  G.fireHeld = true;
  for (let k = 0; k < (window.__STEPS || 60); k++) {
    tf.advance(1 / 60, [], true);
    wrapRenderer();
    if (k % 10 === 0) await frames(1);
  }
  G.fireHeld = false;
  for (let k = 0; k < 20; k++) tf.advance(1 / 60, [], true);
  out.bursts.push({ fired: (G.localReplay?.dischargeSerial ?? 0) - shots0, showCalls: showCalls - calls0, showAccepted: showOk - ok0, replaysOpened: shows.length - shown0, firstShowMs: shows[shown0] ?? null, uploadedMeshes: stats.meshes, uploadedVertices: stats.vertices, cache: H.presentation.surface ? { meshes: H.presentation.surface.gpuCache?.size ?? null, textures: H.presentation.surface.textureCache?.size ?? null } : null });
  // let the replay finish before the next burst (a new replay then, not an append)
  for (let k = 0; k < 600 && H.cur; k++) tf.advance(1 / 60, [], k % 30 === 0);
}
// a replay on screen
E.alive = false; x.reviveRangeEnemy(E);
tf.place(E.x, E.z - (window.__DIST || 150), 0); G.cam.yaw = 0; G.cam.pitch = window.__PITCH ?? -0.012; tf.advance(1.5, [], false);
G.fireHeld = true;
for (let k = 0; k < 120 && !H.cur; k++) tf.advance(1 / 60, [], true);
G.fireHeld = false;
for (let k = 0; k < 30; k++) tf.advance(1 / 60, [], true);
await frames(2);
out.onScreen = !!H.cur && !H.root.hidden;
if (window.__SHOT) try { await pyShot('replay'); } catch (e) { out.shot = String(e).slice(0, 120); }
// the context released: its caches go with it
H.presentation.contextLost();
out.afterContextLoss = { surface: !!H.presentation.surface };
return out;

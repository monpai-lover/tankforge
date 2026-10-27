// Where one combat-core call's time goes: request size, the core's own time (tg_call + decode,
// DesignCore.lastMs) and the response's size, for the near burst and the hit (__TGT).
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); tf.finishThumbs(); tf.setQuality('low');
tf.select('de_gepard'); await frames(3); tf.startBattle(); await frames(5); tf.pause(true);
const C = G.core, oc = C.call.bind(C), rows = {};
C.call = (req) => { const t0 = performance.now(), reqKb = JSON.stringify(req).length / 1024; const r = oc(req); const total = performance.now() - t0, core = C.lastMs, resKb = JSON.stringify(r).length / 1024; const o = rows[req.op] ||= { n: 0, total: 0, core: 0, reqKb: 0, resKb: 0, keys: Object.keys(r || {}).join(',') }; o.n++; o.total += total; o.core += core; o.reqKb += reqKb; o.resKb += resKb; return r; };
const E = G.enemies.find(e => e.id === (window.__TGT || 'de_tiger_e'));
tf.place(E.x, E.z - 150, 0); G.cam.yaw = 0; G.cam.pitch = -0.012; tf.advance(1.5, [], false);
x.hitcam.show = () => false;
G.fireHeld = true; for (let k = 0; k < 90; k++) { tf.advance(1 / 60, [], false); if (!E.alive) { E.alive = false; x.reviveRangeEnemy(E); } } G.fireHeld = false;
C.call = oc;
const out = {};
for (const [op, o] of Object.entries(rows)) out[op] = { n: o.n, totalPer: +(o.total / o.n).toFixed(1), corePer: +(o.core / o.n).toFixed(1), reqKb: +(o.reqKb / o.n).toFixed(1), resKb: +(o.resKb / o.n).toFixed(1), keys: o.keys.slice(0, 200) };
return out;

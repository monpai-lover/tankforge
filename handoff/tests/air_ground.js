// The NF-01 on the ground: wheel heights in the drawn pose (three-point attitude), tail lifting with speed, Z zoom.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs();
document.getElementById('air-btn').click();
for (let i = 0; i < 40 && !G.air?.active; i++) await frames(1);
tf.pause(true);
const P = G.air.plane, out = {};
const wheels = () => { const m = P.root.local, at = (y, z) => [m[1] * 0 + m[5] * y + m[9] * z + m[13]]; const p = P.drawPos, gy = G.air.groundAt ? G.air.groundAt(p[0], p[2]) : (x.missileTerrain ? null : null); return { main: +(at(-1.57, 0.14)[0]).toFixed(2), tail: +(at(-0.79, -4.16)[0]).toFixed(2), origin: +p[1].toFixed(2) }; };
tf.advance(0.5, [], true); await frames(2);
out.parked = { ...wheels(), agl: +P.hudState().agl.toFixed(2), ias: +P.hudState().ias.toFixed(0) };
await pyShot('parked');
P.state.throttle = 1.0;
for (let s = 0; s < 14; s++) { tf.advance(1, [], false); const h = P.hudState(); if (s % 2 === 1) out['t' + s] = { ...wheels(), ias: +h.ias.toFixed(0), agl: +h.agl.toFixed(2) }; }
tf.advance(1 / 60, [], true); await frames(2); await pyShot('rolling');
const c0 = P.camera(1 / 60, () => 0).fovY; P.keys.add('KeyZ'); for (let k = 0; k < 30; k++) P.camera(1 / 60, () => 0); const c1 = P.camera(1 / 60, () => 0).fovY; P.keys.delete('KeyZ');
out.fov = [+(c0 * 57.3).toFixed(0), +(c1 * 57.3).toFixed(0)];
return out;

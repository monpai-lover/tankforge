// The NF-01 flying level at 300 m over the range's anti-aircraft vehicles: do they track, fire, hit
// and bring it down; what the damage did to the flight.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs(); document.querySelector(`.hangar-card[data-air=${window.__AIRBTN === 'jet-btn' ? 'nf02' : window.__AIR || 'nf01'}]`).click();
for (let i = 0; i < 40 && !G.air?.active; i++) await frames(1);
tf.pause(true);
const aa = G.enemies.filter(e => ['de_flakpz38t', 'de_gepard'].includes(e.id)).map(e => ({ id: e.id, x: Math.round(e.x), z: Math.round(e.z) }));
const P = G.air.plane; P.spawn(-200, 300, -600, 0.25, window.__AIRSPEED || 95, false); P.aim = [Math.sin(0.25), 0, Math.cos(0.25)];
tf.advance(0.1, [], false);
const log = []; let t = 0, firedAt = null, firstHit = null, downAt = null, shots = 0;
const n0 = G.shots.length; const push = G.shots.push.bind(G.shots); G.shots.push = (...a) => { for (const s of a) if (s.from?.startsWith?.('aa:')) shots++; return push(...a); };
let lastRev = 0; const hits = []; const D0 = P.damage; const oh = D0.hit.bind(D0); D0.hit = (a, b, E, tnt, inc, rnd) => { const before = D0.parts.map(p => Math.round(p.hp)); const r = oh(a, b, E, tnt, inc, rnd); if (r) hits.push({ t: Math.round(t * 100) / 100, E: Math.round(E), tnt: +tnt.toFixed(3), parts: r.parts, killed: r.killed, fire: D0.fire > 0, hp: D0.parts.map((p, i) => before[i] - Math.round(p.hp)).join(',') }); return r; };
for (let k = 0; k < 60 * 45 && !P.crashed; k++) {
  tf.advance(1 / 60, [], k % 60 === 0); t += 1 / 60;
  if (shots && firedAt == null) firedAt = t;
  if (P.damage.revision !== lastRev) { lastRev = P.damage.revision; if (firstHit == null) firstHit = t; }
  if (downAt == null && (P.damage.pilotDead || P.damage.broken || P.damage.dead('wing_l') || P.damage.dead('wing_r') || P.damage.dead('tail'))) downAt = t;
  if (k % 180 === 0) log.push([Math.round(t), Math.round(P.position[0]), Math.round(P.cur[35]), Math.round(P.cur[13] * 3.6), P.damage.summary()]);
}
await pyShot('aa_end');
return { hits: hits.slice(0, 12), nh: hits.length, aa, shots, firedAt, firstHit, downAt, crashed: P.crashed, t: Math.round(t), summary: P.damage.summary(), killed: P.damage.log, log, toast: document.querySelector('#toast')?.textContent, flags: document.querySelector('#air-hud .air-flags')?.textContent };

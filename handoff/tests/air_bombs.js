// Bombs and rockets against a range Tiger (user requests: bombs and rockets stronger): a Mk 82 placed
// short of the tank by __SHORT metres (default 6 and 0) and a LAU-3 rocket attack in a dive; the
// worst the target came to (the range revives its targets after a while).
const tf = window.__tf, x = window.__tfx, G = tf.G, out = {};
const next = () => new Promise(r => setTimeout(r, 0));
await tf.coreReady(); await x.flightCoreP; tf.pause(true); tf.finishThumbs();
const step = (n, fn) => { for (let i = 0; i < n; i++) { fn?.(i); tf.advance(1 / 60, [], false); } };
async function board(id, lo) {
  if (G.air?.active) x.exitAircraft(true);
  G.airLoadout[id] = lo;
  document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for (let i = 0; i < 120 && !(G.air?.active && G.air.plane.type.id === id); i++) { tf.advance(1 / 60, [], false); await next(); }
  return G.air;
}
G.airBotsOn = false;
const tiger = () => tf.enemies().map((e, i) => ({ ...e, i })).find(e => e.id === 'de_tiger_e');
const watch = (i) => { const w = { destroyed: false, crewMin: 9, tracks: false, fire: false, mobility: false }; return { w, look() { const c = tf.enemyCombat(i).caps || {}; w.destroyed ||= !!c.destroyed || !tf.enemyCombat(i).alive; w.crewMin = Math.min(w.crewMin, c.crew_alive ?? 9); w.tracks ||= c.track_left === false || c.track_right === false; w.fire ||= c.can_fire === false; w.mobility ||= c.can_move === false; } }; };
for (const short of window.__SHORTS || [6, 2, 0]) {
  const air = await board('f4e', 2), p = air.plane; air.stores.sel = air.stores.groups.indexOf('mk82');
  const e = tiger(); G.enemies[e.i].alive = false; x.reviveRangeEnemy(G.enemies[e.i]);
  const E = tiger(), gy = G.enemies[E.i].veh.body.origin()[1], W = watch(E.i);
  p.spawn(E.x, gy + 600, E.z - 3200, 0, 210, false); x.applyStoreLoad(air); p.state.throttle = 0.85;
  let rel = false, burst = null; const ex = tf.fx.explosion.bind(tf.fx); tf.fx.explosion = (q, d, kg, gnd) => { if (kg > 50 && !burst) burst = q.slice(); return ex(q, d, kg, gnd); };
  step(25 * 60, () => { p.aim = [0, 0, 1]; W.look(); if (!rel && air.impact && air.impact.at[2] >= E.z - short) { air.storeTap = true; rel = true; } });
  tf.fx.explosion = ex;
  out[`mk82_${short}m`] = { missM: burst ? +Math.hypot(burst[0] - E.x, burst[2] - E.z).toFixed(1) : null, ...W.w };
}
{
  const air = await board('f4e', 3), p = air.plane; air.stores.sel = air.stores.groups.indexOf('lau3');
  const e = tiger(); G.enemies[e.i].alive = false; x.reviveRangeEnemy(G.enemies[e.i]);
  const E = tiger(), En = G.enemies[E.i], at = () => { const o = En.veh.body.origin(); return [o[0], o[1] + 1, o[2]]; }, W = watch(E.i);
  const aimAt = (q) => { const d = q.map((v, k) => v - p.position[k]), l = Math.hypot(...d); p.aim = d.map(v => v / l); p.aimBias = [0, 0, 0, 1]; };
  p.spawn(E.x, at()[1] + 700, E.z - 1900, 0, 170, false); x.applyStoreLoad(air); p.state.throttle = 0.5;
  step(5 * 60, () => aimAt(at()));
  air.storeHeld = true; step(60, () => { aimAt(at()); W.look(); }); air.storeHeld = false;
  step(8 * 60, () => { p.aim = [0, 0.3, 1]; W.look(); });
  out.lau3 = { fired: 19 * 4 - air.stores.items.filter(it => it.id === 'lau3').reduce((n, it) => n + it.count, 0), ...W.w };
}
return out;

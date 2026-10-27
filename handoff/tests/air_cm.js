// Countermeasures, enemy missiles, the radar, the RWR and the War Thunder-style HUD (user requests:
// a radar display on jets with radar; limited countermeasures; a fighter HUD like War Thunder's).
const tf = window.__tf, x = window.__tfx, G = tf.G, out = {};
const check = (v, m) => { if (!v) throw Error(m); };
const next = () => new Promise(r => setTimeout(r, 0));
await tf.coreReady(); await x.flightCoreP; tf.pause(true);G.airDefenceOn=false; tf.finishThumbs();
tf.setQuality('low');
const step = (n, fn) => { for (let i = 0; i < n; i++) { fn?.(i); tf.advance(1 / 60, [], false); } };
const shot = async (name) => { G.airHudTick = 0; tf.advance(1 / 60, [], true); await next(); await pyShot(name); };
async function board(id, lo) {
  if (G.air?.active) x.exitAircraft(true);
  G.airLoadout[id] = lo;
  document.querySelector(`.hangar-card[data-air=${id}]`).click();
  for (let i = 0; i < 120 && !(G.air?.active && G.air.plane.type.id === id); i++) { tf.advance(1 / 60, [], false); await next(); }
  check(G.air?.active, `${id}: could not board`);
  return G.air;
}
async function bot(typeId) {
  x.AIRCRAFT_TYPES && 0;
  G.airBotsOn = true;
  for (let i = 0; i < 900 && !G.airBots.list.length; i++) { tf.advance(1 / 60, [], false); await next(); }
  check(G.airBots.list.length, 'no enemy aircraft');
  G.airBotsOn = false;
  const b = G.airBots.list[0];
  for (const o of G.airBots.list.slice(1)) o.gone = true;
  G.airBots.list = [b];
  return b;
}
const key = (code, type = 'keydown', o = {}) => { const p0 = G.paused; G.paused = false; window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, ...o })); G.paused = p0; };
// ---- the HUD on an F-4E: flight data, armament with countermeasures, damage silhouette, radar
let air = await board('f4e', 1), P = air.plane;
P.spawn(0, 3000, 0, 0, 240, false); x.applyStoreLoad(air); P.state.throttle = 0.9; P.aim = [0, 0, 1];
let b = await bot();
step(30); G.airHudTick = 0; tf.advance(1 / 60, [], true); await next();
const q = (s) => document.querySelector('#air-hud ' + s);
out.hud = { data: [...document.querySelectorAll('#air-hud .air-main > div')].map(d => d.textContent.replace(/\s+/g, ' ').trim()), arms: [...document.querySelectorAll('#air-hud .air-store > div')].map(d => d.textContent.replace(/\s+/g, ' ').trim()), radar: !q('.air-radar').hidden, rwr: !q('.air-rwr').hidden, flags: q('.air-flags').textContent };
check(out.hud.data.length >= 8, 'flight data rows missing');
check(out.hud.arms.some(t => /AIM-9L/.test(t)) && out.hud.arms.some(t => /30/.test(t) && /(Flares|熱焰彈)/.test(t)), 'armament / countermeasures missing');
check(out.hud.radar && out.hud.rwr, 'radar or RWR not shown on the F-4E');
// ---- countermeasures: 1 releases a pair of each; Shift+1 releases on a period until they run out
const cm0 = { ...air.cm };
key('KeyT'); step(2); key('KeyT', 'keyup');
out.cmOne = { before: [cm0.flares, cm0.chaff], after: [air.cm.flares, air.cm.chaff], flaresInAir: G.airBots.flares.filter(f => f.owner === 'player').length, chaffInAir: G.airBots.chaff.filter(f => f.owner === 'player').length };
check(air.cm.flares === cm0.flares - 2 && air.cm.chaff === cm0.chaff - 2, '1 did not release a pair of each');
key('KeyT', 'keydown', { shiftKey: true }); key('KeyT', 'keyup', { shiftKey: true }); step(60 * 16);
out.cmHeld = [air.cm.flares, air.cm.chaff];
check(air.cm.flares === 0 && air.cm.chaff === 0, 'the periodic release did not empty the dispensers');
out.cmPeriodicOffWhenEmpty = !air.ctl.cm.periodic;
// ---- an enemy Su-27 head-on fires a radar missile at the player: the warning, the RWR, the radar track
air = await board('f4e', 1); P = air.plane;
P.spawn(0, 3500, 0, 0, 240, false); x.applyStoreLoad(air); P.state.throttle = 0.9; P.aim = [0, 0, 1];
b = await bot();
b.plane.spawn(0, 3600, 9000, Math.PI, 250, false); b.missileAt = 0; b.flares = b.chaff = 0;
let fired = null, warned = null, rwrTrack = false;
step(20 * 60, (i) => { P.aim = [0, 0, 1]; const o = G.airOrdnance.find(o => o.owner === 'bot'); if (o && !fired) fired = { t: i / 60, def: o.def.name, seeker: o.seeker }; const w = G.airWarn?.missile || G.airWarn?.assist; if (w && !warned) warned = { t: i / 60, km: +(w / 1e3).toFixed(1), maws: !!G.airWarn.missile, rwr: (air.ctl?.threat?.rwr || []).map(r => r.level).join(',') }; });
out.enemyLaunch = { bot: b.plane.type.name, fired, warned, playerDamaged: P.damage.parts.filter(p => p.hp < p.max).map(p => p.id), downBy: air.downBy || null };
check(fired, 'the enemy did not fire a missile');
check(warned, 'no missile warning');
await shot('hud_missile');
// ---- a flare seduces an infrared missile fired at the player (decoy chance forced to certain)
air = await board('f4e', 1); P = air.plane;
P.spawn(0, 3500, 0, 0, 240, false); x.applyStoreLoad(air); P.state.throttle = 0.9; P.aim = [0, 0, 1];
b = await bot();
const it = b.stores.items.find(i => i.def.guidance === 'ir');
check(it, 'the enemy carries no infrared missile');
for (const i of b.stores.items) if (i !== it) i.gone = true;
b.plane.spawn(0, 3500, -2500, 0, 250, false); b.missileAt = 0;
let m = null;
for (let i = 0; i < 10 * 60 && !m; i++) { P.aim = [0, 0, 1]; tf.advance(1 / 60, [], false); m = G.airOrdnance.find(o => o.owner === 'bot'); }
check(m, 'no infrared launch from behind');
const rnd = Math.random; Math.random = () => 0;
key('KeyT'); step(3); key('KeyT', 'keyup');
step(60); Math.random = rnd;
out.flare = { missile: m.def.name, decoyed: !!m.decoyed, target: m.target.flare ? 'flare' : m.target.player ? 'player' : '?' };
check(m.decoyed && m.target.flare, 'the flare did not seduce the infrared missile');
// ---- a type without dispensers
air = await board('f104g', 1);
key('KeyT'); step(2); key('KeyT', 'keyup'); step(2);
out.noCm = air.ctl.reason;
// ---- the radar scope with a contact and a lock (F-15C, AIM-7F)
air = await board('f15c', 1); P = air.plane;
P.spawn(0, 3500, 0, 0, 240, false); x.applyStoreLoad(air); P.state.throttle = 0.9;
b = await bot(); b.plane.spawn(400, 3700, 12000, 0, 230, false); b.missileAt = 1e9;
air.stores.sel = air.stores.groups.indexOf('aim7f');
const aimB = () => { const d = b.plane.position.map((v, k) => v - P.position[k]), l = Math.hypot(...d); P.aim = d.map(v => v / l); P.aimBias = [0, 0, 0, 1]; };
step(4 * 60, aimB); key('KeyR'); key('KeyR', 'keyup'); step(60, aimB);
const rd = air.ctl.radar;
out.radar = { contacts: rd.tracks.size, track: rd.stt?.state === 'track' ? +(rd.stt.est.dist / 1e3).toFixed(1) : null, scale: rd.scale };
check(out.radar.contacts >= 1 && out.radar.track, 'radar did not paint and track the enemy');
key('KeyU'); key('KeyU', 'keyup'); step(2); out.radar.scaleAfterU = rd.scale;
await shot('hud_radar');
return out;

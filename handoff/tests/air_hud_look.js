// The flight HUD as seen (War Thunder-style layout): an F-15C with an enemy ahead, the radar locked.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const next = () => new Promise(r => setTimeout(r, 0));
await tf.coreReady(); await x.flightCoreP; tf.pause(true); tf.finishThumbs(); tf.setQuality('low');
G.airLoadout.f15c = 1;
document.querySelector('.hangar-card[data-air=f15c]').click();
for (let i = 0; i < 120 && !G.air?.active; i++) { tf.advance(1 / 60, [], false); await next(); }
const air = G.air, P = air.plane;
P.spawn(0, 3500, 0, 0, 240, false); P.state.throttle = 0.9;
G.airBotsOn = true;
for (let i = 0; i < 900 && !G.airBots.list.length; i++) { tf.advance(1 / 60, [], false); await next(); }
G.airBotsOn = false;
const b = G.airBots.list[0]; b.plane.spawn(300, 3600, 4000, 0, 230, false); b.missileAt = 1e9;
air.stores.sel = air.stores.groups.indexOf('aim7f'); air.stores.lock = null;
for (let i = 0; i < 180; i++) { const d = b.plane.position.map((v, k) => v - P.position[k]), l = Math.hypot(...d); P.aim = d.map(v => v / l); P.aimBias = [0, 0, 0, 1]; tf.advance(1 / 60, [], false); }
G.airHelp = window.__HELP ?? false; G.airHudTick = 0; tf.advance(1 / 60, [], true); await next();
await pyShot('f15c');
return { locked: !!air.stores.lock?.locked };

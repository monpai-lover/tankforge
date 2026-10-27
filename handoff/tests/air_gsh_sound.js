// The GSh-30-1's sound (user report: no sound): a MiG-29 fires a 1 s burst; which cues the full audio
// bank was asked to play, and whether it decoded them.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const next = () => new Promise(r => setTimeout(r, 0));
await tf.coreReady(); await x.flightCoreP; tf.pause(true); tf.finishThumbs();
tf.sound.start?.();
G.airBotsOn = false; G.airLoadout.mig29 = 0;
document.querySelector('.hangar-card[data-air=mig29]').click();
for (let i = 0; i < 120 && !G.air?.active; i++) { tf.advance(1 / 60, [], false); await next(); }
const air = G.air, P = air.plane, full = tf.sound.full, played = {};
P.spawn(0, 2500, 0, 0, 220, false);
for (let i = 0; i < 120; i++) { tf.advance(1 / 60, [], false); await next(); }
const orig = full.play.bind(full); full.play = (id, e, loop) => { if (/gsh|cannon/.test(id)) { const v = orig(id, e, loop); (played[id] ||= { n: 0, voices: 0 }).n++; if (v) played[id].voices++; return v; } return orig(id, e, loop); };
air.fireAll = true; for (let i = 0; i < 60; i++) { tf.advance(1 / 60, [], false); await next(); } air.fireAll = false;
for (let i = 0; i < 40; i++) { tf.advance(1 / 60, [], false); await next(); }
full.play = orig;
return { guns: air.guns.map(g => [g.sound, g.fired]), played, decoded: Object.keys(full.bank.cues).filter(k => /gsh301/.test(k)).map(k => [k, !!full.buffers?.get?.(k)]) };

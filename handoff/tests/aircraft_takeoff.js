const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const log = (...a) => console.log('@@', ...a.map(v => typeof v === 'string' ? v : JSON.stringify(v)));
await tf.coreReady().catch(e => null); await x.flightCoreP;
tf.finishThumbs();
document.querySelector('.hangar-card[data-air=nf01]').click();
for (let i = 0; i < 40 && !G.air?.active; i++) await frames(1);
tf.pause(true);
const P = G.air?.plane, out = { active: !!G.air?.active, mode: G.mode };
if (!P) return out;
const st = () => { const h = P.hudState(); return { t: +P.time.toFixed(1), pos: P.position.map(v => +v.toFixed(1)), ias: +h.ias.toFixed(0), agl: +h.agl.toFixed(1), mode: h.mode, crashed: h.crashed, gear: +h.gear.toFixed(2) }; };
out.spawn = st();
tf.advance(1 / 60, [], true); await frames(2); await pyShot('fly_ground');
P.state.throttle = 1.0; P.state.flaps = true;
for (let s = 0; s < 30; s++) {
  tf.advance(1, [], false);
  const h = P.hudState();
  if (h.ias > 185 && P.onGround) P.look(0, -60);       // rotate: pull the aim up
  if (!P.onGround && h.agl > 15 && P.state.gear) { P.state.gear = false; P.state.flaps = false; }
  if (h.agl > 120) { const f = P.hudState().nose; P.aim = [f[0], 0.05, f[2]].map((v, i, a) => v / Math.hypot(...a)); }
  log('t', st());
  if (h.crashed) break;
}
out.climb = st();
tf.advance(1 / 60, [], true); await frames(2); await pyShot('fly_air');
P.toggle('KeyV'); tf.advance(0.3, [], false); tf.advance(1 / 60, [], true); await frames(2); await pyShot('fly_cockpit'); P.toggle('KeyV');
// banked turn with the mouse aim
for (let s = 0; s < 6; s++) { P.look(120, 0); tf.advance(1, [], false); }
out.turn = { ...st(), heading: +P.hudState().heading.toFixed(0) };
tf.advance(1 / 60, [], true); await frames(2); await pyShot('fly_turn');
tf.pause(false);
return out;

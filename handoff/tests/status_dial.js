// The War Thunder style status dial: intact, then with damaged / destroyed modules, crew lost and a
// gunner replacement under way (state set directly for the picture; one drawn frame each).
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.finishThumbs(); tf.select(window.__VEH || 'su_t72a'); await frames(2); tf.startBattle(); await frames(3);
const st2 = document.createElement('style'); st2.textContent = '#lock-hint, #toast, #help {display:none !important}'; document.head.append(st2);
tf.pause(true); tf.advance(1.5, ['fwd'], false); G.cam.yaw += 0.6; tf.advance(1 / 60, [], true); await frames(2);
const crop = async (name) => { await pyShot(name); };
await crop('dial_intact');
const st = G.cstate, b = G.bundle, mods = b.modules.map((m, i) => [m.kind, i]);
const set = (kind, f) => { for (const [k, i] of mods) if (k === kind) st.modules[i] = b.modules[i].max_health * f; };
set('engine', 0); set('transmission', 0.3); set('ammo_rack', 0.2);
st.crew[0] = 0; st.crew[1] = 30;
G.caps = { ...G.caps, gunner: false, driver: false, commander: false };
st.swaps = [{ role: 'gunner', left_s: 6 }]; G.swapTotals = { gunner: 10 };
tf.advance(1 / 60, [], true); await frames(2);
await crop('dial_damaged');
return { caps: { gunner: G.caps.gunner, driver: G.caps.driver }, crew: st.crew, statusWin: G.statusWin };

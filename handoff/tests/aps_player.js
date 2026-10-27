// Player drives the T-10M (Oplot-MO); a TOW comes in from 1000 m: does the player's APS engage?
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.finishThumbs(); await frames(2); tf.select('su_t10m'); await frames(4); tf.startBattle(); await frames(3); tf.pause(true);
tf.advance(1, [], false);
const kinds = {}; const st = G.missiles.step.bind(G.missiles); let mine = null;
G.missiles.step = (...a) => { const r = st(...a); for (const e of r.events || []) kinds[e.type] = (kinds[e.type] || 0) + 1; mine = (r.aps || []).find(q => q.owner === 1) || mine; return r; };
const o = G.veh.body.origin(), tgt = [o[0], o[1] + 1.3, o[2]], from = [o[0] + 150, o[1] + 2.5, o[2] + 985];
const d = tgt.map((q, k) => q - from[k]), L = Math.hypot(...d);
const id = G.missiles.launch('bgm71a_tow', 150, 1, from, d.map(q => q / L), 99, null, { weapon_instance: 'x', projectile_id: 'heat_152_tow', weaponId: 'tow', instance: 'x', time: G.time || 0 });
for (let k = 0; k < 600; k++) { G.missiles.guide(id, 150, from, tgt); tf.advance(1 / 60, [], false); }
return { apsOn: G.apsOn, aps: !!G.aps, kinds, mode: mine && mine.mode, alive: !G.caps?.destroyed };

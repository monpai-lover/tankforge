// Break a Tiger's track and photograph it falling off over real time.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.finishThumbs(); await frames(2); tf.select('su_t72a'); await frames(3); tf.startBattle(); await frames(3); tf.pause(true);
const e = G.enemies.find(q => q.id === 'de_tiger_e'); x.reviveRangeEnemy(e); tf.advance(0.1, [], true);
const shell = x.data.projectiles.apcbc_75_m61, mods = e.bundle.modules, ti = mods.findIndex(m => m.kind === 'track');
const v3a = (p) => Array.isArray(p) ? p : [p.x, p.y, p.z];
const c = v3a(mods[ti].center), b = e.veh.body, cw = b.worldPoint(c), ow = b.worldPoint([c[0] + 20 * Math.sign(c[0] || 1), c[1] + 0.3, c[2] + 1]), d = cw.map((q, i) => q - ow[i]), L = Math.hypot(...d);
const tb = b.origin(), side = b.worldDir([Math.sign(c[0] || 1), 0, 0]);
G.camOverride = { pivot: [tb[0], tb[1] + 1.0, tb[2]], fov: 0.75, dist: 9 }; G.cam.yaw = Math.atan2(side[0], side[2]) + 0.4; G.cam.pitch = -0.2;
tf.advance(1 / 60, [], true); await frames(2); await pyShot('before');
G.shots.push({ s: x.newShot(ow, d.map(q => q / L), shell), shell, age: 0, origin: ow.slice(), travelled: 0, projectile_source: null });
for (let k = 0; k < 6; k++) tf.advance(1 / 60, [], true);
const broke = { left: e.caps?.track_left, right: e.caps?.track_right };
x.hitcam?.hide?.('test');
for (const [name, ms] of [['t015', 150], ['t060', 450], ['t200', 1400]]) { await new Promise(r => setTimeout(r, ms)); tf.advance(1 / 60, [], true); await frames(1); await pyShot(name); }
return { broke, views: Object.fromEntries([1, -1].map(s => [s, e.veh.trackViews?.[s] ? { laid: e.veh.trackViews[s].laid, cut: e.veh.trackViews[s].cutPin } : null])) };

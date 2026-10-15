// Do warhead bursts make sound? Record every audio buffer that starts.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
const S = tf.sound, started = [];
const nameOf = (buf) => { for (const [k, v] of S.full?.buffers || []) if (v === buf || v?.buffer === buf) return 'full:' + k; return 'other(' + (buf ? buf.duration.toFixed(2) : 'null') + ')'; };
const bs = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (...a) { started.push(nameOf(this.buffer)); return bs.apply(this, a); };
tf.finishThumbs(); tf.select('su_t72a'); await frames(2); tf.startBattle(); await frames(3); S.start(); await new Promise(r => setTimeout(r, 1500));
tf.pause(true);
const out = {};
const p = G.veh.body.origin(), at = [p[0] + 40, p[1], p[2] + 40];
started.length = 0; S.blast(4.6, 56, { eventId: 'probe:ground', position: at, time: G.time, shellKind: 'heat' }); await new Promise(r => setTimeout(r, 2500)); tf.advance(0.1, [], false); await new Promise(r => setTimeout(r, 500));
out.groundBlast = started.splice(0);
const e = G.enemies.find(q => q.id === 'us_m8'); x.reviveRangeEnemy(e); tf.advance(0.1, [], false);
const sh = x.data.projectiles.heat_152_kornet, b = e.veh.body, c = b.worldPoint([0, 1, 0]), o = b.worldPoint([30, 1.6, 0]), d = c.map((q, i) => q - o[i]), L = Math.hypot(...d), dir = d.map(q => q / L);
tf.pause(false); await new Promise(r => setTimeout(r, 300)); started.length = 0; const s = { s: x.newShot(o, dir, sh), shell: sh, age: 0, origin: o.slice(), travelled: 0, projectile_source: null }; G.shots.push(s);
await new Promise(r => setTimeout(r, 3000));
out.directHeat = started.splice(0); out.killed = !e.alive;
return out;

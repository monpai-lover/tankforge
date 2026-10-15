// Which sounds actually start while firing, reloading and driving: full bank / regional reload bank / synth.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
const S = tf.sound, started = [];
const nameOf = (buf) => {
  for (const [k, v] of S.full?.buffers || []) if (v === buf || v?.buffer === buf) return 'full:' + k;
  for (const [k, v] of S.full?.cache || []) if (v === buf || v?.buffer === buf) return 'full:' + k;
  for (const [k, v] of Object.entries(S.reloadSamples || {})) if (v === buf) return 'reloadBank:' + k;
  for (const [k, v] of Object.entries(S.samples || {})) if (v === buf) return 'sfx:' + k;
  return 'unknown(' + (buf ? buf.duration.toFixed(2) + 's' : 'null') + ')';
};
const bs = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (...a) { started.push({ t: +(G.time || 0).toFixed(2), what: nameOf(this.buffer), loop: this.loop }); return bs.apply(this, a); };
const os = OscillatorNode.prototype.start; OscillatorNode.prototype.start = function (...a) { started.push({ t: +(G.time || 0).toFixed(2), what: 'synth:oscillator:' + this.type }); return os.apply(this, a); };
const out = {};
for (const id of (window.__IDS || ['de_pz3_j', 'su_t72a'])) {
  started.length = 0; const t0 = performance.now();
  tf.finishThumbs(); tf.select(id); await frames(2); tf.startBattle(); await frames(3); S.start(); await new Promise(r => setTimeout(r, 1500));
  tf.pause(true); tf.advance(0.5, [], false);
  const atStart = started.splice(0);
  tf.fireGun(0, 0); tf.advance(0.1, [], false);
  const afterShot = started.splice(0);
  await new Promise(r => setTimeout(r, 300));
  for (let i = 0; i < 14; i++) { tf.advance(1, [], false); await new Promise(r => setTimeout(r, 150)); }
  const reload = started.splice(0);
  tf.pause(false); G.keys = new Set(['fwd']); await new Promise(r => setTimeout(r, 4000)); G.keys = new Set(); tf.pause(true);
  const drive = started.splice(0);
  // a hit on the nearest target's hull side
  const e = G.enemies.find(q => q.alive && q.combat); let hit = [];
  if (e) { const b = e.veh.body, sh0 = G.loadout.turrets[0].guns[0].ammo[0].shell, c = b.worldPoint([0, 1.0, 0]), side = b.worldDir([1, 0.1, 0]), o = c.map((v, i) => v + side[i] * 30), dir = c.map((v, i) => v - o[i]); const L = Math.hypot(...dir); for (let i = 0; i < 3; i++) dir[i] /= L;
    const sh = { s: x.newShot(o, dir, sh0), shell: sh0, age: 0, origin: o.slice(), travelled: 0, projectile_source: null }; sh.replayDischarge = G.localReplay?.acceptDischarge(1, { weapon_instance: G.loadout.turrets[0].guns[0].damageKey, projectile_id: sh0.id, seed: 77, time_s: G.time, origin: o, direction: dir, velocity_m_s: sh.s.vel, flight_trust: 'local_ballistic_world_segments_legacy_contact', projectile_source: null }); sh.replayLease = G.localReplay?.retainProjectile(sh.replayDischarge);
    G.shots.push(sh); tf.advance(0.2, [], false); await new Promise(r => setTimeout(r, 300)); hit = started.splice(0); }
  const sum = (l) => Object.entries(l.reduce((m, e) => (m[e.what.replace(/:[^:]*$/, (s) => e.what.startsWith('full:') || e.what.startsWith('reloadBank:') ? s : '')] = (m[e.what] || 0) + 1, m), {}));
  const count = (l) => { const m = {}; for (const e of l) m[e.what] = (m[e.what] || 0) + 1; return m; };
  out[id] = { atStart: count(atStart), activeLoops: [...(S.full?.loops?.keys() || [])].slice(0, 40), rigs: [...(S.full?.rigs?.keys() || [])].map(String).slice(0, 20), fullOwned: S.fullEnabled, reloadEnabled: S.reloadEnabled, afterShot: count(afterShot), reload: count(reload), drive: count(drive), hit: count(hit), reloadTimeline: reload.map(e => e.t + ' ' + e.what).slice(0, 30) };
  tf.pause(false); x && 0;
  window.__tf.toGarage?.();
}
return out;

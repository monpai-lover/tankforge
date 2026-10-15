// For each target: shoot its gun barrel and a track, and report damage state vs what the model shows.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.select('su_t72a'); await frames(2); tf.finishThumbs(); tf.startBattle(); await frames(3); tf.pause(true);
const v3a = (p) => Array.isArray(p) ? p : [p.x, p.y, p.z];
const shellFor = (id) => x.data.projectiles[id];
const out = {};
for (const e of G.enemies) {
  x.reviveRangeEnemy(e);
  const shell = shellFor(window.__SHELL || 'apcbc_75_m61') || Object.values(x.data.projectiles).find(p => p.kind === 'apcbc');
  let last = null; const orig = e.combat.shoot.bind(e.combat); e.combat.shoot = (...a) => { const r = orig(...a); last = r; return r; };
  const fire = (lp, lf) => {
    const b = e.veh.body, cw = b.worldPoint(lp), ow = b.worldPoint(lf), d = cw.map((q, i) => q - ow[i]), L = Math.hypot(...d), dir = d.map(q => q / L);
    const sh = { s: x.newShot(ow, dir, shell), shell, age: 0, origin: ow.slice(), travelled: 0, projectile_source: null };
    last = null; G.shots.push(sh); tf.advance(0.12, [], false); x.hitcam?.hide?.('test');
    return last ? last.outcome : 'none';
  };
  const mods = e.bundle.modules, bi = mods.findIndex(m => m.kind === 'gun_barrel'), ti = mods.findIndex(m => m.kind === 'track');
  const r = { shell: shell.id, barrelShots: [], trackShots: [] };
  if (bi >= 0) for (let k = 0; k < 6 && e.alive; k++) {
    const c = v3a(mods[bi].center);
    r.barrelShots.push([fire(c, [c[0] + 20, c[1] + 0.5, c[2] + 1]), Math.round(e.cstate?.modules?.[bi]?.health ?? e.cstate?.modules?.[bi] ?? -1)]);
  }
  r.weapons = Object.fromEntries(Object.entries(e.caps?.weapons || {}).map(([k, w]) => [k, [w.can_fire, w.reason]]));
  for (let f = 0; f < 4; f++) tf.advance(1 / 30, [], true);
  r.visualKey = e.model.damageVisuals?.key ?? null;
  r.barrelHidden = e.model.turrets?.[0]?.guns?.[0]?.barrel?.visible === false;
  if (ti >= 0) for (let k = 0; k < 6 && e.alive && e.caps?.track_left !== false && e.caps?.track_right !== false; k++) {
    const c = v3a(mods[ti].center);
    r.trackShots.push([fire(c, [c[0] + 20 * Math.sign(c[0] || 1), c[1] + 0.3, c[2] + 1]), Math.round(e.cstate?.modules?.[ti]?.health ?? -1)]);
  }
  for (let f = 0; f < 4; f++) tf.advance(1 / 30, [], true);
  r.tracks = { left: e.caps?.track_left, right: e.caps?.track_right, views: Object.fromEntries([1, -1].map(s => [s, e.veh.trackViews?.[s] ? { unsupported: e.veh.trackViews[s].unsupported, reason: e.veh.trackViews[s].reason } : null])), support: e.veh.trackSupport ?? null };
  r.capsKeys = Object.keys(e.caps || {}); tf.advance(Number(window.__SETTLE || 3), [], false);
  const tb = e.veh.body.origin(), side = e.veh.body.worldDir([1, 0, 0]);
  for (const sgn of [1, -1]) { G.camOverride = { pivot: [tb[0], tb[1] + 1.2, tb[2]], fov: 0.75, dist: 9 }; G.cam.yaw = Math.atan2(-side[0] * sgn, -side[2] * sgn) + 0.5; G.cam.pitch = -0.25; tf.advance(1 / 60, [], true); await frames(2); await pyShot(e.id + (sgn > 0 ? '_R' : '_L')); }
  G.camOverride = null;
  out[e.id] = r;
}
tf.pause(false);
return out;

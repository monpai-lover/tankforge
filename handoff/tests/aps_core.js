// The missile crate's own APS test scenario, run through the browser's missile core.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
await tf.coreReady().catch(e => null);
tf.finishThumbs(); await frames(2); tf.select('su_t10m'); await frames(3); tf.startBattle(); await frames(3); tf.pause(true);
const M = G.missiles, out = [];
const def = G.enemies.find(q => q.id === 'su_t10m')?.loadout.weapons.aps || G.loadout.weapons.aps;
for (const variant of ['rangeLiveExact', 'rangeTerrainCovered']) {
  if (variant === 'rangeTerrainCovered') tf.place(104, 591, 0);
  const n = 256; M.reset(variant === 'rangeLiveTerrain' || variant === 'rangeTerrainCovered' ? x.missileTerrain() : { x0: -1024, z0: -1024, size: 2048, res: n, heights: new Array(n * n).fill(0) });
  const apsTeam = variant === 'rangeTeamsSwapped' ? 1 : 0, mslTeam = 1 - apsTeam;
  const live = variant.startsWith('rangeLiveExact') || variant === 'rangeTerrainCovered'; const apsId = live ? 103 : 1, seed = live ? 14 : 7;
  M.addAps(apsId, live ? 1 : apsTeam, def, seed);
  M.setAps(apsId, true, null, 900);
  const tank = { id: apsId, team: live ? 1 : apsTeam, alive: true, center: [0, 1.3, 0], vel: [0, 0, 0], aps_pivot: [0.5, 2.8, 0.2], aps_base_yaw: 0, aps_gun_ok: true, aps_radar_ok: true, aps_traverse_mult: 1, aps_elevate_mult: 1, aps_dispersion_mult: 1 };
  if (variant === 'browserCenter') tank.aps_axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  let shooter = { id: 99, team: 1, alive: true, center: [0, 1.2, 1000], vel: [0, 0, 0] };
  let from = [0, 2, 1000], target = [0, 1.4, 0], dir = [0, -0.0006, -1];
  if (variant === 'rangeAxes' || variant === 'rangeAxesBaseYaw' || variant === 'rangeLiveExactAxes') tank.aps_axes = [[-0.9848077504302778, 0, 0.17364819230978376], [0, 1, 0], [-0.17364819230978376, 0, -0.9848077504302778]];
  if (variant === 'rangeAxesBaseYaw' || variant === 'rangeLiveExactAxes') tank.aps_base_yaw = -2.9670597135216172;
  if (variant.startsWith('range')) {
    Object.assign(tank, { center: [277.8, 1.17, 1575.7], aps_pivot: [277.0, 2.7, 1576.0] });
    from = [104, 2.5, 591]; target = [278, 1.27, 1576]; const d = target.map((q, k) => q - from[k]), L = Math.hypot(...d); dir = d.map(q => q / L);
    shooter = { id: 99, team: mslTeam, alive: true, center: [104, 1.2, 591], vel: [0, 0, 0] };
  }
  if (live) shooter = { id: 1, team: 0, alive: true, center: [104, 1.2, 591], vel: [0, 0, 0] };
  const owner = variant.startsWith('rangeLiveExact') || variant === 'rangeTerrainCovered' ? 1 : 99;
  if (variant === 'rangeLiveExactWarm') for (let k = 0; k < 120; k++) M.step(1 / 60, [tank, shooter]);
  const id = M.launch('bgm71a_tow', owner, live ? 0 : mslTeam, from, dir, 7, null, { weapon_instance: 'x', projectile_id: 'heat_152_tow', weaponId: 'tow', instance: 'x', time: 0 });
  M.guide(id, owner, [0, 2.3, 1000], target);
  const kinds = {}; let t = 0, lastMode = null;
  while (t < 9) { if (variant.startsWith('range')) M.guide(id, owner, from, target);  const r = M.step(1 / 60, [tank, shooter]); t += 1 / 60; for (const e of r.events || []) kinds[e.type] = (kinds[e.type] || 0) + 1; const a = (r.aps || []).find(q => q.owner === apsId); if (a) lastMode = a.mode; }
  out.push({ variant, id, kinds, lastMode, terrain: variant === 'rangeTerrainCovered' ? (() => { const tt = x.missileTerrain(); const hs = tt.heights; return { x0: tt.x0, z0: tt.z0, size: tt.size, min: Math.min(...hs), max: Math.max(...hs) }; })() : null });
}
return out;

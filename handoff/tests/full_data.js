// Full-data smoke check: every range target registers with the corrected catalog and a 3BM22 shot along
// the side plate normal penetrates; the aircraft spawns and rolls.
const tf = window.__tf, x = window.__tfx, G = tf.G;
const frames = (n) => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const log = (...a) => console.log('@@', ...a.map(v => typeof v === 'string' ? v : JSON.stringify(v)));
await tf.coreReady().catch(e => null);
const out = { vehicles: Object.keys(x.data.vehicles).length, surfaceCatalog: Object.keys(x.data.surfaceCatalog).length };
tf.finishThumbs(); tf.select('su_t72a'); await frames(2); tf.startBattle(); await frames(3); tf.pause(true);
const so = G.combat.surfaceOwner;
out.actors = [...so.actors.values()].map(r => ({ key: r.key, available: r.available, detail: r.detail || null }));
log('actors', out.actors);
const shell = x.data.projectiles['apfsds_125_3bm22'], v3a = (p) => Array.isArray(p) ? p : [p.x, p.y, p.z];
let last = null; const orig = G.combat.shoot.bind(G.combat); G.combat.shoot = (...a) => { const r = orig(...a); last = r; return r; };
out.shots = [];
for (const e of G.enemies) {
  const p = (e.bundle.armor || []).find(q => /hull_side_r|hull_side$/.test(q.id)) || (e.bundle.armor || [])[0];
  if (!p) continue;
  const b = e.veh.body, cw = b.worldPoint(v3a(p.center)), nw = b.worldDir(v3a(p.normal)), dir = nw.map(q => -q), o = cw.map((q, i) => q + nw[i] * 25);
  const sh = { s: x.newShot(o, dir, shell), shell, age: 0, origin: o.slice(), travelled: 0, projectile_source: null };
  sh.replayDischarge = G.localReplay?.acceptDischarge(1, { weapon_instance: G.loadout.turrets[0].guns[0].damageKey, projectile_id: shell.id, seed: 5150, time_s: G.time || 0, origin: o, direction: dir, velocity_m_s: sh.s.vel, flight_trust: 'local_ballistic_world_segments_legacy_contact', projectile_source: null });
  sh.replayLease = G.localReplay?.retainProjectile(sh.replayDischarge);
  last = null; G.shots.push(sh); tf.advance(0.1, [], false); x.hitcam.hide('test');
  const l = last?.layers?.[0];
  out.shots.push({ veh: e.id, plate: p.id, t: p.thickness_mm, outcome: last?.outcome ?? 'none', layer: l && [l.plate, Math.round(l.required_mm), Math.round(l.pen_before_mm)], events: last?.events?.filter(v => /unsupported/.test(v)) });
  log('shot', out.shots.at(-1));
}
await x.flightCoreP; await x.enterAircraft(true); tf.pause(true);
const P = G.air?.plane; if (P) { P.state.throttle = 1; tf.advance(6, [], false); out.aircraft = { ias: Math.round(P.hudState().ias), z: Math.round(P.position[2]), crashed: P.crashed }; }
tf.advance(1 / 60, [], true); await frames(2); await pyShot('full_aircraft');
tf.pause(false);
return out;

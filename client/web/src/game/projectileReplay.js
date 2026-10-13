// Read-only hit presentation. Positions stay in the report's hull frame; no damage is resolved here.
import { shellKind } from './shellicons.js';
export {prepareReplayEvent,samplePreparedReplay} from './replayRecords.js';

const point = p => Array.isArray(p) ? p.slice(0, 3) : [p.x, p.y, p.z];
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const direction = (a, b) => {
  const n = distance(a, b) || 1;
  return [(b[0] - a[0]) / n, (b[1] - a[1]) / n, (b[2] - a[2]) / n];
};
/** Preserve the design core's flight, terminal contact and penetrator trace; never infer a blast. */
export function designReplayReport(last, roles = [], turretYaw = 0) {
  const { resp, shell } = last;
  const ev = resp.event;
  const impact = point(ev.impact_position);
  const pts = ev.projectile_path.map(q => point(q.pos));
  const at = pts.findIndex(p => distance(p, impact) < .05);
  const flight = at >= 0 ? pts.slice(0, at + 1) : [...pts, impact.slice()];
  const dir = resp.shot?.dir ? point(resp.shot.dir) : flight.length > 1 ? direction(flight[flight.length - 2], impact) : direction(point(ev.muzzle_position), impact);
  const path = at >= 0 ? pts.slice(at) : [impact.slice()];
  const penetrator = ev.fragments.find(f => f.is_penetrator);
  if (ev.penetration_result === 'penetrated' && penetrator) {
    for (const p of [point(penetrator.origin), point(penetrator.end)]) if (distance(path[path.length - 1], p) > 1e-6) path.push(p);
  } else if (resp.stopped_point && !resp.ricochet_dir) {
    const stop = point(resp.stopped_point);
    if (distance(path[path.length - 1], stop) > 1e-6) path.push(stop);
  }
  const used = new Set();
  const crew = ev.damaged_crew.map(c => {
    const index = roles.findIndex((r, i) => r === c.role && !used.has(i));
    used.add(index);
    return { index, role: c.role, damage: c.damage, killed: c.killed, health: resp.state?.crew_health?.[`${c.role}_${index}`] };
  });
  const killed = crew.filter(c => c.killed).length;
  const crewAlive = resp.state?.crew_health ? Object.values(resp.state.crew_health).filter(h => h > 0).length : roles.length - killed;
  const destroyed = resp.capabilities.ammo_detonated || (roles.length >= 2 && crewAlive < 2);
  const outcome = ev.penetration_result;
  const heat = /^heat/.test(shellKind(shell));
  return {
    hit: resp.hit, outcome, impact, normal: point(ev.impact_normal), plate: null,
    shell_kind: shellKind(shell), caliber_mm: shell.caliber_mm,
    shot: { dir }, flight_path: flight, path,
    ricochet_dir: resp.ricochet_dir ? point(resp.ricochet_dir) : null,
    bursts: [],
    mechanism_revision: ev.mechanism_revision ?? null,
    impact_events: structuredClone(ev.impact_events || []),
    impact_state: structuredClone(ev.impact_state ?? null),
    fragments: ev.fragments.map(f => ({ ...structuredClone(f), from: point(f.origin), to: point(f.end), source: f.source || 'unknown_legacy',
      kind: ({ core: 'shell', projectile_piece: 'projectile_piece', armour_spall: 'spall', casing_fragment: 'burst', jet_fragment: 'jet' })[f.source]
        || (f.is_penetrator ? heat ? 'jet' : 'shell' : 'unknown_legacy') })),
    modules: ev.damaged_modules.map(m => ({ ...m, health: resp.state?.module_health?.[m.id] })), crew,
    caps: { destroyed, crew_alive: crewAlive, crew_total: roles.length },
    title: resp.capabilities.ammo_detonated ? '彈藥殉爆　擊毀' : destroyed ? '乘員失去戰鬥力　擊毀' : { penetrated: '擊穿', stopped: '未擊穿', ricochet: '跳彈', shattered: '彈體碎裂', miss: '未命中' }[outcome] || outcome,
    turret_yaw: turretYaw, layers: resp.layers,
  };
}

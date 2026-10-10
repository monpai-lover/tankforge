// Read-only CPU contact evidence for every stock moving assembly and workshop
// head. A seat merely touching the hull cannot certify the complete assembly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from './load-data.mjs';
import { runtimeParts, touches } from './procedural-fleet-audit.mjs';
import { decodeAllImported } from '../src/gfx/imported.js';
import { buildToBundle, newTurretSpec } from '../src/game/loadout.js';
import { foldYawLimit } from '../src/game/folding.js';

const moving = p => ['turret', 'gun', 'barrel'].includes(p.part.mount);
const structural = p => p.mg == null && !p.part.hinge && !p.part.name?.startsWith('crew_clearance');
const area = p => p.tris.reduce((sum, [a, b, c]) => {
  const u = b.map((v, k) => v - a[k]), v = c.map((v, k) => v - a[k]);
  return sum + Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
}, 0);

export function seatSupportChain(pieces, turret, ti, anchor = null) {
  const own = pieces.filter(p => moving(p) && p.ti === ti && structural(p));
  const shells = own.filter(p => p.part.mount === 'turret');
  anchor ||= (shells.length ? shells : own).reduce((a, b) => !a || area(b) > area(a) ? b : a, null);
  const fixed = pieces.filter(p => structural(p) && (turret.parent != null
    ? p.part.mount === 'turret' && p.ti === turret.parent
    : p.part.mount === 'hull' || p.part.mount == null));
  if (!anchor) return { supported: false, reason: 'no assembly' };
  const pending = [[anchor]], seen = new Set([anchor]);
  while (pending.length) {
    const chain = pending.shift(), p = chain.at(-1);
    for (const q of fixed) if (touches(p, q)) return { supported: true, anchor: anchor.id, chain: [...chain, q].map(p => p.id) };
    for (const q of own) if (!seen.has(q) && touches(p, q)) {
      seen.add(q); pending.push([...chain, q]);
    }
  }
  return { supported: false, anchor: anchor.id, component: [...seen].map(p => p.id),
    disconnected: own.filter(p => !seen.has(p)).map(p => p.id) };
}

export function auditTurretSeats(id, data) {
  const rt = runtimeParts(id, data), poses = [];
  const folds = rt.model.hasFlaps ? [0, 1] : [0];
  for (const [ti, t] of rt.loadout.turrets.entries()) for (const fold of folds) for (const deg of [0, 90, 180]) {
    const yaw = deg * Math.PI / 180;
    const limits = ti === 0 && rt.model.hasFlaps ? foldYawLimit(t, fold) : t.limit;
    if (limits && (yaw < limits[0] || yaw > limits[1])) continue;
    poses.push({ turret: ti, parent: t.parent, yawDeg: deg, fold,
      ...seatSupportChain(rt.at({ turret: ti, yaw, fold }), t, ti) });
  }
  rt.model.dispose();
  return { id, imported: !!data.vehicles[id].imported, poses };
}

async function main() {
  const data = loadData();
  await decodeAllImported(data.vehicles);
  const vehicles = data.order.map(id => auditTurretSeats(id, data)), workshop = [];
  if (process.argv.includes('--workshop')) for (const base of ['de_hetzer', 'de_hetzer_mk103', 'de_tiger_e', 'de_panther_g',
    'us_m4a1_76w', 'us_m4a3_76w_hvss', 'su_t10m', 'xp_bmp_k64']) for (const keepStock of [false, true])
      for (const [x, z] of [[0, -2], [0, 2], [1, 0], [0, 0]]) for (const lift of [0, .3]) {
        const made = buildToBundle({ base, keepStock, turrets: [{ ...newTurretSpec(z), x, ring: .8, lift }] }, data);
        const custom = { ...data, vehicles: { workshop: made.bundle }, projectiles: { ...data.projectiles, ...made.projectiles } };
        const rt = runtimeParts('workshop', custom), ti = made.stats.stockTurrets, t = rt.loadout.turrets[ti];
        const poses = [0, 90, 180].map(deg => ({ yawDeg: deg, ...seatSupportChain(rt.at({ turret: ti, yaw: deg * Math.PI / 180 }), t, ti) }));
        workshop.push({ base, keepStock, x, z, lift, seat: made.stats.seatSupport[0], poses });
        rt.model.dispose();
      }
  const report = { vehicles, workshop };
  const out = process.argv.find(a => a.startsWith('--out='))?.slice(6);
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({ vehicles: vehicles.length, stockPoses: vehicles.reduce((s, v) => s + v.poses.length, 0),
    stockCandidates: vehicles.filter(v => v.poses.some(p => !p.supported)).map(v => v.id),
    workshopBuilds: workshop.length, workshopPoses: workshop.reduce((s, v) => s + v.poses.length, 0),
    workshopCandidates: workshop.filter(v => v.poses.some(p => !p.supported)).map(v => ({ base: v.base, x: v.x, z: v.z, lift: v.lift, keepStock: v.keepStock })) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

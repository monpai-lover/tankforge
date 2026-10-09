// Suspension Debug Mode of the design bureau: the compiled design run through the game's own tank
// model (sim/tank) in a few test situations on flat or simple ground, read back per road wheel in
// the hull frame: load (t), compression (% of the wheel's whole movement from the rebound stop to
// the bump stop), spring and damper force (kN), the ground's support under each wheel and the
// spring force on the hull at each mount. The same numbers the debug view (F3) shows in battle.
import { makeTank, newTank, placeTank, stepTank, gearFromVisual } from '../sim/tank/tank.js';

export const CASES = [
  { key: 'rest', label: '靜止' },
  { key: 'accel', label: '全油門起步' },
  { key: 'brake', label: '緊急煞車' },
  { key: 'slope', label: '12° 坡上駐車' },
  { key: 'kerb', label: '左側壓上路緣' },
];

const DT = 1 / 120;
const IDLE = { throttle: 0, steer: 0, brake: 0 };

/**
 * files: the compiled vehicle files (vehicle.json, engine.json, visual.json); terrains: by id;
 * bellyY: height of the hull floor. Returns {wheels, units, pitch, roll, speedKmh, weightKN}.
 */
export function suspensionDebug(files, terrains, caseKey, bellyY = 0.4) {
  const rg = files['visual.json']?.running_gear;
  if (!rg || !rg.wheels?.length) return null;
  const tm = makeTank(files['vehicle.json'], files['engine.json'], gearFromVisual(rg), { bellyY });
  const t = newTank(tm);
  const tan = Math.tan((12 * Math.PI) / 180);
  const height = caseKey === 'slope' ? (x, z) => z * tan : caseKey === 'kerb' ? (x) => (x < 0 ? 0.25 : 0) : () => 0;
  const ground = { height, surface: () => terrains.road };
  const run = (input, secs) => {
    for (let i = 0; i < Math.round(secs / DT); i++) stepTank(tm, t, input, ground, DT);
  };
  placeTank(tm, t, ground, 0, 0, 0);
  if (caseKey === 'accel') {
    run(IDLE, 1.5);
    run({ throttle: 1, steer: 0, brake: 0 }, 0.4);
  } else if (caseKey === 'brake') {
    run({ throttle: 1, steer: 0, brake: 0 }, 8);
    run({ throttle: 0, steer: 0, brake: 1 }, 0.35);
  } else if (caseKey === 'slope') run({ throttle: 0, steer: 0, brake: 1 }, 3);
  else run(IDLE, 3);

  const b = t.body;
  const sp = tm.sp;
  const ss = t.ss;
  const per = sp.stations.length / 2;
  const unitOf = new Map();
  sp.units.forEach((u, ui) => u.members.forEach((i) => unitOf.set(i, ui)));
  const wheels = sp.stations.map((s, i) => {
    const ui = unitOf.get(i);
    const m = sp.units[ui].members.length;
    return {
      side: s.side,
      n: (i % per) + 1,
      x: s.x,
      z: s.z,
      y: s.y + ss.comp[i],
      r: s.r,
      loadT: ss.load[i] / 9810,
      compPct: ((ss.comp[i] + sp.rebound) / (sp.travel + sp.rebound)) * 100,
      springKN: ss.spring[ui] / m / 1000,
      damperKN: ss.damper[ui] / m / 1000,
      grounded: ss.grounded[i],
      contact: b.localPoint(ss.contact[i]),
    };
  });
  const units = sp.units.map((u, ui) => ({ mount: u.mount, forceKN: ss.force[ui] / 1000, members: u.members.length }));
  const a = b.attitude();
  return {
    case: caseKey,
    wheels,
    units,
    pitch: a.pitch,
    roll: a.roll,
    speedKmh: t.info.speedKmh,
    weightKN: (tm.mass * 9.81) / 1000,
    staticKN: (tm.mass * 9.81) / 1000 / sp.stations.length,
    travel: sp.travel,
    rebound: sp.rebound,
    freq: sp.freq,
    zeta: sp.zeta,
  };
}

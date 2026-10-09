// Shared test rig for the tank model: real vehicle data on analytic ground.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTank, newTank, placeTank, stepTank, gearFromVisual } from '../src/sim/tank/tank.js';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
const json = (p) => JSON.parse(fs.readFileSync(path.join(DATA, p), 'utf8'));
export const terrains = Object.fromEntries(json('terrains.json').map((t) => [t.id, t]));

export function rig(id, opts = {}) {
  const v = json(`vehicles/${id}/vehicle.json`);
  const e = json(`vehicles/${id}/engine.json`);
  const vis = json(`vehicles/${id}/visual.json`);
  const tm = makeTank(v, e, gearFromVisual(vis.running_gear), { bellyY: 0.42, ...opts });
  return { tm, t: newTank(tm), v };
}

/** Ground: height function and one surface everywhere (or a function of x, z). */
export function ground(height, surface = 'road') {
  return { height, surface: typeof surface === 'function' ? surface : () => terrains[surface] };
}

export function run(r, terrain, input, secs, dt = 1 / 120, each) {
  const n = Math.round(secs / dt);
  let info;
  for (let i = 0; i < n; i++) {
    info = stepTank(r.tm, r.t, typeof input === 'function' ? input(i * dt) : input, terrain, dt);
    if (each) each(i * dt, info);
  }
  return info;
}

export { placeTank, gearFromVisual as gearOf };

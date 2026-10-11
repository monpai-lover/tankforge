import { gameplayRules } from './gameplayRules.js';

const vehicleParams = new WeakMap();
const loadouts = new WeakMap();
const mgProfiles = new WeakMap();
const apsProfiles = new WeakMap();
const gunProfiles = new WeakMap();

function cached(source, mode, cache, derive) {
  const rules = gameplayRules(mode);
  if (mode === 'historical') return source;
  let modes = cache.get(source);
  if (!modes) { modes = new Map(); cache.set(source, modes); }
  if (!modes.has(mode)) modes.set(mode, derive(rules));
  return modes.get(mode);
}

/** Derive once from the original makeParams result, never from an already boosted result. */
export function deriveVehicleParams(stock, mode = 'historical') {
  return cached(stock, mode, vehicleParams, rules => {
    // A taller final drive extends the RPM-limited speed range. Torque/power must also
    // include speed so force rises by drive, not drive/speed: power = force * speed.
    const powerFactor = rules.drive * rules.speed;
    return {
      ...stock,
      vTop: stock.vTop * rules.speed,
      maxReverseSpeed: stock.maxReverseSpeed * rules.speed,
      maxTurnRate: stock.maxTurnRate * rules.steer,
      power: stock.power * powerFactor,
      engine: Object.freeze({ ...stock.engine, horsepower: stock.engine.horsepower * powerFactor,
        torque_curve: Object.freeze(stock.engine.torque_curve.map(([rpm, torque]) => Object.freeze([rpm, torque * powerFactor]))) }),
      trans: Object.freeze({ ...stock.trans, final_drive_ratio: stock.trans.final_drive_ratio / rules.speed }),
    };
  });
}

/** Final manual/layout reload only. Cyclic guns and missiles already own derived clocks. */
export function effectiveReloadSeconds(seconds, mode = 'historical') {
  const rules = gameplayRules(mode);
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid reload seconds');
  return seconds / rules.fire;
}

export function deriveMgProfile(source, mode = 'historical') {
  return cached(source, mode, mgProfiles, rules => Object.freeze({ ...source,
    rate_rpm: source.rate_rpm * rules.fire, reload_s: source.reload_s / rules.fire,
  }));
}

export function deriveApsProfile(source, mode = 'historical') {
  return cached(source, mode, apsProfiles, rules => Object.freeze({ ...source,
    rate_rpm: source.rate_rpm * rules.fire,
    ...(source.rate_range_rpm && { rate_range_rpm: Object.freeze(source.rate_range_rpm.map(rate => rate * rules.fire)) }),
    traverse_deg_s: source.traverse_deg_s * rules.traverse,
    elevate_deg_s: source.elevate_deg_s * rules.elevate,
  }));
}

function gunProfile(source, mode) {
  return cached(source, mode, gunProfiles, rules => Object.freeze({ ...source,
    traverse_deg_s: source.traverse_deg_s * rules.traverse,
    elevate_deg_s: source.elevate_deg_s * rules.elevate,
    // Manual guns retain base reload_s: their final layout calculation is divided once
    // by effectiveReloadSeconds. Automatic and missile clocks use these profiles directly.
    ...(source.missile && { reload_s: source.reload_s / rules.fire }),
    ...(source.autocannon && { autocannon: Object.freeze({ ...source.autocannon,
      rate_rpm: source.autocannon.rate_rpm * rules.fire,
      belt_reload_s: source.autocannon.belt_reload_s / rules.fire,
    }) }),
  }));
}

/** Runtime wrappers retain ammunition and geometry references, and existing loaded/belt state.
 * Call at selection from an original loadout. Mutable queues remain owned by the caller.
 * No dt multiplier: manual final reload, cyclic profiles, MG belts and launch spacing each
 * own exactly one timing factor. Do not apply effectiveReloadSeconds to derived cycles.
 */
export function deriveLoadoutPerformance(source, mode = 'historical') {
  return cached(source, mode, loadouts, rules => ({
    ...source,
    weapons: source.weapons.aps ? { ...source.weapons, aps: deriveApsProfile(source.weapons.aps, mode) } : source.weapons,
    turrets: source.turrets.map(t => ({ ...t, traverse: t.traverse * rules.traverse,
      guns: t.guns.map(g => ({ ...g, def: gunProfile(g.def, mode),
        ...(g.def.missile && { launchIntervalSeconds: 0.25 / rules.fire }),
      })),
    })),
    machineGuns: source.machineGuns.map(m => ({ ...m, def: deriveMgProfile(m.def, mode),
      slew: m.slew * rules.traverse, elevateSlew: m.slew * rules.elevate,
    })),
  }));
}

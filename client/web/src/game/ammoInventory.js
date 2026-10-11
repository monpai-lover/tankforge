import policy from '../../../../config/ammo-resupply.json' with { type: 'json' };
import { fired } from '../sim/loading.js';
import { roundsLeft } from './loadout.js';

if (policy.ammo_protocol_version !== 1) throw new Error('Unsupported ammunition protocol');
const whole = n => Number.isSafeInteger(n) && n >= 0;
const mountedGuns = new WeakMap();
const capturedPlans = new WeakMap();
function gunsOf(lo) {
  let guns = mountedGuns.get(lo);
  if (!guns) {
    guns = lo.turrets.flatMap((t, ti) => t.guns.map((g, gi) => ({ key: `gun:${ti}:${gi}`, g, ti, gi })));
    mountedGuns.set(lo, guns);
  }
  return guns;
}
function capacity(g) { return g.capacity ?? g.ammo.reduce((n, a) => n + a.max, 0); }
function validVector(values, length) {
  if (!Array.isArray(values) || values.length !== length) return false;
  for (let i = 0; i < length; i++) if (!whole(values[i])) return false;
  return true;
}
function validateCounts(lo, counts) {
  const guns = gunsOf(lo);
  if (!counts || typeof counts !== 'object' || Array.isArray(counts) || Object.keys(counts).length !== guns.length)
    throw new Error('Incomplete ammunition counts');
  for (const { key, g } of guns) {
    const values = counts[key];
    if (!Object.hasOwn(counts, key) || !validVector(values, g.ammo.length)
      || !whole(capacity(g)) || values.reduce((n, x) => n + x, 0) > capacity(g))
      throw new Error(`Invalid ammunition counts for ${key}`);
  }
  return guns;
}
function wakeEmptyGun(g, L, gi) {
  if (!L || L.state[gi] !== 'empty' || roundsLeft(g) <= 0) return;
  if (g.def.autocannon && g.belt <= 0) g.beltChange = true;
  fired(L, gi);
}

/** Selected deployment targets; total stock already includes breech, belt and tubes. */
export function captureAmmoPlan(lo) {
  const plan = {};
  const guns = gunsOf(lo);
  for (const { key, g } of guns) {
    const targets = g.ammo.map(a => a.max);
    if (!targets.every(whole) || targets.reduce((n, x) => n + x, 0) > capacity(g)) throw new Error(`Invalid ammunition plan for ${key}`);
    plan[key] = Object.freeze({ ammo: Object.freeze(g.ammo.map(a => a.shell.id)), targets: Object.freeze(targets) });
  }
  Object.freeze(plan);
  capturedPlans.set(plan, { lo, guns });
  return plan;
}

export function ammoMix(lo) {
  return Object.fromEntries(gunsOf(lo).map(({ key, g }) => [key, g.ammo.map(a => a.count)]));
}

function plannedGuns(lo, plan) {
  const captured = capturedPlans.get(plan);
  if (captured?.lo === lo) return captured.guns;
  const counts = Object.fromEntries(Object.entries(plan || {}).map(([key, p]) => [key, p?.targets]));
  const guns = validateCounts(lo, counts);
  for (const { key, g } of guns) {
    if (!Array.isArray(plan[key].ammo) || plan[key].ammo.length !== g.ammo.length
      || g.ammo.some((a, i) => a.shell.id !== plan[key].ammo[i])) throw new Error(`Invalid ammunition types for ${key}`);
  }
  return guns;
}
export function needsAmmo(lo, plan) {
  return plannedGuns(lo, plan).some(({ key, g }) => g.ammo.some((a, i) => a.count < plan[key].targets[i]));
}

export function refillAmmo(lo, plan, loadings) {
  const guns = plannedGuns(lo, plan), changed = [];
  for (const { key, g, ti, gi } of guns) {
    let filled = false;
    g.ammo.forEach((a, i) => { if (a.count < plan[key].targets[i]) { a.count = plan[key].targets[i]; filled = true; } });
    if (filled) { changed.push(key); wakeEmptyGun(g, loadings?.[ti], gi); }
  }
  return changed;
}

/** All vectors validate before any mutation. Absolute counts do not reload a live gun. */
export function applyAmmoCounts(lo, counts, loadings) {
  const guns = validateCounts(lo, counts), changed = [];
  for (const { key, g, ti, gi } of guns) {
    if (g.ammo.some((a, i) => a.count !== counts[key][i])) {
      g.ammo.forEach((a, i) => { a.count = counts[key][i]; });
      changed.push(key); wakeEmptyGun(g, loadings?.[ti], gi);
    }
  }
  return changed;
}

/** Automatic interceptions debit the same mounted pool as manual discharges. */
export function consumeApsRounds(lo, instance, rounds) {
  const own = gunsOf(lo).find(({ key }) => key === instance);
  if (!own || !whole(rounds) || rounds > roundsLeft(own.g)) throw new Error('Invalid APS ammunition consumption');
  let remaining = rounds;
  for (const a of own.g.ammo) { const n = Math.min(a.count, remaining); a.count -= n; remaining -= n; }
}

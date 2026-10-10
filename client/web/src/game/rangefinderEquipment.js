// Equipment identity is evidence-based; anonymous numeric data means crew estimation.
export const RANGEFINDER_KINDS = Object.freeze(['manual', 'coincidence', 'stereoscopic', 'laser']);
export const DEFAULT_RANGEFINDER = Object.freeze({ time_s: 2.5, error_pct: 5, max_range_m: 2500 });
const EQUIPMENT = Object.freeze([
  Object.freeze({ source: 'de_panther_f', sight: 'TZF 13 + EM 1.32 m R', kind: 'stereoscopic', provenance: 'Planned equipment / game reconstruction; docs/rangefinder-equipment-research-2026-10-11.md' }),
]);
const positive = (v, fallback) => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;

export function resolveRangefinder(sight, sourceId) {
  const value = sight?.rangefinder;
  const rf = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const known = EQUIPMENT.find(e => e.source === sourceId && e.sight === sight?.name);
  const explicit = RANGEFINDER_KINDS.includes(rf.kind);
  const kind = explicit ? rf.kind : known?.kind || 'manual';
  const time_s = positive(rf.time_s, DEFAULT_RANGEFINDER.time_s);
  const error_pct = typeof rf.error_pct === 'number' && Number.isFinite(rf.error_pct) && rf.error_pct >= 0 && rf.error_pct <= 50 ? rf.error_pct : DEFAULT_RANGEFINDER.error_pct;
  const max_range_m = positive(rf.max_range_m, DEFAULT_RANGEFINDER.max_range_m);
  return {
    kind, time_s, error_pct, max_range_m,
    // Authored game delay, not a claim about the hardware's measurement time.
    delay_s: kind === 'laser' ? null : kind === 'manual' ? time_s : Math.min(time_s, 1),
    provenance: explicit ? 'Explicit authored equipment / game modification' : known?.provenance || 'Equipment unspecified; crew estimation',
  };
}

/** Independent MG mounts have no shared optics; a coax uses the primary turret's sight. */
export function rangefinderForWeapon(loadout, { ti = 0, mi = -1 } = {}) {
  if (mi >= 0 && loadout.machineGuns?.[mi]?.mount !== 'coax') return resolveRangefinder(null);
  const t = loadout.turrets[mi >= 0 ? 0 : ti];
  return resolveRangefinder({ name: t?.sight?.name, rangefinder: t?.rangefinder }, t?.sourceVehicle);
}

/** Ordinary supported file data, cloned so source definitions cannot acquire overrides. */
export function equipmentSight(sight, sourceId, override = 'inherit') {
  if (override !== 'inherit' && !RANGEFINDER_KINDS.includes(override)) throw new Error('測距設備無效');
  if (!sight) return sight;
  const copy = structuredClone(sight);
  const rf = resolveRangefinder(sight, sourceId);
  copy.rangefinder = { time_s: rf.time_s, error_pct: rf.error_pct, max_range_m: rf.max_range_m, kind: override === 'inherit' ? rf.kind : override };
  return copy;
}

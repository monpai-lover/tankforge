export function weaponControlKey(c) {
  return c.kind === 'gun' ? `gun:${c.ti}:${c.gi}` : c.kind === 'mg' ? `mg:${c.mi}` : 'all';
}

/** Control identity includes ALL and every installed weapon, regardless of readiness. */
export function weaponControlSlots(lo) {
  const slots = [{ kind: 'all' }];
  lo.turrets.forEach((t, ti) => t.guns.forEach((_, gi) => slots.push({ kind: 'gun', ti, gi })));
  lo.machineGuns.forEach((_, mi) => slots.push({ kind: 'mg', mi }));
  return slots;
}

export function nextWeaponControl(lo, current) {
  const slots = weaponControlSlots(lo);
  const key = weaponControlKey(current);
  const i = slots.findIndex(s => weaponControlKey(s) === key);
  return slots[(i + 1) % slots.length];
}

/** ALL and MG controls retain the first gun's sight context without sharing its identity. */
export function weaponControlSight(lo, c) {
  const reference = c.kind === 'gun' ? c : weaponControlSlots(lo).find(s => s.kind === 'gun');
  return { ti: reference?.ti ?? 0, gi: reference?.gi ?? 0, mi: c.kind === 'mg' ? c.mi : -1 };
}

export function gunControlActive(c, ti, gi) {
  return c.kind === 'all' || (c.kind === 'gun' && c.ti === ti && c.gi === gi);
}

export function mgControlActive(c, mi) {
  return c.kind === 'all' || (c.kind === 'mg' && c.mi === mi);
}

/** ALL trigger groups depend on weapon roles, independently of the retained sight. */
export function gunTrigger(c, ti, gi, def, secondary = false, rocket = false, apsTurret = -1) {
  if (!gunControlActive(c, ti, gi)) return false;
  if (rocket) return def.trigger === 'rocket';
  if (c.kind === 'gun') return !secondary || def.trigger === 'secondary' || !!def.autocannon || ti === apsTurret;
  if (def.trigger === 'rocket') return false;
  return (def.trigger === 'secondary' || ti === apsTurret) === secondary;
}

export function weaponControlLabel(lo, c) {
  if (c.kind === 'all') return '全炮開火';
  if (c.kind === 'gun') return `炮塔 ${c.ti + 1} · 火炮 ${c.gi + 1} 單獨開火`;
  const m = lo.machineGuns[c.mi];
  return `機槍 ${c.mi + 1} · ${m.def.name || m.weapon || m.def.id} 單獨開火`;
}

/** Temporary compatibility for the legacy sight caller until its atomic control migration. */
export function nextSightWeapon(loadout, current) {
  const slots = [];
  loadout.turrets.forEach((t, ti) => t.guns.forEach((_, gi) => slots.push({ ti, gi, mi: -1 })));
  loadout.machineGuns.forEach((_, mi) => slots.push({ ti: 0, gi: 0, mi }));
  const i = slots.findIndex(s => s.mi === current.mi && (s.mi >= 0 || (s.ti === current.ti && s.gi === current.gi)));
  return slots[(i + 1) % slots.length] || { ti: 0, gi: 0, mi: -1 };
}

export function machineGunTrigger(selected, index, primary, secondary) {
  // Temporary numeric compatibility for the existing runtime caller.
  if (typeof selected === 'number') return selected >= 0 ? selected === index && (primary || secondary) : secondary;
  if (selected.kind === 'mg') return selected.mi === index && (primary || secondary);
  return selected.kind === 'all' && secondary;
}

export function ammoKeyIndex(code) {
  return /^(Digit|Numpad)[1-9]$/.test(code) ? Number(code.slice(-1)) - 1 : -1;
}

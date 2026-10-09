/** G visits each cannon and MG once; MG selection retains a valid main-turret context. */
export function nextSightWeapon(loadout, current) {
  const slots = [];
  loadout.turrets.forEach((t, ti) => t.guns.forEach((_, gi) => slots.push({ ti, gi, mi: -1 })));
  loadout.machineGuns.forEach((_, mi) => slots.push({ ti: 0, gi: 0, mi }));
  const i = slots.findIndex(s => s.mi === current.mi && (s.mi >= 0 || (s.ti === current.ti && s.gi === current.gi)));
  return slots[(i + 1) % slots.length] || { ti: 0, gi: 0, mi: -1 };
}

export function machineGunTrigger(selected, index, primary, secondary) {
  return selected >= 0 ? selected === index && (primary || secondary) : secondary;
}

export function ammoKeyIndex(code) {
  return /^(Digit|Numpad)[1-9]$/.test(code) ? Number(code.slice(-1)) - 1 : -1;
}

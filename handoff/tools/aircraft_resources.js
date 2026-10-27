// Aircraft resource authority helpers. HUD readers never call these mutation helpers.
// Root's actual stepAirWeapons calls syncAircraftStoreLosses(air, {
//   applyStoreLoad, syncPodGuns
// }) before release/fuel processing. A loss batch advances resourceRevision once.
function aircraftStoreAvailable(air, item) {
  if (!item || item.gone || item.connected === false || item.disconnected === true) return false;
  const damage = air?.plane?.damage, owner = item.owner;
  return !owner || !(damage?.dead?.(owner) || damage?.gone?.(owner));
}

// Quantity only: the accepted internal pool plus remaining available external fuel.
// A default tank load is represented by def.fuel until the first consumption writes
// item.fuel. Missing/nonfinite quantities contribute zero, never a guessed refill.
function aircraftUsableFuel(air) {
  const kg = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
  let total = kg(air?.fuel?.kg);
  const seen = new Set();
  for (const item of air?.stores?.items || []) {
    if (seen.has(item) || !aircraftStoreAvailable(air, item) || item.def?.kind !== 'tank') continue;
    seen.add(item);
    total += kg(item.fuel ?? item.def.fuel);
  }
  return total;
}

function syncAircraftStoreLosses(air, callbacks = {}) {
  const stores = air?.stores, lost = [], seen = new Set();
  for (const item of stores?.items || []) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    if (!item.gone && !aircraftStoreAvailable(air, item)) lost.push(item);
  }
  if (!lost.length) return { changed: false, lostCount: 0, resourceRevision: air?.resourceRevision || 0 };
  const previousRevision = Number.isSafeInteger(air.resourceRevision) && air.resourceRevision >= 0 ? air.resourceRevision : 0;
  if (previousRevision === Number.MAX_SAFE_INTEGER) throw new RangeError('Aircraft resource revision exhausted');
  for (const item of lost) { item.gone = true; item.count = 0; }
  stores.burst = 0;
  air.storeHeld = false;
  air.storeTap = false;
  air.ccrp = null;
  air.impact = null;
  air.resourceRevision = previousRevision + 1;

  callbacks.syncPodGuns?.(air);
  callbacks.applyStoreLoad?.(air);
  return { changed: true, lostCount: lost.length, resourceRevision: air.resourceRevision };
}

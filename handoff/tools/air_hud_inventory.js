// Read-only aircraft HUD inventory. Embed this source before updateAirHud.
//
// const hudInventory = createAirHudInventory({
//   projectiles: () => data.projectiles, storeDefs: () => AIR_STORE_DEFS
// });
// const report = hudInventory.report(air, elapsedSeconds, {
//   timeSeconds: G4.time, lifeKey: acceptedBattleAndAircraftLifeIfAvailable
// });
//
// timeSeconds is optional; otherwise dt must be elapsed BETWEEN report calls, not
// one render-frame dt if the HUD is throttled. lifeKey/resetKey can identify accepted
// lifecycle/resource revisions. Ordinary firing/consumption must not bump resetKey.
// Only EMA display history is retained: every inventory value is read again each call.
function createAirHudInventory(options = {}) {
  const histories = new WeakMap();
  const tau = Number.isFinite(options.smoothingSeconds) && options.smoothingSeconds > 0 ? options.smoothingSeconds : 5;
  const warmup = Number.isFinite(options.warmupSeconds) && options.warmupSeconds >= 0 ? options.warmupSeconds : 0.5;
  const maximumGap = Number.isFinite(options.maximumGapSeconds) && options.maximumGapSeconds > 0 ? options.maximumGapSeconds : 10;
  const table = name => typeof options[name] === 'function' ? options[name]() : options[name] || {};
  const amount = x => typeof x === 'number' && Number.isFinite(x) ? Math.max(0, x) : null;
  const whole = x => Math.max(0, Math.floor(x + 1e-6));
  const partDead = (plane, owner) => !!owner && owner !== 'body' && !!plane?.damage?.dead?.(owner);
  const intact = (plane, item) => !!item && !item.gone && item.connected !== false && !partDead(plane, item.owner);
  const sameMembers = (a, b) => a.size === b.size && [...a].every(x => b.has(x));
  const object = x => x !== null && (typeof x === 'object' || typeof x === 'function');
  const definition = (item, defs) => item.def || defs[item.id] || {};
  const timeText = seconds => {
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    const n = Math.floor(seconds), secondsText = String(n % 60).padStart(2, '0');
    return n >= 3600 ? `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${secondsText}` : `${String(Math.floor(n / 60)).padStart(2, '0')}:${secondsText}`;
  };

  function guns(air) {
    const plane = air?.plane, projectiles = table('projectiles');
    const currentItems = air?.stores?.items ? new Set(air.stores.items) : null;
    const feeds = new Map();
    for (const gun of air?.guns || []) {
      if (!object(gun)) continue;
      const pod = gun.podItem;
      if (pod && (!intact(plane, pod) || currentItems && !currentItems.has(pod))) continue;
      if (partDead(plane, gun.owner)) continue;
      // aircraftGuns already partitions ammo across independent cannon feeds. A rotary
      // gun's barrels/mounts do NOT multiply it. Each syncPodGuns podItem is one feed,
      // including a multi-barrel pod and duplicate render records of that same feed.
      const key = options.reservoirKey?.(gun, air) ?? pod ?? gun;
      let caliber = amount(options.caliberForGun?.(gun, air)) ?? amount(gun.def?.caliber_mm);
      if (!(caliber > 0)) {
        caliber = null;
        for (const id of gun.belt || []) {
          const value = amount(projectiles[id]?.caliber_mm);
          if (value > 0) { caliber = value; break; }
        }
      }
      const rounds = amount(gun.ammo), old = feeds.get(key);
      if (old) {
        // Disagreeing aliases must never double a reservoir or overstate known stock.
        if (rounds !== null) old.rounds = old.rounds === null ? rounds : Math.min(old.rounds, rounds);
      } else feeds.set(key, { scope: pod ? 'pod' : 'internal', caliberMm: caliber, rounds });
    }
    const groups = new Map();
    for (const feed of feeds.values()) {
      const key = `${feed.scope}:${feed.caliberMm ?? 'unknown'}`;
      let group = groups.get(key);
      if (!group) {
        const caliber = feed.caliberMm === null ? '' : ` ${feed.caliberMm} mm`;
        group = { scope: feed.scope, caliberMm: feed.caliberMm, labelZh: `${feed.scope === 'pod' ? '吊艙機炮' : '機炮'}${caliber}`, labelEn: `${feed.scope === 'pod' ? 'Gun pod' : 'Gun'}${caliber}`, rounds: 0, reservoirCount: 0, unknownAmmo: false };
        groups.set(key, group);
      }
      group.reservoirCount++;
      group.unknownAmmo ||= feed.rounds === null;
      group.rounds += feed.rounds ?? 0;
    }
    return [...groups.values()].map(group => ({ ...group, rounds: whole(group.rounds) })).sort((a, b) => a.scope.localeCompare(b.scope) || (a.caliberMm ?? Infinity) - (b.caliberMm ?? Infinity));
  }

  function stores(air) {
    const st = air?.stores, plane = air?.plane, defs = table('storeDefs');
    const grouped = new Map(), counted = new Set();
    const ensure = (id, def) => {
      if (!['bomb', 'rocket', 'pod', 'aam', 'agm'].includes(def.kind)) return null;
      let group = grouped.get(id);
      if (!group) {
        group = { id, name: def.name || id, kind: def.kind, weaponKind: def.kind === 'pod' ? 'rocket' : def.kind, count: 0, selected: false, empty: true, unknownCount: false };
        grouped.set(id, group);
      }
      return group;
    };
    for (const id of st?.groups || []) {
      const item = st.items?.find(x => x.id === id);
      ensure(id, item ? definition(item, defs) : defs[id] || {});
    }
    for (const item of st?.items || []) {
      if (!item || counted.has(item)) continue;
      counted.add(item);
      const group = ensure(item.id, definition(item, defs));
      if (!group || !intact(plane, item)) continue;
      const count = amount(item.count);
      group.unknownCount ||= count === null;
      group.count += count ?? 0;
    }
    const ids = st?.groups || [], index = Number.isFinite(st?.sel) ? ((Math.trunc(st.sel) % ids.length) + ids.length) % ids.length : 0;
    const selectedId = ids.length ? ids[index] : null;
    for (const group of grouped.values()) {
      group.count = whole(group.count);
      group.empty = group.count === 0;
      group.selected = group.id === selectedId;
    }
    const result = [...grouped.values()];
    return { stores: result, selectedStore: result.find(g => g.selected) || null };
  }

  function fuelInventory(air) {
    const plane = air?.plane, fu = air?.fuel, defs = table('storeDefs');
    const internalKg = amount(fu?.kg), tanks = new Set();
    let externalKg = 0, externalMax = 0;
    for (const item of air?.stores?.items || []) {
      if (tanks.has(item) || !intact(plane, item)) continue;
      const def = definition(item, defs);
      if (def.kind !== 'tank') continue;
      tanks.add(item);
      externalKg += amount(item.fuel ?? def.fuel) ?? 0;
      externalMax += amount(def.fuel) ?? amount(item.fuel) ?? 0;
    }
    const usableKg = internalKg === null ? null : internalKg + externalKg;
    const maxKg = internalKg === null ? null : (amount(fu?.max) ?? internalKg) + externalMax;
    return { known: internalKg !== null, internalKg, externalKg, usableKg, maxKg, flowKgS: amount(fu?.flow), tanks };
  }

  function report(air, dt = 0, context = {}) {
    const gunGroups = guns(air), storeReport = stores(air), inventory = fuelInventory(air);
    // Independent viewers may use different clocks and lifecycle contexts for
    // the same plane. Keep their smoothing histories separate when requested.
    const plane = air?.plane, identity = object(context.historyKey) ? context.historyKey : object(plane) ? plane : object(air) ? air : null;
    let history = identity && histories.get(identity);
    const lifeKey = context.lifeKey ?? air?.lifeKey ?? air?.lifeId ?? plane?.lifeId;
    const gunTotal = gunGroups.reduce((sum, g) => sum + g.rounds, 0);
    let resetReason = null, elapsed = Number.isFinite(dt) && dt >= 0 ? dt : 0;
    if (!history) resetReason = 'aircraft';
    else if (history.lifeKey !== lifeKey) resetReason = 'life';
    else if (history.resetKey !== context.resetKey) resetReason = 'resource_epoch';
    else if (history.fuelObject !== air?.fuel || history.storesObject !== air?.stores || history.gunsObject !== air?.guns) resetReason = 'rearm';
    else if (!sameMembers(history.tanks, inventory.tanks)) resetReason = 'tank_change';
    else if (inventory.usableKg !== null && history.usableKg !== null && inventory.usableKg > history.usableKg + 1e-6) resetReason = 'refuel';
    else if (gunTotal > history.gunTotal) resetReason = 'rearm';
    const hasClock = context.timeSeconds !== undefined;
    if (hasClock) {
      if (!Number.isFinite(context.timeSeconds)) { resetReason = 'clock'; elapsed = 0; }
      else if (history && Number.isFinite(history.timeSeconds)) {
        elapsed = context.timeSeconds - history.timeSeconds;
        if (elapsed < 0) { resetReason = 'clock'; elapsed = 0; }
      }
    }
    if (elapsed > maximumGap) { resetReason = 'sample_gap'; elapsed = 0; }
    // On a resource/life boundary require fresh observations; do not inherit the old
    // time interval, flow average or warm-up, even if the new tank adds a lot of fuel.
    if (resetReason) history = { average: null, observedSeconds: 0 };
    if (!history) history = { average: null, observedSeconds: 0 };
    if (resetReason && resetReason !== 'aircraft') elapsed = 0;
    const fuel = { ...inventory, tanks: undefined, smoothedFlowKgS: null, enduranceSeconds: null, state: 'unavailable', timeText: '—', statusZh: '燃油資料未就緒', statusEn: 'Fuel unavailable', low: inventory.known && inventory.maxKg > 0 && inventory.usableKg < inventory.maxKg * 0.2, resetReason };
    const unavailable = (state, zh, en) => {
      fuel.state = state; fuel.statusZh = zh; fuel.statusEn = en;
      history.average = null; history.observedSeconds = 0;
    };
    if (!inventory.known) unavailable('unavailable', '燃油資料未就緒', 'Fuel unavailable');
    else if (inventory.usableKg <= 0) {
      unavailable('depleted', '燃油耗盡', 'Fuel depleted'); fuel.enduranceSeconds = 0; fuel.timeText = '00:00';
    } else if (plane?.crashed || plane?.damage?.broken || partDead(plane, 'engine') || partDead(plane, 'prop')) unavailable('engine_unavailable', '引擎不可用', 'Engine unavailable');
    else if (plane?.engineOff) unavailable('engine_off', '引擎關閉', 'Engine off');
    else if (plane?.engineStart != null) unavailable('starting', '引擎啟動中', 'Engine starting');
    else if (plane?.fuelOut) unavailable('unusable', '供油中斷', 'Fuel unavailable to engine');
    else if (!(inventory.flowKgS > 0)) unavailable(inventory.flowKgS === 0 ? 'no_flow' : 'calculating', inventory.flowKgS === 0 ? '暫無消耗估算' : '計算中', inventory.flowKgS === 0 ? 'No consumption estimate' : 'Calculating');
    else {
      const alpha = -Math.expm1(-elapsed / tau);
      history.average = history.average === null ? inventory.flowKgS : history.average + alpha * (inventory.flowKgS - history.average);
      history.observedSeconds += elapsed;
      fuel.smoothedFlowKgS = history.average;
      const seconds = inventory.usableKg / history.average;
      if (history.observedSeconds + 1e-9 >= warmup && Number.isFinite(seconds) && seconds >= 0) {
        fuel.state = 'current'; fuel.enduranceSeconds = seconds; fuel.timeText = timeText(seconds);
        fuel.statusZh = '當前功率估算'; fuel.statusEn = 'At current power';
      } else { fuel.state = 'calculating'; fuel.statusZh = '計算中'; fuel.statusEn = 'Calculating'; }
    }
    Object.assign(history, { fuelObject: air?.fuel, storesObject: air?.stores, gunsObject: air?.guns, tanks: inventory.tanks, usableKg: inventory.usableKg, gunTotal, lifeKey, resetKey: context.resetKey, timeSeconds: hasClock ? context.timeSeconds : undefined });
    if (identity) histories.set(identity, history);
    return { guns: gunGroups, ...storeReport, selectedBombCount: storeReport.selectedStore?.weaponKind === 'bomb' ? storeReport.selectedStore.count : 0, fuel };
  }
  return { report, reset(air) { const identity = object(air?.plane) ? air.plane : air; if (object(identity)) histories.delete(identity); } };
}

/* TF_GUIDED_AIRCRAFT_VARIANTS_BEGIN */
// Explicit catalog variants. Geometry and physics are inherited from the
// supplied source aircraft; these entries do not claim a newly measured model.
var TFGuidedAircraftVariants = (() => {
  const variants = Object.freeze({
    su27skm: Object.freeze({base: 'su27', name: 'Su-27SKM 側衛', role: '出口型多用途戰鬥機',
      geometryLimitation: 'inherited Su-27UBK two-seat source mesh; SKM single-seat exterior is not remodeled',
      source: 'https://janes.migavia.com/rus/sukhoi/su-27skm.html'}),
    mig29smt: Object.freeze({base: 'mig29', name: 'MiG-29SMT 支點', role: '多用途戰鬥機',
      geometryLimitation: 'inherited MiG-29 9.12 source mesh; SMT dorsal spine is not remodeled',
      source: 'https://janes.migavia.com/rus/mig/mig-29smt.html'})
  });
  const exportedMissiles = Object.freeze({r73: 'r73e', r27r: 'r27r1', r27t: 'r27t1'});
  const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const sourceId = id => variants[id]?.base || id;
  const sourceType = T => T?.variantSourceId ? {...T, id: T.variantSourceId} : T;
  const provenance = id => ({source: variants[id].source, year: 2005,
    yearBasis: '2005 出口目录可用年份，非服役年 (public export catalog availability; not service entry)',
    geometryLimitation: variants[id].geometryLimitation,
    physicsLimitation: 'inherited source flight physics and fuel figures; no separately measured variant performance'});

  function installTypes(fighters, types) {
    for (const [id, variant] of Object.entries(variants)) {
      const base = types[variant.base], fighter = fighters[variant.base];
      if (!base || !fighter) throw new Error('Missing guided-variant source ' + variant.base);
      const f = {...copy(fighter), name: variant.name, nation: '俄羅斯', era: '2005', role: variant.role,
        variantSourceId: variant.base, variantProvenance: provenance(id)};
      fighters[id] = f;
      // Keep the actual source geometry closure and damage anatomy. Repeating
      // this after model decoding refreshes the inherited renderer and sockets.
      types[id] = {...base, id, name: variant.name, fighter: f,
        variantSourceId: variant.base, variantProvenance: provenance(id)};
    }
  }

  function installLoadouts(loadouts) {
    for (const [id, variant] of Object.entries(variants)) {
      const inherited = copy(loadouts[variant.base] || []).map(([name, entries]) =>
        [name, entries.map(([store, ...rest]) => [exportedMissiles[store] || store, ...rest])]);
      loadouts[id] = [...inherited,
        ['Kh-29TE 對地 / R-73E 自衛', [['kh29te', 2, 'inner'], ['r73e', 2, 'outer']]]];
      if (id === 'mig29smt') loadouts[id].push(['RVV-AE 空優', [['rvvae', 2, 'inner'], ['r73e', 2, 'outer']]]);
    }
    const existing = loadouts.f15c || (loadouts.f15c = []);
    for (const [store, label] of [['agm65b', 'TV'], ['agm65d', 'IIR'], ['agm65g', 'IIR 重彈頭']]) {
      if (!existing.some(([, entries]) => entries.some(([id]) => id === store)))
        existing.push(['AGM-65' + store.slice(-1).toUpperCase() + ' ' + label,
          [[store, 2, 'inner'], ['aim9m', 2, 'outer']]]);
    }
  }

  function decorateSlots(id, input) {
    if (!variants[id] && id !== 'f15c') return input;
    return input.map(slot => {
      const options = new Map(), defaults = new Map();
      for (const [store, count] of slot.options) {
        const key = variants[id] ? exportedMissiles[store] || store : store;
        if (variants[id] && ['sniper', 'litening', 'alq131'].includes(key)) continue;
        options.set(key, count);
      }
      for (const [store, count] of slot.defaultCounts || []) defaults.set(variants[id] ? exportedMissiles[store] || store : store, count);
      if (slot.station === 'inner') {
        if (variants[id]) options.set('kh29te', 1);
        else for (const store of ['agm65b', 'agm65d', 'agm65g']) options.set(store, 1);
        if (id === 'mig29smt') options.set('rvvae', 1);
      }
      return {...slot, options, ...(slot.defaultCounts ? {defaultCounts: defaults} : {}),
        incomplete: new Map(slot.incomplete || [])};
    });
  }

  function inheritTables({fuel, radars, equipment, countermeasures, compatibility} = {}) {
    for (const [id, {base}] of Object.entries(variants)) {
      for (const table of [fuel, radars, equipment, countermeasures, compatibility])
        if (table?.[base]) table[id] = copy(table[base]);
      if (equipment?.[id]) {
        if (equipment[id].radar) equipment[id].radar = id;
        delete equipment[id].pod; delete equipment[id].podMount;
      }
      if (radars?.[id]) radars[id] = {...radars[id],
        name: id === 'mig29smt' ? 'Zhuk-ME（既有雷達遊戲參數）' : 'Su-27SKM 雷達（繼承 N001 遊戲參數）',
        provenance: 'Export catalog radar identity; range and scan gameplay parameters inherited from source aircraft'};
      if (compatibility) {
        const inherited = compatibility[id] || {};
        compatibility[id] = Object.fromEntries(Object.entries(inherited).map(([store, status]) => [exportedMissiles[store] || store, status]));
        // Legacy parents authorize domestic missiles through WEAPON_MIGRATION,
        // not a WEAPON_COMPAT row. Export IDs need their own catalog-backed
        // entries or the real layout correctly rejects every translated AAM.
        for (const store of ['r73e', 'r27r1', 'r27t1']) compatibility[id][store] = 'primary';
        compatibility[id].kh29te = 'primary';
        if (id === 'mig29smt') compatibility[id].rvvae = 'primary';
      }
    }
    if (compatibility?.f15c) for (const store of ['agm65b', 'agm65d', 'agm65g']) compatibility.f15c[store] = 'primary';
  }
  return Object.freeze({variants, sourceId, sourceType, provenance, installTypes, installLoadouts, decorateSlots, inheritTables});
})();
/* TF_GUIDED_AIRCRAFT_VARIANTS_END */

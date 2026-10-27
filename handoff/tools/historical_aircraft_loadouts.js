/* TF_HISTORICAL_AIRCRAFT_LOADOUTS_BEGIN */
// Append reviewed configurations over existing source options. This helper
// grants no weapon/station compatibility and introduces no weapon estimates.
var TFHistoricalAircraftLoadouts = (() => {
  const sources = Object.freeze({
    nvaMf: 'https://luftfahrtmuseum-rothenburg.de/flugzeuge/mig-21/mig-21-mf/',
    f15e: 'https://www.airmanmagazine.af.mil/ImageGallery/igphoto/2002820144/',
    f15eGbu10: 'https://www.acc.af.mil/News/Article-Display/Article/660249/desert-storm-the-strike-eagles-opening-act/',
    rocViper: 'https://air.mnd.gov.tw/EN/Weapon/Weapon_Detail.aspx?CID=221&ID=166',
    a10c: 'https://www.holloman.af.mil/About/Fact-Sheets/Display/Article/164232/a-10-thunderbolt-ii/',
    a10cPods: 'https://news.lockheedmartin.com/2006-03-21-Lockheed-Martin-Delivers-New-Integrated-Weapons-System-to-A-10C-Flight-Test-Program',
    a10cGbu12: 'https://www.dvidshub.net/image/8003900/load-crew-127th-amxs-uploading-gbu-12-paveway-ii',
    a10cGbu10: 'https://www.moody.af.mil/News/Article-Display/Article/211502/weapons-warriors-duke-it-out-for-load-supremacy/',
    r4m: 'https://airandspace.si.edu/collection-objects/rocket-air-air-r4m-orkan-hurricane/nasm_A19990015000'
  });
  // Equipment evidence dates are separate from the aircraft introduction date.
  // Existing game station names are not asserted to be official station numbers.
  // These are source-approved configurations, not replicas of a named combat sortie.
  const evidence = Object.freeze({
    mig21: Object.freeze({variant: 'MiG-21MF', nation: '東德',
      equipmentDate: 'NVA MF service 1972-1990; individual weapon introduction not independently dated',
      sources: [sources.nvaMf], stationBasis: 'Museum: four paired wing stations; actual v4 source sockets and counts unchanged'}),
    f15c: Object.freeze({variant: 'F-15E', nation: '美國',
      equipmentDate: 'GBU-10 demonstrated 1991; broader USAF inventory list published 2021, not evidence all stores existed in 1988',
      sources: [sources.f15e, sources.f15eGbu10], stationBasis: 'Existing approved single-store inner pair; fitted v4 game carriers, not newly certified manufacturing clearances',
      designator: 'Existing source-model LANTIRN and native laser owner'}),
    f16v: Object.freeze({variant: 'F-16V', nation: '中華民國',
      equipmentDate: 'Current ROCAF F-16V inventory confirmed by operator, retrieved 2026-10-27; not claimed as 2018 snapshot',
      sources: [sources.rocViper], stationBasis: 'Existing v4 inner/mid pairs and one right chin Sniper socket; quantities unchanged',
      designator: 'One physically carried Sniper for every new laser preset'}),
    a10a: Object.freeze({variant: 'A-10C', nation: '美國',
      equipmentDate: 'Pod integration manufacturer statement 2006; A-10C IOC 2007; exact GBU-10 loading record 2008 and GBU-12 loading record 2023',
      sources: [sources.a10c, sources.a10cPods, sources.a10cGbu10, sources.a10cGbu12],
      stationBasis: 'Existing source-hash-gated p5/p7 GBU-12, p4/p8 GBU-10 and p10 sensor options; no new station permission',
      designator: 'One physically carried Sniper or LITENING'}),
  });
  const presets = Object.freeze({
    mig21: [
      ['NVA：4 × R-3S', [['r3s', 2, 'inner'], ['r3s', 2, 'outer']]],
      ['NVA：4 × UB-16', [['ub16', 2, 'inner'], ['ub16', 2, 'outer']]],
      ['NVA：4 × FAB-250', [['fab250', 2, 'inner'], ['fab250', 2, 'outer']]],
    ],
    f15c: [
      ['GBU-10 / LANTIRN', [['gbu10', 2, 'inner']]],
      ['GBU-12 / LANTIRN', [['gbu12', 2, 'inner']]],
      ['CBU-87 雙掛', [['cbu87', 2, 'inner']]],
    ],
    f16v: [
      ['ROCAF：Mk 84 雙掛', [['mk84', 2, 'inner']]],
      ['ROCAF：GBU-10 / Sniper', [['gbu10', 2, 'mid'], ['sniper', 1, 'chin', 1]]],
      ['ROCAF：GBU-12 / Sniper', [['gbu12', 2, 'inner'], ['sniper', 1, 'chin', 1]]],
    ],
    a10a: [
      ['GBU-12 / Sniper', [['gbu12', 1, 'p5'], ['gbu12', 1, 'p7'], ['sniper', 1, 'p10']]],
      ['GBU-12 / LITENING', [['gbu12', 1, 'p5'], ['gbu12', 1, 'p7'], ['litening', 1, 'p10']]],
      ['GBU-10 / LITENING', [['gbu10', 1, 'p4'], ['gbu10', 1, 'p8'], ['litening', 1, 'p10']]],
    ],
  });
  const copy = value => JSON.parse(JSON.stringify(value));

  function correctStoreDefinitions(definitions) {
    const rocket = definitions.r4m, warhead = rocket?.warhead;
    if (!rocket || warhead?.id !== 'he_55_r4m' || rocket.mass !== 3.85 ||
        ![1, .52].includes(warhead.explosive_mass_kg) || ![.52, 3.85].includes(warhead.mass_kg))
      throw new Error('R4M source record changed; review physical mass/filler correction');
    // 520 g is the museum-confirmed explosive charge. 3.85 kg is the existing
    // game's total rocket estimate, retained unchanged rather than presented
    // as a new historical measurement or confusing charge mass with projectile mass.
    rocket.warhead = {...warhead, mass_kg: rocket.mass, explosive_mass_kg: .52,
      provenance: 'R4M air-to-air filler: Smithsonian NASM A19990015000, 520g Hexogen; projectile mass retains existing 3.85kg game total estimate',
      source: sources.r4m};
  }

  function installLoadouts(loadouts, types) {
    for (const [id, additions] of Object.entries(presets)) {
      const type = types[id], provenance = evidence[id];
      if (!type?.name?.includes(provenance.variant) || type.fighter?.nation !== provenance.nation || !Array.isArray(loadouts[id]))
        throw new Error('Historical preset source identity changed: ' + id);
      for (const addition of additions) {
        const present = loadouts[id].find(([name]) => name === addition[0]);
        if (present) {
          if (JSON.stringify(present) !== JSON.stringify(addition)) throw new Error('Historical preset name collision: ' + id + '/' + addition[0]);
          continue;
        }
        loadouts[id].push(copy(addition));
      }
    }
  }
  return Object.freeze({sources, evidence, presets, correctStoreDefinitions, installLoadouts});
})();
/* TF_HISTORICAL_AIRCRAFT_LOADOUTS_END */

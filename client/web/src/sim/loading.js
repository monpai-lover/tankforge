// TEMPORARY JS mirror of crates/weapon/src/loading.rs (tg_weapon::loading).
// A loader serves one gun at a time. Guns that need a round wait in a queue; each free loader takes
// the gun that has waited longest. A turret with six guns and one loader therefore fires its
// broadside once and then reloads the guns one after another.

/**
 * guns: [{reloadTime(loaderIdx) -> seconds}]  loaders: number of loaders (0 = the gunner loads, slower)
 */
export function newLoading(gunCount, loaderCount) {
  return {
    loaders: Array.from({ length: Math.max(1, loaderCount) }, () => ({ gun: -1, remaining: 0, total: 0 })),
    noDedicatedLoader: loaderCount <= 0,
    // per gun: 'ready' | 'waiting' | 'loading'
    state: Array.from({ length: gunCount }, () => 'ready'),
    waitedSince: Array.from({ length: gunCount }, () => 0),
    clock: 0,
  };
}

/** Marks a gun as fired (empty). */
export function fired(L, gun) {
  L.state[gun] = 'waiting';
  L.waitedSince[gun] = L.clock;
}

/** Remaining and total time for the gun's current reload, for the HUD. */
export function progress(L, gun) {
  if (L.state[gun] === 'ready') return { remaining: 0, total: 1, waiting: false };
  // out of ammunition: nothing left to load (set by the game, never picked by a loader)
  if (L.state[gun] === 'empty') return { remaining: Infinity, total: 1, waiting: false, empty: true };
  const l = L.loaders.find((x) => x.gun === gun);
  if (l) return { remaining: l.remaining, total: l.total, waiting: false };
  return { remaining: Infinity, total: 1, waiting: true };
}

/**
 * Advances all loaders. reloadTime(gun, loaderIdx) gives the seconds one round takes.
 * Returns the list of guns that became ready during this step.
 */
export function tick(L, dt, reloadTime) {
  L.clock += dt;
  const done = [];
  for (let i = 0; i < L.loaders.length; i++) {
    const l = L.loaders[i];
    let budget = dt;
    for (let guard = 0; guard < 4 && budget > 0; guard++) {
      if (l.gun < 0) {
        let pick = -1;
        for (let g = 0; g < L.state.length; g++) {
          if (L.state[g] !== 'waiting') continue;
          if (pick < 0 || L.waitedSince[g] < L.waitedSince[pick]) pick = g;
        }
        if (pick < 0) break;
        l.gun = pick;
        l.total = reloadTime(pick, i) * (L.noDedicatedLoader ? 1.6 : 1);
        l.remaining = l.total;
        L.state[pick] = 'loading';
      }
      const used = Math.min(budget, l.remaining);
      l.remaining -= used;
      budget -= used;
      if (l.remaining <= 1e-9) {
        L.state[l.gun] = 'ready';
        done.push(l.gun);
        l.gun = -1;
        l.remaining = 0;
      }
    }
  }
  return done;
}

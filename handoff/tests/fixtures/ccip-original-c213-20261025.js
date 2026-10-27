    function storeImpact(air) {
      if (air.plane.onGround || air.plane.crashed) return null;
      const g = storeGroup(air.stores);
      if (!g || !(g.def.kind === "bomb" || g.def.kind === "rocket" || g.def.kind === "pod")) return null;
      const P = air.plane, S = P.cur, d = g.def.kind === "pod" ? AIR_STORE_DEFS[g.def.rockets] : g.def, m = P.root.local;
      const pick = g.items.find(it => it.side === (air.stores.lastSide ? -air.stores.lastSide : -1)) || g.items[0];
      if (!pick) return null;
      const fwd = norm([m[8], m[9], m[10]]), up = norm([m[4], m[5], m[6]]), pos = P.worldPoint(pick.p), vel = [S[7], S[8], S[9]], dir = fwd.slice(), h = 1 / 120;
      // as released: a bomb ejected down off its rack at 1.5 m/s (0.16 s sooner on the ground from 600 m)
      if (d.kind === "bomb") for (let k = 0; k < 3; k++) vel[k] -= up[k] * 1.5;
      for (let t = 0; t < 40; t += h) {
        const previous = pos.slice();
        const sp = Math.hypot(...vel) || 1, rho = AIR_RHO(pos[1]), area = Math.PI * (d.d / 2) ** 2, k = 0.5 * rho * (d.kind === "bomb" ? 0.3 : sp > 300 ? .55 : .45) * area * 1.6 * sp / d.mass;
        const thrust = d.kind !== "bomb" && t < d.burn ? d.dv / d.burn : 0;
        for (let j = 0; j < 3; j++) vel[j] += (dir[j] * thrust - k * vel[j] + (j === 1 ? -G3 : 0)) * h;
        for (let j = 0; j < 3; j++) pos[j] += vel[j] * h;
        if (t > 0.15 || d.kind === "bomb") for (let j = 0; j < 3; j++) dir[j] = vel[j] / sp;
        const hit = groundHit(previous, pos, surfaceAt);
        if (hit) return { at: hit, t: t + h, station: pick.station, kind:d.kind, weaponId:g.id };
      }
      return null;
    }

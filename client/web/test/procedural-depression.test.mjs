import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/load-data.mjs';
import { makeLoadout, depressionAt } from '../src/game/loadout.js';
import { runtimeParts, surfaceCrossings } from '../tools/procedural-fleet-audit.mjs';
const data = loadData(), DEG=Math.PI/180;
for (const [id,yaws] of [['de_pz4_h',[150,165,180,-165,-150]],['de_rso_pak40',[20,25,-20,-25]]]) test(`${id} legal depression keeps the recoiling barrel clear of its deck and cab`, () => {
  const b=data.vehicles[id], t=makeLoadout(id,b,data.projectiles,data.machineGuns).turrets[0];
  const r=runtimeParts(id,data);
  for (const yaw of yaws) for (const recoil of [0,.5,1]) {
    const dep=depressionAt(t,yaw*DEG,t.guns[0].def.max_depression_deg);
    const parts=r.at({yaw:yaw*DEG,pitch:-dep*DEG,recoil});
    for (const gun of parts.filter(p=>p.part?.recoil && p.part?.type==='cyl')) for (const hull of parts.filter(p=>p.part?.mount==='hull')) {
      const hit=surfaceCrossings(gun,hull);
      assert.equal(hit.count,0,`${id} ${yaw}°/${-dep}° recoil ${recoil}: ${gun.id} x ${hull.id} at ${JSON.stringify(hit.points.slice(0,2))}`);
    }
  }
});

// Offline authoring probe: maximum safe depression for the full recoil envelope.
import fs from 'node:fs';
import { loadData } from './load-data.mjs';
import { runtimeParts, surfaceCrossings } from './procedural-fleet-audit.mjs';
const data=loadData(), DEG=Math.PI/180, out={};
for (const id of ['de_pz4_h','de_rso_pak40']) {
  const bundle=data.vehicles[id], r=runtimeParts(id,data), maximum=bundle.weapons.main_gun.max_depression_deg;
  const limit=bundle.weapons.yaw_limit_deg || [-180,180];
  const safe = (yaw, dep) => {
    if (yaw<limit[0]-1e-6 || yaw>limit[1]+1e-6) return true;
    for (const recoil of [0,.5,1]) {
      const parts=r.at({yaw:yaw*DEG,pitch:-dep*DEG,recoil});
      const guns=parts.filter(p=>p.part?.recoil && p.part?.type==='cyl'), hull=parts.filter(p=>p.part?.mount==='hull');
      for (const g of guns) for (const h of hull) if(surfaceCrossings(g,h).count) return false;
    }
    return true;
  };
  const values=[];
  for (let bearing=0;bearing<360;bearing+=10) {
    let dep=maximum;
    const samples=[];
    for(let dy=-10;dy<=10;dy+=2.5) { let yaw=(bearing+dy+540)%360-180; if(yaw>=limit[0]&&yaw<=limit[1])samples.push(yaw); }
    while(dep>0 && !samples.every(yaw=>safe(yaw,dep))) dep-=.25;
    if (!samples.every(yaw=>safe(yaw,dep))) throw new Error(`${id} cannot clear its barrel even when level at ${bearing}`);
    values.push(dep === maximum ? dep : Math.max(0,dep-.25));
  }
  out[id]=values;
  console.log(id, JSON.stringify(values));
}
fs.mkdirSync('dist/procedural-audit',{recursive:true});
fs.writeFileSync('dist/procedural-audit/depression-envelope.json',JSON.stringify(out,null,2));

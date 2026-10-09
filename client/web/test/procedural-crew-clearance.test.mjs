import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../tools/load-data.mjs';
import { runtimeParts, makePiece, touches, surfaceCrossings } from '../tools/procedural-fleet-audit.mjs';
import { buildInterior, setCrewModel } from '../src/gfx/interior.js';
import { animateCrew } from '../src/game/crewanim.js';
import { STRIDE } from '../src/gfx/geo.js';
import { transformPoint } from '../src/gfx/math.js';
import * as loading from '../src/sim/loading.js';
import { foldYawLimit } from '../src/game/folding.js';

const data = loadData(), DEG = Math.PI / 180;
setCrewModel(JSON.parse(fs.readFileSync(new URL('../assets/crew_model.json', import.meta.url))));
const structural = p => p.part.mount === 'hull' && !p.part.hinge &&
  (['loft', 'prism', 'plan'].includes(p.part.type) ||
   p.part.type === 'box' && p.part.size[0] >= .8 && p.part.size[2] >= 1.5 && p.part.size[1] <= .3);
const cross2 = (a, b) => a[0]*b[1]-a[1]*b[0];
function roofAt(p, tris) {
  let roof=-Infinity;
  for(const [a,b,c] of tris) {
    const ab=[b[0]-a[0],b[2]-a[2]],ac=[c[0]-a[0],c[2]-a[2]],q=[p[0]-a[0],p[2]-a[2]],det=cross2(ab,ac);
    if(Math.abs(det)<1e-10)continue;
    const u=cross2(q,ac)/det,v=cross2(ab,q)/det;
    if(u>=-1e-6&&v>=-1e-6&&u+v<=1+1e-6)roof=Math.max(roof,a[1]+u*(b[1]-a[1])+v*(c[1]-a[1]));
  }
  return roof;
}

// A horizontal cut of the actual authored shell. Test only outside its outer
// envelope below the rim; a hand above an open rim is allowed. Internal floor,
// seat and controls contact are deliberately absent from this outside test.
function section(tris, y) {
  const segments = [];
  for (const tri of tris) {
    const points = [];
    for (let k=0;k<3;k++) {
      const a=tri[k], b=tri[(k+1)%3];
      if ((a[1]<=y && b[1]>y) || (b[1]<=y && a[1]>y)) {
        const f=(y-a[1])/(b[1]-a[1]); points.push([a[0]+f*(b[0]-a[0]),a[2]+f*(b[2]-a[2])]);
      }
    }
    if(points.length===2) segments.push(points);
  }
  return segments;
}

function outside(p, shell, center, cache, turret) {
  if(p[1]<shell.minY-.01) return 'below-hull-floor';
  if(p[1]>=shell.maxY-.015) return null;
  if(p[1]>=turret.pivot[1]-.1&&Math.hypot(p[0]-center[0],p[2]-center[1])<turret.ring/2-.015)return null;
  // An arm over a locally low/open rear edge is free space, even if another
  // distant hull panel is taller. It must never be tested against that panel.
  const roof=roofAt(p,shell.tris);
  if(Number.isFinite(roof)&&p[1]>roof+.01)return null;
  const level=Math.round(p[1]*1000)/1000;
  if(!cache.has(level)) cache.set(level,section(shell.tris,level));
  const ray=[p[0]-center[0],p[2]-center[1]], radius=Math.hypot(...ray);
  if(radius<1e-5) return null;
  const direction=ray.map(v=>v/radius);let far=0,normalFactor=1;
  for(const [a,b] of cache.get(level)) {
    const edge=[b[0]-a[0],b[1]-a[1]], den=cross2(direction,edge);
    if(Math.abs(den)<1e-10) continue;
    const offset=[a[0]-center[0],a[1]-center[1]];
    const t=cross2(offset,edge)/den,u=cross2(offset,direction)/den;
    if(t>=far&&u>=-1e-6&&u<=1+1e-6){far=t;normalFactor=Math.abs(den)/Math.hypot(...edge);}
  }
  return far>0&&(radius-far)*normalFactor>.015 ? 'outside-hull-side' : null;
}

export function exposedCrewWitnesses(id, bundle = data.vehicles[id], phases = 16, yawSteps = 12, roles = null, fold = 0) {
  assert.ok(!bundle.model, 'imported models excluded');
  const local={...data,vehicles:{...data.vehicles,[id]:bundle}},rt=runtimeParts(id,local);
  const mesh=vertices=>({vertices,count:vertices.length/STRIDE});
  const renderer={mesh,instancedMesh:mesh,setInstances(){},freeMesh(){}};
  const interior=buildInterior(renderer,rt.model,rt.loadout,bundle.modules,bundle.crew);
  const T=[{guns:[{recoil:0}],loading:loading.newLoading(1,1)}],bad=[];
  const [cx,,cz]=rt.loadout.turrets[0].pivot;
  const yawLimits=foldYawLimit(rt.loadout.turrets[0],fold) || [-Math.PI,Math.PI];
  for(let yi=0;yi<=yawSteps;yi++) {
    const yaw=yawLimits[0]+(yawLimits[1]-yawLimits[0])*yi/yawSteps;
    const shellPieces=rt.at({yaw,fold}).filter(structural),tris=shellPieces.flatMap(p=>p.tris);
    const shell={tris,minY:Math.min(...shellPieces.map(p=>p.lo[1])),maxY:Math.max(...shellPieces.map(p=>p.hi[1]))},cache=new Map();
    for(let phase=0;phase<=phases;phase++) {
      const l=T[0].loading.loaders[0];l.gun=0;l.total=6;l.remaining=6*(1-phase/phases);
      animateCrew(interior,bundle.crew,rt.loadout,T,phase/phases*6,[]);rt.model.root.update();
      interior.byCrew.forEach((n,ci)=>{
        if(!n.always||(roles&&!roles.includes(bundle.crew[ci].role))||bad.some(b=>b.role===bundle.crew[ci].role))return;
        const vertices=n.mesh.vertices,seen=new Set();
        for(let i=0;i<vertices.length;i+=STRIDE) {
          const key=[vertices[i],vertices[i+1],vertices[i+2]].join(',');if(seen.has(key))continue;seen.add(key);
          const p=transformPoint(n.world,[vertices[i],vertices[i+1],vertices[i+2]]),kind=outside(p,shell,[cx,cz],cache,rt.loadout.turrets[0]);
          if(kind){bad.push({id,role:bundle.crew[ci].role,phase,yawDeg:yaw/DEG,kind,p});break;}
        }
      });
    }
  }
  interior.dispose();rt.model.dispose();return bad;
}

if(!process.env.TF_CREW_AUDIT_ONLY)test('actual visible crew stay inside the outside hull envelope through idle/reload and legal traverse',()=>{
  const ids=data.order.filter(id=>!data.vehicles[id].model),bad=[];
  assert.equal(ids.length,27);
  for(const id of ids) {
    if(!data.vehicles[id].vehicle.turret.open_top)continue;
    bad.push(...exposedCrewWitnesses(id));
    if(data.vehicles[id].weapons.fold_yaw_limit_stages||data.vehicles[id].weapons.folded_yaw_limit_deg)
      bad.push(...exposedCrewWitnesses(id,data.vehicles[id],16,12,null,1));
  }
  assert.deepEqual(bad,[]);
});

if(!process.env.TF_CREW_AUDIT_ONLY)test('corrected seated crew have cushions and hull-supported posts clear of full gun travel/recoil',()=>{
  for(const [id,count]of Object.entries({de_flakpz38t:2,de_hetzer_flak:2,de_rso_flak:1,de_rso_pak40:2,uk_cmp_portee:2})){
    const bundle=data.vehicles[id],rt=runtimeParts(id,data),mesh=vertices=>({vertices,count:vertices.length/STRIDE});
    const interior=buildInterior({mesh,instancedMesh:mesh,setInstances(){},freeMesh(){}},rt.model,rt.loadout,bundle.modules,bundle.crew);
    const neutral=rt.at();rt.model.root.update();
    const seats=neutral.filter(p=>p.part.name?.startsWith('crew_clearance_')&&p.part.name.endsWith('_cushion'));
    assert.equal(seats.length,count,`${id}: supported auxiliary cushions`);
    for(const seat of seats){
      const role=seat.part.name.replace('crew_clearance_','').replace('_cushion',''),ci=bundle.crew.findIndex(c=>c.role===role),node=interior.byCrew[ci];
      const local=makePiece(role,node.mesh.vertices),figure=makePiece(role,local.tris.map(t=>t.map(p=>transformPoint(node.world,p))),true);
      const post=neutral.find(p=>p.part.name===`crew_clearance_${role}_post`);
      assert.ok(touches(figure,seat),`${id}/${role}: hips touch cushion`);
      assert.ok(post&&touches(seat,post),`${id}/${role}: cushion touches post`);
      assert.ok(neutral.some(p=>p.part.mount==='hull'&&touches(post,p)),`${id}/${role}: post meets hull/platform`);
    }
    const gun=bundle.weapons.main_gun;
    for(let angle=-gun.max_depression_deg;angle<=gun.max_elevation_deg;angle++)for(const recoil of[0,.5,1]){
      const pieces=rt.at({pitch:angle*DEG,recoil});
      for(const gun of pieces.filter(p=>p.part.mount==='gun'))for(const support of pieces.filter(p=>p.part.name?.startsWith('crew_clearance_')))
        assert.equal(surfaceCrossings(gun,support).count,0,`${id}: ${angle}deg/${recoil} ${gun.id}/${support.id}`);
    }
    interior.dispose();rt.model.dispose();
  }
});

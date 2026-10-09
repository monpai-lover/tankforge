import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../tools/load-data.mjs';
import { makeLoadout, generatedTurretParts, buildToBundle, newTurretSpec } from '../src/game/loadout.js';
import { buildTank } from '../src/gfx/tankmodel.js';
import { buildInterior, setCrewModel } from '../src/gfx/interior.js';
import { animateCrew } from '../src/game/crewanim.js';
import { STRIDE } from '../src/gfx/geo.js';
import { transformPoint } from '../src/gfx/math.js';
import * as loading from '../src/sim/loading.js';
const data = loadData();
setCrewModel(JSON.parse(fs.readFileSync(new URL('../assets/crew_model.json', import.meta.url))));
const inside = (x,z,poly) => {
  let on = false;
  for (let i=0,j=poly.length-1;i<poly.length;j=i++) { const [a,b]=poly[i], [c,d]=poly[j]; if ((b>z)!==(d>z) && x<(c-a)*(z-b)/(d-b)+a) on=!on; }
  return on;
};
export function crewWallWitnesses(bundle, animate = false) {
  const mesh = vertices => ({ vertices, count: vertices.length / STRIDE });
  const renderer = { mesh, instancedMesh: mesh, setInstances() {}, freeMesh() {} };
  const lo = makeLoadout(bundle.vehicle.id, bundle, data.projectiles, data.machineGuns);
  const model = buildTank(renderer, lo, generatedTurretParts);
  const interior = buildInterior(renderer, model, lo, bundle.modules, bundle.crew);
  const outer = bundle.visual.parts.find(p => p.mount==='turret' && p.type==='plan');
  const [px,,pz] = lo.turrets[0].pivot;
  const sx = outer.scale_top?.[0] || 1, sz = outer.scale_top?.[1] || 1;
  const T = [{ guns: [{ recoil: 0 }], loading: loading.newLoading(1, 1) }];
  const bad = [];
  for (let phase=0;phase<=(animate?32:0);phase++) {
    const l = T[0].loading.loaders[0]; l.gun=0; l.total=6; l.remaining=6*(1-phase/32);
    animateCrew(interior, bundle.crew, lo, T, phase/32*6, []); model.root.update();
    interior.byCrew.forEach((n,ci) => {
      if (!n.always) return;
      const v=n.mesh.vertices;
      for (let i=0;i<v.length;i+=STRIDE) {
        const p=transformPoint(n.world,[v[i],v[i+1],v[i+2]]);
        if (p[1]<outer.y0+.015 || p[1]>outer.y1-.015) continue;
        const f=(p[1]-outer.y0)/(outer.y1-outer.y0);
        const poly=outer.outline.map(([x,z])=>[px+(x-px)*(1+(sx-1)*f),pz+(z-pz)*(1+(sz-1)*f)]);
        if (!inside(p[0],p[2],poly)) { bad.push({ role:bundle.crew[ci].role,phase,p }); break; }
      }
    });
  }
  model.dispose(); interior.dispose(); return bad;
}
for (const id of ['us_m8','us_m10']) test(`${id} exposed crew stays within turret wall through idle and reload`, () => {
  const witnesses=crewWallWitnesses(data.vehicles[id], true);
  assert.equal(witnesses.length, 0, JSON.stringify(witnesses.slice(0,4)));
});
for (const id of ['us_m8','us_m10']) test(`${id} uses its authored breech rather than a generic external recuperator`, () => {
  assert.equal(data.vehicles[id].visual.own_breech, true);
});
test('late-production steel-rimmed Tiger configuration is dated 1944', () => {
  const b=data.vehicles.de_tiger_e; assert.equal(b.visual.running_gear.wheel_style, 'steel_dish'); assert.equal(b.vehicle.meta.year,1944);
});
test('early M1A1 Sherman retains a plain muzzle while the M1A2 HVSS has its brake', () => {
  const hasBrake = id => data.vehicles[id].visual.parts.some(p=>p.mount==='gun' && p.type==='cyl' && p.recoil && p.axis==='z' && p.r>=.085 && p.pos[2]>3);
  assert.equal(data.vehicles.us_m4a1_76w.weapons.main_gun.id,'m1a1_76'); assert.equal(hasBrake('us_m4a1_76w'),false); assert.equal(hasBrake('us_m4a3_76w_hvss'),true);
});
test('authored open gun breeches do not hide the workshop replacement breech', () => {
  const build={base:'us_m8',keepStock:false,turrets:[{...newTurretSpec(),open:true}]};
  const c=buildToBundle(build,data),lo=makeLoadout('custom',c.bundle,{...data.projectiles,...c.projectiles},data.machineGuns);
  const mesh=vertices=>({vertices,count:vertices.length/STRIDE}),renderer={mesh,instancedMesh:mesh,setInstances(){},freeMesh(){}};
  const model=buildTank(renderer,lo,generatedTurretParts);
  const interior=buildInterior(renderer,model,lo,[],[]);
  assert.ok(model.turrets[0].guns[0].node.children.some(n=>n.name==='interior'&&n.always), 'new generated open cannon must show its own breech');
  model.dispose();interior.dispose();
});

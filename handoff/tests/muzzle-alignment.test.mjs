import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {models,source,section,c,api} from './jet-fixture.mjs';

const generic={id:'test-round',caliber_mm:30,mass_kg:.39,muzzle_velocity_ms:860,dispersion_mrad:1};
const data={machineGuns:new Proxy({},{get:(_,id)=>({...generic,id})}),projectiles:new Proxy({},{get:(o,id)=>o[id]||({...generic,id}),set:(o,k,v)=>(o[k]=v,true)})};
const receipts=[],flashes=[],G4={time:0,camPos:[1e9,0,0],bullets:[],shots:[],bulletShells:new Map(),localReplay:{acceptDischarge:(_,shot)=>(receipts.push(shot),shot),retainProjectile:s=>s}};
const make=Function('data','G4','AIRCRAFT_TYPES','disperse','rng2','newShot','bulletOf','beltShell','fx','airShot','sound',
  'const norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};const sub=(a,b)=>a.map((v,i)=>v-b[i]);'+
  section('    const M61_DEF = ','    /**\n     * Gunnery aim')+
  section('    function stepAircraftGuns(dt) {','    /**\n     * A round from p0')+
  section('    function botGuns(b, dt) {','    /**\n     * A round from p0 to p1 by the player')+
  'return {aircraftGuns,aircraftGunMount,stepAircraftGuns,botGuns};');
const guns=make(data,G4,api.AIRCRAFT_TYPES,a=>a,{nextF32:()=>.5},(o,d,r)=>({pos:o.slice(),vel:d.map(v=>v*r.muzzle_velocity_ms)}),a=>a,a=>a,{mgFlash:o=>flashes.push(o.slice())},()=>true,{});
const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,100,1500,200,1];
const equip=id=>G4.air={active:true,fireAll:true,guns:guns.aircraftGuns(id),plane:{root:{local:matrix},cur:new Float32Array(80),damage:{pilotDead:false,dead:()=>false}}};

test('nine revised aircraft use measured native apertures rather than scaled template gun positions',()=>{
 for(const id of ['a10a','f15c','f16v','f4e','mig17f','mig21','su25','su27','mig29']){
  const spec=models[id].spec,registration=spec.muzzleRegistration;
  assert.equal(registration.version,1,id);assert.equal(registration.points.length,spec.muzzles.length,id);
  for(const p of registration.points){assert.ok(models[id].parts.some(q=>q.name===p.part||q.source_mesh===p.part),id);assert.ok(p.surfaceDistanceM<.05,`${id}: gun is detached from its native port`);}
  for(const g of guns.aircraftGuns(id))assert.ok(spec.muzzles.some(q=>q.slice(0,3).every((v,k)=>Math.abs(v-g.mount[k])<1e-6)),g.id);
 }
 for(const [i,p]of models.mig17f.spec.muzzles.entries())assert.ok(Math.abs(p[2]-models.mig17f.spec.muzzleRegistration.points[i].sourcePoint[2]-.003)<1e-6,'MiG17 exact measured muzzle in the repaired CG frame');
 assert.ok(models.su25.spec.muzzles[0][1]>-1.05);assert.ok(Math.abs(models.f15c.spec.muzzles[0][1])<.05);
});

test('player discharge, projectile and flash use alternating twin ports with one ammo pool',()=>{
 for(const id of ['su25','mig21']){
  receipts.length=flashes.length=G4.shots.length=0;const air=equip(id),g=air.guns[0];g.cool=0;g.spin=1;
  const before=g.ammo;
  for(let k=0;k<2;k++){
   const expected=Array.from(guns.aircraftGunMount(g,g.fired+1),(v,i)=>v+matrix[12+i]);
   guns.stepAircraftGuns(k?60/g.rpm:0);
   assert.equal(g.fired,k+1);assert.deepEqual(receipts[k].origin,expected);
   assert.deepEqual(G4.shots[k].origin,expected);assert.deepEqual(flashes[k],expected);
  }
  assert.equal(before-g.ammo,2);assert.notDeepEqual(receipts[0].origin,receipts[1].origin);
 }
});

test('MiG-17 N-37 and both NR-23 guns retain their own aperture and ammunition',()=>{
 const air=equip('mig17f');receipts.length=0;for(const g of air.guns)g.cool=0;
 guns.stepAircraftGuns(0);assert.equal(receipts.length,3);
 for(let k=0;k<air.guns.length;k++){
  const g=air.guns[k];assert.equal(g.fired,1);assert.deepEqual(receipts[k].origin,Array.from(g.mount,(v,i)=>v+matrix[12+i]));
 }
 assert.match(air.guns[0].id,/n37/);assert.match(air.guns[1].id,/nr23/);
});

test('AI rounds and flashes use the same alternating native apertures',()=>{
 G4.shots.length=flashes.length=0;const air=equip('su25'),g=air.guns[0];g.cool=0;air.plane.type={name:'Su-25'};
 const before=g.ammo;
 for(let i=0;i<2;i++){
  const expected=Array.from(guns.aircraftGunMount(g,g.fired+1),(v,k)=>v+matrix[12+k]);
  guns.botGuns({plane:air.plane,guns:air.guns},i?60/g.rpm:0);
  assert.deepEqual(G4.shots[i].origin,expected);assert.deepEqual(flashes[i],expected);
 }
 assert.equal(before-g.ammo,2);
});

test('visible optical aperture excludes the A-10 lower opaque housing without moving the glass',()=>{
 const aperture=c.aircraftSightAperture||vm.runInContext('aircraftSightAperture',c),sp=models.a10a.spec;
 const clipped=aperture(sp.sight.points,sp.opticsCalibration.clearLowerY);
 assert.ok(clipped.length>=4);assert.ok(clipped.every(p=>p[1]>=.66-1e-9));
 assert.ok(sp.sight.points.some(p=>p[1]<.66));
});

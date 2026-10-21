import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../bundle/app.js.html', import.meta.url), 'utf8');
const cut = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const context = vm.createContext({});
vm.runInContext(cut('  var aircraftGeometry = (() => {', '  // NF-01 gear') + cut('  var AIR_FIGHTERS = {', '  /** Damage parts and skin of a hangar fighter') + '\nglobalThis.fixture={aircraftGeometry,AIR_FIGHTERS};', context);
const { aircraftGeometry, AIR_FIGHTERS } = context.fixture;
const colour = hex => [1, 3, 5].map(i => Math.pow(parseInt(hex.slice(i, i + 2), 16) / 255, 2.2));
function hasBarrel(mesh, muzzle) {
  const c = colour('#2a2d2f'), [x,y,z,len,r] = muzzle;
  for(let i=0;i<mesh.length;i+=13) if(c.every((v,k)=>Math.abs(v-mesh[i+6+k])<1e-6) && Math.abs(mesh[i]-x)<=r+1e-5 && Math.abs(mesh[i+1]-y)<=r+1e-5 && Math.abs(mesh[i+2]-(z-len/2))<len*.51) return true;
  return false;
}

test('wing-mounted barrels live in their detachable side batch; body guns stay in the body', () => {
  for(const [id,f] of Object.entries(AIR_FIGHTERS)) {
    const model=aircraftGeometry.fighter(f.spec), owners=f.spec.attachmentOwners?.muzzles || [];
    for(const [i,m] of f.spec.muzzles.entries()) {
      const owner=owners[i]||'body', mesh=owner==='wing_l'?model.wings.l:owner==='wing_r'?model.wings.r:model.body;
      assert.ok(hasBarrel(mesh,m),`${id} barrel ${i} missing from ${owner}`);
      if(owner!=='body') assert.ok(!hasBarrel(model.body,m),`${id} detached barrel survives in body`);
    }
  }
});

test('MiG wing fences, Spitfire radiator faces and Me 262 nacelles follow their wing', () => {
  for(const id of ['mig15','mig17f','spitfire9','me262']) {
    const f=AIR_FIGHTERS[id], m=aircraftGeometry.fighter(f.spec);
    const locations=id==='me262'?f.spec.jet.pods.flatMap(([x,y,z0,z1,r])=>[[-x,y,(z0+z1)/2,r],[x,y,(z0+z1)/2,r]]):f.spec.extras.filter((_,i)=>(f.spec.attachmentOwners?.extras?.[i]||'body').startsWith('wing')).map(([,p,s])=>[...p,Math.max(...s)]);
    for(const [x,y,z,size] of locations) {
      const mesh=m.wings[x<0?'l':'r'];let found=false;
      for(let i=0;i<mesh.length;i+=13) if(Math.abs(mesh[i]-x)<size*1.2 && Math.abs(mesh[i+1]-y)<size*1.2 && Math.abs(mesh[i+2]-z)<size*1.6) {found=true;break;}
      assert.ok(found,`${id}: owned attachment missing`);
    }
  }
});

function gunnery() {
  const generic={id:'test-round',caliber_mm:12.7,muzzle_velocity_ms:800,dispersion_mrad:1};
  const data={machineGuns:new Proxy({}, {get:(_,id)=>({...generic,id})}),projectiles:new Proxy({}, {get:(o,id)=>o[id]||({...generic,id}),set:(o,k,v)=>(o[k]=v,true)})};
  const shots=[], receipts=[], broken=new Set();
  const G4={time:0,bullets:[],shots:[],bulletShells:new Map(),localReplay:{acceptDischarge:(actor,shot)=>(receipts.push(shot),shot),retainProjectile:shot=>shot}};
  const types=Object.fromEntries(Object.entries(AIR_FIGHTERS).map(([id,f])=>[id,{fighter:f}]));
  const gunSource=cut('    const M61_DEF = ', '    /**\n     * Gunnery aim');
  const stepSource=cut('    function stepAircraftGuns(dt) {','    /**\n     * A round from p0');
  const make=Function('data','G4','AIRCRAFT_TYPES','disperse','rng2','newShot','bulletOf','beltShell','fx','airShot','sound',gunSource+stepSource+'\nreturn {aircraftGuns,stepAircraftGuns};');
  const api=make(data,G4,types,aim=>aim,{nextF32:()=>.5},(origin,dir,round)=>(shots.push(origin),{pos:origin,vel:dir.map(v=>v*round.muzzle_velocity_ms)}),d=>d,d=>d,{mgFlash(){}},()=>true,{});
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const equip=id=>G4.air={active:true,fireAll:true,guns:api.aircraftGuns(id),plane:{root:{local:identity},cur:new Float32Array(64),damage:{pilotDead:false,dead:id=>broken.has(id)}}};
  return {...api,G4,equip,broken,receipts};
}

test('mixed armament spawns each calibre from its matching authored barrel', () => {
  const f=gunnery();
  for(const [id,kind,indices] of [['spitfire9','m2',[2,3]],['spitfire9','hispano',[0,1]],['mig15','nr23',[1,2]],['mig15','n37',[0]]]) {
    const guns=f.aircraftGuns(id).filter(g=>g.id.startsWith(`air_${kind}_`));
    assert.deepEqual(guns.map(g=>Array.from(g.mount)),indices.map(i=>Array.from(AIR_FIGHTERS[id].spec.muzzles[i].slice(0,3))));
  }
});

test('accepted detached-wing state stops only that side, retaining ammo and resuming after repair', () => {
  const f=gunnery(), air=f.equip('fw190a8');f.broken.add('wing_l');
  const left=air.guns.filter(g=>g.owner==='wing_l'), before=left.map(g=>g.ammo);
  f.stepAircraftGuns(.1);
  assert.deepEqual(left.map(g=>g.ammo),before);
  assert.ok(air.guns.filter(g=>g.owner==='body'||g.owner==='wing_r').every(g=>g.fired>0));
  assert.ok(f.receipts.length>0,'present guns retain discharge/replay admission');
  f.broken.delete('wing_l');f.stepAircraftGuns(.1);
  assert.ok(left.every((g,i)=>g.ammo<before[i]&&g.fired>0));
  f.broken.add('wing_l');f.broken.add('wing_r');
  const bodyBefore=air.guns.filter(g=>g.owner==='body').map(g=>g.fired);
  f.stepAircraftGuns(.1);
  assert.ok(air.guns.filter(g=>g.owner==='body').every((g,i)=>g.fired>bodyBefore[i]),'nose guns remain independent of both wings');
});

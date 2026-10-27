import {R7_AIRCRAFT_IDS,INHERITED_AIRCRAFT} from './fixtures/r7-aircraft-contract.mjs';
import {modelUpgradePrelude} from './fixture-model-upgrade.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// These are the delivered bundle's actual builders, metadata, camera and pose methods.
const source = fs.readFileSync(new URL('../bundle/app.js.html', import.meta.url), 'utf8');
const section = (a, b) => {
  const begin = source.indexOf(a), end = source.indexOf(b, begin);
  assert.ok(begin >= 0 && end > begin, `missing bundled module ${a}`);
  return source.slice(begin, end);
};
const geometry = section('  var aircraftGeometry = (() => {', '  // NF-01 gear').replace(
  '    return build;\n  })();',
  '    build.framePartsForTest = (cc, cs) => { const b = { parts: [] }; canopyFrame(b, cc, cs, "#000000"); return b.parts; };\n    return build;\n  })();');
const context = vm.createContext({atob});
vm.runInContext(modelUpgradePrelude(source)+`
  const sub = (a,b) => a.map((v,i) => v-b[i]);
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const norm = a => { const l=Math.hypot(...a)||1; return a.map(v=>v/l); };
  const AIR_PARTS=[], AIR_SKIN=[], AIR_PARTS_JET=[], AIR_SKIN_JET=[];
` + geometry +
  section('  var AIR_CAMERA_FOLLOW = ', '  // ---- hangar fighters') +
  section('  var AIR_FIGHTERS = {', '  function fighterDamageModel(f) {') +
  section('  function fighterDamageModel(f) {', '  var Aircraft = class {') +
  section('  var aqMul = ', '  var AIRCRAFT_KEYS') +
  '\nglobalThis.definitions = { aircraftGeometry, AIR_FIGHTERS, AIRCRAFT_TYPES };', context);
const aircraftBegin = source.indexOf('  var Aircraft = class {');
const poseBegin = source.indexOf('    pose(alpha = 1) {', aircraftBegin);
const poseEnd = source.indexOf('    /** Sends the damage model', poseBegin);
const cameraBegin = source.indexOf('    camera(dt, groundAt) {', aircraftBegin);
const cameraEnd = source.indexOf('    /** Screen position of the aim reticle', cameraBegin);
assert.ok(cameraEnd > cameraBegin);
vm.runInContext(`globalThis.methods = ({${source.slice(poseBegin, poseEnd)},\n${source.slice(cameraBegin, cameraEnd)}});`, context);
const { aircraftGeometry, AIR_FIGHTERS, AIRCRAFT_TYPES } = context.definitions;
const models = Object.fromEntries(Object.entries(AIRCRAFT_TYPES).map(([id, type]) => [id, type.geometry()]));
const STRIDE = 13;
const ellipsoidRadiusSquared = (p, [centre, radii]) => p.reduce((n, v, k) => n + ((v-centre[k])/radii[k]) ** 2, 0);
const point = (m, p) => [0,1,2].map(k => m[k]*p[0]+m[4+k]*p[1]+m[8+k]*p[2]+m[12+k]);

function posed(id, gear, flaps = 0, extraControls = [], dead = () => false) {
  const cur = new Float32Array(64); cur[6] = 1; cur[33] = gear; cur[34] = flaps; cur[35] = 100;
  const plane = { type:AIRCRAFT_TYPES[id], prev: cur.slice(), cur, root: {}, controls: [...models[id].controls, ...extraControls].map(c => ({ ...c, node: {} })), damage: { dead }, state: { camera: 0 }, glass: {}, cockpit: {} };
  context.methods.pose.call(plane, 1);
  return plane;
}

function tireCentre(control) {
  const rgb = [1,3,5].map(k => Math.pow(parseInt('#252c2c'.slice(k,k+2),16)/255,2.2));
  const lo = [Infinity,Infinity,Infinity], hi = [-Infinity,-Infinity,-Infinity];
  let vertices = 0;
  for (let i=0;i<control.data.length;i+=STRIDE) if(rgb.every((v,k)=>Math.abs(v-control.data[i+6+k])<1e-6)) {
    for(let k=0;k<3;k++) { lo[k]=Math.min(lo[k],control.data[i+k]); hi[k]=Math.max(hi[k],control.data[i+k]); }
    vertices++;
  }
  assert.ok(vertices>50,'actual tire vertices were not selected');
  return point(control.node.local,lo.map((v,k)=>(v+hi[k])/2));
}

test('original26 plus two inherited cockpit eyes sit inside their actual canopy, including the two original types', () => {
  assert.deepEqual(Object.keys(AIRCRAFT_TYPES).sort(),R7_AIRCRAFT_IDS);
  for(const[id,base]of Object.entries(INHERITED_AIRCRAFT))assert.equal(AIRCRAFT_TYPES[id].variantSourceId,base);
  for(const [id,type] of Object.entries(AIRCRAFT_TYPES)) {
    assert.ok(ellipsoidRadiusSquared(type.eye,type.canopy)<0.85**2,`${id}: cockpit camera is outside the canopy or loses clearance`);
  }
  // The old NF-02 position is above its glass, which the new assertion must catch.
  assert.ok(ellipsoidRadiusSquared([0,1.18,4.05],AIRCRAFT_TYPES.nf02.canopy)>1);
});

test('real cockpit camera transforms the seated eye by aircraft attitude and world position', () => {
  const yaw=0.67,q=[0,Math.sin(yaw/2),0,Math.cos(yaw/2)],pos=[470,1230,-810];
  for(const [id,type] of Object.entries(AIRCRAFT_TYPES)) {
    const plane={drawQ:q,drawPos:pos,type,state:{camera:1},keys:new Set(),free:{yaw:0,pitch:0},camQ:q,aim:[Math.sin(yaw),0,Math.cos(yaw)],cur:new Float32Array(64)};
    const result=context.methods.camera.call(plane,0,()=>0),e=type.eye;
    const expected=[pos[0]+Math.cos(yaw)*e[0]+Math.sin(yaw)*e[2],pos[1]+e[1],pos[2]-Math.sin(yaw)*e[0]+Math.cos(yaw)*e[2]];
    assert.ok(result.camPos.every((v,k)=>Math.abs(v-expected[k])<1e-6),`${id}: cockpit eye is not in the aircraft frame`);
    assert.ok(Math.abs(Math.hypot(...result.fwd)-1)<1e-6);
  }
});

test('emitted canopy sill rods follow the glass ellipsoid rather than floating beside it', () => {
  const cases=[...Object.entries(AIR_FIGHTERS).map(([id,f])=>[id,f.spec.canopy]),['nf02',AIRCRAFT_TYPES.nf02.canopy]];
  for(const [id,canopy] of cases) {
    const [cc,cs]=canopy,parts=aircraftGeometry.framePartsForTest(cc,cs);
    let checked=0;
    for(const {m} of parts) if(Math.abs(m[9])<1e-10 && Math.abs(m[13]-cc[1])<0.02) {
      for(const sign of [-1,0,1]) {
        const endpoint=[0,1,2].map(k=>m[12+k]+sign*m[8+k]*.5);
        const d=ellipsoidRadiusSquared(endpoint,canopy);
        assert.ok(d>=0.98 && d<1.005,`${id}: sill rod leaves the glass surface (${d})`);
      }
      checked++;
    }
    assert.ok(checked>=4,`${id}: both sill paths must contain enough curvature samples`);
  }
});

test('Bf 109 and Spitfire main wheels fold outward without crossing the fuselage', () => {
  for(const id of ['bf109g','spitfire9']) for(const fraction of [0.5,0.05]) {
    for(const c of posed(id,fraction).controls.filter(c=>c.type==='gear')) {
      const centre=tireCentre(c);
      assert.ok(centre[0]*c.sign>Math.abs(c.p[0])+0.6,`${id}: main wheel folds inward or crosses centreline`);
      assert.ok(Math.abs(c.node.local[12]-c.p[0])<1e-7,'gear hinge moved');
    }
  }
});

test('Corsair mains fold aft while the axle turns to let the tire lie flat', () => {
  for(const fraction of [0.5,0.05]) for(const c of posed('f4u1d',fraction).controls.filter(c=>c.type==='gear')) {
    const centre=tireCentre(c);
    assert.ok(centre[2]<c.p[2]-0.6,'Corsair wheel did not fold aft');
    assert.ok(Math.abs(centre[0]-c.p[0])<0.06,'Corsair wheel incorrectly folds across the span');
    if(fraction===0.05) assert.ok(Math.abs(c.node.local[1])>0.98,'Corsair wheel axle did not rotate toward vertical for stowage');
  }
});

test('corrected retraction preserves gear-down dimensions, contact heights and joint origins', () => {
  for(const [id,f]of Object.entries(AIR_FIGHTERS)) for(const c of posed(id,1).controls.filter(c=>c.type==='gear')) {
    for(let k=0;k<3;k++) assert.ok(Math.abs(c.node.local[12+k]-c.p[k])<1e-7,`${id}: hinge moved`);
    for(let k=0;k<3;k++) assert.equal(c.node.local[k*5],1,`${id}: gear-down rotation changed`);
    let low=Infinity;
    for(let i=0;i<c.data.length;i+=STRIDE)low=Math.min(low,point(c.node.local,Array.from(c.data.slice(i,i+3)))[1]);
    const g=f.spec.gear.main;
    assert.ok(Math.abs(low-(g.y-g.len-g.r))<0.007,`${id}: accepted wheel contact height changed`);
  }
});

test('authored gear attachment drives actual side-specific damage and repair visibility at every extension', () => {
  const fuselageMounted = new Set(['bf109g','f104g','mig21','f15c','mig29','su27','su25','f16v']);
  for(const id of Object.keys(AIRCRAFT_TYPES)) for(const extension of [1,0.5,0]) {
    const dead=new Set(),plane=posed(id,extension,0,[],part=>dead.has(part));
    const mains=plane.controls.filter(c=>c.type==='gear'),aux=plane.controls.filter(c=>c.type==='tailgear');
    assert.equal(mains.length,2,`${id}: both actual main gear controls are required`);
    assert.equal(aux.length,1,`${id}: actual nose/tail gear is required`);
    const attachment=fuselageMounted.has(INHERITED_AIRCRAFT[id]||id)?'fuselage':'wing';
    for(const c of mains) assert.equal(c.attachment,attachment,`${id}: attachment must be explicitly authored`);
    // Reuse the same plane/nodes through left damage, right damage, both, then repair.
    for(const lost of [[],['wing_l'],['wing_r'],['wing_l','wing_r'],[]]) {
      dead.clear();for(const part of lost)dead.add(part);
      context.methods.pose.call(plane,1);
      for(const c of mains) {
        const owner=c.sign<0?'wing_l':'wing_r',expected=extension>=0.02 && !(attachment==='wing'&&dead.has(owner));
        assert.equal(c.node.visible,expected,`${id}: extension${extension}, damage${lost}, main${c.sign}`);
      }
      assert.equal(aux[0].node.visible,extension>=0.02,`${id}: wing loss must not remove the nose/tail wheel`);
    }
  }
});

test('original aircraft keep their accepted down-contact geometry while wing-mounted mains gain ownership', () => {
  for(const [id,low] of [['nf01',-1.74],['nf02',-2.23]]) for(const c of posed(id,1).controls.filter(c=>c.type==='gear')) {
    let actual=Infinity;
    for(let i=0;i<c.data.length;i+=STRIDE)actual=Math.min(actual,point(c.node.local,Array.from(c.data.slice(i,i+3)))[1]);
    assert.ok(Math.abs(actual-low)<0.007,`${id}: visible wheel contact moved`);
    assert.equal(c.owner,c.sign<0?'wing_l':'wing_r');
  }
});

test('flap pose uses accepted extension and wing ownership, including hidden split flaps', () => {
  const controls=[-1,1].map(side=>({type:'flap',p:[side,0,0],axis:[side,0,0],sign:side,deflectionSign:side,maxAngle:.7,owner:side<0?'wing_l':'wing_r'}));
  for(const c of posed('p51d',1,1,controls).controls.filter(c=>controls.some(x=>x.p===c.p))) assert.ok(point(c.node.local,[0,0,-.3])[1]<-.18,'both flap trailing edges must deflect downward');
  const split={...controls[0],hideWhenRetracted:true};
  assert.equal(posed('p51d',1,0,[split]).controls.at(-1).node.visible,false);
  assert.equal(posed('p51d',1,.5,[split]).controls.at(-1).node.visible,true);
  assert.equal(posed('p51d',1,1,controls,id=>id==='wing_l').controls.at(-2).node.visible,false);
  assert.equal(posed('p51d',1,1,controls,id=>id==='wing_l').controls.at(-1).node.visible,true);
});

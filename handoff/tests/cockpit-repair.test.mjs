import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {models,source,section,c,api,point} from './jet-fixture.mjs';

test('registered optics keep the source seat independent of the reflector and do not warp opaque cockpit geometry',()=>{
  for(const [id,m] of Object.entries(models)){
    if(id==='me262')continue;
    const sp=m.spec,o=sp.opticsCalibration;assert.equal(o.version,4,id);
    assert.equal(o.opaqueSupportWarp,false,id);
    assert.ok(sp.eye.every((v,k)=>Math.abs(v-sp.eyeSeated[k]-o.eyeOffset[k])<1e-6),id);
    assert.ok(Math.min(...sp.sight.points.map(q=>q[2]))>sp.eye[2]+.1,id);
    const ys=sp.sight.points.map(q=>q[1]);assert.ok(Math.min(...ys)<sp.eye[1]&&Math.max(...ys)>sp.eye[1],id);
  }
  assert.ok(models.a10a.spec.eye[2]>models.a10a.spec.eyeSeated[2]+.1);
  assert.ok(models.f15c.spec.eye[2]>models.f15c.spec.eyeSeated[2]+.3);
  assert.ok(models.a10a.spec.opticsCalibration.ufcOffset<-.2);
});
test('MiG-17 uses both original wing supports and rails, with bombs outside the wheel well',()=>{
  const m=models.mig17f,T=api.AIRCRAFT_TYPES.mig17f;
  for(const side of ['wing_l','wing_r'])for(const name of ['body_source_11','body_source_12'])
    assert.ok(m.parts.some(p=>(p.source_mesh||p.name)===name&&p.group===side),`${side}/${name}`);
  for(const lo of api.AIR_LOADOUTS.mig17f){
    const items=api.layoutStores(T,lo);assert.equal(items.length,2);
    for(const it of items){assert.equal(it.nativePylon,true);assert.equal(it.pylon,null);assert.ok(Math.abs(Math.abs(it.p[0])-2.35)<.02);}
  }
});

vm.runInContext(`globalThis.poseMethods=({${source.slice(source.indexOf('    pose(alpha = 1) {',source.indexOf('  var Aircraft = class {')),source.indexOf('    /** Sends the damage model',source.indexOf('    pose(alpha = 1) {',source.indexOf('  var Aircraft = class {'))))}});`,c);
test('Mirage gear has independent doors, finite full-travel poses and all three visible tyres touch the same runway',()=>{
  const T=api.AIRCRAFT_TYPES.mirage3e,g=T.geometry(),cur=new Float32Array(80);cur[6]=1;cur[1]=cur[35]=2;
  const p={type:T,cur,prev:cur.slice(),root:{},controls:g.controls.map(q=>({...q,node:{},parentP:q.parent!=null?g.controls[q.parent].p:undefined})),state:{camera:0},damage:{dead:()=>false},glass:{},cockpit:{}};
  assert.ok(p.controls.filter(q=>q.name?.startsWith('gear_door_')).length===2);
  const local=(q,v)=>{const r=point(q.node.local,v);return q.parent!=null?local(p.controls[q.parent],r):r;};
  for(const gear of [0,.25,.5,.75,1,.75,.5,.25,0]){
    cur[33]=p.prev[33]=gear;c.poseMethods.pose.call(p,1);
    for(const q of p.controls)assert.ok(Array.from(q.node.local).every(Number.isFinite));
    if(gear===1){
      let tyres=0;
      for(const q of p.controls.filter(q=>/gear_(L|R|nose)$/.test(q.name))){
        const sourcePart=models.mirage3e.parts.filter(part=>part.mover===q.mover&&part.name.endsWith('_tyre'));
        assert.equal(sourcePart.length,1,q.name);tyres++;
        // Its control batch contains the strut/hub too; all must stay at or above the tyre contact plane.
        let low=Infinity;
        for(let i=0;i<q.data.length;i+=13)low=Math.min(low,point(p.root.local,local(q,q.data.slice(i,i+3)))[1]);
        assert.ok(Math.abs(low)<.025,`${q.name}: contact error ${low} m`);
      }
      assert.equal(tyres,3);
    }
  }
});
test('instrument values follow accepted flight, ammunition and fuel without changing authority state',()=>{
  const cur=new Float32Array(80);cur[1]=1500;cur[14]=120;cur[17]=2.2;cur[18]=1;cur[19]=.1;cur[20]=-.3;cur[27]=.8;cur[33]=.5;cur[35]=900;
  const air={fuel:{kg:730,max:1000},guns:[{ammo:48},{ammo:37}]},before=Array.from(cur);
  const v=api.cockpitFlightData({cur},air);
  assert.equal(v.altitudeM,1500);assert.equal(v.fuelKg,730);assert.equal(v.ammoRemaining,85);
  assert.ok(Math.abs(v.speedKnots-233.26128)<1e-4);assert.equal(v.gear,.5);
  assert.deepEqual(Array.from(cur),before);assert.equal(air.guns[0].ammo,48);
  cur[1]=2400;air.guns[0].ammo=47;const changed=api.cockpitFlightData({cur},air);
  assert.equal(changed.altitudeM,2400);assert.equal(changed.ammoRemaining,84);
});
test('the F-104 gauges and A-10/F-15 screens are supplied as actual registered cockpit meshes',()=>{
  for(const [id,min] of [['f104g',25],['a10a',2],['f15c',3]]){
    const instruments=api.AIRCRAFT_TYPES[id].geometry().imported.instruments;
    assert.ok(instruments.length>=min,id);
    for(const d of instruments)assert.ok(d.data.length>0&&Array.from(d.data).every(Number.isFinite),`${id}/${d.id}`);
  }
});

vm.runInContext(section('    const AIR_EQUIP = ','    /** Targeting pods:')+
  section('    function storeGroup(st) {','    function cycleStore(')+
  section('    function visibleStoreImpact(air) {','    // ---- enemy aircraft')+
  'globalThis.policy={AIR_EQUIP,storeGroup,visibleStoreImpact};',c);
test('early gyro sights do not get terrain CCIP or computer-driven mouse aim',()=>{
  for(const id of ['mig15','mig17f','f86f','hunter6']){
    const eq=c.policy.AIR_EQUIP[id];assert.equal(eq.gyro,true);assert.ok(!eq.lcos&&!eq.ccip&&!eq.ccrp,id);
  }
  assert.equal(c.policy.AIR_EQUIP.f104g.ccip,true);assert.equal(c.policy.AIR_EQUIP.a10a.ccip,true);
});
test('bomb cue disappears immediately on ground, after selection change, after the final bomb and without equipment',()=>{
  const def=api.AIR_STORE_DEFS.mk82,st={groups:['mk82','hvar'],sel:0,items:[{id:'mk82',def,count:1},{id:'hvar',def:api.AIR_STORE_DEFS.hvar,count:1}]};
  const air={plane:{onGround:false,crashed:false},ctl:{eq:{ccip:true}},stores:st,impact:{kind:'bomb',weaponId:'mk82',at:[0,0,500],t:3}};
  assert.ok(c.policy.visibleStoreImpact(air));
  air.plane.onGround=true;assert.equal(c.policy.visibleStoreImpact(air),null);air.plane.onGround=false;
  st.sel=1;assert.equal(c.policy.visibleStoreImpact(air),null);st.sel=0;
  st.items[0].count=0;assert.equal(c.policy.visibleStoreImpact(air),null);st.items[0].count=1;
  air.ctl.eq.ccip=false;assert.equal(c.policy.visibleStoreImpact(air),null);
});

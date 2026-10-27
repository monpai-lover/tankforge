import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

function helper(){
  const catalog=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/limits.json',import.meta.url),'utf8'));
  const c=vm.createContext({TF_AIRFRAME_LIMITS_DATA:catalog});
  vm.runInContext(fs.readFileSync(new URL('../tools/airframe_limits.js',import.meta.url),'utf8'),c);
  return {api:c.TFAirframeLimits,catalog};
}
const telemetry=(iasKmh=0,tasKmh=iasKmh,gear=0,altitude=0,time=10)=>{
  const s=new Float32Array(80);s[1]=altitude;s[13]=tasKmh/3.6;s[14]=iasKmh/3.6;s[23]=time;s[33]=gear;return s;
};
const near=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('every current aircraft separates performance references from explicitly provisional structural and gear limits',()=>{
  const {catalog}=helper(),profiles=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8'));
  assert.deepEqual(Object.keys(catalog.aircraft).sort(),Object.keys(profiles.aircraft).sort());
  for(const [id,entry]of Object.entries(catalog.aircraft)){
    assert.ok(entry.structural.iasKmh>0,id);assert.ok(entry.gear.iasKmh>0,id);
    assert.equal(entry.structural.basis,'game_setting');assert.equal(entry.gear.basis,'game_setting');
    assert.ok(entry.performance.basis);assert.ok(entry.performance.note);
    if(!/^nf0/.test(id))assert.ok(entry.performance.sources.length>0,id);
  }
});

test('IAS and Mach independently constrain the airframe while performance maximum never triggers damage',()=>{
  const {api,catalog}=helper(),limits=catalog.aircraft.p51d;
  const s=telemetry(limits.structural.iasKmh*.8),state=api.createState();
  api.advance(state,'p51d',s,10);assert.equal(state.structure_fraction,0);
  const fast=telemetry(limits.structural.iasKmh*1.2);assert.ok(api.advance(state,'p51d',fast,.1).structure_delta>0);
  const altitude=15000,mach=catalog.aircraft.f15c.structural.mach*1.1;
  const high=telemetry(700,api.soundSpeed(altitude)*mach*3.6,0,altitude);
  assert.ok(api.sample('f15c',high).ratio>1.09,'High-altitude Mach limit is independent of IAS');
});

test('constant accepted exposure is invariant to timestep partition and stops accumulating below limits',()=>{
  const {api,catalog}=helper(),s=telemetry(catalog.aircraft.p51d.structural.iasKmh*1.2),a=api.createState(),b=api.createState();
  api.advance(a,'p51d',s,1);for(let i=0;i<120;i++)api.advance(b,'p51d',s,1/120);
  near(a.structure_fraction,b.structure_fraction);const before=a.structure_fraction;
  api.advance(a,'p51d',telemetry(100),1);assert.equal(a.structure_fraction,before);
  assert.equal(api.advance(a,'p51d',s,NaN).structure_delta,0);
});

test('only exposed gear receives wind load and an accepted failure cannot heal during normal snapshots or slowing',()=>{
  const {api,catalog}=helper(),speed=catalog.aircraft.p51d.gear.iasKmh*1.5,a=api.createState(),b=api.createState();
  api.advance(a,'p51d',telemetry(speed,speed,0),20);assert.equal(a.gear_fraction,0);assert.equal(a.gear_failed,false);
  api.advance(b,'p51d',telemetry(speed,speed,1),1);assert.equal(b.gear_failed,true);
  assert.equal(api.advance(b,'p51d',telemetry(speed,speed,1),1).gear_failed_now,false);
  api.advance(b,'p51d',telemetry(0),10);assert.equal(b.gear_failed,true);
  const plane={airframeLimitState:b};api.accept(plane,{airframe_limits:{...b}});assert.equal(plane.airframeLimitState.gear_failed,true);
});

test('flutter is bounded and deterministic in accepted time while visual pose leaves flight, hitbox and resources unchanged',()=>{
  const {api,catalog}=helper(),s=telemetry(catalog.aircraft.p51d.structural.iasKmh*1.1),matrix=()=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const n={part:'wing_l',local:matrix(),visible:true},gear={node:{local:matrix(),visible:true,mesh:{}},type:'gear',p:[1,-1,0]};
  const plane={type:{id:'p51d',airframe:[0,0,0,11]},cur:s,hitbox:{tris:new Float32Array([1,2,3])},pieceNodes:[n],controls:[gear],damage:{gone:()=>false},airframeLimitState:api.createState(),debris:[],_debris(){this.debris.push('cosmetic');}};
  const before=JSON.stringify({cur:[...s],hitbox:[...plane.hitbox.tris]});
  const angle=api.flutter('p51d',s,-1);assert.ok(Math.abs(angle)<=catalog.rules.flutterMaxRad);assert.equal(api.flutter('p51d',s,-1),angle);
  api.beginPose(plane);api.pose(plane);const first=[...n.local];api.beginPose(plane);api.pose(plane);assert.deepEqual([...n.local],first);
  assert.equal(JSON.stringify({cur:[...s],hitbox:[...plane.hitbox.tris]}),before);
  plane.airframeLimitState.gear_failed=true;api.pose(plane);api.pose(plane);assert.equal(gear.node.visible,false);assert.equal(plane.debris.length,1);
  assert.match(api.warning(plane,'en').text,/GEAR/);
});

test('a native presentation never advances local structural damage or the flight kernel',()=>{
  const {api,catalog}=helper(),plane={type:{id:'p51d'},cur:telemetry(catalog.aircraft.p51d.structural.iasKmh*2),instrumentContext:{nativeAuthority:true},damage:{harm(){throw Error('native damage is host-owned');}},api:{set_gear_failure(){throw Error('native flight is host-owned');}}};
  api.localStep(plane,10);assert.equal(plane.airframeLimitState,undefined);
});

test('local fixed-step exposure detaches the original damage-model wings without incendiary rolls or repeated failure',()=>{
  const {api,catalog}=helper(),app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
  const a=app.indexOf('  var AircraftDamage = class {'),b=app.indexOf('  // NF-02: the same kinds',a);
  const c=vm.createContext({});vm.runInContext(app.slice(a,b),c);
  const damage=new c.AircraftDamage([{id:'wing_l',hp:160,detach:true},{id:'wing_r',hp:160,detach:true}],[],null);
  const s=telemetry(catalog.aircraft.p51d.structural.iasKmh*1.5),plane={type:{id:'p51d'},cur:s,damage,applyDamage(){}};
  for(let i=0;i<480;i++)api.localStep(plane,1/120);
  assert.ok(damage.gone('wing_l')&&damage.gone('wing_r'));assert.equal(damage.fire,0);assert.equal(damage.broken,true);
  const revision=damage.revision;for(let i=0;i<120;i++)api.localStep(plane,1/120);assert.equal(damage.revision,revision);
});

test('procedural null identity nodes retain their neutral transform through repeated flutter poses and slowing',()=>{
  const {api,catalog}=helper(),s=telemetry(catalog.aircraft.nf01.structural.iasKmh*1.02);
  const n={part:'wing_l',local:null,visible:true};
  const plane={type:{id:'nf01',airframe:[0,0,0,11]},cur:s,pieceNodes:[n],controls:[],damage:{gone:()=>false}};
  api.beginPose(plane);api.pose(plane);assert.equal(n.local.length,16);const first=[...n.local];
  for(let i=0;i<10;i++){api.beginPose(plane);api.pose(plane);assert.deepEqual([...n.local],first);}
  const scratch=n.local;api.beginPose(plane);api.pose(plane);assert.equal(n.local,scratch,'Flutter matrix storage is reused');
  s[13]=s[14]=0;api.beginPose(plane);api.pose(plane);assert.equal(n.local,null,'Identity is restored when flutter ends');
});

test('public sensor contact projection preserves visible gear failure without carrying private stress state',()=>{
  const code=fs.readFileSync(new URL('../tools/frontline_contact_visual.js',import.meta.url),'utf8'),c=vm.createContext({});
  vm.runInContext(code,c);
  const unit={battle:1,unit:2,life:1},pos=[10,1000,50];
  const pose={unit,pos,aircraft:'nf01',team:'red',alive:true,quaternion:[0,0,0,1],gear_axes:[0,0,0,0],detached_parts:[],stores:[],gear_failed:true,
    speed:200,ground_speed:200,agl:1000,sample_time:1,pitch_surface:0,roll_surface:0,yaw_surface:0,gear:0,flap:0,airbrake:0,slat:0,
    airframe_limits:{structure_fraction:.2,gear_fraction:1,gear_failed:true}};
  const contact={unit,pos,team:'red',kind:'air',observed_alive:true,last_seen_tick:1,last_seen_at:1,status:'detected'};
  const result=c.createFrontlineContactPresentation().accept({battle:1,units:[],aircrafts:[],intel:{team:'blue',contacts:[contact],visible_ground:[],visible_aircrafts:[pose]}}).aircrafts[0];
  assert.equal(result.gear_failed,true);assert.equal(result.airframe_limits,undefined);
});

test('saturated cumulative exposure detaches both wings even when incremental HP sums leave a positive floating residual',()=>{
  const {api}=helper(),app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
  const a=app.indexOf('  var AircraftDamage = class {'),b=app.indexOf('  // NF-02: the same kinds',a),c=vm.createContext({});
  vm.runInContext(app.slice(a,b),c);
  const damage=new c.AircraftDamage([{id:'wing_l',hp:160,detach:true},{id:'wing_r',hp:160,detach:true}],[],null);
  const plane={type:{id:'p51d'},cur:telemetry(1500),damage,applyDamage(){}};
  for(let i=0;i<160;i++)api.localStep(plane,1/120);
  assert.equal(plane.airframeLimitState.structure_fraction,1);assert.equal(damage.broken,true);
  assert.ok(damage.gone('wing_l')&&damage.gone('wing_r'),'Zero HP after breakUp alone is not visible wing detachment');
});

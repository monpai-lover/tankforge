import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const file=new URL('../tools/frontline_countermeasures.js',import.meta.url);
const source=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
const load=()=>{const c=vm.createContext({console,Math,Number,Set,Map,Float64Array});vm.runInContext(source,c);return c;};
const plain=x=>JSON.parse(JSON.stringify(x));
const ref={battle:7,unit:4,life:2};
const counts=(flares=30,chaff=60,release_seq=0)=>({flares,chaff,max:{flares:30,chaff:60},release_seq,cooldown_remaining_s:0});
function controlFixture(){
  const c=load();assert.equal(typeof c.createFrontlineCountermeasureControl,'function','Native CM intent/accepted projection owner is required');
  const sent=[],sounds=[],denied=[],f={epoch:3,seq:10},unit={unit:{...ref},aircraft:'f16v',alive:true,countermeasures:counts()};
  const air={nativeAuthority:true,active:true,plane:{crashed:false,position:[0,500,0]},ctl:{cm:{program:'both',periodic:false}}};
  let now=20;
  const api=c.createFrontlineCountermeasureControl({send:x=>sent.push(plain(x)),scope:()=>({unit,epoch:f.epoch,nextSequence:()=>++f.seq}),
    now:()=>now,control:a=>a.ctl,reason:(_a,x)=>{denied.push(x);return false;},onRelease:(_a,x)=>sounds.push(plain(x))});
  return {api,air,unit,f,sent,sounds,denied,setNow:x=>{now=x;}};
}
test('native CM sends scoped intent using the shared sequence and changes no inventory before acceptance',()=>{
  const t=controlFixture();assert.equal(t.api.accept(t.air,t.unit,{tick:8,epoch:3}),true);
  const before=JSON.stringify(t.air.cm);assert.equal(t.api.action(t.air,t.unit,'cm'),true);
  assert.deepEqual(t.sent,[{op:'air_countermeasure',unit:ref,epoch:3,seq:11,kind:'both'}]);
  assert.equal(JSON.stringify(t.air.cm),before);assert.deepEqual(t.sounds,[]);
  assert.equal(t.air.cm.flares,30);assert.equal(t.air.cm.chaff,60);
});
test('accepted CM counters project to original HUD and sound only once per accepted event',()=>{
  const t=controlFixture();t.api.accept(t.air,t.unit,{tick:8,epoch:3});
  t.unit.countermeasures={...counts(28,58,1),cooldown_remaining_s:.15};t.api.accept(t.air,t.unit,{tick:9,epoch:3});
  assert.equal(t.air.cm.flares,28);assert.equal(t.air.cm.chaff,58);assert.equal(t.air.ctl.cm.readyAt,20.15);
  assert.deepEqual(t.sounds,[{seq:1,kinds:['flares','chaff']}]);
  t.api.accept(t.air,t.unit,{tick:9,epoch:3});t.api.accept(t.air,t.unit,{tick:10,epoch:3});assert.equal(t.sounds.length,1);
  t.unit.countermeasures=counts();assert.equal(t.api.accept(t.air,t.unit,{tick:7,epoch:3}),false);assert.equal(t.air.cm.flares,28);
});
test('native program and periodic controls remain UI intent, invalid/lost lives cannot spend or send',()=>{
  const t=controlFixture();t.api.accept(t.air,t.unit,{tick:8,epoch:3});
  t.api.action(t.air,t.unit,'cmProgram');assert.equal(t.air.ctl.cm.program,'flares');
  t.api.action(t.air,t.unit,'cmPeriodic');assert.equal(t.air.ctl.cm.periodic,true);
  t.api.action(t.air,t.unit,'cm');assert.equal(t.sent[0].kind,'flares');
  t.unit.alive=false;assert.equal(t.api.action(t.air,t.unit,'cm'),false);assert.equal(t.sent.length,1);
  t.unit.alive=true;t.unit.unit.life++;assert.equal(t.api.action(t.air,t.unit,'cm'),false);
  t.unit.countermeasures={...counts(),flares:-1};assert.equal(t.api.accept(t.air,t.unit,{tick:9,epoch:3}),false);
  assert.equal(t.air.cm.flares,0);assert.equal(t.air.ctl.cm.periodic,false);
});
test('life or epoch change resets accepted event sound history and missing counters grant no stock',()=>{
  const t=controlFixture();t.api.accept(t.air,t.unit,{tick:8,epoch:3});
  t.unit.unit.life++;t.unit.countermeasures=counts(30,60,5);t.api.accept(t.air,t.unit,{tick:9,epoch:3});assert.equal(t.sounds.length,0);
  t.f.epoch=4;t.unit.countermeasures=counts(28,58,6);t.api.accept(t.air,t.unit,{tick:10,epoch:4});assert.equal(t.sounds.length,0);
  delete t.unit.countermeasures;assert.equal(t.api.accept(t.air,t.unit,{tick:11,epoch:4}),false);assert.equal(t.air.cm.max.flares,0);
  t.api.clear();assert.equal(t.air.ctl.cm.periodic,false);
});

const decoy=(id=1,kind='flares')=>({id,kind,pos:[1,2,3],velocity:[10,0,0],age:.2,ttl:4});
function visualFixture(options={}){const c=load();assert.equal(typeof c.createFrontlineCountermeasureVisual,'function','Accepted CM visual pool is required');return c.createFrontlineCountermeasureVisual(options);}
const meta=(tick=1,battle=7,time=20)=>({battle,tick,time});
const unit=(rows=[decoy()],identity=ref)=>({unit:{...identity},decoys:rows});
const camera={pos:[0,0,0],right:[1,0,0],up:[0,1,0]},scene={mode:'battle',time:20};
test('bounded visuals draw only accepted filtered per-life decoys and never feed local seeker lists',()=>{
  const api=visualFixture({maxEntries:2}),buffer=new Float32Array(9*6*4);
  assert.equal(api.accept([unit([decoy(1),decoy(2,'chaff'),decoy(3)])],meta()),true);assert.equal(api.stats.live,2);
  assert.equal(api.write(buffer,0,camera,scene,'flares'),6);assert.equal(api.write(buffer,0,camera,scene,'chaff'),6);
  assert.equal(api.stats.capped,1);assert.ok(buffer.every(Number.isFinite));assert.equal(api.localDecoys,undefined);
  assert.equal(api.accept([unit([])],meta(2)),true);assert.equal(api.stats.live,0);
});
test('visuals reject stale/malformed frames, isolate life identity, and clear on hangar or stale time',()=>{
  const api=visualFixture(),buffer=new Float32Array(9*6*4);api.accept([unit()],meta());
  assert.equal(api.accept([unit([])],meta(0)),false);assert.equal(api.stats.live,1);
  assert.equal(api.accept([unit([{...decoy(),pos:[NaN,2,3]}])],meta(2)),false);assert.equal(api.stats.live,0);
  api.accept([unit()],meta(3));api.accept([unit([decoy(1)],{...ref,life:3})],meta(4));assert.equal(api.stats.live,1);
  assert.equal(api.write(buffer,0,camera,{mode:'garage',time:20},'flares'),0);assert.equal(api.stats.live,0);
  api.accept([unit()],meta(5));assert.equal(api.write(buffer,0,camera,{mode:'battle',time:21},'flares'),0);assert.equal(api.stats.live,0);
});
test('visual interpolation is cosmetic, bounded and expires at accepted TTL',()=>{
  const api=visualFixture(),buffer=new Float32Array(9*6*2);api.accept([unit([{...decoy(),age:3.99,ttl:4}])],meta());
  assert.equal(api.write(buffer,0,camera,{mode:'battle',time:20.02},'flares'),0);
  api.accept([unit()],meta(2));assert.equal(api.write(buffer,0,camera,{mode:'battle',time:20.1},'flares'),6);
  const xs=Array.from({length:6},(_,i)=>buffer[i*9]);assert.ok(Math.abs((Math.max(...xs)+Math.min(...xs))/2-2)<1e-5);
  assert.equal(api.write(new Float32Array(9*5),0,camera,scene,'flares'),0,'Never overrun shared GPU arrays');
});

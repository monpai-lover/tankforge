import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const app=fs.readFileSync(process.env.TG_R8_APP||new URL('../bundle/app.js.html',import.meta.url),'utf8');
const between=(a,b)=>{const i=app.indexOf(a),j=app.indexOf(b,i+a.length);assert.ok(i>=0&&j>i,a);return app.slice(i,j);};
const helpers=app.includes('// BEGIN AAM REALISM BUDGET')?between('// BEGIN AAM REALISM BUDGET','// END AAM REALISM BUDGET'):'';
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),norm=a=>a.map(v=>v/(Math.hypot(...a)||1));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],angleOf=(a,b)=>Math.acos(Math.max(-1,Math.min(1,dot(norm(a),norm(b)))));
const sees=new Function('sub','angleOf','targetAlive','airTargetPos','airTargetVel','airLos','enemyPoint','D2R',helpers+between('    function missileSees(o, t,','    /** The launcher\'s radar still tracking')+';return missileSees;')(
  sub,angleOf,()=>true,t=>t.pos,t=>t.vel,()=>true,t=>t.pos,Math.PI/180);
const flight=between('          const p0 = o.pos.slice(), d = o.def, sp = Math.hypot(...o.vel) || 1, rho = AIR_RHO(o.pos[1]);','          for (let j = 0; j < 3; j++) o.pos[j] += o.vel[j] * h;');
const step=new Function('o','target','sub','cross','dot','AIR_RHO',helpers+'const G3=9.80665,h=1/120;const missileGuide=()=>target;'+flight+';return o.vel;');
const budget=helpers?new Function(helpers+';return TF_AAM_REALISM;')():null;
test('rear-aspect seeker does not receive a fresh front-aspect observation after launch',()=>{
  const o={def:{kind:'aam',guidance:'ir',rear:true,gimbal:25,lockRange:3500},pos:[0,1000,0],vel:[0,0,500]};
  assert.equal(sees(o,{pos:[0,1000,1000],vel:[0,0,-200]}),null);
});
test('catalog tracking-rate limit remains active after launch',()=>{
  const o={def:{kind:'aam',guidance:'ir',gimbal:45,lockRange:10000,seeker:{trackRate:5}},pos:[0,1000,0],vel:[0,0,500]};
  assert.equal(sees(o,{pos:[0,1000,1000],vel:[300,0,0]}),null);
});
test('same-speed sharp maneuver spends more energy than straight supported flight',()=>{
  const make=()=>({kind:'aam',def:{kind:'aam',mass:105,d:.17,tailFins:.51,burn:4.5,dv:800,maxG:40},pos:[0,1000,0],vel:[0,0,500],dir:[0,0,1],t:10});
  const straight=Math.hypot(...step(make(),{p:[0,1000,3000],v:[0,0,200]},sub,cross,dot,()=>1.225));
  const turn=Math.hypot(...step(make(),{p:[1000,1000,1000],v:[300,0,0]},sub,cross,dot,()=>1.225));
  assert.ok(turn<straight-.01,`maneuver must spend energy: turning=${turn}, straight=${straight}`);
});
test('available force decreases with airspeed and density without a zero-speed singularity',{skip:!budget},()=>{
  const d={mass:105,d:.17,tailFins:.51,maxG:40},request=[392.266,0,0];
  const slow=budget.budget(d,1,100,request),fast=budget.budget(d,1,400,request),thin=budget.budget(d,.2,400,request),zero=budget.budget(d,1,0,request);
  assert.ok(slow.availableG<fast.availableG&&thin.availableG<fast.availableG);
  assert.deepEqual(zero.accel,[0,0,0]);assert.equal(zero.drag,0);assert.equal(zero.availableG,0);
});
test('accepted decoys retain their own observation path rather than gaining aircraft tail-aspect rules',{skip:!budget},()=>{
  const d={kind:'aam',guidance:'ir',rear:true,lockRange:3500};
  assert.equal(budget.observationAllowed(d,[0,0,0],[0,0,500],[0,0,500],[0,0,0],true),true);
});
test('known thrust-vector families keep bounded low-q motor control and pay axial thrust diversion',{skip:!budget},()=>{
  const d={kind:'aam',model:'aim9x',mass:85,d:.127,tailFins:.45,maxG:50},request=[200,0,0];
  const burn=budget.budget(d,1,0,request,160),coast=budget.budget(d,1,0,request,0),ordinary=budget.budget({...d,model:'aim9m'},1,0,request,160);
  assert.ok(burn.availableG>0&&burn.availableG<=50);assert.ok(Math.hypot(...burn.accel)<=160*.2+1e-9);
  assert.ok(burn.drag>0&&burn.drag<160,'vector force must divert the same motor thrust');
  assert.equal(coast.availableG,0);assert.equal(ordinary.availableG,0);
});
test('JS flight budget matches the shared native golden fixtures',{skip:!budget},()=>{
  const fixtures=JSON.parse(fs.readFileSync(new URL('../qa/aam-budget-fixtures-20261027.json',import.meta.url),'utf8'));
  for(const f of fixtures){const got=budget.budget(f.def,f.rho,f.speed,f.request,f.motor);
    assert.ok(Math.abs(got.availableG-f.availableG)<1e-9,f.name+' available force');
    assert.ok(Math.abs(Math.hypot(...got.accel)-f.normalAcceleration)<1e-9,f.name+' normal force');
    assert.ok(Math.abs(got.drag-f.dragAcceleration)<1e-9,f.name+' energy cost');
  }
});

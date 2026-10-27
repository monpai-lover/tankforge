import fs from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {review} from '../tools/penetration_sealed_plan.mjs';
import {constructorFeatures} from '../tools/penetration_features.mjs';

const id='de_sdkfz234_2',root=new URL('../../',import.meta.url);
const bytes=fs.readFileSync(new URL(`data/vehicles/${id}/visual.json`,root));
const visual=JSON.parse(bytes),armor=JSON.parse(fs.readFileSync(new URL(`data/vehicles/${id}/armor.json`,root)));
assert.equal(createHash('sha256').update(bytes).digest('hex'),'b94fb3fd7e56c3d872b08a99719f29539f998aab8317ff3342ea12ec513ce047','Reviewed literal source revision');

test('Puma ordinary side chamfer and mantlet rear cap use existing authored armor',()=>{
  assert.equal(review(id,10,'plan:edge:1',visual.parts[10])?.armorRef,'turret_side_r');
  assert.deepEqual(review(id,11,'cyl:sector:0:negative_cap',visual.parts[11]),{armorRef:'gun_mantlet',boundarySide:'inner'});
});

test('Puma source review resolves 78 previously unsupported triangles and preserves four seam slivers',()=>{
  const wasUnsupported=(ordinal,feature)=>ordinal===0?/^prism:edge:[2345]$/.test(feature):
    ordinal===1?/^prism:edge:[046]$/.test(feature):
    ordinal===10?/^plan:bottom:|^plan:edge:[1357]$/.test(feature):
    ordinal===11?/:outer$|:negative_cap$/.test(feature):false;
  let reviewed=0,unresolved=0;
  for(const ordinal of [0,1,10,11])for(const f of constructorFeatures(visual.parts[ordinal])){
    if(!wasUnsupported(ordinal,f.feature))continue;
    const r=review(id,ordinal,f.feature,visual.parts[ordinal]);
    if(!r){assert.ok(ordinal===0&&f.feature==='prism:edge:3'||ordinal===1&&f.feature==='prism:edge:0');unresolved+=f.count;continue;}
    reviewed+=f.count;
    if(r.armorRef)assert.ok(armor.some(p=>p.id===r.armorRef),'Existing engineering only: '+r.armorRef);
    else{assert.equal(ordinal,10);assert.match(f.feature,/^plan:bottom:/);assert.equal(r.decoration,true);assert.ok(r.reason);}
  }
  assert.equal(reviewed,78);assert.equal(unresolved,4);
  assert.equal(review(id,0,'prism:edge:3',visual.parts[0]),null);
  assert.equal(review(id,1,'prism:edge:0',visual.parts[1]),null);
});

test('Puma turret floor is covered by the closed source roof while hull closures have exposed slivers',()=>{
  const [lower,upper]=visual.parts,turret=visual.parts[10];
  assert.equal(turret.y0,1.79);
  assert.deepEqual(upper.profile.slice(3,5),[[1.92,1.79],[-.35,1.79]]);
  assert.equal(upper.wt/2,.81);
  assert.ok(turret.outline.every(([x,z])=>Math.abs(x)<=.81&&z>=-.35&&z<=1.92));
  assert.deepEqual(lower.profile.slice(3,5),upper.profile.slice(0,2).reverse());
  const half=(p,y)=>{const ys=p.profile.map(p=>p[1]),lo=Math.min(...ys),hi=Math.max(...ys);return(p.w+(p.wt-p.w)*(y-lo)/(hi-lo))/2;};
  assert.ok(half(upper,1.06)>half(lower,1.06));
  assert.ok(half(lower,1.17)>half(upper,1.17));
});

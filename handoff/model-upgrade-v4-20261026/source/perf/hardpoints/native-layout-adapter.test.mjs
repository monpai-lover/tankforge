import assert from'node:assert/strict';import fs from'node:fs';import{applySpawnLayout}from'./native-layout-adapter.mjs';
const map=JSON.parse(fs.readFileSync(new URL('./native-layout-map.json',import.meta.url)));let layouts=0,stores=0;
for(const[aircraft,m]of Object.entries(map.models))for(const preset of m.presets){
 const items=preset.items.map(q=>({id:q.id,count:q.count,owner:q.previousOwner,p:q.previousP.slice(),fuel:100,arbitraryGameplayState:{x:1}}));const old=JSON.stringify(items);
 const input={aircraft,sourceMain:m.sourceMain,geometryFingerprint:m.proceduralGeometry,phase:'spawn_layout',items},r=applySpawnLayout(input,map);assert(r.applied);
 assert.equal(JSON.stringify(items),old,'Input accepted/gameplay state not mutated');
 r.items.forEach((it,i)=>{const q=preset.items[i];assert.deepEqual(it.p,q.revisedP);assert.equal(it.owner,q.revisedOwner);if(q.storeRotation)assert.deepEqual(it.storeRotation,q.storeRotation);assert.equal(it.id,items[i].id);assert.equal(it.count,items[i].count);assert.equal(it.fuel,100);assert.equal(it.arbitraryGameplayState,items[i].arbitraryGameplayState);});
 assert.equal(applySpawnLayout({...input,items:r.items},map).reason,'Already calibrated');
 if(preset.items.every(q=>q.previousCalibratedP)){
  const calibrated=items.map((it,i)=>({...it,owner:preset.items[i].previousCalibratedOwner,p:preset.items[i].previousCalibratedP.slice()}));
  const upgraded=applySpawnLayout({...input,items:calibrated},map);
  assert(upgraded.applied||upgraded.reason==='Already calibrated');
  const result=upgraded.applied?upgraded.items:calibrated;
  result.forEach((it,i)=>{assert.deepEqual(it.p,preset.items[i].revisedP);if(preset.items[i].storeRotation)assert.deepEqual(it.storeRotation,preset.items[i].storeRotation);});
 }
 assert(!applySpawnLayout({...input,sourceMain:'different'},map).applied);assert(!applySpawnLayout({...input,phase:'live_snapshot'},map).applied);
 if(m.proceduralGeometry){assert(!applySpawnLayout({...input,geometryFingerprint:undefined},map).applied);assert(!applySpawnLayout({...input,geometryFingerprint:{...m.proceduralGeometry,body:'changed'}},map).applied);}
 for(const malformed of[items.slice(1),items.map((it,i)=>i?it:{...it,id:'unknown'}),items.map((it,i)=>i?it:{...it,p:[999,0,0]}),items.map((it,i)=>i?it:{...it,owner:'unknown'}),items.map((it,i)=>i?it:{...it,count:it.count+1})])assert(!applySpawnLayout({...input,items:malformed},map).applied);
 assert(!applySpawnLayout({...input,items:items.map((it,i)=>i?it:{...it,storeRotation:[NaN,0,0,1]})},map).applied);
 layouts++;stores+=items.length;
}
console.log(JSON.stringify({ok:true,layouts,stores,scope:'Portable initial-layout integration only; current native server untouched'}));

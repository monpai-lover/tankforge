import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {patchR8SurfaceShaders,extractR8ShaderSources} from '../tools/patch_r8_surface_shaders.mjs';
const original=fs.readFileSync(new URL('../tools/test/fixtures/r8-original-shader-app.js.html',import.meta.url),'utf8');
const baseline=patchR8SurfaceShaders(original);
let module={};try{module=await import('../tools/patch_r85_water.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const patch=module.patchR85Water||((s)=>s),sample=module.sampleR85Water;
const result=patch(baseline);
const between=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i+a.length);assert.ok(i>=0&&j>i);return s.slice(i,j);};
test('ocean adapts the attributed exponential kernel and filters the pixel footprint',()=>{
 assert.match(result,/afl_ext 2017-2024/);assert.match(result,/MIT/);
 assert.match(result,/Permission is hereby granted, free of charge/,'standalone HTML must retain the full permission notice');
 assert.match(result,/tfR85Ocean/);assert.match(result,/exp\(sin\(phase\) - 1\.0\)/);
 assert.match(result,/pixelDx = dFdx\(p\), pixelDy = dFdy\(p\)/);assert.match(result,/for \(int octave = 0; octave < 8;/);
 assert.doesNotMatch(between(result,'vec2 tfR85Ocean(', '\nfloat shadow()'),/\bfwidth\s*\(/,'feedback must not differentiate an earlier derivative');
 assert.doesNotMatch(result,/float raymarchwater\(/);
});
test('water patch preserves geometry, uniforms, all non-water materials and tone mapping',()=>{
 const lit=s=>between(s,'  var litFS = (defs) => `','\n  var DEPTH_VS =');
 assert.notEqual(lit(result),lit(baseline));assert.equal(result.replace(lit(result),''),baseline.replace(lit(baseline),''));
 assert.deepEqual(lit(result).match(/^uniform .*$/gm),lit(baseline).match(/^uniform .*$/gm));
 for(const [a,b]of[['  } else if (uKind == 2 || uKind == 20) {','  } else if (uKind == 7 || uKind == 22) {'],['  } else if (uKind == 11) {','  vec3 L = normalize(uSunDir);'],['  } else if (uKind == 17) {','    col = mix(col, uHighlight.rgb']]) assert.equal(between(result,a,b),between(baseline,a,b));
 assert.ok(result.includes('wdepth = uKind == 22 ? 6.0 : (uMapOn > 0.5 ? max(0.0, -mapHeight(p)) : 6.0);'));
 assert.ok(result.includes('if (uKind == 22) alpha = 1.0;'));
 const variants=extractR8ShaderSources(result);assert.ok(variants.fragmentHDR.startsWith('#version 300 es'));assert.ok(variants.fragmentFallback.includes('#define ENC(c) sqrt'));
});
test('ocean patch is idempotent and rejects missing or ambiguous protected anchors',()=>{
 assert.equal(typeof module.patchR85Water,'function');assert.equal(patch(result),result);
 assert.throws(()=>patch(''),/shader|anchor|water/i);assert.throws(()=>patch(baseline+baseline),/unique|anchor|water/i);
 assert.throws(()=>patch(baseline.replace('rough = mix(0.09, 0.125, unresolved);','rough = 0.04;')),/anchor|water/i);
});
test('normals stay normalized and bounded at theatre coordinates, and waves evolve',()=>{
 assert.equal(typeof sample,'function');let changed=0,samples=0;
 for(const x of[-1e6,-27000,-5,0,17770,1e6])for(const z of[-27000,0,19999])for(const t of[0,0.016,123,1e6]){
  const a=sample(x,z,t,[.01,0],[0,.01]),b=sample(x,z,t+.5,[.01,0],[0,.01]);
  assert.ok(a.normal.every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...a.normal)-1)<1e-12);assert.ok(Math.hypot(...a.gradient)<=.28000001);
  assert.ok(a.roughness>=.16&&a.roughness<=.32000001);changed+=Math.hypot(...a.gradient.map((v,i)=>v-b.gradient[i]))>1e-5;samples++;
 }assert.equal(changed,samples,'Every sampled resolved surface must evolve');
});
test('unresolved waves vanish smoothly instead of aliasing at grazing or distant views',()=>{
 assert.equal(typeof sample,'function');
 const coarse=sample(1290,-781,20,[1e4,0],[0,1e4]);assert.deepEqual(coarse.gradient,[0,0]);assert.deepEqual(coarse.normal,[0,1,0]);assert.ok(Math.abs(coarse.roughness-.32)<1e-12);
 for(const bad of[NaN,Infinity,-Infinity])assert.throws(()=>sample(bad,0,0,[0,0],[0,0]),/finite/i);
});

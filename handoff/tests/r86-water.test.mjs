import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {patchR8SurfaceShaders,extractR8ShaderSources} from '../tools/patch_r8_surface_shaders.mjs';
import {patchR85Water} from '../tools/patch_r85_water.mjs';

const original=fs.readFileSync(new URL('../tools/test/fixtures/r8-original-shader-app.js.html',import.meta.url),'utf8');
const baseline=patchR85Water(patchR8SurfaceShaders(original));
let module={};try{module=await import('../tools/patch_r86_water.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const patch=module.patchR86Water||((source)=>source),normalize=module.normalizeR86Water||((source)=>source),sample=module.sampleR86Water;
const result=patch(baseline);
const between=(source,a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i+a.length);assert.ok(i>=0&&j>i,`${a} / ${b}`);return source.slice(i,j);};

test('the supplied source bytes and noncommercial license notice are preserved',()=>{
 const source=fs.readFileSync(new URL('../../docs/third-party/frank-hugenroth-water-reference.glsl',import.meta.url));
 assert.equal(source.length,9794);assert.equal(createHash('sha256').update(source).digest('hex'),'14804fe126af4f1e5ce3881611d5bca15c847bfcdf3cc6ed7db81e9f37c42261');
 const notice=fs.readFileSync(new URL('../../docs/third-party/frank-hugenroth-water-LICENSE.txt',import.meta.url),'utf8');
 assert.match(notice,/Frank Hugenroth/);assert.match(notice,/Attribution-NonCommercial-ShareAlike 3\.0/);
 assert.match(notice,/https:\/\/creativecommons\.org\/licenses\/by-nc-sa\/3\.0\//);
});

test('new water uses the user-supplied crossing-wave and choppy-noise source with its actual license',()=>{
 assert.match(result,/TF_R86_WATER_BEGIN/);assert.match(result,/Frank Hugenroth/);
 assert.match(result,/Attribution-NonCommercial-ShareAlike 3\.0/);
 assert.match(result,/https:\/\/creativecommons\.org\/licenses\/by-nc-sa\/3\.0\//);
 assert.match(result,/tfR86Ocean\(p, unresolved, crest\)/);
 assert.match(result,/vec2\(0\.0172, 0\.010\)/);assert.match(result,/vec2\(0\.02221, 0\.01233\)/);
 assert.match(result,/octave < 4/);assert.match(result,/octave < 7/);
 const helper=between(result,'// TF_R86_WATER_BEGIN','// TF_R86_WATER_END');
 assert.match(helper,/pixelDx = dFdx\(p\), pixelDy = dFdy\(p\)/);
 assert.doesNotMatch(helper,/\bfwidth\(|texture\(|textureLod\(|trace_fog|mainImage|raymarch/i);
 assert.match(result,/TF_R86_WATER_OPTICS_BEGIN/);assert.match(result,/pow\(sunReflection, 10\.0\)/);
});

test('water normalization restores byte-exact R85 and scoped patching is idempotent',()=>{
 assert.equal(typeof module.patchR86Water,'function');assert.equal(typeof module.normalizeR86Water,'function');
 assert.equal(normalize(baseline),baseline);assert.equal(patch(result),result);assert.equal(normalize(result),baseline);
 assert.equal(normalize(normalize(result)),baseline);
 assert.throws(()=>patch(''),/shader|water|anchor/i);assert.throws(()=>patch(baseline+baseline),/unique|shader|water/i);
 assert.throws(()=>patch(baseline.replace('rough = mix(0.16, 0.32, unresolved);','rough = 0.02;')),/anchor|water/i);
 assert.throws(()=>normalize(result.replace('// TF_R86_WATER_END','// MISSING_END')),/anchor|water/i);
});

test('water patch and normalizer preserve uniform CRLF around legacy composers',()=>{
 const before=baseline.replaceAll('\n','\r\n');
 assert.equal(normalize(result.replaceAll('\n','\r\n')),before);
 const after=patch(before);
 assert.equal(/(?<!\r)\n/.test(after),false);
 assert.equal(normalize(after),before);assert.equal(patch(after),after);
 assert.equal(after.replaceAll('\r\n','\n'),result);
});

test('only water fragment blocks change, with no geometry, sampler, uniform or status material change',()=>{
 const lit=source=>between(source,'  var litFS = (defs) => `','\n  var DEPTH_VS =');
 assert.notEqual(lit(result),lit(baseline));assert.equal(result.replace(lit(result),''),baseline.replace(lit(baseline),''));
 assert.deepEqual(lit(result).match(/^uniform .*$/gm),lit(baseline).match(/^uniform .*$/gm));
 for(const [a,b]of[
  ['  } else if (uKind == 2 || uKind == 20) {','  } else if (uKind == 7 || uKind == 22) {'],
  ['  } else if (uKind == 11) {','  vec3 L = normalize(uSunDir);'],
  ['  } else if (uKind == 17) {','    col = mix(col, uHighlight.rgb']
 ]) assert.equal(between(result,a,b),between(baseline,a,b));
 assert.ok(result.includes('wdepth = uKind == 22 ? 6.0 : (uMapOn > 0.5 ? max(0.0, -mapHeight(p)) : 6.0);'));
 assert.ok(result.includes('if (uKind == 22) alpha = 1.0;'));
 const variants=extractR8ShaderSources(result);assert.ok(variants.fragmentHDR.startsWith('#version 300 es'));assert.ok(variants.fragmentFallback.includes('#define ENC(c) sqrt'));
});

test('analytic crossing-wave, fBm and choppy-wave gradients match height differences',()=>{
 assert.equal(typeof sample,'function');
 for(const [x,z,time]of[[12.123,-75.51,0],[150.31,421.33,12.4],[-13012.5,26123.7,344],[100000.1,-99999.3,1000000]]){
  const a=sample(x,z,time,[0,0],[0,0]),epsilon=.001;
  const gx=(sample(x+epsilon,z,time,[0,0],[0,0]).height-sample(x-epsilon,z,time,[0,0],[0,0]).height)/(2*epsilon);
  const gz=(sample(x,z+epsilon,time,[0,0],[0,0]).height-sample(x,z-epsilon,time,[0,0],[0,0]).height)/(2*epsilon);
  assert.ok(Math.abs(a.rawGradient[0]-gx)<.0004,`${x}/${z} x derivative ${a.rawGradient[0]} / ${gx}`);
  assert.ok(Math.abs(a.rawGradient[1]-gz)<.0004,`${x}/${z} z derivative ${a.rawGradient[1]} / ${gz}`);
 }
});

test('normals stay finite and bounded at theatre coordinates while the surface evolves',()=>{
 assert.equal(typeof sample,'function');let changed=0,count=0;
 for(const x of[-1e6,-27000,-5,0,17770,1e6])for(const z of[-27000,0,19999])for(const time of[0,.016,123,1e6]){
  const a=sample(x,z,time,[.01,0],[0,.01]),b=sample(x,z,time+.5,[.01,0],[0,.01]);
  assert.ok([...a.normal,...a.gradient,a.unresolved,a.crest,a.roughness].every(Number.isFinite));
  assert.ok(Math.abs(Math.hypot(...a.normal)-1)<1e-12);assert.ok(Math.hypot(...a.gradient)<=.45000001);
  assert.ok(a.roughness>=.13&&a.roughness<=.30000001);assert.ok(a.unresolved>=0&&a.unresolved<=1);
  changed+=Math.hypot(...a.gradient.map((v,i)=>v-b.gradient[i]))>1e-6;count++;
 }assert.equal(changed,count);
});

test('pixel-unresolved waves vanish rather than glittering at the horizon',()=>{
 assert.equal(typeof sample,'function');const a=sample(1290,-781,20,[1e7,0],[0,1e7]);
 assert.deepEqual(a.gradient,[0,0]);assert.deepEqual(a.normal,[0,1,0]);assert.equal(a.unresolved,1);assert.ok(Math.abs(a.roughness-.30)<1e-12);
 for(const bad of[NaN,Infinity,-Infinity])assert.throws(()=>sample(bad,0,0,[0,0],[0,0]),/finite/i);
});

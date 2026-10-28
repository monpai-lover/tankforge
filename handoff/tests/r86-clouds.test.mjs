import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const baseline=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
let module={};try{module=await import('../tools/patch_r86_clouds.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const patch=module.patchR86Clouds||((source)=>source),normalize=module.normalizeR86Clouds||((source)=>source);
const result=patch(baseline);
const between=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i+a.length);assert.ok(i>=0&&j>i,`${a}/${b}`);return s.slice(i,j);};

test('original cloud refinement reuses existing channels and retains bounded renderer work',()=>{
 assert.match(result,/TF_R86_CLOUDS_BEGIN/);assert.match(result,/TF_R86_CLOUD_LIGHTING_BEGIN/);
 assert.match(result,/shape\.a/);assert.match(result,/relativeDensity/);assert.match(result,/silverRim/);
 const chunk=between(result,'  var CLOUDS = `','\n  var DOME_LOOKUP =');
 assert.equal((chunk.match(/textureLod\(/g)||[]).length,3,'reuse channels from the same three density lookups');
 assert.match(chunk,/CLOUD_BASE = 1500\.0/);assert.match(chunk,/CLOUD_TOP = 3400\.0/);
 const dome=between(result,'  var domeFS =','\n  var LIT_VS =');
 for(const n of[48,5,3])assert.ok(dome.includes(`< ${n};`));
 assert.doesNotMatch(chunk+dome,/iResolution|iTime|fragColor|Cineshader|< 500|map[2345]\(/);
});

test('cloud patch is protected, reversible, idempotent and uniform CRLF safe',()=>{
 assert.equal(typeof module.patchR86Clouds,'function');assert.equal(typeof module.normalizeR86Clouds,'function');
 for(const eol of['\n','\r\n']){
  const before=normalize(baseline).replaceAll('\r\n','\n').replaceAll('\n',eol),after=patch(before);
  assert.equal(patch(after),after);assert.equal(normalize(after),before);assert.equal(normalize(normalize(after)),before);
  if(eol==='\r\n')assert.equal(/(?<!\r)\n/.test(after),false);
 }
 assert.throws(()=>patch(''),/cloud|anchor|shader/i);
 assert.throws(()=>patch(normalize(baseline).replace('float dens = cloudDensity(pos, alt, 0.0);','float dens = 0.0;')),/cloud|anchor|shader/i);
 assert.throws(()=>normalize(result.replace('// TF_R86_CLOUDS_END','// PARTIAL_CLOUD_END')),/cloud|anchor|shader/i);
});

test('alpha remains cloud transmittance, with explicit opacity complement rather than a Cineshader replacement',()=>{
 assert.match(result,/float cloudOpacity = clamp\(1\.0 - T, 0\.0, 1\.0\)/);
 assert.match(result,/T = 1\.0 - cloudOpacity/);assert.match(result,/vec4 cur = vec4\(sky \* T \+ L, T\)/);
 const sky=between(result,'  var skyFS =','\n  var FX_VS =');
 assert.ok(sky.includes('float T = 1.0 - cloudOpacity;'));assert.ok(sky.includes('outColor = vec4(ENC(col), 1.0);'));
 assert.ok(result.includes('cur = mix(vec4(DEC(prev.rgb), prev.a), cur, uBlend);'));
 assert.ok(result.includes('outColor = vec4(ENC(cur.rgb), clamp(cur.a, 0.0, 1.0));'));
});

test('density and erosion remain finite, bounded, coherent at layer edges and zero extinction',()=>{
 assert.equal(typeof module.sampleR86CloudDensity,'function');const sample=module.sampleR86CloudDensity;
 for(const altitude of[-1000,0,1499,1500,1501,1600,2100,2700,3399,3400,10000])for(const extinction of[0,.001,.022])for(const coverage of[0,.3,1])for(const base of[0,.5,1]){
  const args={altitude,extinction,coverage,base,cells:.7,detail:.65,weather:.8,erosion:.55};
  const fine=sample(args),cheap=sample({...args,cheap:true});assert.ok(Number.isFinite(fine)&&Number.isFinite(cheap));
  assert.ok(fine>=0&&fine<=extinction);assert.ok(cheap>=fine-1e-12&&cheap<=extinction);
  if(altitude<=1500||altitude>=3400||extinction===0)assert.equal(fine,0);
 }
 const args={extinction:.022,coverage:.85,base:.95,cells:.9,detail:.1,weather:.8,erosion:.4};
 assert.ok(sample({...args,altitude:2200})>sample({...args,altitude:1501}));
 assert.ok(sample({...args,altitude:2200})>sample({...args,altitude:3399}));
});

test('upward cloud bounds use actual camera altitude below, inside and above the existing layer',()=>{
 assert.equal(typeof module.cloudR86UpwardInterval,'function');const interval=module.cloudR86UpwardInterval,R=6371000;
 for(const cameraHeight of[-100,0,650,1499,1500,2100,3399.9])for(const verticalDirection of[.02,.2,1]){
  const hit=interval(cameraHeight,verticalDirection);assert.ok(hit&&Number.isFinite(hit.near)&&Number.isFinite(hit.far));assert.ok(hit.near>=0&&hit.far>hit.near);
  const altitude=t=>Math.sqrt((R+cameraHeight)**2+2*(R+cameraHeight)*verticalDirection*t+t*t)-R;
  assert.ok(Math.abs(altitude(hit.far)-3400)<1e-6);
  if(cameraHeight<1500)assert.ok(Math.abs(altitude(hit.near)-1500)<1e-6);else assert.equal(hit.near,0);
 }
 for(const height of[3400,8000,10000])assert.equal(interval(height,.5),null);
 for(const dy of[-1,0,.012])assert.equal(interval(650,dy),null);
 for(const bad of[NaN,Infinity])assert.throws(()=>interval(bad,.5),/finite/i);
 assert.match(result,/TF_R86_CLOUD_ALTITUDE_BEGIN/);assert.ok(result.includes('(CLOUD_BASE - uCamPos.y) * (2.0 * R_PLANET + CLOUD_BASE + uCamPos.y)'));
});

test('front-to-back opacity agrees with Beer-Lambert and is invariant to a homogeneous segment split',()=>{
 assert.equal(typeof module.integrateR86CloudSegments,'function');const integrate=module.integrateR86CloudSegments,sky=[.2,.4,.8];
 const clear=integrate([{extinction:0,length:1000,source:[1,1,1]}],sky);assert.deepEqual(clear.color,sky);assert.equal(clear.transmittance,1);assert.equal(clear.opacity,0);
 const thick=integrate([{extinction:.015,length:350,source:[.7,.8,1]}],sky),split=integrate(Array.from({length:7},()=>({extinction:.015,length:50,source:[.7,.8,1]})),sky);
 assert.ok(Math.abs(thick.transmittance-Math.exp(-.015*350))<1e-12);
 assert.ok(Math.abs(thick.opacity+thick.transmittance-1)<1e-12);
 for(let i=0;i<3;i++)assert.ok(Math.abs(thick.color[i]-split.color[i])<1e-12);
 assert.ok(thick.opacity>.99&&thick.opacity<=1);
 for(const bad of[NaN,Infinity,-Infinity])assert.throws(()=>integrate([{extinction:bad,length:1,source:[1,1,1]}],sky),/finite/i);
});

test('actual cloud shader export retains HDR/fallback dome and sky contracts without adding resources',()=>{
 assert.equal(typeof module.extractR86CloudShaderSources,'function');const sources=module.extractR86CloudShaderSources(result);
 for(const n of['vertex','domeHDR','domeFallback','skyHDR','skyFallback'])assert.ok(sources[n].startsWith('#version 300 es'));
 assert.ok(sources.domeFallback.includes('#define ENC(c) sqrt'));assert.ok(sources.domeHDR.includes('#define ENC(c) (c)'));
 const cloud=s=>between(s,'  var CLOUDS = `','\n  var DOME_LOOKUP ='),dome=s=>between(s,'  var domeFS =','\n  var LIT_VS ='),sky=s=>between(s,'  var skyFS =','\n  var FX_VS =');
 const strip=s=>s.replace(cloud(s),'CLOUD_OWNER').replace(dome(s),'DOME_OWNER').replace(sky(s),'SKY_OWNER');
 assert.equal(strip(result),strip(normalize(baseline)),'renderer/tile scheduling, water, materials and other owners stay byte-identical');
 assert.deepEqual(result.match(/^uniform .*$/gm),normalize(baseline).match(/^uniform .*$/gm));
});

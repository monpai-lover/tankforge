import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';

const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const appPath = process.env.TF_SHADER_TEST_APP || fileURLToPath(new URL('./fixtures/r8-original-shader-app.js.html', import.meta.url));
const patcherPath = `${sourceRoot}/handoff/tools/patch_r8_surface_shaders.mjs`;
const baseline = await readFile(appPath, 'utf8');
let patcher = {};
try { patcher = await import(pathToFileURL(patcherPath)); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const apply = process.env.TF_SHADER_BASELINE === '1' ? s => s : patcher.patchR8SurfaceShaders || (s => s);
const candidate = apply(baseline);

function section(source, begin, end) {
  const a = source.indexOf(begin);
  assert.ok(a >= 0, `missing start anchor: ${begin.slice(0, 60)}`);
  const b = source.indexOf(end, a + begin.length);
  assert.ok(b > a, `missing end anchor: ${end.slice(0, 60)}`);
  return source.slice(a, b);
}
function shader(source) { return section(source, '  var litFS = (defs) => `', '\n  var DEPTH_VS ='); }
const oldLit = shader(baseline), newLit = shader(candidate);
const terrainBegin = '  } else if (uKind == 2 || uKind == 20) {';
const waterBegin = '  } else if (uKind == 7 || uKind == 22) {';
const buildingBegin = '  } else if (uKind == 11) {';
const newTerrain = section(newLit, terrainBegin, waterBegin);
const newWater = section(newLit, waterBegin, buildingBegin);

test('terrain detail is screen-footprint filtered and perturbs lighting normals without vertex displacement', () => {
  assert.match(newTerrain, /float grainFilter\s*=.*smoothstep\(0\.35, 0\.85, foot \* 6\.0\)/, 'close terrain detail must filter at subpixel scales');
  assert.match(newTerrain, /N = bump\(N, vWorld, detailHeight, 1\.0\)/, 'terrain must have near surface normal relief');
  assert.match(newTerrain, /float steep = smoothstep\(0\.18, 0\.58, 1\.0 - abs\(N\.y\)\)/, 'slope affects terrain material');
  assert.equal(candidate.slice(0, candidate.indexOf('  var litFS =')), baseline.slice(0, baseline.indexOf('  var litFS =')), 'all preceding helpers and vertex shaders preserved');
});

test('water uses analytic phase-filtered gradients instead of three finite-difference fBm evaluations', () => {
  assert.match(newLit, /vec2 tfR8WaterGradient\(vec2 p, out float unresolved\)/);
  assert.match(newLit, /fwidth\(phase\)/);
  assert.match(newWater, /tfR8WaterGradient\(p, unresolved\)/);
  assert.doesNotMatch(newWater, /\b(?:fbm|vnoise)\s*\(/, 'normal evaluation has no procedural noise height resampling');
  assert.match(newWater, /rough = mix\(0\.09, 0\.125, unresolved\)/);
});

test('only litFS changes, the bundle remains JavaScript, and no shader resources or loops are added', () => {
  assert.notEqual(newLit, oldLit, 'candidate must implement a real shader change');
  assert.equal(candidate.replace(newLit, ''), baseline.replace(oldLit, ''), 'all bytes outside litFS remain identical');
  const declarations = value => value.match(/^uniform .*;.*$/gm);
  assert.deepEqual(declarations(newLit), declarations(oldLit), 'uniform/sampler contract preserved');
  assert.equal((newLit.match(/for\s*\(/g) || []).length, (oldLit.match(/for\s*\(/g) || []).length, 'no extra GLSL loop');
  assert.ok((newLit.match(/\b(?:vnoise|fbm|fbmL|noise3)\s*\(/g) || []).length <= (oldLit.match(/\b(?:vnoise|fbm|fbmL|noise3)\s*\(/g) || []).length, 'no new procedural noise evaluation sites');
  new Script(candidate.slice(candidate.indexOf('<script>') + 8, candidate.lastIndexOf('</script>')), {filename: 'r8-surface-candidate.js'});
});

test('replay, status, vehicle materials, water geometry/depth/alpha, and authored terrain overlays are byte-identical', () => {
  for (const [start, end] of [
    ['void main() {\n  vec3 V = normalize(uCamPos - vWorld);', '  } else if (uKind == 2 || uKind == 20) {'],
    ['  } else if (uKind == 11) {', '  vec3 L = normalize(uSunDir);'],
    ['  vec3 L = normalize(uSunDir);', '\n}`;'],
    ['    if (uMapOn > 0.5) {\n      // battle map:', '    rough = 0.96; metal = 0.0;'],
    ['    if (uKind == 2 && uTerrain < 0.5) {', '  } else if (uKind == 7 || uKind == 22) {'],
  ]) {
    assert.equal(section(newLit, start, end), section(oldLit, start, end), `protected branch changed: ${start.slice(0, 55)}`);
  }
  for (const text of [
    'wdepth = uKind == 22 ? 6.0 : (uMapOn > 0.5 ? max(0.0, -mapHeight(p)) : 6.0);',
    'albedo = mix(vec3(0.045, 0.085, 0.07), vec3(0.01, 0.032, 0.048), smoothstep(0.3, 5.0, wdepth));',
    'if (uKind == 22) alpha = 1.0;',
    'outColor = vec4(ENC(col), alpha);',
  ]) assert.ok(newLit.includes(text), `protected water/HDR contract lost: ${text}`);
});

test('checked patcher rejects missing, repeated or already-patched inputs', () => {
  assert.equal(typeof patcher.patchR8SurfaceShaders, 'function', 'checked patcher has not been implemented');
  assert.throws(() => patcher.patchR8SurfaceShaders(''), /litFS|shader/i);
  assert.throws(() => patcher.patchR8SurfaceShaders(candidate), /already|r8/i);
  assert.throws(() => patcher.patchR8SurfaceShaders(baseline.replace('float fine = vnoise(p * 6.0)', 'float altered = vnoise(p * 6.0)')), /anchor|terrain/i);
  assert.throws(() => patcher.patchR8SurfaceShaders(baseline + oldLit), /unique|one|duplicate/i);
});

test('analytic waves are finite, normalized, bounded and evolve at near resolution across map/time extremes', () => {
  assert.equal(typeof patcher.sampleR8Water, 'function', 'numeric wave reference has not been implemented');
  const sample = patcher.sampleR8Water;
  let changed = 0, maximumSlope = 0;
  for (const x of [-1000000, -20000, 0, 0.13, 25000, 1000000]) for (const z of [-1000000, -5.7, 0, 33000, 1000000]) for (const time of [0, 0.016, 1111, 1000000]) {
    const a = sample(x, z, time, [0.001, 0], [0, 0.001]);
    const b = sample(x, z, time + 0.5, [0.001, 0], [0, 0.001]);
    assert.ok(a.normal.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...a.normal) - 1) < 1e-12);
    assert.ok(a.normal[1] > 0.99, 'bounded ripples must not tilt into waves without matching geometry');
    maximumSlope = Math.max(maximumSlope, Math.hypot(...a.gradient));
    changed += Math.hypot(a.gradient[0]-b.gradient[0], a.gradient[1]-b.gradient[1]) > 1e-7 ? 1 : 0;
    assert.ok(a.roughness >= 0.09 && a.roughness <= 0.125);
  }
  assert.ok(maximumSlope <= 0.13200001, 'sum of component slopes bounds the full gradient');
  assert.ok(changed > 100, 'near water must animate');
});

test('unresolved wave gradients vanish and roughness broadens smoothly with footprint', () => {
  assert.equal(typeof patcher.sampleR8Water, 'function', 'numeric wave reference has not been implemented');
  const sample = patcher.sampleR8Water;
  let previous = 0.09;
  for (const step of [0, 0.01, 0.03, 0.1, 0.25, 0.5, 1, 2, 4, 20]) {
    const result = sample(21.13, -75.5, 14, [step,0], [0,step]);
    assert.ok(result.roughness + 1e-12 >= previous);
    assert.ok(result.weights.every(w => w >= 0 && w <= 1));
    previous = result.roughness;
  }
  const far = sample(21.13, -75.5, 14, [20,0], [0,20]);
  assert.deepEqual(far.gradient, [0,0]);
  assert.deepEqual(far.normal, [0,1,0]);
  assert.equal(far.roughness, 0.125);
});

test('terrain shading relief stays below two centimetres and becomes zero when unresolved', () => {
  const expression = newTerrain.match(/float detailHeight = ([^;]+);/);
  assert.ok(expression, 'bounded terrain detail expression has not been implemented');
  const evaluate = new Function('mid','fine','nearDetail','detailFade', `return ${expression[1]};`);
  for(const mid of [0,0.25,0.46875,0.75,0.9375]) for(const near of [0,0.2,0.5,1]) for(const noise of [0,0.25,0.5,0.75,1]) {
    const value = evaluate(mid,noise*near,near,near);
    assert.ok(Number.isFinite(value));
    assert.ok(Math.abs(value)<=0.02, 'surface lighting relief is bounded and does not replace metre-scale terrain');
    assert.ok(evaluate(mid,noise*near,near,0)===0, 'unresolved detail contributes no normal-height signal');
  }
});

test('actual evaluated GLSL exports preserve HDR/fallback encoding and expose a WebGL gate', () => {
  assert.equal(typeof patcher.extractR8ShaderSources, 'function', 'shader export gate has not been implemented');
  const shaders = patcher.extractR8ShaderSources(candidate);
  assert.match(shaders.vertex, /^#version 300 es/);
  assert.match(shaders.fragmentHDR, /^#version 300 es/);
  assert.match(shaders.fragmentFallback, /#define ENC\(c\) sqrt/);
  assert.match(shaders.fragmentHDR, /#define ENC\(c\) \(c\)/);
  for (const source of Object.values(shaders)) assert.doesNotMatch(source, /\$\{/);
});

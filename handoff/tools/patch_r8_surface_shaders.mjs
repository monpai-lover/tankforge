/** R8 bounded surface shading candidate. Independently authored; no Shadertoy code copied.
 * Reference/license decisions: r8-surface-shaders-sources.md beside this tool.
 * This tool changes litFS only. It never writes to its canonical input.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Script, createContext } from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const LIT_BEGIN = '  var litFS = (defs) => `';
const LIT_END = '\n  var DEPTH_VS =';
const MARKER = '// R8 bounded surface detail: independently authored, no added resources.';
export const R8_WATER_COMPONENTS = Object.freeze([
  {direction: [0.92847669, 0.37139068], frequency: 0.73, speed: 0.58, phase: 0.17, slope: 0.052},
  {direction: [-0.51449576, 0.85749293], frequency: 1.31, speed: 0.91, phase: 2.31, slope: 0.037},
  {direction: [0.39391930, -0.91914503], frequency: 2.77, speed: 1.53, phase: 4.73, slope: 0.026},
  {direction: [0.83205029, 0.55470020], frequency: 6.13, speed: 2.18, phase: 1.29, slope: 0.017},
].map(c => Object.freeze({...c, direction: Object.freeze(c.direction)})));

function bounds(source) {
  const start = source.indexOf(LIT_BEGIN), end = source.indexOf(LIT_END, start);
  if (start < 0 || end < start || source.indexOf(LIT_BEGIN, start + 1) >= 0) {
    throw Error('Expected exactly one unique canonical litFS shader declaration');
  }
  return {start, end, shader: source.slice(start, end)};
}
function replaceOnce(source, oldText, newText, label) {
  const first = source.indexOf(oldText);
  if (first < 0 || source.indexOf(oldText, first + 1) >= 0) throw Error(`R8 ${label} anchor must match exactly once`);
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}
const glslNumber = n => Number.isInteger(n) ? `${n}.0` : String(n);
const vec4 = field => `vec4(${R8_WATER_COMPONENTS.map(c => glslNumber(c[field])).join(', ')})`;
const directions = R8_WATER_COMPONENTS.map(c => `vec2(${c.direction.map(glslNumber).join(', ')})`);
const WATER_HELPER = `
${MARKER}
// A sum of sine heights has an analytic gradient; no height resampling or wave displacement.
// Filter each component in phase space before it falls below pixel resolution.
vec2 tfR8WaterGradient(vec2 p, out float unresolved) {
  vec4 phase = vec4(dot(p, ${directions[0]}), dot(p, ${directions[1]}),
                    dot(p, ${directions[2]}), dot(p, ${directions[3]}))
             * ${vec4('frequency')} - uClock * ${vec4('speed')} + ${vec4('phase')};
  vec4 resolved = vec4(1.0) - smoothstep(vec4(0.55), vec4(2.6), fwidth(phase));
  vec4 gradient = cos(phase) * ${vec4('slope')} * resolved;
  unresolved = 1.0 - dot(resolved, vec4(0.25));
  return ${directions[0]} * gradient.x + ${directions[1]} * gradient.y
       + ${directions[2]} * gradient.z + ${directions[3]} * gradient.w;
}
`;
const OLD_FINE = '    float fine = vnoise(p * 6.0) * smoothstep(120.0, 10.0, dist);';
const NEW_FINE = `    float nearDetail = 1.0 - smoothstep(12.0, 120.0, dist);
    float grainFilter = 1.0 - smoothstep(0.35, 0.85, foot * 6.0);
    float fine = mix(0.5, vnoise(p * 6.0), grainFilter) * nearDetail;`;
const OLD_GRASS = '    grass = mix(grass, vec3(0.42, 0.33, 0.12), smoothstep(0.55, 0.8, mid) * 0.5);';
const NEW_GRASS = `${OLD_GRASS}
    // Slope material uses existing filtered noise, before authored map/zones/road overlays.
    float steep = smoothstep(0.18, 0.58, 1.0 - abs(N.y));
    vec3 stone = mix(vec3(0.16, 0.145, 0.115), vec3(0.28, 0.245, 0.185), mid);
    grass = mix(grass, stone * (0.92 + 0.16 * big), steep * 0.72);`;
const OLD_ROUGH = '    rough = 0.96; metal = 0.0;';
const NEW_ROUGH = `${OLD_ROUGH}
    // Centimetre-scale light response only; canonical height/collision and rut normals survive.
    float detailFade = nearDetail * (1.0 - smoothstep(0.06, 0.4, foot));
    float detailHeight = ((mid - 0.46875) * 0.024 + (fine - 0.5 * nearDetail) * 0.008) * detailFade;
    N = bump(N, vWorld, detailHeight, 1.0);`;
const OLD_WATER = `    vec2 q1 = p * 0.16 + vec2(uClock * 0.045, uClock * 0.027);
    vec2 q2 = p * 0.62 - vec2(uClock * 0.08, -uClock * 0.05);
    float e = 0.3;
    float h0 = fbm(q1) + 0.45 * vnoise(q2);
    float hx = fbm(q1 + vec2(e, 0.0)) + 0.45 * vnoise(q2 + vec2(e * 3.9, 0.0));
    float hz = fbm(q1 + vec2(0.0, e)) + 0.45 * vnoise(q2 + vec2(0.0, e * 3.9));
    float fade = smoothstep(500.0, 30.0, dist);
    N = normalize(vec3(-(hx - h0) * 0.32 * fade, 1.0, -(hz - h0) * 0.32 * fade));
    albedo = mix(vec3(0.045, 0.085, 0.07), vec3(0.01, 0.032, 0.048), smoothstep(0.3, 5.0, wdepth));
    rough = 0.09; metal = 0.0;`;
const NEW_WATER = `    float unresolved;
    vec2 gradient = tfR8WaterGradient(p, unresolved);
    N = normalize(vec3(-gradient.x, 1.0, -gradient.y));
    albedo = mix(vec3(0.045, 0.085, 0.07), vec3(0.01, 0.032, 0.048), smoothstep(0.3, 5.0, wdepth));
    // Unresolved ripples broaden the highlight rather than glittering as a flat mirror.
    rough = mix(0.09, 0.125, unresolved); metal = 0.0;`;

export function patchR8SurfaceShaders(source) {
  if (typeof source !== 'string') throw TypeError('R8 shader input must be source text');
  const {start, end, shader} = bounds(source);
  if (shader.includes(MARKER) || shader.includes('tfR8WaterGradient')) throw Error('R8 surface shader is already patched');
  let updated = replaceOnce(shader, '\nfloat shadow() {', `${WATER_HELPER}\nfloat shadow() {`, 'water helper');
  updated = replaceOnce(updated, OLD_FINE, NEW_FINE, 'terrain fine');
  updated = replaceOnce(updated, OLD_GRASS, NEW_GRASS, 'terrain slope');
  updated = replaceOnce(updated, OLD_ROUGH, NEW_ROUGH, 'terrain bump');
  updated = replaceOnce(updated, OLD_WATER, NEW_WATER, 'water gradient');
  updated = replaceOnce(updated,
    '    // water: dark and clear in the shallows, deep blue-green further out; the waves are two\n    // drifting noise layers that bend the normal (reflections and sun glitter come from it)',
    '    // Water optical shading preserves existing depth/alpha; bounded analytic ripples bend\n    // its lighting normal without moving registered surfaces or inventing a seabed.', 'water comment');
  return source.slice(0, start) + updated + source.slice(end);
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
/** Numeric oracle for tests; this function is not injected into the runtime. */
export function sampleR8Water(x, z, time, dx, dy) {
  if (![x, z, time, ...dx, ...dy].every(Number.isFinite)) throw Error('R8 water sample needs finite input');
  const gradient = [0, 0], weights = [];
  for (const c of R8_WATER_COMPONENTS) {
    const [a,b] = c.direction;
    const phase = (x*a + z*b) * c.frequency - time*c.speed + c.phase;
    const footprint = (Math.abs(dx[0]*a + dx[1]*b) + Math.abs(dy[0]*a + dy[1]*b)) * c.frequency;
    const weight = 1 - smoothstep(0.55, 2.6, footprint);
    const wave = Math.cos(phase) * c.slope * weight;
    weights.push(weight);
    gradient[0] += a * wave;
    gradient[1] += b * wave;
  }
  const unresolved = 1 - weights.reduce((a,b) => a+b, 0) * 0.25;
  const length = Math.hypot(...gradient, 1);
  return {gradient, normal: [gradient[0] === 0 ? 0 : -gradient[0]/length, 1/length, gradient[1] === 0 ? 0 : -gradient[1]/length], weights, unresolved, roughness: 0.09 + (0.125-0.09)*unresolved};
}

/** Evaluate only self-contained relief/shader declarations, never the app or DOM boot. */
export function extractR8ShaderSources(source) {
  const begin = source.indexOf('  // client/web/src/game/relief.js');
  const end = source.indexOf(LIT_END, begin);
  if (begin < 0 || end <= begin) throw Error('Actual shader export anchors missing');
  const context = createContext({});
  new Script(source.slice(begin, end) + '\nglobalThis.exported = {vertex: LIT_VS, fragmentHDR: litFS(hdrDefines(true)), fragmentFallback: litFS(hdrDefines(false))};').runInContext(context, {timeout: 2000});
  return {...context.exported};
}

function sha256(s) { return createHash('sha256').update(s).digest('hex'); }

async function main() {
  const args = process.argv.slice(2), get = key => {
    const index = args.indexOf(key);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const input = path.resolve(get('--input') || fileURLToPath(new URL('../bundle/app.js.html', import.meta.url)));
  const outputArg = get('--output');
  if (!outputArg) throw Error('Use --output <candidate path>; canonical in-place patching is disabled');
  const output = path.resolve(outputArg);
  const canonical = path.resolve(fileURLToPath(new URL('../bundle/app.js.html', import.meta.url)));
  if ([input, canonical].some(p => p.toLowerCase() === output.toLowerCase())) throw Error('Candidate output must differ from both input and canonical app');
  const original = await readFile(input, 'utf8'), updated = patchR8SurfaceShaders(original);
  new Script(updated.slice(updated.indexOf('<script>') + 8, updated.lastIndexOf('</script>')), {filename: output});
  const shaders = extractR8ShaderSources(updated);
  await mkdir(path.dirname(output), {recursive: true});
  await writeFile(output, updated, {flag: 'wx'});
  const shaderDir = path.resolve(get('--shader-dir') || path.dirname(output));
  await mkdir(shaderDir, {recursive: true});
  await writeFile(path.join(shaderDir, 'actual-shaders.json'), JSON.stringify(shaders, null, 2));
  const {start, end, shader} = bounds(original), updatedLit = bounds(updated).shader;
  const receipt = {schema:'tankforge-r8-surface-candidate-v1', input, output, inputSha256:sha256(original), outputSha256:sha256(updated), oldLitSha256:sha256(shader), newLitSha256:sha256(updatedLit), changedRegion:{start,end}, outsideLitByteIdentical:updated.replace(updatedLit,'')===original.replace(shader,''), externalCodeCopied:false, extraTextures:0, extraTargets:0, extraDrawCalls:0, newUniforms:0, newSamplers:0, javascriptSyntax:true, shaderSourceExported:true, webglCompileRun:false, renderedVisualAccepted:false, fpsMeasured:false};
  await writeFile(`${output}.receipt.json`, JSON.stringify(receipt, null, 2));
  process.stdout.write(JSON.stringify(receipt, null, 2) + '\n');
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();

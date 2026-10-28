/** Water-only adaptation of afl_ext's MIT Shadertoy MdXyzX wave kernel.
 * Exact reference and license: docs/third-party/afl_ext-prococean-*.
 * Existing mesh/depth, sun, sky, HDR and postprocessing remain authoritative.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const MARKER='// TF_R85_OCEAN: afl_ext 2017-2024, MIT; bounded TankForge adaptation.';
const LICENSE=fs.readFileSync(new URL('../../docs/third-party/afl_ext-prococean-LICENSE.txt',import.meta.url),'utf8').split('\n\nReference:')[0].trim();
const NOTICE='/*\n'+LICENSE+'\n*/\n';
const HELPER=`
${MARKER}
${NOTICE}
// exp(sin) waves and derivative drag adapted from Very fast procedural ocean.
// Analytic chain-rule gradients replace the original three height resamples.
// Pixel footprint filtering removes unresolved octaves before normal evaluation.
vec2 tfR85Ocean(vec2 p, out float unresolved, out float crest) {
  vec2 q = p, gradient = vec2(0.0);
  vec2 pixelDx = dFdx(p), pixelDy = dFdy(p);
  mat2 jacobian = mat2(1.0);
  float frequency = 0.07, amplitude = 0.9, speed = 0.58;
  float total = 0.0, filtered = 0.0, height = 0.0;
  for (int octave = 0; octave < 8; octave++) {
    float angle = 0.37 + float(octave) * 2.39996323;
    vec2 direction = vec2(cos(angle), sin(angle));
    float phase = dot(direction, q) * frequency - uClock * speed + float(octave) * 1.713;
    vec2 phaseGradient = transpose(jacobian) * direction * frequency;
    float footprint = abs(dot(phaseGradient, pixelDx)) + abs(dot(phaseGradient, pixelDy));
    float resolved = 1.0 - smoothstep(0.55, 2.2, footprint);
    float wave = exp(sin(phase) - 1.0);
    float derivative = wave * cos(phase);
    float second = wave * (cos(phase) * cos(phase) - sin(phase));
    float weight = amplitude * resolved;
    gradient += phaseGradient * derivative * weight;
    height += wave * weight;
    filtered += weight;
    total += amplitude;
    q -= direction * derivative * weight * 0.22;
    jacobian -= outerProduct(direction, phaseGradient) * second * weight * 0.22;
    frequency *= 1.85;
    amplitude *= 0.55;
    speed *= 1.32;
  }
  unresolved = 1.0 - filtered / total;
  crest = clamp(height / total, 0.0, 1.0);
  gradient *= 1.6;
  return gradient * min(1.0, 0.28 / max(length(gradient), 0.00001));
}
`;
const OLD_NORMAL=`    float unresolved;
    vec2 gradient = tfR8WaterGradient(p, unresolved);
    N = normalize(vec3(-gradient.x, 1.0, -gradient.y));
    albedo = mix(vec3(0.045, 0.085, 0.07), vec3(0.01, 0.032, 0.048), smoothstep(0.3, 5.0, wdepth));
    // Unresolved ripples broaden the highlight rather than glittering as a flat mirror.
    rough = mix(0.09, 0.125, unresolved); metal = 0.0;`;
const NEW_NORMAL=`    float unresolved, crest;
    vec2 gradient = tfR85Ocean(p, unresolved, crest);
    N = normalize(vec3(-gradient.x, 1.0, -gradient.y));
    albedo = mix(vec3(0.021, 0.075, 0.068), vec3(0.008, 0.031, 0.052), smoothstep(0.3, 5.0, wdepth));
    // Unresolved capillary waves become a broad microfacet lobe, not mirror stripes.
    rough = mix(0.16, 0.32, unresolved); metal = 0.0;`;
const OLD_OPTICS=`    // more water shows its reflection the flatter it is seen; the shallows let the bed through,
    // with a little foam where it laps the shore
    float rim7 = pow(1.0 - NoV, 4.0);
    alpha = clamp(mix(0.32, 0.9, smoothstep(0.0, 2.2, wdepth)) + rim7 * 0.6, 0.0, 0.97);
    float foam = smoothstep(0.22, 0.0, wdepth) * (0.5 + 0.5 * vnoise(vWorld.xz * 1.3 + uClock * 0.3));
    col = mix(col, (uSkyColor * 1.5 + uSunColor * 0.06) * 0.9, foam * 0.55);
    alpha = max(alpha, foam * 0.7);
    if (uKind == 22) alpha = 1.0;`;
const NEW_OPTICS=`    // TF_R85_WATER_OPTICS: use the game's existing sky/sun and exposure.
    float waterFr = 0.0204 + 0.9796 * pow(1.0 - NoV, 5.0);
    vec3 waterSky = mix(envSharp, envSoft, clamp(rough * 1.8, 0.0, 0.65));
    float facingSun = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
    vec3 waterBody = albedo * (uSkyColor * 1.4 + uSunColor * 0.025) * (0.75 + facingSun * 0.25);
    col = waterBody * (1.0 - waterFr) + waterSky * waterFr
        + spec * uSunColor * NoL * sh;
    float rim7 = pow(1.0 - NoV, 4.0);
    alpha = clamp(mix(0.32, 0.9, smoothstep(0.0, 2.2, wdepth)) + rim7 * 0.6, 0.0, 0.97);
    float foam = (1.0 - smoothstep(0.0, 0.3, wdepth))
               * (0.5 + 0.5 * vnoise(vWorld.xz * 1.3 + uClock * 0.3));
    col = mix(col, (uSkyColor * 1.5 + uSunColor * 0.06) * 0.9, foam * 0.55);
    alpha = max(alpha, foam * 0.7);
    if (uKind == 22) alpha = 1.0;`;
const OLD_F0='  vec3 F0 = mix(vec3(0.04), albedo, metal);';
const NEW_F0='  vec3 F0 = mix(vec3((uKind == 7 || uKind == 22) ? 0.0204 : 0.04), albedo, metal);';

export function patchR85Water(source){
 assert.equal(typeof source,'string','Water shader source required');
 const start=source.indexOf('  var litFS = (defs) => `'),end=source.indexOf('\n  var DEPTH_VS =',start);
 assert.ok(start>=0&&end>start&&source.indexOf('  var litFS = (defs) => `',start+1)<0,'Unique litFS water shader required');
 const edits=[['\nfloat shadow() {',HELPER+'\nfloat shadow() {'],[OLD_NORMAL,NEW_NORMAL],[OLD_OPTICS,NEW_OPTICS],[OLD_F0,NEW_F0]];
 let shader=source.slice(start,end);
 const installed=shader.includes(MARKER);
 for(const [before,after]of edits){
  if(installed){assert.equal(shader.split(after).length-1,1,'Installed water anchor differs');continue;}
  assert.equal(shader.split(before).length-1,1,'Unique reviewed water anchor required');shader=shader.replace(before,after);
 }
 return source.slice(0,start)+shader+source.slice(end);
}

const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** CPU numerical reference for wave stability tests; never injected into RAF. */
export function sampleR85Water(x,z,time,dx,dy){
 if(![x,z,time,...dx,...dy].every(Number.isFinite))throw Error('Finite water input required');
 let q=[x,z],j=[1,0,0,1],gradient=[0,0],frequency=.07,amplitude=.9,speed=.58,total=0,filtered=0,height=0;
 for(let octave=0;octave<8;octave++){
  const angle=.37+octave*2.39996323,d=[Math.cos(angle),Math.sin(angle)];
  const phase=(d[0]*q[0]+d[1]*q[1])*frequency-time*speed+octave*1.713;
  const pg=[(j[0]*d[0]+j[2]*d[1])*frequency,(j[1]*d[0]+j[3]*d[1])*frequency];
  const footprint=Math.abs(pg[0]*dx[0]+pg[1]*dx[1])+Math.abs(pg[0]*dy[0]+pg[1]*dy[1]);
  const resolved=1-smooth(.55,2.2,footprint),wave=Math.exp(Math.sin(phase)-1),derivative=wave*Math.cos(phase),second=wave*(Math.cos(phase)**2-Math.sin(phase)),weight=amplitude*resolved;
  gradient[0]+=pg[0]*derivative*weight;gradient[1]+=pg[1]*derivative*weight;
  height+=wave*weight;filtered+=weight;total+=amplitude;
  q=q.map((v,i)=>v-d[i]*derivative*weight*.22);
  j=[j[0]-d[0]*pg[0]*second*weight*.22,j[1]-d[0]*pg[1]*second*weight*.22,j[2]-d[1]*pg[0]*second*weight*.22,j[3]-d[1]*pg[1]*second*weight*.22];
  frequency*=1.85;amplitude*=.55;speed*=1.32;
 }
 gradient=gradient.map(v=>v*1.6);const scale=Math.min(1,.28/Math.max(Math.hypot(...gradient),.00001));gradient=gradient.map(v=>v*scale);
 const n=Math.hypot(...gradient,1),unresolved=1-filtered/total;
 return{gradient,normal:[gradient[0]===0?0:-gradient[0]/n,1/n,gradient[1]===0?0:-gradient[1]/n],unresolved,crest:Math.max(0,Math.min(1,height/total)),roughness:.16+.16*unresolved};
}

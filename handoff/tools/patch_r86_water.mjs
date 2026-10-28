/**
 * Water portions adapted from Frank Hugenroth's user-supplied 03/2013 shader.
 * Those adapted GLSL/CPU portions are CC BY-NC-SA 3.0, not MIT.
 * https://creativecommons.org/licenses/by-nc-sa/3.0/
 * Exact reference and attribution: docs/third-party/frank-hugenroth-water-*.
 */
import assert from 'node:assert/strict';

const BEGIN='// TF_R86_WATER_BEGIN';
const END='// TF_R86_WATER_END';
const HELPER=`
${BEGIN}
// Adapted from Clouds / Water, Frank Hugenroth, 03/2013.
// License: Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported.
// https://creativecommons.org/licenses/by-nc-sa/3.0/
// Changes: existing game noise/sky/shadows, analytic gradients, pixel filtering;
// no source demo camera, ray marcher, cloud volume or physical water displacement.
// The source's iChannel0 noise image was not supplied. This deterministic lattice
// uses the game's hash instead, preserving the source's wave/noise composition.
vec3 tfR86Noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = hash(mod(i, 256.0)), b = hash(mod(i + vec2(1, 0), 256.0));
  float c = hash(mod(i + vec2(0, 1), 256.0)), d = hash(mod(i + vec2(1, 1), 256.0));
  float crossTerm = a - b - c + d;
  float value = a + (b - a) * u.x + (c - a) * u.y + crossTerm * u.x * u.y;
  return vec3(value, du * vec2(b - a + crossTerm * u.y, c - a + crossTerm * u.x));
}
float tfR86NoiseResolution(mat2 transform, vec2 pixelDx, vec2 pixelDy) {
  float footprint = max(length(transform * pixelDx), length(transform * pixelDy));
  return 1.0 - smoothstep(0.35, 1.1, footprint);
}
vec2 tfR86Ocean(vec2 p, out float unresolved, out float crest) {
  vec2 pixelDx = dFdx(p), pixelDy = dFdy(p);
  vec3 wave = vec3(0.0); // height, analytic world-space x/z derivatives
  float totalWeight = 0.0, resolvedWeight = 0.0;
  const vec2 swellK[5] = vec2[5](vec2(0.021, 0.0), vec2(0.0172, 0.010),
      vec2(0.00104, 0.005), vec2(0.02221, 0.01233), vec2(0.03112, 0.01122));
  const float swellA[5] = float[5](4.5, 4.0, -4.0, 5.0, 2.5);
  const float swellT[5] = float[5](1.0, 1.121, 0.121, 3.437, 4.269);
  for (int component = 0; component < 5; component++) {
    vec2 k = swellK[component];
    float phase = dot(p, k) + uClock * 0.38 * swellT[component];
    float footprint = abs(dot(k, pixelDx)) + abs(dot(k, pixelDy));
    float resolved = 1.0 - smoothstep(0.55, 2.2, footprint);
    wave += vec3(sin(phase), cos(phase) * k) * swellA[component] * resolved;
    totalWeight += abs(swellA[component]);
    resolvedWeight += abs(swellA[component]) * resolved;
  }
  mat2 m2 = mat2(1.6, -1.2, 1.2, 1.6);
  mat2 transform = mat2(0.004);
  vec2 q = p * 0.004 - vec2(0.38, -0.26) * uClock * 0.5;
  const vec4 fbmWeight = vec4(0.5, 0.25, 0.1666, 0.0834);
  for (int octave = 0; octave < 4; octave++) {
    float resolved = tfR86NoiseResolution(transform, pixelDx, pixelDy);
    float amplitude = 24.0 * fbmWeight[octave];
    if (resolved > 0.0) {
      vec3 n = tfR86Noise(q);
      wave.x -= amplitude * mix(0.5, n.x, resolved);
      wave.yz -= transpose(transform) * n.yz * amplitude * resolved;
    } else wave.x -= amplitude * 0.5;
    totalWeight += amplitude; resolvedWeight += amplitude * resolved;
    q = m2 * q; transform = m2 * transform;
  }
  // In the source p *= m2: row-vector rotation, unlike fbm's m2 * p.
  // Keep that distinction while propagating world-space derivatives explicitly.
  transform = mat2(0.01);
  vec2 shift = vec2(0.096, 0.072) * uClock;
  float amplitude = 6.0;
  for (int octave = 0; octave < 7; octave++) {
    float resolved = tfR86NoiseResolution(transform, pixelDx, pixelDy);
    if (resolved > 0.0) {
      vec3 n = tfR86Noise(transform * p + shift);
      float angle = (n.x - 0.5) * 3.14, s = sin(angle);
      // Smooth only the abs cusp to prevent a discontinuous specular normal.
      float chop = sqrt(s * s + 0.01);
      float derivative = s * cos(angle) * 3.14 / chop;
      wave.x -= amplitude * mix(0.5, chop, resolved);
      wave.yz -= transpose(transform) * n.yz * derivative * amplitude * resolved;
    } else wave.x -= amplitude * 0.5;
    totalWeight += amplitude; resolvedWeight += amplitude * resolved;
    amplitude *= 0.51; shift *= 1.841;
    transform = transpose(m2) * 0.9331 * transform;
  }
  unresolved = clamp(1.0 - resolvedWeight / totalWeight, 0.0, 1.0);
  crest = clamp(0.5 + wave.x / 64.0, 0.0, 1.0);
  // The source evaluates heights +/-0.4m around each point: slope scale 0.8.
  vec2 gradient = wave.yz * 0.8;
  return gradient * min(1.0, 0.45 / max(length(gradient), 0.00001));
}
${END}
`;
const OLD_NORMAL=`    float unresolved, crest;
    vec2 gradient = tfR85Ocean(p, unresolved, crest);
    N = normalize(vec3(-gradient.x, 1.0, -gradient.y));
    albedo = mix(vec3(0.021, 0.075, 0.068), vec3(0.008, 0.031, 0.052), smoothstep(0.3, 5.0, wdepth));
    // Unresolved capillary waves become a broad microfacet lobe, not mirror stripes.
    rough = mix(0.16, 0.32, unresolved); metal = 0.0;`;
const NEW_NORMAL=`    // TF_R86_WATER_NORMAL_BEGIN
    float unresolved, crest;
    vec2 gradient = tfR86Ocean(p, unresolved, crest);
    N = normalize(vec3(-gradient.x, 1.0, -gradient.y));
    albedo = mix(vec3(0.12, 0.18, 0.19), vec3(0.055, 0.095, 0.125), smoothstep(0.3, 5.0, wdepth));
    albedo *= mix(0.94, 1.08, crest);
    rough = mix(0.13, 0.30, unresolved); metal = 0.0;
    // TF_R86_WATER_NORMAL_END`;
const OLD_OPTICS=`    // TF_R85_WATER_OPTICS: use the game's existing sky/sun and exposure.
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
const NEW_OPTICS=`    // TF_R86_WATER_OPTICS_BEGIN
    // Frank Hugenroth 03/2013, CC BY-NC-SA 3.0; see TF_R86_WATER_BEGIN.
    // Preserve the source's reflected-ray weighting and broad/narrow sun lobes.
    float waterFr = 0.0204 + 0.9796 * (1.0 - clamp(Rr.y, 0.0, 1.0));
    vec3 reflectionTint = vec3(0.025, 0.10, 0.20) * (uSkyColor * 1.5 + 0.05);
    // Steep wave normals can reflect below the horizon. Open ocean uses the
    // source's blue reflection tint there, never the generic ground hemisphere.
    vec3 waterSky = mix(reflectionTint, mix(envSharp, envSoft, clamp(rough * 1.3, 0.0, 0.45)),
                        0.68 * smoothstep(0.0, 0.08, Rr.y));
    vec3 waterBody = albedo * (uSkyColor * 1.7 + uSunColor * 0.025);
    float waterCloud = 0.3 + 0.7 * clamp(sh, 0.0, 1.0);
    float sunReflection = clamp(dot(Rr, L), 0.0, 1.0);
    float filteredDetail = clamp((rough - 0.13) / 0.17, 0.0, 1.0);
    float sunLobes = 0.5 * pow(sunReflection, 10.0) + 0.25 * pow(sunReflection, 3.5)
                   + 0.75 * pow(sunReflection, mix(300.0, 60.0, filteredDetail));
    col = (waterBody * (1.0 - waterFr) + waterSky * waterFr) * waterCloud
        + uSunColor * waterFr * sunLobes * sh * 0.28;
    float rim7 = pow(1.0 - NoV, 4.0);
    alpha = clamp(mix(0.32, 0.9, smoothstep(0.0, 2.2, wdepth)) + rim7 * 0.6, 0.0, 0.97);
    float foam = (1.0 - smoothstep(0.0, 0.3, wdepth))
               * (0.5 + 0.5 * vnoise(vWorld.xz * 1.3 + uClock * 0.3));
    col = mix(col, (uSkyColor * 1.5 + uSunColor * 0.06) * 0.9, foam * 0.55);
    alpha = max(alpha, foam * 0.7);
    if (uKind == 22) alpha = 1.0;
    // TF_R86_WATER_OPTICS_END`;

const unique=(source,anchor,label)=>assert.equal(source.split(anchor).length-1,1,`Unique reviewed R86 water ${label} anchor required`);
function editShader(source,edit){
 assert.equal(typeof source,'string','Water shader source required');
 const eol=source.includes('\r\n')&&!/(?<!\r)\n/.test(source)?'\r\n':'\n';
 source=source.replaceAll('\r\n','\n');
 const start=source.indexOf('  var litFS = (defs) => `'),end=source.indexOf('\n  var DEPTH_VS =',start);
 assert.ok(start>=0&&end>start&&source.indexOf('  var litFS = (defs) => `',start+1)<0,'Unique litFS water shader required');
 return (source.slice(0,start)+edit(source.slice(start,end))+source.slice(end)).replaceAll('\n',eol);
}
/** Remove only this exact reviewed adaptation before applying older composers. */
export function normalizeR86Water(source){
 return editShader(source,shader=>{
  if(!shader.includes(BEGIN)){
   assert.ok(!shader.includes('TF_R86_WATER_'),'Partial R86 water anchor set');return shader;
  }
  for(const [after,before,label]of[[HELPER,'','helper'],[NEW_NORMAL,OLD_NORMAL,'normal'],[NEW_OPTICS,OLD_OPTICS,'optics']]){
   unique(shader,after,label);shader=shader.replace(after,before);
  }
  return shader;
 });
}
export function patchR86Water(source){
 return editShader(normalizeR86Water(source),shader=>{
  const edits=[['\nfloat shadow() {',HELPER+'\nfloat shadow() {','helper boundary'],[OLD_NORMAL,NEW_NORMAL,'normal'],[OLD_OPTICS,NEW_OPTICS,'optics']];
  for(const [before,after,label]of edits){unique(shader,before,label);shader=shader.replace(before,after);}
  return shader;
 });
}

const fract=x=>x-Math.floor(x),mod256=x=>x-Math.floor(x/256)*256;
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const hash=(x,y)=>{x=fract(x*123.34);y=fract(y*456.21);const d=x*(x+45.32)+y*(y+45.32);return fract((x+d)*(y+d));};
function noise(x,y){
 const ix=Math.floor(x),iy=Math.floor(y),fx=fract(x),fy=fract(y),ux=fx*fx*(3-2*fx),uy=fy*fy*(3-2*fy);
 const a=hash(mod256(ix),mod256(iy)),b=hash(mod256(ix+1),mod256(iy)),c=hash(mod256(ix),mod256(iy+1)),d=hash(mod256(ix+1),mod256(iy+1)),cross=a-b-c+d;
 return[a+(b-a)*ux+(c-a)*uy+cross*ux*uy,6*fx*(1-fx)*(b-a+cross*uy),6*fy*(1-fy)*(c-a+cross*ux)];
}
const mv=(m,v)=>[m[0]*v[0]+m[1]*v[1],m[2]*v[0]+m[3]*v[1]];
const mtv=(m,v)=>[m[0]*v[0]+m[2]*v[1],m[1]*v[0]+m[3]*v[1]];
const mm=(a,b)=>[a[0]*b[0]+a[1]*b[2],a[0]*b[1]+a[1]*b[3],a[2]*b[0]+a[3]*b[2],a[2]*b[1]+a[3]*b[3]];
/** Double-precision numerical reference for calculus/stability tests, not RAF. */
export function sampleR86Water(x,z,time,dx,dy){
 if(![x,z,time,...dx,...dy].every(Number.isFinite)||dx.length!==2||dy.length!==2)throw Error('Finite water input required');
 const p=[x,z],wave=[0,0,0],m2=[1.6,1.2,-1.2,1.6],chopM=[1.6*.9331,-1.2*.9331,1.2*.9331,1.6*.9331];
 let total=0,filtered=0;
 for(const [kx,kz,amp,speed]of[[.021,0,4.5,1],[.0172,.010,4,1.121],[.00104,.005,-4,.121],[.02221,.01233,5,3.437],[.03112,.01122,2.5,4.269]]){
  const phase=x*kx+z*kz+time*.38*speed,footprint=Math.abs(kx*dx[0]+kz*dx[1])+Math.abs(kx*dy[0]+kz*dy[1]),r=1-smooth(.55,2.2,footprint);
  wave[0]+=Math.sin(phase)*amp*r;wave[1]+=Math.cos(phase)*kx*amp*r;wave[2]+=Math.cos(phase)*kz*amp*r;total+=Math.abs(amp);filtered+=Math.abs(amp)*r;
 }
 const resolution=m=>1-smooth(.35,1.1,Math.max(Math.hypot(...mv(m,dx)),Math.hypot(...mv(m,dy))));
 let transform=[.004,0,0,.004],q=[x*.004-time*.19,z*.004+time*.13];
 for(const weight of[.5,.25,.1666,.0834]){
  const r=resolution(transform),amp=24*weight,n=r>0?noise(...q):[.5,0,0],g=mtv(transform,n.slice(1));
  wave[0]-=amp*(.5+(n[0]-.5)*r);wave[1]-=g[0]*amp*r;wave[2]-=g[1]*amp*r;total+=amp;filtered+=amp*r;
  q=mv(m2,q);transform=mm(m2,transform);
 }
 transform=[.01,0,0,.01];let shift=[.096*time,.072*time],amp=6;
 for(let octave=0;octave<7;octave++){
  const r=resolution(transform),v=mv(transform,p),n=r>0?noise(v[0]+shift[0],v[1]+shift[1]):[.5,0,0],angle=(n[0]-.5)*3.14,s=Math.sin(angle),chop=Math.sqrt(s*s+.01),d=s*Math.cos(angle)*3.14/chop,g=mtv(transform,n.slice(1));
  wave[0]-=amp*(.5+(chop-.5)*r);wave[1]-=g[0]*d*amp*r;wave[2]-=g[1]*d*amp*r;total+=amp;filtered+=amp*r;
  amp*=.51;shift=shift.map(v=>v*1.841);transform=mm(chopM,transform);
 }
 let gradient=wave.slice(1).map(v=>v*.8);const scale=Math.min(1,.45/Math.max(Math.hypot(...gradient),.00001));gradient=gradient.map(v=>v*scale);
 const norm=Math.hypot(...gradient,1),unresolved=Math.max(0,Math.min(1,1-filtered/total));
 return{height:wave[0],rawGradient:wave.slice(1),gradient,normal:[gradient[0]===0?0:-gradient[0]/norm,1/norm,gradient[1]===0?0:-gradient[1]/norm],unresolved,crest:Math.max(0,Math.min(1,.5+wave[0]/64)),roughness:.13+.17*unresolved};
}

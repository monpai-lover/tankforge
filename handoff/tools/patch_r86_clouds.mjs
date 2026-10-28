/** Original refinement of the game's existing cloud owner; no demo code imported.
 * General principles: coherent density, extinction, front-to-back compositing,
 * optical-depth self-shadow and restrained forward sunlit rims.
 */
import assert from 'node:assert/strict';
import {Script,createContext} from 'node:vm';

const OLD_LAYER=`float cloudDensity(vec3 p, float alt, float cheap) {
  float h = (alt - CLOUD_BASE) / (CLOUD_TOP - CLOUD_BASE);
  if (h <= 0.0 || h >= 1.0) return 0.0;
  vec3 q = p + uWind;
  float weather = textureLod(uNoise, vec3(q.x / 43000.0, uCloud.y * 0.2, q.z / 43000.0), 0.0).b;
  float cov = clamp(uCloud.x + (weather - 0.5) * 1.3, 0.0, 1.0);
  float top = mix(0.5, 1.0, smoothstep(0.4, 0.68, weather));
  float profile = smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(top * 0.45, top, h));
  float base = textureLod(uNoise, vec3(q.x, alt * 1.3, q.z) / 7600.0 + vec3(0.0, uCloud.y, 0.0), 0.0).r;
  float th = mix(NOISE_HI, NOISE_LO, cov);
  float d = smoothstep(th, th + 0.11, mix(NOISE_LO * 0.6, base, profile));
  d *= profile;
  if (cheap < 0.5 && d > 0.0) {
    float det = textureLod(uNoise, vec3(q.x, alt, q.z) / 1500.0 - vec3(0.0, uCloud.y * 3.0, 0.0), 0.0).g;
    float e = det * uCloud.w * (1.0 - d * 0.75);
    d = clamp((d - e) / (1.0 - e), 0.0, 1.0);
  }
  return d * uCloud.z;
}
// Sunlight left after passing through the cloud layer above a point near the ground.
float cloudShadow(vec3 p, vec3 sun) {
  float sy = max(sun.y, 0.07);
  float a = 0.0;
  for (int i = 0; i < 2; i++) {
    float alt = mix(CLOUD_BASE, CLOUD_TOP, 0.22 + 0.3 * float(i));
    a += cloudDensity(p + sun * ((alt - p.y) / sy), alt, 1.0);
  }
  return exp(-a / uCloud.z * 4.5);
}`;
const NEW_LAYER=`// TF_R86_CLOUDS_BEGIN
// Original refinement on the game's baked multi-octave cloud volume.
// Reuse the billow/cell channels from one fetch; no new noise resource or march.
float cloudDensity(vec3 p, float alt, float cheap) {
  float h = (alt - CLOUD_BASE) / (CLOUD_TOP - CLOUD_BASE);
  float extinction = max(uCloud.z, 0.0);
  if (h <= 0.0 || h >= 1.0 || extinction <= 0.0) return 0.0;
  vec3 q = p + uWind;
  float weather = textureLod(uNoise, vec3(q.x / 43000.0, uCloud.y * 0.2, q.z / 43000.0), 0.0).b;
  float cov = clamp(uCloud.x + (weather - 0.5) * 1.18, 0.0, 1.0);
  float top = mix(0.56, 1.0, smoothstep(0.3, 0.76, weather));
  float profile = smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(top * 0.55, top, h));
  vec4 shape = textureLod(uNoise, vec3(q.x, alt * 1.3, q.z) / 7600.0 + vec3(0.0, uCloud.y, 0.0), 0.0);
  float body = clamp(shape.r + (shape.a - 0.5) * 0.055, 0.0, 1.0);
  float th = mix(NOISE_HI, NOISE_LO, cov);
  float d = smoothstep(th, th + 0.105, mix(NOISE_LO * 0.6, body, profile)) * profile;
  if (cheap < 0.5 && d > 0.0) {
    float det = textureLod(uNoise, vec3(q.x, alt, q.z) / 1500.0 - vec3(0.0, uCloud.y * 3.0, 0.0), 0.0).g;
    float e = det * clamp(uCloud.w, 0.0, 0.95) * (1.0 - d * 0.80);
    d = clamp((d - e) / max(1.0 - e, 0.05), 0.0, 1.0);
  }
  return d * extinction;
}
// Shared with the ground and shafts: visible gaps remain shadow gaps.
float cloudShadow(vec3 p, vec3 sun) {
  float sy = max(sun.y, 0.07);
  float a = 0.0;
  for (int i = 0; i < 2; i++) {
    float alt = mix(CLOUD_BASE, CLOUD_TOP, 0.22 + 0.3 * float(i));
    a += cloudDensity(p + sun * ((alt - p.y) / sy), alt, 1.0);
  }
  return exp(-a / max(uCloud.z, 0.000001) * 4.5);
}
// TF_R86_CLOUDS_END`;
const OLD_BOUNDS=`  if (d.y > 0.012) {
    float b = R_PLANET * d.y;
    float c0 = 2.0 * R_PLANET * CLOUD_BASE + CLOUD_BASE * CLOUD_BASE;
    float c1 = 2.0 * R_PLANET * CLOUD_TOP + CLOUD_TOP * CLOUD_TOP;
    float t0 = c0 / (b + sqrt(b * b + c0));
    float t1 = c1 / (b + sqrt(b * b + c1));`;
const NEW_BOUNDS=`  if (d.y > 0.012 && uCamPos.y < CLOUD_TOP) {
    // TF_R86_CLOUD_ALTITUDE_BEGIN
    // Intersect the current camera's upward ray with the two spherical heights.
    // The factored radius difference avoids subtracting two planet-size squares.
    float b = (R_PLANET + uCamPos.y) * d.y;
    float c0 = (CLOUD_BASE - uCamPos.y) * (2.0 * R_PLANET + CLOUD_BASE + uCamPos.y);
    float c1 = (CLOUD_TOP - uCamPos.y) * (2.0 * R_PLANET + CLOUD_TOP + uCamPos.y);
    float t0 = uCamPos.y >= CLOUD_BASE ? 0.0 : c0 / (b + sqrt(max(b * b + c0, 0.0)));
    float t1 = c1 / (b + sqrt(max(b * b + c1, 0.0)));
    // TF_R86_CLOUD_ALTITUDE_END`;
const OLD_LIGHTING=`          float hN = clamp((alt - CLOUD_BASE) / (CLOUD_TOP - CLOUD_BASE), 0.0, 1.0);
          vec3 S = uSunE * sunL * 5.2 + uSkyAmb * (0.35 + 0.75 * hN);
          float stepT = exp(-dens * dt);
          float w = T * (1.0 - stepT);
          L += w * S;
          tMean += w * t;
          wSum += w;
          T *= stepT;`;
const NEW_LIGHTING=`          // TF_R86_CLOUD_LIGHTING_BEGIN
          float hN = clamp((alt - CLOUD_BASE) / (CLOUD_TOP - CLOUD_BASE), 0.0, 1.0);
          float relativeDensity = clamp(dens / max(uCloud.z, 0.000001), 0.0, 1.0);
          float coreLight = exp(-min(tau, 40.0) * 0.12);
          float silverRim = pow(max(mu, 0.0), 8.0)
                          * (1.0 - smoothstep(0.18, 0.72, relativeDensity))
                          * exp(-min(tau, 40.0) * 0.65);
          vec3 S = uSunE * (sunL * 5.2 + silverRim * 0.65)
                 + uSkyAmb * (0.25 + 0.85 * hN) * (0.55 + 0.45 * coreLight);
          float stepOpacity = 1.0 - exp(-max(dens, 0.0) * max(dt, 0.0));
          float stepT = 1.0 - stepOpacity;
          float w = T * stepOpacity;
          L += w * S;
          tMean += w * t;
          wSum += w;
          T *= stepT;
          // TF_R86_CLOUD_LIGHTING_END`;
const OLD_COMPOSITE='  vec4 cur = vec4(sky * T + L, T);';
const NEW_COMPOSITE=`  // TF_R86_CLOUD_OPACITY: opacity is the complement, never the stored alpha.
  float cloudOpacity = clamp(1.0 - T, 0.0, 1.0);
  T = 1.0 - cloudOpacity;
  vec4 cur = vec4(sky * T + L, T);`;
const OLD_SKY_T='  float T = mix(a.a, b.a, uDomeMix);';
const NEW_SKY_T=`  // TF_R86_CLOUD_SKY: dome alpha is transmittance; final sky remains opaque.
  float cloudOpacity = clamp(1.0 - mix(a.a, b.a, uDomeMix), 0.0, 1.0);
  float T = 1.0 - cloudOpacity;`;
const EDITS=[
 [OLD_LAYER,NEW_LAYER,'density and shared shadow'],
 [OLD_BOUNDS,NEW_BOUNDS,'camera-altitude ray bounds'],
 [OLD_LIGHTING,NEW_LIGHTING,'dome lighting'],
 ['      float n = float(uSteps);','      float n = float(clamp(uSteps, 1, 48));','bounded steps'],
 [OLD_COMPOSITE,NEW_COMPOSITE,'dome opacity contract'],
 ['  outColor = vec4(ENC(cur.rgb), cur.a);','  outColor = vec4(ENC(cur.rgb), clamp(cur.a, 0.0, 1.0));','bounded history alpha'],
 [OLD_SKY_T,NEW_SKY_T,'sky transmittance']
];
const eolOf=s=>s.includes('\r\n')&&!/(?<!\r)\n/.test(s)?'\r\n':'\n';
const unique=(s,text,label)=>assert.equal(s.split(text).length-1,1,'Unique reviewed R86 cloud '+label+' anchor required');
function edit(source,restore){
 assert.equal(typeof source,'string','Cloud shader source required');
 const eol=eolOf(source);let s=source.replaceAll('\r\n','\n');
 if(restore&&!s.includes('// TF_R86_CLOUDS_BEGIN')){assert.ok(!s.includes('TF_R86_CLOUD_'),'Partial R86 cloud shader anchors');return source;}
 if(!restore){
  unique(s,'  var CLOUDS = `','shared density owner');unique(s,'  var domeFS =','dome owner');unique(s,'  var skyFS =','sky owner');
  unique(s,'        float dens = cloudDensity(pos, alt, 0.0);','march density contract');
 }
 for(const[before,after,label]of EDITS){unique(s,restore?after:before,label);s=s.replace(restore?after:before,restore?before:after);}
 return s.replaceAll('\n',eol);
}
export function normalizeR86Clouds(source){return edit(source,true);}
export function patchR86Clouds(source){return edit(normalizeR86Clouds(source),false);}

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const mix=(a,b,t)=>a+(b-a)*t;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
/** CPU reference on supplied texture-channel samples, not a replacement noise generator. */
export function sampleR86CloudDensity({altitude,weather=.5,base=.5,cells=.5,detail=.5,coverage=.5,extinction=.022,erosion=.55,noiseLow=.35,noiseHigh=.9,cheap=false}){
 if(![altitude,weather,base,cells,detail,coverage,extinction,erosion,noiseLow,noiseHigh].every(Number.isFinite))throw Error('Finite cloud inputs required');
 const h=(altitude-1500)/1900,ext=Math.max(0,extinction);if(h<=0||h>=1||ext<=0)return 0;
 const cov=clamp(coverage+(weather-.5)*1.18),top=mix(.56,1,smooth(.3,.76,weather));
 const profile=smooth(0,.08,h)*(1-smooth(top*.55,top,h)),body=clamp(base+(cells-.5)*.055),threshold=mix(noiseHigh,noiseLow,cov);
 let density=smooth(threshold,threshold+.105,mix(noiseLow*.6,body,profile))*profile;
 if(!cheap&&density>0){const e=clamp(detail)*clamp(erosion,0,.95)*(1-density*.80);density=clamp((density-e)/Math.max(1-e,.05));}
 return density*ext;
}
/** Positive upward-ray interval in the existing planet-height model, not scene fog. */
export function cloudR86UpwardInterval(cameraHeight,verticalDirection){
 if(![cameraHeight,verticalDirection].every(Number.isFinite))throw Error('Finite cloud ray inputs required');
 if(cameraHeight<=-6371000||verticalDirection<-1||verticalDirection>1)throw Error('Cloud camera radius and normalized ray required');
 if(cameraHeight>=3400||verticalDirection<=.012)return null;
 const radius=6371000+cameraHeight,b=radius*verticalDirection;
 const distance=height=>{const c=(height-cameraHeight)*(2*6371000+height+cameraHeight);return c/(b+Math.sqrt(Math.max(0,b*b+c)));};
 return{near:cameraHeight>=1500?0:distance(1500),far:distance(3400)};
}
/** Standard front-to-back emission/absorption reference; dome stores T, not opacity. */
export function integrateR86CloudSegments(segments,sky){
 if(!Array.isArray(segments)||!Array.isArray(sky)||sky.length!==3||!sky.every(Number.isFinite))throw Error('Finite cloud integration inputs required');
 let transmittance=1;const radiance=[0,0,0];
 for(const {extinction,length,source}of segments){
  if(![extinction,length,...(source||[])].every(Number.isFinite)||!Array.isArray(source)||source.length!==3)throw Error('Finite cloud segment required');
  if(extinction<0||length<0)throw Error('Cloud extinction and length must be nonnegative');
  const stepT=Math.exp(-extinction*length),weight=transmittance*(1-stepT);
  for(let c=0;c<3;c++)radiance[c]+=weight*source[c];transmittance*=stepT;
 }
 transmittance=clamp(transmittance);return{transmittance,opacity:1-transmittance,radiance,color:radiance.map((v,c)=>v+sky[c]*transmittance)};
}
/** Evaluate self-contained existing shader declarations only; never boot the app. */
export function extractR86CloudShaderSources(source){
 const start=source.indexOf('  // client/web/src/game/relief.js'),end=source.indexOf('\n  var FX_VS =',start);
 assert.ok(start>=0&&end>start,'Cloud shader export anchors required');
 const context=createContext({});
 new Script(source.slice(start,end)+'\nglobalThis.exportedClouds={vertex:FULLSCREEN_VS,noise:NOISE_FS,domeHDR:domeFS(hdrDefines(true)),domeFallback:domeFS(hdrDefines(false)),skyHDR:skyFS(hdrDefines(true)),skyFallback:skyFS(hdrDefines(false))};').runInContext(context,{timeout:2000});
 return{...context.exportedClouds};
}

/** Controlled actual-cloud-shader fixture; not a final map or FPS acceptance. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {normalizeR86Clouds,patchR86Clouds,extractR86CloudShaderSources} from './patch_r86_clouds.mjs';

export function makeR86CloudGate(source){
 const before=normalizeR86Clouds(source),after=patchR86Clouds(before),sha=s=>createHash('sha256').update(s).digest('hex');
 const payload={before:extractR86CloudShaderSources(before),after:extractR86CloudShaderSources(after),beforeSha256:sha(before),afterSha256:sha(after)};
 return `<!doctype html><html lang="en"><meta charset="utf-8"><title>R86 cloud shader checks</title>
<style>body{max-width:1100px;margin:24px auto;background:#101922;color:#e5edf4;font:14px system-ui}canvas{display:block;width:100%;height:auto}pre{white-space:pre-wrap}.labels{display:grid;grid-template-columns:1fr 1fr;text-align:center;margin:12px}</style>
<h1>Actual R8.6 cloud shader comparison</h1><p>Same production noise generator, camera and light. Top: sky through actual dome/sky shaders, displayed with diagnostic Reinhard exposure. Bottom: dome transmittance T (white = clear). Production remains linear HDR with its own unchanged composite. This fixture does not measure game FPS.</p>
<div class="labels"><b>Before cloud refinement</b><b>After original cloud refinement</b></div><canvas id="clouds" width="1000" height="520"></canvas><pre id="result">Starting…</pre>
<script>(${run.toString()})(${JSON.stringify(payload)});</script></html>`;
}

function run(payload){
 const canvas=document.getElementById('clouds'),gl=canvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true});
 const result={schema:'TankForgeR86ActualCloudShaderGateV1',passed:false,scope:'actual production noise/dome/sky shader fixture; not whole-game visual or hardware FPS acceptance',beforeSha256:payload.beforeSha256,afterSha256:payload.afterSha256,checks:{},programs:[],errors:[]};
 const resources={textures:[],fbos:[],programs:[],vaos:[]};
 function check(name,passed,detail){result.checks[name]={passed:!!passed,detail};if(!passed)throw Error(name+' failed');}
 function compile(name,vs,fs){
  const shaders=[];let p=null;
  try{for(const[type,source]of[[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(name+': '+gl.getShaderInfoLog(s));}
   p=gl.createProgram();for(const s of shaders)gl.attachShader(p,s);gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(name+': '+gl.getProgramInfoLog(p));resources.programs.push(p);result.programs.push(name);return p;
  }catch(error){if(p)gl.deleteProgram(p);throw error;}finally{for(const s of shaders)gl.deleteShader(s);}
 }
 function set(p,n,fn,...values){const u=gl.getUniformLocation(p,n);if(u!==null)gl[fn](u,...values);}
 function bind(unit,target,tex){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(target,tex);}
 function target(width,height,float=false,data=null){
  const tex=gl.createTexture();resources.textures.push(tex);bind(7,gl.TEXTURE_2D,tex);gl.texImage2D(gl.TEXTURE_2D,0,float?gl.RGBA16F:gl.RGBA8,width,height,0,gl.RGBA,float?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,data);
  for(const n of[gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,n,gl.LINEAR);for(const n of[gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,n,gl.CLAMP_TO_EDGE);
  const fbo=gl.createFramebuffer();resources.fbos.push(fbo);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('incomplete cloud fixture target');return{tex,fbo,width,height,float};
 }
 const sun=[.18,.37,.9115],sunE=[2.4,2.2,1.9],ambient=[.28,.38,.55],eye=[0,100,0],forward=[0,.35,1],right=[1,0,0],up=[0,1,-.35],tan=[1,.55];
 let noise,noiseRange,history;
 function drawDome(p,out,{extinction=.022,coverage=.57,blend=1,prev=history,steps=24,cameraHeight=100}={}){
  gl.bindFramebuffer(gl.FRAMEBUFFER,out.fbo);gl.viewport(0,0,out.width,out.height);gl.useProgram(p);bind(0,gl.TEXTURE_3D,noise);bind(1,gl.TEXTURE_2D,prev.tex);
  set(p,'uNoise','uniform1i',0);set(p,'uPrev','uniform1i',1);set(p,'uNoiseRange','uniform2fv',noiseRange);set(p,'uWind','uniform3fv',[1500,0,-700]);set(p,'uCloud','uniform4fv',[coverage,.2,extinction,.55]);
  set(p,'uSunDir','uniform3fv',sun);set(p,'uSunE','uniform3fv',sunE);set(p,'uSkyAmb','uniform3fv',ambient);set(p,'uCamPos','uniform3fv',[eye[0],cameraHeight,eye[2]]);set(p,'uISun','uniform1f',22);set(p,'uSteps','uniform1i',steps);set(p,'uBlend','uniform1f',blend);set(p,'uSeed','uniform1f',0);gl.drawArrays(gl.TRIANGLES,0,3);
 }
 function drawSky(p,dome,out){
  gl.bindFramebuffer(gl.FRAMEBUFFER,out.fbo);gl.viewport(0,0,out.width,out.height);gl.useProgram(p);bind(2,gl.TEXTURE_2D,dome.tex);set(p,'uDomeA','uniform1i',2);set(p,'uDomeB','uniform1i',2);set(p,'uDomeMix','uniform1f',0);
  for(const[n,v]of[['uForward',forward],['uRight',right],['uUp',up],['uSunDir',sun],['uSunE',sunE]])set(p,n,'uniform3fv',v);set(p,'uTan','uniform2fv',tan);gl.drawArrays(gl.TRIANGLES,0,3);
 }
 function read(out){gl.bindFramebuffer(gl.FRAMEBUFFER,out.fbo);const data=out.float?new Float32Array(out.width*out.height*4):new Uint8Array(out.width*out.height*4);gl.readPixels(0,0,out.width,out.height,gl.RGBA,out.float?gl.FLOAT:gl.UNSIGNED_BYTE,data);return data;}
 function alphaStats(data,float=false){const a=[];for(let i=3;i<data.length;i+=4)a.push(data[i]/(float?1:255));return{min:Math.min(...a),max:Math.max(...a),mean:a.reduce((x,y)=>x+y,0)/a.length};}
 try{
  check('webgl2',!!gl,null);result.renderer=gl.getParameter(gl.RENDERER);const vao=gl.createVertexArray();resources.vaos.push(vao);gl.bindVertexArray(vao);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);
  const programs={};for(const name of['domeHDR','domeFallback','skyHDR','skyFallback'])programs[name]=compile('after-'+name,payload.after.vertex,payload.after[name]);
  const oldDome=compile('before-domeFallback',payload.before.vertex,payload.before.domeFallback),oldSky=compile('before-skyFallback',payload.before.vertex,payload.before.skyFallback),noiseProgram=compile('production-noise',payload.after.vertex,payload.after.noise);
  noise=gl.createTexture();resources.textures.push(noise);bind(0,gl.TEXTURE_3D,noise);const size=24;gl.texStorage3D(gl.TEXTURE_3D,1,gl.RGBA8,size,size,size);for(const n of[gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_3D,n,gl.LINEAR);for(const n of[gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,n,gl.REPEAT);
  const noiseFbo=gl.createFramebuffer();resources.fbos.push(noiseFbo);gl.bindFramebuffer(gl.FRAMEBUFFER,noiseFbo);gl.viewport(0,0,size,size);gl.useProgram(noiseProgram);const hist=new Uint32Array(256),px=new Uint8Array(size*size*4);
  for(let z=0;z<size;z++){gl.framebufferTextureLayer(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,noise,0,z);set(noiseProgram,'uSlice','uniform1f',(z+.5)/size);gl.drawArrays(gl.TRIANGLES,0,3);if(z%3===0){gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,px);for(let i=0;i<px.length;i+=4)hist[px[i]]++;}}
  const total=hist.reduce((a,b)=>a+b,0),percentile=f=>{let sum=0;for(let i=0;i<256;i++){sum+=hist[i];if(sum>=total*f)return i/255;}return 1;};noiseRange=[percentile(.06),percentile(.985)];result.noise={size,thresholds:noiseRange,source:'unchanged production NOISE_FS'};
  history=target(1,1,false,new Uint8Array([0,0,0,64]));const before=target(256,256),after=target(256,256),viewBefore=target(500,260),viewAfter=target(500,260);drawDome(oldDome,before);drawDome(programs.domeFallback,after);drawSky(oldSky,before,viewBefore);drawSky(programs.skyFallback,after,viewAfter);
  const oldPixels=read(before),newPixels=read(after),skyPixels=read(viewAfter),a=alphaStats(newPixels);let changed=0;for(let i=0;i<oldPixels.length;i+=4)if(Math.abs(oldPixels[i+3]-newPixels[i+3])>1)changed++;
  check('cloud_density_changed_with_bounded_T',a.min<.7&&a.max<=1&&a.min>=0&&changed>100,{...a,changedPixels:changed});check('sky_final_alpha_opaque',skyPixels.filter((_,i)=>i%4===3).every(v=>v===255),null);
  const empty=target(24,24),blend=target(24,24);drawDome(programs.domeFallback,empty,{extinction:0});check('zero_extinction_is_clear',alphaStats(read(empty)).min===1,alphaStats(read(empty)));
  drawDome(programs.domeFallback,blend,{extinction:0,blend:.4});const blendAlpha=alphaStats(read(blend)),expected=.6*(64/255)+.4;check('temporal_alpha_stays_transmittance',Math.abs(blendAlpha.mean-expected)<=1/255,{...blendAlpha,expected});
  const altitudeProbe=target(64,64),altitudes=[];for(const cameraHeight of[650,2100,5000]){drawDome(programs.domeFallback,altitudeProbe,{cameraHeight});const stats=alphaStats(read(altitudeProbe));altitudes.push({cameraHeight,...stats});check('camera_altitude_'+cameraHeight,cameraHeight>=3400?stats.min===1:stats.min<.8,{cameraHeight,...stats});}result.altitudes=altitudes;
  const floatSupported=!!gl.getExtension('EXT_color_buffer_float');check('float_HDR_target_supported',floatSupported,null);const hdr=target(32,32,true),hdrSky=target(32,32,true);drawDome(programs.domeHDR,hdr);const hdrPixels=read(hdr);check('HDR_dome_finite',hdrPixels.every(Number.isFinite)&&alphaStats(hdrPixels,true).min>=0&&alphaStats(hdrPixels,true).max<=1,alphaStats(hdrPixels,true));drawSky(programs.skyHDR,hdr,hdrSky);const hs=read(hdrSky);check('HDR_sky_finite_opaque',hs.every(Number.isFinite)&&alphaStats(hs,true).min===1,null);
  const display=compile('diagnostic-display',payload.after.vertex,`#version 300 es\nprecision highp float;in vec2 vNdc;uniform sampler2D uImage,uMask;uniform int uMode;out vec4 outColor;void main(){vec2 uv=vNdc*.5+.5;vec3 c;if(uMode==0){c=texture(uImage,uv).rgb;c=c*c*16.0;c=pow(c/(1.0+c),vec3(1.0/2.2));}else{vec3 d=normalize(vec3(0.0,.35,1.0)+vec3(1.0,0.0,0.0)*vNdc.x+vec3(0.0,1.0,-.35)*vNdc.y*.55);vec2 m=.5+.5*d.xz/((1.0+max(d.y,-.2))*1.06);c=vec3(texture(uMask,m).a);}outColor=vec4(c,1.0);}`);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(display);set(display,'uImage','uniform1i',3);set(display,'uMask','uniform1i',4);
  for(const[col,v,d]of[[0,viewBefore,before],[1,viewAfter,after]])for(let row=0;row<2;row++){bind(3,gl.TEXTURE_2D,v.tex);bind(4,gl.TEXTURE_2D,d.tex);set(display,'uMode','uniform1i',row);gl.viewport(col*500,(1-row)*260,500,260);gl.drawArrays(gl.TRIANGLES,0,3);}
  check('no_GL_error',gl.getError()===gl.NO_ERROR,null);result.passed=true;
 }catch(error){result.failure=String(error?.stack||error);}finally{
  if(gl){for(const x of resources.programs)gl.deleteProgram(x);for(const x of resources.textures)gl.deleteTexture(x);for(const x of resources.fbos)gl.deleteFramebuffer(x);for(const x of resources.vaos)gl.deleteVertexArray(x);}
  window.__TF_R86_CLOUD_GATE__=result;document.getElementById('result').textContent=JSON.stringify(result,null,2);document.title=(result.passed?'PASS':'FAIL')+' R86 cloud checks';
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const[input,output]=process.argv.slice(2);if(!input||!output)throw Error('Use <current app> <new cloud-gate.html>');fs.writeFileSync(output,makeR86CloudGate(fs.readFileSync(input,'utf8')),{flag:'wx'});
}

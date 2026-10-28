/** Standalone automatic compile/link/readback gate for actual R8 shader variants.
 * It does not load the app, mutate a live game, accept visuals, or measure FPS.
 */
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

export function makeR8ShaderWebglGate(shaders) {
  for (const key of ['vertex', 'fragmentHDR', 'fragmentFallback']) {
    if (typeof shaders[key] !== 'string' || !shaders[key].startsWith('#version 300 es') || shaders[key].includes('${')) throw Error(`Expected actual evaluated GLSL source: ${key}`);
  }
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>TankForge R8 actual surface shader gate</title>
<style>body{margin:24px;background:#172027;color:#d9e4ed;font:14px system-ui}canvas{display:block;width:768px;height:256px;border:1px solid #667481;max-width:100%}pre{white-space:pre-wrap}p{max-width:900px}</style>
<h1>TankForge R8 actual surface shader gate</h1><p>Rows: HDR and RGBA8 fallback. Columns: near terrain, far terrain, registered water, painted tank, textured aircraft, replay cutaway. This fixture checks compilation and nonblack readback. Visual approval and hardware performance remain separate.</p>
<canvas id="gate" width="768" height="256"></canvas><pre id="result">Starting…</pre>
<script>const SHADERS = ${JSON.stringify(shaders)};\n(${runGate.toString()})(SHADERS);</script></html>`;
}

function runGate(shaders) {
  const result = {schema:'tankforge-r8-webgl2-surface-gate-v1', pass:false, webglAvailable:false, variants:[], visualAccepted: false, hardwarePerformanceMeasured:false};
  const canvas = document.getElementById('gate');
  const gl = canvas.getContext('webgl2', {alpha:false, antialias:false, preserveDrawingBuffer:true});
  const programs = [], textures = [];
  let vao = null, buffer = null;
  function publish() {
    window.__TF_R8_SHADER_GATE__ = result;
    document.getElementById('result').textContent = JSON.stringify(result, null, 2);
    document.title = (result.pass ? 'PASS' : 'FAIL') + ' — TankForge R8 shader gate';
  }
  function compileShader(type, source) {
    const shader = gl.createShader(type);
    if (!shader) throw Error('Shader allocation failed');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw Error('Actual GLSL compile failed: ' + message);
    }
    return shader;
  }
  function compileProgram(vs, fs) {
    let vertex = null, fragment = null, program = null;
    try {
      vertex = compileShader(gl.VERTEX_SHADER, vs);
      fragment = compileShader(gl.FRAGMENT_SHADER, fs);
      program = gl.createProgram();
      if (!program) throw Error('Program allocation failed');
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error('Actual shader link failed: ' + gl.getProgramInfoLog(program));
      programs.push(program);
      return program;
    } catch(error) {
      if (program) gl.deleteProgram(program);
      throw error;
    } finally {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
    }
  }
  function texture(unit, target) {
    const tex = gl.createTexture();
    if (!tex) throw Error('Texture allocation failed');
    textures.push(tex);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, tex);
    gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }
  try {
    if (!gl) throw Error('WebGL2 is unavailable');
    result.webglAvailable = true;
    result.version = gl.getParameter(gl.VERSION);
    result.renderer = gl.getParameter(gl.RENDERER);
    texture(0, gl.TEXTURE_2D);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, 1, 1, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, new Uint32Array([0xffffffff]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    texture(1, gl.TEXTURE_2D);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([180,170,150,255]));
    texture(2, gl.TEXTURE_3D);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,0]));
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const data = [];
    for (const [x,z] of [[-1,-1],[1,-1],[1,1],[-1,-1],[1,1],[-1,1]]) data.push(x,0,z, 0,1,0, 0.24,0.30,0.13, 0.55,0.15, (x+1)*0.5,(z+1)*0.5);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    for (const [location,size,offset] of [[0,3,0],[1,3,12],[2,3,24],[3,2,36],[4,2,44]]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 52, offset);
    }
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    // A missing transform must remain black and fail readback, not pass as
    // the old nonblack clear color. Support both legacy and precise shaders.
    gl.clearColor(0,0,0,1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const identity = new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
    const topDown = new Float32Array([1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,1]);
    for (const [row, name] of ['fragmentHDR','fragmentFallback'].entries()) {
      const variant = {name, compiled:false, linked:false, fixtures:[]};
      result.variants.push(variant);
      const program = compileProgram(shaders.vertex, shaders[name]);
      variant.compiled = true;
      variant.linked = true;
      gl.useProgram(program);
      const set = (name,method,...args) => {
        const location = gl.getUniformLocation(program,name);
        if(location !== null) gl[method](location,...args);
      };
      const active = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
      for (let i=0;i<active;i++) {
        const info = gl.getActiveUniform(program,i);
        if(info.type===gl.SAMPLER_2D_SHADOW) set(info.name,'uniform1i',0);
        else if(info.type===gl.SAMPLER_2D) set(info.name,'uniform1i',1);
        else if(info.type===gl.SAMPLER_3D) set(info.name,'uniform1i',2);
      }
      set('uModel','uniformMatrix4fv',false,identity);
      set('uViewProj','uniformMatrix4fv',false,topDown);
      set('uLightVP','uniformMatrix4fv',false,identity);
      set('uModelViewProj','uniformMatrix4fv',false,topDown);
      set('uModelLightVP','uniformMatrix4fv',false,identity);
      for(const [name,value] of Object.entries({uInstanced:0,uTerrain:0,uTerrainFine:0.15,uMapOn:0,uScroll:0,uAlpha:1,uDirtHeight:1.5,uWet:0.6,uNormOn:0,uArmorChem:0,uAircraftShell:0,uClock:12})) set(name,'uniform1f',value);
      for(const [name,value] of Object.entries({uZoneCount:0,uArmorN:0})) set(name,'uniform1i',value);
      for(const [name,value] of Object.entries({uCamPos:[0,4,4],uSunDir:[0.3,0.9,0.2],uSunColor:[0.6,0.55,0.5],uSkyColor:[0.25,0.3,0.4],uGroundColor:[0.11,0.1,0.06],uMud:[0.115,0.095,0.065],uWind:[0,0,0]})) set(name,'uniform3fv',value);
      set('uNoiseRange','uniform2f',0.2,0.8);
      for(const [name,value] of Object.entries({uCloud:[0.3,0,0.022,0.55],uHighlight:[0,0,0,0],uRoad:[0,0,0,0],uHole:[0,0,0,0],uDeformWin:[0,0,128,1/128],uMapRect:[0,0,1,2],uArmorShell:[0,0,90,0]})) set(name,'uniform4fv',value);
      for(const [column, kind] of [2,20,22,0,18,18].entries()) {
        set('uKind','uniform1i',kind);
        set('uReplayCutaway','uniform1f',column===5 ? 1 : 0);
        gl.viewport(column*128,row*128,128,128);
        gl.drawArrays(gl.TRIANGLES,0,6);
        const pixel = new Uint8Array(4);
        gl.readPixels(column*128+64,row*128+64,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
        const error = gl.getError();
        const pass = error===gl.NO_ERROR && pixel[0]+pixel[1]+pixel[2]>4;
        variant.fixtures.push({kind,replayCutaway:column===5,pixel:Array.from(pixel),glError:error,pass});
      }
    }
    result.pass = result.variants.length===2 && result.variants.every(v=>v.compiled&&v.linked&&v.fixtures.length===6&&v.fixtures.every(f=>f.pass));
    result.renderReadback = result.pass;
  } catch(error) {
    result.error = String(error?.stack || error);
  } finally {
    if (gl) {
      for(const program of programs) gl.deleteProgram(program);
      for(const tex of textures) gl.deleteTexture(tex);
      if(buffer) gl.deleteBuffer(buffer);
      if(vao) gl.deleteVertexArray(vao);
    }
    publish();
  }
}

if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  const [input, output] = process.argv.slice(2);
  if(!input || !output) throw Error('Usage: node build_r8_shader_webgl_gate.mjs <actual-shaders.json> <gate.html>');
  await writeFile(output, makeR8ShaderWebglGate(JSON.parse(await readFile(input,'utf8'))), {flag:'wx'});
  process.stdout.write(`Wrote automatic WebGL2 gate ${path.resolve(output)}; graphical execution still required.\n`);
}

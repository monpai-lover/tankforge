import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script} from 'node:vm';
import {patchR8SurfaceShaders,extractR8ShaderSources} from '../patch_r8_surface_shaders.mjs';
import {makeR8ShaderWebglGate} from '../build_r8_shader_webgl_gate.mjs';
import {makeR8ShaderComparison} from '../build_r8_shader_comparison.mjs';
const before=await readFile(new URL('./fixtures/r8-original-shader-app.js.html',import.meta.url),'utf8');
const after=patchR8SurfaceShaders(before),shaders=extractR8ShaderSources(after);

test('automatic graphical gate embeds exact actual variants and reports separate compile/render outcomes',()=>{
  const html=makeR8ShaderWebglGate(shaders);
  assert.ok(html.includes(JSON.stringify(shaders)));
  for(const text of ['window.__TF_R8_SHADER_GATE__','getShaderParameter(shader, gl.COMPILE_STATUS)','getProgramParameter(program, gl.LINK_STATUS)','readPixels(','gl.getError(','deleteProgram(','deleteShader(','deleteTexture(','visualAccepted: false']) assert.ok(html.includes(text),text);
  new Script(html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>')));
});
test('graphical gate rejects missing or unevaluated source',()=>{
  assert.throws(()=>makeR8ShaderWebglGate({}),/shader|GLSL|source/i);
  assert.throws(()=>makeR8ShaderWebglGate({...shaders,fragmentHDR:'${notEvaluated}'}),/shader|GLSL|source/i);
});
test('paired fixture uses actual before/after materials, main composite, and synchronized moving cameras',()=>{
  const html=makeR8ShaderComparison(before,after);
  for(const text of ['tfR8WaterGradient','float hx = fbm(q1','const mat3 ACES_IN','uExposure','window.__TF_R8_SHADER_COMPARE__','requestAnimationFrame','setTime','visualAccepted:false','hardwarePerformanceMeasured:false','deleteFramebuffer','close terrain','steep terrain','water']) assert.ok(html.includes(text),text);
  new Script(html.slice(html.indexOf('<script>')+8,html.lastIndexOf('</script>')));
});
test('comparison rejects a pair with unchanged surface shaders',()=>{
  assert.throws(()=>makeR8ShaderComparison(before,before),/distinct|differ|change/i);
});

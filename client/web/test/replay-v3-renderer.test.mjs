import test from 'node:test';
import assert from 'node:assert/strict';
import {Renderer} from '../src/gfx/renderer.js';
import {ReplayDraw, ReplayGpu} from '../src/gfx/replayDraw.js';
import {Node, lookAtLH} from '../src/gfx/math.js';

// GL is the only substituted boundary. Production owners perform sorting,
// allocation, caching, upload, drawing, and cleanup; this sink records effects.
function fakeGL(options = {}) {
  const gl = Object.fromEntries([
    'FRAMEBUFFER', 'READ_FRAMEBUFFER', 'DRAW_FRAMEBUFFER', 'RENDERBUFFER',
    'FRAMEBUFFER_BINDING', 'READ_FRAMEBUFFER_BINDING', 'DRAW_FRAMEBUFFER_BINDING',
    'RENDERBUFFER_BINDING', 'VIEWPORT', 'SCISSOR_BOX', 'SCISSOR_TEST', 'BLEND',
    'BLEND_SRC_RGB', 'BLEND_DST_RGB', 'BLEND_SRC_ALPHA', 'BLEND_DST_ALPHA',
    'BLEND_EQUATION_RGB', 'BLEND_EQUATION_ALPHA', 'DEPTH_TEST', 'DEPTH_WRITEMASK',
    'DEPTH_FUNC', 'ACTIVE_TEXTURE', 'CURRENT_PROGRAM', 'VERTEX_ARRAY_BINDING',
    'ARRAY_BUFFER', 'ARRAY_BUFFER_BINDING', 'TEXTURE_BINDING_2D', 'TEXTURE_2D',
    'TEXTURE_3D', 'RGBA16F', 'RGBA8', 'DEPTH_COMPONENT24', 'MAX_SAMPLES', 'SAMPLES',
    'COLOR_ATTACHMENT0', 'DEPTH_ATTACHMENT', 'FRAMEBUFFER_COMPLETE',
    'FRAMEBUFFER_UNSUPPORTED', 'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER',
    'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T', 'LINEAR', 'NEAREST', 'CLAMP_TO_EDGE',
    'SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA', 'ONE', 'ZERO', 'DST_ALPHA',
    'ONE_MINUS_DST_ALPHA', 'LESS', 'GREATER', 'LEQUAL', 'FUNC_ADD',
    'FUNC_SUBTRACT', 'FUNC_REVERSE_SUBTRACT', 'TRIANGLES', 'TRIANGLE_STRIP',
    'POINTS', 'FLOAT', 'UNSIGNED_INT', 'STATIC_DRAW', 'DYNAMIC_DRAW', 'CULL_FACE',
    'VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS', 'ACTIVE_UNIFORMS',
    'RG16F', 'R32F', 'RG', 'RED', 'RGBA', 'UNSIGNED_BYTE', 'DEPTH_COMPONENT',
    'TEXTURE_COMPARE_MODE', 'COMPARE_REF_TO_TEXTURE', 'TEXTURE_COMPARE_FUNC',
    'NONE', 'RGBA32F', 'TEXTURE_WRAP_R', 'REPEAT', 'LINEAR_MIPMAP_LINEAR', 'UNPACK_FLIP_Y_WEBGL',
  ].map((name, index) => [name, 100 + index]));
  Object.assign(gl, {TEXTURE0: 1000, COLOR_BUFFER_BIT: 1, DEPTH_BUFFER_BIT: 2});
  const calls = [], live = new Set(), deleted = [];
  let id = 0, allocation = 0, compiled = 0, linked = 0;
  const state = {
    read: null, draw: null, renderbuffer: null, arrayBuffer: null, vao: null,
    program: null, activeTexture: gl.TEXTURE0, textures: new Map(),
    viewport: [0, 0, 1280, 720], scissor: [0, 0, 1280, 720],
    enabled: new Set([gl.DEPTH_TEST]), depthMask: true, depthFunc: gl.LESS,
    blend: [gl.ONE, gl.ZERO, gl.ONE, gl.ZERO], blendEquation: [gl.FUNC_ADD, gl.FUNC_ADD],
  };
  const op = (name, data = {}) => {
    const call = {name, ...data}; calls.push(call);
    if (options.throwOn?.(call)) throw options.error || new Error(`injected ${name}`);
    return call;
  };
  const create = kind => {
    const nth = ++allocation;
    if (options.failAllocation === nth) {
      op('create', {kind, handle: null, allocation: nth});
      if (options.failMode === 'throw') throw options.error || new Error('injected allocation');
      return null;
    }
    const handle = {id: ++id, kind};
    if (kind === 'framebuffer') handle.attachments = new Map();
    live.add(handle); op('create', {kind, handle, allocation: nth}); return handle;
  };
  const remove = (kind, handle) => {
    if (!handle) return;
    assert.equal(handle.kind, kind, `delete ${kind} receives a matching GL handle`);
    if (options.contextLost) { live.delete(handle); op('deleteLostHandle', {kind, handle}); return; }
    assert.ok(live.delete(handle), `${kind} ${handle.id} is deleted exactly once`);
    deleted.push(handle); op('delete', {kind, handle});
  };
  for (const [suffix, kind] of [['Texture', 'texture'], ['Framebuffer', 'framebuffer'],
    ['Renderbuffer', 'renderbuffer'], ['Buffer', 'buffer'], ['VertexArray', 'vao'], ['Program', 'program'], ['Shader', 'shader']]) {
    gl[`create${suffix}`] = () => create(kind); gl[`delete${suffix}`] = handle => remove(kind, handle);
  }
  gl.shaderSource = (shader, source) => { assert.ok(shader); shader.source = source; op('shaderSource', {shader}); };
  gl.compileShader = shader => { shader.compiled = ++compiled !== options.failCompile; op('compileShader', {shader}); };
  gl.getShaderParameter = shader => shader.compiled;
  gl.getShaderInfoLog = () => 'injected compiler failure';
  gl.attachShader = (p, shader) => { assert.ok(p && shader); (p.shaders ||= []).push(shader); op('attachShader', {program: p, shader}); };
  gl.linkProgram = p => {
    p.linked = ++linked !== options.failLink; p.label = `compiled:${linked}`;
    p.uniforms = [...new Set((p.shaders || []).flatMap(s => [...s.source.matchAll(/uniform\s+\w+\s+(\w+)/g)].map(m => m[1])))];
    op('linkProgram', {program: p});
  };
  gl.getProgramParameter = (p, pname) => pname === gl.LINK_STATUS ? p.linked : p.uniforms.length;
  gl.getProgramInfoLog = () => 'injected linker failure';
  gl.getActiveUniform = (p, index) => { op('getActiveUniform', {program: p, index}); return {name: p.uniforms[index]}; };
  gl.getUniformLocation = (p, name) => name;
  const bound = target => target === gl.READ_FRAMEBUFFER ? state.read : state.draw;
  gl.bindFramebuffer = (target, handle) => {
    if (target !== gl.DRAW_FRAMEBUFFER) state.read = handle;
    if (target !== gl.READ_FRAMEBUFFER) state.draw = handle;
    op('bindFramebuffer', {target, handle});
  };
  gl.bindRenderbuffer = (target, handle) => { state.renderbuffer = handle; op('bindRenderbuffer', {handle}); };
  gl.bindTexture = (target, handle) => { state.textures.set(`${state.activeTexture}:${target}`, handle); op('bindTexture', {target, handle}); };
  gl.activeTexture = unit => { state.activeTexture = unit; op('activeTexture', {unit}); };
  gl.texStorage2D = (target, levels, format, w, h) => {
    const handle = state.textures.get(`${state.activeTexture}:${target}`);
    op('texStorage2D', {handle, format, w, h});
    assert.ok(handle && live.has(handle), 'texture storage requires a live texture');
    handle.storage = {format, w, h, samples: 0};
  };
  gl.texParameteri = () => {};
  gl.texImage2D = (target, level, format, w, h) => {
    const handle = state.textures.get(`${state.activeTexture}:${target}`);
    assert.ok(handle && live.has(handle)); handle.storage = {format, w, h, samples: 0};
  };
  gl.texStorage3D = (target, levels, format, w, h, d) => {
    const handle = state.textures.get(`${state.activeTexture}:${target}`);
    assert.ok(handle && live.has(handle)); handle.storage = {format, w, h, d, samples: 0};
  };
  for (const name of ['texSubImage2D', 'drawBuffers', 'readBuffer', 'generateMipmap', 'pixelStorei']) gl[name] = () => {};
  gl.readPixels = (x, y, w, h, format, type, destination) => destination.fill(128);
  gl.getExtension = () => ({});
  gl.framebufferTexture2D = (target, attachment, textureTarget, handle) => {
    const fbo = bound(target); assert.ok(fbo && live.has(fbo));
    fbo.attachments.set(attachment, handle); op('attachTexture', {fbo, attachment, handle});
  };
  gl.framebufferTextureLayer = (target, attachment, handle) => {
    const fbo = bound(target); assert.ok(fbo && live.has(fbo)); fbo.attachments.set(attachment, handle);
  };
  gl.renderbufferStorageMultisample = (target, samples, format, w, h) => {
    const handle = state.renderbuffer; op('multisampleStorage', {handle, samples, format, w, h});
    assert.ok(handle && live.has(handle)); handle.storage = {samples, format, w, h};
  };
  gl.renderbufferStorage = (target, format, w, h) => {
    assert.ok(state.renderbuffer && live.has(state.renderbuffer));
    state.renderbuffer.storage = {samples: 0, format, w, h};
  };
  gl.framebufferRenderbuffer = (target, attachment, renderbufferTarget, handle) => {
    const fbo = bound(target); assert.ok(fbo && live.has(fbo));
    fbo.attachments.set(attachment, handle); op('attachRenderbuffer', {fbo, attachment, handle});
  };
  const complete = fbo => {
    if (!fbo) return true;
    const color = fbo.attachments.get(gl.COLOR_ATTACHMENT0), depth = fbo.attachments.get(gl.DEPTH_ATTACHMENT);
    if (!color?.storage || !depth?.storage || !live.has(color) || !live.has(depth)) return false;
    return color.storage.w === depth.storage.w && color.storage.h === depth.storage.h && color.storage.samples === depth.storage.samples;
  };
  gl.checkFramebufferStatus = target => {
    const fbo = bound(target);
    const result = options.status?.(fbo, gl) ?? (complete(fbo) ? gl.FRAMEBUFFER_COMPLETE : gl.FRAMEBUFFER_UNSUPPORTED);
    op('checkFramebufferStatus', {fbo, result}); return result;
  };
  gl.getInternalformatParameter = (target, format) => {
    op('supportedSamples', {format});
    return new Int32Array(format === gl.DEPTH_COMPONENT24 ? options.depthSamples ?? [8, 4, 2] : options.colorSamples ?? [8, 4, 2]);
  };
  gl.getParameter = pname => {
    const values = new Map([
      [gl.FRAMEBUFFER_BINDING, state.draw], [gl.READ_FRAMEBUFFER_BINDING, state.read],
      [gl.DRAW_FRAMEBUFFER_BINDING, state.draw], [gl.RENDERBUFFER_BINDING, state.renderbuffer],
      [gl.VIEWPORT, [...state.viewport]], [gl.SCISSOR_BOX, [...state.scissor]],
      [gl.BLEND_SRC_RGB, state.blend[0]], [gl.BLEND_DST_RGB, state.blend[1]],
      [gl.BLEND_SRC_ALPHA, state.blend[2]], [gl.BLEND_DST_ALPHA, state.blend[3]],
      [gl.BLEND_EQUATION_RGB, state.blendEquation[0]], [gl.BLEND_EQUATION_ALPHA, state.blendEquation[1]],
      [gl.DEPTH_WRITEMASK, state.depthMask], [gl.DEPTH_FUNC, state.depthFunc],
      [gl.ACTIVE_TEXTURE, state.activeTexture], [gl.CURRENT_PROGRAM, state.program],
      [gl.VERTEX_ARRAY_BINDING, state.vao], [gl.ARRAY_BUFFER_BINDING, state.arrayBuffer],
      [gl.TEXTURE_BINDING_2D, state.textures.get(`${state.activeTexture}:${gl.TEXTURE_2D}`) || null],
      [gl.MAX_SAMPLES, options.maxSamples ?? 8],
    ]);
    assert.ok(values.has(pname), `getParameter supports enum ${pname}`); return values.get(pname);
  };
  gl.isEnabled = cap => state.enabled.has(cap);
  gl.enable = cap => { state.enabled.add(cap); op('enable', {cap}); };
  gl.disable = cap => { state.enabled.delete(cap); op('disable', {cap}); };
  gl.viewport = (...rect) => { state.viewport = rect; op('viewport', {rect}); };
  gl.scissor = (...rect) => { state.scissor = rect; op('scissor', {rect}); };
  gl.depthMask = value => { state.depthMask = value; op('depthMask', {value}); };
  gl.depthFunc = value => { state.depthFunc = value; op('depthFunc', {value}); };
  gl.blendFuncSeparate = (...values) => { state.blend = values; op('blendFuncSeparate', {values}); };
  gl.blendFunc = (src, dst) => gl.blendFuncSeparate(src, dst, src, dst);
  gl.blendEquationSeparate = (...values) => { state.blendEquation = values; op('blendEquationSeparate', {values}); };
  gl.blendEquation = value => gl.blendEquationSeparate(value, value);
  gl.bindVertexArray = handle => { state.vao = handle; op('bindVertexArray', {handle}); };
  gl.bindBuffer = (target, handle) => { state.arrayBuffer = handle; op('bindBuffer', {handle}); };
  gl.bufferData = (target, data) => op('bufferData', {handle: state.arrayBuffer, data});
  gl.bufferSubData = (target, offset, data) => op('bufferSubData', {handle: state.arrayBuffer, offset, data: Array.from(data)});
  for (const name of ['enableVertexAttribArray', 'vertexAttribPointer', 'vertexAttribDivisor', 'vertexAttrib3f', 'vertexAttrib2f']) gl[name] = () => {};
  gl.useProgram = program => { state.program = program; op('useProgram', {program}); };
  for (const name of ['uniformMatrix4fv', 'uniform1f', 'uniform1i', 'uniform2f', 'uniform3fv', 'uniform4fv']) gl[name] = (location, ...values) => op(name, {program: state.program, location, values});
  const draw = (name, values) => {
    assert.ok(live.has(state.program), 'draw uses a program from the current context');
    assert.ok(live.has(state.vao), 'draw uses a VAO from the current context');
    return op(name, {
      values, program: state.program, vao: state.vao, fbo: state.draw,
      viewport: [...state.viewport], blend: state.enabled.has(gl.BLEND),
      blendFunction: [...state.blend], depth: state.enabled.has(gl.DEPTH_TEST), depthWrite: state.depthMask,
    });
  };
  gl.drawArrays = (...values) => draw('drawArrays', values);
  gl.drawArraysInstanced = (...values) => draw('drawArraysInstanced', values);
  gl.drawElements = (...values) => draw('drawElements', values);
  gl.blitFramebuffer = (...values) => {
    assert.ok(complete(state.read) && complete(state.draw), 'resolve uses complete source and destination');
    op('blitFramebuffer', {values, read: state.read, draw: state.draw});
  };
  gl.clearColor = (...values) => op('clearColor', {values});
  gl.clear = mask => op('clear', {mask, fbo: state.draw, depthWrite: state.depthMask, scissor: state.enabled.has(gl.SCISSOR_TEST)});
  gl.getError = () => 0;
  return Object.assign(gl, {calls, live, deleted, options, state, complete, allocations: () => allocation,
    invalidateContext: () => {
      const oldHandles = new Set(live); live.clear(); options.contextLost = true;
      state.read = state.draw = state.renderbuffer = state.arrayBuffer = state.vao = state.program = null;
      state.textures.clear(); return oldHandles;
    },
    snapshot: () => ({
      read: state.read, draw: state.draw, viewport: [...state.viewport],
      scissor: [...state.scissor], scissorOn: state.enabled.has(gl.SCISSOR_TEST),
      blendOn: state.enabled.has(gl.BLEND), blend: [...state.blend], blendEquation: [...state.blendEquation],
      depthOn: state.enabled.has(gl.DEPTH_TEST), depthMask: state.depthMask, depthFunc: state.depthFunc,
      activeTexture: state.activeTexture, program: state.program, vao: state.vao,
      arrayBuffer: state.arrayBuffer, renderbuffer: state.renderbuffer,
    }),
  });
}

function makeProgram(gl, label) {
  const p = gl.createProgram(); p.label = label;
  return {p, u: Object.fromEntries(['uModel', 'uViewProj', 'uCamPos', 'uScene', 'uExposure',
    'uDim', 'uDisc', 'uVP', 'uRes', 'uGlow', 'uTime', 'uPixel', 'uInstanced',
    'uForward', 'uRight', 'uUp', 'uTan'].map(name => [name, name]))};
}

function harness(options = {}, replay = false) {
  const gl = fakeGL(options);
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    gl, canvas: {width: 1280, height: 720}, hdrFormat: gl.RGBA16F,
    env: {exposure: 1}, exposureBias: 1, q: {msaa: 16}, pixelSize: 0,
    lit: makeProgram(gl, 'lit'), insetProg: makeProgram(gl, 'composite'), sky: makeProgram(gl, 'sky'),
    shadowTex: gl.createTexture(), skyVao: gl.createVertexArray(),
    _live: new Set(), _meshLeases: new WeakMap(), generation: 0, lost: false,
  });
  renderer._drawLit = renderer._draw.bind(renderer, renderer.lit);
  if (replay) { let n = 0; renderer._replayGpu = new ReplayGpu(gl, () => makeProgram(gl, `replay:${n++}`)); }
  gl.useProgram(renderer.lit.p); gl.calls.length = 0; return {gl, renderer};
}

function node(renderer, name, kind, x = 0, z = 0) {
  const n = new Node(name); n.kind = kind; n.pos = [x, 0, z];
  n.mesh = renderer.mesh(new Float32Array(39)); n.mesh.vao.label = name;
  n.update(); return n;
}

function camera(pos = [0, 0, -10], forward = [0, 0, 1]) {
  const view = lookAtLH(pos, forward);
  return {...view, pos, viewProj: view.view, tanX: 1, tanY: 1, near: .1, far: 100};
}

function callerState(gl) {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, gl.createFramebuffer());
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, gl.createFramebuffer());
  gl.viewport(19, 23, 800, 450); gl.scissor(31, 37, 400, 220); gl.enable(gl.SCISSOR_TEST);
  gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.DST_ALPHA, gl.ZERO, gl.ONE_MINUS_DST_ALPHA);
  gl.blendEquationSeparate(gl.FUNC_SUBTRACT, gl.FUNC_REVERSE_SUBTRACT);
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.depthFunc(gl.GREATER);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bindRenderbuffer(gl.RENDERBUFFER, gl.createRenderbuffer());
  gl.activeTexture(gl.TEXTURE0 + 9); gl.useProgram(gl.createProgram()); gl.bindVertexArray(gl.createVertexArray());
  return gl.snapshot();
}

const targetResources = gl => [...gl.live].filter(h => h.storage || h.kind === 'framebuffer' && h.attachments.size);
const targetSizes = gl => new Set(targetResources(gl).map(h => {
  const s = h.storage || h.attachments.get(gl.COLOR_ATTACHMENT0)?.storage; return s && `${s.w}x${s.h}`;
}).filter(Boolean));
const draws = gl => gl.calls.filter(c => c.name.startsWith('draw'));
const litDraws = gl => draws(gl).filter(c => c.program?.label === 'lit');

function replayFixture(renderer) {
  const root = new Node('detached target');
  const crew = root.add(node(renderer, 'crew', 0, 5, 8)); crew.replayRole = 'crew';
  const armor = root.add(node(renderer, 'armor', 0, -8, 2)); armor.replayRole = 'armor';
  const barrel = root.add(node(renderer, 'barrel', 0, 0, 3)); barrel.replayRole = 'barrel';
  const seat = root.add(node(renderer, 'seat', 0, -3, 5)); seat.replayRole = 'furnishing'; root.update();
  const target = {model: {root}, interior: () => ({nodes: [crew, seat], byCrew: [crew], byModule: new Map()})};
  const owner = new ReplayDraw(renderer, target, null);
  const trace = Object.freeze({from: Object.freeze([0, 0, 0]), to: Object.freeze([0, 0, 2]), arrived: true, width: .62, alpha: .22, kind: 4});
  const frame = Object.freeze({id: 72, physicalS: 1, traces: Object.freeze([trace]),
    staticTraces: Object.freeze([]), projectiles: Object.freeze([]), state: null, event: null});
  return {owner, frame, prepared: owner.prepare(frame), root};
}

test('transparent replay nodes sort by depth for each camera after opaque geometry', () => {
  const {gl, renderer} = harness();
  const nodes = [node(renderer, 'armor', 10, -8, 2), node(renderer, 'retained', 14, 0, 3),
    node(renderer, 'crew', 13, 5, 8), node(renderer, 'furnishing', 15, -3, 5),
    node(renderer, 'water', 7, -10, 9), node(renderer, 'glass', 6, 10, 10)];
  const original = [...nodes]; gl.calls.length = 0;
  renderer._litNodes(nodes, camera());
  assert.deepEqual(litDraws(gl).map(d => d.vao.label), ['retained', 'glass', 'water', 'crew', 'furnishing', 'armor']);
  assert.equal(litDraws(gl)[0].depthWrite, true);
  assert.ok(litDraws(gl).slice(1).every(d => d.blend && !d.depthWrite));
  assert.ok(litDraws(gl).slice(1).every(d => d.blendFunction[0] === gl.SRC_ALPHA && d.blendFunction[1] === gl.ONE_MINUS_SRC_ALPHA));
  gl.calls.length = 0;
  renderer._litNodes(nodes, camera([20, 0, 0], [-1, 0, 0]));
  assert.deepEqual(litDraws(gl).map(d => d.vao.label), ['retained', 'water', 'armor', 'furnishing', 'crew', 'glass']);
  assert.deepEqual(nodes, original, 'per-view sorting never reorders prepared source nodes');
});

test('eye depth rather than off-axis distance sorts transparent nodes and preserves equal-depth order', () => {
  const {gl, renderer} = harness();
  const nodes = [node(renderer, 'side-near', 10, 100, 2), node(renderer, 'center-far', 13, 0, 8),
    node(renderer, 'tie-first', 15, 0, 5), node(renderer, 'tie-second', 6, 3, 5)];
  gl.calls.length = 0; renderer._litNodes(nodes, camera());
  assert.deepEqual(litDraws(gl).map(d => d.vao.label), ['center-far', 'tie-first', 'tie-second', 'side-near']);
});

test('sorting transforms explicit mesh-local centers and derives off-origin source bounds', () => {
  const {gl, renderer} = harness();
  const explicit = node(renderer, 'local-center', 10, 0, 2);
  explicit.replayCenter = [0, 0, 10]; explicit.yaw = Math.PI; explicit.update();
  const derived = node(renderer, 'source-center', 13, 0, 1);
  for (let v = 0; v < 3; v++) derived.mesh._src.data[v * 13 + 2] = 9;
  const origin = node(renderer, 'origin', 15, 0, 5);
  gl.calls.length = 0; renderer._litNodes([explicit, origin, derived], camera());
  assert.deepEqual(litDraws(gl).map(d => d.vao.label), ['source-center', 'origin', 'local-center']);
});

function assertInstanceStreams(gl, gpu, prepared, writesPerBuffer) {
  const uploads = gl.calls.filter(c => c.name === 'bufferSubData');
  const streams = [[gpu.buffer, prepared.count], [gpu.dynamicBuffer, prepared.dynamicCount ?? prepared.count]];
  assert.equal(uploads.length, streams.filter(([, count]) => count).length * writesPerBuffer);
  for (const [handle, count] of streams) {
    const writes = uploads.filter(c => c.handle === handle);
    assert.equal(writes.length, count ? writesPerBuffer : 0, 'only the fixed trace and dynamic buffers receive view data');
    for (const write of writes) {
      assert.equal(write.offset, 0);
      assert.equal(write.data.length, count * 12);
      assert.ok(write.data.length <= 4096 * 12, 'every instance upload remains bounded');
    }
  }
}

test('full and corner consume one real preparation with bounded per-camera instance ordering', () => {
  const {gl, renderer} = harness({}, true);
  const {owner, frame, prepared} = replayFixture(renderer);
  assert.equal(owner.prepare(frame), prepared, 'one frame retains its prepared object');
  const originalInstances = [...prepared.instances]; gl.calls.length = 0;
  renderer.renderInset(prepared.nodes, camera(), [0, 0, 640, 360], {owner: 'replay-full', replayDraw: prepared, frame});
  renderer.renderInset(prepared.nodes, camera([20, 0, 0], [-1, 0, 0]), [900, 30, 320, 180], {owner: 'replay-corner', replayDraw: prepared, frame});
  assertInstanceStreams(gl, renderer._replayGpu, prepared, 3); // source + two distinct camera orders
  assert.equal(draws(gl).filter(c => c.program?.label?.startsWith('replay:')).length, 8, 'trace glow/core, shard, and field draw in both views');
  for (const c of draws(gl).filter(c => c.program?.label?.startsWith('replay:'))) assert.ok(c.depth && !c.depthWrite && c.blend);
  assert.deepEqual(litDraws(gl).filter(c => c.viewport[2] === 640).map(c => c.vao.label), ['barrel', 'crew', 'seat', 'armor']);
  assert.deepEqual(litDraws(gl).filter(c => c.viewport[2] === 320).map(c => c.vao.label), ['barrel', 'armor', 'seat', 'crew']);
  assert.deepEqual([...prepared.instances], originalInstances, 'view drawing leaves shared data untouched');
  for (const c of gl.calls.filter(c => c.name === 'blitFramebuffer')) {
    const lastDraw = gl.calls.findLastIndex(d => d.name.startsWith('draw') && d.fbo === c.read);
    assert.ok(lastDraw < gl.calls.indexOf(c), 'all replay draws finish before color resolve');
  }
  const allocations = gl.allocations(), uploadCount = gl.calls.filter(c => c.name === 'bufferSubData').length;
  renderer.renderInset(prepared.nodes, camera([20, 0, 0], [-1, 0, 0]), [900, 30, 320, 180], {owner: 'replay-corner', replayDraw: prepared, frame});
  assert.equal(gl.calls.filter(c => c.name === 'bufferSubData').length, uploadCount, 'repeated camera/frame reuses its ordered data');
  assert.equal(gl.allocations(), allocations, 'view sorting creates no GPU resources');
  renderer._clearInsetTargets(); renderer._replayGpu.dispose(); owner.dispose();
});

test('color and depth format support select a common sample count no higher than four', () => {
  const {gl, renderer} = harness({colorSamples: [8, 4, 2], depthSamples: [8, 2], maxSamples: 8});
  renderer.renderInset([], camera(), [0, 0, 96, 64], {owner: 'replay-corner'});
  const stores = gl.calls.filter(c => c.name === 'multisampleStorage');
  assert.equal(stores.length, 2, 'one color and one depth multisample renderbuffer');
  assert.deepEqual(stores.map(c => c.samples), [2, 2]);
  assert.deepEqual(new Set(stores.map(c => c.format)), new Set([gl.RGBA16F, gl.DEPTH_COMPONENT24]));
  assert.ok(gl.calls.some(c => c.name === 'supportedSamples' && c.format === gl.DEPTH_COMPONENT24));
  renderer._clearInsetTargets(); assert.equal(targetResources(gl).length, 0);
});

test('MSAA clamps to four and respects MAX_SAMPLES', () => {
  for (const [maxSamples, expected] of [[8, 4], [2, 2], [1, 0]]) {
    const {gl, renderer} = harness({maxSamples});
    renderer.renderInset([], camera(), [0, 0, 96, 64], {owner: 'replay-corner'});
    const stores = gl.calls.filter(c => c.name === 'multisampleStorage');
    assert.deepEqual(stores.map(c => c.samples), expected ? [expected, expected] : []);
    renderer._clearInsetTargets();
  }
});

test('disjoint format sample sets use a complete single-sample target', () => {
  const {gl, renderer} = harness({colorSamples: [8, 4], depthSamples: [2], maxSamples: 8});
  renderer.renderInset([], camera(), [0, 0, 96, 64], {owner: 'replay-corner'});
  assert.equal(gl.calls.filter(c => c.name === 'multisampleStorage').length, 0);
  assert.equal(gl.calls.filter(c => c.name === 'blitFramebuffer').length, 0);
  assert.ok(gl.calls.some(c => c.name === 'checkFramebufferStatus' && c.result === gl.FRAMEBUFFER_COMPLETE));
  renderer._clearInsetTargets();
});

test('MSAA color resolves into a sampleable target before composition', () => {
  const {gl, renderer} = harness();
  const n = node(renderer, 'body', 14); gl.calls.length = 0;
  renderer.renderInset([n], camera(), [0, 0, 96, 64], {owner: 'replay-corner'});
  const resolve = gl.calls.find(c => c.name === 'blitFramebuffer');
  assert.ok(resolve, 'offscreen MSAA requires an explicit resolve');
  assert.equal(resolve.values[8] & gl.COLOR_BUFFER_BIT, gl.COLOR_BUFFER_BIT);
  assert.equal(resolve.values[9], gl.NEAREST);
  const color = resolve.read.attachments.get(gl.COLOR_ATTACHMENT0), depth = resolve.read.attachments.get(gl.DEPTH_ATTACHMENT);
  assert.equal(color.kind, 'renderbuffer'); assert.equal(depth.kind, 'renderbuffer');
  assert.equal(color.storage.samples, 4); assert.equal(depth.storage.samples, 4);
  const sampled = resolve.draw.attachments.get(gl.COLOR_ATTACHMENT0); assert.equal(sampled.kind, 'texture');
  const composite = draws(gl).find(c => c.program?.label === 'composite');
  assert.ok(gl.calls.indexOf(resolve) > gl.calls.indexOf(litDraws(gl)[0]));
  assert.ok(gl.calls.indexOf(composite) > gl.calls.indexOf(resolve));
  assert.ok(gl.calls.some(c => c.name === 'bindTexture' && c.handle === sampled));
  renderer._clearInsetTargets();
});

test('incomplete MSAA framebuffer falls back and releases its partial resources', () => {
  const {gl, renderer} = harness({status: (fbo, g) => fbo?.attachments.get(g.COLOR_ATTACHMENT0)?.storage?.samples > 0 ? g.FRAMEBUFFER_UNSUPPORTED : undefined});
  const baseline = gl.live.size;
  renderer.renderInset([], camera(), [0, 0, 96, 64], {owner: 'replay-corner'});
  assert.equal(gl.calls.filter(c => c.name === 'blitFramebuffer').length, 0);
  assert.equal([...gl.live].filter(c => c.kind === 'renderbuffer').length, 0, 'failed MSAA renderbuffers are discarded');
  const failed = gl.calls.find(c => c.name === 'checkFramebufferStatus' && c.result === gl.FRAMEBUFFER_UNSUPPORTED);
  assert.ok(failed); assert.ok(gl.deleted.includes(failed.fbo));
  assert.equal(draws(gl).filter(c => c.program?.label === 'composite').length, 1, 'single-sample fallback still composites');
  renderer._clearInsetTargets(); assert.equal(gl.live.size, baseline);
});

test('incomplete resolved target never caches or draws and releases all allocations', () => {
  const {gl, renderer} = harness({status: (fbo, g) => g.FRAMEBUFFER_UNSUPPORTED});
  const before = callerState(gl), baseline = gl.live.size;
  assert.throws(() => renderer.renderInset([], camera(), [0, 0, 96, 64], {owner: 'replay-corner'}));
  assert.deepEqual(gl.snapshot(), before); assert.equal(draws(gl).length, 0);
  assert.equal(gl.live.size, baseline); assert.equal(targetResources(gl).length, 0);
});

test('successful inset restores caller framebuffer, viewport, scissor, blend, depth, program and VAO', () => {
  const {gl, renderer} = harness(); const n = node(renderer, 'body', 14);
  const before = callerState(gl); gl.calls.length = 0;
  renderer.renderInset([n], camera(), [0, 0, 96, 64], {owner: 'status', disc: .8});
  assert.deepEqual(gl.snapshot(), before);
  const clear = gl.calls.find(c => c.name === 'clear');
  assert.ok(clear.depthWrite, 'offscreen depth clear enables writes');
  assert.equal(clear.scissor, false, 'caller scissor cannot crop an offscreen clear');
  const composite = draws(gl).find(c => c.program?.label === 'composite');
  assert.equal(composite.fbo, before.draw, 'inset composites into caller draw framebuffer');
  assert.deepEqual(composite.viewport, [0, 720 - 64, 96, 64], 'zero x/y are valid top-left viewport coordinates');
  renderer._clearInsetTargets();
});

test('geometry, upload, replay, resolve and composite failures restore caller state in finally', () => {
  for (const phase of ['lit', 'upload', 'replay', 'resolve', 'composite']) {
    const {gl, renderer} = harness({}, true); const {owner, frame, prepared} = replayFixture(renderer);
    const before = callerState(gl), baseline = gl.live.size;
    const sentinel = new Error(`injected ${phase}`); gl.options.error = sentinel;
    gl.options.throwOn = c => phase === 'lit' ? c.name === 'drawArrays' && c.program?.label === 'lit'
      : phase === 'upload' ? c.name === 'bufferSubData'
      : phase === 'replay' ? c.name === 'drawArraysInstanced' && c.program?.label === 'replay:0'
      : phase === 'resolve' ? c.name === 'blitFramebuffer'
      : c.name === 'drawArrays' && c.program?.label === 'composite';
    assert.throws(() => renderer.renderInset(prepared.nodes, camera(), [0, 0, 96, 64], {owner: 'replay-corner', replayDraw: prepared, frame}), error => error === sentinel, `${phase} propagates its actual failure`);
    assert.deepEqual(gl.snapshot(), before, `${phase} restores guarded GL state`);
    gl.options.throwOn = null;
    renderer._clearInsetTargets(); assert.equal(gl.live.size, baseline, `${phase} leaves no abandoned target resources`);
    owner.dispose(); renderer._replayGpu.dispose();
  }
});

test('every target allocation failure is transactional for null and throwing GL allocators', () => {
  const successful = harness();
  assert.equal(typeof successful.renderer._insetTarget, 'function');
  const start = successful.gl.allocations();
  const target = successful.renderer._insetTarget(96, 64, 4);
  const count = successful.gl.allocations() - start;
  assert.ok(count >= 6, 'target includes color/depth textures, framebuffers and MSAA renderbuffers');
  successful.renderer._deleteInsetTarget(target);
  for (const failMode of ['null', 'throw']) for (let nth = 1; nth <= count; nth++) {
    const {gl, renderer} = harness(); const baseline = gl.live.size;
    gl.options.failAllocation = gl.allocations() + nth; gl.options.failMode = failMode;
    let result;
    try { result = renderer._insetTarget(96, 64, 4); } catch {}
    if (result) {
      assert.ok(gl.complete(result.fbo), `allocation ${nth} only returns a complete fallback`);
      renderer._deleteInsetTarget(result);
    }
    assert.equal(gl.live.size, baseline, `${failMode} at target allocation ${nth} releases partial handles`);
    assert.equal(targetResources(gl).length, 0);
  }
});

test('target storage and attachment exceptions roll back newly acquired GL handles', () => {
  const normal = harness(); assert.equal(typeof normal.renderer._insetTarget, 'function');
  const target = normal.renderer._insetTarget(96, 64, 4);
  const operations = ['texStorage2D', 'attachTexture', 'multisampleStorage', 'attachRenderbuffer', 'checkFramebufferStatus'];
  const counts = new Map(operations.map(name => [name, normal.gl.calls.filter(c => c.name === name).length]));
  normal.renderer._deleteInsetTarget(target);
  for (const operation of operations) for (let nth = 1; nth <= counts.get(operation); nth++) {
    const {gl, renderer} = harness(); const baseline = gl.live.size;
    assert.equal(typeof renderer._insetTarget, 'function');
    const sentinel = new Error(`injected ${operation}`); gl.options.error = sentinel;
    let seen = 0; gl.options.throwOn = c => c.name === operation && ++seen === nth;
    assert.throws(() => renderer._insetTarget(96, 64, 4), error => error === sentinel);
    assert.equal(gl.live.size, baseline, `${operation} ${nth} leaves no partial resources`);
  }
});

test('owner caches retain current and previous sizes without evicting another view', () => {
  const {gl, renderer} = harness(); const baseline = gl.live.size;
  const draw = (owner, w, h) => renderer.renderInset([], camera(), [0, 0, w, h], {owner});
  draw('replay-corner', 96, 64); draw('replay-corner', 100, 70);
  draw('replay-full', 640, 360); draw('status', 80, 80);
  assert.deepEqual(targetSizes(gl), new Set(['96x64', '100x70', '640x360', '80x80']));
  const beforeReuse = gl.allocations(); draw('replay-corner', 96, 64);
  assert.equal(gl.allocations(), beforeReuse, 'returning to previous size reuses its target');
  draw('replay-corner', 104, 76);
  assert.deepEqual(targetSizes(gl), new Set(['96x64', '104x76', '640x360', '80x80']), 'third corner size evicts only its abandoned size');
  draw('replay-full', 644, 364); draw('status', 84, 84); assert.equal(targetSizes(gl).size, 6);
  draw('replay-full', 648, 368); draw('status', 88, 88);
  assert.equal(targetSizes(gl).size, 6, 'three owners remain bounded to six targets total');
  renderer._clearInsetTargets('replay-corner');
  assert.deepEqual(targetSizes(gl), new Set(['644x364', '648x368', '84x84', '88x88']));
  renderer._clearInsetTargets(); assert.equal(gl.live.size, baseline);
  renderer._clearInsetTargets(); assert.equal(gl.live.size, baseline, 'cleanup is idempotent');
});

test('owners with identical dimensions retain independent targets through selective cleanup', () => {
  const {gl, renderer} = harness(); const baseline = gl.live.size;
  for (const owner of ['replay-full', 'replay-corner', 'status']) renderer.renderInset([], camera(), [0, 0, 96, 64], {owner});
  const targets = [...gl.live].filter(h => h.kind === 'framebuffer' && h.attachments.get(gl.COLOR_ATTACHMENT0)?.kind === 'texture');
  assert.equal(targets.length, 3, 'the three owners independently lease their same-size resolved targets');
  renderer._clearInsetTargets('replay-corner');
  assert.equal(targets.filter(t => gl.live.has(t)).length, 2, 'only the selected owner is released');
  const before = gl.allocations();
  for (const owner of ['replay-full', 'status']) renderer.renderInset([], camera(), [0, 0, 96, 64], {owner});
  assert.equal(gl.allocations(), before, 'surviving owners reuse their target handles');
  renderer._clearInsetTargets(); assert.equal(gl.live.size, baseline);
});

test('failed resize retains previous targets and retry replaces only the oldest size', () => {
  const {gl, renderer} = harness(); const emptyBaseline = gl.live.size;
  for (const [w, h] of [[96, 64], [100, 70]]) renderer.renderInset([], camera(), [0, 0, w, h], {owner: 'replay-corner'});
  const beforeCaller = gl.live.size, before = callerState(gl), baseline = gl.live.size;
  const callerResources = baseline - beforeCaller;
  gl.options.failAllocation = gl.allocations() + 3; gl.options.failMode = 'throw';
  assert.throws(() => renderer.renderInset([], camera(), [0, 0, 104, 76], {owner: 'replay-corner'}));
  assert.equal(gl.live.size, baseline);
  assert.deepEqual(targetSizes(gl), new Set(['96x64', '100x70']));
  assert.deepEqual(gl.snapshot(), before);
  gl.options.failAllocation = undefined;
  renderer.renderInset([], camera(), [0, 0, 104, 76], {owner: 'replay-corner'});
  assert.deepEqual(targetSizes(gl), new Set(['100x70', '104x76']));
  renderer._clearInsetTargets(); assert.equal(gl.live.size, emptyBaseline + callerResources);
});

test('lost-context admission creates no targets and cleanup allows a fresh generation', () => {
  const {gl, renderer} = harness(); const baseline = gl.live.size;
  renderer.renderInset([], camera(), [0, 0, 96, 64], {owner: 'replay-corner'});
  renderer.lost = true; const allocations = gl.allocations();
  renderer.renderInset([], camera(), [0, 0, 100, 70], {owner: 'replay-corner'});
  assert.equal(gl.allocations(), allocations);
  renderer._clearInsetTargets(); assert.equal(gl.live.size, baseline);
  renderer.lost = false; renderer.generation++;
  renderer.renderInset([], camera(), [0, 0, 96, 64], {owner: 'replay-corner'});
  assert.ok(gl.allocations() > allocations, 'fresh generation allocates new target handles');
  assert.equal(targetSizes(gl).size, 1);
  renderer._clearInsetTargets(); assert.equal(gl.live.size, baseline);
});

test('lazy real ReplayGpu shader compilation and linking failures release partial GPU resources', () => {
  for (const [key, count, expected] of [['failCompile', 6, /injected compiler failure/], ['failLink', 3, /injected linker failure/]]) {
    for (let nth = 1; nth <= count; nth++) {
      const {gl, renderer} = harness(); const {owner, frame, prepared} = replayFixture(renderer);
      const before = callerState(gl), baseline = gl.live.size; gl.options[key] = nth;
      assert.throws(() => renderer.renderInset(prepared.nodes, camera(), [0, 0, 96, 64], {owner: 'replay-corner', replayDraw: prepared, frame}), expected);
      assert.deepEqual(gl.snapshot(), before, `${key} ${nth} restores GL state`);
      assert.ok(!renderer._replayGpu, 'failed lazy construction never publishes a partial GPU owner');
      renderer._clearInsetTargets();
      assert.equal(gl.live.size, baseline, `${key} ${nth} releases shaders/programs/buffers/targets`);
      assert.equal([...gl.live].filter(h => h.kind === 'shader').length, 0);
      owner.dispose();
    }
  }
});

test('successful lazy GPU construction caches same-view instance ordering and deletes temporary shaders', () => {
  const {gl, renderer} = harness(); const {owner, frame, prepared} = replayFixture(renderer);
  const baseline = gl.live.size; gl.calls.length = 0;
  renderer.renderInset(prepared.nodes, camera(), [0, 0, 640, 360], {owner: 'replay-full', replayDraw: prepared, frame});
  renderer.renderInset(prepared.nodes, camera(), [0, 0, 320, 180], {owner: 'replay-corner', replayDraw: prepared, frame});
  assert.ok(renderer._replayGpu instanceof ReplayGpu, 'renderer uses the real V3 GPU owner');
  assertInstanceStreams(gl, renderer._replayGpu, prepared, 2); // source + one shared forward direction
  assert.equal([...gl.live].filter(h => h.kind === 'shader').length, 0, 'linked programs do not retain temporary compile handles');
  renderer._clearInsetTargets(); renderer._replayGpu.dispose(); owner.dispose();
  assert.equal(gl.live.size, baseline);
});

test('every lazy render target, shader, program and replay buffer allocation rolls back on null or throw', () => {
  const normal = harness(); const fixture = replayFixture(normal.renderer);
  const start = normal.gl.allocations();
  normal.renderer.renderInset(fixture.prepared.nodes, camera(), [0, 0, 96, 64], {owner: 'replay-corner', replayDraw: fixture.prepared, frame: fixture.frame});
  const allocationCount = normal.gl.allocations() - start;
  assert.ok(allocationCount >= 19, 'the actual lazy route creates target and V3 program/buffer resources');
  normal.renderer._clearInsetTargets(); normal.renderer._replayGpu.dispose(); fixture.owner.dispose();
  for (const failMode of ['null', 'throw']) for (let nth = 1; nth <= allocationCount; nth++) {
    const {gl, renderer} = harness(); const {owner, frame, prepared} = replayFixture(renderer);
    const before = callerState(gl), baseline = gl.live.size;
    gl.options.failAllocation = gl.allocations() + nth; gl.options.failMode = failMode;
    assert.throws(() => renderer.renderInset(prepared.nodes, camera(), [0, 0, 96, 64], {owner: 'replay-corner', replayDraw: prepared, frame}));
    assert.deepEqual(gl.snapshot(), before, `${failMode} lazy allocation ${nth} restores state`);
    assert.ok(!renderer._replayGpu, 'failed construction never publishes a partial replay GPU owner');
    renderer._clearInsetTargets();
    assert.equal(gl.live.size, baseline, `${failMode} lazy allocation ${nth} rolls back all partial resources`);
    owner.dispose();
  }
});

test('actual context event owners reset replay GPU and target leases before restoring fresh handles', () => {
  const gl = fakeGL(), listeners = new Map();
  const canvas = {width: 1280, height: 720, getContext: () => gl,
    addEventListener: (name, handler) => listeners.set(name, handler)};
  const renderer = new Renderer(canvas, {noiseSize: 2, quality: 'low'});
  renderer._drawLit = renderer._draw.bind(renderer, renderer.lit);
  const {owner, frame, prepared} = replayFixture(renderer);
  renderer.renderInset(prepared.nodes, camera(), [0, 0, 96, 64], {owner: 'replay-corner', replayDraw: prepared, frame});
  const oldGpu = renderer._replayGpu;
  assert.ok(oldGpu instanceof ReplayGpu);
  const allocations = gl.allocations(), oldHandles = gl.invalidateContext();
  let prevented = false;
  listeners.get('webglcontextlost')({preventDefault() { prevented = true; }});
  assert.ok(prevented); assert.equal(renderer.lost, true);
  renderer.renderInset(prepared.nodes, camera(), [0, 0, 100, 70], {owner: 'replay-corner', replayDraw: prepared, frame});
  assert.equal(gl.allocations(), allocations, 'lost context accepts no new allocations');
  gl.options.contextLost = false;
  listeners.get('webglcontextrestored')();
  assert.equal(renderer.lost, false); assert.equal(renderer.generation, 1);
  assert.ok(!renderer._replayGpu, 'restore discards the invalidated V3 GPU owner');
  assert.ok(oldGpu.disposed, 'old GPU owner is disposed at the context boundary');
  renderer._drawLit = renderer._draw.bind(renderer, renderer.lit);
  const baseline = gl.live.size; gl.calls.length = 0;
  renderer.renderInset(prepared.nodes, camera(), [0, 0, 96, 64], {owner: 'replay-corner', replayDraw: prepared, frame});
  assert.ok(renderer._replayGpu instanceof ReplayGpu); assert.notEqual(renderer._replayGpu, oldGpu);
  assertInstanceStreams(gl, renderer._replayGpu, prepared, 2); // fresh source and fresh view after context restore
  for (const c of draws(gl)) assert.ok(!oldHandles.has(c.program) && !oldHandles.has(c.vao), 'all restored draws use fresh context handles');
  renderer._clearInsetTargets(); renderer._replayGpu.dispose(); owner.dispose();
  assert.equal(gl.live.size, baseline, 'replay resources return to the actual restored renderer baseline');
});

test('opposed cameras sort real trace and dynamic streams without resampling or allocating buffers', () => {
  const {gl, renderer} = harness({}, true), gpu = renderer._replayGpu;
  const rows = [2, 8, -3, 5].map((z, i) => [0, 0, z, 0, 0, z + 2, .2, .4, .6, .5, 1, i]);
  const instances = new Float32Array(rows.flat()), source = [...instances];
  const prepared = Object.freeze({frameId: 91, instances, count: 4, dynamicCount: 2, physicalS: .25});
  const scratch = [gpu.viewInstances, gpu.dynamicInstances, gpu.depths, gpu.viewOrder], allocations = gl.allocations();
  const order = (indices) => indices.flatMap(i => source.slice(i * 12, (i + 1) * 12));
  const latest = handle => gl.calls.filter(c => c.name === 'bufferSubData' && c.handle === handle).at(-1).data;
  gpu.upload(prepared);
  gpu.draw(camera().viewProj, [640, 360], prepared, [0, 0, 1]);
  assert.deepEqual(latest(gpu.buffer), order([1, 3, 0, 2]));
  assert.deepEqual(latest(gpu.dynamicBuffer), order([1, 0]), 'static records never enter animated shard/field input');
  gpu.draw(camera([0, 0, 20], [0, 0, -1]).viewProj, [320, 180], prepared, [0, 0, -1]);
  assert.deepEqual(latest(gpu.buffer), order([2, 0, 3, 1]));
  assert.deepEqual(latest(gpu.dynamicBuffer), order([0, 1]));
  assertInstanceStreams(gl, gpu, prepared, 3);
  const uploads = gl.calls.filter(c => c.name === 'bufferSubData').length;
  gpu.upload(prepared); gpu.draw(camera([0, 0, 20], [0, 0, -1]).viewProj, [320, 180], prepared, [0, 0, -1]);
  assert.equal(gl.calls.filter(c => c.name === 'bufferSubData').length, uploads, 'same frame and camera are cached');
  assert.deepEqual([...instances], source);
  assert.equal(gl.allocations(), allocations);
  [gpu.viewInstances, gpu.dynamicInstances, gpu.depths, gpu.viewOrder].forEach((a, i) => assert.equal(a, scratch[i], 'sorting reuses its original scratch'));
  for (const a of scratch.slice(0, 2)) assert.equal(a.length, 4096 * 12);
  gpu.dispose();
});

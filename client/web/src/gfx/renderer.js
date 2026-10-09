// Dependency-free WebGL2 renderer. The frame is built in linear HDR and graded at the end:
//
//   shadow map ─┐
//   sky dome ───┤  (atmosphere + raymarched clouds for the whole sky, refreshed one tile per frame)
//               ├─ scene: sky, lit geometry (sun x shadow map x cloud shadow), effects   [MSAA]
//               ├─ light shafts at half size: sun reaching the haze + shafts from the sun
//               ├─ bloom at quarter size
//               └─ composite: height fog, in-scattered light, exposure, filmic curve
//                  └─ optional pixel-art pass (the whole frame is then rendered small)
//
// It is kept behind this class so a WebGPU (wgpu) backend can replace it without touching game code.
import { STRIDE } from './geo.js';
import { lookAt, ortho, mul, norm, add, scale, project } from './math.js';
import * as S from './shaders.js';
import { TIMES, environment, I_SUN } from './atmosphere.js';

const SHADOW_EXTENT = 24;
const NO_HIGHLIGHT = new Float32Array([0, 0, 0, 0]);
const DOME_TILES = 4; // per side: 16 tiles, one sweep = 16 frames
export const MAX_ZONES = S.MAX_ZONES;
export { TIMES };

export const QUALITY = {
  low: { label: '低', msaa: 0, dome: 640, cloudSteps: 16, shaftSteps: 0, raySteps: 0, bloom: false },
  medium: { label: '中', msaa: 4, dome: 1024, cloudSteps: 24, shaftSteps: 8, raySteps: 12, bloom: true },
  high: { label: '高', msaa: 4, dome: 1280, cloudSteps: 36, shaftSteps: 14, raySteps: 20, bloom: true },
};
export const QUALITY_ORDER = ['low', 'medium', 'high'];

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

// texture units, fixed for the whole frame
const U_SHADOW = 0;
const U_TEX = 1;
const U_NOISE = 2;
const U_DOME = 3;
const U_DOME_A = 4;
const U_SCENE = 5;
const U_DEPTH = 6;
const U_SHAFTS = 7;
const U_BLOOM = 8;
const U_DEFORM = 9;
const U_MAPH = 10;
const U_MAPC = 11;
const U_NTEX = 12;
const U_ARMOR = 13;
const U_LAYER = 14;

export class Renderer {
  constructor(canvas, opts = {}) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    this.canvas = canvas;
    this.floatTargets = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.hdrFormat = this.floatTargets ? gl.RGBA16F : gl.RGBA8;
    this.opts = opts;
    /** Every mesh and image texture handed out, with what it was made from, to rebuild after a lost context. */
    this._live = new Set();
    this._texSrc = new Map();
    /** Old texture -> its replacement after a restore (nodes keep the old handles). */
    this._remap = null;
    this.lost = false;
    /** Counts restores, so callers that stream data into the GPU know to send it again. */
    this.generation = 0;
    canvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      this.lost = true;
      if (this.onContextLost) this.onContextLost();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      let ok = true;
      try {
        this._restore();
      } catch (err) {
        console.error('context restore failed:', err);
        ok = false;
      }
      if (this.onContextRestored) this.onContextRestored(ok);
    });

    /** 0 = off; otherwise the size of one stylised pixel in canvas pixels. */
    this.pixelSize = 0;
    /** The scene's resolution as a share of the canvas (dynamic resolution, see renderscale.js). */
    this.renderScale = 1;
    this.pixelLevels = 20;
    this.targets = null;
    this.quality = 'high';
    this.q = QUALITY.high;
    this.msaaBroken = false;

    this._initGL(opts);
    this.clock = 0;
    this.cloudSpeed = 1;
    this.wind = [7.5, 0, 5.0];
    this.exposureBias = 1;
    /** Final colour balance: a touch warm, like daylight film. */
    this.tint = [1.025, 1.0, 0.955];
    this.mud = [0.115, 0.095, 0.065];
    this.wet = 0.6;
    this.zones = [];
    this.road = [0, 0, 0, 0];
    /** x0, z0, size (m), 1 / size of the deformation window. */
    this.deformWin = [0, 0, 128, 1 / 128];
    /** Where the flat far ground is cut away for the terrain grid: xmin, zmin, xmax, zmax. */
    this.hole = [0, 0, 0, 0];
    // battle map: heights (R32F) and ground colours / types (RGBA8); a 1 x 1 placeholder when off
    this.mapOn = 0;
    this.mapRect = [0, 0, 1, 1];
    this.clock = 0;
    this.drawCalls = 0;
    this.timeIndex = 0;
    this.setTime(0);
    this.setQuality(opts.quality || 'high');
  }

  /** Everything the context owns that the renderer makes for itself (again after a lost context). */
  _initGL(opts) {
    const gl = this.gl;
    const defs = S.hdrDefines(this.floatTargets);
    this.lit = program(gl, S.LIT_VS, S.litFS(defs));
    this.depth = program(gl, S.DEPTH_VS, S.DEPTH_FS);
    this.sky = program(gl, S.SKY_VS, S.skyFS(defs));
    this.fx = program(gl, S.FX_VS, S.fxFS(defs));
    this.fxSoft = program(gl, S.FX_SOFT_VS, S.fxSoftFS(defs));
    this.domeProg = program(gl, S.FULLSCREEN_VS, S.domeFS(defs));
    this.shafts = program(gl, S.FULLSCREEN_VS, S.shaftsFS(defs));
    this.bloomDown = program(gl, S.FULLSCREEN_VS, S.bloomDownFS(defs));
    this.blur = program(gl, S.FULLSCREEN_VS, S.blurFS(defs));
    this.composite = program(gl, S.FULLSCREEN_VS, S.compositeFS(defs));
    this.pixel = program(gl, S.FULLSCREEN_VS, S.PIXEL_FS);
    this.insetProg = program(gl, S.FULLSCREEN_VS, S.insetFS(defs));
    this.skyVao = gl.createVertexArray();
    // shadow map
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, S.SHADOW_SIZE, S.SHADOW_SIZE, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // 1x1 fallbacks: white for untextured nodes, "fully lit, no shafts" when the shaft pass is off
    this.white = this._pixelTexture([255, 255, 255, 255]);
    this.noShafts = this._pixelTexture([255, 0, 0, 255]);
    this.black = this._pixelTexture([0, 0, 0, 255]);
    this.clearTex = this._pixelTexture([0, 0, 0, 0]);

    this.fxBuffers = [this._fxBuffer(), this._fxBuffer()];
    this.softBuffers = [this._fxBuffer(true), this._fxBuffer(true)];

    this._buildNoise(opts.noiseSize || 128);
    this.dome = null;
    this.targets = null;
    this.insetTs = null;
    this.armorTex = null;
    // ruts and marks around the player: a window of the deformation layer that wraps round
    this.deformTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.deformTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG16F, S.DEFORM_TEX, S.DEFORM_TEX);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, S.DEFORM_TEX, S.DEFORM_TEX, gl.RG, gl.FLOAT, new Float32Array(S.DEFORM_TEX * S.DEFORM_TEX * 2));
    this.mapH = this._mapTexture(gl.R32F, gl.RED, gl.FLOAT, 1, new Float32Array(1), false);
    this.mapC = this._mapTexture(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, 1, new Uint8Array(4), true);
  }

  /**
   * The context came back: everything on the GPU is gone. Rebuilds the renderer's own resources and
   * re-uploads every mesh and image texture still in use from what it was made from -- meshes keep
   * their objects (only the handles inside change), textures are remapped. Map and armour layers are
   * sent again; streamed data (the deformation window) is the caller's to resend (see generation).
   */
  _restore() {
    const gl = this.gl;
    this.lost = false;
    this.msaaBroken = false;
    this._maxSamples = undefined;
    this.floatTargets = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this._initGL(this.opts);
    this.setQuality(this.quality);
    for (const m of this._live) this._upload(m);
    const remap = new Map();
    for (const [old, src] of this._texSrc) remap.set(old, this._makeTexture(src));
    // a texture made since the restore is its own key
    this._remap = remap;
    if (this._mapSrc !== undefined) this.setMap(this._mapSrc);
    if (this._armorSrc) this.setArmor(this._armorSrc);
    this.generation++;
  }

  /** The live handle for a texture given out before a restore. */
  _tex(t) {
    return t && this._remap ? this._remap.get(t) || t : t;
  }

  // ------------------------------------------------------------------ settings

  setQuality(name) {
    if (!QUALITY[name]) name = 'high';
    this.quality = name;
    this.q = QUALITY[name];
    if (!this.dome || this.dome.size !== this.q.dome) this._buildDome(this.q.dome);
    this.dome.dirty = true;
  }

  setTime(index) {
    this.timeIndex = ((index % TIMES.length) + TIMES.length) % TIMES.length;
    this.env = environment(TIMES[this.timeIndex]);
    if (this.dome) this.dome.dirty = true;
  }

  /** Moves the clouds on. */
  advance(dt) {
    this.clock += dt * this.cloudSpeed;
  }

  _cloudState(t) {
    const cov = this.env.coverage + 0.07 * Math.sin(t * 0.021) + 0.04 * Math.sin(t * 0.0077 + 1.3);
    return { wind: [this.wind[0] * t, 0, this.wind[2] * t], cloud: [Math.min(0.9, Math.max(0.05, cov)), t * 0.0021, 0.022, 0.55] };
  }

  _bindClouds(prog, st) {
    const gl = this.gl;
    gl.uniform1i(prog.u.uNoise, U_NOISE);
    gl.uniform3fv(prog.u.uWind, st.wind);
    gl.uniform4fv(prog.u.uCloud, st.cloud);
    gl.uniform2fv(prog.u.uNoiseRange, this.noiseRange);
  }

  // ------------------------------------------------------------------ resources

  _pixelTexture(rgba) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }

  _target(w, h, internal, filter) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  /** Tileable 3D noise for the clouds, rendered slice by slice on the GPU. */
  _buildNoise(size) {
    const gl = this.gl;
    const prog = program(gl, S.FULLSCREEN_VS, S.NOISE_FS);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, tex);
    const levels = Math.floor(Math.log2(size)) + 1;
    gl.texStorage3D(gl.TEXTURE_3D, levels, gl.RGBA8, size, size, size);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, size, size);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(prog.p);
    gl.bindVertexArray(this.skyVao);
    // the base-shape channel is sampled back from a few slices so the coverage thresholds follow
    // the noise this GPU actually produced
    const hist = new Uint32Array(256);
    const px = new Uint8Array(size * size * 4);
    const every = Math.max(1, Math.floor(size / 8));
    for (let z = 0; z < size; z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, z);
      gl.uniform1f(prog.u.uSlice, (z + 0.5) / size);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (z % every === 0) {
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, px);
        for (let i = 0; i < px.length; i += 4) hist[px[i]]++;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.deleteProgram(prog.p);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.generateMipmap(gl.TEXTURE_3D);
    let total = 0;
    for (const c of hist) total += c;
    const pct = (f) => {
      let acc = 0;
      for (let i = 0; i < 256; i++) {
        acc += hist[i];
        if (acc >= total * f) return i / 255;
      }
      return 1;
    };
    this.noiseRange = total > 0 ? [pct(0.06), pct(0.985)] : [0.35, 0.9];
    this.noiseTex = tex;
    this.noiseSize = size;
  }

  _buildDome(size) {
    const gl = this.gl;
    if (this.dome) {
      for (const t of this.dome.targets) {
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
    }
    const targets = [0, 1, 2].map(() => this._target(size, size, this.hdrFormat, gl.LINEAR));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.dome = { size, targets, tile: 0, mix: 1, dirty: true, snap: null, shownAt: 0, sweep: 0 };
  }

  _snapshot(cam) {
    return { ...this._cloudState(this.clock), camPos: cam.pos.slice(), clock: this.clock };
  }

  /** Renders the sky for one tile of a dome texture (tile < 0: the whole texture). */
  _drawDome(target, tile, snap, prev, blend, seed) {
    const gl = this.gl;
    const e = this.env;
    const P = this.domeProg;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    if (tile >= 0) {
      const ts = Math.ceil(target.w / DOME_TILES);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor((tile % DOME_TILES) * ts, Math.floor(tile / DOME_TILES) * ts, ts, ts);
    }
    gl.useProgram(P.p);
    this._bindClouds(P, snap);
    gl.uniform3fv(P.u.uSunDir, e.sunDir);
    gl.uniform3fv(P.u.uSunE, e.sunE);
    gl.uniform3fv(P.u.uSkyAmb, e.skyAmb);
    gl.uniform3fv(P.u.uCamPos, snap.camPos);
    gl.uniform1f(P.u.uISun, I_SUN);
    gl.uniform1i(P.u.uSteps, this.q.cloudSteps);
    this._bind(U_DOME, prev ? prev.tex : this.black);
    gl.uniform1i(P.u.uPrev, U_DOME);
    gl.uniform1f(P.u.uBlend, prev ? blend : 1);
    gl.uniform1f(P.u.uSeed, seed);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
    gl.depthMask(true);
  }

  _updateDome(cam) {
    const D = this.dome;
    const [a, b, c] = D.targets;
    // after a jump in time (or a new sun) redraw everything at once
    if (D.dirty || Math.abs(this.clock - D.shownAt) > 3) {
      const snap = this._snapshot(cam);
      this._drawDome(a, -1, snap, null, 1, 0);
      this._drawDome(b, -1, snap, a, 0.5, 1);
      this._drawDome(a, -1, snap, b, 0.34, 2);
      this._drawDome(b, -1, snap, a, 0.25, 3);
      D.sweep = 4;
      D.dirty = false;
      D.tile = 0;
      D.mix = 1;
      D.shownAt = snap.clock;
      return;
    }
    if (D.tile === 0) D.snap = this._snapshot(cam);
    this._drawDome(c, D.tile, D.snap, b, 0.4, D.sweep);
    D.tile++;
    D.mix = D.tile / (DOME_TILES * DOME_TILES);
    if (D.tile >= DOME_TILES * DOME_TILES) {
      D.targets = [b, c, a];
      D.sweep = (D.sweep + 1) % 64;
      D.tile = 0;
      D.mix = 0;
      D.shownAt = D.snap.clock;
    }
  }

  /** soft: the particle layout, with the extra seed/age/size attribute. */
  _fxBuffer(soft = false) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    const stride = soft ? 52 : 36;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 20);
    if (soft) {
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 36);
    }
    gl.bindVertexArray(null);
    return { vao, buf };
  }

  _vertexLayout() {
    const gl = this.gl;
    const bytes = STRIDE * 4;
    const attrs = [
      [0, 3, 0],
      [1, 3, 12],
      [2, 3, 24],
      [3, 2, 36],
      [4, 2, 44],
    ];
    for (const [loc, size, off] of attrs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, bytes, off);
    }
  }

  /** Uploads an interleaved vertex array built by GeoBuilder. */
  mesh(data) {
    const m = { vao: null, buf: null, count: data.length / STRIDE, _src: { kind: 'mesh', data } };
    this._upload(m);
    this._live.add(m);
    return m;
  }

  /** A mesh drawn many times, each copy with its own 4x4 matrix (applied before the node's). */
  instancedMesh(data, maxInstances) {
    const m = { vao: null, buf: null, count: data.length / STRIDE, instanced: true, instances: 0, maxInstances, _src: { kind: 'instanced', data } };
    this._upload(m);
    this._live.add(m);
    return m;
  }

  /** (Re)creates a mesh's buffers from what it was made from. */
  _upload(m) {
    const gl = this.gl;
    const src = m._src;
    if (src.kind === 'terrain') {
      this._uploadTerrain(m);
      return;
    }
    m.vao = gl.createVertexArray();
    m.buf = gl.createBuffer();
    gl.bindVertexArray(m.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
    gl.bufferData(gl.ARRAY_BUFFER, src.data, gl.STATIC_DRAW);
    this._vertexLayout();
    if (src.kind === 'instanced') {
      m.ibuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, m.ibuf);
      gl.bufferData(gl.ARRAY_BUFFER, m.maxInstances * 64, gl.DYNAMIC_DRAW);
      if (src.matrices) gl.bufferSubData(gl.ARRAY_BUFFER, 0, src.matrices);
      for (let i = 0; i < 4; i++) {
        gl.enableVertexAttribArray(5 + i);
        gl.vertexAttribPointer(5 + i, 4, gl.FLOAT, false, 64, i * 16);
        gl.vertexAttribDivisor(5 + i, 1);
      }
    }
    gl.bindVertexArray(null);
  }

  /** matrices: Float32Array of count * 16 (column-major). */
  setInstances(mesh, matrices, count) {
    const gl = this.gl;
    mesh.instances = Math.min(count, mesh.maxInstances);
    // kept for a restore: only the copies actually shown
    const keep = mesh._src.matrices;
    mesh._src.matrices = keep && keep.length === mesh.instances * 16 ? (keep.set(matrices.subarray(0, mesh.instances * 16)), keep) : matrices.slice(0, mesh.instances * 16);
    if (this.lost) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.ibuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, matrices, 0, mesh.instances * 16);
  }

  /**
   * The terrain grid: an indexed grid of points in the xz plane with lines at the given x and z
   * offsets (fine near the middle, coarse far out); the vertex shader lifts it onto the ground.
   */
  terrainMesh(xs, zs) {
    const m = { vao: null, buf: null, ibuf: null, count: (xs.length - 1) * (zs.length - 1) * 6, indexed: true, _src: { kind: 'terrain', xs, zs } };
    this._uploadTerrain(m);
    this._live.add(m);
    return m;
  }

  _uploadTerrain(m) {
    const gl = this.gl;
    const { xs, zs } = m._src;
    const nx = xs.length;
    const nz = zs.length;
    const pos = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) pos.set([xs[i], 0, zs[j]], (j * nx + i) * 3);
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let o = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        idx.set([a, a + 1, a + nx + 1, a, a + nx + 1, a + nx], o);
        o += 6;
      }
    }
    m.vao = gl.createVertexArray();
    m.buf = gl.createBuffer();
    m.ibuf = gl.createBuffer();
    gl.bindVertexArray(m.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  _mapTexture(internal, format, type, n, data, linear) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, n, n, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /**
   * The battle map the terrain shader draws (null: the test range). m = {rect: [x0, z0, size],
   * hres, heights: Float32Array hres^2, cres, colors: Uint8Array cres^2 * 4 (alpha = ground type)}.
   */
  setMap(m) {
    const gl = this.gl;
    this._mapSrc = m;
    gl.deleteTexture(this.mapH);
    gl.deleteTexture(this.mapC);
    if (!m) {
      this.mapOn = 0;
      this.mapH = this._mapTexture(gl.R32F, gl.RED, gl.FLOAT, 1, new Float32Array(1), false);
      this.mapC = this._mapTexture(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, 1, new Uint8Array(4), true);
      return;
    }
    this.mapOn = 1;
    this.mapRect = [m.rect[0], m.rect[1], m.rect[2], m.hres];
    this.mapH = this._mapTexture(gl.R32F, gl.RED, gl.FLOAT, m.hres, m.heights, false);
    this.mapC = this._mapTexture(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, m.cres, m.colors, true);
  }

  /**
   * The protection analysis (kind 12): plates in the world, four RGBA32F texels each (centre +
   * thickness, normal + material factor, u axis + half width, v axis + half height), and the round
   * {shell: [pen mm, normalization deg, ricochet deg, calibre mm], chem}. null: off.
   */
  setArmor(a) {
    const gl = this.gl;
    this._armorSrc = a;
    if (!a) {
      this.armorN = 0;
      return;
    }
    if (!this.armorTex) this.armorTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + U_ARMOR);
    gl.bindTexture(gl.TEXTURE_2D, this.armorTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, Math.max(1, a.count), 0, gl.RGBA, gl.FLOAT, a.data.subarray(0, Math.max(1, a.count) * 16));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.armorN = a.count;
    this.armorShell = a.shell;
    this.armorChem = a.chem ? 1 : 0;
  }

  /** Moves the deformation window (chunk-aligned x0, z0). */
  setDeformWindow(x0, z0, size) {
    this.deformWin = [x0, z0, size, 1 / size];
  }

  /** Uploads one chunk (RG floats, n x n) into its slot of the wrapping window texture. */
  uploadDeform(slotI, slotJ, n, data) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + U_DEFORM);
    gl.bindTexture(gl.TEXTURE_2D, this.deformTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, slotI * n, slotJ * n, n, n, gl.RG, gl.FLOAT, data);
  }

  freeMesh(m) {
    if (!m) return;
    this._live.delete(m);
    this.gl.deleteVertexArray(m.vao);
    this.gl.deleteBuffer(m.buf);
    if (m.ibuf) this.gl.deleteBuffer(m.ibuf);
  }

  texture(source) {
    const t = this._makeTexture(source);
    this._texSrc.set(t, source);
    return t;
  }

  /** Lets a texture from texture() go (its source is no longer kept for a restore). */
  freeTexture(t) {
    if (!t) return;
    this._texSrc.delete(t);
    this.gl.deleteTexture(this._tex(t));
  }

  _makeTexture(source) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** Offscreen targets for a frame of w x h, (re)created when the size or the sample count changes. */
  _targets(w, h, samples) {
    const gl = this.gl;
    const key = `${w}x${h}x${samples}`;
    if (this.targets && this.targets.key === key) return this.targets;
    const old = this.targets;
    if (old) {
      for (const t of [old.scene, old.shafts, old.bloomA, old.bloomB, old.ldr]) {
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
      gl.deleteFramebuffer(old.softFbo);
      if (old.layer) {
        gl.deleteTexture(old.layer.tex);
        gl.deleteFramebuffer(old.layer.fbo);
      }
      gl.deleteTexture(old.depthTex);
      if (old.msaa) {
        gl.deleteFramebuffer(old.msaa.fbo);
        gl.deleteRenderbuffer(old.msaa.color);
        gl.deleteRenderbuffer(old.msaa.depth);
      }
    }
    const scene = this._target(w, h, this.hdrFormat, gl.LINEAR);
    const depthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
    // the soft particles read the depth, so they draw where it is not attached: into a layer of
    // their own that the composite lays over the fogged scene (with float targets), else straight
    // into the scene colour
    const layer = this.floatTargets ? this._target(w, h, this.hdrFormat, gl.LINEAR) : null;
    const softFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, softFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, layer ? layer.tex : scene.tex, 0);

    let msaa = null;
    if (samples > 1) {
      const color = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, color);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, this.hdrFormat, w, h);
      const depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        msaa = { fbo, color, depth };
      } else {
        gl.deleteFramebuffer(fbo);
        gl.deleteRenderbuffer(color);
        gl.deleteRenderbuffer(depth);
        this.msaaBroken = true;
      }
    }
    const hw = Math.max(2, w >> 1);
    const hh = Math.max(2, h >> 1);
    const qw = Math.max(2, w >> 2);
    const qh = Math.max(2, h >> 2);
    this.targets = {
      key,
      w,
      h,
      scene,
      depthTex,
      softFbo,
      layer,
      msaa,
      shafts: this._target(hw, hh, gl.RGBA8, gl.LINEAR),
      bloomA: this._target(qw, qh, this.hdrFormat, gl.LINEAR),
      bloomB: this._target(qw, qh, this.hdrFormat, gl.LINEAR),
      ldr: this._target(w, h, gl.RGBA8, gl.NEAREST),
    };
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.targets;
  }

  _samples() {
    const gl = this.gl;
    if (this.msaaBroken || this.pixelSize > 1 || !this.q.msaa) return 0;
    if (this._maxSamples === undefined) {
      const list = gl.getInternalformatParameter(gl.RENDERBUFFER, this.hdrFormat, gl.SAMPLES);
      this._maxSamples = list && list.length ? Math.max(...list) : 0;
    }
    return Math.min(this.q.msaa, this._maxSamples);
  }

  resize(maxDpr = 1.5) {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const w = Math.max(2, Math.round(c.clientWidth * dpr));
    const h = Math.max(2, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    return [w, h];
  }

  _viewUniforms(prog, cam) {
    const gl = this.gl;
    gl.uniform3fv(prog.u.uForward, cam.forward);
    gl.uniform3fv(prog.u.uRight, cam.right);
    gl.uniform3fv(prog.u.uUp, cam.up);
    gl.uniform3fv(prog.u.uCamPos, cam.pos);
    gl.uniform2f(prog.u.uTan, cam.tanX, cam.tanY);
    gl.uniform2f(prog.u.uNearFar, cam.near || 0.3, cam.far || 9000);
  }

  _fullscreen() {
    const gl = this.gl;
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _bind(unit, tex, type) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(type || gl.TEXTURE_2D, tex);
  }

  /**
   * nodes: flat list of scene nodes with .mesh/.world/.kind/.scroll/.texture/.castShadow
   * cam: {pos, viewProj, forward, right, up, tanX, tanY, near, far}
   * fx: {alpha, alphaCount, add, addCount} decals and beams (9 floats per vertex) and
   *     {softAlpha, softAlphaCount, softAdd, softAddCount} particles (13 floats per vertex)
   */
  render(nodes, cam, focus, fx) {
    const gl = this.gl;
    if (this.lost) return;
    const e = this.env;
    const q = this.q;
    this.drawCalls = 0;
    const clouds = this._cloudState(this.clock);

    this._bind(U_NOISE, this.noiseTex, gl.TEXTURE_3D);
    this._updateDome(cam);
    const D = this.dome;

    // ---- shadow pass
    const lightPos = add(focus, scale(e.sunDir, 70));
    const lightVP = mul(ortho(-SHADOW_EXTENT, SHADOW_EXTENT, -SHADOW_EXTENT, SHADOW_EXTENT, 1, 160), lookAt(lightPos, focus, [0, 1, 0]));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, S.SHADOW_SIZE, S.SHADOW_SIZE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.depth.p);
    gl.uniformMatrix4fv(this.depth.u.uLightVP, false, lightVP);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(2.0, 4.0);
    for (const n of nodes) {
      if (!n.castShadow) continue;
      this._draw(this.depth, n);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // ---- scene pass
    const px = this.pixelSize > 1 ? this.pixelSize : 1 / Math.min(1, Math.max(0.5, this.renderScale || 1));
    const W = Math.max(2, Math.round(this.canvas.width / px));
    const H = Math.max(2, Math.round(this.canvas.height / px));
    const T = this._targets(W, H, this._samples());
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.msaa ? T.msaa.fbo : T.scene.fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this._bind(U_DOME, D.targets[1].tex);
    this._bind(U_DOME_A, D.targets[0].tex);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.sky.p);
    gl.uniform3fv(this.sky.u.uForward, cam.forward);
    gl.uniform3fv(this.sky.u.uRight, cam.right);
    gl.uniform3fv(this.sky.u.uUp, cam.up);
    gl.uniform2f(this.sky.u.uTan, cam.tanX, cam.tanY);
    gl.uniform3fv(this.sky.u.uSunDir, e.sunDir);
    gl.uniform3fv(this.sky.u.uSunE, e.sunE);
    gl.uniform1i(this.sky.u.uDomeA, U_DOME_A);
    gl.uniform1i(this.sky.u.uDomeB, U_DOME);
    gl.uniform1f(this.sky.u.uDomeMix, D.mix);
    this._fullscreen();

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    const L = this.lit;
    gl.useProgram(L.p);
    gl.uniformMatrix4fv(L.u.uViewProj, false, cam.viewProj);
    gl.uniformMatrix4fv(L.u.uLightVP, false, lightVP);
    gl.uniform3fv(L.u.uCamPos, cam.pos);
    gl.uniform3fv(L.u.uSunDir, e.sunDir);
    gl.uniform3fv(L.u.uSunColor, e.sunE);
    gl.uniform3fv(L.u.uSkyColor, e.skyAmb);
    gl.uniform3fv(L.u.uGroundColor, e.ground);
    gl.uniform3fv(L.u.uMud, this.mud);
    gl.uniform1f(L.u.uWet, this.wet);
    gl.uniform1f(L.u.uAlpha, 1);
    gl.uniform1f(L.u.uDirtHeight, 1.5);
    this._bindClouds(L, clouds);
    const rects = new Float32Array(MAX_ZONES * 4);
    const cols = new Float32Array(MAX_ZONES * 4);
    // painted last = on top: the zone list is first-match-wins, so it goes in reverse
    this.zones.slice(0, MAX_ZONES).reverse().forEach((z, i) => {
      rects.set(z.rect, i * 4);
      cols.set([z.color[0], z.color[1], z.color[2], z.soft], i * 4);
    });
    gl.uniform4fv(L.u.uZoneRect, rects);
    gl.uniform4fv(L.u.uZoneColor, cols);
    gl.uniform1i(L.u.uZoneCount, Math.min(this.zones.length, MAX_ZONES));
    gl.uniform4fv(L.u.uRoad, this.road);
    gl.uniform4fv(L.u.uDeformWin, this.deformWin);
    gl.uniform4fv(L.u.uHole, this.hole);
    this._bind(U_DEFORM, this.deformTex);
    gl.uniform1i(L.u.uDeform, U_DEFORM);
    this._bind(U_MAPH, this.mapH);
    this._bind(U_MAPC, this.mapC);
    gl.uniform1i(L.u.uMapH, U_MAPH);
    gl.uniform1i(L.u.uMapC, U_MAPC);
    gl.uniform1f(L.u.uMapOn, this.mapOn);
    gl.uniform4fv(L.u.uMapRect, this.mapRect);
    gl.uniform1f(L.u.uClock, this.clock);
    this._bind(U_SHADOW, this.shadowTex);
    gl.uniform1i(L.u.uShadowMap, U_SHADOW);
    gl.uniform1i(L.u.uTex, U_TEX);
    gl.uniform1i(L.u.uNormTex, U_NTEX);
    gl.uniform1i(L.u.uArmor, U_ARMOR);
    gl.uniform1i(L.u.uArmorN, this.armorN || 0);
    gl.uniform4fv(L.u.uArmorShell, this.armorShell || [0, 0, 90, 0]);
    gl.uniform1f(L.u.uArmorChem, this.armorChem || 0);
    if (this.armorTex) this._bind(U_ARMOR, this.armorTex);
    gl.uniform1i(L.u.uDome, U_DOME);
    this._bind(U_NTEX, this.white);
    let normalBound = null;
    gl.activeTexture(gl.TEXTURE0 + U_TEX);
    const drawLit = (n) => {
      const nt = n.kind === 9 ? n.normalTex || null : null;
      if (nt !== normalBound) {
        gl.activeTexture(gl.TEXTURE0 + U_NTEX);
        gl.bindTexture(gl.TEXTURE_2D, this._tex(nt) || this.white);
        gl.activeTexture(gl.TEXTURE0 + U_TEX);
        normalBound = nt;
      }
      gl.uniform1f(L.u.uNormOn, nt ? 1 : 0);
      gl.uniform1i(L.u.uKind, n.kind);
      gl.uniform4fv(L.u.uHighlight, n.highlight || NO_HIGHLIGHT);
      gl.uniform1f(L.u.uTerrain, n.terrain ? 1 : 0);
      if (n.terrain) {
        // the grid carries positions only
        gl.vertexAttrib3f(1, 0, 1, 0);
        gl.vertexAttrib3f(2, 0.2, 0.25, 0.1);
        gl.vertexAttrib2f(3, 1, 0);
        gl.vertexAttrib2f(4, 0, 0);
      }
      gl.uniform1f(L.u.uScroll, n.scroll || 0);
      gl.bindTexture(gl.TEXTURE_2D, this._tex(n.texture) || this.white);
      this._draw(L, n);
      this.drawCalls++;
    };
    this._drawLit = drawLit;
    this._litNodes(nodes);

    // ---- effects: alpha then additive, depth-tested but not depth-writing
    if (fx) {
      gl.useProgram(this.fx.p);
      gl.uniformMatrix4fv(this.fx.u.uViewProj, false, cam.viewProj);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      const litGain = [0, 1, 2].map((k) => e.skyAmb[k] * 1.1 + e.sunE[k] * 0.11);
      const passes = [
        [fx.alpha, fx.alphaCount, gl.ONE_MINUS_SRC_ALPHA, litGain],
        [fx.add, fx.addCount, gl.ONE, [22, 22, 22]],
      ];
      passes.forEach(([data, count, dst, gain], i) => {
        if (!count) return;
        gl.blendFuncSeparate(gl.SRC_ALPHA, dst, gl.ZERO, gl.ONE);
        gl.uniform3fv(this.fx.u.uGain, gain);
        const b = this.fxBuffers[i];
        gl.bindVertexArray(b.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
        gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 9), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, count);
        this.drawCalls++;
      });
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }

    if (T.msaa) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.msaa.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.scene.fbo);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    }

    // ---- soft particles over the resolved scene, reading its depth
    const layerOn = !!(T.layer && fx && (fx.softAlphaCount || fx.softAddCount));
    if (fx && (fx.softAlphaCount || fx.softAddCount)) {
      const P = this.fxSoft;
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.softFbo);
      gl.viewport(0, 0, W, H);
      if (layerOn) {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.useProgram(P.p);
      gl.uniform1f(P.u.uLayer, layerOn ? 1 : 0);
      gl.uniform2fv(P.u.uFog, e.fog);
      gl.uniform3fv(P.u.uCamPos, cam.pos);
      gl.uniform3fv(P.u.uHaze, [0, 1, 2].map((k) => e.skyAmb[k] * 0.9));
      gl.uniformMatrix4fv(P.u.uViewProj, false, cam.viewProj);
      this._bind(U_DEPTH, T.depthTex);
      gl.uniform1i(P.u.uDepth, U_DEPTH);
      gl.uniform1i(P.u.uNoise, U_NOISE);
      gl.uniform2fv(P.u.uNoiseRange, this.noiseRange);
      gl.uniform2f(P.u.uNearFar, cam.near || 0.3, cam.far || 9000);
      gl.uniform2f(P.u.uInvSize, 1 / W, 1 / H);
      gl.uniform1f(P.u.uClock, this.clock);
      gl.uniform3fv(P.u.uAmb, [0, 1, 2].map((k) => e.skyAmb[k] * 1.1));
      gl.uniform3fv(P.u.uSun, [0, 1, 2].map((k) => e.sunE[k] * 0.11));
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      gl.uniform3f(P.u.uSunCam, dot(e.sunDir, cam.right), dot(e.sunDir, cam.up), -dot(e.sunDir, cam.forward));
      const passes = [
        [fx.softAlpha, fx.softAlphaCount, gl.ONE_MINUS_SRC_ALPHA, 0],
        [fx.softAdd, fx.softAddCount, gl.ONE, 1],
      ];
      passes.forEach(([data, count, dst, additive], i) => {
        if (!count) return;
        // in the layer its alpha is the coverage the composite needs: smoke adds to it, light does not
        if (layerOn && !additive) gl.blendFuncSeparate(gl.SRC_ALPHA, dst, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        else gl.blendFuncSeparate(gl.SRC_ALPHA, dst, gl.ZERO, gl.ONE);
        gl.uniform1f(P.u.uAdditive, additive);
        const b = this.softBuffers[i];
        gl.bindVertexArray(b.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
        gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 13), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, count);
        this.drawCalls++;
      });
      gl.disable(gl.BLEND);
    }

    // ---- post passes
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    this._bind(U_SCENE, T.scene.tex);
    this._bind(U_DEPTH, T.depthTex);

    const shaftsOn = q.shaftSteps > 0;
    if (shaftsOn) {
      const P = this.shafts;
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.shafts.fbo);
      gl.viewport(0, 0, T.shafts.w, T.shafts.h);
      gl.useProgram(P.p);
      this._viewUniforms(P, cam);
      this._bindClouds(P, clouds);
      gl.uniform1i(P.u.uDepth, U_DEPTH);
      gl.uniform1i(P.u.uDome, U_DOME);
      gl.uniform3fv(P.u.uSunDir, e.sunDir);
      gl.uniform2fv(P.u.uFog, e.fog);
      const sp = project(cam.viewProj, add(cam.pos, scale(e.sunDir, 1000)));
      const facing = cam.forward[0] * e.sunDir[0] + cam.forward[1] * e.sunDir[1] + cam.forward[2] * e.sunDir[2];
      gl.uniform2f(P.u.uSunUV, sp[0] * 0.5 + 0.5, sp[1] * 0.5 + 0.5);
      // shafts need the sun in the picture, or only just outside it
      const outside = Math.max(Math.abs(sp[0]) - 1, Math.abs(sp[1]) - 1, 0) * 0.5;
      const near = 1 - Math.min(1, outside / 0.45);
      gl.uniform1f(P.u.uSunFacing, sp[2] > 0 ? Math.min(1, Math.max(0, (facing - 0.1) / 0.35)) * near * near : 0);
      gl.uniform1i(P.u.uSteps, q.shaftSteps);
      gl.uniform1i(P.u.uRaySteps, q.raySteps);
      this._fullscreen();
    }

    if (q.bloom) {
      gl.viewport(0, 0, T.bloomA.w, T.bloomA.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.bloomA.fbo);
      gl.useProgram(this.bloomDown.p);
      gl.uniform1i(this.bloomDown.u.uScene, U_SCENE);
      this._bind(U_LAYER, layerOn ? T.layer.tex : this.clearTex);
      gl.uniform1i(this.bloomDown.u.uLayer, U_LAYER);
      gl.uniform2f(this.bloomDown.u.uTexel, 1 / W, 1 / H);
      gl.uniform1f(this.bloomDown.u.uThreshold, 1.5 / (e.exposure * this.exposureBias));
      this._fullscreen();
      gl.useProgram(this.blur.p);
      gl.uniform1i(this.blur.u.uScene, U_BLOOM);
      for (let i = 0; i < 2; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.bloomB.fbo);
        this._bind(U_BLOOM, T.bloomA.tex);
        gl.uniform2f(this.blur.u.uStep, (1 + i) / T.bloomA.w, 0);
        this._fullscreen();
        gl.bindFramebuffer(gl.FRAMEBUFFER, T.bloomA.fbo);
        this._bind(U_BLOOM, T.bloomB.tex);
        gl.uniform2f(this.blur.u.uStep, 0, (1 + i) / T.bloomA.h);
        this._fullscreen();
      }
    }

    const pixelOn = this.pixelSize > 1;
    gl.bindFramebuffer(gl.FRAMEBUFFER, pixelOn ? T.ldr.fbo : null);
    gl.viewport(0, 0, pixelOn ? W : this.canvas.width, pixelOn ? H : this.canvas.height);
    const C = this.composite;
    gl.useProgram(C.p);
    this._viewUniforms(C, cam);
    this._bind(U_SHAFTS, shaftsOn ? T.shafts.tex : this.noShafts);
    this._bind(U_BLOOM, q.bloom ? T.bloomA.tex : this.black);
    gl.uniform1i(C.u.uScene, U_SCENE);
    gl.uniform1i(C.u.uDepth, U_DEPTH);
    gl.uniform1i(C.u.uShafts, U_SHAFTS);
    gl.uniform1i(C.u.uBloom, U_BLOOM);
    this._bind(U_LAYER, layerOn ? T.layer.tex : this.clearTex);
    gl.uniform1i(C.u.uLayer, U_LAYER);
    gl.uniform3fv(C.u.uSunDir, e.sunDir);
    gl.uniform3fv(C.u.uSunE, e.sunE);
    gl.uniform3fv(C.u.uSkyAmb, e.skyAmb);
    gl.uniform2fv(C.u.uFog, e.fog);
    gl.uniform2f(C.u.uShaftTexel, 1 / T.shafts.w, 1 / T.shafts.h);
    gl.uniform1f(C.u.uExposure, e.exposure * this.exposureBias);
    gl.uniform1f(C.u.uBloomGain, q.bloom ? 0.07 : 0);
    gl.uniform1i(C.u.uDebug, this.debug || 0);
    gl.uniform3fv(C.u.uTint, this.tint);
    gl.uniform1f(C.u.uRayGain, 0.085);
    gl.uniform1f(C.u.uShaftGain, 0.85);
    gl.uniform1f(C.u.uVignette, pixelOn ? 0 : 0.22);
    this._fullscreen();

    if (pixelOn) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this.pixel.p);
      this._bind(U_SCENE, T.ldr.tex);
      gl.uniform1i(this.pixel.u.uScene, U_SCENE);
      gl.uniform2f(this.pixel.u.uSize, W, H);
      gl.uniform1f(this.pixel.u.uLevels, this.pixelLevels);
      this._fullscreen();
    }
    // leave nothing bound that a later pass renders into
    this._bind(U_LAYER, null);
    this._bind(U_SCENE, null);
    this._bind(U_DEPTH, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.bindVertexArray(null);
  }

  /** Opaque nodes, then water and see-through shells blended last without writing depth. */
  _litNodes(nodes) {
    const gl = this.gl;
    const drawLit = this._drawLit;
    let glass = 0;
    for (const n of nodes) {
      if (n.kind === 6 || n.kind === 7 || n.kind === 10) glass++;
      else drawLit(n);
    }
    if (glass) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      gl.depthMask(false);
      for (const n of nodes) if (n.kind === 7) drawLit(n);
      for (const n of nodes) if (n.kind === 6 || n.kind === 10) drawLit(n);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }

  /**
   * A second, small view into rect = [x, y, w, h] (CSS-independent device pixels from the top
   * left) of the finished frame: the hit camera. Call right after render(); it reuses that frame's
   * lighting. opts: {sky: draw the sky behind (else clear to a dark backdrop), dim: 0..1,
   * disc: 0..1 composite only the round middle of rect, that opaque (the status panel's view)}.
   */
  renderInset(nodes, cam, rect, opts = {}) {
    const gl = this.gl;
    if (!this._drawLit || this.lost) return;
    const [x, y, w, h] = rect.map((v) => Math.max(1, Math.round(v)));
    // one target per size: the hit camera and the status panel's view are drawn in the same frame
    if (!this.insetTs) this.insetTs = new Map();
    const key = `${w}x${h}`;
    if (!this.insetTs.has(key)) {
      if (this.insetTs.size > 4) {
        for (const t of this.insetTs.values()) {
          gl.deleteTexture(t.tex);
          gl.deleteFramebuffer(t.fbo);
          gl.deleteTexture(t.depth);
        }
        this.insetTs.clear();
      }
      const t = this._target(w, h, this.hdrFormat, gl.LINEAR);
      const depth = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, depth);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
      this.insetTs.set(key, { ...t, depth, w, h });
    }
    const T = this.insetTs.get(key);
    const e = this.env;
    const chk = (where) => {
      if (!this.debugGL) return;
      const err = gl.getError();
      if (err) console.warn('inset GL error', err, where, gl.checkFramebufferStatus(gl.FRAMEBUFFER));
    };
    chk('setup');
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fbo);
    gl.viewport(0, 0, w, h);
    const bg = opts.backdrop || [0.05, 0.06, 0.07];
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    // the frame's last passes leave depth writes off: a clear would not reach the depth buffer
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (opts.sky) {
      gl.depthMask(false);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.sky.p);
      gl.uniform3fv(this.sky.u.uForward, cam.forward);
      gl.uniform3fv(this.sky.u.uRight, cam.right);
      gl.uniform3fv(this.sky.u.uUp, cam.up);
      gl.uniform2f(this.sky.u.uTan, cam.tanX, cam.tanY);
      this._fullscreen();
    }
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    const L = this.lit;
    gl.useProgram(L.p);
    gl.uniformMatrix4fv(L.u.uViewProj, false, cam.viewProj);
    gl.uniform3fv(L.u.uCamPos, cam.pos);
    // the frame's post passes bound their own textures on the low units: the shadow map back
    this._bind(U_SHADOW, this.shadowTex);
    gl.activeTexture(gl.TEXTURE0 + U_TEX);
    chk('before lit');
    this._litNodes(nodes);
    chk('lit');
    // into the frame, through the tone curve
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(x, this.canvas.height - y - h, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    const P = this.insetProg;
    gl.useProgram(P.p);
    this._bind(U_SCENE, T.tex);
    gl.uniform1i(P.u.uScene, U_SCENE);
    gl.uniform1f(P.u.uExposure, e.exposure * this.exposureBias);
    gl.uniform1f(P.u.uDim, opts.dim || 0);
    gl.uniform1f(P.u.uDisc, opts.disc || 0);
    if (opts.disc) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    }
    this._fullscreen();
    gl.disable(gl.BLEND);
    chk('composite');
    this._bind(U_SCENE, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.bindVertexArray(null);
  }

  _draw(prog, n) {
    const gl = this.gl;
    const m = n.mesh;
    gl.uniformMatrix4fv(prog.u.uModel, false, n.world);
    gl.bindVertexArray(m.vao);
    if (m.indexed) {
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
      return;
    }
    if (m.instanced) {
      if (!m.instances) return;
      gl.uniform1f(prog.u.uInstanced, 1);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, m.instances);
      gl.uniform1f(prog.u.uInstanced, 0);
    } else {
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
    }
  }
}

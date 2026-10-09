// Editor viewport for the design bureau: a small WebGL2 renderer made for CAD work rather than
// looks -- flat-shaded faces with per-vertex colours (zone / thickness / material / weight
// heatmaps), a per-pixel "effective armour from this view" mode, screen-space thick lines for
// edges and gizmos, round vertex points, and a transparent pass for the x-ray interior view.
import { perspective, lookAtLH, mul, project as projectPoint } from '../gfx/math.js';

const MESH_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec4 aCol;
layout(location=3) in float aThick;
uniform mat4 uVP;
out vec3 vN; out vec4 vC; out vec3 vW; out float vT;
void main() {
  vW = aPos; vN = aNrm; vC = aCol; vT = aThick;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const MESH_FS = `#version 300 es
precision highp float;
in vec3 vN; in vec4 vC; in vec3 vW; in float vT;
uniform vec3 uEye; uniform vec3 uLight; uniform int uMode; uniform vec2 uRange;
out vec4 o;
vec3 heat(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 a = vec3(0.78, 0.16, 0.12), b = vec3(0.93, 0.62, 0.16), c = vec3(0.86, 0.86, 0.3), d = vec3(0.3, 0.72, 0.42), e = vec3(0.2, 0.45, 0.85);
  if (t < 0.25) return mix(a, b, t / 0.25);
  if (t < 0.5) return mix(b, c, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c, d, (t - 0.5) / 0.25);
  return mix(d, e, (t - 0.75) / 0.25);
}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(uEye - vW);
  if (!gl_FrontFacing) n = -n;
  vec3 base = vC.rgb;
  if (uMode == 1 && vT > 0.0) {
    float c = max(dot(n, v), 0.08);
    base = heat((vT / c - uRange.x) / (uRange.y - uRange.x));
  }
  float diff = max(dot(n, uLight), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 col = base * (0.26 + 0.52 * diff + 0.3 * hemi) + rim * 0.07;
  o = vec4(pow(col, vec3(1.0 / 1.1)), vC.a);
}`;

const LINE_VS = `#version 300 es
layout(location=0) in vec3 aA;
layout(location=1) in vec3 aB;
layout(location=2) in vec2 aSide;
layout(location=3) in vec4 aCol;
layout(location=4) in float aW;
uniform mat4 uVP; uniform vec2 uView; uniform float uBias;
out vec4 vC;
void main() {
  vec4 a = uVP * vec4(aA, 1.0);
  vec4 b = uVP * vec4(aB, 1.0);
  vec4 p = aSide.y < 0.5 ? a : b;
  vec2 sa = a.xy / max(a.w, 1e-4) * uView;
  vec2 sb = b.xy / max(b.w, 1e-4) * uView;
  vec2 d = sb - sa;
  float l = length(d);
  vec2 dir = l > 1e-6 ? d / l : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  p.xy += nrm * aSide.x * aW / uView * p.w;
  p.z -= uBias * p.w;
  gl_Position = p;
  vC = aCol;
}`;

const LINE_FS = `#version 300 es
precision mediump float;
in vec4 vC; out vec4 o;
void main() { o = vC; }`;

const POINT_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aCol;
layout(location=2) in float aSize;
uniform mat4 uVP; uniform float uBias;
out vec4 vC;
void main() {
  vec4 p = uVP * vec4(aPos, 1.0);
  p.z -= uBias * p.w;
  gl_Position = p;
  gl_PointSize = aSize;
  vC = aCol;
}`;

const POINT_FS = `#version 300 es
precision mediump float;
in vec4 vC; out vec4 o;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  o = vec4(mix(vC.rgb, vec3(0.05), smoothstep(0.55, 1.0, r)), vC.a);
}`;

function compile(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

/** Collects geometry for one frame's buffers. */
export class DrawList {
  constructor() {
    this.tris = [];
    this.alpha = [];
    this.lines = [];
    this.top = []; // lines drawn over everything (gizmo)
    this.points = [];
  }
  /** Flat triangle with a colour [r,g,b,a] and an optional armour value for the LOS mode. */
  tri(a, b, c, n, col, thick = 0, alpha = false) {
    const out = alpha || col[3] < 0.999 ? this.alpha : this.tris;
    for (const p of [a, b, c]) out.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2], col[3], thick);
  }
  /** Triangle with per-corner normals / colours / thickness. */
  triV(ps, ns, cols, ths, alpha = false) {
    const out = alpha ? this.alpha : this.tris;
    for (let k = 0; k < 3; k++) {
      const p = ps[k];
      const n = ns[k];
      const c = cols[k];
      out.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], c[3], ths ? ths[k] : 0);
    }
  }
  line(a, b, col, width = 1.5, onTop = false) {
    const out = onTop ? this.top : this.lines;
    const corners = [
      [-1, 0],
      [1, 0],
      [1, 1],
      [-1, 0],
      [1, 1],
      [-1, 1],
    ];
    for (const [s, e] of corners) out.push(a[0], a[1], a[2], b[0], b[1], b[2], s, e, col[0], col[1], col[2], col[3], width);
  }
  point(p, col, size = 7) {
    this.points.push(p[0], p[1], p[2], col[0], col[1], col[2], col[3], size);
  }
  box(min, max, col, alpha = false) {
    const c = (x, y, z) => [x ? max[0] : min[0], y ? max[1] : min[1], z ? max[2] : min[2]];
    const quads = [
      [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1), [0, 0, 1]],
      [c(1, 0, 0), c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), [0, 0, -1]],
      [c(1, 0, 1), c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), [1, 0, 0]],
      [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0), [-1, 0, 0]],
      [c(0, 1, 1), c(1, 1, 1), c(1, 1, 0), c(0, 1, 0), [0, 1, 0]],
      [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1), [0, -1, 0]],
    ];
    for (const [a, b, cc, d, n] of quads) {
      this.tri(a, b, cc, n, col, 0, alpha);
      this.tri(a, cc, d, n, col, 0, alpha);
    }
  }
  boxEdges(min, max, col, width = 1.2, onTop = false) {
    const c = (x, y, z) => [x ? max[0] : min[0], y ? max[1] : min[1], z ? max[2] : min[2]];
    const e = [
      [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    const pts = [c(0, 0, 0), c(1, 0, 0), c(0, 1, 0), c(1, 1, 0), c(0, 0, 1), c(1, 0, 1), c(0, 1, 1), c(1, 1, 1)];
    for (const [a, b] of e) this.line(pts[a], pts[b], col, width, onTop);
  }
  /** Cylinder along a -> b. */
  cylinder(a, b, r, col, segs = 14, alpha = false) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(...d) || 1;
    const z = d.map((x) => x / l);
    const t = Math.abs(z[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let x = [t[1] * z[2] - t[2] * z[1], t[2] * z[0] - t[0] * z[2], t[0] * z[1] - t[1] * z[0]];
    const xl = Math.hypot(...x);
    x = x.map((v) => v / xl);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const ring = (p, k) => {
      const ang = (k / segs) * Math.PI * 2;
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);
      return { p: [p[0] + (x[0] * cs + y[0] * sn) * r, p[1] + (x[1] * cs + y[1] * sn) * r, p[2] + (x[2] * cs + y[2] * sn) * r], n: [x[0] * cs + y[0] * sn, x[1] * cs + y[1] * sn, x[2] * cs + y[2] * sn] };
    };
    for (let k = 0; k < segs; k++) {
      const a0 = ring(a, k);
      const a1 = ring(a, k + 1);
      const b0 = ring(b, k);
      const b1 = ring(b, k + 1);
      this.triV([a0.p, a1.p, b1.p], [a0.n, a1.n, b1.n], [col, col, col], null, alpha);
      this.triV([a0.p, b1.p, b0.p], [a0.n, b1.n, b0.n], [col, col, col], null, alpha);
      this.tri(a, a1.p, a0.p, z.map((v) => -v), col, 0, alpha);
      this.tri(b, b0.p, b1.p, z, col, 0, alpha);
    }
  }
  circle(c, r, axis, col, width = 1.5, onTop = false, segs = 48) {
    const t = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let x = [t[1] * axis[2] - t[2] * axis[1], t[2] * axis[0] - t[0] * axis[2], t[0] * axis[1] - t[1] * axis[0]];
    const xl = Math.hypot(...x);
    x = x.map((v) => v / xl);
    const y = [axis[1] * x[2] - axis[2] * x[1], axis[2] * x[0] - axis[0] * x[2], axis[0] * x[1] - axis[1] * x[0]];
    let prev = null;
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const p = [c[0] + (x[0] * Math.cos(a) + y[0] * Math.sin(a)) * r, c[1] + (x[1] * Math.cos(a) + y[1] * Math.sin(a)) * r, c[2] + (x[2] * Math.cos(a) + y[2] * Math.sin(a)) * r];
      if (prev) this.line(prev, p, col, width, onTop);
      prev = p;
    }
  }
}

export class EditView {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 不可用');
    this.gl = gl;
    this.mesh = compile(gl, MESH_VS, MESH_FS);
    this.lineP = compile(gl, LINE_VS, LINE_FS);
    this.pointP = compile(gl, POINT_VS, POINT_FS);
    this.bufs = {};
    for (const k of ['tris', 'alpha', 'lines', 'top', 'points', 'grid']) this.bufs[k] = { vao: gl.createVertexArray(), buf: gl.createBuffer(), count: 0 };
    this.cam = { target: [0, 1.2, 0], yaw: 2.4, pitch: 0.38, dist: 13, fov: 34 * (Math.PI / 180) };
    this.mode = 0;
    this.range = [20, 300];
    this.bg = [0.13, 0.145, 0.12];
    this._layout();
    this.setGrid();
  }

  _layout() {
    const gl = this.gl;
    const setup = (b, attrs, stride) => {
      gl.bindVertexArray(b.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
      for (const [loc, size, off] of attrs) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, off * 4);
      }
      gl.bindVertexArray(null);
    };
    const meshAttrs = [
      [0, 3, 0],
      [1, 3, 3],
      [2, 4, 6],
      [3, 1, 10],
    ];
    setup(this.bufs.tris, meshAttrs, 11);
    setup(this.bufs.alpha, meshAttrs, 11);
    const lineAttrs = [
      [0, 3, 0],
      [1, 3, 3],
      [2, 2, 6],
      [3, 4, 8],
      [4, 1, 12],
    ];
    setup(this.bufs.lines, lineAttrs, 13);
    setup(this.bufs.top, lineAttrs, 13);
    setup(this.bufs.grid, lineAttrs, 13);
    setup(this.bufs.points, [
      [0, 3, 0],
      [1, 4, 3],
      [2, 1, 7],
    ], 8);
  }

  _upload(key, arr) {
    const gl = this.gl;
    const b = this.bufs[key];
    gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.DYNAMIC_DRAW);
    const stride = key === 'tris' || key === 'alpha' ? 11 : key === 'points' ? 8 : 13;
    b.count = arr.length / stride;
  }

  setGrid(size = 12, step = 1) {
    const dl = new DrawList();
    for (let k = -size; k <= size; k += step) {
      const major = k % 5 === 0;
      const c = major ? [0.36, 0.38, 0.32, 1] : [0.24, 0.26, 0.22, 1];
      dl.line([k, 0, -size], [k, 0, size], c, major ? 1.2 : 1);
      dl.line([-size, 0, k], [size, 0, k], c, major ? 1.2 : 1);
    }
    dl.line([0, 0.001, 0], [1.2, 0.001, 0], [0.85, 0.3, 0.25, 1], 2);
    dl.line([0, 0.001, 0], [0, 0.001, 1.2], [0.3, 0.5, 0.9, 1], 2);
    this._upload('grid', dl.lines);
  }

  set(dl) {
    this._upload('tris', dl.tris);
    this._upload('alpha', dl.alpha);
    this._upload('lines', dl.lines);
    this._upload('top', dl.top);
    this._upload('points', dl.points);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
  }

  camera() {
    const c = this.cam;
    const cp = Math.cos(c.pitch);
    const eye = [c.target[0] + c.dist * cp * Math.sin(c.yaw), c.target[1] + c.dist * Math.sin(c.pitch), c.target[2] + c.dist * cp * Math.cos(c.yaw)];
    const fwd = [c.target[0] - eye[0], c.target[1] - eye[1], c.target[2] - eye[2]];
    const aspect = this.canvas.width / this.canvas.height;
    const v = lookAtLH(eye, fwd);
    const proj = perspective(c.fov, aspect, 0.05, 400);
    return { eye, view: v.view, right: v.right, up: v.up, forward: v.forward, viewProj: mul(proj, v.view), tanY: Math.tan(c.fov / 2), tanX: Math.tan(c.fov / 2) * aspect };
  }

  /** World ray through a CSS-pixel position of the canvas. */
  ray(px, py) {
    const cam = this.camera();
    const x = (px / this.canvas.clientWidth) * 2 - 1;
    const y = 1 - (py / this.canvas.clientHeight) * 2;
    const d = [0, 1, 2].map((k) => cam.forward[k] + cam.right[k] * x * cam.tanX + cam.up[k] * y * cam.tanY);
    const l = Math.hypot(...d);
    return { o: cam.eye, d: d.map((v) => v / l) };
  }

  /** CSS-pixel position of a world point, with its clip w (negative = behind). */
  toScreen(p, cam = this.camera()) {
    const [x, y, w] = projectPoint(cam.viewProj, p);
    return [((x + 1) / 2) * this.canvas.clientWidth, ((1 - y) / 2) * this.canvas.clientHeight, w];
  }

  render() {
    const gl = this.gl;
    this.resize();
    const cam = this.camera();
    this.lastCam = cam;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(this.bg[0], this.bg[1], this.bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    const view = [this.canvas.width / 2, this.canvas.height / 2];
    const lineProg = (bias) => {
      gl.useProgram(this.lineP.p);
      gl.uniformMatrix4fv(this.lineP.u.uVP, false, cam.viewProj);
      gl.uniform2f(this.lineP.u.uView, view[0], view[1]);
      gl.uniform1f(this.lineP.u.uBias, bias);
    };
    // grid
    lineProg(0);
    gl.disable(gl.CULL_FACE);
    this._draw('grid');
    // opaque faces
    const L = [0.45, 0.8, 0.35];
    const ll = Math.hypot(...L);
    gl.useProgram(this.mesh.p);
    gl.uniformMatrix4fv(this.mesh.u.uVP, false, cam.viewProj);
    gl.uniform3fv(this.mesh.u.uEye, cam.eye);
    gl.uniform3f(this.mesh.u.uLight, L[0] / ll, L[1] / ll, L[2] / ll);
    gl.uniform1i(this.mesh.u.uMode, this.mode);
    gl.uniform2f(this.mesh.u.uRange, this.range[0], this.range[1]);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    this._draw('tris');
    gl.disable(gl.POLYGON_OFFSET_FILL);
    // edges and points
    lineProg(0.0004);
    this._draw('lines');
    gl.useProgram(this.pointP.p);
    gl.uniformMatrix4fv(this.pointP.u.uVP, false, cam.viewProj);
    gl.uniform1f(this.pointP.u.uBias, 0.0008);
    this._draw('points', gl.POINTS);
    // transparent shells
    if (this.bufs.alpha.count) {
      gl.useProgram(this.mesh.p);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.FRONT);
      this._draw('alpha');
      gl.cullFace(gl.BACK);
      this._draw('alpha');
      gl.disable(gl.CULL_FACE);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    // gizmo and highlights on top
    if (this.bufs.top.count) {
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      lineProg(0);
      this._draw('top');
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
    }
  }

  _draw(key, mode) {
    const gl = this.gl;
    const b = this.bufs[key];
    if (!b.count) return;
    gl.bindVertexArray(b.vao);
    gl.drawArrays(mode ?? gl.TRIANGLES, 0, b.count);
    gl.bindVertexArray(null);
  }
}

// CPU witnesses use the production Renderer ownership and production builders.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { Renderer } from '../src/gfx/renderer.js';
import { buildTank, addPart, materials } from '../src/gfx/tankmodel.js';
import { buildInterior, setCrewModel } from '../src/gfx/interior.js';
import { setMgModels } from '../src/gfx/mgmodel.js';
import { GeoBuilder, STRIDE } from '../src/gfx/geo.js';
import { makeLoadout, generatedTurretParts } from '../src/game/loadout.js';
import { mul, transformPoint } from '../src/gfx/math.js';
import { Enemy } from '../src/game/enemies.js';
import { loadData } from './load-data.mjs';

export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const bytesOf = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
export function rendererSink() {
  let serial = 0;
  const gl = { ARRAY_BUFFER: 1, FLOAT: 2, STATIC_DRAW: 3, DYNAMIC_DRAW: 4,
    createVertexArray: () => ({ vao: ++serial }), createBuffer: () => ({ buffer: ++serial }),
    bindVertexArray() {}, bindBuffer() {}, bufferData() {}, bufferSubData() {},
    enableVertexAttribArray() {}, vertexAttribPointer() {}, vertexAttribDivisor() {},
    deleteVertexArray() {}, deleteBuffer() {}, getExtension: () => true };
  return Object.assign(Object.create(Renderer.prototype), { gl, _live: new Set(), _texSrc: new Map(), lost: false });
}
export function positionsOf(data) {
  if (!(data instanceof Float32Array) || data.length % (STRIDE * 3)) throw new Error('renderer triangle-list buffer contract');
  const out = new Float32Array(data.length / STRIDE * 3);
  // Integer copies preserve the actual emitted bits, including signed zero.
  const src = new Uint32Array(data.buffer, data.byteOffset, data.length), dst = new Uint32Array(out.buffer);
  for (let i = 0; i < data.length / STRIDE; i++) dst.set(src.subarray(i * STRIDE, i * STRIDE + 3), i * 3);
  return out;
}
export function physicalNodeKey(node,parent,index){
  const source=node.mesh?._src?.hitSource;
  // Imported source identity never depends on decoder UID or the current filtered child slot.
  return source?`${parent}/import:${sha(Buffer.from(JSON.stringify([source.key,source.origin])))}`:`${parent}/${index}:${node.name}`;
}
export function captureNodes(root) {
  const out = [];
  const walk = (node, key, parent) => {
    if (node.mesh?._src?.data) {
      const mesh = node.mesh, data = mesh._src.data.slice(), count = mesh.instanced ? mesh.instances : 1;
      if (!Number.isInteger(count) || count < 0 || (mesh.instanced && count > mesh.maxInstances)) throw new Error('renderer instance count contract');
      if (mesh.instanced && count && (!(mesh._src.matrices instanceof Float32Array) || mesh._src.matrices.length < count * 16)) throw new Error('renderer instance matrix contract');
      const matrices = mesh.instanced ? (mesh._src.matrices?.slice(0, count * 16) || new Float32Array(0)) : null;
      out.push({ key, parent, node, data, positions: positionsOf(data), world: node.world.slice(), matrices, count, hitSource: mesh._src.hitSource ? structuredClone(mesh._src.hitSource) : null });
    }
    node.children.forEach((c, i) => walk(c, physicalNodeKey(c,key,i), key));
  };
  walk(root, root.name, null);
  return out;
}
export function verifyCrewCapture(interior,crew,asset){
  if(asset?.version!==2||!Array.isArray(asset.figures)||!asset.figures.length)throw new Error('actual v2 crew asset is required');
  for(let i=0;i<crew.length;i++){
    const figure=asset.figures[asset.roles?.[crew[i].role] ?? asset.roles?.default ?? 0] || asset.figures[0];
    const expected=Buffer.from(figure.index,'base64').byteLength/2;
    if(!Number.isInteger(expected)||!expected||interior.byCrew[i]?.mesh?._src?.data?.length!==expected*STRIDE)throw new Error(`actual crew decoder fell back or omitted slot ${i}`);
  }
}
export function hetzerWitness() {
  const data = loadData(), bundle = data.vehicles.de_hetzer, renderer = rendererSink();
  const crewAsset=JSON.parse(fs.readFileSync(new URL('../assets/crew_model.json', import.meta.url)));setCrewModel(crewAsset);
  setMgModels(JSON.parse(fs.readFileSync(new URL('../assets/mg_models.json', import.meta.url))));
  const loadout = makeLoadout('de_hetzer', bundle, data.projectiles, data.machineGuns);
  const model = buildTank(renderer, loadout, generatedTurretParts);
  const interior = buildInterior(renderer, model, loadout, bundle.modules, bundle.crew);
  verifyCrewCapture(interior,bundle.crew,crewAsset);
  model.root.update();
  const capture = captureNodes(model.root);
  // Select the original part's range in the production merged recoiling mesh.
  const g = loadout.turrets[0].guns[0], moving = new GeoBuilder();
  let first = -1, count = 0;
  bundle.visual.parts.forEach((p, i) => {
    if (p.mount !== 'gun' || (p.turret || 0) !== 0 || (p.gun || 0) !== 0 || !p.recoil || p.payload != null) return;
    const start = moving.vertexCount;
    addPart(moving, p, g.trunnion, materials(bundle.visual.palette), g.def.caliber_mm / 2000);
    if (i === 14) { first = start; count = moving.vertexCount - start; }
  });
  const barrel = capture.find(n => n.node === model.turrets[0].guns[0].barrel);
  if (!barrel || first < 0) throw new Error('Hetzer rendered barrel range not found');
  if (!bytesOf(moving.build()).equals(bytesOf(barrel.data))) throw new Error('Range selector differs from actual merged renderer buffer');
  const tube = { ...barrel, key: `${barrel.key}/visual:14`, data: barrel.data.slice(first * STRIDE, (first + count) * STRIDE) };
  tube.positions = positionsOf(tube.data); tube.firstTriangle = first / 3;
  const h = bundle.vehicle.hull.size_m, ts = bundle.vehicle.turret.size_m;
  const vec = p => [p.x,p.y,p.z];
  const plates=bundle.armor.map(p=>({id:p.id,zone:p.zone,turret:/^turret|mantlet|gun/.test(p.zone || p.id),t:p.thickness_mm,c:vec(p.center),n:vec(p.normal),u:vec(p.axis_u),hu:p.half_u,hv:p.half_v,def:p}));
  const enemy = Object.assign(Object.create(Enemy.prototype), { veh: { body: { localPoint: p => p.slice() } }, x: 0, z: 0,
    radius: Math.hypot(h[0], h[2]) / 2, plates, turretYaw:0,fold:0,turret:bundle.vehicle.turret, box: { hw: h[0] / 2, hl: h[2] / 2, top: h[1] + (ts[1] || 0) } });
  return { capture, tube, enemy, model, interior, dispose() { interior.dispose(); model.dispose(); } };
}

// Independent double-sided Moller-Trumbore oracle, deliberately unrelated to the Rust sheared query.
export function bruteForce(capture, a, b) {
  const d = b.map((v, k) => v - a[k]), hits = [];
  const cross = (x, y) => [x[1]*y[2]-x[2]*y[1], x[2]*y[0]-x[0]*y[2], x[0]*y[1]-x[1]*y[0]];
  const dot = (x, y) => x.reduce((v, q, k) => v + q * y[k], 0);
  const sub = (x, y) => x.map((v, k) => v - y[k]);
  for (const n of capture) for (let instance = 0; instance < n.count; instance++) {
    const world = n.matrices ? mul(n.world, n.matrices.subarray(instance * 16, instance * 16 + 16)) : n.world;
    for (let triangle = 0; triangle < n.positions.length / 9; triangle++) {
      const v = [0, 1, 2].map(k => transformPoint(world, n.positions.subarray(triangle * 9 + k * 3, triangle * 9 + k * 3 + 3)));
      const e1 = sub(v[1], v[0]), e2 = sub(v[2], v[0]), p = cross(d, e2), det = dot(e1, p);
      if (Math.abs(det) < 1e-14) continue;
      const s = sub(a, v[0]), u = dot(s, p) / det, q = cross(s, e1), w = dot(d, q) / det, t = dot(e2, q) / det;
      if (u >= -1e-12 && w >= -1e-12 && u + w <= 1 + 1e-12 && t >= 0 && t <= 1) hits.push({ t, triangle, key: n.key, instance });
    }
  }
  return hits.sort((x, y) => x.t - y.t || x.key.localeCompare(y.key) || x.instance - y.instance || x.triangle - y.triangle);
}

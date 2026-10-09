// Imported vehicle models (tools/glb-vehicle.py -> data/vehicles/<id>/model.json): the pieces of a
// real model -- hull, traversing mount, elevating gun, recoiling barrel, each wheel -- with their
// colour and normal maps. Decoded once when the game starts (the geometry is one zlib blob), then
// turned into meshes on first use and shared by every vehicle of that type.
import { STRIDE } from './geo.js';

async function inflate(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Response(stream).arrayBuffer();
}

/** model.json -> {source, bounds, parts: [{mount, side, index, texture, normal, pos, nor, uv, idx}], images}. */
export async function decodeImported(model) {
  const buf = await inflate(model.blob);
  const parts = model.parts.map((p) => {
    const pos = new Int16Array(buf, p.pos, p.vertices * 3);
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i++) {
      const k = i % 3;
      const v = pos[i] / 1000;
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
    return {
      ...p,
      lo,
      hi,
      pos,
      nor: new Int8Array(buf, p.nor, p.vertices * 3),
      uv: new Uint16Array(buf, p.uv, p.vertices * 2),
      idx: p.idx32 ? new Uint32Array(buf, p.idx, p.triangles * 3) : new Uint16Array(buf, p.idx, p.triangles * 3),
    };
  });
  const images = model.textures.map((t) => {
    if (typeof Image === 'undefined') return null;
    const img = new Image();
    img.src = t.src;
    return img;
  });
  return { uid: ++uids, source: model.source, bounds: model.bounds, parts, images };
}
let uids = 0;

/**
 * Decodes every vehicle's imported model in place (bundle.imported); failures leave the built-in
 * look. onProgress(done, total) after each model.
 */
export async function decodeAllImported(vehicles, onProgress) {
  const todo = Object.values(vehicles).filter((b) => b.model && !b.imported);
  let done = 0;
  if (onProgress) onProgress(0, todo.length);
  await Promise.all(
    todo.map(async (bundle) => {
      try {
        bundle.imported = await decodeImported(bundle.model);
      } catch (e) {
        console.warn('imported model unavailable:', e.message);
        bundle.imported = null;
      }
      if (onProgress) onProgress(++done, todo.length);
    }),
  );
  // a variant borrows the pieces it shares with the vehicle it was made from (hull, wheels)
  for (const bundle of Object.values(vehicles)) {
    const sh = bundle.model && bundle.model.shared;
    const own = bundle.imported;
    const from = sh && vehicles[sh.from] && vehicles[sh.from].imported;
    if (!own || !from || own.borrowed) continue;
    const base = own.images.length;
    const mounts = new Set(sh.mounts);
    for (const p of from.parts) {
      if (!mounts.has(p.mount)) continue;
      own.parts.push({ ...p, texture: p.texture >= 0 ? p.texture + base : -1, normal: p.normal >= 0 ? p.normal + base : -1 });
    }
    own.images = own.images.concat(from.images);
    own.bounds = [0, 1].map((e) => own.bounds[e].map((v, k) => (e ? Math.max(v, from.bounds[e][k]) : Math.min(v, from.bounds[e][k]))));
    own.borrowed = true;
  }
}

/**
 * Interleaved vertices (GeoBuilder layout, one triangle list) of one part, moved so `origin` (hull
 * frame) is at 0. The texture is uploaded flipped, so v counts up from the bottom here.
 */
export function partVertices(part, origin, mat) {
  const n = part.idx.length;
  const out = new Float32Array(n * STRIDE);
  const { pos, nor, uv, idx } = part;
  for (let k = 0; k < n; k++) {
    const i = idx[k];
    const o = k * STRIDE;
    out[o] = pos[i * 3] / 1000 - origin[0];
    out[o + 1] = pos[i * 3 + 1] / 1000 - origin[1];
    out[o + 2] = pos[i * 3 + 2] / 1000 - origin[2];
    out[o + 3] = nor[i * 3] / 127;
    out[o + 4] = nor[i * 3 + 1] / 127;
    out[o + 5] = nor[i * 3 + 2] / 127;
    out[o + 6] = mat.color[0];
    out[o + 7] = mat.color[1];
    out[o + 8] = mat.color[2];
    out[o + 9] = mat.rough;
    out[o + 10] = mat.metal;
    out[o + 11] = uv[i * 2] / 65535;
    out[o + 12] = 1 - uv[i * 2 + 1] / 65535;
  }
  return out;
}

// meshes and textures per renderer, shared by all vehicles of a type
const caches = new WeakMap();
function cacheOf(renderer) {
  if (!caches.has(renderer)) caches.set(renderer, { meshes: new WeakMap(), textures: new Map() });
  return caches.get(renderer);
}

/** The GL texture of an image (null until it has loaded; `then` runs when it does). */
export function imageTexture(renderer, img, then) {
  if (!img) return null;
  const c = cacheOf(renderer);
  if (c.textures.has(img)) return c.textures.get(img);
  if (img.complete && img.naturalWidth) {
    const t = renderer.texture(img);
    c.textures.set(img, t);
    return t;
  }
  if (then) img.addEventListener('load', () => then(imageTexture(renderer, img)), { once: true });
  return null;
}

/** A part's mesh with its origin at `origin`, shared even when a workshop filters its list. */
export function partMesh(renderer, key, part, origin) {
  const c = cacheOf(renderer);
  // The caller's legacy key contains a list index, which changes when stock weapon parts are
  // removed. The decoded part itself is stable; its actual origin is the other mesh input.
  if (!c.meshes.has(part)) c.meshes.set(part, new Map());
  const meshes = c.meshes.get(part);
  const originKey = origin.join(',');
  // the material's own roughness and metalness when the model gives them (older imports: paint)
  if (!meshes.has(originKey)) meshes.set(originKey, renderer.mesh(partVertices(part, origin, { color: [1, 1, 1], rough: part.rough ?? 0.72, metal: part.metal ?? 0.18 })));
  return meshes.get(originKey);
}

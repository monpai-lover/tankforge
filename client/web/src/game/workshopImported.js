// Workshop chassis reuse stays separate from the expensive independent-file export. Both use
// the stock decoder's geometry and material indices; no source parts or browser images change.
const replacementModels = new WeakMap();
const exportedModels = new WeakMap();
const movingWeapon = p => p.mount === 'turret' || p.mount === 'gun' || p.mount === 'barrel';

function decodedModel(base) {
  const imported = base.imported;
  if (!imported && base.model) throw new Error('Workshop imported model must be decoded before use');
  if (imported && base.model?.shared && !imported.borrowed) throw new Error('Workshop shared chassis must be resolved before use');
  return imported || null;
}

function boundsOf(parts) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], p.lo[k]);
    hi[k] = Math.max(hi[k], p.hi[k]);
  }
  return [lo, hi];
}

/** A cached decoded model for live workshop builds. Fixed geometry and images stay shared. */
export function workshopImportedModel(base, keepStock) {
  const imported = decodedModel(base);
  if (!imported || keepStock) return imported;
  if (!replacementModels.has(imported)) {
    const parts = imported.parts.filter(p => !movingWeapon(p));
    replacementModels.set(imported, parts.length ? { ...imported, parts, bounds: boundsOf(parts) } : null);
  }
  return replacementModels.get(imported);
}

// decodeAllImported appends a shared source's images after the variant's own images, and shifts
// borrowed texture/normal indices by exactly that count. Follow the same order using packed
// texture records, which are also available in Node where decoded images are null.
function textureSources(base, data, seen = new Set()) {
  const model = base.model;
  if (!model || seen.has(model)) throw new Error('Workshop shared model source is missing or cyclic');
  seen.add(model);
  const sources = [model];
  if (model.shared) {
    const from = data?.vehicles?.[model.shared.from];
    if (!from?.model) throw new Error(`Workshop shared chassis source is missing: ${model.shared.from}`);
    sources.push(...textureSources(from, data, seen));
  }
  return sources;
}

// Standard zlib/DEFLATE stored blocks. Export can be synchronous without a browser-only
// CompressionStream or a new dependency, while decodeImported reads the existing format.
function storedZlib(bytes) {
  const blocks = Math.max(1, Math.ceil(bytes.length / 65535));
  const out = new Uint8Array(2 + blocks * 5 + bytes.length + 4);
  out.set([0x78, 0x01]);
  const view = new DataView(out.buffer);
  let offset = 2;
  for (let block = 0; block < blocks; block++) {
    const start = block * 65535;
    const len = Math.min(65535, bytes.length - start);
    out[offset++] = block === blocks - 1 ? 1 : 0;
    view.setUint16(offset, len, true);
    view.setUint16(offset + 2, (~len) & 65535, true);
    offset += 4;
    out.set(bytes.subarray(start, start + len), offset);
    offset += len;
  }
  let a = 1;
  let b = 0;
  for (let start = 0; start < bytes.length; start += 5552) {
    const end = Math.min(bytes.length, start + 5552);
    for (let i = start; i < end; i++) {
      a += bytes[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  view.setUint32(offset, ((b << 16) | a) >>> 0, false);
  let binary = '';
  for (let start = 0; start < out.length; start += 32768) binary += String.fromCharCode(...out.subarray(start, start + 32768));
  return btoa(binary);
}

function packedModel(base, imported, textures) {
  const aligned = n => Math.ceil(n / 4) * 4;
  const size = imported.parts.reduce((total, p) => total + ['pos', 'nor', 'uv', 'idx'].reduce((n, key) => n + aligned(p[key].byteLength), 0), 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  const put = array => {
    const start = offset;
    bytes.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), start);
    offset += aligned(array.byteLength);
    return start;
  };
  const parts = imported.parts.map(p => {
    const { lo, hi, pos, nor, uv, idx, ...metadata } = p;
    return { ...metadata, pos: put(pos), nor: put(nor), uv: put(uv), idx: put(idx) };
  });
  const { shared, ...model } = base.model;
  return { ...model, bounds: imported.bounds, textures, parts, blob: storedZlib(bytes), blob_size: bytes.length };
}

/** A self-contained model.json for actual export. Geometry packing is cached per source/policy. */
export function exportWorkshopModel(base, keepStock, data) {
  const imported = workshopImportedModel(base, keepStock);
  if (!imported) return null;
  if (!base.model) throw new Error('Workshop imported model source is missing');
  const sources = textureSources(base, data);
  let cached = exportedModels.get(base.imported);
  if (!cached || cached.sources.length !== sources.length || cached.sources.some((model, i) => model !== sources[i])) {
    cached = { sources, models: new Map() };
    exportedModels.set(base.imported, cached);
  }
  const policy = !!keepStock;
  if (!cached.models.has(policy)) {
    const textures = sources.flatMap(model => model.textures);
    for (const part of imported.parts) for (const key of ['texture', 'normal']) {
      if (part[key] >= textures.length) throw new Error('Workshop shared model material source is incomplete');
    }
    const model = base.model.shared
      ? packedModel(base, imported, textures)
      : { ...base.model, bounds: imported.bounds, parts: base.model.parts.filter(p => policy || !movingWeapon(p)) };
    cached.models.set(policy, model);
  }
  return cached.models.get(policy);
}

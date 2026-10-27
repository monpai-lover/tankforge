// Query only the retained registered triangle scene. No substitute geometry or
// resistance is created when an actor's registration/pose is unavailable.
function surfaceCollisionUploadMatches(witness) {
  const mesh = witness.mesh, src = mesh?._src, data = src?.data, buffer = witness.buffer;
  return buffer.node === witness.node && buffer.mesh === mesh && buffer.words === witness.words &&
    buffer.vertexCount === witness.vertexCount && buffer.instances === witness.instances &&
    witness.node.mesh === mesh && mesh.buf === witness.buf && mesh.vao === witness.vao &&
    src?.kind === witness.kind && !!mesh.instanced === witness.instanced &&
    src === witness.src && data === witness.data && data.buffer === witness.dataBuffer &&
    data.byteOffset === witness.byteOffset && data.length === witness.length &&
    mesh.count === witness.buffer.vertexCount &&
    (mesh.instanced ? mesh.instances : 1) === witness.buffer.instances;
}
function surfaceCollisionRenderer(record, ownerRenderer) {
  return record.renderer || record.model?.hitbox?.capture?.renderer || ownerRenderer;
}
function surfaceCollisionSealBounds(record, ownerRenderer) {
  if (!record?.available || !record.registered || record.registrationFailed) return;
  try {
  const renderer = surfaceCollisionRenderer(record, ownerRenderer);
  if (!renderer?._live || typeof renderer._live.has !== 'function' || renderer.lost) {
    record.surfaceCollisionBounds = null; return;
  }
  const old = record.surfaceCollisionBounds;
  if (old?.buffers === record.buffers && old.geometryRevision === record.geometryRevision &&
      old.shapeHash === record.shapeHash && old.renderer === renderer &&
      old.witnesses.length === record.buffers.length && old.witnesses.every((w, index) =>
        record.buffers[index] === w.buffer && surfaceCollisionUploadMatches(w) && renderer._live.has(w.mesh))) return;
  const witnesses = [], byNode = new Map();
  // Renderer._upload always creates a new static vertex buf+vao. Its only
  // supported in-place upload is setInstances(m.ibuf), whose matrices are read
  // below. Without this actual GPU-upload witness, defer to the exact owner.
  for (const buffer of record.buffers || []) {
    const mesh = buffer.mesh, src = mesh?._src, data = src?.data;
    if (!mesh?.buf || !mesh.vao || !renderer._live.has(mesh) || !['mesh', 'instanced'].includes(src?.kind) ||
        !data?.buffer || data.length !== buffer.vertexCount * 13 || mesh.count !== buffer.vertexCount ||
        !buffer.words?.buffer || buffer.words.length !== buffer.vertexCount * 3 ||
        !buffer.vertexCount || byNode.has(buffer.node)) { record.surfaceCollisionBounds = null; return; }
    const witness = { buffer, node: buffer.node, mesh, words: buffer.words, vertexCount: buffer.vertexCount,
      instances: buffer.instances, kind: src.kind, instanced: !!mesh.instanced,
      src, data, dataBuffer: data.buffer, byteOffset: data.byteOffset,
      length: data.length, buf: mesh.buf, vao: mesh.vao, lo: new Float64Array(3), hi: new Float64Array(3) };
    witness.lo.fill(Infinity); witness.hi.fill(-Infinity);
    witnesses.push(witness); byNode.set(buffer.node, witness);
  }
  // Scan the accepted, pinned Float32 position stream once per uploaded shape,
  // never on each frame or projectile query.
  for (const witness of witnesses) {
    const words = witness.buffer.words, positions = new Float32Array(words.buffer, words.byteOffset, words.length);
    for (let i = 0; i < positions.length; i++) {
      const v = positions[i], k = i % 3;
      if (!Number.isFinite(v)) { record.surfaceCollisionBounds = null; return; }
      witness.lo[k] = Math.min(witness.lo[k], v); witness.hi[k] = Math.max(witness.hi[k], v);
    }
  }
  const leaves = [];
  for (const row of record.rows || []) {
    const witness = byNode.get(row.node);
    if (!witness || !Number.isSafeInteger(row.ordinal) || row.ordinal < 0 || row.ordinal >= witness.buffer.instances) {
      record.surfaceCollisionBounds = null; return;
    }
    leaves.push({ row, key: row.key, ordinal: row.ordinal, witness, node: new Float64Array(16), instance: new Float64Array(16),
      matrix: new Float64Array(16), matrixTerms: new Float64Array(16), arithmeticScale: 1,
      lo: new Float64Array(3), hi: new Float64Array(3), initialized: false });
  }
  const topology = [], pending = [record.model.root];
  while (pending.length) {
    const node = pending.pop();
    // Use the exact same subtree exclusion as LocalSurfaceCombat.nodesOf.
    // Hidden broken-barrel mirrors are presentation, never physical members.
    if (node.damageVisual) continue;
    const source = node.mesh?._src?.hitSource, children = [];
    for (let index = 0; index < (node.children || []).length; index++) {
      const child = node.children[index];
      if (child.damageVisual) continue;
      children.push({ node: child, index }); pending.push(child);
    }
    topology.push({ node, name: node.name, mesh: node.mesh, children,
      sourceText: source ? JSON.stringify([source.key, source.origin]) : null });
  }
  record.surfaceCollisionBounds = { buffers: record.buffers, geometryRevision: record.geometryRevision,
    shapeHash: record.shapeHash, renderer, root: record.model.root, rows: record.rows,
    witnesses, byNode, leaves, topology, stack: [], lo: new Float64Array(3),
    hi: new Float64Array(3), arithmeticScale: 1, initialized: false,
    stats: { seals: (old?.stats.seals || 0) + 1, positionValuesRead: witnesses.reduce((n, w) => n + w.buffer.words.length, 0),
      poseBoundsUpdates: 0, definiteMisses: 0 } };
  } catch { record.surfaceCollisionBounds = null; }
}
function surfaceCollisionAffine(matrix, offset = 0) {
  if (!matrix || matrix.length < offset + 16) return false;
  for (let i = 0; i < 16; i++) if (!Number.isFinite(matrix[offset + i])) return false;
  if (matrix[offset + 3] !== 0 || matrix[offset + 7] !== 0 || matrix[offset + 11] !== 0 || matrix[offset + 15] !== 1) return false;
  const a = matrix[offset], b = matrix[offset + 4], c = matrix[offset + 8], d = matrix[offset + 1],
    e = matrix[offset + 5], f = matrix[offset + 9], g = matrix[offset + 2], h = matrix[offset + 6], i = matrix[offset + 10];
  return Math.abs(a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)) >= 1e-12;
}
function surfaceCollisionBoundsMiss(record, p0, p1, ownerRenderer) {
  const cache = record?.surfaceCollisionBounds;
  if (!cache || !record.available || !record.registered || record.registrationFailed ||
      cache.buffers !== record.buffers || cache.geometryRevision !== record.geometryRevision ||
      cache.shapeHash !== record.shapeHash || cache.root !== record.model?.root ||
      cache.witnesses.length !== record.buffers?.length || cache.rows !== record.rows ||
      cache.leaves.length !== record.rows?.length || !cache.leaves.length) return null;
  let verified = false;
  try {
    const renderer = surfaceCollisionRenderer(record, ownerRenderer);
    if (cache.renderer !== renderer || renderer.lost || !renderer._live || typeof renderer._live.has !== 'function') return null;
    // Body.localPoint uses the transpose of its orthonormal frame. A malformed
    // or ill-conditioned frame is not a verified coordinate conversion.
    const ex = record.body.ex, ey = record.body.ey, ez = record.body.ez;
    for (let i = 0; i < 3; i++) {
      const axis = i === 0 ? ex : i === 1 ? ey : ez;
      if (!axis || axis.length !== 3 || !axis.every(Number.isFinite)) return null;
      for (let j = 0; j <= i; j++) {
        const other = j === 0 ? ex : j === 1 ? ey : ez;
        const dot = axis[0] * other[0] + axis[1] * other[1] + axis[2] * other[2];
        if (Math.abs(dot - (i === j ? 1 : 0)) > 64 * 2 ** -23) return null;
      }
    }
    record.model.root.update();
    for (let index = 0; index < cache.witnesses.length; index++) {
      const witness = cache.witnesses[index];
      if (record.buffers[index] !== witness.buffer || !surfaceCollisionUploadMatches(witness) ||
          !renderer._live.has(witness.mesh)) return null;
    }
    for (const entry of cache.topology) {
      const node = entry.node, source = node.mesh?._src?.hitSource, children = node.children || [];
      if (node.damageVisual || node.name !== entry.name || node.mesh !== entry.mesh ||
          (source ? JSON.stringify([source.key, source.origin]) : null) !== entry.sourceText) return null;
      let physicalIndex = 0;
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        if (child.damageVisual) continue;
        const prior = entry.children[physicalIndex++];
        if (!prior || child !== prior.node || index !== prior.index) return null;
      }
      if (physicalIndex !== entry.children.length) return null;
    }
    // O(nodes + instances) membership/matrix checks, without a vertex walk.
    const stack = cache.stack; stack.length = 0; stack.push(record.model.root, false); let count = 0;
    while (stack.length) {
      const inherited = stack.pop(), node = stack.pop();
      if (node.damageVisual) continue;
      const disabled = inherited || node.hitboxDisabled === true;
      if (node.mesh?._src?.data) { if (disabled || !cache.byNode.has(node)) return null; count++; }
      for (const child of node.children || []) stack.push(child, disabled);
    }
    if (count !== cache.witnesses.length) return null;
    let changed = !cache.initialized;
    for (let index = 0; index < cache.leaves.length; index++) {
      const leaf = cache.leaves[index];
      if (record.rows[index] !== leaf.row || leaf.row.node !== leaf.witness.node ||
          leaf.row.ordinal !== leaf.ordinal || leaf.row.key !== leaf.key) return null;
      const node = leaf.row.node.world, mesh = leaf.row.node.mesh,
        instance = mesh.instanced ? mesh._src.matrices : null, offset = leaf.row.ordinal * 16;
      if (!surfaceCollisionAffine(node) || mesh.instanced &&
          (instance?.length !== mesh.instances * 16 || !surfaceCollisionAffine(instance, offset))) return null;
      let different = !leaf.initialized;
      for (let i = 0; i < 16; i++) {
        const value = instance ? instance[offset + i] : (i % 5 === 0 ? 1 : 0);
        if (leaf.node[i] !== node[i] || leaf.instance[i] !== value) different = true;
        leaf.node[i] = node[i]; leaf.instance[i] = value;
      }
      if (!different) continue;
      changed = true; cache.stats.poseBoundsUpdates++;
      for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
        let value = 0, terms = 0;
        for (let k = 0; k < 4; k++) {
          const product = leaf.node[k * 4 + row] * leaf.instance[col * 4 + k];
          value += product; terms += Math.abs(product);
        }
        if (!Number.isFinite(value) || !Number.isFinite(terms)) return null;
        leaf.matrix[col * 4 + row] = value; leaf.matrixTerms[col * 4 + row] = terms;
      }
      leaf.arithmeticScale = 1;
      for (let row = 0; row < 3; row++) {
        let lo = leaf.matrix[12 + row], hi = lo, terms = leaf.matrixTerms[12 + row];
        for (let k = 0; k < 3; k++) {
          const a = leaf.matrix[k * 4 + row] * leaf.witness.lo[k], b = leaf.matrix[k * 4 + row] * leaf.witness.hi[k];
          lo += Math.min(a, b); hi += Math.max(a, b);
          terms += leaf.matrixTerms[k * 4 + row] * Math.max(Math.abs(leaf.witness.lo[k]), Math.abs(leaf.witness.hi[k]));
        }
        if (!Number.isFinite(lo) || !Number.isFinite(hi) || !Number.isFinite(terms)) return null;
        leaf.lo[row] = lo; leaf.hi[row] = hi;
        leaf.arithmeticScale = Math.max(leaf.arithmeticScale, terms);
      }
      leaf.initialized = true;
    }
    if (changed) {
      cache.lo.fill(Infinity); cache.hi.fill(-Infinity);
      cache.arithmeticScale = 1;
      for (const leaf of cache.leaves) for (let k = 0; k < 3; k++) {
        cache.lo[k] = Math.min(cache.lo[k], leaf.lo[k]); cache.hi[k] = Math.max(cache.hi[k], leaf.hi[k]);
        cache.arithmeticScale = Math.max(cache.arithmeticScale, leaf.arithmeticScale);
      }
      cache.initialized = true;
    }
    verified = true;
    // Match trace's actual body-local input frame before comparing world bounds.
    const localA = record.body.localPoint(p0), localB = record.body.localPoint(p1),
      a = record.body.worldPoint(localA), b = record.body.worldPoint(localB), origin = record.body.origin();
    let scale = cache.arithmeticScale;
    for (let k = 0; k < 3; k++) {
      if (![a[k], b[k], cache.lo[k], cache.hi[k], origin[k], Math.fround(localA[k]), Math.fround(localB[k])].every(Number.isFinite)) return null;
      const terms = Math.abs(origin[k]) +
        Math.abs(ex[k]) * Math.max(Math.abs(localA[0]), Math.abs(localB[0])) +
        Math.abs(ey[k]) * Math.max(Math.abs(localA[1]), Math.abs(localB[1])) +
        Math.abs(ez[k]) * Math.max(Math.abs(localA[2]), Math.abs(localB[2]));
      if (!Number.isFinite(terms)) return null;
      scale = Math.max(scale, terms, Math.abs(a[k]), Math.abs(b[k]), Math.abs(cache.lo[k]), Math.abs(cache.hi[k]));
    }
    // Numeric error only: include absolute affine terms before cancellation,
    // and body-local f32 narrowing mapped through the actual hull frame.
    const pad = 32 * 2 ** -23 * scale; let enter = 0, exit = 1;
    for (let k = 0; k < 3; k++) {
      const d = b[k] - a[k], lo = cache.lo[k] - pad, hi = cache.hi[k] + pad;
      if (d === 0) { if (a[k] < lo || a[k] > hi) { cache.stats.definiteMisses++; return true; } continue; }
      const t0 = (lo - a[k]) / d, t1 = (hi - a[k]) / d;
      enter = Math.max(enter, Math.min(t0, t1)); exit = Math.min(exit, Math.max(t0, t1));
      if (enter > exit) { cache.stats.definiteMisses++; return true; }
    }
    return false;
  } catch { return null; }
  finally {
    // A later invalid instance can follow already updated leaves. Never retain
    // that partial state as proof; every leaf and the union must rebuild.
    if (!verified) { cache.initialized = false; for (const leaf of cache.leaves) leaf.initialized = false; }
  }
}
function surfaceCollisionRecovered(combat, key) {
  if (combat.surfaceCollisionErrors?.delete(key)) {
    if (combat.lastSurfaceUnavailable?.key === key) combat.lastSurfaceUnavailable = null;
    try { combat.onSurfaceCollisionRecovered?.({ key }); } catch { /* diagnostic only */ }
  }
}
function surfaceCollisionQuery(combat, key, p0, p1, tick) {
  const owner = combat?.surfaceOwner;
  if (!owner?.actors?.has(key)) return { handled: false, ready: false };
  const before = owner.actors.get(key);
  if (surfaceCollisionBoundsMiss(before, p0, p1, owner.renderer) === true) {
    surfaceCollisionRecovered(combat, key);
    return { handled: true, ready: true, contact: null, boundsCulled: true };
  }
  let crossings, cause;
  try { crossings = owner.trace(key, p0, p1, tick); } catch (error) { cause = error; }
  const record = owner.actors.get(key);
  if (!record?.available || !Array.isArray(crossings)) {
    const error = { code: 'surface_collision_unavailable', key, actor: { ...record?.actor },
      reason: record?.reason || 'surface_query_unavailable', detail: cause?.message || record?.detail || null,
      needsRegistration: record?.registered !== true || record?.registrationFailed === true };
    const errors = combat.surfaceCollisionErrors ||= new Map(), previous = errors.get(key);
    errors.set(key, error); combat.lastSurfaceUnavailable = error;
    if (!previous || previous.reason !== error.reason || previous.detail !== error.detail) {
      try { combat.onSurfaceUnavailable?.(error); } catch { /* diagnostic hook cannot resolve physical damage */ }
      if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function')
        globalThis.dispatchEvent(new CustomEvent('tankforge-surface-collision-unavailable', { detail: error }));
    }
    return { handled: true, ready: false, error };
  }
  surfaceCollisionRecovered(combat, key);
  surfaceCollisionSealBounds(record, owner.renderer);
  return { handled: true, ready: true, contact: crossings[0] || null };
}

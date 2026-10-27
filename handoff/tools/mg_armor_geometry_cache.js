// Owned immutable geometry snapshots. Source matrices remain checked on every use.
// This helper never caches damage, skips a collision query, or trusts external freeze().
function createCombatGeometryImmutable() {
  const records = new WeakMap(), owned = new WeakMap();
  const id = s => typeof s === 'string' && s.length > 0 && s.length <= 256 && !/[\u0000-\u001f]/.test(s);
  const stamp = r => [r.actorKey, r.revision, r.geometryRevision, r.shapeId, r.shapeHash];
  const sameStamp = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  function checked(r) {
    if (!r || r.available !== true || r.registered !== true || r.registrationFailed ||
        !id(r.actorKey) || !Number.isSafeInteger(r.revision) || r.revision < 1 ||
        !Number.isSafeInteger(r.geometryRevision) || r.geometryRevision < 0 || !id(r.shapeId) ||
        typeof r.shapeHash !== 'string' || !/^[a-f0-9]{64}$/.test(r.shapeHash) ||
        !Array.isArray(r.updates) || r.updates.length > 1024) throw Error('accepted geometry unavailable or invalid');
  }
  function capture(r) {
    checked(r);
    const key = stamp(r), previous = records.get(r);
    if (previous && sameStamp(key, previous.stamp)) {
      if (r.updates !== previous.source || r.updates.length !== previous.rows.length)
        throw Error('accepted geometry identity changed without revision');
      for (let i = 0; i < r.updates.length; i++) {
        const row = r.updates[i], old = previous.rows[i], saved = previous.snapshot[i];
        if (row !== old.row || row?.[1] !== old.matrix || row.length !== 2 || row[0] !== saved[0] || row[1].length !== 16)
          throw Error('accepted geometry instance changed without revision');
        for (let j = 0; j < 16; j++) if (!Object.is(row[1][j], saved[1][j]))
          throw Error('accepted geometry matrix changed without revision');
      }
      return previous.snapshot;
    }
    const seen = new Set(), rows = [], snapshot = []; let maxAbs = 0;
    for (const row of r.updates) {
      if (!Array.isArray(row) || row.length !== 2 || !id(row[0]) || !/^instance:.+:\d+$/.test(row[0]) ||
          seen.has(row[0]) || !Array.isArray(row[1]) || row[1].length !== 16 || !row[1].every(Number.isFinite))
        throw Error('invalid accepted geometry instance or matrix');
      seen.add(row[0]); const m = row[1];
      if ([m[3], m[7], m[11], m[15] - 1].some(v => Math.abs(v) > 1e-9)) throw Error('invalid geometry affine matrix');
      const det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
      if (!(Math.abs(det) > 1e-12)) throw Error('invalid geometry singular matrix');
      for (const value of m) maxAbs = Math.max(maxAbs, Math.abs(value));
      const matrix = Object.freeze(m.slice());
      snapshot.push(Object.freeze([row[0], matrix])); rows.push({ row, matrix: m });
    }
    Object.freeze(snapshot);
    // finiteTree visits one outer array; each row is row + key + matrix + 16 scalars.
    owned.set(snapshot, Object.freeze({ nodes: 1 + snapshot.length * 19, extraDepth: snapshot.length ? 3 : 0, maxAbs }));
    records.set(r, { source: r.updates, stamp: key, rows, snapshot });
    return snapshot;
  }
  const trusted = value => !!value && typeof value === 'object' && owned.has(value);
  function clone(value) {
    if (value && typeof value === 'object' && trusted(value.geometry_instances)) {
      const { geometry_instances, ...rest } = value;
      return { ...structuredClone(rest), geometry_instances };
    }
    if (value && typeof value === 'object' && trusted(value.accepted_pose?.geometry_instances)) {
      const { accepted_pose, ...rest } = value;
      return { ...structuredClone(rest), accepted_pose: clone(accepted_pose) };
    }
    return structuredClone(value);
  }
  return Object.freeze({ capture, clone, isTrusted: trusted, metadata: value => trusted(value) ? owned.get(value) : null });
}

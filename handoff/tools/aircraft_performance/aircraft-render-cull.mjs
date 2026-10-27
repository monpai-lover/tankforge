/** Conservative, render-only clip rejection for explicitly marked aircraft meshes.
 * The marker belongs to immutable Renderer.mesh(Float32Array) uploads, not nodes.
 * Unknown geometry always draws. Neither visibility nor collision state is changed.
 */
const aircraftBoundsCache = new WeakMap();

function aircraftUploadedBounds(mesh) {
  if (mesh?.aircraftGeometry !== true || mesh.instanced || mesh.indexed) return null;
  const source = mesh._src, data = source?.data;
  if (source?.kind !== 'mesh' || !(data instanceof Float32Array) ||
      !data.length || data.length % 13 || mesh.count !== data.length / 13) return null;
  const revision = source.revision ?? mesh.geometryRevision ?? 0;
  const previous = aircraftBoundsCache.get(mesh);
  if (previous?.data === data && previous.revision === revision) return previous.bounds;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < data.length; i += 13) for (let k = 0; k < 3; k++) {
    const v = data[i + k];
    if (!Number.isFinite(v)) {
      aircraftBoundsCache.set(mesh, {data, revision, bounds: null});
      return null;
    }
    lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v);
  }
  const bounds = {center: lo.map((v, k) => (v + hi[k]) * .5), half: lo.map((v, k) => (hi[k] - v) * .5)};
  aircraftBoundsCache.set(mesh, {data, revision, bounds});
  return bounds;
}

/** Call if a future caller rewrites a marked upload's existing source array in place.
 * Replacing node.mesh or mesh._src.data is detected without this call.
 */
export function invalidateAircraftRenderBounds(mesh) { aircraftBoundsCache.delete(mesh); }

/** Build one rejector per camera/shadow pass, using that pass's exact WebGL VP.
 * Returns true only when the padded world AABB lies wholly outside one clip plane.
 * A world AABB of transformed local bounds deliberately overestimates rotated parts.
 */
export function createAircraftClipReject(viewProj, {padding = 1} = {}) {
  const open = () => false;
  if (!viewProj || viewProj.length !== 16 || !Number.isFinite(padding) || padding < 0) return open;
  for (let i = 0; i < 16; i++) if (!Number.isFinite(viewProj[i])) return open;
  // Homogeneous WebGL clip planes: w +/- x/y/z >= 0. Do not divide by w;
  // a box crossing the eye or near plane must remain a candidate.
  const planes = [];
  for (let row = 0; row < 3; row++) for (const sign of [-1, 1]) {
    const p = [0, 1, 2, 3].map(col => viewProj[col * 4 + 3] + sign * viewProj[col * 4 + row]);
    if (!p.every(Number.isFinite)) return open;
    planes.push(p);
  }
  return node => {
    if (!node || node.terrain || node.mesh?.aircraftGeometry !== true) return false;
    const bounds = aircraftUploadedBounds(node.mesh), m = node.world;
    if (!bounds || !m || m.length !== 16) return false;
    for (let i = 0; i < 16; i++) if (!Number.isFinite(m[i])) return false;
    // Perspective/non-affine model matrices require a different bound derivation.
    if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) return false;
    const c = bounds.center, h = bounds.half;
    const center = [0, 1, 2].map(k => m[k] * c[0] + m[k + 4] * c[1] + m[k + 8] * c[2] + m[k + 12]);
    const extent = [0, 1, 2].map(k => Math.abs(m[k]) * h[0] + Math.abs(m[k + 4]) * h[1] + Math.abs(m[k + 8]) * h[2] + padding);
    if (!center.every(Number.isFinite) || !extent.every(Number.isFinite)) return false;
    for (const p of planes) {
      const distance = p[0] * center[0] + p[1] * center[1] + p[2] * center[2] + p[3];
      const radius = Math.abs(p[0]) * extent[0] + Math.abs(p[1]) * extent[1] + Math.abs(p[2]) * extent[2];
      if (!Number.isFinite(distance) || !Number.isFinite(radius)) return false;
      // A relative tolerance protects touching bounds and Float32 shader rounding.
      const tolerance = 1e-6 * (1 + Math.abs(distance) + radius + Math.abs(p[3]));
      if (distance + radius < -tolerance) return true;
    }
    return false;
  };
}

import { STRIDE } from '../gfx/geo.js';

// Geometry stays on the CPU for WebGL restoration. Cache its local bounds once; the node and
// instance transforms remain live, so turret rotation, recoil, tracks and folding still fit.
const meshBounds = new WeakMap();
const DISC_FILL = 0.82;

function boundsOf(mesh) {
  if (meshBounds.has(mesh)) return meshBounds.get(mesh);
  const data = mesh._src?.data;
  if (!data?.length) return null;
  const bounds = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let i = 0; i < data.length; i += STRIDE) {
    for (let axis = 0; axis < 3; axis++) {
      bounds[axis] = Math.min(bounds[axis], data[i + axis]);
      bounds[axis + 3] = Math.max(bounds[axis + 3], data[i + axis]);
    }
  }
  meshBounds.set(mesh, bounds);
  return bounds;
}

/** Distance above center for a downward camera that fits every rendered part inside the disc. */
export function statusViewDistance(nodes, center, tanHalfFov) {
  let distance = 1;
  const radialScale = 1 / (DISC_FILL * tanHalfFov);
  for (const node of nodes) {
    const mesh = node.mesh;
    if (!mesh) continue;
    const bounds = boundsOf(mesh);
    if (!bounds) continue;
    const world = node.world;
    const matrices = mesh.instanced ? mesh._src.matrices : null;
    const instances = mesh.instanced ? mesh.instances : 1;
    for (let instance = 0; instance < instances; instance++) {
      const offset = instance * 16;
      for (let corner = 0; corner < 8; corner++) {
        let x = bounds[corner & 1 ? 3 : 0];
        let y = bounds[corner & 2 ? 4 : 1];
        let z = bounds[corner & 4 ? 5 : 2];
        if (matrices) {
          const ix = matrices[offset] * x + matrices[offset + 4] * y + matrices[offset + 8] * z + matrices[offset + 12];
          const iy = matrices[offset + 1] * x + matrices[offset + 5] * y + matrices[offset + 9] * z + matrices[offset + 13];
          z = matrices[offset + 2] * x + matrices[offset + 6] * y + matrices[offset + 10] * z + matrices[offset + 14];
          x = ix;
          y = iy;
        }
        const wx = world[0] * x + world[4] * y + world[8] * z + world[12] - center[0];
        const wy = world[1] * x + world[5] * y + world[9] * z + world[13] - center[1];
        const wz = world[2] * x + world[6] * y + world[10] * z + world[14] - center[2];
        distance = Math.max(distance, wy + Math.hypot(wx, wz) * radialScale);
      }
    }
  }
  return distance;
}

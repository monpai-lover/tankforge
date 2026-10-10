// Shared by the instanced tree meshes and the camera's visual collision volumes.
export const TREE_ROOT_OFFSET = -0.1;
export const TREE_FALL_SECONDS = 1.1;
export const treeFallAngle = (fall) => Math.min(1, fall) ** 2 * (Math.PI / 2 - 0.08);
export const FIR_TRUNK = [0.26, 0.16, 3.2];
export const FIR_TIERS = [[2.6, 2.8, 5.6], [5.6, 2.1, 4.8], [8.4, 1.4, 4.0], [10.8, 0.75, 3.2]];
export const FIR_TIP_RADIUS = 0.04;
export const BROADLEAF_TRUNK = [0.34, 0.22, 4.8];
export const BROADLEAF_CROWNS = [
  { center: [0, 7, 0], radius: 3.4, color: '#3a5223', squash: 0.85 },
  { center: [1.8, 7.9, 0.9], radius: 2.5, color: '#435d28', squash: 0.85 },
  { center: [-1.6, 8.3, -1.1], radius: 2.4, color: '#334a1f', squash: 0.85 },
  { center: [0.3, 9.5, -0.2], radius: 2, color: '#4a6630', squash: 0.8 },
];

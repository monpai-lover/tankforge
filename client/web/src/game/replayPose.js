// A report's impact pose is presentation state, never part of the combat report or wire.
import { Node, m4 } from '../gfx/math.js';

const impactPoses = new WeakMap();
const copy = value => ArrayBuffer.isView(value) ? value.slice() : Array.isArray(value) ? value.map(copy) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)])) : value;
const localPose = n => ({ pos: n.pos.slice(), yaw: n.yaw, pitch: n.pitch, roll: n.roll, local: n.local && n.local.slice() });
const launcherState = gun => ({ loaded: gun.loaded, count: gun.ammo?.[gun.loaded]?.count || 0, nextTube: gun.launcher?.nextTube || 0, ready: gun.launcher?.ready || 0 });

function bodyFrame(body) {
  return { origin: body.worldPoint([0, 0, 0]).slice(), ex: body.worldDir([1, 0, 0]).slice(), ey: body.worldDir([0, 1, 0]).slice(), ez: body.worldDir([0, 0, 1]).slice() };
}

/** Small pre-core capture: known articulation only; no graph traversal, interior, or GPU work. */
export function captureImpactPose(e) {
  const joints = new Map(), launchers = new Map();
  (e.model.turrets || []).forEach((t, i) => {
    const pose = localPose(t.node);
    pose.yaw = e.turretYaws ? e.turretYaws[i] ?? 0 : i === 0 ? e.turretYaw : t.node.yaw;
    const parent = e.loadout?.turrets[i]?.parent;
    if (parent != null && e.turretYaws) pose.yaw -= e.turretYaws[parent] ?? 0;
    joints.set(t.node, pose);
    for (const g of t.guns) {
      joints.set(g.node, { ...localPose(g.node), pitch: -(e.gunPitch[i] || 0) });
      if (g.barrel) joints.set(g.barrel, localPose(g.barrel));
    }
    for (const gun of e.loadout?.turrets[i]?.guns || []) launchers.set(gun, launcherState(gun));
  });
  return { frame: bodyFrame(e.veh.body), joints, launchers, fold: e.fold || 0 };
}

export function rememberImpactPose(report, pose) {
  impactPoses.set(report, pose);
}

function frameMatrix(f) {
  const m = m4();
  for (let k = 0; k < 3; k++) { m[k] = f.ex[k]; m[4 + k] = f.ey[k]; m[8 + k] = f.ez[k]; m[12 + k] = f.origin[k]; }
  return m;
}
function frozenBody(f) {
  const worldDir = p => [0, 1, 2].map(k => f.ex[k] * p[0] + f.ey[k] * p[1] + f.ez[k] * p[2]);
  return { worldDir, worldPoint(p) { return worldDir(p).map((v, k) => v + f.origin[k]); } };
}

/** Owns a detached graph and its GPU leases. Construction is transactional. */
export function snapshotReplayTarget(renderer, target, report) {
  const pose = impactPoses.get(report);
  const frame = pose?.frame || bodyFrame(target.body);
  const sources = new Set(), nodeMap = new Map(), meshes = new Map();
  const retained = [], owned = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const mesh of owned) renderer.freeMesh(mesh);
    for (const mesh of retained) renderer.releaseMesh?.(mesh);
  };
  try {
    // Only accepted reports reach this lazy getter. Newly attached nodes are cloned below.
    const inner = target.interior?.() || null;
    const meshFor = source => {
      if (!source) return null;
      if (meshes.has(source)) return meshes.get(source);
      let mesh = source;
      if (source.instanced) {
        mesh = renderer.instancedMesh(source._src.data, source.maxInstances);
        owned.push(mesh);
        const matrices = source._src.matrices?.slice() || new Float32Array(0);
        renderer.setInstances(mesh, matrices, source.instances);
      } else if (renderer.retainMesh) {
        renderer.retainMesh(mesh);
        retained.push(mesh);
      }
      meshes.set(source, mesh);
      return mesh;
    };
    const clone = source => {
      const n = new Node(source.name);
      sources.add(source); nodeMap.set(source, n);
      for (const [key, value] of Object.entries(source)) {
        if (['children', 'world', 'mesh', 'texture', 'normalTex', 'launcherRound'].includes(key)) continue;
        n[key] = copy(value);
      }
      n.mesh = meshFor(source.mesh);
      n.texture = source.texture;
      n.normalTex = source.normalTex;
      const saved = pose?.joints.get(source);
      if (saved) Object.assign(n, copy(saved));
      n.children = source.children.map(clone);
      return n;
    };
    const root = clone(target.model.root);
    const bodyNode = nodeMap.get(target.model.body) || root;
    // The physics frame already includes origin/heading/attitude. Cached graph worlds do not.
    root.pos = [0, 0, 0]; root.yaw = root.pitch = root.roll = 0; root.local = m4();
    bodyNode.local = frameMatrix(frame);
    const rounds = [];
    for (const [source, n] of nodeMap) if (source.launcherRound) {
      const {gun, tube, apparatus} = source.launcherRound;
      const state = pose?.launchers.get(gun) || launcherState(gun);
      const eligible = state.loaded >= 0 && state.count > 0 && tube >= state.nextTube && tube < state.nextTube + state.ready;
      n.launcherRound = { gun: copy(state), tube, apparatus: nodeMap.get(apparatus) };
      rounds.push({n, apparatus: n.launcherRound.apparatus, eligible});
    }
    const remap = n => nodeMap.get(n);
    const interior = inner ? {
      nodes: inner.nodes.map(remap),
      byModule: new Map([...inner.byModule].map(([id, nodes]) => [id, nodes.map(remap)])),
      byCrew: inner.byCrew.map(remap),
      labels: (inner.labels || []).map(({node, anchor, ...label}) => ({...copy(label), node: remap(node), anchor: remap(anchor)})),
      updateLaunchers() { for (const {n, apparatus, eligible} of rounds) n.visible = !!apparatus?.visible && eligible; },
    } : null;
    const model = { root, body: bodyNode, shellNodes: (target.model.shellNodes || []).map(remap),
      turrets: (target.model.turrets || []).map(t => ({node: remap(t.node), guns: t.guns.map(g => ({node: remap(g.node), barrel: remap(g.barrel), rounds: (g.rounds || []).map(remap)}))})) };
    root.update();
    return { model, body: frozenBody(frame), armor: copy(target.armor || []), pivot: copy(target.pivot), crewRoles: copy(target.crewRoles || []), moduleLabels: new Map(target.moduleLabels || []), length: target.length, name: target.name, fold: pose?.fold, interior: () => interior, sources, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

// A report's impact pose is presentation state, never part of the combat report or wire.
import { Node, m4 } from '../gfx/math.js';

const impactPoses = new WeakMap();
const copy = value => ArrayBuffer.isView(value) ? value.slice() : Array.isArray(value) ? value.map(copy) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)])) : value;
const localPose = n => ({ pos: n.pos.slice(), yaw: n.yaw, pitch: n.pitch, roll: n.roll, local: n.local && n.local.slice() });
const launcherState = gun => ({ loaded: gun.loaded, count: gun.ammo?.[gun.loaded]?.count || 0, nextTube: gun.launcher?.nextTube || 0, ready: gun.launcher?.ready || 0 });
const runningInstances=model=>{const saved=new Map(),walk=n=>{if(!n)return;const m=n.mesh;if(m?.instanced&&!saved.has(m))saved.set(m,{matrices:m._src.matrices?.slice()||new Float32Array(0),count:m.instances});for(const c of n.children)walk(c);};walk(model.running);return saved;};

function bodyFrame(body) {
  return { origin: body.worldPoint([0, 0, 0]).slice(), ex: body.worldDir([1, 0, 0]).slice(), ey: body.worldDir([0, 1, 0]).slice(), ez: body.worldDir([0, 0, 1]).slice() };
}

/** Pre-core capture of known articulation and the running subtree; no interior or GPU work. */
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
  return { frame: bodyFrame(e.veh.body), joints, launchers, instances:runningInstances(e.model), fold: e.fold || 0 };
}

export function rememberImpactPose(report, pose) {
  impactPoses.set(report, pose);
}

/** Player state has independent guns/recoil, unlike the Enemy gunPitch adapter. */
export function capturePlayerImpactPose(G){
  const joints=new Map(),launchers=new Map();
  for(const[ti,t]of (G.model.turrets||[]).entries()){
    const rt=G.T[ti],parent=G.loadout.turrets[ti]?.parent;
    joints.set(t.node,{...localPose(t.node),yaw:(rt?.yaw??t.node.yaw)-(parent!=null?(G.T[parent]?.yaw||0):0)});
    for(const[gi,g]of t.guns.entries()){
      const gs=rt?.guns?.[gi];joints.set(g.node,{...localPose(g.node),pitch:-(gs?.pitch??-g.node.pitch)});
      if(g.barrel)joints.set(g.barrel,{...localPose(g.barrel),pos:[0,0,-(gs?.recoil??-g.barrel.pos[2])],roll:gs?.roll??g.barrel.roll});
      for(const n of g.rounds||[])if(n)joints.set(n,localPose(n));
    }
    for(const g of G.loadout.turrets[ti]?.guns||[])launchers.set(g,launcherState(g));
  }
  for(const pm of G.model.mgs||[]){const mg=G.MG?.[pm.index];if(mg)joints.set(pm.node,{...localPose(pm.node),yaw:mg.aim.yaw-(mg.m.anchor==='hull'?0:G.T[0]?.yaw||0),pitch:-mg.aim.pitch});}
  for(const w of G.model.wheels||[])if(w.node)joints.set(w.node,localPose(w.node));
  return {frame:bodyFrame(G.veh.body),joints,launchers,instances:runningInstances(G.model),fold:G.fold||0};
}

function recordedPose(target,accepted){
  const frame={origin:accepted.hull_origin.slice(),ex:accepted.ex.slice(),ey:accepted.ey.slice(),ez:accepted.ez.slice()},joints=new Map(),launchers=new Map();
  for(const[ti,t]of (target.model.turrets||[]).entries()){
    const saved=accepted.joints?.[ti],parent=target.loadout?.turrets[ti]?.parent;
    // Missing accepted joints remain unknown/rest; never read a later dead/tossed joint.
    const yaw=Number.isFinite(saved?.yaw)?saved.yaw:0,parentYaw=parent!=null?accepted.joints?.[parent]?.yaw||0:0;
    joints.set(t.node,{pos:target.loadout?.turrets[ti]?.pivot?.slice()||t.node.pos.slice(),yaw:yaw-parentYaw,pitch:0,roll:0,local:null});
    for(const[gi,g]of t.guns.entries()){const gs=saved?.guns?.[gi];joints.set(g.node,{...localPose(g.node),pitch:-(gs?.pitch??saved?.pitch??0),yaw:0,roll:0});if(g.barrel)joints.set(g.barrel,{...localPose(g.barrel),pos:[0,0,-(gs?.recoil||0)],roll:gs?.roll||0});}
  }
  return {frame,joints,launchers,fold:accepted.variants?.find(v=>v.kind==='fold')?.value??0,trust:accepted.trust,unknownJoints:!accepted.joints?.length};
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
function hullBounds(frame,size){
  const body=frozenBody(frame),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const x of [-size[0]/2,size[0]/2])for(const y of [0,size[1]])for(const z of [-size[2]/2,size[2]/2]){const p=body.worldPoint([x,y,z]);for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}}
  return {min,max};
}

/** Owns a detached graph and its GPU leases. Construction is transactional. */
export function snapshotReplayTarget(renderer, target, report, accepted = null) {
  const pose = impactPoses.get(report)||target.savedImpactPose||(accepted?recordedPose(target,accepted):null);
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
        const captured=pose?.instances?.get(source),matrices=captured?.matrices?.slice()||source._src.matrices?.slice()||new Float32Array(0);
        renderer.setInstances(mesh, matrices, captured?.count??source.instances);
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
    const tag=(n,role)=>{if(!n)return;n.replayRole=role;for(const c of n.children)tag(c,role);};
    tag(root,'retained');for(const n of model.shellNodes)if(n)n.replayRole='armor';
    tag(remap(target.model.running),'mechanical');for(const w of target.model.wheels||[])tag(remap(w.node),'mechanical');
    for(const t of model.turrets)for(const g of t.guns)tag(g.barrel,'barrel');
    if(inner){for(const n of interior.nodes)tag(n,'furnishing');for(const[id,ns]of interior.byModule){const def=target.modules?.find(m=>m.id===id),role=def?.kind==='gun_breech'?'breech':'mechanical';for(const n of ns){tag(n,role);n.replayModuleId=id;}}
      for(const[i,n]of interior.byCrew.entries())if(n){tag(n,'crew');n.replayCrewIndex=i;}}
    const size=[target.width||3,target.height||3,target.length||6];let appliedPose=-1;
    root.update();
    const result={ model, body: frozenBody(frame), hullBounds:hullBounds(frame,size), armor: copy(target.armor || []), pivot: copy(target.pivot), crewRoles: copy(target.crewRoles || []), moduleLabels: new Map(target.moduleLabels || []), length: target.length, name: target.name, fold: pose?.fold, poseTrust:pose?.trust||'private_impact_pose', unknownJoints:pose?.unknownJoints||false, interior: () => interior, sources, dispose,
      applyAcceptedPose(accepted,version){
        if(disposed||!accepted||!Number.isFinite(version)||version<=appliedPose)return false;
        const next=recordedPose({model,loadout:target.loadout},accepted);
        bodyNode.local=frameMatrix(next.frame);for(const[n,p]of next.joints)Object.assign(n,copy(p));
        root.update();result.body=frozenBody(next.frame);result.hullBounds=hullBounds(next.frame,size);result.poseTrust=next.trust;result.unknownJoints=next.unknownJoints;appliedPose=version;return true;
      }};
    return result;
  } catch (error) {
    dispose();
    throw error;
  }
}

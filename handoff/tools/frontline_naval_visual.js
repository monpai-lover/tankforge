// Presentation of native-accepted naval samples. This owner never advances
// movement, ammunition, damage, sinking, effects or a local simulation clock.
// Native rays and Renderer.render are both double-sided; original triangles
// remain in their registered order, without duplicated backfaces or gap fills.
function createFrontlineNavalVisual({Node,renderer,GeoBuilder,root:parent=null}={}) {
  if(typeof Node!=='function'||typeof GeoBuilder!=='function'||typeof renderer?.mesh!=='function'||typeof renderer?.freeMesh!=='function')throw Error('Naval Node/GeoBuilder/renderer dependencies are required');
  if(parent&&(!Array.isArray(parent.children)||typeof parent.add!=='function'))throw Error('Naval parent must be a scene Node');
  const root=new Node('accepted-naval');if(parent)parent.add(root);
  const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const cache=new Map();let registry=new Map(),history=new Map(),lives=new Map(),battle=null,lastTick=-1,disposed=false;
  const stats={live:0,models:0,meshes:0,acceptedFrames:0,rejectedFrames:0,staleFrames:0,freedMeshes:0,battle:null,tick:-1};
  const positive=n=>Number.isSafeInteger(n)&&n>0;
  const vector=p=>Array.isArray(p)&&p.length===3&&p.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e7);
  const text=(v,n=128)=>typeof v==='string'&&v.length>0&&v.length<=n&&!/[\0\r\n]/.test(v);
  const uploaded=n=>Number.isFinite(n)&&Math.abs(n)<=1e6&&Math.fround(n)===n;
  const key=g=>`${g.id}\0${g.hash}\0${g.geometry_revision}`;
  const signature=g=>JSON.stringify(g,(_k,v)=>typeof v==='number'&&Object.is(v,-0)?'negative-zero-float32':v);
  function reject(){stats.rejectedFrames++;return false;}
  function catalogCopy(source,previous) {
    if(!Array.isArray(source)||source.length>64)throw Error('Invalid naval geometry catalog');
    const result=new Map();let total=0;
    for(const g of source) {
      if(!g||!text(g.id)||result.has(g.id)||!(/^[a-f0-9]{64}$/).test(g.hash)||!positive(g.geometry_revision)
        ||!Array.isArray(g.parts)||g.parts.length<1||g.parts.length>128
        ||g.coordinate_type!==undefined&&g.coordinate_type!=='float32'||g.forward!==undefined&&g.forward!=='+Z'
        ||g.gun_rotation_order!==undefined&&g.gun_rotation_order!=='pitch_then_yaw_about_pivot_then_body_yaw')throw Error('Invalid naval geometry identity');
      const partIds=new Set(),parts=[];
      for(const p of g.parts) {
        if(!p||!text(p.id)||partIds.has(p.id)||!text(p.role,64)||!['body','gun'].includes(p.pose_group)
          ||!Array.isArray(p.color)||p.color.length!==3||!p.color.every(v=>Number.isFinite(v)&&v>=0&&v<=1)
          ||!Array.isArray(p.pivot)||p.pivot.length!==3||!p.pivot.every(uploaded)
          ||!Array.isArray(p.triangles)||p.triangles.length<1)throw Error('Invalid naval part');
        total+=p.triangles.length;if(total>50000)throw Error('Naval triangle budget exceeded');
        const triangles=p.triangles.map(t=>{if(!Array.isArray(t)||t.length!==9||!t.every(uploaded))throw Error('Naval coordinates must be registered Float32 positions');return t.slice();});
        partIds.add(p.id);parts.push({id:p.id,role:p.role,color:p.color.slice(),pose_group:p.pose_group,pivot:p.pivot.slice(),triangles});
      }
      const geometry={id:g.id,hash:g.hash,geometry_revision:g.geometry_revision,parts};
      geometry.cacheKey=key(geometry);geometry.signature=signature({id:geometry.id,parts});
      const known=previous.get(geometry.cacheKey);
      if(known!==undefined&&known!==geometry.signature)throw Error('Naval geometry content changed under the same identity');
      result.set(geometry.id,geometry);
    }
    return result;
  }
  function stateCopy(v,nextBattle,geometries,ledger) {
    const r=v?.unit;
    if(!r||r.battle!==nextBattle||!positive(r.battle)||!positive(r.unit)||!positive(r.life)
      ||!vector(v.pos)||!Number.isFinite(v.yaw)||!Number.isFinite(v.gun_yaw)||!Number.isFinite(v.gun_pitch)
      ||typeof v.alive!=='boolean'||!positive(v.pose_revision)||!positive(v.geometry_revision)||!text(v.geometry_id))throw Error('Invalid accepted naval pose');
    const geometry=geometries.get(v.geometry_id);
    if(!geometry||v.geometry_hash!==geometry.hash||v.geometry_revision!==geometry.geometry_revision)throw Error('Naval pose has an unregistered geometry identity');
    const poseSignature=signature([v.pos,v.yaw,v.gun_yaw,v.gun_pitch]);
    const old=ledger.get(r.unit);
    if(old) {
      if(r.life<old.life)throw Error('Stale naval life');
      if(r.life===old.life&&(v.pose_revision<old.pose||v.geometry_revision<old.geometryRevision
        ||old.dead&&v.alive||v.geometry_revision===old.geometryRevision&&geometry.cacheKey!==old.geometryKey
        ||v.pose_revision===old.pose&&poseSignature!==old.poseSignature))throw Error('Stale or contradictory naval pose');
    }
    return {reference:{battle:r.battle,unit:r.unit,life:r.life},pos:v.pos.slice(),yaw:v.yaw,gunYaw:v.gun_yaw,gunPitch:v.gun_pitch,
      alive:v.alive,pose:v.pose_revision,geometry,poseSignature};
  }
  function release(entry) {
    if(entry.released)return;entry.released=true;
    for(const part of entry.parts){renderer.freeMesh(part.mesh);stats.freedMeshes++;}
  }
  function upload(geometry) {
    const entry={geometry,parts:[],refs:0,released:false};
    try {
      for(const part of geometry.parts) {
        const builder=new GeoBuilder(),material={color:part.color,rough:.82,metal:.18};
        for(const t of part.triangles)builder.tri(identity,false,t.slice(0,3),t.slice(3,6),t.slice(6,9),material);
        const data=builder.build(),mesh=renderer.mesh(data);
        entry.parts.push({part,mesh});
      }
      return entry;
    }catch(error){release(entry);throw error;}
  }
  function instance(state,entry) {
    const r=state.reference,body=new Node(`naval:${r.battle}:${r.unit}:${r.life}`);
    body.pos=state.pos.slice();body.yaw=state.yaw;body.navalUnit={...r};body.navalPoseRevision=state.pose;
    for(const {part,mesh} of entry.parts) {
      const node=new Node(`${body.name}:part:${part.id}`);node.mesh=mesh;node.doubleSided=true;
      node.navalPartId=part.id;node.navalUnit={...r};node.navalGeometryHash=state.geometry.hash;
      node.navalGeometryRevision=state.geometry.geometry_revision;node.navalPoseRevision=state.pose;
      node.navalTriangleCount=part.triangles.length;
      if(part.pose_group==='gun') {
        // The mesh keeps the original registered positions. Pivot translations
        // live in the scene graph, so no local Float32 vertex is re-authored.
        const pivot=new Node(`${node.name}:accepted-gun-pivot`);pivot.pos=part.pivot.slice();
        pivot.yaw=state.gunYaw;pivot.pitch=-state.gunPitch;node.pos=part.pivot.map(v=>-v);
        body.add(pivot);pivot.add(node);
      }else body.add(node);
    }
    return body;
  }
  function accept(catalog,views,meta={}) {
    if(disposed)return false;
    const nextBattle=meta.battle,tick=meta.tick;
    if(!positive(nextBattle)||!Number.isSafeInteger(tick)||tick<0||!Array.isArray(views)||views.length>64)return reject();
    if(battle!==null&&(nextBattle<battle||nextBattle===battle&&tick<=lastTick)){stats.staleFrames++;return false;}
    const changingBattle=nextBattle!==battle;
    if(changingBattle&&catalog==null)return reject();
    const additions=new Map();
    try {
      const oldHistory=changingBattle?new Map():history;
      const geometries=catalog==null?registry:catalogCopy(catalog,oldHistory);
      const nextHistory=new Map(oldHistory);
      for(const geometry of geometries.values())nextHistory.set(geometry.cacheKey,geometry.signature);
      if(nextHistory.size>128)throw Error('Naval geometry history budget exceeded');
      const ledger=changingBattle?new Map():new Map(lives),seen=new Set(),states=[];
      for(const view of views) {
        const state=stateCopy(view,nextBattle,geometries,ledger),id=state.reference.unit;
        if(seen.has(id))throw Error('Duplicate naval unit');seen.add(id);states.push(state);
        ledger.set(id,{life:state.reference.life,pose:state.pose,geometryRevision:state.geometry.geometry_revision,
          geometryKey:state.geometry.cacheKey,dead:!state.alive,poseSignature:state.poseSignature});
      }
      if(ledger.size>4096)throw Error('Naval identity history budget exceeded');
      const children=[],references=new Map();
      for(const state of states) {
        if(!state.alive)continue;
        const modelKey=state.geometry.cacheKey;
        let entry=cache.get(modelKey)||additions.get(modelKey);
        if(entry&&entry.geometry.signature!==state.geometry.signature)throw Error('Naval cached content identity mismatch');
        if(!entry){entry=upload(state.geometry);additions.set(modelKey,entry);}
        references.set(modelKey,(references.get(modelKey)||0)+1);children.push(instance(state,entry));
      }
      // All validation, Node construction and GPU uploads have succeeded. Only
      // now replace accepted presentation and release the last model reference.
      root.children=children;
      for(const [modelKey,entry] of cache)if(!references.has(modelKey)){release(entry);cache.delete(modelKey);}
      for(const [modelKey,entry] of additions)cache.set(modelKey,entry);
      for(const [modelKey,count] of references)cache.get(modelKey).refs=count;
      registry=geometries;history=nextHistory;lives=ledger;battle=nextBattle;lastTick=tick;
      stats.live=children.length;stats.models=cache.size;stats.meshes=[...cache.values()].reduce((n,e)=>n+e.parts.length,0);
      stats.acceptedFrames++;stats.battle=battle;stats.tick=lastTick;return true;
    }catch(_error){for(const entry of additions.values())release(entry);return reject();}
  }
  function clear() {
    if(disposed)return false;root.children=[];
    for(const entry of cache.values())release(entry);cache.clear();registry.clear();history.clear();lives.clear();
    battle=null;lastTick=-1;stats.live=0;stats.models=0;stats.meshes=0;stats.battle=null;stats.tick=-1;
    return true;
  }
  function dispose() {
    if(disposed)return;clear();disposed=true;
    if(parent)parent.children=parent.children.filter(node=>node!==root);
  }
  return {root,accept,sync:accept,clear,dispose,stats,get ready(){return battle!==null&&!disposed;}};
}



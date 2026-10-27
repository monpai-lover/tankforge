// Stock hash-pinned geometry plus this local actor's actual immutable uploaded buffers/pose.
import {inverseAffine} from '../collision/meshHitbox.js';
import {physicalNodeKey} from '../collision/physicalNodeKey.js';
import {mul} from '../gfx/math.js';
import {STRIDE} from '../gfx/geo.js';
import {composeBarrelShape,validateBarrelWeaponBinding} from './barrelShapeComposition.js';
const decode=s=>{const b=atob(s),v=new Uint8Array(b.length);for(let i=0;i<b.length;i++)v[i]=b.charCodeAt(i);return v;};
const actorKey=a=>`${a.battle}:${a.entity}:${a.life}`;
function nodesOf(root){const nodes=new Map(),disabled=new Set();const visit=(n,key,removed=false)=>{removed=removed||n.hitboxDisabled===true;if(n.mesh?._src?.data){nodes.set(key,n);if(removed)disabled.add(key);}n.children.forEach((c,i)=>visit(c,physicalNodeKey(c,key,i),removed));};visit(root,root.name);return {nodes,disabled};}
function hullInverse(body){const m=new Float64Array(16),o=body.origin();m[15]=1;for(let k=0;k<3;k++){m[k]=body.ex[k];m[k+4]=body.ey[k];m[k+8]=body.ez[k];m[k+12]=o[k];}return inverseAffine(m);}
export class LocalSurfaceCombat{
  constructor(core,packets={},renderer=null){this.core=core;this.packets=packets;this.renderer=renderer;this.actors=new Map();this.installed=new Set();this.decoded=new Map();}
  supports(spec){return !!this.packets[spec];}
  register(key,spec,actor,model,body){
    if(!this.supports(spec))return null;const previous=this.actors.get(key);
    if(!actor||!['battle','entity','life'].every(k=>Number.isSafeInteger(actor[k])&&actor[k]>0)){const record=previous||{key,actor:{},registered:false};record.registrationFailed=true;if(!previous)this.actors.set(key,record);return this.unavailable(record,'actor_unavailable');}
    if(previous?.failedActor&&actor.battle===previous.failedActor.battle&&actor.entity===previous.failedActor.entity&&actor.life<previous.failedActor.life)return this.unavailable(previous,'stale_actor_registration');
    if(previous?.registered&&!previous.registrationFailed&&previous.actorKey===actorKey(actor)&&previous.model===model)return this.pose(key,null);
    const restored=[];
    if(previous?.model===model&&previous.geometryRevision>0){for(const b of previous.stockBuffers){if(b.node.mesh!==b.mesh){restored.push([b.node,b.node.mesh]);b.node.mesh=b.mesh;}}}
    try{
    if(this.core.combatSurfaceRevision!==1)throw Error('surface_combat_core_unavailable');
    const packet=this.packets[spec],manifest=JSON.parse(packet.manifest),nodes=nodesOf(model.root).nodes,rows=[],buffers=[];
    for(const mesh of manifest.meshes){
      const node=nodes.get(mesh.key.slice(5));if(!node)throw Error(`surface_render_assembly_missing:${mesh.key}`);
      let bytes=this.decoded.get(mesh.payloadHash);if(!bytes){bytes=decode(packet.payloads[mesh.payloadHash]);this.decoded.set(mesh.payloadHash,bytes);}
      const words=new Uint32Array(bytes.buffer,bytes.byteOffset+32,new DataView(bytes.buffer,bytes.byteOffset).getUint32(20,true)/4),data=node.mesh._src.data,actual=new Uint32Array(data.buffer,data.byteOffset,data.length);
      if(data.length/STRIDE!==mesh.vertexCount||words.length!==mesh.vertexCount*3)throw Error('surface_render_triangle_count_mismatch');
      for(let i=0;i<mesh.vertexCount;i++)for(let k=0;k<3;k++)if(words[i*3+k]!==actual[i*STRIDE+k])throw Error(`surface_render_position_mismatch:${mesh.key}`);
      if(!this.installed.has(mesh.payloadHash)){this.core.combatSurfaceInstall(bytes,mesh.payloadHash);this.installed.add(mesh.payloadHash);}
      const instances=manifest.meshInstances.filter(i=>i.meshKey===mesh.key),count=node.mesh.instanced?node.mesh.instances:1;
      if(count!==instances.length||instances.some((i,k)=>i.materialFeature.capturedInstanceOrdinal!==k))throw Error('surface_render_instance_membership_mismatch');
      buffers.push({path:mesh.key.slice(5),node,mesh:node.mesh,words,vertexCount:mesh.vertexCount,instances:instances.length});
      for(const instance of instances){const ordinal=instance.materialFeature.capturedInstanceOrdinal;rows.push({key:instance.key,node,ordinal});}
    }
    const record={key,spec,actorKey:actorKey(actor),actor:{...actor},model,body,manifest,rows,buffers,stockBuffers:buffers,revision:1,geometryRevision:0,shapeId:'stock',shapeHash:packet.manifestHash,tick:null,available:true,reason:null,registered:true,shapes:new Map(),ownedMeshes:[]};
    if(!this.validateShape(record))throw Error('surface_render_membership_unavailable');
    model.root.update();record.updates=this.matrices(record);
    const reply=this.core.combatSurfaceRegister(key,packet,{entityId:record.actorKey,spawnEpoch:actor.life,buildHash:manifest.buildHash,poseRevision:0},record.updates);
    if(reply?.poseRevision!==1)this.core.combatSurfacePose(key,record.updates,{entityId:record.actorKey,spawnEpoch:actor.life,buildHash:manifest.buildHash,poseRevision:1});
    record.shapes.set('stock',{shapeHash:record.shapeHash,meshes:new Map(),manifest,buffers});
    this.prepareShapes(record,packet);
    model.surfaceShapes=record.shapes;model.surfaceShape={geometry_revision:0,shape_id:'stock',shape_hash:record.shapeHash};model.surfaceReplayRenderer=model.hitbox?.capture?.renderer||this.renderer;
    this.actors.set(key,record);if(previous)this.releaseShapes(previous);return record;
    }catch(error){for(const [node,mesh]of restored)node.mesh=mesh;const record=previous||{key,actorKey:actor?actorKey(actor):null,actor:{...actor},model,body,registered:false};if(!previous)this.actors.set(key,record);record.registrationFailed=true;record.failedActor={...actor};record.detail=error.message;return this.unavailable(record,error.message==='surface_combat_core_unavailable'?error.message:'shape_unavailable');}
  }
  prepareShapes(r,packet){
    // Only a build-time reviewed variant and a core that explicitly owns shape
    // transitions may change a registered model. No runtime clipping is admitted.
    if(this.core.combatBarrelRevision!==1||!packet.variants?.length)return;
    const renderer=r.model.hitbox?.capture?.renderer||this.renderer;
    if(!renderer)throw Error('surface_fracture_renderer_unavailable');
    if(packet.variants.length>8)throw Error('surface_fracture_variant_limit');
    const stockMeshes=new Map(),shapes=new Map(),owned=[],changedOwners=new Set();
    const metadata=this.core.combatWeaponBindingsRevision===1?this.core.combatWeaponBindings(r.key):null;
    try{
      for(const v of packet.variants){
        const descriptor=JSON.parse(v.record),manifest=JSON.parse(v.manifest),changes=descriptor.changedMeshes||[{...descriptor,sourceMeshKey:descriptor.recipe.sourceMeshKey}],meshes=new Map(),replacements=new Map();
        if(metadata)validateBarrelWeaponBinding(metadata,descriptor);
        else if(descriptor.changedMeshes||descriptor.moduleRef!=='gun_barrel'||descriptor.mountedWeaponKey!=='gun:0:0')throw Error('physical barrel weapon metadata unavailable');
        if(!Array.isArray(changes)||!changes.length||changes.length>32||shapes.has(descriptor.shapeId))throw Error('surface_fracture_descriptor_unavailable');
        for(const change of changes){
        const path=change.sourceMeshKey.slice(5),source=r.stockBuffers.find(b=>b.path===path),replacement=manifest.meshes.find(m=>m.key===change.sourceMeshKey);
        if(changedOwners.has(path))throw Error('surface_fracture_upload_overlap');changedOwners.add(path);
        if(!source||!replacement||source.instances!==1||descriptor.parentStockManifestHash!==packet.manifestHash||descriptor.parentStockCatalogHash!==packet.catalogHash)throw Error('surface_fracture_parent_unavailable');
        let payload=this.decoded.get(replacement.payloadHash);if(!payload){payload=decode(v.payloads[replacement.payloadHash]);this.decoded.set(replacement.payloadHash,payload);}
        const words=new Uint32Array(payload.buffer,payload.byteOffset+32,new DataView(payload.buffer,payload.byteOffset).getUint32(20,true)/4),upload=decode(v.rendererUploads?.[change.rendererAttributeUploadHash]||v.rendererUpload),data=new Float32Array(upload.buffer,upload.byteOffset,upload.byteLength/4),bits=new Uint32Array(data.buffer,data.byteOffset,data.length);
        if(data.length!==replacement.vertexCount*STRIDE||words.length!==replacement.vertexCount*3||!data.every(Number.isFinite))throw Error('surface_fracture_upload_unavailable');
        for(let i=0;i<replacement.vertexCount;i++)for(let k=0;k<3;k++)if(bits[i*STRIDE+k]!==words[i*3+k])throw Error('surface_fracture_position_mismatch');
        if(!this.installed.has(replacement.payloadHash)){this.core.combatSurfaceInstall(payload,replacement.payloadHash);this.installed.add(replacement.payloadHash);}
        const mesh=renderer.mesh(data);owned.push(mesh);mesh._src.hitRanges=structuredClone(v.rangesByMesh?.[change.sourceMeshKey]||v.ranges||[]);r.model.hitbox?.capture?.tag(mesh,mesh._src.hitRanges);
        source.attributeWords=new Uint32Array(source.mesh._src.data.buffer,source.mesh._src.data.byteOffset,source.mesh._src.data.length).slice();
        const buffer={...source,mesh,words,attributeWords:bits.slice(),vertexCount:replacement.vertexCount};
        stockMeshes.set(path,source.mesh);meshes.set(path,mesh);replacements.set(path,buffer);
        }
        this.core.combatSurfaceVariantRegister(r.key,v);
        shapes.set(descriptor.shapeId,{shapeId:descriptor.shapeId,shapeHash:descriptor.shapeHash,meshes,changedMeshes:meshes,manifest,buffers:r.stockBuffers.map(b=>replacements.get(b.path)||b),activeVariantIds:[descriptor.shapeId]});
      }
      // Every replay shape is complete relative to stock, including the weapons
      // repaired in this state. Partial overrides would leave old broken meshes.
      for(const shape of shapes.values())shape.meshes=new Map([...stockMeshes,...shape.changedMeshes]);
      r.variants=new Map(shapes);
      shapes.set('stock',{shapeId:'stock',shapeHash:packet.manifestHash,meshes:stockMeshes,manifest:r.manifest,buffers:r.stockBuffers,activeVariantIds:[]});
      r.shapes=shapes;r.ownedMeshes=owned;r.renderer=renderer;r.weaponBindings=metadata;
      r.model.surfaceShapes=shapes;r.model.surfaceReplayRenderer=renderer;r.model.surfaceShape={geometry_revision:0,shape_id:'stock',shape_hash:packet.manifestHash};
    }catch(error){for(const mesh of owned)renderer.freeMesh(mesh);throw error;}
  }
  commitShape(key,transition){
    const r=this.actors.get(key);if(!r?.registered||!r.available||!transition)return false;
    let next=r.shapes.get(transition.shapeId);
    if(Array.isArray(transition.activeVariantIds))try{
      const composed=composeBarrelShape(r.shapes.get('stock'),r.variants||new Map(),transition.activeVariantIds);
      if(composed.shapeId!==transition.shapeId||composed.shapeHash!==transition.shapeHash)return false;
      next=composed;r.shapes.set(transition.shapeId,next);
    }catch(error){r.shapeDetail=error.message;return false;}
    if(!next||transition.expectedGeometryRevision!==r.geometryRevision||transition.shapeHash!==next.shapeHash||!this.validateShape(r)||!this.validateCandidate(r,next))return false;
    // Allocate and check everything before the synchronous authoritative commit.
    // The current damaging-shot report still owns the old mesh and revision.
    let committing=false;
    try{
      const updates=this.matrices(r),poseRevision=r.revision+1,geometryRevision=r.geometryRevision+1;
      const poseContext={entityId:r.actorKey,spawnEpoch:r.actor.life,buildHash:r.manifest.buildHash,poseRevision,geometryRevision,shapeHash:next.shapeHash};
      committing=true;
      const accepted=this.core.combatSurfaceShapeCommit(key,{token:transition.token,expectedGeometryRevision:r.geometryRevision,shapeId:transition.shapeId,poseContext,updates});
      if(accepted.geometryRevision!==geometryRevision||accepted.shapeId!==transition.shapeId||accepted.shapeHash!==next.shapeHash||accepted.poseRevision!==poseRevision)throw Error('surface_fracture_commit_identity_mismatch');
      for(const buffer of next.buffers)buffer.node.mesh=buffer.mesh;
      r.buffers=next.buffers;r.geometryRevision=geometryRevision;r.shapeId=transition.shapeId;r.shapeHash=next.shapeHash;r.revision=poseRevision;r.updates=updates;
      r.model.surfaceShape={geometry_revision:geometryRevision,shape_id:r.shapeId,shape_hash:r.shapeHash};
      return true;
    }catch(error){r.shapeDetail=error.message;if(committing){r.registrationFailed=true;this.unavailable(r,'surface_shape_commit_unavailable');}return false;}
  }
  validateCandidate(r,shape){
    for(const b of shape.buffers){const data=b.mesh?._src?.data;if(!data||data.length!==b.vertexCount*STRIDE||(b.mesh.instanced?b.mesh.instances:1)!==b.instances||r.renderer?._live&&!r.renderer._live.has(b.mesh))return false;
      const bits=new Uint32Array(data.buffer,data.byteOffset,data.length);for(let i=0;i<b.vertexCount;i++)for(let k=0;k<3;k++)if(bits[i*STRIDE+k]!==b.words[i*3+k])return false;
      if(b.attributeWords)for(let i=0;i<bits.length;i++)if(bits[i]!==b.attributeWords[i])return false;
    }return true;
  }
  unavailable(r,reason){r.available=false;r.reason=reason;this.lastUnavailable={key:r.key,actor:{...r.actor},reason};return r;}
  validateShape(r){
    const {nodes,disabled}=nodesOf(r.model.root);if(nodes.size!==r.buffers.length)return false;
    for(const b of r.buffers){const n=nodes.get(b.path),data=n?.mesh?._src?.data;if(n!==b.node||disabled.has(b.path)||n.mesh!==b.mesh||!data||data.length/STRIDE!==b.vertexCount||(n.mesh.instanced?n.mesh.instances:1)!==b.instances)return false;const bits=new Uint32Array(data.buffer,data.byteOffset,data.length);for(let i=0;i<b.vertexCount;i++)for(let k=0;k<3;k++)if(bits[i*STRIDE+k]!==b.words[i*3+k])return false;}
    return true;
  }
  matrices(r){const inverse=hullInverse(r.body),updates=[];for(const {key:instance,node,ordinal}of r.rows){let m=node.world;if(node.mesh.instanced)m=mul(m,node.mesh._src.matrices.subarray(ordinal*16,ordinal*16+16),new Float64Array(16));const matrix=Array.from(mul(inverse,m,new Float64Array(16)));if(!matrix.every(Number.isFinite))throw Error('pose_unavailable');updates.push([instance,matrix]);}return updates;}
  pose(key,tick){const r=this.actors.get(key);if(!r)return null;if(r.registrationFailed||!r.registered||!this.validateShape(r))return this.unavailable(r,r.reason||'shape_unavailable');
    try{r.model.root.update();const updates=this.matrices(r);
      if(!r.updates||updates.some(([,m],i)=>m.some((v,k)=>v!==r.updates[i][1][k]))){const revision=r.revision+1,context={entityId:r.actorKey,spawnEpoch:r.actor.life,buildHash:r.manifest.buildHash,poseRevision:revision};if(this.core.combatBarrelRevision===1)Object.assign(context,{geometryRevision:r.geometryRevision,shapeHash:r.shapeHash});this.core.combatSurfacePose(key,updates,context);r.revision=revision;r.updates=updates;}
      r.tick=tick;r.available=true;r.reason=null;if(this.lastUnavailable?.key===key)this.lastUnavailable=null;return r;
    }catch{return this.unavailable(r,'pose_unavailable');}
  }
  trace(key,a,b,tick){const r=this.pose(key,tick);if(!r?.available)return null;try{return this.core.combatSurfaceTrace(key,r.body.localPoint(a),r.body.localPoint(b)).crossings;}catch(error){r.detail=error.message;this.unavailable(r,'surface_query_unavailable');return null;}}
  evidence(key){const r=this.actors.get(key);return r?.available&&r.registered?{build_hash:r.manifest.buildHash,anatomy_hash:r.manifest.anatomyDataHash,pose_revision:r.revision,geometry_revision:r.geometryRevision,geometry_shape:{id:r.shapeId,hash:r.shapeHash}}:null;}
  releaseShapes(r){for(const mesh of r.ownedMeshes||[])r.renderer.freeMesh(mesh);r.ownedMeshes=[];if(r.model?.surfaceShapes===r.shapes){delete r.model.surfaceShapes;delete r.model.surfaceShape;delete r.model.surfaceReplayRenderer;}}
  retire(){if(this.core.combatSurfaceRevision===1)for(const key of this.actors.keys())this.core.combatSurfaceRelease(key);for(const r of this.actors.values()){for(const b of r.stockBuffers||[])b.node.mesh=b.mesh;this.releaseShapes(r);}this.actors.clear();this.installed.clear();}
}

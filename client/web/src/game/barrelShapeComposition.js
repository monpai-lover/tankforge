import {sha256Text} from '../collision/physicalNodeKey.js';

// Only admitted immutable shapes reach this presentation helper. The core owns
// the damage set and token; the client never decides what should be broken.
export function composeBarrelShape(stock,variants,activeIds){
  if(!Array.isArray(activeIds)||activeIds.length>8)throw Error('barrel composition state limit');
  if(new Set(activeIds).size!==activeIds.length)throw Error('duplicate barrel composition identity');
  const shapes=activeIds.map(id=>{const shape=variants.get(id);if(!shape)throw Error('unknown barrel composition variant');return shape;}).sort((a,b)=>a.shapeHash.localeCompare(b.shapeHash));
  if(!shapes.length)return stock;
  if(shapes.length===1)return shapes[0];
  const meshes=new Map(stock.meshes),changedMeshes=new Map(),buffers=new Map(stock.buffers.map(b=>[b.path,b]));
  for(const shape of shapes)for(const[path,mesh]of shape.changedMeshes||shape.meshes){
    if(changedMeshes.has(path))throw Error('barrel composition upload overlap');
    const buffer=shape.buffers.find(b=>b.path===path);if(!buffer||!buffers.has(path)||buffer.mesh!==mesh)throw Error('barrel composition source unavailable');
    meshes.set(path,mesh);changedMeshes.set(path,mesh);buffers.set(path,buffer);
  }
  const shapeHash=sha256Text(`BarrelShapeCompositionV1\0${stock.shapeHash}\0${shapes.map(s=>s.shapeHash).join('\0')}`);
  return{shapeId:`barrels:${shapeHash}`,shapeHash,meshes,changedMeshes,buffers:stock.buffers.map(b=>buffers.get(b.path)),activeVariantIds:shapes.map(s=>s.shapeId),manifest:stock.manifest};
}

export function validateBarrelWeaponBinding(metadata,descriptor){
  if(metadata?.schema!=='CombatWeaponBindingsV1'||metadata.revision!==1||!Array.isArray(metadata.modules)||!metadata.bindings)throw Error('physical barrel weapon metadata unavailable');
  const binding=metadata.bindings[descriptor.mountedWeaponKey];
  if(!binding||binding.key!==descriptor.mountedWeaponKey)throw Error('physical barrel mounted weapon unavailable');
  if(binding.binding_error)throw Error(`physical barrel binding: ${binding.binding_error}`);
  const matches=metadata.modules.filter(m=>m.id===descriptor.moduleRef);
  if(matches.length!==1)throw Error('physical barrel module unavailable');
  const module=matches[0];
  if(!Number.isSafeInteger(module.index)||!binding.critical?.includes(module.index))throw Error('physical barrel is not a critical part of this mounted weapon');
  if(!['gun_barrel','machine_gun','aps_gun'].includes(module.kind))throw Error('physical barrel module kind unavailable');
  if((module.kind==='machine_gun'?binding.kind!=='machine_gun':binding.kind!=='cannon'))throw Error('physical barrel weapon kind mismatch');
  if(module.weapon_group!=null&&module.weapon_group!==binding.key)throw Error('physical barrel foreign weapon group');
  if(module.turret_index!=null&&module.turret_index!==binding.turret_index)throw Error('physical barrel foreign turret');
  return{module,binding};
}

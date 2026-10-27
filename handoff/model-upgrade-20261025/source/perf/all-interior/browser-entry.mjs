// Geometry presentation only. The live C/WASM flight kernel and authoritative
// damage schema remain owned by the existing host application.
import {buildAircraftInterior} from '../../work/tankforge-live-flight-patch/source/handoff/flight-rust/interior.mjs';

const VERSION='all-aircraft-interiors-c213-v2-mechanisms';
const roleFamilies={
  engine:['engine'],fuel:['fuel'],ammunition:['ammo'],weapon:['gun','ammo'],
  crew:['pilot'],avionics:['radar','avionics','controls'],cooling:['cooling','engine'],
  control:['controls','tail'],structure:['fuselage','nose','tail']
};
const finiteCenter=data=>{
  const sum=[0,0,0],count=data.length/13;
  for(let i=0;i<data.length;i+=13)for(let k=0;k<3;k++)sum[k]+=data[i+k]/count;
  return sum;
};
function acceptedId(plane,id,role,data){
  const by=plane.damage?.by||{};
  if(id&&by[id])return id;
  const candidates=[];
  for(const family of roleFamilies[role]||[]){
    if(by[family])return family;
    for(const p of plane.damage?.parts||[])if(p.id.startsWith(family+'_'))candidates.push(p);
  }
  if(candidates.length){
    const c=finiteCenter(data);
    candidates.sort((a,b)=>Math.hypot(...a.c.map((v,k)=>v-c[k]))-Math.hypot(...b.c.map((v,k)=>v-c[k])));
    return candidates[0].id;
  }
  return null;
}
function acceptedOwner(plane,id){
  if(!id)return null;
  const by=plane.damage?.by||{};
  if(by[id])return id;
  const inner=id.replace(/_out$/,'');
  if(by[inner])return inner;
  return null;
}
function bindAcceptedParts(plane,interior){
  for(const p of interior.parts){
    p.sourcePartId??=p.id;
    p.sourceOwner??=p.owner;
    const id=acceptedId(plane,p.sourcePartId,p.role,p.data);
    p.damageIds=id?[id]:[];
    // Keep semantic IDs for an unknown system rather than inventing new HP.
    p.id=id||p.sourcePartId;
    p.owner=acceptedOwner(plane,p.sourceOwner);
    p.node.interiorPartId=p.id;
    p.node.interiorDamageIds=p.damageIds;
    p.node.interiorOwner=p.owner;
    if(p.node.mesh)p.node.mesh.aircraftGeometry=true;
  }
}

/** Cheap for AI: register once; only O or the active-player diagram builds meshes. */
export function install(plane,{Node,engineLayout=null,mechanismFit=null}={}){
  if(plane.disposed)return null;
  if(plane.interiorUpgrade?.version===VERSION){
    if(plane.detailedInterior)bindAcceptedParts(plane,plane.detailedInterior);
    return plane.interiorUpgrade;
  }
  const state={version:VERSION,builds:0,building:false};
  plane.interiorUpgrade=state;
  plane.ensureDetailedInterior=()=>{
    if(plane.disposed)return null;
    if(plane.detailedInterior){bindAcceptedParts(plane,plane.detailedInterior);return plane.detailedInterior;}
    if(state.building)return null;
    state.building=true;
    try{
      const ids=(plane.damage?.parts||[]).map(p=>p.id).join('\0');
      const interior=buildAircraftInterior(plane,{Node,preserveCockpit:true,engineLayout,mechanismFit});
      bindAcceptedParts(plane,interior);
      if((plane.damage?.parts||[]).map(p=>p.id).join('\0')!==ids)throw Error('Presentation modified accepted damage IDs');
      interior.displayRevision=VERSION;
      plane.detailedInterior=interior;state.builds++;
      if(plane.internalNode&&interior.replacesInternal)plane.internalNode.visible=false;
      for(const n of plane.partNodes||[])n.visible=false;
      interior.setVisible(plane.xray);
      return interior;
    }finally{state.building=false;}
  };
  return state;
}

export function show(plane){
  const interior=plane.xray?plane.ensureDetailedInterior?.():plane.detailedInterior;
  if(!interior)return;
  bindAcceptedParts(plane,interior);
  if(plane.internalNode&&interior.replacesInternal)plane.internalNode.visible=false;
  for(const n of plane.partNodes||[])n.visible=false;
  interior.updateDamage?.();interior.setVisible?.(plane.xray);
}

export function dispose(plane){
  plane.detailedInterior?.dispose?.();
  plane.detailedInterior=null;
  plane.ensureDetailedInterior=null;
}

export {VERSION};

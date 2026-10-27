import {MEASURED_MOUNTS} from './measured-mounts.mjs';
/** Bind already-approved stores to verified source hardware and fitted adapters.
 * This module changes client layout only. Native Frontline host.p remains authoritative.
 * It never adds weapons, presets, ammunition, mass, drag, or server station capacity.
 */
export const VERSION = 'model-hardpoints-20261025-v2';
export const F15_SOURCE_MAIN = 'b736634797d9c94fa04967e8f06b20a40458d8349af54888d0b62de47a50c23a';
export const F15_WING_RAILS = Object.freeze([
  Object.freeze({ key: 'wing_rail_inner', x: 2.668717375093214, y: -0.5052199850857569, z: 1.37751677852349 }),
  Object.freeze({ key: 'wing_rail_outer', x: 3.18717375093214, y: -0.5052199850857569, z: 1.37751677852349 })
]);
const finite3 = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
export const F4_SOURCE_MAIN = 'e03a28ce0a9ef04a4198a647e4ca22eaf85d92e0a625ddad4ad640005624a2f6';
export const F4_WING_RAILS = Object.freeze([
  Object.freeze({key:'wing_rail_inner',x:1.84966101695,y:-.7759322,z:1.86288136}),
  Object.freeze({key:'wing_rail_outer',x:2.33338983051,y:-.7762712,z:1.88457627})
]);
export function matchesF4(T) {
  const m=T?.model,p=m?.parts?.[6];
  return T?.id==='f4e' && m?.sourceHashes?.main===F4_SOURCE_MAIN && m.version===2 &&
    Math.abs(m.posScale-1/2950)<1e-12 && p?.name==='body_source_geometry' && p.vertices===16207 && p.triangles===20086;
}
const railProfile=T=>matchesF15(T)?{rails:F15_WING_RAILS,family:'f15e_wing_dual',ids:/^(aim9|aim120)/}:matchesF4(T)?{rails:F4_WING_RAILS,family:'f4e_wing_dual',ids:/^aim9/}:null;
const isWingRail = (it,profile) => it.def?.kind === 'aam' && (it.station === 'mid' || it.station === 'outer') && profile.ids.test(it.id) && (it.side === -1 || it.side === 1);
export function matchesF15(T) {
  const m = T?.model, p = m?.parts?.[0];
  return T?.id === 'f15c' && m?.sourceHashes?.main === F15_SOURCE_MAIN &&
    m.version === 2 && Math.abs(m.posScale - 1 / 2682) < 1e-12 &&
    p?.name === 'body_source_geometry' && p.vertices === 23040 && p.triangles === 21900;
}
/** Preserve the complete item sequence, ids, owners and ammunition accepted by the native host. */
export function rebind(T, items, { storeMountPosition } = {}) {
  rebindMeasuredLaunchers(T, items);
  rebindMeasuredStations(T, items, {storeMountPosition});
  rebindWingCarriers(T, items, {storeMountPosition});
  rebindBellyClearance(T, items, {storeMountPosition});
  const profile=railProfile(T);
  if (!profile || !Array.isArray(items) || typeof storeMountPosition !== 'function') return items;
  const candidates = items.filter(it=>isWingRail(it,profile));
  // Unknown/new layouts keep their prior layout rather than stacking extra missiles onto these rails.
  if ([-1, 1].some(side => candidates.filter(it => it.side === side).length > 2)) return items;
  const assignments = [];
  for (const side of [-1, 1]) {
    const group = candidates.filter(it => it.side === side), used = new Set();
    // The old outer alias shares this pylon's outer rail; a single mid store uses the inner rail.
    // With two mid stores, stable input order occupies inner then outer, keeping release order.
    for (const it of [...group.filter(it => it.station === 'outer'), ...group.filter(it => it.station !== 'outer')]) {
      const index = it.station === 'outer' && !used.has(1) ? 1 : !used.has(0) ? 0 : 1;
      used.add(index);
      const rail = profile.rails[index], mount = [side * rail.x, rail.y, rail.z];
      const p = storeMountPosition(it.def, mount);
      if (!finite3(p)) return items;
      assignments.push({ it, p, mount, rail, side });
    }
  }
  for (const { it, p, mount, rail, side } of assignments) {
    it.p = p;
    it.mount = mount;
    it.pylon = null; // The source mesh already contains the central pylon and both long rails.
    it.nativePylon = true;
    it.modelHardpoint = `${side < 0 ? 'left' : 'right'}_${rail.key}`;
  }
  return items;
}
/** Custom UI aliases must not independently allocate the same pair of modeled rails. */
export function decorateSlots(T, slots) {
  const profile=railProfile(T);if (!profile) return slots;
  for (const sl of slots) if (sl.station === 'mid' || sl.station === 'outer') {sl.modelRailFamily=profile.family;sl.modelRailIds=profile.ids.source;}
  return slots;
}
export function slotsClash(a, b, aId, bId, aN, bN) {
  if (!(['f15e_wing_dual','f4e_wing_dual'].includes(a?.modelRailFamily) && b?.modelRailFamily === a.modelRailFamily &&
    a.side === b.side && a.side !== 0 && a.station !== b.station)) return false;
  if(aId&&bId&&(!new RegExp(a.modelRailIds).test(aId)||!new RegExp(b.modelRailIds).test(bId)))return false;
  const aCount = aN || a.options?.get(aId), bCount = bN || b.options?.get(bId);
  // A single AMRAAM and a single Sidewinder use different tracks. A dual Sidewinder
  // selection already occupies both tracks and must replace a prior outer selection.
  return aCount && bCount ? aCount + bCount > 2 : true;
}
/** Also bound old persisted custom selections, before rendering/counting their stores. */
export function customEntries(T, entries) {
  const profile=railProfile(T);if (!profile) return entries;
  const used = new Map();
  return entries.filter(([id, n, station, side]) => {
    if (!profile.ids.test(id) || (station !== 'mid' && station !== 'outer') || (side !== -1 && side !== 1)) return true;
    if (!Number.isInteger(n) || n < 1 || n + (used.get(side) || 0) > 2) return false;
    used.set(side, n + (used.get(side) || 0));
    return true;
  });
}

/** Exact imported packages whose numbered anchors were measured from the model.
 * Preserve the deliberate 3cm adapter spacer; remove only the old weapon-length
 * dependent forward shift, which made the rack socket miss its pylon connector.
 */
const MEASURED_SOURCE = Object.freeze({
  a10a: '1e4c993b5406bb942b155cbe51a81dc5650ef9b6937dae78246d6f7f50deec83',
  su25: 'e0d9b71d05ec5b3f26fe8907064c91c0f76069ebc81f422ce2b8d3402f32c9ff'
});
export function matchesMeasuredLaunchers(T) {
  return !!MEASURED_SOURCE[T?.id] && T.model?.sourceHashes?.main === MEASURED_SOURCE[T.id] &&
    T.model.version === 2 && !!T.fighter?.spec?.pylonPoints;
}
export function rebindMeasuredLaunchers(T, items) {
  if (!matchesMeasuredLaunchers(T) || !Array.isArray(items)) return items;
  const seen = new Set();
  for (const it of items) {
    if (!it.rack || !it.pylonN || !finite3(it.p) || !finite3(it.rack.origin)) continue;
    const at = T.fighter.spec.pylonPoints[it.pylonN];
    if (!finite3(at) || !Number.isFinite(it.def?.len) || !Array.isArray(it.pylon) || !finite3(it.pylon[1])) continue;
    // Already calibrated objects are safe to pass through the binder again.
    if (it.modelLauncherBinding === VERSION) continue;
    const dz = -it.def.len * .08;
    it.p = [it.p[0], it.p[1], it.p[2] + dz];
    it.rack = {...it.rack, origin: [it.rack.origin[0], it.rack.origin[1], it.rack.origin[2] + dz]};
    it.mount = it.pylon[1].slice();
    it.modelHardpoint = `p${it.pylonN}_launcher`;
    it.modelLauncherBinding = VERSION;
    const key = `${it.pylonN}:${it.rack.id}`;
    if (seen.has(key)) it.pylon = null;
    seen.add(key);
  }
  return items;
}

const undersideCache=new WeakMap();
/** First exact intersection with the current static exterior from below. */
function undersideY(T,x,z) {
  const model=T.model;let cache=undersideCache.get(model);if(!cache)undersideCache.set(model,cache=new Map());
  const key=x.toFixed(6)+':'+z.toFixed(6);if(cache.has(key))return cache.get(key);
  const geometry=T.geometry?.();const data=geometry?.mountBaseBody||geometry?.body;let y=Infinity;
  if(data)for(let o=0;o<data.length;o+=39){
    const ax=data[o],az=data[o+2],bx=data[o+13],bz=data[o+15],cx=data[o+26],cz=data[o+28];
    const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(den)<1e-12)continue;
    const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den,w=1-u-v;
    if(u>=-1e-7&&v>=-1e-7&&w>=-1e-7)y=Math.min(y,u*data[o+1]+v*data[o+14]+w*data[o+27]);
  }
  const result=Number.isFinite(y)?y:null;cache.set(key,result);return result;
}
/** Existing generic belly stations have overlapping tandem missiles. These are
 * explicitly inferred procedural adapters, not newly certified model hardpoints.
 * Keep the original transverse lanes; spread only overlapping rows, and start
 * each short adapter on the actual triangle surface at its new position.
 */
export function rebindBellyClearance(T,items,{storeMountPosition}={}) {
  if(!(matchesF15(T)||matchesF4(T))||!Array.isArray(items)||typeof storeMountPosition!=='function')return items;
  for(const side of[-1,1]){
    const group=items.filter(it=>it.station==='belly'&&it.side===side&&it.def?.kind==='aam'&&finite3(it.p)&&finite3(it.mount));
    if(group.length!==2||group.some(it=>it.modelBellyBinding===VERSION))continue;
    group.sort((a,b)=>b.p[2]-a.p[2]);const [front,rear]=group;
    const spacing=(front.def.len+rear.def.len)/2+.15,oldSpacing=front.p[2]-rear.p[2];
    if(!(spacing>oldSpacing+.01))continue;
    const middle=(front.mount[2]+rear.mount[2])/2;
    const positions=[];
    for(let i=0;i<2;i++){
      const it=group[i],x=it.mount[0],z=middle+(i===0?1:-1)*spacing/2,shell=undersideY(T,x,z);
      if(shell===null||Math.abs(shell-it.pylon[0][1])>1.25){positions.length=0;break;}
      const mount=[x,shell-.12,z],p=storeMountPosition(it.def,mount);if(!finite3(p)){positions.length=0;break;}
      positions.push({it,mount,p,pylon:[[x,shell,z],mount.slice()]});
    }
    if(positions.length!==2)continue;
    for(const {it,mount,p,pylon}of positions){it.mount=mount;it.p=p;it.pylon=pylon;it.modelBellyBinding=VERSION;it.modelMountBasis='inferred_clearance_with_exact_exterior_contact';}
  }
  return items;
}

export function measuredProfile(T) {
  const profile=MEASURED_MOUNTS[T?.id],m=T?.model;
  if(!profile||m?.sourceHashes?.main!==profile.sourceMain||m.version!==profile.version||Math.abs(m.posScale-profile.posScale)>1e-12)return null;
  for(const b of profile.bindings){const p=m.parts?.[b.partIndex];if(!p||p.name!==b.partName||Object.entries(b.signature).some(([k,v])=>p[k]!==v))return null;}
  return profile;
}
export function rebindMeasuredStations(T,items,{storeMountPosition}={}) {
  const profile=measuredProfile(T);if(!profile||!Array.isArray(items)||typeof storeMountPosition!=='function')return items;
  const plans=[];
  for(const station of new Set(profile.bindings.map(b=>b.station)))for(const side of[-1,0,1]){
    const bindings=profile.bindings.filter(b=>b.station===station&&b.side===side).sort((a,b)=>b.point[2]-a.point[2]);
    const group=items.filter(it=>it.station===station&&it.side===side);
    if(!bindings.length||group.length>bindings.length)continue;
    for(let i=0;i<group.length;i++){
      const it=group[i],binding=bindings[i],mount=binding.point.slice(),p=storeMountPosition(it.def,mount);
      if(!finite3(p))continue;plans.push({it,binding,mount,p});
    }
  }
  for(const {it,binding,mount,p}of plans){
    it.p=p;it.mount=mount;it.pylon=null;it.nativePylon=true;
    it.modelHardpoint=`${binding.side<0?'left':binding.side>0?'right':'center'}_${binding.key}`;
    it.modelMountBasis='source_component_lower_face_center';
    if(T.id==='su27'&&binding.key==='underengine_pylon')it.owner='body';
    if(T.id==='mig21'||T.id==='f16v')it.owner=binding.owner+(it.owner?.endsWith('_out')?'_out':'');
  }
  if(T.id==='mig21'||T.id==='f16v')for(const it of items){
    if(!/^wing_[lr](?:_out)?$/.test(it.owner||''))continue;
    const binding=profile.bindings.find(q=>q.side===it.side&&/^wing_[lr]$/.test(q.owner));if(!binding)continue;
    it.owner=binding.owner+(it.owner.endsWith('_out')?'_out':'');it.modelOwnerBinding='source_wing_group';
  }
  return items;
}

/** Existing paired bombs/pods hang below the source central wing pylon through
 * a short inferred dual carrier; side AAM rails remain free of interpenetration.
 */
export function rebindWingCarriers(T,items,{storeMountPosition}={}) {
  if(!(matchesF15(T)||matchesF4(T))||!Array.isArray(items)||typeof storeMountPosition!=='function')return items;
  const anchor=matchesF15(T)?{x:2.927852348993288,y:-.6547352721849365,z:.04623415361670391}:{x:2.0915254237288134,y:-.7777966101694915,z:1.4772881355932204};
  for(const side of[-1,1]){
    const group=items.filter(it=>it.station==='inner'&&it.side===side);if(!group.length||group.length>2)continue;
    const plans=[];
    for(let i=0;i<group.length;i++){
      const it=group[i],dx=group.length===2?(i===0?-1:1)*(it.def.d/2+.05):0;
      const top=[side*anchor.x,anchor.y,anchor.z],mount=[side*(anchor.x+dx),anchor.y-.2,anchor.z];
      const p=storeMountPosition(it.def,mount);if(!finite3(p)){plans.length=0;break;}
      plans.push({it,p,mount,top});
    }
    if(plans.length!==group.length)continue;
    for(const {it,p,mount,top}of plans){it.p=p;it.mount=mount;it.pylon=[top,mount.slice()];it.modelWingCarrier=VERSION;it.modelMountBasis='source_pylon_bottom_with_inferred_short_carrier';}
  }
  return items;
}

/** Native units own their carrier identities. This wrapper lives outside all
 * original Frontline blocks and supplies accepted stores before mountStores;
 * original accept validation and position/count handling remain unchanged.
 */
export function wrapNativeFactory(factory) {
  if(typeof factory!=='function'||factory.modelHardpointWrapped)return factory;
  const wrapped=function(renderer,id,callbacks={}){
    let acceptedStores=null;
    const view=factory(renderer,id,{...callbacks,mountStores(plane,...args){
      plane.modelHardpointNativeStores=acceptedStores;
      return callbacks.mountStores?.(plane,...args);
    }});
    const accept=view.accept;
    view.accept=function(unit,tick){acceptedStores=Array.isArray(unit?.stores)?unit.stores:null;return accept.call(view,unit,tick);};
    return view;
  };
  wrapped.modelHardpointWrapped=true;return wrapped;
}
export function forPlane(plane,items) {
  const host=plane.modelHardpointNativeStores;
  const allowed=new Set(['body',...Object.keys(plane.damage?.by||{})]);
  if(!Array.isArray(host)||!Array.isArray(items)||host.length!==items.length||host.some((h,i)=>h.id!==items[i].id||(!allowed.has(h.owner)&&h.owner!==null)||!Number.isInteger(h.count)||h.count<0||h.count>items[i].count))return items;
  for(let i=0;i<items.length;i++)items[i].owner=host[i].owner;
  return items;
}

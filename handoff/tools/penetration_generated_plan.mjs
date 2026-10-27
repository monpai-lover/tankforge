// Build-time response ownership for exact generated constructors. The caller
// pins the original packet bytes and applies this only to unsupported ranges.
// Source identities and declared assembly joints choose owners. Query points,
// normals, nearest modules and estimated wall thickness are never consulted.

const HANDWHEEL_RANGES=[[0,560],[560,120],[680,40],[720,32],[752,12]];
const POST_RANGES=[[0,40],[40,48]];
const one=values=>values.length===1?values[0]:null;
const modulesOf=context=>context.catalog?.acceptedAnatomy?.modules||[];
const hasModule=(context,id,kind)=>modulesOf(context).some(m=>m.id===id&&m.kind===kind);
const moduleRun=(d,moduleRef,feature,reason)=>[{first:d.first,count:d.count,feature,moduleRef,reason}];
const sameRanges=(actual,expected)=>actual.length===expected.length&&actual.every((r,i)=>r.first===expected[i][0]&&r.count===expected[i][1]);

function sourceIdentity(d,context) {
  const m=context.manifest;
  if(!m||d.role!=='unknown'||d.resistancePolicy!=='unsupported'||
      !Number.isInteger(d.first)||!Number.isInteger(d.count)||d.first<0||d.count<=0||
      !/^mesh:vehicle\//.test(d.meshKey||''))return null;
  const path=d.meshKey.slice(5),base=`generated:${m.generator?.sha256}:build:${m.buildHash}:assembly:${path}`;
  if(!/^[0-9a-f]{64}$/.test(m.generator?.sha256||'')||!/^[0-9a-f]{64}$/.test(m.buildHash||'')||
      !(d.sourceKey===base||d.sourceKey?.startsWith(base+':construction:')))return null;
  const mesh=one((m.meshes||[]).filter(x=>x.key===d.meshKey));
  const assembly=one((m.assemblies||[]).filter(x=>x.key===path));
  const instance=one((m.meshInstances||[]).filter(x=>x.meshKey===d.meshKey));
  if(!mesh||!assembly||!instance||instance.assemblyKey!==path||instance.sourceKey!==base||
      d.first+d.count>mesh.triangleCount||
      !mesh.ranges.some(r=>r.first===d.first&&r.count===d.count&&r.sourceKey===d.sourceKey))return null;
  return {mesh,assembly,path,base};
}

function gearMount(d,context,source) {
  if(!/\/\d+:gear_mounts$/.test(source.path)||d.partId!=='gear_mount')return null;
  // buildGearSupports constructs two 12-sector solid cylinders per fixed
  // casting. Its recorded owner supplies side/role/station and mount ordinal.
  const match=/^side:(-?1):role:(road_wheel|sprocket|idler|return_roller):station:(-?\d+):mount:(\d+)$/.exec(
    d.sourceKey.slice((source.base+':construction:').length));
  if(!match||d.count!==96||d.first!==Number(match[4])*96)return null;
  if(source.mesh.ranges.some((r,i)=>r.first!==i*96||r.count!==96)||
      source.mesh.triangleCount!==source.mesh.ranges.length*96)return null;
  const moduleRef=match[1]==='1'?'track_r':'track_l';
  if(!hasModule(context,moduleRef,'track'))return null;
  return moduleRun(d,moduleRef,`generated:gear_mount:${match[1]}:${match[2]}:${match[3]}:${match[4]}`,
    'Exact buildGearSupports fixed casting; recorded construction owner side/role/station selects the registered track-suspension module.');
}

function handwheel(d,context,source) {
  if(d.sourceKey!==source.base||!/^vehicle\/0:body\/\d+:turret_\d+\/\d+:interior$/.test(source.path)||
      source.mesh.triangleCount!==764)return null;
  const declarations=context.catalog.declarations.filter(x=>x.meshKey===d.meshKey).sort((a,b)=>a.first-b.first);
  if(!sameRanges(declarations,HANDWHEEL_RANGES)||!sameRanges(source.mesh.ranges,HANDWHEEL_RANGES)||
      declarations.some(x=>x.sourceKey!==source.base||x.role!=='unknown'||x.resistancePolicy!=='unsupported'))return null;
  const turret=one(context.manifest.assemblies.filter(a=>a.key===source.assembly.parent));
  if(!turret||turret.joint?.status!=='declared'||turret.joint.kind!=='turret')return null;
  const ti=turret.joint.turret;
  // buildInterior attaches this wheel directly to the turret. With more than
  // one sibling gun the untagged wheel lacks a unique gun identity: reject it.
  const gun=one(context.manifest.assemblies.filter(a=>a.parent===turret.key&&a.joint?.status==='declared'&&
    a.joint.kind==='gun'&&a.joint.turret===ti));
  if(!gun||gun.joint.gun!==0)return null;
  const group=`gun:${ti}:${gun.joint.gun}`,modules=modulesOf(context);
  const candidates=kind=>modules.filter(m=>m.kind===kind&&(m.weapon_group===group||
    m.weapon_group==null&&(m.turret_index===ti||m.turret_index==null&&ti===0)));
  // Legacy single-gun anatomy can omit weapon_group; a unique authored drive
  // is still the wheel's mechanical owner. A breech owns the apparatus when
  // the vehicle has no separate vertical-drive damage component.
  const drives=candidates('vertical_drive'),breeches=candidates('gun_breech');
  const owner=one(drives)||(!drives.length?one(breeches):null);
  if(!owner)return null;
  return moduleRun(d,owner.id,`generated:gun_handwheel:${group}:${d.first}`,
    'Exact breechGeometry handwheel emission (560/120/40/32/12 triangles) attached by buildInterior to this single declared gun; registered drive or breech owns the mechanism.');
}

function pintleWeapon(d,context,source) {
  if(d.sourceKey!==source.base)return null;
  const post=/\/(\d+):mg_post$/.exec(source.path),gunPath=/\/(\d+):mg_gun$/.test(source.path);
  if(!post&&!gunPath)return null;
  if(post&&(!sameRanges(source.mesh.ranges,POST_RANGES)||source.mesh.triangleCount!==88))return null;
  // Only the source gun body at range zero is admitted. Appended protective
  // shield ranges are separate armor questions and remain unsupported here.
  if(gunPath&&d.first!==0)return null;
  const assemblies=context.manifest.assemblies;
  const gun=post?one(assemblies.filter(a=>a.parent===source.assembly.parent&&
    a.key===`${source.assembly.parent}/${Number(post[1])+1}:mg_gun`)):source.assembly;
  const joint=gun?.joint,secondary=context.vehicleBundle?.weapons?.secondary;
  if(!gun||joint?.status!=='declared'||joint.kind!=='mg'||!Number.isInteger(joint.index)||
      !Array.isArray(secondary)||joint.index<0||joint.index>=secondary.length)return null;
  const weapon=secondary[joint.index];
  if(!weapon||weapon.mount!=='pintle'||joint.machineGunId!==weapon.id||joint.mountedWeaponKey!==`mg:${weapon.id}`)return null;
  const anchor=context.vehicleBundle.visual?.mg_anchors?.[weapon.id]==='hull'?'hull':'turret';
  if(joint.anchor!==anchor)return null;
  const expectedParent=anchor==='hull'?'vehicle/0:body':
    one(assemblies.filter(a=>a.joint?.status==='declared'&&a.joint.kind==='turret'&&a.joint.turret===0))?.key;
  if(gun.parent!==expectedParent||source.assembly.parent!==expectedParent)return null;
  const owner=one(modulesOf(context).filter(m=>m.kind==='machine_gun'&&
    m.weapon_group===joint.mountedWeaponKey&&m.id===`${joint.mountedWeaponKey}:receiver`));
  if(!owner)return null;
  return moduleRun(d,owner.id,`generated:pintle_${post?'post':'gun'}:${weapon.id}:${d.first}`,
    `Exact generated pintle ${post?'mount/post':'weapon body'}; declared MG joint and original secondary index identify the registered weapon receiver. Appended shield ranges are excluded.`);
}

/** Returns an exact partition of this declaration, or null when unreviewed. */
export function reviewDeclaration(d,part,context) {
  if(part||!d||!context)return null;
  const source=sourceIdentity(d,context);if(!source)return null;
  return gearMount(d,context,source)||handwheel(d,context,source)||pintleWeapon(d,context,source);
}

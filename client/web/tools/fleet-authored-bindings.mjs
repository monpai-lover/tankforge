// Build-time source authoring for the canonical capture/catalog exporter.
// Rules name original constructor features, never nearby engineering planes.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { triangulate } from '../src/gfx/geo.js';
import {reviewedAdditionalFleetSource,additionalAuthoredPartBindings,additionalAuthoredRunningGearBinding} from './fleet-additional-authored-bindings.mjs';

const REVISION='first-party-constructor-bindings-v1';
const CONSTRUCTOR_HASH='9089a6b46999fddeabe8e3fb020e9bdebdbbd300003a6c5be4135d799242772a';
const SOURCES={
  de_hetzer:{assetHash:'ea48f4466a05d06bfe5588e64707a4c14483c49ae7dc1e60ef1be26eb1f6cd2d',weaponId:'pak39_75_l48',wheelIds:['track_l','track_r'],evidence:'tools/gen_vehicles.py:2776-2932'},
  de_tiger_e:{assetHash:'d43f085e39fe95a07d5e2417ce702b08ffc5968d55061eb95c73305d98664d36',weaponId:'kwk36_88_l56',wheelIds:['track_l','track_r'],evidence:'tools/gen_vehicles.py:582-655'},
  de_sdkfz234_2:{assetHash:'b94fb3fd7e56c3d872b08a99719f29539f998aab8317ff3342ea12ec513ce047',weaponId:'kwk39_1',wheelIds:['wheels_l','wheels_r'],evidence:'tools/gen_vehicles.py:3440-3487'},
  de_pz4_h:{assetHash:'36c9cc0803aed05fca977795f4fb0115d81d78d45adb8ac53e4621c262782cfe',weaponId:'kwk40_75_l48',wheelIds:['track_l','track_r'],evidence:'tools/gen_vehicles.py:pz4h; SOURCES.md:Panzer IV'},
  de_pz3_j:{assetHash:'ed2a80239f41f536d2562eb80ee872096d8e42e2d2b4c2f374e35e6ca93337e6',weaponId:'kwk39_50_l60',wheelIds:['track_l','track_r'],evidence:'tools/gen_vehicles.py:pz3j; SOURCES.md:Panzer III'},
  su_t34_1940:{assetHash:'30756b3df16d63934e4f8c8514fbb5f6944c58226b971eb6ecff7b38c8905076',weaponId:'l11_76',wheelIds:['track_l','track_r'],evidence:'tools/gen_vehicles.py:t34_1940/T34_1940_TURRET; inherited t34_85/sec/ring; SOURCES.md:T-34 (1940)'},
  su_t34_85:{assetHash:'eb5ed37fcd82431ecb3bc2f34c1d2cde1ddbc77094bbfc03e25e3063efbdd443',weaponId:'zis_s_53_85',wheelIds:['track_l','track_r'],evidence:'tools/gen_vehicles.py:t34_85/sec/ring; SOURCES.md:T-34-85 procedural hull'},
};
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceCache=new Map();
function sourceOf(specId){
  if(!Object.hasOwn(SOURCES,specId))return null;
  const review=SOURCES[specId];
  if(!sourceCache.has(specId)){
    const bytes=fs.readFileSync(new URL(`../../../data/vehicles/${specId}/visual.json`,import.meta.url));
    if(sha(bytes)!==review.assetHash||sha(fs.readFileSync(new URL('../src/gfx/geo.js',import.meta.url)))!==CONSTRUCTOR_HASH)throw new Error('reviewed source/constructor revision changed; authoring review required');
    sourceCache.set(specId,JSON.parse(bytes));
  }return {review,visual:sourceCache.get(specId)};
}
export function reviewedFleetSource(specId){
  const source=sourceOf(specId);
  if(source)return Object.freeze({specId,...source.review,partCount:source.visual.parts.length,constructorHash:CONSTRUCTOR_HASH,revision:REVISION,historicalArmorCertification:false});
  const additional=reviewedAdditionalFleetSource(specId);
  return additional?Object.freeze({...additional,admissionStatus:specId==='proto_a'?'incomplete_unadmitted':'reviewed_subset',...(specId==='proto_a'?{admissionReason:'no reviewed authored armor coverage or registered running-gear modules'}:{})}):null;
}

const span=(start,end)=>Array.from({length:end-start+1},(_,i)=>start+i);
// The named welded hull's longitudinal section order is explicit in sec/ring.
// Sponson/lower sides, nose/cap closures and the raised-deck step stay unknown.
const t34HullFaces=Object.fromEntries([
  ...span(3,7).flatMap(b=>[0,15].map(e=>[`loft:band:${b}:edge:${e}`,'hull_floor'])),
  ...span(3,6).flatMap(b=>[[5,'hull_side_r'],[10,'hull_side_l']].map(([e,id])=>[`loft:band:${b}:edge:${e}`,id])),
  ...span(0,3).flatMap(b=>[7,8].map(e=>[`loft:band:${b}:edge:${e}`,'hull_rear'])),
  ...[4,6].flatMap(b=>[7,8].map(e=>[`loft:band:${b}:edge:${e}`,'hull_roof'])),
  ...[7,8].map(e=>[`loft:band:7:edge:${e}`,'hull_upper_front']),
  ...[0,15].map(e=>[`loft:band:8:edge:${e}`,'hull_lower_front']),
]);
const t34WeldedTurretFaces=Object.fromEntries(span(1,5).flatMap(b=>[[2,'turret_side_r'],[3,'turret_side_r'],[8,'turret_side_l'],[9,'turret_side_l'],[5,'turret_roof'],[6,'turret_roof']].map(([e,id])=>[`loft:band:${b}:edge:${e}`,id])));
const RULES={
  su_t34_1940:{
    faces:{0:t34HullFaces,26:t34WeldedTurretFaces},
    // The cast L-11 mantlet/recuperator/sleeve, roof/driver hatches, ring collar,
    // bow ball mount and welded front/rear tips/caps remain unsupported.
    decorations:[],barrels:[30],mgBarrels:{31:'mg:coax_dt'},
  },
  su_t34_85:{
    faces:{0:t34HullFaces},
    // The polar-ring cast turret (including its cap), cast mantlet, sleeves,
    // cupola, hatches, protective fittings and external fuel drums stay unknown.
    decorations:[],barrels:[33,34],mgBarrels:{35:'mg:coax_dt'},
  },
  de_hetzer:{
    // section_ring edge identities: centre floor, low side, sponson underside,
    // outer sponson wall, upper join; opposite edges retain the source order.
    faces:{0:{'loft:band:1:edge:0':'hull_floor','loft:band:1:edge:9':'hull_floor','loft:band:1:edge:1':'hull_lower_side_r','loft:band:1:edge:8':'hull_lower_side_l','loft:band:1:edge:3':'hull_sponson_r','loft:band:1:edge:6':'hull_sponson_l','loft:band:0:edge:0':'hull_rear_lower','loft:band:0:edge:9':'hull_rear_lower','loft:band:2:edge:0':'hull_lower_front','loft:band:2:edge:9':'hull_lower_front','loft:band:3:edge:0':'hull_lower_front','loft:band:3:edge:9':'hull_lower_front'},
      1:{'loft:band:0:edge:0':'hull_side_r','loft:band:0:edge:2':'hull_rear','loft:band:0:edge:4':'hull_side_l','loft:band:0:edge:6':'hull_upper_front','loft:cap:1':'hull_roof'},
      13:{'loft:band':'gun_mantlet','loft:cap:1':'gun_mantlet'}},
    decorations:[...span(2,11),...span(16,45)],barrels:[14,15],mgBarrels:{},
  },
  de_tiger_e:{
    faces:{0:{'prism:right':'hull_side_r','prism:left':'hull_side_l','prism:edge:0':'hull_floor','prism:edge:1':'hull_lower_front','prism:edge:2':'hull_upper_front','prism:edge:4':'hull_rear'},
      1:{'prism:edge:1':'hull_glacis'},
      2:{'prism:right':'hull_side_r','prism:left':'hull_side_l','prism:edge:1':'hull_upper_front','prism:edge:2':'hull_roof','prism:edge:3':'hull_rear'},
      29:{'plan:top':'turret_roof','plan:edge:0':'turret_front','plan:edge:2':'turret_side_r','plan:edge:19':'turret_side_l',...Object.fromEntries(span(3,18).map(i=>[`plan:edge:${i}`,'turret_rear']))},
      30:{'box:+z':'gun_mantlet'}},
    // Visor housing, MG ball mount, sleeve boss, cupola and bearing collar
    // remain unknown. Their engineering layers/overlap are not separate sources.
    decorations:[...span(3,6),8,...span(12,28),32,33,34,...span(43,64)],barrels:span(35,41),mgBarrels:{11:'mg:bow_mg34'},
  },
  de_sdkfz234_2:{
    faces:{0:{'prism:right':'hull_side_low_r','prism:left':'hull_side_low_l','prism:edge:0':'hull_floor','prism:edge:1':'hull_lower_front'},
      1:{'prism:right':'hull_side_r','prism:left':'hull_side_l','prism:edge:1':'hull_upper_front','prism:edge:2':'hull_driver_plate','prism:edge:3':'hull_roof','prism:edge:5':'hull_deck','prism:edge:7':'hull_rear'},
      10:{'plan:top':'turret_roof','plan:edge:0':'turret_front','plan:edge:2':'turret_side_r','plan:edge:4':'turret_rear','plan:edge:6':'turret_side_l'},
      11:{'cyl:sector:*:positive_cap':'gun_mantlet'}},
    decorations:[...span(2,9),...span(16,19)],barrels:[12,13,14],mgBarrels:{15:'mg:coax_mg42'},
  },
  de_pz4_h:{
    faces:{0:{'prism:right':'hull_side_r','prism:left':'hull_side_l','prism:edge:0':'hull_floor','prism:edge:1':'hull_lower_front','prism:edge:2':'hull_upper_front','prism:edge:4':'hull_rear','prism:edge:5':'hull_rear'},
      1:{'prism:edge:1':'hull_glacis'},
      2:{'prism:right':'hull_side_r','prism:left':'hull_side_l','prism:edge:1':'hull_upper_front','prism:edge:2':'hull_roof','prism:edge:3':'hull_rear'},
      25:{'plan:top':'turret_roof','plan:edge:0':'turret_front','plan:edge:2':'turret_side_r','plan:edge:4':'turret_rear','plan:edge:6':'turret_side_l'},
      26:{'box:+z':'gun_mantlet'}},
    // The mirrored Schuerzen (part 5) has no registered engineering layer.
    // Its visual 8 mm extent and the public 5–8 mm range do not create one.
    // Rails, protective hatches, spare shoes, suspension fittings, visor/MG
    // mounts, cupola and sleeve remain unsupported in this authored subset.
    decorations:[3,4,19,20,30],barrels:[28,...span(32,35)],mgBarrels:{14:'mg:bow_mg34',29:'mg:coax_mg34'},
  },
  de_pz3_j:{
    faces:{0:{'prism:right':'hull_side_r','prism:left':'hull_side_l','prism:edge:0':'hull_floor','prism:edge:1':'hull_lower_front','prism:edge:2':'hull_upper_front','prism:edge:4':'hull_rear','prism:edge:5':'hull_rear'},
      1:{'prism:edge:1':'hull_glacis'},
      2:{'prism:right':'hull_side_r','prism:left':'hull_side_l','prism:edge:1':'hull_upper_front','prism:edge:2':'hull_roof','prism:edge:4':'hull_roof','prism:edge:5':'hull_rear'},
      13:{'plan:top':'turret_roof','plan:edge:0':'turret_front','plan:edge:2':'turret_side_r','plan:edge:4':'turret_rear','plan:edge:6':'turret_side_l'},
      14:{'box:+z':'gun_mantlet'}},
    // Angled turret corners, body joins, protective hatches, visor/MG mounts,
    // cupola and sleeve receive no nearby-plate or model-wall thickness.
    decorations:[3,4,12,18],barrels:[16],mgBarrels:{8:'mg:bow_mg34',17:'mg:coax_mg34'},
  },
};

// These schedules follow geo.js construction order. No geometric normal is
// converted to an armor sector. Loft degeneracy below only mirrors emission.
function constructorFeatures(part,boreRadius){
  const out=[];let first=0;const add=(featureKey,count)=>{out.push({featureKey,first,count});first+=count;};
  if(part.type==='box'){for(const face of ['+z','-z','+x','-x','+y','-y'])add(`box:${face}`,2);}
  else if(part.type==='prism'){
    for(const [i]of triangulate(part.profile).entries()){add(`prism:right:${i}`,1);add(`prism:left:${i}`,1);}
    for(const [i]of part.profile.entries())add(`prism:edge:${i}`,2);
  }else if(part.type==='plan'){
    if(part.hollow)throw new Error('open plan needs a separate reviewed constructor schedule');
    for(const [i]of triangulate(part.outline).entries()){add(`plan:top:${i}`,1);add(`plan:bottom:${i}`,1);}
    for(const [i]of part.outline.entries())add(`plan:edge:${i}`,2);
  }else if(part.type==='loft'){
    const n=part.rings[0].length;
    for(let band=0;band<part.rings.length-1;band++)for(let edge=0;edge<n;edge++){
      const a=part.rings[band][edge],b=part.rings[band][(edge+1)%n],c=part.rings[band+1][(edge+1)%n],d=part.rings[band+1][edge];
      const x=c.map((v,k)=>v-a[k]),y=d.map((v,k)=>v-b[k]),cross=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
      if(Math.hypot(...cross)>1e-12)add(`loft:band:${band}:edge:${edge}`,2);
    }
    for(let end=0;end<2;end++)if((part.caps||[true,true])[end])for(let fan=0;fan<n;fan++)add(`loft:cap:${end}:fan:${fan}`,1);
  }else if(part.type==='cyl'){
    const radius2=part.r2??part.r,hole=part.recoil&&part.axis==='z'?boreRadius:0;
    const tube=hole>0&&hole<Math.min(part.r,radius2)-.002;
    for(let sector=0;sector<(part.segs||18);sector++){
      add(`cyl:sector:${sector}:outer`,2);
      if(tube){add(`cyl:sector:${sector}:positive_ring`,2);add(`cyl:sector:${sector}:negative_ring`,2);add(`cyl:sector:${sector}:bore`,2);}
      else{if(radius2>1e-4)add(`cyl:sector:${sector}:positive_cap`,1);if(part.r>1e-4)add(`cyl:sector:${sector}:negative_cap`,1);}
    }
  }else throw new Error('unreviewed source constructor');
  return out;
}
const unknown=reason=>({role:'unknown',armorRef:null,moduleRef:null,weaponKey:null,boundarySide:null,resistancePolicy:'unsupported',reason});
const decoration=()=>({role:'decoration',armorRef:null,moduleRef:null,weaponKey:null,boundarySide:null,resistancePolicy:'no_authored_armor',reason:null});
function moduleBinding(anatomy,id,kind,weaponKey=null){
  const matches=anatomy.modules?.filter(m=>m.id===id)||[];
  if(matches.length!==1||matches[0].kind!==kind||weaponKey?.startsWith('mg:')&&matches[0].weapon_group!==weaponKey)return unknown('missing or ambiguous registered module/weapon association');
  return {role:'module',armorRef:null,moduleRef:id,weaponKey,boundarySide:null,resistancePolicy:'no_authored_armor',reason:null};
}
function armorBinding(anatomy,id){
  if(anatomy.armor?.filter(a=>a.id===id).length!==1)return unknown('missing or ambiguous authored engineering reference');
  return {role:'armor',armorRef:id,moduleRef:null,weaponKey:null,boundarySide:'outer',resistancePolicy:'authored_thickness',reason:null};
}
function intentFor(rules,ordinal,featureKey){
  for(const [selector,id]of Object.entries(rules.faces[ordinal]||{})){
    if(selector.includes('*')){const [before,after]=selector.split('*');if(featureKey.startsWith(before)&&featureKey.endsWith(after))return id;}
    else if(featureKey===selector||featureKey.startsWith(`${selector}:`))return id;
  }return null;
}

/** Partition one original source-part copy using its immutable minted identity. */
export function authoredPartBindings(specId,part,anatomy,{first,count,mirrorOrdinal=null}){
  if(!Object.hasOwn(SOURCES,specId))return additionalAuthoredPartBindings(specId,part,anatomy,{first,count,mirrorOrdinal});
  if(!Number.isInteger(first)||first<0||!Number.isInteger(count)||count<=0||first+count>1_000_000)throw new Error('invalid source range coverage');
  const source=sourceOf(specId),identity=part?.hitSource,ordinal=identity?.authoredPartOrdinal;
  const clean=part?Object.fromEntries(Object.entries(part).filter(([key])=>key!=='hitSource')):null;
  const expected=source?.visual.parts[ordinal];
  let failure=null;
  if(!source||!identity||!Number.isInteger(ordinal)||!expected||identity.assetHash!==source.review.assetHash||identity.key!==`visual:${source.review.assetHash}:part:${ordinal}`||canonical(clean)!==canonical(expected))failure='unreviewed source identity or changed primitive descriptor';
  const copies=expected?.mirror&&['box','cyl'].includes(expected.type)?2:1;
  if(!failure&&(copies===2?![0,1].includes(mirrorOrdinal):mirrorOrdinal!==null))failure='missing or foreign mirror identity';
  const sourceKey=identity?.key?`${identity.key}${mirrorOrdinal!==null?`:mirror:${mirrorOrdinal}`:''}`:null;
  const base={revision:REVISION,sourceKey,historicalArmorCertification:false};
  if(failure)return [{...base,first,count,sourceTriangleFirst:0,featureKey:'unreviewed',...unknown(failure)}];
  const caliber=anatomy.weapons?.main_gun?.caliber_mm;
  const features=constructorFeatures(expected,typeof caliber==='number'&&Number.isFinite(caliber)?caliber/2000:0);
  if(features.reduce((n,f)=>n+f.count,0)!==count)throw new Error('reviewed constructor/source coverage mismatch');
  const rules=RULES[specId];
  return features.map(feature=>{
    let binding=unknown('unreviewed join, corner, overlap or protective fitting');
    if(rules.decorations.includes(ordinal))binding=decoration();
    else if(rules.barrels.includes(ordinal))binding=anatomy.weapons?.main_gun?.id===source.review.weaponId?moduleBinding(anatomy,'gun_barrel','gun_barrel','gun:0:0'):unknown('source barrel differs from accepted mounted weapon');
    else if(rules.mgBarrels[ordinal]){const key=rules.mgBarrels[ordinal];binding=moduleBinding(anatomy,`${key}:barrel`,'machine_gun',key);}
    else{const ref=intentFor(rules,ordinal,feature.featureKey);if(ref)binding=armorBinding(anatomy,ref);}
    return {...base,first:first+feature.first,count:feature.count,sourceTriangleFirst:feature.first,featureKey:feature.featureKey,...binding};
  });
}

/** Source construction side only; a position/normal/box cannot supply an owner. */
export function authoredRunningGearBinding(specId,owner,anatomy){
  if(!Object.hasOwn(SOURCES,specId))return additionalAuthoredRunningGearBinding(specId,owner,anatomy);
  const source=sourceOf(specId);
  if(!source||!owner||!['wheel','running_gear','track_link','running_gear_connection'].includes(owner.kind)||![1,-1].includes(owner.side))return unknown('missing reviewed running-gear construction owner');
  const moduleRef=source.review.wheelIds[owner.side===-1?0:1];
  return {...moduleBinding(anatomy,moduleRef,'track'),ownerSide:owner.side,revision:REVISION,historicalArmorCertification:false};
}

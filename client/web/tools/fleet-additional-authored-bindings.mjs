// Additional first-party constructor review. This file authors no geometry and admits no packet.
// Original ordinal/feature identities supply responses; proximity, normals and model wall size do not.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {triangulate} from '../src/gfx/geo.js';

const REVISION='additional-first-party-constructor-bindings-v1';
const CONSTRUCTOR_HASH='9089a6b46999fddeabe8e3fb020e9bdebdbbd300003a6c5be4135d799242772a';
const SOURCES={
  de_panther_g:{assetHash:'d2297036618ba2928c7bc95d6c2a86ca30c70c4cff3559e712290b68e8bf82f8',weaponId:'kwk42_75_l70',caliberMm:75,wheelIds:['track_l','track_r'],tubeOrdinals:[19,20],recoilAccessoryOrdinals:[23,24,25,26],breechOrdinals:[],evidence:'tools/gen_vehicles.py:1876-1975; prism lower/upper hull; six-edge welded turret; barrel:1920-1924'},
  de_panther_f:{assetHash:'4e13306c96fee8be888b3459d38fc14dbe000c97ff93564982ddc3c5875f4565',weaponId:'kwk44_1_75_l70',caliberMm:75,wheelIds:['track_l','track_r'],tubeOrdinals:[17,18],recoilAccessoryOrdinals:[19],breechOrdinals:[],evidence:'tools/gen_vehicles.py:2058-2101; G hull; Schmalturm source plan; tube:2078-2079; collar:2080 explicitly corrected to recoil; client/web/test/panther-f-muzzle-recoil.test.mjs'},
  su_is2:{assetHash:'32add630445a719bb7b461f26174d5bdbca16402c5241e3179b8a5a91419deec',weaponId:'d25t_122',caliberMm:121.92,wheelIds:['track_l','track_r'],tubeOrdinals:[18,19],recoilAccessoryOrdinals:[22,23,24,25],breechOrdinals:[],evidence:'tools/gen_vehicles.py:1976-2057; two source hull prisms; cast dome not reviewed; tube:2008-2013'},
  su_t54:{assetHash:'c06181147db072b7b098e13fcd995ece7d702f7ef79ec6d44809a92b1314128a',weaponId:'d10t_100',caliberMm:100,wheelIds:['track_l','track_r'],tubeOrdinals:[48,49],recoilAccessoryOrdinals:[50],breechOrdinals:[],evidence:'tools/gen_vehicles.py:3014-3174; ordered sec/section_ring hull; canvas cover and cast turret unreviewed; tube:3110-3112'},
  us_m8:{assetHash:'00085237be905a3dc7fd9b9504aacb00beb866f3ff3d05185d5780f0a6516942',weaponId:'m6_37mm',caliberMm:37,wheelIds:['wheels_l','wheels_r'],tubeOrdinals:[26],recoilAccessoryOrdinals:[27],breechOrdinals:[29],evidence:'tools/gen_vehicles.py:3289-3422; ordered sec/section_ring hull, shield:3353; tube:3358; breech:3361-3362; tools/procedural_refinements.py:25-36'},
  us_m10:{assetHash:'a0a5ef5d737e08f6b598d9e6311b1f1c00fd003ed0b25598e397502379f4e608',weaponId:'m7_3in',caliberMm:76.2,wheelIds:['track_l','track_r'],tubeOrdinals:[28,29],recoilAccessoryOrdinals:[],breechOrdinals:[30],evidence:'tools/gen_vehicles.py:1625-1706; M4 lower prism and sloped upper hull; open turret; tube:1652-1653; tools/procedural_refinements.py:25-36'},
  us_m4a2:{assetHash:'8d0a472170947b02228275d3a46c9f30c4df3f4ae4a88f91ba8aa9c282c522a5',weaponId:'m3_75',caliberMm:75,wheelIds:['track_l','track_r'],tubeOrdinals:[36],recoilAccessoryOrdinals:[],breechOrdinals:[],evidence:'tools/gen_vehicles.py:1591-1623 inherits m4a3_75w; m4_lower_hull/M4_LOWER:1208; reversed m4_upper_ring sequence:1221-1251; tube:1347'},
  us_m4a3_75w:{assetHash:'80c350a6dcda72a57e8533c9e02b603a1270defc5b10def82e137b4b89b052a3',weaponId:'m3_75',caliberMm:75,wheelIds:['track_l','track_r'],tubeOrdinals:[36],recoilAccessoryOrdinals:[],breechOrdinals:[],evidence:'tools/gen_vehicles.py:1318-1385; m4_lower_hull/M4_LOWER:1208; reversed m4_upper_ring sequence:1221-1251; tube:1347'},
  us_m4a1_76w:{assetHash:'f85aeb6a844d80aea065283c4519834e4dd3fce80e5c3b343ea4bf8da89618df',weaponId:'m1a1_76',caliberMm:76.2,wheelIds:['track_l','track_r'],tubeOrdinals:[37],recoilAccessoryOrdinals:[],breechOrdinals:[],evidence:'tools/gen_vehicles.py:1520-1589; cast upper hull unreviewed; common lower hull:1208; tools/procedural_refinements.py:37-53 removes M1A2 brake and extends plain M1A1 tube'},
  us_m4a3_76w_hvss:{assetHash:'34ef879db66de9287f0b823d1fbc52a635e12211cf95b0e5b4afb2b93b3e8ebc',weaponId:'m1a2_76',caliberMm:76.2,wheelIds:['track_l','track_r'],tubeOrdinals:[23],recoilAccessoryOrdinals:[24,25],breechOrdinals:[],evidence:'tools/gen_vehicles.py:1409-1495 inherits common M4 lower/welded upper hull; t23_turret tube/brake:1401-1403; HVSS supports do not supply armor'},
  uk_cromwell_iv:{assetHash:'fa99912995ed8b60ce3b10609a231c8156d3d9ac28ec98b55a4101373dde4f4a',weaponId:'qf_75_mk5',caliberMm:75,wheelIds:['track_l','track_r'],tubeOrdinals:[16],recoilAccessoryOrdinals:[17,18],breechOrdinals:[],evidence:'tools/gen_vehicles.py:3175-3270; hull prisms; chamfer_rect turret face order; tube:3210-3212'},
  xp_w78:{assetHash:'d0a1f53a433b1a4bf2d65c8f811b3441c6f9bb12e49b0acdca47217dfd2a4ac7',weaponId:'xp_78_lr',caliberMm:78,wheelIds:['wheels_l','wheels_r'],tubeOrdinals:[57,59],recoilAccessoryOrdinals:[58,60,61,62],breechOrdinals:[],evidence:'tools/gen_vehicles.py:w4_roof/w4_section/w4_turret_section:3544-3585; source zs/section_ring:3587-3596; separate turret upper front/roof refs:3674-3678; tube/evacuator/brake:3732-3743'},
  de_pzjg1:{assetHash:'752389708e37c2e998838e9107f6efd8c9890cc23949cd485603459d83c86c9e',weaponId:'pak36t_47',caliberMm:47,wheelIds:['track_l','track_r'],tubeOrdinals:[33],recoilAccessoryOrdinals:[34],breechOrdinals:[],evidence:'tools/gen_vehicles.py:2468-2582; ordered sec/section_ring hull; slab shield stays unknown; tube:2538-2539'},
  de_flakpz38t:{assetHash:'759f8bba2f7fcf4374fad34a0ffd6e6299ad9089f046e6baa69e60390934d595',weaponId:'flak38_20',caliberMm:20,wheelIds:['track_l','track_r'],tubeOrdinals:[66],recoilAccessoryOrdinals:[67],breechOrdinals:[],evidence:'tools/gen_vehicles.py:2599-2750 ordered sec/section_ring hull and comp_ring lower walls; flak38_parts:3931-3976; tools/procedural_mounts.py'},
  de_hetzer_flak:{assetHash:'5b25d3fd74b4fe0e109ba609067a0d9a0039a48d3516c28fc17e2ab61a5f46b5',weaponId:'flak38_20',caliberMm:20,wheelIds:['track_l','track_r'],tubeOrdinals:[38],recoilAccessoryOrdinals:[39],breechOrdinals:[],evidence:'tools/gen_vehicles.py:2767-2859 section_ring and outer comp_ring hull; flak branch:2962-2991; flak38_parts:3931-3976; tools/procedural_mounts.py'},
  de_rso_flak:{assetHash:'ccb8c55b417c03b931ded8bdededc738e02428f3979fca0b8f560412a0ea0d5f',weaponId:'flak38_20',caliberMm:20,wheelIds:['track_l','track_r'],tubeOrdinals:[47],recoilAccessoryOrdinals:[48],breechOrdinals:[],evidence:'tools/gen_vehicles.py:rso lower prism:3979-4001; timber/pressed cab source:4065; flak38_parts:3931-3976; tools/procedural_mounts.py'},
  de_rso_pak40:{assetHash:'2fca87ab45db719824120021c944c8df45b49242903e3ed354a5c42b2f4fb645',weaponId:'pak40_75',caliberMm:75,wheelIds:['track_l','track_r'],tubeOrdinals:[39,40],recoilAccessoryOrdinals:[41,42],breechOrdinals:[],evidence:'tools/gen_vehicles.py:rso lower prism:3979-4001; PaK40 tube:4043-4046; tools/procedural_hull_details.py splits cab roof mesh and driving lids; cab mesh/shield unreviewed'},
  uk_cmp_portee:{assetHash:'acec8b9c7de331b39cbf18927b774d98a9ab3fded6d458a030c8864a028387f4',weaponId:'qf6pdr_mk2',caliberMm:57,wheelIds:['wheels_l','wheels_r'],tubeOrdinals:[66],recoilAccessoryOrdinals:[67,68],breechOrdinals:[],evidence:'tools/gen_vehicles.py:4168-4313; explicit bonnet/cab-side prisms and back/bed/bin/tailboard boxes; tube:4253-4255; mount facing 180 degrees'},
  proto_a:{assetHash:'ee67949cf571dc16b568cc5bc6c60bdb1ea0c5edc87c4752ba3d8b80ef243eed',weaponId:'gun_75',caliberMm:75,wheelIds:[null,null],tubeOrdinals:[6],recoilAccessoryOrdinals:[7],breechOrdinals:[],evidence:'tools/gen_vehicles.py:4770-4800 fictional exterior; data/vehicles/proto_a/{armor,weapons,modules}.json hand-written; generic armor/source correspondence unreviewed'},
};
const span=(a,b)=>Array.from({length:b-a+1},(_,i)=>a+i);
const loftFaces=(bands,edges,ref)=>Object.fromEntries(bands.flatMap(b=>edges.map(e=>[`loft:band:${b}:edge:${e}`,ref])));
// Helpers below name the ordered source generator features, not observed normals or bounding planes.
const pantherHull={0:{'prism:edge:0':'hull_floor','prism:edge:1':'hull_lower_front'},1:{'prism:right':'hull_side_r','prism:left':'hull_side_l','prism:edge:1':'hull_upper_front','prism:edge:2':'hull_roof','prism:edge:3':'hull_rear'}};
const m4Lower={'prism:edge:0':'hull_floor'}; // Cast transmission nose and its facets are unreviewed.
const m4Welded={...loftFaces(span(1,11),[1],'hull_side_r'),...loftFaces(span(1,11),[6],'hull_side_l'),...loftFaces(span(1,11),[3,4],'hull_roof'),...loftFaces([0],[3,4],'hull_rear'),...loftFaces([12],[3,4],'hull_upper_front')};
const hetzerLower={'loft:band:1:edge:0':'hull_floor','loft:band:1:edge:9':'hull_floor','loft:band:1:edge:1':'hull_lower_side_r','loft:band:1:edge:8':'hull_lower_side_l','loft:band:1:edge:3':'hull_sponson_r','loft:band:1:edge:6':'hull_sponson_l','loft:band:0:edge:0':'hull_rear_lower','loft:band:0:edge:9':'hull_rear_lower',...loftFaces([2,3],[0,9],'hull_lower_front')};
const rsoLower={'prism:right':'hull_side_r','prism:left':'hull_side_l','prism:edge:0':'hull_floor','prism:edge:1':'hull_front','prism:edge:2':'hull_front','prism:edge:4':'hull_rear'};
const RULES={
  de_panther_g:{faces:{...pantherHull,14:{'plan:top':'turret_roof','plan:edge:0':'turret_front','plan:edge:2':'turret_side_r','plan:edge:3':'turret_rear','plan:edge:4':'turret_side_l'}},gaps:['Lower-hull side/sponson joins, turret cheeks/corners, cast mantlet, sleeve, hatches, bearing collar and fittings.']},
  de_panther_f:{faces:{...pantherHull,14:{'plan:top':'turret_roof','plan:edge:0':'turret_front','plan:edge:1':'turret_side_r','plan:edge:3':'turret_rear','plan:edge:5':'turret_side_l'}},gaps:['Lower-hull joins, Schmalturm rear chamfers, cast Saukopf, rangefinder housings, turret bearing collar and fittings.']},
  su_is2:{faces:{0:{'prism:edge:0':'hull_floor','prism:edge:1':'hull_lower_front'},1:{'prism:right':'hull_side_r','prism:left':'hull_side_l','prism:edge:1':'hull_upper_front','prism:edge:2':'hull_roof'}},gaps:['Cast turret dome/caps, hull rear joins, cast mantlet/sleeve, bow-MG mesh and protective fittings.']},
  su_t54:{faces:{0:{...loftFaces([4],[0,13],'hull_floor'),...loftFaces(span(2,4),[4],'hull_side_r'),...loftFaces(span(2,4),[9],'hull_side_l'),...loftFaces(span(2,4),[6,7],'hull_roof'),...loftFaces([5],[6,7],'hull_upper_front'),...loftFaces([6],[0,13],'hull_lower_front')}},gaps:['Sponson underside/lower side walls, rear bevel/cap, upper front tip/cap, cast turret, canvas mantlet, fuel drums and fittings.']},
  us_m8:{faces:{0:{...loftFaces(span(1,5),[0,15],'hull_floor'),...loftFaces(span(1,4),[6],'hull_side_r'),...loftFaces(span(1,4),[9],'hull_side_l'),...loftFaces(span(1,3),[5],'hull_side_low_r'),...loftFaces(span(1,3),[10],'hull_side_low_l'),...loftFaces(span(1,4),[7,8],'hull_roof')},22:{'box:+z':'gun_shield'}},gaps:['Three nose plate transitions, rear/tip caps, hollow open turret18, skate rail, shield rear/thickness edges, sleeves and fittings.']},
  us_m10:{faces:{0:m4Lower,17:{'prism:right':'hull_side_r','prism:left':'hull_side_l','prism:edge:1':'hull_upper_front','prism:edge:2':'hull_roof','prism:edge:3':'hull_rear'}},gaps:['Cast lower nose, rear hull joins, hollow open turret24, mantlet/sleeve, counterweights, guards and fittings.']},
  us_m4a2:{faces:{0:m4Lower,5:m4Welded},gaps:['Cast lower nose, upper hull bottom/corners/caps, cast turret/mantlet, hatches, collars and protective fittings.']},
  us_m4a3_75w:{faces:{0:m4Lower,5:m4Welded},gaps:['Cast lower nose, upper hull bottom/corners/caps, cast turret/mantlet, hatches, collars and protective fittings.']},
  us_m4a1_76w:{faces:{0:m4Lower},gaps:['Entire cast upper hull5, cast T23 turret/mantlet, cast lower nose, hatches, bearing collar and fittings.']},
  us_m4a3_76w_hvss:{faces:{0:m4Lower,5:m4Welded},gaps:['Cast lower nose, upper hull bottom/corners/caps, cast T23 turret/mantlet, HVSS fittings, hatches and bearing collar.']},
  uk_cromwell_iv:{faces:{0:{'prism:edge:0':'hull_floor','prism:edge:1':'hull_lower_front','prism:edge:3':'hull_glacis'},1:{'prism:right':'hull_side_r','prism:left':'hull_side_l','prism:edge:1':'hull_upper_front','prism:edge:2':'hull_roof','prism:edge:4':'hull_rear'},13:{'plan:top':'turret_roof','plan:edge:0':'turret_front','plan:edge:2':'turret_side_r','plan:edge:4':'turret_rear','plan:edge:6':'turret_side_l'}},gaps:['Lower-hull side/join faces, rear bevel, turret chamfer corners/bottom, mantlet/sleeve, visor/ball mounts and fittings.']},
  xp_w78:{faces:{0:{...loftFaces(span(2,23),[0,13],'hull_floor'),...loftFaces(span(2,22),[4],'hull_side_r'),...loftFaces(span(2,22),[9],'hull_side_l'),...loftFaces(span(0,12),[6,7],'hull_roof'),...loftFaces(span(13,25),[6,7],'hull_glacis'),...loftFaces([24,25],[0,13],'hull_lower_front')},1:{...loftFaces(span(0,2),[3,4],'turret_roof'),...loftFaces([3,4],[3,4],'turret_front_upper')}},gaps:['Wheel-arch/lower side geometry, nose/rear caps, turret lower sides/cheeks/front caps, glazed cab, mantlet and protective fittings.']},
  de_pzjg1:{faces:{0:{...loftFaces(span(1,3),[0,11],'hull_floor'),...loftFaces(span(1,4),[4],'hull_side_r'),...loftFaces(span(1,4),[7],'hull_side_l'),...loftFaces([1],[5,6],'hull_roof'),...loftFaces([4],[5,6],'hull_upper_front'),...loftFaces([5],[0,11],'hull_lower_front')}},gaps:['Mesh shield slabs1-7, hull rear/tip/caps and raised-deck step, compartment box8, recuperator/cradle/mantlet and fittings.']},
  de_flakpz38t:{faces:{0:{...loftFaces(span(1,4),[0,11],'hull_floor'),...loftFaces(span(1,4),[4],'hull_side_r'),...loftFaces(span(1,4),[7],'hull_side_l'),...loftFaces([3],[5,6],'hull_roof'),...loftFaces([4],[5,6],'hull_upper_front'),...loftFaces([5],[0,11],'hull_lower_front')},1:{'loft:band:0:edge:0':'comp_side_r','loft:band:0:edge:2':'comp_rear','loft:band:0:edge:4':'comp_side_l','loft:band:0:edge:6':'comp_front'}},gaps:['Compartment inside walls/corner joins, hinge flap meshes4-11 with per-triangle armor refs, rear/nose caps, shield mesh60 and fittings.']},
  de_hetzer_flak:{faces:{0:hetzerLower,1:{'loft:band:0:edge:0':'hull_side_r','loft:band:0:edge:2':'hull_rear','loft:band:0:edge:4':'hull_side_l','loft:band:0:edge:6':'hull_upper_front'}},gaps:['Open hull inside walls/corners, sponson underside/caps, source gun shield mesh32 without a registered shield ref, receiver/jacket and fittings.']},
  de_rso_flak:{faces:{0:rsoLower,22:{'prism:right':'cab_side_r','prism:left':'cab_side_l','prism:edge:6':'cab_roof','prism:edge:8':'cab_rear'}},gaps:['Rounded cab nose/front/joins, timber bed sides with legacy skirt responses, shield mesh41, glazing, receiver/jacket and fittings.']},
  de_rso_pak40:{faces:{0:rsoLower,23:{'box:+y':'cab_driving_lid_0'},24:{'box:+y':'cab_driving_lid_1'}},gaps:['Cab mesh22/roof cells and their authored source partition, two-layer shield mesh32, timber bed material mismatch, lid boundary walls and fittings.']},
  uk_cmp_portee:{faces:{5:{'prism:right':'bonnet_side_r','prism:left':'bonnet_side_l','prism:edge:1':'bonnet_front','prism:edge:2':'bonnet_top','prism:edge:3':'bonnet_top','prism:edge:4':'bonnet_top','prism:edge:5':'bonnet_top'},7:{'prism:right':'cab_side_r'},8:{'prism:left':'cab_side_l'},9:{'box:-z':'cab_back'},30:{'box:+y':'bed_floor'},37:{'box:+x':['bin_r','bin_l']},38:{'box:-z':'tailboard'}},gaps:['Cab/bonnet closures and rear/interior faces, open bins/interior, gun shield mesh62, chassis/fenders, glazing and fittings.']},
  proto_a:{faces:{},gaps:['Generic hand-written armor has no reviewed correspondence to this fictional hull/turret exterior.','No authored running-gear module IDs; source tube review does not establish hull or track armor semantics.']},
};

const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
freeze(SOURCES);freeze(RULES);
const readSource=p=>fs.readFileSync(new URL('../../../'+p,import.meta.url));
const cache=new Map();
function sourceOf(specId,reader=readSource){
  if(!Object.hasOwn(SOURCES,specId))return null;
  const review=SOURCES[specId];
  if(reader!==readSource||!cache.has(specId)){
    const bytes=reader(`data/vehicles/${specId}/visual.json`);
    if(sha(bytes)!==review.assetHash||sha(reader('client/web/src/gfx/geo.js'))!==CONSTRUCTOR_HASH)throw Error('reviewed source/constructor revision changed; authoring review required');
    const source={review,visual:freeze(JSON.parse(bytes))};
    if(reader!==readSource)return source;
    cache.set(specId,source);
  }
  return cache.get(specId);
}

/** Frozen source descriptors. fullHullSemantics is deliberately false for this reviewed subset. */
export function reviewedAdditionalFleetSource(specId,{readSource:reader=readSource}={}){
  const source=sourceOf(specId,reader);if(!source)return null;
  const {review,visual}=source,requiredRecoilCorrection=specId==='de_panther_f'&&visual.parts[19].recoil!==true?{ordinal:19,currentDescriptor:visual.parts[19],sourceEvidence:'tools/gen_vehicles.py:2080',reason:'Fixed solid-capped muzzle collar remains outside the recoil upload; barrel-node-only fracture leaves it at the old muzzle.'}:null;
  return freeze({specId,...review,partCount:visual.parts.length,constructorHash:CONSTRUCTOR_HASH,revision:REVISION,historicalArmorCertification:false,fullHullSemantics:false,barrelNodeOnlyEligible:!requiredRecoilCorrection,requiredRecoilCorrection,coverageGaps:RULES[specId].gaps,faceRules:RULES[specId].faces,physicalBarrelId:`authored_tube:${specId}:${review.tubeOrdinals.join('-')}`,mountedWeaponKey:'gun:0:0',moduleRef:'gun_barrel',tubeConstructors:review.tubeOrdinals.map(ordinal=>({ordinal,part:visual.parts[ordinal]}))});
}
export const REVIEWED_ADDITIONAL_BARRELS=freeze(Object.fromEntries(Object.entries(SOURCES).map(([id,s])=>[id,{tubeOrdinals:s.tubeOrdinals,physicalBarrelId:`authored_tube:${id}:${s.tubeOrdinals.join('-')}`,evidence:s.evidence,barrelNodeOnlyEligible:true}])));

const unknown=reason=>({role:'unknown',armorRef:null,moduleRef:null,weaponKey:null,boundarySide:null,resistancePolicy:'unsupported',physicalRole:null,reason});
function moduleBinding(anatomy,id,kind,weaponKey=null,physicalRole=null){
  const matches=anatomy.modules?.filter(m=>m.id===id)||[];
  if(matches.length!==1||matches[0].kind!==kind||weaponKey&&matches[0].weapon_group!=null&&matches[0].weapon_group!==weaponKey||weaponKey==='gun:0:0'&&matches[0].turret_index!=null&&matches[0].turret_index!==0)return unknown('missing, ambiguous or foreign registered module/weapon association');
  return {role:'module',armorRef:null,moduleRef:id,weaponKey,boundarySide:null,resistancePolicy:'no_authored_armor',physicalRole,reason:null};
}
function armorBinding(anatomy,id){
  if(anatomy.armor?.filter(a=>a.id===id).length!==1)return unknown('missing or ambiguous authored engineering reference');
  return {role:'armor',armorRef:id,moduleRef:null,weaponKey:null,boundarySide:'outer',resistancePolicy:'authored_thickness',physicalRole:null,reason:null};
}
function intentFor(rules,ordinal,feature,mirror){
  for(const[selector,value]of Object.entries(rules.faces[ordinal]||{}))if(feature===selector||feature.startsWith(`${selector}:`))return Array.isArray(value)?value[mirror]:value;
  return null;
}
// Exact geo.js emission order. These schedules establish source features, never engineering thickness.
function constructorFeatures(part,boreRadius){
  const out=[];let first=0;const add=(featureKey,count)=>{out.push({featureKey,first,count});first+=count;};
  if(part.type==='box')for(const face of ['+z','-z','+x','-x','+y','-y'])add(`box:${face}`,2);
  else if(part.type==='prism'){for(const[i]of triangulate(part.profile).entries()){add(`prism:right:${i}`,1);add(`prism:left:${i}`,1);}for(const[i]of part.profile.entries())add(`prism:edge:${i}`,2);}
  else if(part.type==='plan'&&!part.hollow){for(const[i]of triangulate(part.outline).entries()){add(`plan:top:${i}`,1);add(`plan:bottom:${i}`,1);}for(const[i]of part.outline.entries())add(`plan:edge:${i}`,2);}
  else if(part.type==='loft'){
    const n=part.rings[0].length;
    for(let band=0;band<part.rings.length-1;band++)for(let edge=0;edge<n;edge++){
      const a=part.rings[band][edge],b=part.rings[band][(edge+1)%n],c=part.rings[band+1][(edge+1)%n],d=part.rings[band+1][edge],x=c.map((v,k)=>v-a[k]),y=d.map((v,k)=>v-b[k]),cross=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
      if(Math.hypot(...cross)>1e-12)add(`loft:band:${band}:edge:${edge}`,2);
    }
    for(let end=0;end<2;end++)if((part.caps||[true,true])[end])for(let fan=0;fan<n;fan++)add(`loft:cap:${end}:fan:${fan}`,1);
  }else if(part.type==='cyl'){
    const radius2=part.r2??part.r,hole=part.recoil&&part.axis==='z'?boreRadius:0,tube=hole>0&&hole<Math.min(part.r,radius2)-.002;
    for(let sector=0;sector<(part.segs||18);sector++){add(`cyl:sector:${sector}:outer`,2);if(tube){add(`cyl:sector:${sector}:positive_ring`,2);add(`cyl:sector:${sector}:negative_ring`,2);add(`cyl:sector:${sector}:bore`,2);}else{if(radius2>1e-4)add(`cyl:sector:${sector}:positive_cap`,1);if(part.r>1e-4)add(`cyl:sector:${sector}:negative_cap`,1);}}
  }else return null;
  return out;
}

/** Bind one immutable original authored-part copy. Unreviewed constructors keep one unknown range. */
export function additionalAuthoredPartBindings(specId,part,anatomy,{first,count,mirrorOrdinal=null}){
  if(!Number.isInteger(first)||first<0||!Number.isInteger(count)||count<=0||first+count>1_000_000)throw Error('invalid source range coverage');
  const source=sourceOf(specId),identity=part?.hitSource,ordinal=identity?.authoredPartOrdinal,expected=source?.visual.parts[ordinal],clean=part?Object.fromEntries(Object.entries(part).filter(([k])=>k!=='hitSource')):null;
  const base={revision:REVISION,sourceKey:identity?.key?`${identity.key}${mirrorOrdinal!==null?`:mirror:${mirrorOrdinal}`:''}`:null,historicalArmorCertification:false};
  const wholeUnknown=reason=>[{...base,first,count,sourceTriangleFirst:0,featureKey:'unreviewed',...unknown(reason)}];
  if(!source||!identity||!Number.isInteger(ordinal)||!expected||identity.assetHash!==source.review.assetHash||identity.key!==`visual:${source.review.assetHash}:part:${ordinal}`||canonical(clean)!==canonical(expected))return wholeUnknown('unreviewed source identity or changed primitive descriptor');
  const copies=expected.mirror&&['box','cyl'].includes(expected.type)?2:1;
  if(copies===2?![0,1].includes(mirrorOrdinal):mirrorOrdinal!==null)return wholeUnknown('missing or foreign mirror identity');
  const {review}=source,rules=RULES[specId],tube=review.tubeOrdinals.includes(ordinal),accessory=review.recoilAccessoryOrdinals.includes(ordinal),breech=review.breechOrdinals.includes(ordinal);
  // Do not expand an unsupported or unselected constructor just to produce guessed face labels.
  if(!tube&&!accessory&&!breech&&!Object.hasOwn(rules.faces,ordinal))return wholeUnknown('unreviewed cast, join, hollow wall, mesh or protective fitting');
  if((tube||accessory||breech)&&(anatomy.weapons?.main_gun?.id!==review.weaponId||anatomy.weapons.main_gun.caliber_mm!==review.caliberMm||anatomy.weapons.extra_guns?.length||anatomy.weapons.extra_turrets?.length))return wholeUnknown('source cannon differs from accepted main weapon association');
  const features=constructorFeatures(expected,review.caliberMm/2000);if(!features)return wholeUnknown('unreviewed constructor schedule');
  if(features.reduce((n,f)=>n+f.count,0)!==count)throw Error('reviewed constructor/source coverage mismatch');
  return features.map(feature=>{
    let binding=unknown('unreviewed join, corner, overlap or protective fitting');
    if(tube||accessory)binding=moduleBinding(anatomy,'gun_barrel','gun_barrel','gun:0:0',tube?'cannon_tube':'recoil_attachment');
    else if(breech)binding=moduleBinding(anatomy,'breech','gun_breech','gun:0:0','breech');
    else{const ref=intentFor(rules,ordinal,feature.featureKey,mirrorOrdinal);if(ref)binding=armorBinding(anatomy,ref);}
    return {...base,first:first+feature.first,count:feature.count,sourceTriangleFirst:feature.first,featureKey:feature.featureKey,...binding};
  });
}

/** Independent gear module association from explicit construction side, without armor inference. */
export function additionalAuthoredRunningGearBinding(specId,owner,anatomy){
  const source=sourceOf(specId);
  if(!source||!owner||!['wheel','running_gear','track_link','running_gear_connection'].includes(owner.kind)||![1,-1].includes(owner.side))return unknown('missing reviewed running-gear construction owner');
  const moduleRef=source.review.wheelIds[owner.side===-1?0:1];if(!moduleRef)return unknown('no authored running-gear module for this source');
  return {...moduleBinding(anatomy,moduleRef,'track'),ownerSide:owner.side,revision:REVISION,historicalArmorCertification:false};
}

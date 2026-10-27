// Explicit game-data engineering associations for the sealed, first-party fleet.
// The caller must pin the complete source descriptor and emitted constructor
// schedule before using these rules, and may replace ONLY unsupported bindings.
// No query normal, nearest plate, visual wall distance or bounding box chooses a
// response. Geometry, holes, emitted triangle order and existing bindings stay put.
// These are gameplay associations to existing armor records, not historical
// measurements. In particular, joins inside stacked solid visual constructors
// have no additional authored armor layer and must not become infinite barriers.

const armor = (armorRef, boundarySide = 'outer') => ({armorRef, boundarySide});
const module = moduleRef => ({moduleRef});
const join = () => ({decoration:true, reason:'Internal source-constructor closure or mating surface; no separate authored resistance layer.'});
const featureIs = (feature, prefix) => feature === prefix || feature.startsWith(prefix + ':');
const specSet = new Set(['de_pz3_j','de_pz4_h','de_tiger_e','de_panther_g','de_panther_f','de_sdkfz234_2',
  'su_t34_1940','su_t34_85','su_is2','su_t54','us_m4a2','us_m4a3_75w',
  'us_m4a1_76w','us_m4a3_76w_hvss','uk_cromwell_iv','de_hetzer']);

// null marks an internal closure. The index is the literal profile edge in
// visual.json, whose entries are [longitudinal position, height]. Side cap
// triangles are the visible X-side of these exact main hull constructors.
const PRISMS = {
  de_pz3_j:{
    0:['hull_floor','hull_lower_front','hull_upper_front',null,'hull_rear','hull_rear'],
    1:[null,'hull_glacis',null],
    2:[null,'hull_upper_front','hull_roof','hull_roof','hull_roof','hull_rear']},
  de_pz4_h:{
    0:['hull_floor','hull_lower_front','hull_upper_front',null,'hull_rear','hull_rear'],
    1:[null,'hull_glacis',null],
    2:[null,'hull_upper_front','hull_roof','hull_rear']},
  de_tiger_e:{
    0:['hull_floor','hull_lower_front','hull_upper_front',null,'hull_rear'],
    1:[null,'hull_glacis',null],
    2:[null,'hull_upper_front','hull_roof','hull_rear']},
  de_panther_g:{
    0:['hull_floor','hull_lower_front','hull_lower_front',null,'hull_rear'],
    1:[null,'hull_upper_front','hull_roof','hull_rear']},
  de_panther_f:{
    0:['hull_floor','hull_lower_front','hull_lower_front',null,'hull_rear'],
    1:[null,'hull_upper_front','hull_roof','hull_rear']},
  su_is2:{
    0:['hull_floor','hull_lower_front','hull_lower_front',null,'hull_rear','hull_rear'],
    1:[null,'hull_upper_front','hull_roof','hull_rear','hull_rear']},
  uk_cromwell_iv:{
    0:['hull_floor','hull_lower_front','hull_lower_front','hull_glacis',null,'hull_rear','hull_rear'],
    1:[null,'hull_upper_front','hull_roof','hull_rear','hull_rear']},
};
const M4_LOWER = ['hull_floor','hull_lower_front','hull_lower_front','hull_lower_front',
  'hull_lower_front','hull_lower_front',null,'hull_rear','hull_rear'];
for (const id of ['us_m4a2','us_m4a3_75w','us_m4a1_76w','us_m4a3_76w_hvss']) PRISMS[id]={0:M4_LOWER};

// Ordered source plan edges. Chamfer faces are assigned explicitly; they do
// not inherit sectors from a runtime normal. Bottoms mate with a ring/hull.
const PLAN_TURRETS = {
  de_pz3_j:{ordinal:13,edges:['turret_front','turret_side_r','turret_side_r','turret_side_r','turret_rear','turret_side_l','turret_side_l','turret_side_l']},
  de_pz4_h:{ordinal:25,edges:['turret_front','turret_side_r','turret_side_r','turret_side_r','turret_rear','turret_side_l','turret_side_l','turret_side_l']},
  de_tiger_e:{ordinal:29,edges:['turret_front','turret_side_r','turret_side_r',
    'turret_side_r','turret_side_r','turret_side_r','turret_side_r','turret_side_r',
    'turret_rear','turret_rear','turret_rear','turret_rear','turret_rear',
    'turret_side_l','turret_side_l','turret_side_l','turret_side_l','turret_side_l','turret_side_l','turret_side_l','turret_side_l']},
  de_panther_g:{ordinal:14,edges:['turret_front','turret_side_r','turret_side_r','turret_rear','turret_side_l','turret_side_l']},
  de_panther_f:{ordinal:14,edges:['turret_front','turret_side_r','turret_rear','turret_rear','turret_rear','turret_side_l']},
  // The complete bottom outline lies within the closed part1 roof at y1.79.
  de_sdkfz234_2:{ordinal:10,edges:['turret_front','turret_side_r','turret_side_r','turret_side_r','turret_rear','turret_side_l','turret_side_l','turret_side_l']},
  uk_cromwell_iv:{ordinal:13,edges:['turret_front','turret_front','turret_side_r','turret_rear','turret_rear','turret_rear','turret_side_l','turret_front']},
};

const LOFT_TURRETS={su_t34_85:28,su_t54:44,us_m4a2:30,us_m4a3_75w:30,us_m4a1_76w:32,us_m4a3_76w_hvss:18};
const MANTLETS={de_pz3_j:[14],de_pz4_h:[26],de_tiger_e:[30],de_panther_g:[15],de_panther_f:[15],de_sdkfz234_2:[11],
  su_t34_1940:[27],su_t34_85:[30],su_is2:[15],us_m4a2:[31,32],us_m4a3_75w:[31,32],
  us_m4a1_76w:[33,34],us_m4a3_76w_hvss:[19,20],de_hetzer:[12,13]};
// Sleeves/recuperators are weapon components, not another whole hull plate.
const GUN_COMPONENTS={de_pz3_j:[15],de_pz4_h:[27],de_tiger_e:[31],de_panther_g:[16],
  su_t34_1940:[28,29],su_t34_85:[31,32],su_is2:[16],us_m4a2:[33],us_m4a3_75w:[33],
  us_m4a1_76w:[35,36],us_m4a3_76w_hvss:[21,22],uk_cromwell_iv:[15]};
const RING_COMPONENTS={su_t34_1940:[25],su_t34_85:[29],su_t54:[45],us_m4a2:[29],us_m4a3_75w:[29]};

// Source generator comments distinguish these overlays and accessories from
// the closed main hull that already supplies their engineering armor response.
// No separate protective screen, spare track applique, cupola or unreviewed
// armored hood is admitted by this table.
const COVER='Source-authored access-cover/ventilation visual overlay on the closed structural hull; no separate engineering armor layer.';
const GUARD='Source-authored mudguard or flexible mud flap; no declared armor or damage-module response.';
const STOWAGE='Source-authored external stowage container; no declared armor or internal ammunition binding.';
const SMOKE='Source-authored external smoke pot; no declared armor or registered smoke-equipment damage module.';
const NONARMOR={
  de_pz3_j:{9:COVER,10:COVER,11:COVER},
  de_pz4_h:{15:COVER,17:COVER,18:COVER},
  de_panther_g:{2:GUARD,7:COVER,8:COVER,9:COVER,10:COVER,11:COVER,13:STOWAGE,21:COVER},
  de_panther_f:{2:GUARD,7:COVER,8:COVER,9:COVER,10:COVER,11:COVER,13:STOWAGE,21:COVER,22:COVER},
  su_t34_1940:{1:GUARD,2:GUARD,3:GUARD,19:COVER,20:COVER,21:COVER,22:COVER,24:SMOKE},
  su_t34_85:{1:GUARD,2:GUARD,3:GUARD,22:COVER,23:COVER,24:COVER,25:COVER,27:SMOKE},
  su_t54:{1:GUARD,2:GUARD,3:GUARD,4:GUARD,35:COVER,36:COVER,37:COVER,38:COVER,43:SMOKE},
  us_m4a2:{3:GUARD,4:GUARD,12:COVER,13:COVER,14:COVER,15:COVER,16:COVER},
  us_m4a3_75w:{3:GUARD,4:GUARD,12:COVER,13:COVER,14:COVER,15:COVER,16:COVER},
  us_m4a1_76w:{3:GUARD,4:GUARD,14:COVER,15:COVER,16:COVER,17:COVER,18:COVER},
  us_m4a3_76w_hvss:{3:GUARD,4:GUARD,12:COVER,13:COVER,14:COVER,15:COVER,16:COVER},
  uk_cromwell_iv:{10:COVER,11:COVER,12:COVER,23:STOWAGE},
};

function suspensionModule(context) {
  // Capture's mirror 0 is the original positive-X authored part, mirror 1
  // its negative-X duplicate. Neither a normal nor a measured point picks side.
  return context?.mirrorOrdinal===0?module('track_r'):context?.mirrorOrdinal===1?module('track_l'):null;
}

function loftFeature(feature) {
  let m=/^loft:band:(\d+):edge:(\d+)$/.exec(feature);
  if(m)return {band:Number(m[1]),edge:Number(m[2])};
  m=/^loft:cap:([01])(?::fan:\d+)?$/.exec(feature);
  return m?{cap:Number(m[1])}:null;
}
function turretPlan(feature,edges,top=true) {
  if(featureIs(feature,'plan:top'))return top?armor('turret_roof'):join();
  if(featureIs(feature,'plan:bottom'))return join();
  const m=/^plan:edge:(\d+)$/.exec(feature),ref=m&&edges[Number(m[1])];
  return ref?armor(ref):null;
}
function castPolarTurret(feature,part) {
  const f=loftFeature(feature);if(!f)return null;
  if(f.cap!==undefined)return f.cap===1?armor('turret_roof'):join();
  // Source polar_ring starts at +X and proceeds toward -Z, with 36 samples.
  if(part.rings?.[0]?.length!==36)return null;
  if(f.band===part.rings.length-2)return armor('turret_roof');
  return armor(f.edge>=22&&f.edge<=31?'turret_front':f.edge>=5&&f.edge<=12?'turret_rear':f.edge>=13&&f.edge<=21?'turret_side_l':'turret_side_r');
}
function mantlet(feature,part) {
  if(part.type==='box')return armor('gun_mantlet',feature==='box:-z'?'inner':feature==='box:+z'?'outer':'reveal');
  const f=loftFeature(feature);
  if(part.type==='loft'&&f)return armor('gun_mantlet',f.cap===0?'inner':'outer');
  if(part.type==='cyl'&&feature.startsWith('cyl:'))return armor('gun_mantlet',part.axis==='z'&&feature.endsWith(':negative_cap')?'inner':'outer');
  return null;
}

function t34Hull(feature) {
  const f=loftFeature(feature);if(!f)return null;
  if(f.cap!==undefined)return armor(f.cap===0?'hull_rear':'hull_lower_front');
  const {band:b,edge:e}=f;
  if(e===0||e===15)return armor(b<=2?'hull_rear':b===8?'hull_lower_front':'hull_floor');
  if(e===7||e===8)return armor(b<=3?'hull_rear':b>=7?'hull_upper_front':'hull_roof');
  return armor(e<7?'hull_side_r':'hull_side_l');
}
function t54Hull(feature) {
  const f=loftFeature(feature);if(!f)return null;
  if(f.cap!==undefined)return armor(f.cap===0?'hull_rear':'hull_lower_front');
  const {band:b,edge:e}=f;
  if(e===0||e===1||e===12||e===13)return armor(b<2?'hull_rear':b===6?'hull_lower_front':'hull_floor');
  if(e>=5&&e<=8)return armor(b<2?'hull_rear':b>=5?'hull_upper_front':'hull_roof');
  return armor(e<7?'hull_side_r':'hull_side_l');
}
function m4Upper(feature,cast) {
  const f=loftFeature(feature);if(!f)return null;
  if(f.cap!==undefined)return armor(f.cap===0?'hull_rear':'hull_upper_front');
  const {band:b,edge:e}=f;
  if(cast){
    if(e===0||e===19)return join(); // mating plane at common lower hull
    if(b>=8)return armor('hull_upper_front'); // six authored forward nose rings
    if(e>=6&&e<=13)return armor(b===0?'hull_rear':'hull_roof');
    return armor(e<10?'hull_side_r':'hull_side_l');
  }
  if(e===0||e===7)return join();
  if(b===12)return armor('hull_upper_front');
  if(e===3||e===4)return armor(b===0?'hull_rear':'hull_roof');
  return armor(e<4?'hull_side_r':'hull_side_l');
}
function hetzerHull(ordinal,feature) {
  const f=loftFeature(feature);if(!f)return null;
  if(ordinal===1){
    if(f.cap!==undefined)return f.cap===0?join():armor('hull_roof');
    return armor(['hull_side_r','hull_rear','hull_rear','hull_rear','hull_side_l',
      'hull_upper_front','hull_upper_front','hull_upper_front'][f.edge]);
  }
  if(f.cap!==undefined)return armor(f.cap===0?'hull_rear_lower':'hull_lower_front');
  const {band:b,edge:e}=f;
  if(e===4||e===5)return join();
  if(e===0||e===9)return armor(b===0?'hull_rear_lower':b>=2?'hull_lower_front':'hull_floor');
  return armor(e<5?(e===1?'hull_lower_side_r':'hull_sponson_r'):(e===8?'hull_lower_side_l':'hull_sponson_l'));
}

/** Return null for a source feature that this module has not reviewed. */
export function review(specId,partOrdinal,feature,part,context={}) {
  if(!specSet.has(specId)||!Number.isInteger(partOrdinal)||typeof feature!=='string'||!part)return null;
  if(specId==='de_sdkfz234_2'&&part.type==='prism'&&[0,1].includes(partOrdinal)){
    if(featureIs(feature,'prism:right'))return armor(partOrdinal===0?'hull_side_low_r':'hull_side_r');
    if(featureIs(feature,'prism:left'))return armor(partOrdinal===0?'hull_side_low_l':'hull_side_l');
    const edges=partOrdinal===0?['hull_floor','hull_lower_front','hull_lower_front',null,'hull_rear','hull_rear']:
      [null,'hull_upper_front','hull_driver_plate','hull_roof','hull_roof','hull_deck','hull_rear','hull_rear'];
    const match=/^prism:edge:(\d+)$/.exec(feature),ref=match&&edges[Number(match[1])];
    // Lower edge3/upper edge0 share a profile seam but have different widths.
    // Their four triangles contain exposed slivers, so null stays unsupported.
    return ref?armor(ref):null;
  }
  const profile=PRISMS[specId]?.[partOrdinal];
  if(profile&&part.type==='prism'){
    if(featureIs(feature,'prism:right'))return armor('hull_side_r');
    if(featureIs(feature,'prism:left'))return armor('hull_side_l');
    const m=/^prism:edge:(\d+)$/.exec(feature),e=m?Number(m[1]):-1;
    if(e>=0&&e<profile.length)return profile[e]?armor(profile[e]):join();
  }
  const plan=PLAN_TURRETS[specId];
  if(plan?.ordinal===partOrdinal&&part.type==='plan')return turretPlan(feature,plan.edges);
  if(specId==='su_is2'&&[12,13,14].includes(partOrdinal)&&part.type==='plan'){
    const edges=Array.from({length:32},(_,e)=>e<=3||e>=28?'turret_front':e<=11?'turret_side_r':e<=19?'turret_rear':'turret_side_l');
    return turretPlan(feature,edges,partOrdinal===14);
  }
  if(LOFT_TURRETS[specId]===partOrdinal&&part.type==='loft')return castPolarTurret(feature,part);
  if((specId==='su_t34_1940'||specId==='su_t34_85')&&partOrdinal===0&&part.type==='loft')return t34Hull(feature);
  if(specId==='su_t34_1940'&&partOrdinal===26&&part.type==='loft'){
    const f=loftFeature(feature);if(!f)return null;
    if(f.cap!==undefined)return armor(f.cap===0?'turret_rear':'turret_front');
    if(f.edge===0||f.edge===11)return join();
    if(f.edge===5||f.edge===6)return armor('turret_roof');
    if(f.band===0)return armor('turret_rear');
    if(f.band===6)return armor('turret_front');
    return armor(f.edge<6?'turret_side_r':'turret_side_l');
  }
  if(specId==='su_t54'&&partOrdinal===0&&part.type==='loft')return t54Hull(feature);
  if(specId.startsWith('us_m4')&&partOrdinal===5&&part.type==='loft')return m4Upper(feature,specId==='us_m4a1_76w');
  if(specId==='de_hetzer'&&[0,1].includes(partOrdinal)&&part.type==='loft')return hetzerHull(partOrdinal,feature);
  const accessory=NONARMOR[specId]?.[partOrdinal];
  if(accessory)return {decoration:true,reason:accessory};
  // Literal source VVSS spring-housing/bracket/arm/skid ordinals from vvss(),
  // plus the separately authored HVSS units. Their module is the matching
  // registered track/suspension side rather than an armor plane.
  if((['us_m4a2','us_m4a3_75w'].includes(specId)&&partOrdinal>=17&&partOrdinal<=28)||
      (specId==='us_m4a1_76w'&&partOrdinal>=19&&partOrdinal<=30)||
      (specId==='us_m4a3_76w_hvss'&&partOrdinal>=37&&partOrdinal<=45))return suspensionModule(context);
  if(specId==='us_m4a3_76w_hvss'&&partOrdinal>=46&&partOrdinal<=57){
    const side=/^hvss_swing_arm_(-?1)_\d+$/.exec(part.name||'');
    if(side)return module(side[1]==='1'?'track_r':'track_l');
  }
  // The source ordinals below are explicitly the coaxial MG tubes. Use the
  // anatomy's declared weapon group to obtain their actual generated module ID.
  const mgGroup=specId==='uk_cromwell_iv'&&partOrdinal===19?'mg:coax_besa':
    specId==='de_panther_f'&&partOrdinal===16?'mg:coax_mg42':null;
  if(mgGroup){const owner=context.catalog?.acceptedAnatomy?.modules?.find(m=>m.weapon_group===mgGroup);
    if(owner)return module(owner.id);}
  if(specId==='su_t54'&&[46,47].includes(partOrdinal)&&part.type==='cyl'&&part.mat==='canvas')return {
    decoration:true,reason:'Authored canvas mantlet weather cover; no armor resistance or damageable mechanical module.'};
  // tools/gen_vehicles.py t54(): the two sight hoods and their separate glass
  // inserts are optical fittings, not another 130/205 mm cast turret wall.
  // There is no authored optics damage module in this vehicle's anatomy.
  if(specId==='su_t54'&&[55,56,57,58].includes(partOrdinal)&&part.type==='box')return {
    decoration:true,reason:'Source-authored sight hood or glass insert; no declared armor resistance or registered optical damage module.'};
  if(specId==='su_t54'&&[60,61].includes(partOrdinal)&&part.type==='cyl')return module('radio');
  if(specId==='su_t54'&&partOrdinal===59&&part.type==='cyl')return {
    decoration:true,reason:'Source-authored external handrail; no declared armor layer.'};
  if(specId==='su_t54'&&partOrdinal===62&&part.type==='box')return {
    decoration:true,reason:'Source-authored turret-rear stowage box; no registered armor or internal ammunition binding.'};
  if(specId==='uk_cromwell_iv'&&partOrdinal===14&&part.type==='box'&&part.mat==='black')return {
    decoration:true,reason:'Authored black gun-aperture visual insert; no additional engineering armor layer.'};
  if(MANTLETS[specId]?.includes(partOrdinal))return mantlet(feature,part);
  if(GUN_COMPONENTS[specId]?.includes(partOrdinal))return module('gun_barrel');
  if(RING_COMPONENTS[specId]?.includes(partOrdinal))return module('turret_drive');
  // The refinement adds this explicitly named mechanical bearing as a separate
  // source part. Its rendered metal is a turret-drive component, not hull armor.
  if(part.name==='turret_seat_collar'&&part.mount==='turret')return module('turret_drive');
  return null;
}

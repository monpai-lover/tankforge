// Exact first-party constructor review for open/support vehicles. ROOT pins the
// original packet and descriptor before consulting this module. No coordinate,
// normal, proximity or rendered wall-thickness matching supplies engineering.
// null deliberately leaves the original unsupported declaration quarantined.
export const reviewedSpecs = Object.freeze(['us_m10','de_pzjg1','de_flakpz38t','de_hetzer_flak','de_rso_flak','de_rso_pak40','uk_cmp_portee','xp_w78']);
const armor = (armorRef,boundarySide='outer') => ({armorRef,boundarySide});
const module = (moduleRef,reason=null) => ({moduleRef,...(reason?{reason}:{})});
const decoration = (reason='Explicit reviewed source ordinal for a cushion, seat post, sight control, lamp, antenna, exhaust, handle, glazing or guard; no armor wall or protective shield is assigned this role.') => ({role:'decoration',decoration:true,reason});
const number = (feature,re) => {const m=re.exec(feature);return m ? Number(m[1]) : null;};
const sideOf = context => {
  const d=context.declaration||context.d;
  return context.mirrorOrdinal ?? d?.mirrorOrdinal ?? Number(/:mirror:(\d+)$/.exec(d?.sourceKey||'')?.[1]||0);
};
const chooseSide = (context,right,left) => sideOf(context)===1 ? left : right;
function sheet(ref,feature,outer) {
  if (!feature.startsWith('box:')) return null;
  const opposite={'+x':'-x','-x':'+x','+y':'-y','-y':'+y','+z':'-z','-z':'+z'};
  const face=feature.slice(4);
  return armor(ref,face===outer?'outer':face===opposite[outer]?'inner':'reveal');
}
function slab(ref,face) {return armor(ref,face===0?'outer':face===1?'inner':'reveal');}
function meshFace(feature) {return number(feature,/^mesh:face:(\d+)$/);}
function prism(feature,right,left,edges) {
  if(feature.startsWith('prism:right:'))return armor(right);
  if(feature.startsWith('prism:left:'))return armor(left);
  const e=number(feature,/^prism:edge:(\d+)$/);
  return e!==null&&edges[e]?armor(edges[e]):null;
}
function sectionLoft(feature,part,edges,rear,front) {
  const cap=/^loft:cap:([01]):fan:\d+$/.exec(feature);
  if(cap)return armor(cap[1]==='0'?rear:front);
  const m=/^loft:band:(\d+):edge:(\d+)$/.exec(feature);
  return m?edges(Number(m[1]),Number(m[2]),part):null;
}
function openCompartment(feature,inner,refs) {
  const m=/^loft:band:0:edge:(\d+)$/.exec(feature);
  if(!m)return null; // Both source lofts explicitly have caps=false.
  const e=Number(m[1]);
  // Outer comp_ring order begins at starboard/front; reversed inner order
  // begins at the bow. The chamfers belong to the named source wall sectors.
  const outer=[refs.r,refs.rear,refs.rear,refs.rear,refs.l,refs.front,refs.front,refs.front];
  const inside=[refs.front,refs.front,refs.l,refs.rear,refs.rear,refs.rear,refs.r,refs.front];
  return armor((inner?inside:outer)[e],inner?'inner':'outer');
}
const breeches={us_m10:[30],de_pzjg1:[30],de_flakpz38t:[61,62,63],de_hetzer_flak:[33,34,35],de_rso_flak:[42,43,44],de_rso_pak40:[34,36],uk_cmp_portee:[63,64]};
const sleeves={us_m10:[27,28,29,31],de_pzjg1:[31,32,33,34],de_flakpz38t:[64,65,66,67],de_hetzer_flak:[36,37,38,39],de_rso_flak:[45,46,47,48],de_rso_pak40:[35,39,40,41,42],uk_cmp_portee:[66,67,68],xp_w78:[56,57,58,59,60,61,62]};
// These are the gun's mechanical source assemblies, not protective plate
// surfaces. Their damage belongs to the existing main-gun breech owner.
const mechanisms={
  de_flakpz38t:{48:'fixed cylindrical gun pedestal',49:'pedestal foot flange',50:'rotating gun turntable',51:'mirrored elevation cradle forks',52:'cradle front crossmember'},
  de_hetzer_flak:{20:'fixed cylindrical gun pedestal',21:'pedestal foot flange',22:'rotating gun turntable',23:'mirrored elevation cradle forks',24:'cradle front crossmember',46:'flak38 elevation pins'},
  de_rso_flak:{28:'gun bed mounting crossmember',29:'gun bed longitudinal mount',30:'fixed cylindrical gun pedestal',31:'rotating gun turntable',32:'mirrored elevation cradle forks',33:'cradle front crossmember',55:'flak38 elevation pins'},
  de_rso_pak40:{29:'gun pedestal foot',30:'rotating gun turntable',31:'central gun carriage support',48:'PaK40 elevation fork',49:'PaK40 elevation pins'},
  uk_cmp_portee:{58:'gun carriage axle crossmember',60:'mirrored gun carriage trails',61:'central gun carriage support'},
};
// Explicit source fittings: cushions/posts, sight controls, lamps, antennas,
// exhausts, handles and guards. These are not armor walls or shields.
const fittings={
  us_m10:[2,19,20,21,22,32],
  de_pzjg1:[9,10,11,12,13,14,21,22,23,24,25,26,27,28,35],
  de_flakpz38t:[12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,35,37,38,39,40,42,43,44,45,46,47,53,54,55,56,57,58,59,68,69,70,71,72,73,74,75,76,77,78],
  de_hetzer_flak:[6,7,8,9,12,13,14,15,16,17,18,19,25,26,27,28,29,30,31,40,41,42,43,44,45,47,48,49,50],
  de_rso_flak:[2,3,4,5,6,7,8,9,10,11,12,17,18,19,20,21,23,24,25,26,27,34,35,36,37,38,39,40,49,50,51,52,53,54,56,57],
  de_rso_pak40:[2,3,4,5,6,7,8,9,10,11,12,17,18,19,20,21,25,26,27,28,33,37,38,44,45,46,47,48,49],
  uk_cmp_portee:[3,4,6,11,12,13,14,17,18,19,20,21,22,23,24,25,26,27,28,36,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,59,65,69,70,71,72],
  xp_w78:[11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,33,34,35,36,37,41,42,43,44,45,46,47,48,49,50,51,52,53,54,63],
};
export const coverageGaps = Object.freeze({
  us_m10:['Turret floor/underside has no separate registered authored floor plate. Counterweights and turret bearing ring retain unsupported resistance.'],
  de_pzjg1:['Raised crew deck part8 and mantlet part29 need separate source engineering review.'],
  de_flakpz38t:['Raised fighting-compartment floor3 has no separate registered authored floor datum; keep unsupported.'],
  de_hetzer_flak:['Gun shield mesh32 has no authored shield armor reference; keep unsupported rather than invent or remove protection.'],
  de_rso_flak:['Raised deck/floor parts1/13, front bed bulkhead16 and cab bottom lack separate authored datums; keep unsupported.'],
  de_rso_pak40:['Raised deck/floor parts1/13, front bed bulkhead16 and cab floor lack separate authored datums; keep unsupported.'],
  uk_cmp_portee:['Chassis members, bonnet underside/closure and cab floor10 lack separate authored datums; keep unsupported.'],
  xp_w78:['Glazed driver cab part10 and turret underside retain unsupported resistance; full underside is not a covered hull mating joint.'],
});

/** Returns an existing authored armor/module association or explicit fitting. */
export function review(specId,ordinal,feature,part,context={}) {
  if(!reviewedSpecs.includes(specId))return null;
  if(mechanisms[specId]?.[ordinal])return module('breech',`${specId} visual source part ${ordinal}: ${mechanisms[specId][ordinal]}; explicit main-gun mechanical assembly, with existing breech module damage response and no authored armor wall.`);
  if(breeches[specId]?.includes(ordinal))return module('breech');
  if(sleeves[specId]?.includes(ordinal))return module('gun_barrel');
  if(fittings[specId]?.includes(ordinal))return decoration();
  if(specId==='us_m10') {
    if(ordinal===0)return prism(feature,'hull_side_r','hull_side_l',['hull_floor','hull_lower_front','hull_lower_front','hull_lower_front','hull_lower_front','hull_upper_front','hull_roof','hull_rear','hull_rear']);
    if(ordinal===17) {
      // This bottom feature also spans the exposed sponson undersides. It
      // cannot be declared wholly nonarmoring from the lower hull overlap.
      return prism(feature,'hull_side_r','hull_side_l',[null,'hull_upper_front','hull_roof','hull_rear','hull_rear']);
    }
    if(ordinal===24) {
      const e=number(feature,/^plan:(?:edge|inner|rim):(\d+)$/);
      if(e!==null)return armor(['turret_front','turret_side_r','turret_side_r','turret_rear','turret_side_l','turret_side_l'][e],feature.startsWith('plan:inner:')?'inner':feature.startsWith('plan:rim:')?'reveal':'outer');
    }
    if(ordinal===26)return sheet('gun_mantlet',feature,'+z');
    if(ordinal===18)return sheet('hull_roof',feature,'+y');
    if(ordinal===1||ordinal>=3&&ordinal<=16)return module(chooseSide(context,'track_r','track_l'));
  }
  if(specId==='de_pzjg1') {
    if(ordinal===0)return sectionLoft(feature,part,(b,e)=>armor(e===0||e===11?'hull_floor':e>=1&&e<=4?'hull_side_r':e>=7&&e<=10?'hull_side_l':b>=4?'hull_upper_front':'hull_roof'),'hull_rear','hull_lower_front');
    if(ordinal>=1&&ordinal<=7) {const f=meshFace(feature);if(f!==null)return slab([null,'turret_side_r','turret_rear','turret_rear','turret_side_l','turret_front','turret_front','turret_front'][ordinal],f);}
    if(ordinal>=15&&ordinal<=20)return module(chooseSide(context,'track_r','track_l'));
  }
  if(specId==='de_flakpz38t') {
    if(ordinal===0)return sectionLoft(feature,part,(b,e)=>armor(e===0||e===11?'hull_floor':e>=1&&e<=4?'hull_side_r':e>=7&&e<=10?'hull_side_l':b>=4?'hull_upper_front':'hull_roof'),'hull_rear','hull_lower_front');
    if(ordinal===1||ordinal===2)return openCompartment(feature,ordinal===2,{r:'comp_side_r',l:'comp_side_l',rear:'comp_rear',front:'comp_front'});
    if(ordinal>=4&&ordinal<=11) {const f=meshFace(feature);if(f!==null)return slab(`flap_board_${ordinal-4}_tri_0`,f);}
    if(ordinal===60) {const f=meshFace(feature);if(f!==null)return slab('gun_shield',f%6);}
    if(ordinal===33||ordinal===34||ordinal===36)return sheet('hull_roof',feature,'+y');
    if(ordinal===32||ordinal===41)return module(chooseSide(context,'track_r','track_l'));
  }
  if(specId==='de_hetzer_flak') {
    if(ordinal===0)return sectionLoft(feature,part,(b,e)=>{
      if(e===0||e===9)return armor(b===0?'hull_rear_lower':b>=2?'hull_lower_front':'hull_floor');
      return armor(({1:'hull_lower_side_r',2:'hull_sponson_r',3:'hull_sponson_r',4:'hull_side_r',5:'hull_side_l',6:'hull_sponson_l',7:'hull_sponson_l',8:'hull_lower_side_l'})[e]);
    },'hull_rear','hull_lower_front');
    if(ordinal===1||ordinal===2)return openCompartment(feature,ordinal===2,{r:'hull_side_r',l:'hull_side_l',rear:'hull_rear',front:'hull_upper_front'});
    if(ordinal===3||ordinal===10||ordinal===11)return module(chooseSide(context,'track_r','track_l'));
    // mesh32 is a real protective shield, but acceptedAnatomy has no shield.
    if(ordinal===32)return null;
  }
  if(specId==='de_rso_flak'||specId==='de_rso_pak40') {
    if(ordinal===0)return prism(feature,'hull_side_r','hull_side_l',['hull_floor','hull_front','hull_front',null,'hull_rear','hull_rear']);
    if(ordinal===14)return sheet(chooseSide(context,'bed_side_r','bed_side_l'),feature,'+x');
    if(ordinal===15)return sheet('bed_rear',feature,'-z');
    if(specId==='de_rso_flak') {
      if(ordinal===22)return prism(feature,'cab_side_r','cab_side_l',[null,'cab_front','cab_front','cab_front','cab_front','cab_front','cab_roof','cab_roof','cab_rear',null]);
      if(ordinal===41) {const f=meshFace(feature);if(f!==null)return slab('gun_shield',f%6);}
    } else {
      if(ordinal===22) {
        const f=meshFace(feature);if(f===null)return null;
        if(f<7)return slab('cab_side_r',f);
        if(f<14)return slab('cab_side_l',f-7);
        if(f<20)return slab('cab_lower_front',f-14);
        if(f<26)return slab('cab_upper_front',f-20);
        if(f<32)return slab('cab_rear',f-26);
        if(f>=38)return slab(`cab_roof_cell_${Math.floor((f-38)/6)}`, (f-38)%6);
      }
      if(ordinal===23||ordinal===24)return sheet(`cab_driving_lid_${ordinal-23}`,feature,'+y');
      if(ordinal===32) {const f=meshFace(feature);if(f!==null)return slab(f<6?'shield_front':f<12?'shield_r':f<18?'shield_front':'shield_l',f%6);}
      if(ordinal===43)return module(chooseSide(context,'ammo_r','ammo_l'));
    }
  }
  if(specId==='uk_cmp_portee') {
    if(ordinal===5)return prism(feature,'bonnet_side_r','bonnet_side_l',[null,'bonnet_front','bonnet_top','bonnet_top','bonnet_top','bonnet_top','bonnet_top',null]);
    if(ordinal===7)return prism(feature,'cab_side_r','cab_side_r',['cab_side_r','cab_side_r','cab_side_r','cab_side_r']);
    if(ordinal===8)return prism(feature,'cab_side_l','cab_side_l',['cab_side_l','cab_side_l','cab_side_l','cab_side_l']);
    if(ordinal===9)return sheet('cab_back',feature,'-z');
    if(ordinal===30)return sheet('bed_floor',feature,'+y');
    if(ordinal===37)return sheet(chooseSide(context,'bin_r','bin_l'),feature,'+x');
    if(ordinal===38)return sheet('tailboard',feature,'-z');
    if(ordinal===29)return module('ammo_ready');
    if(ordinal===35)return module(chooseSide(context,'fuel_tank','ammo_l'));
    if(ordinal===62) {const f=meshFace(feature);if(f!==null)return slab(f%24<12?'gun_shield':'gun_shield_top',f%6);}
    if(ordinal===15||ordinal===16)return module(ordinal===15?'wheels_r':'wheels_l');
  }
  if(specId==='xp_w78') {
    if(ordinal===9)return module('turret_drive','W78 visual source part9 is the turret bearing collar connecting the rotating turret to the hull; its existing turret_drive module owns the mechanical response, without a new armor datum.');
    if(ordinal===0)return sectionLoft(feature,part,(b,e)=>{
      if(e===0||e===13)return armor(b>=24?'hull_lower_front':'hull_floor');
      if(e>=1&&e<=3)return armor('hull_lower_side_r');
      if(e>=10&&e<=12)return armor('hull_lower_side_l');
      if(e===4)return armor('hull_side_r');if(e===9)return armor('hull_side_l');
      return armor(b>=13?'hull_glacis':'hull_roof');
    },'hull_rear','hull_nose');
    if(ordinal===1)return sectionLoft(feature,part,(b,e)=>{
      if(e===3||e===4)return armor(b>=3?'turret_front_upper':'turret_roof');
      if(e===1||e===2)return armor(b>=3?'turret_cheek_r':'turret_side_r');
      if(e===5||e===6)return armor(b>=3?'turret_cheek_l':'turret_side_l');
      return null;
    },'turret_rear','turret_front');
    if(ordinal===55)return sheet('turret_front',feature,'+z');
    if(ordinal===31||ordinal===32)return sheet('hull_roof',feature,'+y');
    if(ordinal===38)return sheet('hull_rear',feature,'-z');
    if(ordinal===39||ordinal===40)return sheet('turret_roof',feature,'+y');
    if(ordinal>=3&&ordinal<=8)return module('transmission');
  }
  return null;
}

// First-party T-72A obr 1979 construction. Writes only this vehicle and its named rounds.
// Measurements/provenance: docs/t72a-autoloader-research-2026-10-12.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureCatalog } from '../client/web/tools/measure-mg-damage.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))), id='su_t72a';
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');};
const v3=a=>({x:a[0],y:a[1],z:a[2]});
const box=(name,size,pos,mount='hull',mat='paint',extra={})=>({name,type:'box',mount,mat,size,pos,...extra});
const cyl=(name,r,len,pos,axis='y',mount='hull',mat='paint',extra={})=>({name,type:'cyl',mount,mat,r,len,pos,axis,segs:18,...extra});
const ring=(y,rx,rz,cz=.18)=>Array.from({length:32},(_,i)=>{const a=2*Math.PI*i/32;return [Number((rx*Math.sin(a)).toFixed(4)),y,Number((cz+rz*Math.cos(a)).toFixed(4))];});
const module=(id,kind,c,he,hp,extra={})=>({id,kind,center:v3(c),half_extents:v3(he),max_health:hp,health:hp,...extra});
const plate=(id,zone,mm,c,n,u,hu,hv)=>({id,zone,material:'rha',thickness_mm:mm,center:v3(c),normal:v3(n),axis_u:v3(u),half_u:hu,half_v:hv});
const ammo=['apfsds_125_3bm22','heatfs_125_3bk14','he_125_3of26'];
const dir=path.join(root,'data/vehicles',id);
write(path.join(dir,'vehicle.json'),{
  id,name:'T-72A (1979)',schema_version:1,model:'procedural',
  meta:{nation:'ussr',class:'medium',year:1979,outline:'dimensions',based_on:'T-72A obr 1979, 2A46-1 and fitted AZ carousel',
    notes:'First-party procedural reconstruction. 22 mechanized projectile/charge sets including chambered round; the 22 nonmechanized reserve sets of the reported 44 are not carried in this implementation. Dimensions, crew and engine follow public references; contours, interior, simplified armor, drivetrain and ballistics estimates are documented in docs/t72a-autoloader-research-2026-10-12.json. No ERA or ATGM.'},
  files:{armor:'armor.json',weapons:'weapons.json',engine:'engine.json',crew:'crew.json',modules:'modules.json',visual:'visual.json'},
  hull:{size_m:[3.6,1.5,6.86],mass_kg:41500,center_of_mass:[0,.95,-.08]},
  turret:{size_m:[2.82,.59,3.0],ring_diameter_m:2.16,position_m:[0,1.5,.18]},
  physics:{track_width_m:.58,track_length_m:4.27,suspension:{kind:'torsion_bar',travel_m:.23,stiffness:330000,damping:25000},
    rolling_resistance:.04,sprocket_radius_m:.32,drivetrain_efficiency:.84,max_brake_decel_ms2:6,max_turn_rate_deg_s:32,max_reverse_speed_ms:5/3.6,min_turn_radius_m:1.51}
});
write(path.join(dir,'weapons.json'),{
  main_gun:{id:'2a46_1_125',caliber_mm:125,barrel_length_mm:6000,recoil_mm:310,rounds_per_min:7.5,reload_s:8,
    traverse_deg_s:18,elevate_deg_s:6,max_depression_deg:6,max_elevation_deg:13,dispersion_mrad:.7,mass_kg:2500,ammo,ammo_count:[8,6,8]},
  mount_m:[0,1.86,1.15],muzzle_offset_m:4.95,rack_m:[0,.78,.18],loaders_m:[],stabilizer:'two_plane',
  mechanized_loading:{mechanism:'az_t72',gun_id:'2a46_1_125',ammo,capacity:22,cycle_s:8,modules:['az_drive','az_ram'],
    stages:[{stage:'select_lift',at:0},{stage:'projectile_ram',at:.32},{stage:'charge_ram',at:.61}]},
  damage:{critical:['breech','gun_barrel'],traverse:['turret_drive'],elevation:['elevation_drive'],ammo_racks:['az_carousel']},
  sight:{name:'TPD-K1',levels:[{magnification:8,fov_deg:9}],rangefinder:{kind:'laser',time_s:1,error_pct:.2,max_range_m:4000}},
  secondary:[{id:'coax_pkt',weapon:'pkt',mount:'coax',position_m:[.27,1.86,1.65]},
    {id:'aa_nsvt',weapon:'nsvt',mount:'pintle',position_m:[.68,2.4,-.1],post_m:.31}]
});
write(path.join(dir,'engine.json'),{
  engine:{horsepower:780,max_rpm:2000,idle_rpm:600,weight_kg:1100,torque_curve:[[600,2300],[1000,2900],[1400,3089],[1800,2900],[2000,2778]]},
  transmission:{forward_gears:7,reverse_gears:1,gear_ratios:[8.713,4.4,3.1,2.25,1.65,1.18,.9],final_drive_ratio:4.02,shift_time_s:.45}
});
write(path.join(dir,'crew.json'),[
  {role:'driver',pos:v3([0,1.02,2.12]),radius:.25,health:100},
  {role:'gunner',pos:v3([-.62,1.62,.58]),radius:.25,health:100},
  {role:'commander',pos:v3([.68,1.78,-.15]),radius:.25,health:100}
]);
write(path.join(dir,'modules.json'),[
  module('engine','engine',[0,.98,-2.15],[.82,.36,.46],150),
  module('transmission','transmission',[0,.86,-2.95],[.72,.28,.3],120),
  module('fuel_tank','fuel_tank',[.7,.93,1.75],[.34,.28,.56],50),
  module('az_carousel','ammo_rack',[0,.73,.18],[1.01,.2,1.01],100,{rounds:22,weapon_group:'gun:0:0'}),
  // Existing drive module kinds are an adapter for physical mechanism damage, not laying.
  // Explicit traverse/elevation refs exclude these from turret actuation.
  module('az_drive','horizontal_drive',[.85,1.11,-.52],[.16,.15,.23],70,{weapon_group:'mechanism:az_t72'}),
  module('az_ram','vertical_drive',[0,1.35,-.3],[.18,.16,.42],70,{weapon_group:'mechanism:az_t72'}),
  module('breech','gun_breech',[0,1.86,.62],[.24,.23,.43],110,{weapon_group:'gun:0:0',turret_index:0}),
  module('gun_barrel','gun_barrel',[0,1.86,3.97],[.08,.08,2.13],140,{weapon_group:'gun:0:0',turret_index:0}),
  module('turret_drive','turret_drive',[-.82,1.47,.2],[.13,.12,.18],70,{weapon_group:'turret:0',turret_index:0}),
  module('elevation_drive','vertical_drive',[.39,1.76,.88],[.11,.14,.18],70,{weapon_group:'gun:0:0',turret_index:0}),
  module('radio','radio',[.85,1.65,-.42],[.12,.15,.2],40),
  module('track_l','track',[-1.395,.48,0],[.29,.48,3.1],120),module('track_r','track',[1.395,.48,0],[.29,.48,3.1],120)
]);
// Scalar RHA adapter plates do not reproduce the real laminate armor layers.
write(path.join(dir,'armor.json'),[
  plate('hull_glacis','hull_upper_front',200,[0,.95,3.12],[0,.8,.6],[1,0,0],1.11,.65),
  plate('hull_lower','hull_lower_front',80,[0,.55,3.02],[0,-.6,.8],[1,0,0],1.06,.3),
  plate('hull_side_l','hull_side',80,[-1.13,.96,0],[-1,0,0],[0,0,1],3.0,.54),
  plate('hull_side_r','hull_side',80,[1.13,.96,0],[1,0,0],[0,0,1],3.0,.54),
  plate('hull_rear','hull_rear',45,[0,.91,-3.4],[0,0,-1],[1,0,0],1.12,.48),
  plate('hull_roof','hull_roof',30,[0,1.49,0],[0,1,0],[1,0,0],1.12,2.91),
  plate('hull_floor','hull_floor',20,[0,.4,0],[0,-1,0],[1,0,0],1.05,2.8),
  plate('turret_front','turret_front',280,[0,1.79,1.48],[0,.26,.966],[1,0,0],1.2,.29),
  plate('turret_side_l','turret_side',120,[-1.32,1.79,.12],[-1,0,0],[0,0,1],1.05,.28),
  plate('turret_side_r','turret_side',120,[1.32,1.79,.12],[1,0,0],[0,0,1],1.05,.28),
  plate('turret_rear','turret_rear',65,[0,1.79,-1.26],[0,0,-1],[1,0,0],1.05,.27),
  plate('turret_roof','turret_roof',30,[0,2.085,.12],[0,1,0],[1,0,0],1.0,1.0),
  plate('gun_mantlet','gun_mantlet',200,[0,1.86,1.54],[0,0,1],[1,0,0],.35,.27)
]);
const parts=[
  {name:'t72a_welded_hull',type:'prism',mount:'hull',mat:'paint',w:2.28,profile:[[-3.43,.4],[-3.43,1.4],[-1.55,1.5],[2.55,1.5],[3.43,.82],[3.1,.4]]},
  box('t72a_fender',[.61,.045,6.25],[1.465,1.19,-.1],'hull','paint',{mirror:true}),
  box('t72a_rubber_skirt',[.025,.48,5.95],[1.787,1.0,-.2],'hull','rubber',{mirror:true}),
  box('t72a_engine_grille',[1.84,.035,1.08],[0,1.51,-2.55],'hull','paint_dark'),
  box('t72a_driver_hatch',[.58,.055,.55],[0,1.51,2.12],'hull','paint'),
  cyl('t72a_turret_ring',1.08,.1,[0,1.49,.18],'y','hull','paint_dark'),
  {name:'t72a_cast_turret',type:'loft',mount:'turret',mat:'paint',crease:70,rings:[ring(1.5,1.33,1.38),ring(1.63,1.41,1.5),ring(1.88,1.28,1.37),ring(2.03,1.03,1.13),ring(2.09,.81,.89)]},
  cyl('t72a_commander_hatch',.3,.09,[.68,2.135,-.15],'y','turret','paint'),
  cyl('t72a_gunner_hatch',.3,.06,[-.62,2.12,-.17],'y','turret','paint'),
  box('t72a_tpd_k1_head',[.26,.16,.31],[-.51,2.08,.55],'turret','paint_dark'),
  cyl('t72a_ir_searchlight',.18,.16,[.67,1.97,1.43],'z','turret','paint_dark'),
  cyl('t72a_ir_lens',.155,.01,[.67,1.97,1.515],'z','turret','glass'),
  box('t72a_mantlet',[.68,.49,.44],[0,1.86,1.47],'gun','paint'),
  cyl('t72a_recoil_sleeve',.15,.46,[0,1.86,1.86],'z','gun','paint'),
  cyl('t72a_barrel',.095,4.08,[0,1.86,4.06],'z','gun','steel',{recoil:true}),
  cyl('t72a_thermal_cover',.115,2.15,[0,1.86,3.12],'z','gun','paint',{recoil:true}),
  cyl('t72a_bore_evacuator',.175,.58,[0,1.86,4.27],'z','gun','paint',{recoil:true}),
  cyl('t72a_thermal_forward',.106,1.14,[0,1.86,5.13],'z','gun','paint',{recoil:true}),
  cyl('t72a_muzzle_collar',.101,.12,[0,1.86,6.04],'z','gun','steel',{recoil:true}),
  cyl('t72a_antenna_base',.045,.11,[.87,2.09,-.58],'y','turret','paint_dark'),
  cyl('t72a_antenna',.007,.9,[.87,2.595,-.58],'y','turret','black',{segs:6}),
  cyl('t72a_rear_fuel_drum',.275,1.1,[.58,.9,-3.62],'x','hull','paint',{mirror:true}),
  box('t72a_rear_drum_bracket',[.14,.12,.42],[.58,.6,-3.41],'hull','paint_dark',{mirror:true})
];
for(let i=0;i<6;i++) parts.push(cyl('t72a_smoke_discharge_'+i,.037,.19,[-.52-i*.13,1.82,1.4-i*.075],'z','turret','paint_dark',{rot:[-15,0,0],mirror:true}));
write(path.join(dir,'visual.json'),{
  schema_version:1,palette:{paint:'#59664b',paint_dark:'#3f4b36',steel:'#686d62',rubber:'#252a24',track:'#53574c',black:'#141713'},parts,
  running_gear:{track_width:.58,track_thickness:.06,track_x:1.395,link_pitch:.137,link_style:'center_guide',track_sag:.035,
    sprocket:{z:-2.83,y:.72,r:.32,teeth:14},idler:{z:2.82,y:.79,r:.29},
    wheels:[2.02,1.21,.4,-.41,-1.22,-2.03].map(z=>({z,y:.46,r:.375,w:.35,x:0})),
    rollers:[1.65,0,-1.65].map(z=>({z,y:1.01,r:.11,w:.13})),wheel_style:'rubber_dish'},
  mg_anchors:{coax_pkt:'turret',aa_nsvt:'turret'},exhaust:{fuel:'diesel',outlets:[{pos:[-1.16,1.12,-2.35],dir:[-1,.05,-.1]}]}
});
const common={explosive_type:'none',penetrator_material:'steel',drag_coefficient:.3,normalization_deg:0,shatter_angle_deg:90,fuse_delay_s:0,fuse_sensitivity_mm:0};
const shells=[
  {id:ammo[0],name:'125 mm 3BM-22 (APFSDS)',kind:'apfsds',caliber_mm:44,mass_kg:4.83,muzzle_velocity_ms:1760,explosive_mass_kg:0,
    length_mm:453,penetration_curve:[{distance_m:0,pen_mm:420},{distance_m:1000,pen_mm:385},{distance_m:2000,pen_mm:350},{distance_m:3000,pen_mm:315}],ricochet_angle_deg:78},
  {id:ammo[1],name:'125 mm 3BK-14 (HEAT-FS)',kind:'heat_fs',caliber_mm:125,mass_kg:19.02,muzzle_velocity_ms:905,explosive_mass_kg:1.85,
    explosive_type:'okfol',length_mm:677,penetration_curve:[{distance_m:0,pen_mm:450},{distance_m:3000,pen_mm:450}],ricochet_angle_deg:80},
  {id:ammo[2],name:'125 mm 3OF-26 (HE-FRAG)',kind:'he',caliber_mm:125,mass_kg:23.2,muzzle_velocity_ms:850,explosive_mass_kg:3.34,
    explosive_type:'a_ix_2',length_mm:675,penetration_curve:[{distance_m:0,pen_mm:35},{distance_m:3000,pen_mm:35}],ricochet_angle_deg:85}
];
for(const shell of shells) write(path.join(root,'data/projectiles',shell.id+'.json'),{...common,...shell,
  provenance:{document:'docs/t72a-autoloader-research-2026-10-12.json',calibration:'Nominal ammunition reconstruction; penetration/drag/fuse/ricochet are engineering estimates, not historical firing-test certification.'}});
const mgFile=path.join(root,'data/machine_guns.json'),mgSource=fs.readFileSync(mgFile,'utf8'),mgs=JSON.parse(mgSource),added=[];
// Reuse only compatible cartridge metrics; new identities are not aliases for the old weapons.
for(const [newId,sourceId,name,rpm] of [['pkt','sgmt','PKT (7.62 mm)',800],['nsvt','dshk','NSVT (12.7 mm)',700]]) {
  if(mgs.some(m=>m.id===newId)) continue;
  const original=mgs.find(m=>m.id===sourceId),copy=structuredClone(original);
  delete copy.damage_geometry;
  added.push({...copy,id:newId,name,rate_rpm:rpm});
}
if(added.length) {
  const end=mgSource.lastIndexOf(']');
  fs.writeFileSync(mgFile,mgSource.slice(0,end).trimEnd()+',\n'+measureCatalog(added,{}).map(m=>JSON.stringify(m,null,1).split('\n').map(line=>' '+line).join('\n')).join(',\n')+'\n'+mgSource.slice(end));
}
console.log('Built first-party su_t72a, three compatible 125 mm rounds and independent PKT/NSVT definitions.');

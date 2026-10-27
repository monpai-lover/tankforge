// A fuze record for the CURRENT resolved segment, not a new penetration model.
// Armable contacts must carry measured plating thickness in millimetres. Damage
// multipliers, part-box dimensions and unknown aircraft skins cannot arm APHE.
function aircraftProjectileMechanism(shell) {
  const fill=shell?.explosive_mass_kg,kind=String(shell?.kind||'').toLowerCase();
  if(!(typeof fill==='number'&&Number.isFinite(fill)&&fill>0))return 'kinetic';
  if(['ap','aphe','apc','apbc','apcbc'].includes(kind))return 'delayed_aphe';
  return ['he','hesh','heat','heat_fs'].includes(kind)?'immediate_he':'kinetic';
}
function resolveAircraftProjectileFuze(shell,options) {
  if(!shell)return null;
  const mechanism=aircraftProjectileMechanism(shell),result={mechanism,fuze_status:'not_applicable',limitation:null,bursts:[]};
  if(mechanism==='kinetic')return result;
  const {a,b}=options,entry=Number.isFinite(options.contactT)?Math.max(0,Math.min(1,options.contactT)):0;
  const time=Number.isFinite(options.time_s)?options.time_s:0,speed=options.speedMS;
  const validPath=Array.isArray(a)&&Array.isArray(b)&&a.length===3&&b.length===3&&a.every(Number.isFinite)&&b.every(Number.isFinite);
  const length=validPath?Math.hypot(...b.map((v,k)=>v-a[k])):0,duration=Number.isFinite(speed)&&speed>0?length/speed:0;
  const burst=(t,armedAt,delay)=>({point:a.map((v,k)=>v+(b[k]-v)*t),time_s:time+t*duration,armed_at_s:armedAt,delay_s:delay,
    detonation_id:options.detonation_id??null,mechanism,explosive_kg:shell.explosive_mass_kg,
    tnt_equivalent_kg:Number.isFinite(options.tntKg)&&options.tntKg>=0?options.tntKg:shell.explosive_mass_kg});
  if(mechanism==='immediate_he'){
    if(!validPath){result.limitation='resolved_segment_unrecorded';return result;}
    result.fuze_status='contact_detonated';result.bursts.push(burst(entry,time+entry*duration,0));return result;
  }
  result.fuze_status='unarmed';
  const contacts=(options.armableContacts||[]).filter(c=>Number.isFinite(c?.t)&&c.t>=entry&&c.t<=1&&typeof c.thickness_mm==='number'&&Number.isFinite(c.thickness_mm)&&c.thickness_mm>=0);
  if(!contacts.length){result.limitation='arming_contact_thickness_unrecorded';return result;}
  const sensitivity=shell.fuse_sensitivity_mm;
  if(!(typeof sensitivity==='number'&&Number.isFinite(sensitivity)&&sensitivity>=0)){result.limitation='fuze_sensitivity_unrecorded';return result;}
  const contact=contacts.filter(c=>c.thickness_mm>=sensitivity).sort((x,y)=>x.t-y.t)[0];
  if(!contact){result.limitation='below_fuze_sensitivity';return result;}
  const delay=shell.fuse_delay_s;
  if(!(typeof delay==='number'&&Number.isFinite(delay)&&delay>=0)){result.limitation='fuze_delay_unrecorded';return result;}
  result.armed_at_s=time+contact.t*duration;result.delay_s=delay;
  if(!validPath||!(duration>0)){
    result.fuze_status='armed_continuation_unresolved';result.limitation='resolved_segment_timing_unrecorded';return result;
  }
  const t=contact.t+delay/duration;
  if(t>1){result.fuze_status='armed_continuation_unresolved';result.limitation='resolved_segment_ends_before_delay';return result;}
  result.fuze_status='detonated';result.bursts.push(burst(t,result.armed_at_s,delay));return result;
}

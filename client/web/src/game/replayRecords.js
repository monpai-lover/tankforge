// V3 replay_core.c sample/tail/hold/style adaptation.
// Copyright (c) 2026 Replay Lab Contributors (MIT). See the complete supplied notice.
// Inputs are actual records. This owner neither integrates flight nor resolves damage.
import {projectileProfile} from './projectileVisuals.js';
import {bulletShell} from './combat.js';
const v=p=>Array.isArray(p)?p.slice(0,3):p?[p.x,p.y,p.z]:null;
const valid=p=>p?.length===3&&p.every(Number.isFinite);
const clamp=x=>Math.max(0,Math.min(1,x));
const mix=(a,b,k)=>a.map((x,i)=>x+(b[i]-x)*k);
const len=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]));
const norm=a=>{const n=Math.hypot(...a)||1;return a.map(x=>x/n);};
const freeze=o=>{if(o&&typeof o==='object'){for(const x of Object.values(o))freeze(x);Object.freeze(o);}return o;};
const seed=id=>{let n=2166136261;for(const c of String(id))n=Math.imul(n^c.charCodeAt(0),16777619);return(n>>>0)/4294967296;};
const world=(pose,p,origin)=>p.map((_,k)=>pose.hull_origin[k]-origin[k]+pose.ex[k]*p[0]+pose.ey[k]*p[1]+pose.ez[k]*p[2]);
const vector=(pose,p)=>p.map((_,k)=>pose.ex[k]*p[0]+pose.ey[k]*p[1]+pose.ez[k]*p[2]);
const kind=f=>f.kind==='jet'?2:f.kind==='shell'?3:f.kind==='spall'?1:f.kind==='burst'?4:0;

/** Convert each event's hull frame once into the fixed session space. */
export function prepareReplayEvent(evidence,catalog,originFrame=[0,0,0],epoch=0){
  if(!evidence?.report||!evidence.accepted_pose)throw new TypeError('recorded replay requires source report and accepted pose');
  const e=structuredClone(evidence),rep=e.report,pose=e.accepted_pose,origin=Array.isArray(originFrame)?originFrame:originFrame.origin;
  if(!valid(origin)||!['hull_origin','ex','ey','ez'].every(k=>valid(pose[k]))||!Number.isFinite(epoch))throw new TypeError('invalid replay coordinate frame');
  const contact=e.impact_time_s-epoch,launch=e.launch_time_s-epoch;
  const flight=(e.segments||[]).filter(s=>Number.isFinite(s.start_time_s)&&Number.isFinite(s.end_time_s)&&s.end_time_s>s.start_time_s&&valid(s.from)&&valid(s.to)).map(s=>({start_s:s.start_time_s-epoch,end_s:s.end_time_s-epoch,from:s.from.map((x,i)=>x-origin[i]),to:s.to.map((x,i)=>x-origin[i])}));
  const events=rep.impact_events||[],core=events.filter(i=>i.entry?.body_id==='core');
  const first=core.find(i=>Number.isFinite(i.entry?.elapsed_s))||events.find(i=>Number.isFinite(i.time_s));
  const coreContact=first?.entry?.elapsed_s??first?.time_s,coreEpoch=Number.isFinite(coreContact)?contact-coreContact:null;
  const W=p=>world(pose,v(p),origin),traces=[],unknown=[];
  for(const i of events){
    if(!valid(v(i.entry_position))||!valid(v(i.exit_position)))continue;
    const a=i.entry?.elapsed_s??i.time_s,b=i.output?.elapsed_s;
    if(coreEpoch===null||!Number.isFinite(a)||!Number.isFinite(b)||b<a)continue;
    traces.push({id:i.event_id,eventId:e.event_id,from:W(i.entry_position),to:W(i.exit_position),start_s:coreEpoch+a,end_s:coreEpoch+b,kind:i.entry?.body_id==='core'?3:1,energy:clamp((i.budget?.core_out_j??i.budget?.input_j??0)/Math.max(1,i.budget?.input_j??1)),seed:seed(i.event_id),hit:i.layer_id,body:i.entry?.body_id==='core',verdict:i.verdict});
  }
  for(const f of rep.fragments||[]){
    if(!valid(v(f.from))||!valid(v(f.to)))continue;
    const velocity=v(f.physical?.velocity_m_s),speed=valid(velocity)?Math.hypot(...velocity):0,distance=len(v(f.from),v(f.to)),id=f.fragment_id||`${e.event_id}:fragment:${traces.length+unknown.length}`;
    const row={id,eventId:e.event_id,from:W(f.from),to:W(f.to),kind:kind(f),energy:clamp(f.weight??1),seed:seed(id),hit:f.hit,body:f.kind==='shell',verdict:f.hit?'deposited':null};
    if(coreEpoch!==null&&Number.isFinite(f.start_s)&&speed>0)traces.push({...row,start_s:coreEpoch+f.start_s,end_s:coreEpoch+f.start_s+distance/speed});
    else unknown.push({...row,start_s:null,end_s:null});
  }
  const mgId=e.projectile_id?.replace(/^bullet_/,''),mg=catalog?.machineGuns?.[mgId];
  const shell=catalog?.projectiles?.[e.projectile_id]||(mg?{...bulletShell(mg),kind:'mg'}:null)||e.presentation_shell||null;
  const missile=Object.values(catalog?.missiles||{}).find(d=>d.warhead===e.projectile_id&&flight.length);
  const profile=shell?projectileProfile(shell,missile||null):null;
  const family=(shell?.kind||rep.shell_kind||'unknown').toLowerCase().replace('heat-fs','heat_fs'),kinetic=['ap','apcbc','aphe','apcr','apds','apfsds','mg'].includes(family),limitations=[];
  if(!kinetic){
    limitations.push('chemical_body_continuation_unrecorded');
    for(let i=traces.length-1;i>=0;i--)if(traces[i].body){const row=traces.splice(i,1)[0];unknown.push({...row,body:false,start_s:null,end_s:null});}
  }
  if(events.some(i=>i.entry?.charge?.disposition==='pending_p3'||i.entry?.fuse==='unresolved_legacy'))limitations.push('fuze_pending_p3');
  if(rep.bursts?.length)limitations.push('burst_timing_unrecorded');
  const entry=valid(v(rep.impact))?W(rep.impact):pose.hull_origin.map((x,i)=>x-origin[i]);
  const direction=norm(vector(pose,v(first?.entry?.velocity_m_s)||v(rep.shot?.dir)||[0,0,1]));
  const physicalEnd=Math.max(contact,...traces.map(t=>t.end_s),...(e.deaths||[]).map(d=>d.time_s-epoch),...(e.mechanism_records||[]).map(r=>r.time_s-epoch));
  // The camera's source phase is easing only; every physical anchor is recorded.
  const mechanism_anchors=physicalEnd>contact?[{phase_s:2.48,time_s:physicalEnd}]:[];
  return freeze({id:e.event_id,shot_id:e.shot_id,actor:e.actor,evidence:e,profile,limitations,entry,direction,launch_s:flight.length?launch:contact,contact_s:contact,physicalEnd,mechanism_anchors,flight,flightTiming:flight.length?'recorded':'unknown',omittedFlight:e.segment_compacted_count||0,traces,unknown,coreEpoch,epoch,origin:origin.slice()});
}

/** Source sample() style: physical travel plus short tails/hold; decorative fading only. */
export function samplePreparedReplay(event,physicalS){
  if(!Number.isFinite(physicalS))throw new RangeError('invalid recorded replay sample time');
  const traces=[];
  for(const r of event.traces){
    const age=physicalS-r.start_s,travel=r.end_s-r.start_s,life=r.kind===4?.35:3.3;if(age<0||age>travel+life)continue;
    const progress=clamp(age/Math.max(travel,.001));let tail=clamp((age-(r.kind===2?.24:.105))/Math.max(travel,.001));
    const hold=clamp((age-travel)/Math.max(life,.01));if(age>=travel)tail=0;
    const color=r.kind===0?[.94,.38+r.energy*.25,.005]:r.kind===1?[.96,.026+r.seed*.1,.008]:r.kind===2?[.018,.88,1]:r.kind===3?[.40,.92,1]:[.96,.43,.028];
    let alpha=(1-hold)*(.43+.43*r.energy);if(age>=travel)alpha*=r.kind===2?.48:.32;
    traces.push({...r,head:mix(r.from,r.to,progress),tail:mix(r.from,r.to,tail),color,alpha,width:r.kind===2?1.75:r.kind===3?1.3:.62,arrived:physicalS>=r.end_s});
  }
  const sweep=event.flight.find(s=>physicalS>=s.start_s&&physicalS<=s.end_s);
  const projectile={timing:'unknown',visible:false,nose:event.entry.slice(),tangent:event.direction.slice(),stage:'intact',eventId:event.id,profile:event.profile};
  if(sweep){projectile.timing='recorded';projectile.visible=!!event.profile;projectile.nose=mix(sweep.from,sweep.to,clamp((physicalS-sweep.start_s)/(sweep.end_s-sweep.start_s)));projectile.tangent=norm(sweep.to.map((x,i)=>x-sweep.from[i]));}
  const body=event.traces.find(t=>t.body&&physicalS>=t.start_s&&physicalS<t.end_s);
  if(physicalS>=event.contact_s&&body&&event.profile){projectile.timing='recorded';projectile.visible=true;projectile.nose=mix(body.from,body.to,clamp((physicalS-body.start_s)/(body.end_s-body.start_s)));projectile.tangent=norm(body.to.map((x,i)=>x-body.from[i]));}
  // A native stopped record may have zero travel duration. Hold its actual endpoint;
  // this is presentation persistence, with no incoming or continued flight implied.
  const stop=!body&&event.traces.find(t=>t.body&&t.verdict==='stopped'&&physicalS>=t.end_s&&physicalS<t.end_s+3.3);
  if(stop&&event.profile){projectile.timing='recorded';projectile.visible=true;projectile.holdingStopped=true;projectile.nose=stop.to.slice();}
  if(event.evidence.authority==='analysis'&&physicalS>=event.contact_s&&event.profile){projectile.visible=true;projectile.referenceOnly=true;}
  // A stop/detonation/unknown continuation does not carry an intact body through the cabin.
  return {eventId:event.id,physicalS,projectile,traces,staticTraces:physicalS>=event.contact_s?event.unknown:[],arrived:physicalS>=event.contact_s};
}

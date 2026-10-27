// Extend the installed supplied-V3 replay. Its cameras, source renderer, source
// materials, body-stage records and per-event clocks remain the active owners.
function createRecordedApheReplay({prepare,sample}) {
  const point=p=>Array.isArray(p)?p.slice(0,3):p?[p.x,p.y,p.z]:null;
  const valid=p=>p?.length===3&&p.every(Number.isFinite);
  const freeze=o=>{if(o&&typeof o==='object'&&!Object.isFrozen(o)){for(const v of Object.values(o))freeze(v);Object.freeze(o);}return o;};
  function prepareEvent(...args) {
    const base=prepare(...args),raw=base.evidence,report=raw.report,bursts=[],bad=[];
    const pos=p=>base.origin.map((o,k)=>raw.accepted_pose.hull_origin[k]-o+raw.accepted_pose.ex[k]*p[0]+raw.accepted_pose.ey[k]*p[1]+raw.accepted_pose.ez[k]*p[2]);
    for(const b of report.bursts||[]){
      if(b.mechanism!=='delayed_aphe')continue;
      const p=point(b.pos);
      if(base.coreEpoch===null||!Number.isFinite(b.time_s)||b.time_s<0||!valid(p)||!(b.explosive_kg>0)||!Number.isFinite(b.radius)||b.radius<0||typeof b.detonation_id!=='string'||!b.detonation_id){bad.push(b);continue;}
      const time=base.coreEpoch+b.time_s;
      if(time<base.contact_s){bad.push(b);continue;}
      bursts.push({id:`${raw.event_id}:${b.detonation_id}`,eventId:raw.event_id,time_s:time,position:pos(p),radius:b.radius,explosiveKg:b.explosive_kg,inside:!!b.inside,mechanism:b.mechanism});
    }
    const stopped=new Set((report.impact_events||[]).filter(i=>i.entry?.body_id==='core'&&(i.verdict==='stopped'||i.output?.remaining_pen_mm===0&&valid(point(i.output?.velocity_m_s))&&Math.hypot(...point(i.output.velocity_m_s))<1e-6)).map(i=>i.event_id));
    const traces=base.traces.map(t=>stopped.has(t.id)?{...t,stopped:true}:t),limitations=base.limitations.slice();
    if(bursts.length&&!bad.length&&bursts.length===(report.bursts||[]).length){const at=limitations.indexOf('burst_timing_unrecorded');if(at>=0)limitations.splice(at,1);}
    if(bad.length&&!limitations.includes('burst_timing_unrecorded'))limitations.push('burst_timing_unrecorded');
    const physicalEnd=Math.max(base.physicalEnd,...bursts.map(b=>b.time_s));
    const anchors=base.mechanism_anchors.slice();
    if(physicalEnd>base.physicalEnd){if(anchors.length)anchors[anchors.length-1]={...anchors.at(-1),time_s:physicalEnd};else anchors.push({phase_s:2.48,time_s:physicalEnd});}
    return freeze({...base,traces,bursts,limitations,physicalEnd,mechanism_anchors:anchors});
  }
  function sampleEvent(event,physicalS) {
    const base=sample(event,physicalS),projectile={...base.projectile},bursts=[];
    const stop=event.traces.find(t=>t.body&&t.stopped&&physicalS>=t.end_s&&physicalS<t.end_s+3.3);
    if(stop&&event.profile&&physicalS>=event.contact_s){projectile.visible=true;projectile.holdingStopped=true;projectile.timing='recorded';projectile.nose=stop.to.slice();}
    for(const b of event.bursts||[]){
      const age=physicalS-b.time_s;if(age<0||age>.42)continue;
      const phase=Math.min(1,age/.42),radius=Math.min(1.6,Math.max(.12,b.radius*.42))*(.22+.78*Math.sqrt(Math.min(1,age/.09)));
      bursts.push({...b,age,radius,alpha:(1-phase)**2});
    }
    if(event.bursts?.some(b=>physicalS>=b.time_s))projectile.visible=false;
    return {...base,projectile,bursts};
  }
  return {prepare:prepareEvent,sample:sampleEvent};
}

function packRecordedReplayBursts(instances,words,frame,count,dynamicCount,max=4096) {
  const rows=(frame.bursts||[]).slice(0,64),kept=Math.min(count,max-rows.length),droppedTraceCount=count-kept;
  count=kept;dynamicCount=Math.min(dynamicCount,kept);
  for(const b of rows){
    if(!b.position?.every(Number.isFinite)||!(b.radius>0)||!Number.isFinite(b.age)||!Number.isFinite(b.alpha))throw Error('invalid recorded detonation display');
    const at=count++*words;
    for(let k=0;k<3;k++)instances[at+k]=b.position[k];
    instances[at+3]=b.radius;instances[at+4]=b.age;instances[at+5]=b.inside?1:0;
    instances[at+6]=1;instances[at+7]=.54;instances[at+8]=.12;instances[at+9]=b.alpha;instances[at+10]=1;instances[at+11]=5;
    if(words>12)instances[at+12]=0;
  }
  return {count,dynamicCount,burstCount:rows.length,droppedTraceCount};
}

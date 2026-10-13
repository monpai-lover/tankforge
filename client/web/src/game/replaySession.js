// The single bounded display/clock owner; authority state is read, never mutated here.
import {prepareReplayEvent,samplePreparedReplay} from './projectileReplay.js';
import {createReplayClockForEvent} from './replayClock.js';
import {camera,hitCamera} from './replayCamera.js';
import {ReplayCoverage,validateReplayEvidence,validateReplayCommit,validateReplayCheckpoint} from './replayEvidence.js';
const key=e=>e?.actor?`${e.actor.battle}:${e.actor.entity}:${e.actor.life}|${e.build_hash}|${e.anatomy_hash}`:null;
const own=v=>structuredClone(v);
const freeze=v=>{if(v&&typeof v==='object'){for(const q of Object.values(v))freeze(q);Object.freeze(v);}return v;};
const visibleEnd=e=>e.physicalEnd+3.3;
const summaryOf=e=>freeze({...e,summary:true,traces:e.traces.filter(t=>t.body),unknown:e.unknown.filter(t=>t.kind===3),evidence:{event_id:e.id,authority:e.evidence.authority,commit_seq:e.evidence.commit_seq,state_after_version:e.evidence.state_after_version,accepted_pose:e.evidence.accepted_pose,report:{state:e.evidence.report.state,modules:e.evidence.report.modules,crew:e.evidence.report.crew},mechanism_records:[],deaths:[]}});
export function createReplaySession(renderer,target,evidence,purpose='offensive',options={}){return new ReplaySession(renderer,target,evidence,purpose,options);}
class ReplaySession{
  constructor(renderer,target,evidence,purpose,options){
    this.renderer=renderer;this.target=target;this.purpose=purpose;this.catalog=options.catalog;this.origin=options.origin||[0,0,0];this.identity=key(evidence);this.actor={...evidence.actor};this.options=options;
    this.coverage=new ReplayCoverage();this.coverage.admit(this.actor);this.events=[];this.summaries=[];this.decorativeAggregated=0;this.summaryPressure=false;this.commits=[];this.pinned=null;this.fatal=null;this.filmTimeS=0;this.finished=false;this.finishReason=null;this.frame=null;this.frameId=null;this.aggregated=0;this.retiredThrough=0;this.sparseRetired=new Map();this.lastArrivedState=null;
    const first=prepareReplayEvent(evidence,this.catalog,this.origin);this.clock=createReplayClockForEvent(first);this.endFilm=0;if(!this.append(evidence).accepted)throw Error('initial replay evidence rejected');
  }
  append(raw){
    if(this.finished||key(raw)!==this.identity)return {accepted:false,reason:'incompatible_session'};
    const presentation=raw.authority==='analysis';let e,result,staged=null;
    if(presentation){e=freeze(own(raw));const known=this.events.find(q=>q.id===e.event_id);result={fresh:!known,terminal:!!e.deaths?.length&&!this.fatal,source_status:known?'duplicate':'presented'};}
    else {const v=validateReplayEvidence(raw,this.actor);if(!v.ok)return {accepted:false,reason:v.reason};e=v.evidence;staged=this.coverage.stage();result=staged.evidence(e);if(!result)return {accepted:false,reason:'conflicting_source'};}
    const previous=[...this.events,...this.summaries,this.pinned,this.fatal].find(q=>q?.id===e.event_id),knownMechanisms=new Set(previous?.evidence.mechanism_records?.map(r=>r.event_id)||[]);
    if(!result.fresh&&!result.terminal&&!e.mechanism_records?.some(r=>!knownMechanisms.has(r.event_id)))return {accepted:false,duplicate:true,reason:result.source_status};
    const physical=this.clock.physicalAt(this.filmTimeS),reserve=result.terminal||e.report.state?.active_fire_cause?.source_event_id===e.event_id;
    const summaries=this.summaries.filter(q=>visibleEnd(q)>physical),ordinaryFull=this.events.length>=64&&!this.events.some(q=>q!==this.pinned&&q!==this.fatal&&visibleEnd(q)<=physical);
    if(!previous&&!reserve&&ordinaryFull&&summaries.length>=64){this.summaryPressure=true;this.options.onPressure?.();return {accepted:false,reason:'summary_pressure'};}
    let event,sourceClock;try{event=prepareReplayEvent(e,this.catalog,this.origin);sourceClock=createReplayClockForEvent(event);
      const filmSpanS=Math.max(1.8,sourceClock.knots.at(-1)[0]);
      this.clock.appendPhysicalAnchors([event.contact_s,event.physicalEnd,...event.mechanism_anchors.map(a=>a.time_s)],{filmSpanS,reserve:result.terminal});
    }catch{return {accepted:false,reason:'invalid_physical_records'};}
    if(staged)this.coverage.publish(staged);
    const late=event.contact_s<this.clock.physicalAt(this.filmTimeS);
    this.summaries=summaries;const summaryAt=this.summaries.findIndex(q=>q.id===event.id);if(summaryAt>=0)this.summaries.splice(summaryAt,1);
    const i=this.events.findIndex(q=>q.id===event.id);if(i>=0)this.events[i]=event;else if((result.fresh||result.terminal)&&!(reserve&&this.events.length>=64))this.events.push(event);
    if(e.report.state?.active_fire_cause?.source_event_id===e.event_id)this.pinned=event;
    if(result.terminal)this.fatal=event;
    while(this.events.length>64){let at=this.events.findIndex(q=>q!==this.pinned&&q!==this.fatal&&visibleEnd(q)<=physical);const completed=at>=0;if(at<0)at=this.events.findIndex(q=>q!==this.pinned&&q!==this.fatal);if(at<0)break;const old=this.events.splice(at,1)[0];if(!completed){const summary=summaryOf(old);this.summaries.push(summary);this.decorativeAggregated+=old.traces.length-summary.traces.length+old.unknown.length-summary.unknown.length;}this.aggregated++;}
    this.endFilm=Math.max(this.endFilm,this.clock.filmAt(event.physicalEnd),this.filmTimeS);
    return {accepted:true,duplicate:false,late,terminal:result.terminal,source_status:result.source_status,aggregated:this.aggregated};
  }
  commit(c){
    if(this.finished||!validateReplayCommit(c,this.actor)||c.record.time_s<0)return false;const staged=this.coverage.stage(),apply=staged.commit(c);if(apply===null)return false;
    this.clock.appendPhysicalAnchors([c.record.time_s],{filmSpanS:3.6});
    this.coverage.publish(staged);if(!this.commits.some(q=>q.record.event_id===c.record.event_id)){this.commits.push(freeze(own(c)));if(this.commits.length>64)this.commits.shift();}
    this.endFilm=Math.max(this.endFilm,this.clock.filmAt(c.record.time_s));return true;
  }
  checkpoint(c){
    if(this.finished||!validateReplayCheckpoint(c,this.actor)||c.incoming.some(e=>key(e)!==this.identity))return false;
    const staged=this.coverage.stage();if(staged.preflight({checkpoint:c}))return false;
    for(const e of c.incoming){try{createReplayClockForEvent(prepareReplayEvent(e,this.catalog,this.origin));}catch{return false;}if(!staged.evidence(e))return false;}
    if(!staged.checkpoint(c))return false;
    const candidate=Object.assign(Object.create(Object.getPrototypeOf(this)),this,{coverage:this.coverage.stage(),clock:this.clock.stage(),events:this.events.slice(),summaries:this.summaries.slice(),options:{...this.options,onPressure:()=>{}}});
    for(const e of c.incoming){const r=candidate.append(e);if(!r.accepted&&!r.duplicate){this.options.onPressure?.();return false;}}
    this.clock.publish(candidate.clock);this.coverage.publish(staged);for(const field of ['events','summaries','pinned','fatal','endFilm','aggregated','decorativeAggregated','summaryPressure'])this[field]=candidate[field];return true;
  }
  promoteVictim(death){if(this.finished)return false;if(death&&this.fatal?.evidence.deaths.some(d=>d.event_id===death.event_id))this.purpose='victim';return this.purpose==='victim';}
  tick(dt){if(this.finished||!Number.isFinite(dt)||dt<0)return;this.filmTimeS+=dt;this.clock.markPlayed(this.filmTimeS);if(this.filmTimeS>this.endFilm+1.5)this.finish('tail_complete');}
  _retire(seq,id){if(seq<=this.retiredThrough)return;if(this.sparseRetired.size>=64&&seq!==this.retiredThrough+1){this.options.onPressure?.();return;}this.sparseRetired.set(seq,id);while(this.sparseRetired.has(this.retiredThrough+1)){this.sparseRetired.delete(++this.retiredThrough);}}
  prepareFrame(frameId,filmTimeS=this.filmTimeS){
    if(this.frameId===frameId&&this.frame)return this.frame;if(this.finished)return null;
    if(this.purpose!=='analysis'&&filmTimeS<this.filmTimeS)throw new RangeError('session frame cannot rewind');
    if(this.purpose==='analysis'&&filmTimeS<(this.lastSampleFilm??0))this.lastArrivedState=null;
    this.lastSampleFilm=filmTimeS;this.filmTimeS=filmTimeS;if(this.purpose!=='analysis')this.clock.markPlayed(filmTimeS);const physicalS=this.clock.physicalAt(filmTimeS);
    this.summaries=this.summaries.filter(e=>visibleEnd(e)>physicalS);
    const events=[...new Set([this.fatal,this.pinned,...this.events,...this.summaries].filter(Boolean))],samples=events.map(e=>samplePreparedReplay(e,physicalS));
    let state=this.lastArrivedState,version=state?.version??-1,selected=this.fatal&&this.purpose==='victim'?this.fatal:this.events.at(-1),pose=null,poseVersion=-1;
    const admit=(v,s,time)=>{if(time<=physicalS&&v>version){version=v;state={version:v,state:s};}};
    for(const e of events){
      const raw=e.evidence;if(e.contact_s<=physicalS){admit(raw.state_after_version,raw.report.state,e.contact_s);if(raw.commit_seq>poseVersion){poseVersion=raw.commit_seq;pose=raw.accepted_pose;}if(e.physicalEnd<=physicalS)this._retire(raw.commit_seq,raw.event_id);}
      for(const r of raw.mechanism_records||[]){admit(r.state_after_version,r.state_after,r.time_s);if(r.time_s<=physicalS)this._retire(r.commit_seq,r.event_id);}
      for(const d of raw.deaths||[]){admit(d.state_after_version,d.state_after,d.time_s);if(d.time_s<=physicalS)this._retire(d.commit_seq,d.event_id);}
    }
    for(const c of this.commits){admit(c.record.state_after_version,c.record.state_after,c.record.time_s);if(c.record.time_s<=physicalS)this._retire(c.record.commit_seq,c.record.event_id);}
    if(state){this.lastArrivedState=state;if(this.pinned&&state.version>=this.pinned.evidence.state_after_version&&!state.state?.active_fire_cause){this.pinned=null;this.coverage.pinned=null;}}
    const all=samples.flatMap(s=>s.traces),traces=all.slice(0,4096),staticTraces=samples.flatMap(s=>s.staticTraces).slice(0,Math.max(0,4096-traces.length)),bodies=samples.map(s=>s.projectile).filter(p=>p.visible),projectiles=bodies.slice(0,64),bodySummaries=bodies.slice(64),sample=samples.find(s=>s.eventId===selected?.id)||samples.at(-1);
    const records=events.filter(e=>e.contact_s<=physicalS).sort((a,b)=>a.evidence.commit_seq-b.evidence.commit_seq);
    this.frame=freeze({id:frameId,filmTimeS,physicalS,event:selected,records,projectile:sample?.projectile,projectiles,bodySummaries,bodyBudgetOverflow:bodySummaries.length,traces,staticTraces,arrivals:traces.filter(t=>t.arrived&&t.hit),state:state?.state??null,stateVersion:version,acceptedPose:pose,poseVersion,sourceEventId:this.fatal?.id??this.pinned?.id??selected?.id,terminalEventId:this.fatal?.evidence.deaths.at(-1)?.event_id??null,aggregated:this.aggregated+this.decorativeAggregated+Math.max(0,all.length-4096)});this.frameId=frameId;return this.frame;
  }
  camera(frame,rect,purpose=this.purpose){const fn=purpose==='corner'||purpose==='offensive'?hitCamera:camera,cam=fn(frame.physicalS,rect,{hullBounds:this.target.hullBounds,event:frame.event,frame,heavy:frame.event?.profile?.family==='he',sideEntry:Math.abs(frame.event?.direction[0]||0)>.7});const tanY=Math.tan(cam.fov*Math.PI/360);return {...cam,pos:cam.eye,tanY,tanX:tanY*rect[2]/rect[3]};}
  hasPinnedCause(id){return this.pinned?.id===id||this.fatal?.id===id;}
  diagnostics(){const clock=this.clock.diagnostics();return {events:this.events.length,summaryEvents:this.summaries.length,summaryPressure:this.summaryPressure,decorativeAggregated:this.decorativeAggregated,bodyBudgetOverflow:this.frame?.bodyBudgetOverflow||0,clockKnots:clock.knots,clockProtectedTails:clock.protectedTails,clockProtectedKnots:clock.protectedKnots,clockAnchorOverflow:clock.anchorOverflow,clockPressure:clock.pressure,clockEasingFallback:clock.easingFallback,slots:(this.frame?.traces.length||0)+(this.frame?.staticTraces.length||0),mechanismNodes:Math.min(16,this.pinned?.evidence.mechanism_records?.length||this.fatal?.evidence.mechanism_records?.length||0),aggregated:this.aggregated+this.decorativeAggregated,filmTimeS:this.filmTimeS,physicalTimeS:this.clock.physicalAt(this.filmTimeS),targetSnapshots:1,retiredThrough:this.retiredThrough,sparseRetiredCount:this.sparseRetired.size,coveragePressure:this.coverage.pressure};}
  finish(reason='finished'){if(this.finished)return;this.finished=true;this.finishReason=reason;this.options.draw?.dispose();this.target.dispose?.();this.events.length=this.summaries.length=0;this.commits.length=0;this.pinned=this.fatal=null;this.frame=null;this.options.onFinish?.(reason);}
}

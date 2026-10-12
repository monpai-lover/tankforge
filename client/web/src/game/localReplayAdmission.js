// The first and sole offline battle/life admission owner. Online projects OnlineAmmo instead.
import {replayActorEqual,replayActorKey,validateReplayEvidence} from './replayEvidence.js';
const clone=v=>structuredClone(v);
const next=n=>{if(!Number.isSafeInteger(n)||n>=Number.MAX_SAFE_INTEGER)throw Error('Local replay counter exhausted');return n+1;};
export class LocalReplayAdmission {
  constructor(){this.battleSerial=0;this.retire();}
  retire(){this.actors=new Map();this.keys=new Map();this.histories=new Map();this.discharges=new Map();this.dischargeTargets=new WeakMap();this.projectileSources=new WeakMap();this.stateBindings=new WeakMap();this.eventSerial=0;this.dischargeSerial=0;this.active=false;}
  begin(entities){
    if(this.active)throw Error('Local sortie already admitted');
    if(!Array.isArray(entities)||entities.some(e=>!Number.isSafeInteger(e.entity)||e.entity<=0||typeof e.key!=='string')||new Set(entities.map(e=>e.entity)).size!==entities.length)throw Error('Invalid local actors');
    this.retire();this.battleSerial=next(this.battleSerial);this.active=true;
    for(const {entity,key}of entities){this.actors.set(entity,Object.freeze({battle:this.battleSerial,entity,life:1}));this.keys.set(key,entity);}
  }
  actor(entity){const a=this.actors.get(entity);return a?{...a}:null;}
  actorForKey(key){return this.actor(this.keys.get(key));}
  bindState(key,state){const a=this.actorForKey(key);if(a&&state&&typeof state==='object'){this.stateBindings.set(state,a);return true;}return false;}
  ownsState(key,state){return !!state&&replayActorEqual(this.actorForKey(key),this.stateBindings.get(state));}
  replace(entity,key){
    const old=this.actors.get(entity);if(!old)return false;
    const a=Object.freeze({...old,life:next(old.life)});
    this.actors.set(entity,a);for(const [k,e]of this.keys)if(e===entity)this.keys.delete(k);this.keys.set(key,entity);
    this.histories.delete(replayActorKey(old));
    for(const [id,d]of this.discharges)if(replayActorEqual(d.shooter,old))this.discharges.delete(id);
    return true;
  }
  acceptDischarge(entity,{weapon_instance,projectile_id,seed,time_s,origin,direction,flight_trust='unknown_cannon_flight'}){
    const shooter=this.actor(entity);if(!shooter)return null;
    const seedText=typeof seed==='bigint'?seed.toString():String(seed);
    if(!/^(0|[1-9][0-9]{0,19})$/.test(seedText)||BigInt(seedText)>18446744073709551615n||!Number.isFinite(time_s))throw Error('Invalid admitted discharge');
    this.dischargeSerial=next(this.dischargeSerial);
    const d={shooter,shot_id:`${shooter.battle}:${entity}:${shooter.life}:${this.dischargeSerial}`,weapon_instance,projectile_id,seed:seedText,launch_time_s:time_s,origin:origin.slice(),direction:direction.slice(),flight:[],segments:[],flight_trust};
    this.dischargeTargets.set(d,new Map(this.actors));this.discharges.set(d.shot_id,d);if(this.discharges.size>256)this.discharges.delete(this.discharges.keys().next().value);return d;
  }
  // The bounded projectile owner, rather than the recent replay cache, owns eligibility
  // until contact delivery. The weak lease adds no independently retained source history.
  retainProjectile(source){
    if(!source||this.discharges.get(source.shot_id)!==source||!replayActorEqual(this.actor(source.shooter.entity),source.shooter)||source.flight_trust!=='missile_world_segments_legacy_contact'||this.projectileSources.has(source))return null;
    Object.freeze(source.shooter);Object.freeze(source.origin);Object.freeze(source.direction);
    for(const key of ['shooter','shot_id','weapon_instance','projectile_id','seed','launch_time_s','origin','direction','flight_trust'])Object.defineProperty(source,key,{writable:false,configurable:false});
    const leases=this.projectileSources,discharges=this.discharges;
    const lease=Object.freeze({release:()=>{if(leases.get(source)!==lease)return;leases.delete(source);if(discharges.get(source.shot_id)===source)discharges.delete(source.shot_id);}});
    leases.set(source,lease);return lease;
  }
  _history(a){const k=replayActorKey(a);if(!this.histories.has(k))this.histories.set(k,{version:0,recent:[],pinned:null,fatal:null,consumed:new WeakSet()});return this.histories.get(k);}
  prepare(key,source,pose,time_s,state){
    const actor=this.actorForKey(key);
    if(!actor||!this.ownsState(key,state)||!source||(this.discharges.get(source.shot_id)!==source&&!this.projectileSources.has(source))||!replayActorEqual(this.actor(source.shooter.entity),source.shooter)||!replayActorEqual(this.dischargeTargets.get(source)?.get(actor.entity),actor))return null;
    const h=this._history(actor);if(h.consumed.has(source))return null;
    this.eventSerial=next(this.eventSerial);
    return {actor,source,pose:clone(pose),time_s,event_id:`local:${actor.battle}:${this.eventSerial}`,before_version:h.version,context:{actor,shooter:source.shooter,event_id:`local:${actor.battle}:${this.eventSerial}`,shot_id:source.shot_id,pose_revision:0,geometry_revision:0}};
  }
  commit(prepared,before,report,replayCapable=true){
    if(!prepared||!replayActorEqual(this.actor(prepared.actor.entity),prepared.actor))return null;
    const {actor,source,pose,time_s,event_id,before_version}=prepared,h=this._history(actor);
    if(h.version!==before_version||h.consumed.has(source))throw Error('Conflicting local combat transaction');
    h.version=next(h.version);h.consumed.add(source);this.stateBindings.set(report.state,actor);
    if(!replayCapable)return null;
    const e={authority:'offline',revision:1,actor,shooter:clone(source.shooter),event_id,commit_seq:h.version,shot_id:source.shot_id,parent_mechanism_id:null,weapon_instance:source.weapon_instance,projectile_id:source.projectile_id,seed:source.seed,build_hash:'legacy:unverified_build',anatomy_hash:'legacy:unverified_anatomy',pose_revision:0,geometry_revision:0,state_before_version:before_version,state_after_version:h.version,state_before:clone(before),launch_time_s:source.launch_time_s,impact_time_s:time_s,coordinates:'target_hull_metres',accepted_pose:pose,flight:clone(source.flight),segments:clone(source.segments),flight_trust:source.flight_trust,flight_compacted_count:source.flight_compacted_count||0,segment_compacted_count:source.segment_compacted_count||0,travelled_distance_m:source.travelled_distance_m||0,report:clone(report),deaths:[],mechanism_records:[],mechanism_compaction:null,capabilities:['legacy_receipt_pose','exact_geometry_audit_pending',source.flight_trust]};
    if(report.state.destroyed&&!before.destroyed)e.deaths.push(this._death(e,event_id,h.version,before_version,time_s,report.state,report.caps,pose,report.state.ammo_detonated?'ammo_detonation':'direct',`${event_id}:direct`));
    h.recent.push(e);h.recent=h.recent.filter(q=>time_s-q.impact_time_s<=6).slice(-64);
    if(report.state.active_fire_cause?.source_event_id===event_id)h.pinned=e;
    const validation=validateReplayEvidence(e,actor);if(validation.ok&&e.deaths.length&&!h.fatal)h.fatal=validation.evidence;return validation.ok?validation.evidence:null;
  }
  prepareAdvance(key,state){const actor=this.actorForKey(key);if(!actor||!this.ownsState(key,state))return null;this.eventSerial=next(this.eventSerial);return {key,actor,event_id:`local:${actor.battle}:${this.eventSerial}`,context:{actor,shooter:actor,event_id:`local:${actor.battle}:${this.eventSerial}`,shot_id:'timed_advance',pose_revision:0,geometry_revision:0}};}
  commitAdvance(prepared,before,result,dt,time_s,pose){
    if(!prepared||!replayActorEqual(this.actor(prepared.actor.entity),prepared.actor))return null;
    const h=this._history(prepared.actor),before_version=h.version;h.version=next(h.version);this.stateBindings.set(result.state,prepared.actor);
    const record={event_id:prepared.event_id,commit_seq:h.version,time_s,dt_s:dt,state_before_version:before_version,state_after_version:h.version,state_before:clone(before),state_after:clone(result.state),events:clone(result.events),transitions:clone(result.cause_transitions||[])};
    const e=h.pinned?clone(h.pinned):null;
    if(e){e.mechanism_records.push(record);if(e.mechanism_records.length>16){const old=e.mechanism_records.shift();e.mechanism_compaction={count:(e.mechanism_compaction?.count||0)+1,covered_through:old.commit_seq,state_version:old.state_after_version,state:old.state_after};if(!e.capabilities.includes('mechanism_prefix_compacted'))e.capabilities.push('mechanism_prefix_compacted');}
      if(!before.destroyed&&result.state.destroyed&&result.death_cause?.source_event_id===e.event_id)e.deaths.push(this._death(e,prepared.event_id,h.version,before_version,time_s,result.state,result.caps,pose,result.state.ammo_detonated?'ammo_detonation':'fire',result.death_cause.mechanism_id));
    }
    h.pinned=result.state.active_fire_cause?e:null;
    const validation=e?validateReplayEvidence(e,prepared.actor):null;
    if(validation?.ok&&e.deaths.length&&!h.fatal)h.fatal=validation.evidence;
    return {actor:prepared.actor,record,replay:validation?.ok?validation.evidence:null};
  }
  _death(e,event_id,commit_seq,state_before_version,time_s,state_after,caps_after,pose,reason,mechanism_id){return {event_id,commit_seq,time_s,mechanism_id,cause_event_id:e.event_id,reason,state_before_version,state_after_version:commit_seq,state_after:clone(state_after),caps_after:clone(caps_after),accepted_terminal_pose:pose?clone(pose):null};}
}

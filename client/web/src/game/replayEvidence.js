// Admission, protocol limits and immutable evidence; no renderer or damage calculation.
const uint=n=>Number.isSafeInteger(n)&&n>=0;
const actor=a=>!!a&&uint(a.battle)&&a.battle>0&&uint(a.entity)&&a.entity>0&&a.entity<=0xffffffff&&uint(a.life)&&a.life>0;
const vec3=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const id=s=>typeof s==='string'&&s.length>0&&s.length<=256&&!/[\u0000-\u001f]/.test(s);
const dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const fail=reason=>({ok:false,evidence:null,reason,capabilities:[]});
function owned(value){const result=structuredClone(value);const freeze=v=>{if(v&&typeof v==='object'){for(const q of Object.values(v))freeze(q);Object.freeze(v);}return v;};return freeze(result);}
export function replayActorKey(a){return `${a.battle}:${a.entity}:${a.life}`;}
export function replayActorEqual(a,b){return !!a&&!!b&&a.battle===b.battle&&a.entity===b.entity&&a.life===b.life;}

/** Bounded traversal guards every nested scalar/string before callers obtain render resources. */
function finiteTree(value,{limit=65536,depth=20,scalarBound=Infinity}={}) {
  let left=limit;
  const visit=(v,d)=>{
    if(--left<0||d>depth)return false;
    if(v===null||typeof v==='boolean')return true;
    if(typeof v==='number')return Number.isFinite(v)&&Math.abs(v)<=scalarBound;
    if(typeof v==='string')return v.length<=256&&!/[\u0000-\u001f]/.test(v);
    if(Array.isArray(v))return v.length<=1024&&v.every(q=>visit(q,d+1));
    if(!v||typeof v!=='object'||Object.keys(v).length>128)return false;
    return Object.entries(v).every(([k,q])=>k.length<=128&&k!=='__proto__'&&k!=='constructor'&&visit(q,d+1));
  };
  return visit(value,0);
}
function poseValid(p) {
  if(!p||!['accepted','legacy_receipt_pose'].includes(p.trust)||![p.hull_origin,p.ex,p.ey,p.ez].every(vec3))return false;
  if([p.ex,p.ey,p.ez].some(a=>Math.abs(dot(a,a)-1)>1e-4)||[dot(p.ex,p.ey),dot(p.ex,p.ez),dot(p.ey,p.ez)].some(x=>Math.abs(x)>1e-4)||dot(cross(p.ex,p.ey),p.ez)<0.9999)return false;
  return [['joints',64],['running_gear',1024],['payload',128],['variants',128]].every(([k,n])=>Array.isArray(p[k])&&p[k].length<=n)&&finiteTree(p,{scalarBound:1e6});
}
const listLimit=(raw,key,n)=>raw[key]===undefined||(Array.isArray(raw[key])&&raw[key].length<=n);
function reportValid(r){return !!r&&typeof r==='object'&&!Array.isArray(r)&&!!r.state&&!!r.caps&&[['impact_events',64],['impacts',64],['fragments',256],['segments',256],['arrivals',256],['path',256],['layers',64],['bursts',64],['modules',1024],['crew',64]].every(([k,n])=>listLimit(r,k,n))&&finiteTree(r);}
function recordValid(r){return !!r&&id(r.event_id)&&[r.commit_seq,r.state_before_version,r.state_after_version].every(uint)&&r.commit_seq===r.state_after_version&&r.state_after_version===r.state_before_version+1&&Number.isFinite(r.time_s)&&Number.isFinite(r.dt_s)&&r.dt_s>=0&&r.state_before&&r.state_after&&typeof r.state_after.destroyed==='boolean'&&Array.isArray(r.events)&&r.events.length<=64&&finiteTree(r);}

export function validateReplayEvidence(raw,admittedActor) {
  if(!raw||raw.revision!==1)return fail('unsupported_revision');
  if(!['online','offline'].includes(raw.authority))return fail('unknown_authority');
  if(!actor(admittedActor)||!replayActorEqual(raw.actor,admittedActor))return fail('wrong_actor_or_life');
  if(!actor(raw.actor)||!actor(raw.shooter)||raw.shooter.battle!==raw.actor.battle||![raw.commit_seq,raw.state_before_version,raw.state_after_version,raw.pose_revision,raw.geometry_revision].every(uint))return fail('invalid_identity_or_version');
  if(raw.commit_seq!==raw.state_after_version||raw.state_after_version!==raw.state_before_version+1)return fail('state_regression');
  if(!['event_id','shot_id','weapon_instance','projectile_id','build_hash','anatomy_hash'].every(k=>id(raw[k]))||(raw.parent_mechanism_id!==null&&!id(raw.parent_mechanism_id)))return fail('invalid_string');
  if(typeof raw.seed!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(raw.seed)||BigInt(raw.seed)>18446744073709551615n)return fail('invalid_seed');
  if(raw.coordinates!=='target_hull_metres')return fail('unknown_coordinates');
  if(![raw.launch_time_s,raw.impact_time_s].every(Number.isFinite)||raw.impact_time_s<raw.launch_time_s)return fail('invalid_times');
  if(!poseValid(raw.accepted_pose))return fail('invalid_pose');
  if(!Array.isArray(raw.flight)||raw.flight.length>256)return fail('flight_limit');
  let last=-Infinity;
  for(const q of raw.flight){if(!q||!Number.isFinite(q.time_s)||q.time_s<last||q.time_s<raw.launch_time_s||q.time_s>raw.impact_time_s||!vec3(q.position)||!vec3(q.velocity_m_s))return fail('invalid_flight');last=q.time_s;}
  if(!Array.isArray(raw.segments)||raw.segments.length>256||raw.segments.some(s=>!s||![s.start_time_s,s.end_time_s].every(Number.isFinite)||s.end_time_s<s.start_time_s||s.start_time_s<raw.launch_time_s||s.end_time_s>raw.impact_time_s||!vec3(s.from)||!vec3(s.to)))return fail('invalid_segments');
  if(!['unknown_cannon_flight','missile_world_segments_legacy_contact','unknown_legacy_flight'].includes(raw.flight_trust))return fail('unknown_flight_trust');
  if(!reportValid(raw.report)||!finiteTree(raw.state_before))return fail('missing_or_invalid_report');
  if(!Array.isArray(raw.deaths)||raw.deaths.length>1||raw.deaths.some(d=>!d||!['event_id','mechanism_id','cause_event_id','reason'].every(k=>id(d[k]))||d.cause_event_id!==raw.event_id||![d.commit_seq,d.state_before_version,d.state_after_version].every(uint)||d.commit_seq!==d.state_after_version||d.state_after_version!==d.state_before_version+1||d.commit_seq<raw.commit_seq||!Number.isFinite(d.time_s)||d.time_s<raw.impact_time_s||d.state_after?.destroyed!==true||!finiteTree(d.state_after)||(d.accepted_terminal_pose!==null&&!poseValid(d.accepted_terminal_pose))))return fail('invalid_death');
  if(!Array.isArray(raw.mechanism_records)||raw.mechanism_records.length>16||raw.mechanism_records.some(r=>!recordValid(r)))return fail('invalid_mechanism_records');
  if(raw.mechanism_compaction!==null&&raw.mechanism_compaction!==undefined){const c=raw.mechanism_compaction;if(!c||!uint(c.count)||c.count<1||!uint(c.covered_through)||c.state_version!==c.covered_through||c.covered_through<raw.commit_seq||!c.state||!finiteTree(c))return fail('invalid_mechanism_compaction');}
  if(['flight_compacted_count','segment_compacted_count'].some(k=>raw[k]!==undefined&&!uint(raw[k]))||raw.travelled_distance_m!==undefined&&(!Number.isFinite(raw.travelled_distance_m)||raw.travelled_distance_m<0))return fail('invalid_flight_compaction');
  if(!Array.isArray(raw.capabilities)||raw.capabilities.length>16||!raw.capabilities.every(id)||!finiteTree(raw))return fail('resource_limit');
  const capabilities=raw.accepted_pose.trust==='accepted'?['accepted_pose']:['legacy_receipt_pose'];
  return {ok:true,evidence:owned(raw),reason:null,capabilities:[...capabilities,...raw.capabilities]};
}
export function validateReplayCommit(raw,admittedActor){return actor(admittedActor)&&replayActorEqual(raw?.actor,admittedActor)&&recordValid(raw.record)&&finiteTree(raw)&&(!Object.hasOwn(raw,'caps_after')||finiteTree(raw.caps_after))&&['death_event_id','cause_event_id'].every(k=>raw[k]===undefined||raw[k]===null||id(raw[k]));}
export function validateReplayCheckpoint(raw,admittedActor) {
  if(!actor(admittedActor)||!replayActorEqual(raw?.actor,admittedActor)||![raw.baseline_commit,raw.covered_through,raw.state_version].every(uint)||raw.covered_through<raw.baseline_commit||raw.state_version!==raw.covered_through||!Array.isArray(raw.canonical_identity_binding)||raw.canonical_identity_binding.length>64||raw.canonical_identity_binding.length!==raw.covered_through-raw.baseline_commit||!Array.isArray(raw.active_causes)||raw.active_causes.length>1||!finiteTree(raw))return false;
  return raw.canonical_identity_binding.every((p,i)=>Array.isArray(p)&&p.length===2&&p[0]===raw.baseline_commit+i+1&&id(p[1]))&&raw.active_causes.every(c=>id(c.mechanism_id)&&id(c.source_event_id)&&id(c.source_shot_id)&&actor(c.shooter)&&c.shooter.battle===raw.actor.battle)&&['cause_event_id','death_event_id'].every(k=>raw[k]===null||id(raw[k]))&&typeof raw.replay_available==='boolean'&&Array.isArray(raw.incoming)&&raw.incoming.length<=66&&raw.incoming.every(e=>e.authority==='online'&&validateReplayEvidence(e,admittedActor).ok)&&raw.incoming.every(e=>e.deaths.every(d=>d.event_id===raw.death_event_id&&d.cause_event_id===raw.cause_event_id));
}

// Timed mechanism/death additions do not alter the immutable original source.
function sourceFingerprint(e){return JSON.stringify({...e,deaths:[],mechanism_records:[],mechanism_compaction:null,capabilities:e.capabilities.filter(c=>c!=='mechanism_prefix_compacted')});}

/** Coverage proofs and presentation identities are independent of state delivery order. */
export class ReplayCoverage {
  constructor(){this.reset(null);}
  reset(a){this.actor=a?{...a}:null;this.retiredThrough=0;this.stateVersion=0;this.proofs=new Map();this.bindings=new Map();this.sources=new Map();this.pendingSources=new Map();this.deaths=new Set();this.pinned=null;this.fatal=null;this.pressure=false;this.checkpointRange=null;}
  admit(a){if(!replayActorEqual(a,this.actor))this.reset(a);}
  stage(){return Object.assign(new ReplayCoverage(),this,{actor:this.actor?{...this.actor}:null,proofs:new Map(this.proofs),bindings:new Map(this.bindings),sources:new Map(this.sources),pendingSources:new Map(this.pendingSources),deaths:new Set(this.deaths),checkpointRange:this.checkpointRange?.slice()??null});}
  publish(staged){Object.assign(this,staged);}
  preflight({evidence=null,checkpoint=null,commit=null}={}){
    // All envelope identities are checked together before bounded cache eviction can
    // remove a conflicting identity. Protocol list limits bound this temporary map.
    const identities=new Map(),check=(seq,event)=>{if(identities.has(seq)&&identities.get(seq)!==event)return false;identities.set(seq,event);return true;};
    for(const [seq,event]of [...this.bindings,...this.proofs])if(!check(seq,event))return 'conflicting_commit';
    const fingerprints=new Map(this.sources);
    const source=e=>{
      if(!check(e.commit_seq,e.event_id)||!e.mechanism_records.every(r=>check(r.commit_seq,r.event_id))||!e.deaths.every(d=>check(d.commit_seq,d.event_id)))return false;
      const fingerprint=sourceFingerprint(e),known=fingerprints.get(e.event_id);
      if(known!==undefined&&known!==fingerprint)return false;
      fingerprints.set(e.event_id,fingerprint);return true;
    };
    if(evidence&&!source(evidence))return 'rewritten_source_or_commit';
    if(checkpoint){for(const e of checkpoint.incoming)if(!source(e))return 'rewritten_checkpoint_source';for(const [seq,event]of checkpoint.canonical_identity_binding)if(!check(seq,event))return 'conflicting_checkpoint';}
    if(commit&&!check(commit.record.commit_seq,commit.record.event_id))return 'conflicting_commit';
    return null;
  }
  proof(seq,event){
    if(this.bindings.has(seq)&&this.bindings.get(seq)!==event||this.proofs.has(seq)&&this.proofs.get(seq)!==event)return false;
    this.bindings.set(seq,event);while(this.bindings.size>64)this.bindings.delete(Math.min(...this.bindings.keys()));
    if(seq<=this.retiredThrough)return true;
    if(seq===this.retiredThrough+1){this.retiredThrough++;while(this.proofs.has(this.retiredThrough+1)){this.proofs.delete(++this.retiredThrough);}return true;}
    if(!this.proofs.has(seq)&&this.proofs.size>=64){this.pressure=true;return true;}
    this.proofs.set(seq,event);
    while(this.proofs.has(this.retiredThrough+1)){this.proofs.delete(++this.retiredThrough);}
    return true;
  }
  commit(c){
    const {commit_seq:seq,event_id:event}=c.record,covered=seq<=this.retiredThrough||this.proofs.has(seq);
    if(!this.proof(seq,event))return null;
    // A first state header may precede its source. Retain an explicit bounded exception;
    // repeated headers or evicted fingerprints must never manufacture a new exception.
    if(!covered&&(seq<=this.retiredThrough||this.proofs.has(seq))&&!this.sources.has(event)){
      this.pendingSources.set(seq,event);while(this.pendingSources.size>64)this.pendingSources.delete(Math.min(...this.pendingSources.keys()));
    }
    const apply=seq>this.stateVersion;if(apply)this.stateVersion=seq;return apply;
  }
  evidence(e){
    const staged=this.stage();if(staged.preflight({evidence:e}))return null;
    const result=staged._evidence(e);if(result)this.publish(staged);return result;
  }
  _evidence(e){
    const fingerprint=sourceFingerprint(e),known=this.sources.get(e.event_id);
    if(known&&known!==fingerprint)return null;
    const prefix=e.commit_seq<=this.retiredThrough,sparse=this.proofs.has(e.commit_seq),pending=this.pendingSources.get(e.commit_seq)===e.event_id;
    if(!this.proof(e.commit_seq,e.event_id))return null;
    const tracked=e.commit_seq<=this.retiredThrough||this.proofs.has(e.commit_seq);
    const fresh=!known&&(pending||!prefix&&!sparse&&tracked);
    const source_status=known?'duplicate':fresh?(pending?'pending_source':'presented'):prefix?'covered_prefix':sparse?'covered_sparse':'coverage_pressure';
    this.pendingSources.delete(e.commit_seq);
    const pinned=e.report.state.active_fire_cause?.source_event_id===e.event_id;
    if(pinned)this.pinned=e;
    let terminal=false;for(const d of e.deaths){if(!this.proof(d.commit_seq,d.event_id)||this.deaths.size&&!this.deaths.has(d.event_id))return null;if(!this.deaths.has(d.event_id)){terminal=true;this.deaths.add(d.event_id);this.fatal=e;}}
    if(fresh||known||pinned||terminal)this.sources.set(e.event_id,fingerprint);
    while(this.sources.size>64){const key=[...this.sources.keys()].find(k=>k!==this.pinned?.event_id&&k!==this.fatal?.event_id);if(key===undefined)break;this.sources.delete(key);}
    return {fresh,terminal,source_status};
  }
  checkpoint(c){
    const staged=this.stage();if(staged.preflight({checkpoint:c}))return false;
    if(!staged._checkpoint(c))return false;this.publish(staged);return true;
  }
  _checkpoint(c){
    for(const [seq,event] of c.canonical_identity_binding)if(this.proofs.has(seq)&&this.proofs.get(seq)!==event)return false;
    this.checkpointRange=[c.baseline_commit+1,c.covered_through];
    // A represented suffix never proves an earlier unseen prefix.
    for(const [seq,event]of c.canonical_identity_binding)if(!this.proof(seq,event))return false;
    this.pressure=this.proofs.size>=64;return true;
  }
  snapshot(){return {actor:this.actor,retired_through:this.retiredThrough,state_version:this.stateVersion,gaps:[...this.proofs.keys()].sort((a,b)=>a-b),checkpoint_range:this.checkpointRange,checkpoint_required:this.pressure};}
}
export const ownReplayValue=owned;
export const replayValueValid=finiteTree;

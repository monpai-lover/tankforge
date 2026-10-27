// Native CM inventory and release acceptance own gameplay. This adapter sends
// scoped intent and projects accepted state; its visual pool never enters the
// legacy airBots flare/chaff lists or any seeker/hit/damage path.
function createFrontlineCountermeasureControl({send,scope,now,control,reason,onRelease=()=>{}}={}) {
  for(const f of [send,scope,now,control,reason,onRelease])if(typeof f!=='function')throw Error('Native CM callbacks required');
  const programs=['both','flares','chaff'];
  const key=r=>r&&[r.battle,r.unit,r.life].every(v=>Number.isSafeInteger(v)&&v>0)?`${r.battle}:${r.unit}:${r.life}`:null;
  const uint=v=>Number.isSafeInteger(v)&&v>=0;
  const valid=c=>c&&uint(c.flares)&&uint(c.chaff)&&uint(c.max?.flares)&&uint(c.max?.chaff)&&c.flares<=c.max.flares&&c.chaff<=c.max.chaff&&uint(c.release_seq)&&Number.isFinite(c.cooldown_remaining_s)&&c.cooldown_remaining_s>=0;
  let life=null,epoch=null,lastTick=-1,lastAir=null,accepted=null;
  function empty(air){if(!air)return;air.cm={flares:0,chaff:0,max:{flares:0,chaff:0}};const cm=control(air)?.cm;if(cm){cm.periodic=false;cm.readyAt=0;}}
  function clear(){empty(lastAir);life=null;epoch=null;lastTick=-1;lastAir=null;accepted=null;}
  function accept(air,unit,meta={}){
    const identity=key(unit?.unit);
    if(!air?.nativeAuthority||!identity||!uint(meta.tick)||!uint(meta.epoch)){empty(air);return false;}
    const changed=identity!==life||meta.epoch!==epoch||lastAir!==air;
    if(changed){clear();life=identity;epoch=meta.epoch;lastAir=air;}
    if(meta.tick<lastTick)return false;
    const c=unit.countermeasures;
    if(!valid(c)){empty(air);accepted=null;lastTick=meta.tick;return false;}
    if(!changed&&meta.tick===lastTick&&accepted)return true;
    if(accepted&&c.release_seq<accepted.release_seq)return false;
    const kinds=accepted&&c.release_seq>accepted.release_seq?['flares','chaff'].filter(k=>c[k]<accepted[k]):[];
    const cm=air.cm||(air.cm={max:{}});cm.max=cm.max||{};
    for(const k of ['flares','chaff']){cm[k]=c[k];cm.max[k]=c.max[k];}
    cm.release_seq=c.release_seq;cm.cooldown_remaining_s=c.cooldown_remaining_s;
    const ctl=control(air);ctl.cm=ctl.cm||{program:'both',periodic:false};
    if(!programs.includes(ctl.cm.program))ctl.cm.program='both';
    ctl.cm.readyAt=now()+c.cooldown_remaining_s;
    accepted={flares:c.flares,chaff:c.chaff,release_seq:c.release_seq};lastTick=meta.tick;
    if(kinds.length)onRelease(air,{seq:c.release_seq,kinds});
    return true;
  }
  function action(air,unit,name){
    if(!['cm','cmPeriodic','cmProgram'].includes(name))return undefined;
    const current=scope(),ctl=control(air),cm=ctl.cm||(ctl.cm={program:'both',periodic:false});
    if(!air?.nativeAuthority||!air.active||key(unit?.unit)!==life||key(current?.unit?.unit)!==life||current.epoch!==epoch||!accepted||unit.alive!==true||air.plane?.crashed||air.plane?.damage?.pilotDead){cm.periodic=false;return reason(air,'反制状态尚未由服务器确认');}
    if(name==='cmProgram'){cm.program=programs[(programs.indexOf(cm.program)+1)%programs.length];return true;}
    if(name==='cmPeriodic'){cm.periodic=!cm.periodic;cm.next=now();return true;}
    if(now()<(cm.readyAt||0))return reason(air,'反制投放间隔中');
    const kind=programs.includes(cm.program)?cm.program:'both',kinds=kind==='both'?['flares','chaff']:[kind];
    if(!kinds.some(k=>air.cm?.[k]>0)){cm.periodic=false;return reason(air,'所选反制措施已用完');}
    const seq=current.nextSequence();if(!Number.isSafeInteger(seq)||seq<=0)return false;
    send({op:'air_countermeasure',unit:{battle:unit.unit.battle,unit:unit.unit.unit,life:unit.unit.life},epoch:current.epoch,seq,kind});
    return true;
  }
  return {accept,action,clear};
}

function createFrontlineCountermeasureVisual({maxEntries=192,staleSeconds=.35}={}) {
  if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>512||!Number.isFinite(staleSeconds)||staleSeconds<=0||staleSeconds>1)throw Error('Native CM visual bounds invalid');
  const slots=Array.from({length:maxEntries},()=>({key:null,kind:null,pos:new Float64Array(3),velocity:new Float64Array(3),age:0,ttl:0,seen:0}));
  const stats={live:0,capped:0,acceptedFrames:0,rejectedFrames:0,staleFrames:0};
  const positive=v=>Number.isSafeInteger(v)&&v>0;
  const vector=v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<=1e8);
  let battle=null,lastTick=-1;
  function clearRecords(){for(const s of slots)s.key=null;stats.live=0;}
  function clear(){clearRecords();battle=null;lastTick=-1;}
  function reject(){clearRecords();stats.rejectedFrames++;return false;}
  function accept(units,meta={}){
    if(!positive(meta.battle)||!Number.isSafeInteger(meta.tick)||meta.tick<0||!Number.isFinite(meta.time)||!Array.isArray(units)||units.length>256)return reject();
    if(battle!==null&&(meta.battle<battle||meta.battle===battle&&meta.tick<=lastTick)){stats.staleFrames++;return false;}
    const admitted=[],seen=new Set();let total=0;
    for(const unit of units){
      const u=unit?.unit;if(!u||![u.battle,u.unit,u.life].every(positive)||u.battle!==meta.battle)return reject();
      if(unit.decoys===undefined)continue;
      if(!Array.isArray(unit.decoys))return reject();
      total+=unit.decoys.length;
      const count=Math.min(unit.decoys.length,maxEntries-admitted.length);
      for(let i=0;i<count;i++){
        const d=unit.decoys[i],key=`${u.battle}:${u.unit}:${u.life}:${d?.id}`;
        if(!d||!positive(d.id)||!['flares','chaff'].includes(d.kind)||!vector(d.pos)||!vector(d.velocity)||!Number.isFinite(d.age)||d.age<0||!Number.isFinite(d.ttl)||d.ttl<=0||d.ttl>60||d.age>d.ttl||seen.has(key))return reject();
        seen.add(key);admitted.push({key,d});
      }
    }
    if(meta.battle!==battle)clearRecords();
    for(const s of slots)if(s.key&&!seen.has(s.key))s.key=null;
    for(const {key,d} of admitted){
      let slot=slots.find(s=>s.key===key)||slots.find(s=>!s.key);
      if(!slot)break;
      if(slot.key===key&&(slot.kind!==d.kind||d.age+1e-6<slot.age))return reject();
      slot.key=key;slot.kind=d.kind;slot.pos.set(d.pos);slot.velocity.set(d.velocity);slot.age=d.age;slot.ttl=d.ttl;slot.seen=meta.time;
    }
    battle=meta.battle;lastTick=meta.tick;stats.live=admitted.length;stats.capped+=Math.max(0,total-admitted.length);stats.acceptedFrames++;return true;
  }
  function write(buffer,start,cam,scene,kind){
    if(scene?.mode!=='battle'){clear();return start;}
    if(!Number.isFinite(scene.time)||!cam?.right||!cam?.up)return start;
    let count=start,live=0;
    for(const s of slots){
      if(!s.key)continue;
      const elapsed=Math.max(0,scene.time-s.seen),age=s.age+elapsed;
      if(elapsed>staleSeconds||age>=s.ttl){s.key=null;continue;}
      live++;
      if(s.kind!==kind||count+6>buffer.length/9)continue;
      const delta=Math.min(.15,elapsed),x=s.pos[0]+s.velocity[0]*delta,y=s.pos[1]+s.velocity[1]*delta,z=s.pos[2]+s.velocity[2]*delta;
      const flare=kind==='flares',size=flare?.3:.65+age*.08,alpha=(flare?.9:.4)*Math.min(1,(s.ttl-age)/.3);
      for(let v=0;v<6;v++){
        const right=v===1||v===2||v===4?1:-1,up=v===2||v===4||v===5?1:-1,at=(count+v)*9;
        buffer[at]=x+(cam.right[0]*right+cam.up[0]*up)*size-(cam.renderOrigin?.[0]||0);buffer[at+1]=y+(cam.right[1]*right+cam.up[1]*up)*size-(cam.renderOrigin?.[1]||0);buffer[at+2]=z+(cam.right[2]*right+cam.up[2]*up)*size-(cam.renderOrigin?.[2]||0);
        buffer[at+3]=right;buffer[at+4]=up;buffer[at+5]=flare?1:.78;buffer[at+6]=flare?.65:.82;buffer[at+7]=flare?.22:.86;buffer[at+8]=alpha;
      }
      count+=6;
    }
    stats.live=live;return count;
  }
  return {accept,write,clear,stats,slots};
}

// TF_NATIVE_CM_REASONS_V2: presentation only; never retry, spend or release.
function frontlineCountermeasureReason(code,language='zh') {
  const messages={
    countermeasures_empty:['所选反制措施已用完','Selected countermeasures are depleted.'],
    countermeasure_dispenser_cycling:['反制投放间隔中，请稍后重试','The countermeasure dispenser is cycling. Try again shortly.'],
    countermeasures_not_fitted:['此机未装备反制措施','This aircraft has no countermeasure dispenser.'],
    aircraft_not_controlled:['请先接管当前飞机，再投放反制措施','Take control of the current aircraft before releasing countermeasures.'],
    aircraft_servicing:['飞机正在整备，请完成后再投放反制措施','The aircraft is being serviced. Wait for servicing to finish.'],
    unknown_aircraft:['当前飞机已不可用，请重新确认接管','The current aircraft is unavailable. Check control before retrying.'],
    invalid_countermeasure_kind:['反制程序无效，请重新选择投放种类','Invalid countermeasure program. Select a release type again.'],
    countermeasure_serial_exhausted:['本次出击的反制投放已达上限，请重新出击','The countermeasure release limit for this sortie was reached. Start a new sortie.']
  };
  const aliases={dispenser_cycling:'countermeasure_dispenser_cycling',not_fitted:'countermeasures_not_fitted',not_controlled:'aircraft_not_controlled',aircraft_lost:'unknown_aircraft'};
  let key=typeof code==='string'?code:'';
  if(Object.hasOwn(aliases,key))key=aliases[key];
  const row=Object.hasOwn(messages,key)?messages[key]:['反制投放未获确认，请稍后重试','Countermeasure release was not confirmed. Please try again shortly.'];
  return row[language==='en'?1:0];
}

// Native-accepted gun tracers only. This owner has no projectile, collision,
// ammunition or damage authority; missing snapshot entries stop immediately.
function createFrontlineGunTracerVisual({fx,maxEntries=512,tickSeconds=.05,nowSeconds=null}={}){
  if(typeof fx?.beam!=='function')throw Error('Native gun tracer beam dependency is required');
  if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>1024)throw Error('Native gun tracer bound must be 1..1024');
  if(!Number.isFinite(tickSeconds)||tickSeconds<=0||tickSeconds>.25)throw Error('Native gun tracer tick interval is invalid');
  const records=new Map(),stats={live:0,acceptedFrames:0,rejectedFrames:0,staleFrames:0,capped:0,beams:0};
  const positive=n=>Number.isSafeInteger(n)&&n>0;
  const vector=v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e8);
  const identity=(r,b)=>r&&r.battle===b&&positive(r.battle)&&positive(r.unit)&&positive(r.life);
  const key=r=>`${r.battle}:${r.unit}:${r.life}`;
  // Network samples keep arriving while the GPU gate skips rendering. Receipt
  // age must not inherit the entire accumulated interval since the last draw.
  const clock=nowSeconds??(typeof performance!=='undefined'&&typeof performance.now==='function'?()=>performance.now()/1000:null);
  if(clock!==null&&typeof clock!=='function')throw Error('Native gun tracer receipt clock is invalid');
  let virtualTime=0,lastTime=0;
  function time(dt=0){virtualTime+=dt;const value=clock?clock():virtualTime;lastTime=Math.max(lastTime,Number.isFinite(value)?value:lastTime);return lastTime;}
  let battle=null,lastTick=-1,disposed=false;
  function clearRecords(){records.clear();stats.live=0;}
  function reject(){clearRecords();stats.rejectedFrames++;return false;}
  function valid(row,nextBattle){
    return row&&positive(row.shot_id)&&identity(row.shooter,nextBattle)&&(row.team===0||row.team===1)
      &&typeof row.projectile_id==='string'&&row.projectile_id.length>0&&row.projectile_id.length<=256
      &&vector(row.pos)&&vector(row.velocity)&&Number.isFinite(row.age)&&row.age>=0
      &&Array.isArray(row.color)&&row.color.length===3&&row.color.every(n=>Number.isFinite(n)&&n>=0&&n<=1)
      &&Number.isFinite(row.caliber_mm)&&row.caliber_mm>0&&row.caliber_mm<=5000
      &&(row.style==='bullet'||row.style==='shell')
      &&(row.distance_m===undefined||Number.isFinite(row.distance_m)&&row.distance_m>=0)
      &&(row.width_scale===undefined||Number.isFinite(row.width_scale)&&row.width_scale>0&&row.width_scale<=4);
  }
  function accept(rows,meta={}){
    if(disposed)return false;
    const nextBattle=meta.battle,tick=meta.tick;
    if(!positive(nextBattle)||!Number.isSafeInteger(tick)||tick<0||!Array.isArray(rows))return reject();
    if(battle!==null&&(nextBattle<battle||nextBattle===battle&&tick<=lastTick)){stats.staleFrames++;return false;}
    const count=Math.min(rows.length,maxEntries),seen=new Set();
    // Validate the bounded admitted slice before replacing any current record.
    for(let i=0;i<count;i++){
      const row=rows[i];if(!valid(row,nextBattle)||seen.has(row.shot_id))return reject();seen.add(row.shot_id);
      const old=nextBattle===battle?records.get(row.shot_id):null;
      if(old&&(old.shooter!==key(row.shooter)||old.team!==row.team||old.projectileId!==row.projectile_id
        ||old.style!==row.style||row.age+1e-6<old.age))return reject();
    }
    const receivedAt=time(),duration=nextBattle===battle&&lastTick>=0?Math.min(.1,(tick-lastTick)*tickSeconds):0;
    if(nextBattle!==battle){clearRecords();battle=nextBattle;}
    for(const id of records.keys())if(!seen.has(id))records.delete(id);
    for(let i=0;i<count;i++){
      const row=rows[i],old=records.get(row.shot_id),active=old&&receivedAt-old.receivedAt<=.2;
      if(active)advance(old,receivedAt);
      // Blend the difference between the previous displayed sample and the new
      // accepted position while continuing along the accepted velocity. Pure
      // position-to-position lerp would pause a 1200 m/s tracer every 20 Hz frame.
      const record={shooter:key(row.shooter),team:row.team,projectileId:row.projectile_id,style:row.style,
        age:row.age,distance:row.distance_m,color:row.color.slice(),widthScale:row.width_scale??1,
        sample:row.pos.slice(),targetVelocity:row.velocity.slice(),
        position:active?old.position.slice():row.pos.slice(),
        velocity:active?old.velocity.slice():row.velocity.slice(),
        startVelocity:active?old.velocity.slice():row.velocity.slice(),
        correction:active?row.pos.map((v,k)=>old.position[k]-v):[0,0,0],
        duration:active?duration:0,sinceSample:0,receivedAt};
      records.set(row.shot_id,record);
    }
    lastTick=tick;stats.live=records.size;stats.acceptedFrames++;stats.capped+=rows.length-count;return true;
  }
  function advance(record,now){
    record.sinceSample=Math.max(0,now-record.receivedAt);
    const lead=Math.min(.1,record.sinceSample),t=record.duration>0?Math.min(1,record.sinceSample/record.duration):1;
    for(let k=0;k<3;k++){
      record.position[k]=record.sample[k]+record.targetVelocity[k]*lead+record.correction[k]*(1-t);
      record.velocity[k]=record.startVelocity[k]+(record.targetVelocity[k]-record.startVelocity[k])*t;
    }
    return lead;
  }
  function step(dt,cameraPosition){
    if(disposed)return false;
    const elapsed=Number.isFinite(dt)&&dt>0?dt:0,canDraw=vector(cameraPosition),now=time(elapsed);
    for(const record of records.values()){
      const lead=advance(record,now);
      if(record.sinceSample>.2)continue;
      // At most 100 ms of presentation-only prediction, then hold the last
      // bounded position until timeout. No gravity, hit queries or local rounds.
      if(!canDraw)continue;
      const speed=Math.hypot(...record.velocity),tailSeconds=record.style==='bullet'?.022:.03;
      if(speed<=1e-6)continue;
      const travelled=record.distance===undefined?speed*record.age:record.distance;
      const tail=Math.min(speed*tailSeconds,travelled+speed*lead);
      if(tail<=1e-6)continue;
      const distance=Math.hypot(...record.position.map((v,k)=>v-cameraPosition[k]));
      const halfWidth=(record.style==='bullet'?.02+distance*.0011:.05+distance*.0016)*record.widthScale;
      // Effects.build consumes each beam; retain world-space JS doubles until
      // its camera-relative packing, and never mutate arrays already queued.
      fx.beam(record.position.map((v,k)=>v-record.velocity[k]/speed*tail),record.position.slice(),halfWidth,record.color.slice(),record.style==='bullet'?.9:.95);
      stats.beams++;
    }
    return canDraw;
  }
  function clear(){clearRecords();battle=null;lastTick=-1;}
  function dispose(){if(disposed)return;clear();disposed=true;}
  return {accept,step,clear,dispose,stats};
}

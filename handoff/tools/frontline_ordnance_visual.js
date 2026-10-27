// Accepted native ordnance presentation. Meshes are borrowed from the existing
// store cache; this owner retains only bounded scene nodes and cosmetic smoke.
function createFrontlineOrdnanceVisual({Node,storeMesh,storeDefs,quatMatrix,aqLook,fx=null,maxEntries=512,maxSmokePerStep=128,tickSeconds=.05}={}) {
  for(const [name,value] of Object.entries({Node,storeMesh,quatMatrix,aqLook}))if(typeof value!=='function')throw Error(`Missing native ordnance visual dependency: ${name}`);
  if(!storeDefs||typeof storeDefs!=='object')throw Error('Native ordnance store catalog is required');
  if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>1024)throw Error('Native ordnance visual bound must be 1..1024');
  if(!Number.isSafeInteger(maxSmokePerStep)||maxSmokePerStep<0||maxSmokePerStep>256)throw Error('Native ordnance smoke bound must be 0..256');
  if(!Number.isFinite(tickSeconds)||tickSeconds<=0||tickSeconds>.25)throw Error('Native ordnance tick interval is invalid');
  const root=new Node('native-air-ordnance'),records=new Map(),failedStores=new Set();
  const phases=new Set(['ir','sarh','datalink','active','tv','iir','laser','beam','radio','arm','lost','ballistic']);
  const propelled=new Set(['aam','agm','rocket']);
  const stats={live:0,acceptedFrames:0,rejectedFrames:0,staleFrames:0,capped:0,meshErrors:0,smokeParticles:0};
  let battle=null,lastTick=-1,disposed=false;
  const positive=n=>Number.isSafeInteger(n)&&n>0;
  const vector=v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e8);
  const copy=(out,input)=>{for(let i=0;i<3;i++)out[i]=input[i];};
  function clearRecords(){records.clear();root.children.length=0;stats.live=0;}
  function reject(){stats.rejectedFrames++;clearRecords();return false;}
  function valid(row){
    return row&&positive(row.shot_id)&&positive(row.shooter)&&(row.team===0||row.team===1)
      &&typeof row.store_id==='string'&&Object.hasOwn(storeDefs,row.store_id)
      &&vector(row.pos)&&vector(row.velocity)&&Number.isFinite(row.age)&&row.age>=0
      &&phases.has(row.phase)&&(row.powered===undefined||typeof row.powered==='boolean');
  }
  function draw(record){
    const speed=Math.hypot(...record.velocity);
    if(speed>1e-5)for(let i=0;i<3;i++)record.direction[i]=record.velocity[i]/speed;
    record.node.local=quatMatrix(record.position,aqLook(record.direction));
  }
  function accept(rows,meta={}){
    if(disposed)return false;
    const nextBattle=meta.battle,tick=meta.tick;
    if(!positive(nextBattle)||!Number.isSafeInteger(tick)||tick<0||!Array.isArray(rows))return reject();
    if(battle!==null&&(nextBattle<battle||nextBattle===battle&&tick<=lastTick)){stats.staleFrames++;return false;}
    const count=Math.min(rows.length,maxEntries),seen=new Set();
    // Validate this bounded admitted slice before changing any existing node.
    for(let i=0;i<count;i++){
      const row=rows[i];if(!valid(row)||seen.has(row.shot_id))return reject();seen.add(row.shot_id);
      const old=nextBattle===battle?records.get(row.shot_id):null;
      if(old&&(old.storeId!==row.store_id||old.shooter!==row.shooter||old.team!==row.team||row.age+1e-6<old.age))return reject();
    }
    if(nextBattle!==battle){clearRecords();failedStores.clear();battle=nextBattle;lastTick=-1;}
    const duration=lastTick<0?0:Math.min(.15,Math.max(.025,(tick-lastTick)*tickSeconds));
    stats.capped+=rows.length-count;
    for(const [id,record] of records)if(!seen.has(id)){
      const index=root.children.indexOf(record.node);if(index>=0)root.children.splice(index,1);records.delete(id);
    }
    for(let i=0;i<count;i++){
      const row=rows[i];let record=records.get(row.shot_id);
      if(!record){
        if(failedStores.has(row.store_id))continue;
        let mesh;try{mesh=storeMesh(row.store_id);}catch{mesh=null;}
        if(!mesh){failedStores.add(row.store_id);stats.meshErrors++;continue;}
        const node=new Node('native_ordnance_'+row.shot_id);
        node.mesh=mesh;node.kind=3;node.castShadow=false;node.hitboxDisabled=true;
        node.storeId=row.store_id;node.nativeShotId=row.shot_id;
        record={node,storeId:row.store_id,shooter:row.shooter,team:row.team,age:row.age,phase:row.phase,powered:row.powered,
          position:row.pos.slice(),start:row.pos.slice(),target:row.pos.slice(),velocity:row.velocity.slice(),startVelocity:row.velocity.slice(),targetVelocity:row.velocity.slice(),direction:[0,0,1],tail:[0,0,0],elapsed:0,duration:0,sinceSample:0,smoke:0};
        records.set(row.shot_id,record);root.add(node);
      }else{
        copy(record.start,record.position);copy(record.target,row.pos);
        copy(record.startVelocity,record.velocity);copy(record.targetVelocity,row.velocity);
        record.duration=duration;
      }
      record.elapsed=0;record.sinceSample=0;record.fresh=true;record.age=row.age;record.phase=row.phase;record.powered=row.powered;record.node.nativePhase=row.phase;
      draw(record);
    }
    lastTick=tick;stats.live=records.size;stats.acceptedFrames++;return true;
  }
  function burning(record,definition){
    if(!propelled.has(definition.kind)||record.sinceSample>.2)return false;
    if(record.powered!==undefined)return record.powered;
    const age=record.age+record.sinceSample,burn=Number.isFinite(definition.burn)?Math.max(0,definition.burn):0;
    if(age<burn&&burn>0)return true;
    const sustain=definition.sustain;
    if(Array.isArray(sustain)&&Number.isFinite(sustain[0])&&sustain[0]>0&&Number.isFinite(sustain[1])&&sustain[1]>0&&age<burn+sustain[0])return true;
    const ramjet=definition.ramjet;
    return !!ramjet&&Number.isFinite(ramjet.time)&&ramjet.time>0&&age<burn+ramjet.time&&Number.isFinite(ramjet.k)&&ramjet.k>0&&Number.isFinite(ramjet.speed)&&Math.hypot(...record.targetVelocity)<ramjet.speed;
  }
  function step(dt){
    if(disposed)return false;
    const elapsed=Number.isFinite(dt)&&dt>0?dt:0,smokeDt=Math.min(.1,elapsed);let remaining=maxSmokePerStep;
    for(const record of records.values()){
      record.elapsed+=elapsed;
      // A new network sample can arrive between slow drawing frames. The draw
      // interval preceding that sample is not time since its acceptance.
      if(record.fresh){record.sinceSample=0;record.fresh=false;}else record.sinceSample+=elapsed;
      const t=record.duration>0?Math.min(1,record.elapsed/record.duration):1;
      for(let i=0;i<3;i++){
        record.position[i]=record.start[i]+(record.target[i]-record.start[i])*t;
        record.velocity[i]=record.startVelocity[i]+(record.targetVelocity[i]-record.startVelocity[i])*t;
      }
      draw(record);
      const definition=storeDefs[record.storeId];
      if(!fx||!burning(record,definition)){record.smoke=0;continue;}
      const length=Number.isFinite(definition.len)?Math.max(0,definition.len):0;
      const diameter=Number.isFinite(definition.d)?Math.max(.01,definition.d):.1;
      for(let i=0;i<3;i++)record.tail[i]=record.position[i]-record.direction[i]*length*.55;
      fx.glow?.(record.tail.slice(),diameter*4+.3,[1,.78,.45],.9,.3);
      record.smoke+=smokeDt*(definition.kind==='rocket'?40:60);
      const emitted=Math.min(4,remaining,Math.floor(record.smoke));
      for(let i=0;i<emitted;i++)fx.spawn?.({pos:record.tail.slice(),vel:[0,.3,0],life:2.7,size0:diameter*4+.25,size1:diameter*16+1.2,color:[.78,.77,.74],alpha:.4,drag:2});
      record.smoke-=Math.floor(record.smoke);remaining-=emitted;stats.smokeParticles+=emitted;
    }
    return true;
  }
  function clear(){clearRecords();failedStores.clear();battle=null;lastTick=-1;}
  function dispose(){if(disposed)return;clear();disposed=true;root.visible=false;}
  return {root,stats,accept,step,clear,dispose};
}

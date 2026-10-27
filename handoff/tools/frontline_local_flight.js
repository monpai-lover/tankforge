// The original shared C/WASM plant owns immediate local movement. Native
// snapshots alone own combat resources/damage; only scoped kinematics are sent.
function createFrontlineLocalFlight({api,plane,unit,epoch,configure=configureFrontlineFlightCore}) {
  const key=ref=>ref?`${ref.battle}:${ref.unit}:${ref.life}`:'';
  if(!api?.adopt_kinematics||!api.seed_control_state||!api.step||typeof configure!=='function'||!plane||unit?.sensed||!Number.isSafeInteger(epoch))throw Error('A private flight life and real shared kernel are required');
  const life=key(unit.unit),reference={...unit.unit},original={api:plane.api,S:plane.S,aero:plane.aero};
  const state=new Float32Array(api.memory.buffer,api.state_ptr(),80),aero=new Float32Array(api.memory.buffer,api.aero_state_ptr(),48);
  const pending=new Map(),fixed=1/120;
  const renderOffset=new Float32Array(3);let renderRotation=[0,0,0,1];
  let active=true,paused=false,acc=0,lastAcceptedTime=-1,lastResource=-1,lastService=null,lastAck=0,lastAckTime=-1,lastPacketTime=-1,clockOffset=unit.state[23],loadedKey='',needsCorrection=false,latest=unit;
  const validSample=value=>value&&key(value.unit)===life&&value.state?.length===80&&value.aero?.length===48&&value.state.every(Number.isFinite)&&value.aero.every(Number.isFinite);
  const adopt=pose=>api.adopt_kinematics(...pose.position,...pose.quaternion,...pose.velocity,...pose.angular_velocity)===1;
  const seed=value=>{const s=value.state,a=value.aero;if(api.seed_control_state(s[27],s[24],s[25],s[26],s[33],s[34],a[23],a[36],a[37],a[38],a[39])!==1)throw Error('Native kernel rejected accepted control handoff');};
  const poseOf=s=>({position:Array.from(s.slice(0,3)),quaternion:Array.from(s.slice(3,7)),velocity:Array.from(s.slice(7,10)),angular_velocity:Array.from(s.slice(10,13))});
  function configured(value){
    if(!value.flight?.airframe?.every(Number.isFinite)||value.flight.airframe.length!==14||!value.flight.factors?.every(Number.isFinite)||value.flight.factors.length!==6)throw Error('Accepted native flight coefficients are required');
    const signature=value.flight.airframe.join(',');if(signature!==loadedKey){configure(api,value);loadedKey=signature;}
    api.set_damage(...value.flight.factors);
    if(value.airframe_limits?.gear_failed)api.set_gear_failure(1);
  }
  if(!validSample(unit))throw Error('Invalid initial local flight sample');
  configured(unit);api.spawn(unit.state[0],unit.state[1],unit.state[2],unit.state[18],unit.state[13],unit.state[36]===4?1:0);
  seed(unit);
  if(!adopt(poseOf(unit.state)))throw Error('Native kernel rejected initial flight handoff');
  configured(unit);plane.api=api;plane.S=state;plane.aero=aero;plane.cur.set(state);plane.prev.set(state);
  function accept(value,nextEpoch){
    if(nextEpoch!==epoch||!validSample(value)){active=false;return false;}
    if(value.state[23]<lastAcceptedTime||Number(value.resource_revision??0)<lastResource)return false;
    const previousResource=lastResource;
    latest=value;lastAcceptedTime=value.state[23];lastResource=Number(value.resource_revision??0);
    configured(value);
    const service=value.service?.status==='complete'?value.service_revision??value.service.revision:null;
    if(service!==null&&service!==lastService&&lastResource>previousResource){
      // Only an accepted completed repair may reset a failed local mechanism.
      api.spawn(value.state[0],value.state[1],value.state[2],value.state[18],value.state[13],value.state[36]===4?1:0);
      seed(value);
      adopt(poseOf(value.state));configured(value);clockOffset=value.state[23]-state[23];acc=0;
    }
    if(service!==null)lastService=service;
    paused=value.service?.status==='servicing';
    if(value.alive===false||value.state[22]>=.5){active=false;plane.cur.set(value.state);plane.prev.set(value.state);}
    else if(paused){plane.cur.set(value.state);plane.prev.set(value.state);}
    if(needsCorrection&&active){correct(value);needsCorrection=false;}
    return true;
  }
  accept(unit,epoch);
  function step(dt,intent){
    if(!active||paused||!intent||!Number.isFinite(dt)||dt<=0)return;
    const gain=1-Math.exp(-Math.min(dt,.1)*12);
    for(let i=0;i<3;i++)renderOffset[i]+=Math.max(-3,Math.min(3,-renderOffset[i]*gain));
    const angle=2*Math.acos(Math.min(1,Math.abs(renderRotation[3])));
    renderRotation=frontlineFlightSlerp(renderRotation,[0,0,0,1],Math.min(gain,angle>.001?.15/angle:1));
    acc+=Math.min(.1,dt);let count=0;
    while(acc+1e-9>=fixed&&count<12){
      plane.prev.set(plane.cur);
      api.step(fixed,intent.aim[0],intent.aim[1],intent.aim[2],intent.throttle,intent.manual_pitch,intent.manual_roll,intent.manual_yaw,intent.flags);
      plane.cur.set(state);for(let i=0;i<3;i++)plane.cur[i]+=renderOffset[i];
      plane.cur.set(frontlineFlightMultiply(renderRotation,Array.from(state.slice(3,7))),3);acc-=fixed;count++;
    }
    if(count===12)acc=0;
    plane.aero=aero;plane.time=clockOffset+state[23];plane.pose(Math.max(0,Math.min(1,acc/fixed)));
  }
  function packet(seq){
    if(!active||paused||needsCorrection||!Number.isSafeInteger(seq)||seq<1)return null;
    const time=clockOffset+state[23];if(time<=lastPacketTime)return null;
    const pose={...poseOf(state),sample_time_s:time},value={unit:{...reference},epoch,seq,pose};
    pending.set(seq,pose);while(pending.size>64)pending.delete(pending.keys().next().value);lastPacketTime=time;return value;
  }
  function ack(message){
    if(!active||key(message?.unit)!==life||message.epoch!==epoch||message.seq<=lastAck||!pending.has(message.seq))return false;
    const sent=pending.get(message.seq),received=message.pose;if(!received?.position?.every(Number.isFinite)||!received.quaternion?.every(Number.isFinite))return false;
    const distance=Math.hypot(...received.position.map((x,i)=>x-sent.position[i]));
    if(distance>.01){const target=poseOf(state);for(let i=0;i<3;i++)target.position[i]+=received.position[i]-sent.position[i];
      const old=Array.from(plane.cur.slice(0,3));if(adopt(target))for(let i=0;i<3;i++)renderOffset[i]=old[i]-state[i];}
    lastAck=message.seq;lastAckTime=received.sample_time_s;for(const seq of pending.keys())if(seq<=lastAck)pending.delete(seq);return true;
  }
  function correct(value=latest){
    if(!validSample(value)||!active)return false;
    const target=poseOf(value.state),oldPosition=Array.from(plane.cur.slice(0,3)),oldRotation=Array.from(plane.cur.slice(3,7));
    const lead=Math.max(0,Math.min(.1,clockOffset+state[23]-value.state[23]));
    for(let i=0;i<3;i++)target.position[i]+=target.velocity[i]*lead;
    if(!adopt(target)){
      if(value.alive===false||value.state[22]>=.5)return false;
      api.spawn(value.state[0],value.state[1],value.state[2],value.state[18],value.state[13],value.state[36]===4?1:0);
      seed(value);
      if(!adopt(target))return false;configured(value);
    }
    for(let i=0;i<3;i++)renderOffset[i]=oldPosition[i]-state[i];
    const q=Array.from(state.slice(3,7));renderRotation=frontlineFlightMultiply(oldRotation,[-q[0],-q[1],-q[2],q[3]]);
    clockOffset=Math.max(value.state[23],lastAckTime+fixed)-state[23];lastPacketTime=lastAckTime;pending.clear();return true;
  }
  function dispose(){active=false;pending.clear();plane.api=original.api;plane.S=original.S;plane.aero=original.aero;plane.S.set(latest.state);plane.cur.set(latest.state);plane.prev.set(latest.state);plane.aero.set(latest.aero);}
  return {step,packet,accept,ack,correct,reject(){needsCorrection=true;},dispose,get active(){return active;},get epoch(){return epoch;},get life(){return life;},pose:()=>plane.pose(Math.max(0,Math.min(1,acc/fixed)))};
}

function configureFrontlineFlightCore(api,unit){
  const f=unit.flight;
  for(const [key,length]of [['airframe',14],['configure',5],['control',4],['envelope',4]])if(f?.[key]?.length!==length||!f[key].every(Number.isFinite))throw Error(`Missing accepted flight ${key}`);
  api.configure_airframe(...f.airframe);
  if(f.surfaces)api.configure_surfaces(...f.surfaces);
  api.configure_gear_sequence(...(f.gear_sequence||[0,3,3,1,.75,1]));
  api.configure(...f.configure);api.configure_control(...f.control);api.configure_envelope(...f.envelope);
}

function frontlineFlightMultiply(a,b){return[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];}

function frontlineFlightSlerp(a,b,t){
  let dot=a.reduce((sum,x,i)=>sum+x*b[i],0);if(dot<0){b=b.map(x=>-x);dot=-dot;}
  let out;if(dot>.9995)out=a.map((x,i)=>x+(b[i]-x)*t);else{const angle=Math.acos(Math.min(1,dot)),den=Math.sin(angle);out=a.map((x,i)=>(Math.sin((1-t)*angle)*x+Math.sin(t*angle)*b[i])/den);}
  const length=Math.hypot(...out)||1;return out.map(x=>x/length);
}

// Remote/sensed aircraft remain presentation-only and interpolate one accepted
// sample interval behind receipt. No unobserved flight state is synthesized.
function createFrontlineFlightInterpolation(plane){
  const previous=new Float32Array(80),target=new Float32Array(80),oldAero=new Float32Array(48),newAero=new Float32Array(48);
  let ready=false,elapsed=0,interval=.05;
  function accept(state,aero){
    if(ready){previous.set(target);oldAero.set(newAero);interval=Math.max(1/120,Math.min(.25,state[23]-target[23]||.05));}
    else{previous.set(state);oldAero.set(aero);ready=true;}
    target.set(state);newAero.set(aero);elapsed=0;
  }
  function pose(dt){
    if(!ready)return;elapsed+=Math.max(0,Math.min(.25,dt||0));const alpha=Math.max(0,Math.min(1,elapsed/interval));
    plane.cur.set(target);for(const i of [0,1,2,7,8,9,10,11,12,13,14,15,16,17,18,19,20,23,24,25,26,33,34,35,42,43,44,45,46,47,48,49,50,75])plane.cur[i]=previous[i]+(target[i]-previous[i])*alpha;
    plane.cur.set(frontlineFlightSlerp(Array.from(previous.slice(3,7)),Array.from(target.slice(3,7)),alpha),3);
    plane.aero.set(newAero);for(const i of [8,9,10,11,23,36,37,38,39])plane.aero[i]=oldAero[i]+(newAero[i]-oldAero[i])*alpha;
    plane.prev.set(plane.cur);plane.pose(1);
  }
  return{accept,pose,reset(state,aero){ready=false;accept(state,aero);}};
}

function createFrontlineFlightWorld(f,height){
  let map=null,facilities=null,catalog=null,areas=[];
  function refresh(){
    if(map===f.map&&facilities===f.facilities&&catalog===f.facilityCatalog)return;
    map=f.map;facilities=f.facilities;catalog=f.facilityCatalog;
    areas=(map?.airfields||[]).filter(field=>field.enabled&&field.runway).map(field=>{
      const r=field.runway,n=Math.hypot(...r.forward)||1;
      const patches=(facilities||[]).filter(p=>p.kind==='runway_patch'&&p.source_id===field.id).map(p=>({
        interval:(catalog||[]).find(g=>g.facility_id===p.facility_id)?.source?.longitudinalMeters,landable:p.capabilities?.landable===true}));
      return{center:r.center,forward:r.forward.map(x=>x/n),halfLength:r.lengthMeters/2,halfWidth:r.widthMeters/2,patches};
    });
  }
  return{ground:height,landable(x,z){
    refresh();const t=map?.terrain;if(!t||x<t.x0||z<t.z0||x>t.x0+(t.width-1)*t.cellX||z>t.z0+(t.height-1)*t.cellZ)return false;
    for(const r of areas){const dx=x-r.center[0],dz=z-r.center[1],along=dx*r.forward[0]+dz*r.forward[1],across=dx*r.forward[1]-dz*r.forward[0];
      if(Math.abs(along)>r.halfLength||Math.abs(across)>r.halfWidth)continue;
      if(f.room?.facility_layout_version!==1)return true;
      for(const p of r.patches)if(p.interval?.length===2&&along>=p.interval[0]&&along<=p.interval[1])return p.landable;
    }return false;
  }};
}

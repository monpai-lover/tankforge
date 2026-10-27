// Presentation only: accepted C215 forces drive a short humidity-gated wake.
// No force, control, collision, ammunition or authoritative time is changed.
export function createAirVortex({capacity=64,maxSegments=96}={}) {
  capacity=Math.max(8,Math.min(128,capacity|0));
  const STRIDE=10,data=new Float64Array(capacity*2*STRIDE),heads=new Uint16Array(2),counts=new Uint16Array(2);
  const previous=new Float64Array(6),current=new Float64Array(6),lastPosition=new Float64Array(3),groups=new Uint32Array(2),active=new Uint8Array(2);
  let wingRef=null,localTips=null,lastTime=-1,lastLife=null,nextEmit=0;
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
  function tips(wing) {
    const p=wing?.at(-1);if(!p||p.length<4||!p.slice(0,4).every(Number.isFinite)||!(p[0]>0&&p[3]>0))return null;
    return new Float64Array([-p[0],p[1],p[2]-p[3],p[0],p[1],p[2]-p[3]]);
  }
  function reset(){heads.fill(0);counts.fill(0);active.fill(0);lastTime=-1;lastLife=null;}
  function strength(s,side) {
    const rh=s.humidity,q=s.q,lift=s.lift?.[side],a=s.alpha?.[side];
    if(!Number.isFinite(rh)||!Number.isFinite(q)||!Number.isFinite(lift)||!Number.isFinite(a)||
       !(rh>.76&&rh<=1&&q>700&&lift>0&&s.area>0&&s.speed>35))return 0;
    const maneuver=Math.max(smooth(1.5,4.5,s.load),smooth(.075,.24,a));
    if(maneuver===0)return 0;
    const cl=clamp(lift/(q*s.area*.5),0,1.8),temp=clamp(Number.isFinite(s.temperatureC)?s.temperatureC:15,-80,50);
    const magnus=Math.log(rh)+17.625*temp/(243.04+temp);
    const dew=243.04*magnus/(17.625-magnus);
    // Bounded pressure/cooling proxy; no claim of a measured airfoil Cp or CFD.
    const cooling=Math.min(12,s.speed*s.speed*.5*cl*.35/1005);
    return maneuver*smooth(.76,.94,rh)*smooth(700,2500,q)*smooth(-.8,1.5,cooling-(temp-dew));
  }
  function sample(s) {
    const time=s.time,m=s.matrix,p=s.position;
    if(!Number.isFinite(time)||!p||!m||s.crashed||s.visible===false){reset();return;}
    for(let k=0;k<3;k++)if(!Number.isFinite(p[k])){reset();return;}
    for(let k=0;k<16;k++)if(!Number.isFinite(m[k])){reset();return;}
    if(s.wing!==wingRef){wingRef=s.wing;localTips=tips(wingRef);reset();}
    if(!localTips){reset();return;}
    for(let side=0;side<2;side++)for(let k=0;k<3;k++)current[side*3+k]=m[12+k]+m[k]*localTips[side*3]+m[4+k]*localTips[side*3+1]+m[8+k]*localTips[side*3+2];
    const distance=lastTime<0?0:Math.hypot(p[0]-lastPosition[0],p[1]-lastPosition[1],p[2]-lastPosition[2]);
    if(lastTime<0||s.life!==lastLife||time<lastTime||time-lastTime>.26||distance>Math.max(80,s.speed*(time-lastTime)*3)){
      reset();lastTime=time;lastLife=s.life;nextEmit=time+.025;previous.set(current);lastPosition.set(p);return;
    }
    if(time===lastTime)return;
    const dt=time-lastTime,sa=strength(s,0),sb=strength(s,1);
    for(let side=0;side<2;side++){
      const value=side===0?sa:sb;
      if(value<=.015&&active[side]){active[side]=0;groups[side]++;}
      else if(value>.015&&!active[side]){active[side]=1;groups[side]++;}
    }
    let emitted=0;
    while(nextEmit<=time+1e-7&&emitted<12){
      const f=clamp((nextEmit-lastTime)/dt,0,1);
      for(let side=0;side<2;side++){
        const value=side===0?sa:sb;if(value<=.015)continue;
        const at=(side*capacity+heads[side])*STRIDE;
        for(let k=0;k<3;k++)data[at+k]=previous[side*3+k]+(current[side*3+k]-previous[side*3+k])*f;
        data[at+3]=nextEmit;data[at+4]=value;
        for(let k=0;k<3;k++)data[at+5+k]=Number.isFinite(s.wind?.[k])?s.wind[k]:0;
        data[at+8]=groups[side];data[at+9]=side;
        heads[side]=(heads[side]+1)%capacity;counts[side]=Math.min(capacity,counts[side]+1);
      }
      nextEmit+=.025;emitted++;
    }
    if(nextEmit<time)nextEmit=time+.025;
    previous.set(current);lastPosition.set(p);lastTime=time;lastLife=s.life;
  }
  function write(buffer,start,cam,now,limit=buffer.length/9) {
    let count=start,segments=0;limit=Math.min(limit,buffer.length/9);
    for(let side=0;side<2;side++)for(let j=1;j<counts[side];j++){
      if(segments>=maxSegments||count+6>limit)return count;
      const ia=(side*capacity+(heads[side]-j+capacity)%capacity)*STRIDE;
      const ib=(side*capacity+(heads[side]-j-1+capacity)%capacity)*STRIDE;
      if(data[ia+8]!==data[ib+8])continue;
      const ageA=Math.max(0,now-data[ia+3]),ageB=Math.max(0,now-data[ib+3]),life=.8+data[ia+4]*.55;
      if(ageB>=life)continue;
      const sign=side===0?-1:1;
      const ax=data[ia]+data[ia+5]*ageA+sign*.035*Math.sin(ageA*12),ay=data[ia+1]+data[ia+6]*ageA-.16*ageA,az=data[ia+2]+data[ia+7]*ageA;
      const bx=data[ib]+data[ib+5]*ageB+sign*.035*Math.sin(ageB*12),by=data[ib+1]+data[ib+6]*ageB-.16*ageB,bz=data[ib+2]+data[ib+7]*ageB;
      const dx=bx-ax,dy=by-ay,dz=bz-az,cx=cam.pos[0]-ax,cy=cam.pos[1]-ay,cz=cam.pos[2]-az;
      let nx=dy*cz-dz*cy,ny=dz*cx-dx*cz,nz=dx*cy-dy*cx;const length=Math.hypot(nx,ny,nz);
      if(length<1e-8)continue;
      const width=.035+.13*ageB/life,k=width/length;nx*=k;ny*=k;nz*=k;
      const opacity=.23*data[ia+4]*(1-ageB/life)**1.5*Math.min(1,ageA/.06);
      for(let vertex=0;vertex<6;vertex++){
        const end=vertex===2||vertex===4||vertex===5,positive=vertex===1||vertex===2||vertex===4;
        const direction=positive?1:-1,o=(count+vertex)*9;
        buffer[o]=(end?bx:ax)+nx*direction-(cam.renderOrigin?.[0]||0);buffer[o+1]=(end?by:ay)+ny*direction-(cam.renderOrigin?.[1]||0);buffer[o+2]=(end?bz:az)+nz*direction-(cam.renderOrigin?.[2]||0);
        buffer[o+3]=positive?1:-1;buffer[o+4]=2;
        buffer[o+5]=.86;buffer[o+6]=.90;buffer[o+7]=.94;buffer[o+8]=opacity;
      }
      count+=6;segments++;
    }
    return count;
  }
  return {data,sample,write,reset,tips,sideCount:side=>counts[side],get count(){return counts[0]+counts[1];}};
}

export function createAirVortexPool({maxAircraft=8,maxSegments=192}={}) {
  const slots=Array.from({length:maxAircraft},()=>({plane:null,flow:createAirVortex(),seen:-Infinity,
    sample:{position:new Float64Array(3),alpha:new Float64Array(2),lift:new Float64Array(2),wind:new Float64Array(3)}}));
  function clear(){for(const slot of slots){slot.flow.reset();slot.plane=null;}}
  function remove(plane){for(const slot of slots)if(slot.plane===plane){slot.flow.reset();slot.plane=null;}}
  function samplePlane(plane,scene) {
    if(!scene||scene.mode!=='battle'){clear();return;}
    const state=plane.cur,aero=plane.aero,wing=plane.type?.fighter?.spec?.wing;
    if(!state||!aero||aero.length<36||!wing)return;
    if(scene.camPos&&Math.hypot(state[0]-scene.camPos[0],state[1]-scene.camPos[1],state[2]-scene.camPos[2])>3000){remove(plane);return;}
    let slot=null;for(const candidate of slots)if(candidate.plane===plane){slot=candidate;break;}
    if(!slot){
      slot=slots[0];for(const candidate of slots){if(!candidate.plane){slot=candidate;break;}if(candidate.seen<slot.seen)slot=candidate;}
      // Keep active slots stable; a crowded sortie must not evict every trail
      // before its second sample. The controlled aircraft can always get one.
      if(slot.plane&&scene.time-slot.seen<.25&&scene.air?.plane!==plane)return;
      slot.flow.reset();slot.plane=plane;
    }
    const s=slot.sample,weather=scene.airAtmosphere;
    s.time=state[23];s.life=plane._airVortexLife||0;s.matrix=plane.root.local;s.wing=wing;s.area=plane.type.airframe[1];
    s.speed=state[13];s.load=state[17];s.q=aero[15];s.crashed=state[22]>.5;
    s.visible=plane.root.visible!==false&&state[36]!==4&&state[35]>2.3;
    for(let k=0;k<3;k++){s.position[k]=state[k];s.wind[k]=state[30+k];}
    s.alpha[0]=aero[0];s.alpha[1]=aero[1];
    s.lift[0]=plane.damage?.dead?.('wing_l')?0:aero[4];s.lift[1]=plane.damage?.dead?.('wing_r')?0:aero[5];
    // Explicit authored humid-scene preset until a thermodynamic weather owner exists.
    s.humidity=weather?.relativeHumidity??.86;
    s.temperatureC=weather?.temperatureC??Math.max(-56.5,18-.0065*Math.max(0,state[1]));
    slot.flow.sample(s);slot.seen=scene.time;
  }
  function write(buffer,start,cam,scene) {
    if(!scene||scene.mode!=='battle'){clear();return start;}
    let count=start;const limit=Math.min(buffer.length/9,start+maxSegments*6);
    for(const slot of slots){if(!slot.plane)continue;
      if(scene.time-slot.seen>1.5){slot.flow.reset();slot.plane=null;continue;}
      count=slot.flow.write(buffer,count,cam,slot.sample.time+Math.max(0,scene.time-slot.seen),limit);
    }
    return count;
  }
  return {samplePlane,write,clear,remove,slots};
}

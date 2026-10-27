// BEGIN AAM REALISM BUDGET
function createAamRealismBudget() {
  const G=9.80665, Q_REFERENCE=60000, EFFICIENCY=.7, TVC_FRACTION=.2;
  const tvcModels=new Set(['aim9x','irist','r73','r73e']);
  const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  function budget(def,rho,speed,requested,motorAcceleration=0) {
    const q=.5*Math.max(0,rho)*speed*speed;
    const cap=Math.max(0,def.maxG||0)*G,aeroLimit=cap*Math.min(1,q/Q_REFERENCE);
    // Capability is public; the .2 allocation is game calibration, not a
    // claimed real nozzle angle or real missile acceleration envelope.
    const motor=tvcModels.has(def.model||def.id)?Math.max(0,motorAcceleration):0;
    const limit=Math.min(cap,aeroLimit+motor*TVC_FRACTION);
    const length=Math.hypot(...requested),scale=length>limit?limit/length:1,accel=requested.map(v=>v*scale);
    const actual=Math.hypot(...accel),aeroUsed=Math.min(actual,aeroLimit),vectorUsed=Math.max(0,actual-aeroUsed);
    const span=Math.max(def.wings||0,def.canards||0,def.tailFins||0,(def.d||0)*2);
    // Public finite-wing induced-drag principle; EFFICIENCY is a declared game
    // approximation, not a measured coefficient for any particular missile.
    const induced=q>1e-6&&span>0?(def.mass||0)*aeroUsed*aeroUsed/(q*Math.PI*EFFICIENCY*span*span):0;
    const diverted=motor>0?motor-Math.sqrt(Math.max(0,motor*motor-vectorUsed*vectorUsed)):0;
    return {accel,drag:induced+diverted,availableG:limit/G};
  }
  function observationAllowed(def,pos,velocity,targetPos,targetVelocity,decoy=false) {
    if(def.kind!=='aam'||decoy)return true;
    const line=sub(targetPos,pos),distance=Math.hypot(...line),tv=Math.hypot(...targetVelocity);
    if(def.guidance==='ir'){
      const aspect=tv>1e-6?dot(targetVelocity,line)/(tv*Math.max(distance,1e-6)):0;
      if(def.rear&&aspect<.5)return false;
      if(!def.rear&&aspect<0&&distance>(def.lockRange||0)*.5)return false;
    }
    const rate=def.seeker?.trackRate;
    if(Number.isFinite(rate)&&rate>0&&Math.hypot(...cross(line,sub(targetVelocity,velocity)))/Math.max(distance*distance,1)>rate*Math.PI/180)return false;
    return true;
  }
  return Object.freeze({budget,observationAllowed});
}
var TF_AAM_REALISM=createAamRealismBudget();
// END AAM REALISM BUDGET

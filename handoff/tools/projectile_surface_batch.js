// Private, synchronous projectile-phase broadphase. Only verified exact-model
// bounds are reused. Any possible contact is a mutation barrier and uses the
// original query; unbatched callers retain all existing validation.
function createProjectileSurfaceBatch(original) {
  let active = null;
  const capture = record => {
    const c=record?.surfaceCollisionBounds,b=record?.body,m=record?.model;
    if(!c?.initialized||!Number.isSafeInteger(m?.poseSerial)||m.poseSerial<0||!record.available||!record.registered||record.registrationFailed)return null;
    const origin=b.origin(),frame=[...b.ex,...b.ey,...b.ez,...origin];
    if(frame.length!==12||!frame.every(Number.isFinite))return null;
    return {record,cache:c,model:m,serial:m.poseSerial,root:m.root,revision:record.revision,geometry:record.geometryRevision,shape:record.shapeHash,buffers:record.buffers,bufferCount:record.buffers.length,rows:record.rows,rowCount:record.rows.length,body:b,local:b.localPoint,world:b.worldPoint,origin:b.origin,frame,renderer:c.renderer,lo:Array.from(c.lo),hi:Array.from(c.hi),scale:c.arithmeticScale};
  };
  function current(s,r){
    if(!r||r!==s.record||!r.available||!r.registered||r.registrationFailed||r.model!==s.model||r.model.root!==s.root||r.model.poseSerial!==s.serial||r.revision!==s.revision||r.geometryRevision!==s.geometry||r.shapeHash!==s.shape||r.buffers!==s.buffers||r.buffers.length!==s.bufferCount||r.rows!==s.rows||r.rows.length!==s.rowCount||r.surfaceCollisionBounds!==s.cache||!s.cache.initialized||s.renderer.lost||r.body!==s.body||r.body.localPoint!==s.local||r.body.worldPoint!==s.world||r.body.origin!==s.origin)return false;
    const o=r.body.origin(),axes=[r.body.ex,r.body.ey,r.body.ez,o];
    for(let i=0;i<4;i++)for(let k=0;k<3;k++)if(axes[i]?.[k]!==s.frame[i*3+k])return false;
    return true;
  }
  function misses(s,p0,p1){
    const b=s.body,localA=b.localPoint(p0),localB=b.localPoint(p1),a=b.worldPoint(localA),z=b.worldPoint(localB),origin=s.frame.slice(9);
    let scale=s.scale,enter=0,exit=1;
    for(let k=0;k<3;k++){
      if(![a[k],z[k],s.lo[k],s.hi[k],Math.fround(localA[k]),Math.fround(localB[k])].every(Number.isFinite))return false;
      const terms=Math.abs(origin[k])+Math.abs(s.frame[k])*Math.max(Math.abs(localA[0]),Math.abs(localB[0]))+Math.abs(s.frame[3+k])*Math.max(Math.abs(localA[1]),Math.abs(localB[1]))+Math.abs(s.frame[6+k])*Math.max(Math.abs(localA[2]),Math.abs(localB[2]));
      if(!Number.isFinite(terms))return false;
      scale=Math.max(scale,terms,Math.abs(a[k]),Math.abs(z[k]),Math.abs(s.lo[k]),Math.abs(s.hi[k]));
    }
    const pad=32*2**-23*scale;
    for(let k=0;k<3;k++){
      const d=z[k]-a[k],lo=s.lo[k]-pad,hi=s.hi[k]+pad;
      if(d===0){if(a[k]<lo||a[k]>hi)return true;continue;}
      const p=(lo-a[k])/d,q=(hi-a[k])/d;enter=Math.max(enter,Math.min(p,q));exit=Math.min(exit,Math.max(p,q));if(enter>exit)return true;
    }return false;
  }
  function query(combat,key,p0,p1,tick){
    const batch=active?.combat===combat?active:null;
    if(!batch)return original(combat,key,p0,p1,tick);
    const record=combat?.surfaceOwner?.actors?.get(key);
    // Source vehicles without an exact packet keep the existing legacy path.
    // The original unregistered branch has no callbacks or model mutations,
    // so it must not flush verified snapshots belonging to different actors.
    if(!record)return original(combat,key,p0,p1,tick);
    const saved=batch.records.get(record);
    const fast=saved&&current(saved,record)&&misses(saved,p0,p1);
    const verified=fast||surfaceCollisionBoundsMiss(record,p0,p1,combat?.surfaceOwner?.renderer)===true;
    if(verified){
      if(combat.surfaceCollisionErrors?.has(key)){
        // Recovery hooks may reenter or change a different actor. They see no
        // batch, and none of the pre-hook bounds can be captured afterward.
        batch.records.clear();active=null;
        try{surfaceCollisionRecovered(combat,key);}finally{active=batch;}
      }else if(!fast){const snapshot=capture(record);if(snapshot)batch.records.set(record,snapshot);}
      return{handled:true,ready:true,contact:null,boundsCulled:true};
    }
    // Possible contacts and unavailable geometry are barriers BEFORE narrow-
    // phase and all diagnostic callbacks. Reentrant queries remain unbatched.
    batch.records.clear();active=null;
    try{return original(combat,key,p0,p1,tick);}finally{active=batch;}
  }

  return {query,run(combat,work){const previous=active;active={combat,records:new Map()};try{const result=work();if(result&&typeof result.then==='function')throw Error('Projectile collision phase must be synchronous');return result;}finally{active=null;if(previous){previous.records.clear();active=previous;}}}};
}

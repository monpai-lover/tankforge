// Fixed-pitch / free-chain adaptation of Tracklab V7 tracks.h (MIT).
// Copyright (c) 2026 Tracklab contributors. See third_party/tracklab-v7/LICENSE.
// Entity-owned, one-way presentation physics: no hull force or drivetrain writes.
import {buildLoop} from '../../gfx/track.js';
const MAX=256,GRAVITY=9.81;
function march(loop,count,pitch,offset,out){
  const n=loop.pts.length/2,length=loop.length,cum=loop.cum,pts=loop.pts;
  let start=((offset%pitch)+pitch)%pitch,s=start;
  const point=at=>{const wrap=Math.floor(at/length),local=at-wrap*length;let k=0;while(k<n-1&&cum[k+1]<local)k++;const b=(k+1)%n,f=(local-cum[k])/(cum[k+1]-cum[k]||1);return [pts[k*2]+(pts[b*2]-pts[k*2])*f,pts[k*2+1]+(pts[b*2+1]-pts[k*2+1])*f];};
  let p=point(s);out[0]=0;out[1]=p[1];out[2]=p[0];
  for(let i=1;i<=count;i++){
    let found=false,wrap=Math.floor(s/length),local=s-wrap*length,k=0;while(k<n-1&&cum[k+1]<local-1e-10)k++;
    for(let scan=0;scan<=n;scan++){
      const b=(k+1)%n,az=pts[k*2],ay=pts[k*2+1],dz=pts[b*2]-az,dy=pts[b*2+1]-ay,rz=az-p[0],ry=ay-p[1],A=dz*dz+dy*dy,B=2*(rz*dz+ry*dy),C=rz*rz+ry*ry-pitch*pitch,D=B*B-4*A*C;
      const low=Math.max(0,(s-(cum[k]+wrap*length))/(cum[k+1]-cum[k]||1));
      if(A>1e-20&&D>=0){for(const t of [(-B-Math.sqrt(D))/(2*A),(-B+Math.sqrt(D))/(2*A)])if(t>=low+1e-9&&t<=1+1e-9){s=wrap*length+cum[k]+Math.min(1,t)*(cum[k+1]-cum[k]);p=[az+dz*t,ay+dy*t];found=true;break;}}
      if(found)break;if(++k>=n){k=0;wrap++;}
    }
    if(!found)return Infinity;out[i*3]=0;out[i*3+1]=p[1];out[i*3+2]=p[0];
  }
  return s-start-length;
}
export function prepareTrackPins(rg,stations,count,pitch,lifts,offset=0,ground=null,out=null){
  const pins=out||new Float64Array((count+1)*3),fail=reason=>({supported:false,pins,loop:null,diagnostics:{reason,pitchError:Infinity,closureError:Infinity}});
  if(!Number.isInteger(count)||count<8||count>MAX||!(pitch>0&&Number.isFinite(pitch))||!Number.isFinite(offset)||!rg?.sprocket||!rg.idler||pins.length!==(count+1)*3)return fail('missing_trusted_topology');
  let best=null,bestError=Infinity,iterations=0;
  const fitBudget=150;
  // A declared toothed idler cannot jump between discrete tension branches as
  // material pins advance. Keep its authored upper sag and solve the actual
  // chord closure for continuous inward travel within the existing bounds.
  // This changes source geometry, never the shaft angle or its tooth oracle.
  if(rg.idler.teeth){
    const sag=rg.track_sag??((rg.rollers||[]).length?.012:.03),inward=rg.idler.z>0?-1:1;
    const at=shift=>{
      const gear={...rg,fixed_link_pitch:pitch,idler:{...rg.idler,z:rg.idler.z+inward*shift}};
      const loop=buildLoop(gear,stations,lifts,sag,ground);
      return {loop,residual:march(loop,count,pitch,offset,pins),shift};
    };
    let lo=at(0),hi=at(.08);iterations+=2;
    if(Number.isFinite(lo.residual)&&Number.isFinite(hi.residual)&&lo.residual*hi.residual<=0){
      for(let i=0;i<28;i++){
        const mid=at((lo.shift+hi.shift)*.5);iterations++;
        if(!Number.isFinite(mid.residual))break;
        if(Math.abs(mid.residual)<bestError){bestError=Math.abs(mid.residual);best={loop:mid.loop,sag,idlerShift:inward*mid.shift};}
        if(Math.abs(mid.residual)<1e-6)break;
        if(mid.residual*lo.residual>0)lo=mid;else hi=mid;
      }
    }
  }
  // The actual wheel positions/radii remain unchanged. Only declared upper sag and
  // the existing inward idler travel are searched, with a fixed iteration budget.
  for(const shift of best?[]:[0,.02,.04,.06,.08]){
    if(iterations+2>fitBudget)break;
    const inward=rg.idler.z>0?-1:1,gear={...rg,fixed_link_pitch:pitch,...(shift?{idler:{...rg.idler,z:rg.idler.z+inward*shift}}:{})};
    let lo=0,hi=.3,a=buildLoop(gear,stations,lifts,lo,ground),b=buildLoop(gear,stations,lifts,hi,ground),ra=march(a,count,pitch,offset,pins),rb=march(b,count,pitch,offset,pins);iterations+=2;
    if(!Number.isFinite(ra)||!Number.isFinite(rb)||ra*rb>0)continue;
    let loop=a;
    for(let i=0;i<28&&iterations<fitBudget;i++){const sag=(lo+hi)*.5;loop=buildLoop(gear,stations,lifts,sag,ground);const r=march(loop,count,pitch,offset,pins);iterations++;if(!Number.isFinite(r))break;if(Math.abs(r)<bestError){bestError=Math.abs(r);best={loop,sag,idlerShift:inward*shift};}if(Math.abs(r)<1e-6)break;if(r*ra>0){lo=sag;ra=r;}else hi=sag;}
    if(bestError<1e-6)break;
  }
  if(!best)return fail('closed_route_outside_sag_idler_bounds');
  march(best.loop,count,pitch,offset,pins);let pitchError=0;for(let i=0;i<count;i++)pitchError=Math.max(pitchError,Math.abs(Math.hypot(...[0,1,2].map(k=>pins[(i+1)*3+k]-pins[i*3+k]))-pitch));
  const closureError=Math.hypot(...[0,1,2].map(k=>pins[count*3+k]-pins[k]));
  let wheelSurfacePenetration=0;
  const wheelCore=(z,y,w,lift=0)=>{wheelSurfacePenetration=Math.max(wheelSurfacePenetration,w.r-Math.hypot(z-w.z,y-w.y-lift));};
  // Explicit cylinder-core clearance gate, including shoe centres. It catches
  // invalid old full-circle routes; it does not certify exact detailed meshes.
  const admittedIdler={...rg.idler,z:rg.idler.z+best.idlerShift};
  for(let sample=0;sample<=count*2;sample++){const a=(sample>>1)*3,b=sample&1?a+3:a,z=(pins[a+2]+pins[b+2])*.5,y=(pins[a+1]+pins[b+1])*.5;for(let i=0;i<stations.length;i++)wheelCore(z,y,stations[i],lifts?.[i]||0);wheelCore(z,y,rg.sprocket);wheelCore(z,y,admittedIdler);for(const w of rg.rollers||[])wheelCore(z,y,w);}
  const supported=pitchError<=.0005&&closureError<=.001&&wheelSurfacePenetration<=.001;
  // Preserve each original shoe's material identity across complete pitch turns.
  // The old modulo-pitch draw phase alone jumps the same shoe to its neighbour.
  const turns=((Math.floor(offset/pitch)%count)+count)%count;if(turns){const ordered=pins.slice();for(let i=0;i<count;i++){const source=((i+turns)%count)*3;pins.set(ordered.subarray(source,source+3),i*3);}pins.set(pins.subarray(0,3),count*3);}
  return {supported,pins,loop:best.loop,diagnostics:{reason:wheelSurfacePenetration>.001?'source_wheel_surface_overlap':supported?'fixed_source_pitch':'closure_residual',pitchError,closureError,wheelSurfacePenetration,sag:best.sag,idlerShift:best.idlerShift,iterations}};
}

/** Rigid original shoes, from source/chain pins; no matrix axis or mesh is scaled. */
export function placeTrackPins(pins,count,out,offset=0,cutPin=0,widthAxis=[1,0,0]){
  for(let i=0;i<count;i++){
    const a=i*3,b=a+3,o=offset+((cutPin+i)%count)*16,dx=pins[b]-pins[a],dy=pins[b+1]-pins[a+1],dz=pins[b+2]-pins[a+2],len=Math.hypot(dx,dy,dz);if(!(len>1e-10))throw new RangeError('collapsed source shoe');
    const z0=dx/len,z1=dy/len,z2=dz/len,dot=widthAxis[0]*z0+widthAxis[1]*z1+widthAxis[2]*z2;
    let x0=widthAxis[0]-dot*z0,x1=widthAxis[1]-dot*z1,x2=widthAxis[2]-dot*z2,xl=Math.hypot(x0,x1,x2);
    if(xl<1e-8){x0= -z0*z2;x1= -z1*z2;x2=1-z2*z2;xl=Math.hypot(x0,x1,x2);if(xl<1e-8){x0= -z0*z1;x1=1-z1*z1;x2= -z2*z1;xl=Math.hypot(x0,x1,x2);}}
    x0/=xl;x1/=xl;x2/=xl;
    out[o]=x0;out[o+1]=x1;out[o+2]=x2;out[o+3]=0;out[o+4]=z1*x2-z2*x1;out[o+5]=z2*x0-z0*x2;out[o+6]=z0*x1-z1*x0;out[o+7]=0;out[o+8]=z0;out[o+9]=z1;out[o+10]=z2;out[o+11]=0;
    out[o+12]=(pins[a]+pins[b])*.5;out[o+13]=(pins[a+1]+pins[b+1])*.5;out[o+14]=(pins[a+2]+pins[b+2])*.5;out[o+15]=1;
  }
  return offset+count*16;
}

export class TrackChain{
  constructor(count,pitch,radius){if(!Number.isInteger(count)||count<8||count>MAX||!(pitch>0&&radius>=0&&Number.isFinite(pitch)&&Number.isFinite(radius)))throw new RangeError('invalid source track topology');this.count=count;this.pitch=pitch;this.radius=radius;this.positions=new Float64Array((count+1)*3);this.velocities=new Float64Array(this.positions.length);this.previous=new Float64Array(this.positions.length);this.floor=new Float64Array(count+1);this.lambda=new Float64Array(count);this.bendLambda=new Float64Array(count-1);this.velocityNormals=new Float64Array(count*3);this.triDiagonal=new Float64Array(count);this.triRhs=new Float64Array(count);this.triEdge=new Float64Array(count);this.cutPin=0;this.sleeping=false;this.quiet=0;this.peakSpeed=0;this.residual=0;this.active=false;this.revision=0;this.settlePasses=0;}
  cut(pins,velocities,cutPin=0){if(this.active)return false;if(pins.length!==this.positions.length||velocities.length!==pins.length||!Number.isInteger(cutPin)||cutPin<0||cutPin>=this.count||!pins.every(Number.isFinite)||!velocities.every(Number.isFinite))throw new RangeError('invalid source pin sample');for(let i=0;i<this.count;i++){const a=i*3,b=((i+1)%this.count)*3;if(Math.abs(Math.hypot(pins[b]-pins[a],pins[b+1]-pins[a+1],pins[b+2]-pins[a+2])-this.pitch)>.0005)throw new RangeError('unvalidated source pin pitch');}if(Math.hypot(pins[this.count*3]-pins[0],pins[this.count*3+1]-pins[1],pins[this.count*3+2]-pins[2])>.001)throw new RangeError('unvalidated source pin closure');for(let i=0;i<=this.count;i++){const source=((cutPin+i)%this.count)*3;for(let k=0;k<3;k++){this.positions[i*3+k]=pins[source+k];this.velocities[i*3+k]=velocities[source+k];}}this.previous.set(this.positions);this.cutPin=cutPin;this.active=true;this.sleeping=false;this.quiet=0;this.revision++;return true;}
  // Kinematic wheel cylinders move only the chain. Source wheel/hull state is read-only.
  wheelContacts(wheels,velocity=false,h=1/240,terrain=null,wakeOnly=false){
    const p=this.positions,v=this.velocities;let touching=false;
    for(let sample=0;sample<=this.count*2;sample++){
      const mid=sample&1,a=(sample>>1)*3,b=mid?a+3:a,x=(p[a]+p[b])*.5,y=(p[a+1]+p[b+1])*.5,z=(p[a+2]+p[b+2])*.5;
      for(const w of wheels){const ax=w.axis[0],ay=w.axis[1],az=w.axis[2],dx=x-w.center[0],dy=y-w.center[1],dz=z-w.center[2],along=dx*ax+dy*ay+dz*az;if(Math.abs(along)>w.halfWidth+this.radius)continue;
        const rx=dx-along*ax,ry=dy-along*ay,rz=dz-along*az,squared=rx*rx+ry*ry+rz*rz,limit=w.radius+this.radius;if(squared>=(limit+.002)*(limit+.002)||squared<1e-18)continue;const r=Math.sqrt(squared);touching=true;
        let nx=rx/r,ny=ry/r,nz=rz/r,depth=Math.max(0,limit-r);
        // A free belt can leave the finite wheel's side. This also resolves a
        // wheel/terrain squeeze without forcing chain nodes through the floor.
        const cap=w.halfWidth+this.radius-Math.abs(along),blocked=terrain&&y+ny*depth<terrain.height(x+nx*depth,z+nz*depth)+this.radius-.0001;
        if(cap<depth||blocked){const sign=along<0?-1:1;nx=ax*sign;ny=ay*sign;nz=az*sign;depth=cap;}
        if(wakeOnly){if(depth>.002||Math.hypot(...w.velocity)>.02||Math.abs(w.omega||0)*w.radius>.02)return true;continue;}
        if(!velocity){p[a]+=nx*depth;p[a+1]+=ny*depth;p[a+2]+=nz*depth;if(mid){p[b]+=nx*depth;p[b+1]+=ny*depth;p[b+2]+=nz*depth;}}
        else{const omega=w.omega||0,sx=w.velocity[0]+omega*(ay*rz-az*ry),sy=w.velocity[1]+omega*(az*rx-ax*rz),sz=w.velocity[2]+omega*(ax*ry-ay*rx);
          for(let node=0;node<(mid?2:1);node++){const k=node?b:a;let vx=v[k]-sx,vy=v[k+1]-sy,vz=v[k+2]-sz,normal=vx*nx+vy*ny+vz*nz;if(normal<0){vx-=normal*nx;vy-=normal*ny;vz-=normal*nz;}
            const normalLeft=vx*nx+vy*ny+vz*nz,tx=vx-normalLeft*nx,ty=vy-normalLeft*ny,tz=vz-normalLeft*nz,tangent=Math.hypot(tx,ty,tz),friction=Math.min(1,.45*(Math.max(0,-normal)+GRAVITY*h)/(tangent||1));v[k]=sx+vx-tx*friction;v[k+1]=sy+vy-ty*friction;v[k+2]=sz+vz-tz*friction;}
        }
      }
    }return wakeOnly?false:touching;
  }
  groundContacts(terrain){const p=this.positions;for(let i=0;i<=this.count;i++){const k=i*3;this.floor[i]=terrain.height(p[k],p[k+2])+this.radius;p[k+1]=Math.max(p[k+1],this.floor[i]);}for(let i=0;i<this.count;i++){const a=i*3,b=a+3,floor=terrain.height((p[a]+p[b])*.5,(p[a+2]+p[b+2])*.5)+this.radius,depth=floor-(p[a+1]+p[b+1])*.5;if(depth>0){p[a+1]+=depth;p[b+1]+=depth;}}}
  positionPasses(passes,terrain,wheels,h){const p=this.positions,alpha=.0005/(h*h);
    for(let pass=0;pass<passes;pass++){
      // Compliant second-neighbour separation resists bends above 120 degrees.
      // It is finite, so contacts may fold a shoe chain rather than lock it rigid.
      for(let i=1;i<this.count;i++){const a=(i-1)*3,b=(i+1)*3,dx=p[b]-p[a],dy=p[b+1]-p[a+1],dz=p[b+2]-p[a+2],len=Math.hypot(dx,dy,dz);if(len>=this.pitch&&this.bendLambda[i-1]===0)continue;const dl=(this.pitch-len-alpha*this.bendLambda[i-1])/(2+alpha),next=Math.max(0,this.bendLambda[i-1]+dl),change=next-this.bendLambda[i-1];this.bendLambda[i-1]=next;const nx=len>1e-12?dx/len:0,ny=len>1e-12?dy/len:0,nz=len>1e-12?dz/len:1;p[a]-=nx*change;p[a+1]-=ny*change;p[a+2]-=nz*change;p[b]+=nx*change;p[b+1]+=ny*change;p[b+2]+=nz*change;}
      for(let j=0;j<this.count;j++){const i=pass&1?this.count-1-j:j,a=i*3,b=a+3,dx=p[b]-p[a],dy=p[b+1]-p[a+1],dz=p[b+2]-p[a+2],len=Math.hypot(dx,dy,dz);if(len<1e-12)continue;const error=len-this.pitch,correction=error/(2*len);this.lambda[i]-=error*.5;p[a]+=dx*correction;p[a+1]+=dy*correction;p[a+2]+=dz*correction;p[b]-=dx*correction;p[b+1]-=dy*correction;p[b+2]-=dz*correction;}
      this.groundContacts(terrain);if(wheels.length)this.wheelContacts(wheels,false,h,terrain);
    }
  }
  measureResidual(){const p=this.positions;this.residual=0;for(let i=0;i<this.count;i++){const a=i*3,b=a+3;this.residual=Math.max(this.residual,Math.abs(Math.hypot(p[b]-p[a],p[b+1]-p[a+1],p[b+2]-p[a+2])-this.pitch));}}
  solveRodVelocities(){const p=this.positions,v=this.velocities,n=this.velocityNormals,d=this.triDiagonal,r=this.triRhs,e=this.triEdge;
    // Open-chain constraint mass is tridiagonal. Thomas elimination propagates
    // grounded/wheel reactions through the whole chain in one bounded O(N) scan.
    for(let i=0;i<this.count;i++){const a=i*3,b=a+3,dx=p[b]-p[a],dy=p[b+1]-p[a+1],dz=p[b+2]-p[a+2],len=Math.hypot(dx,dy,dz)||1;n[a]=dx/len;n[a+1]=dy/len;n[a+2]=dz/len;d[i]=2;r[i]=(v[b]-v[a])*n[a]+(v[b+1]-v[a+1])*n[a+1]+(v[b+2]-v[a+2])*n[a+2];e[i]=i?-(n[a]*n[a-3]+n[a+1]*n[a-2]+n[a+2]*n[a-1]):0;if(i){const f=e[i]/d[i-1];d[i]-=f*e[i];r[i]-=f*r[i-1];}}
    r[this.count-1]/=d[this.count-1];for(let i=this.count-2;i>=0;i--)r[i]=(r[i]-e[i+1]*r[i+1])/d[i];
    for(let i=0;i<this.count;i++){const a=i*3,b=a+3;for(let j=0;j<3;j++){const impulse=n[a+j]*r[i];v[a+j]+=impulse;v[b+j]-=impulse;}}
  }
  groundVelocities(h){const p=this.positions,v=this.velocities;for(let i=0;i<=this.count;i++){const k=i*3;if(p[k+1]<=this.floor[i]+.002){v[k+1]=Math.max(0,v[k+1]);const tangent=Math.hypot(v[k],v[k+2]),factor=Math.max(0,1-.6*GRAVITY*h/(tangent||1));v[k]*=factor;v[k+2]*=factor;}}}
  step(dt,terrain,wheels=[]){
    if(!(dt>0&&dt<=1/30&&Number.isFinite(dt)))throw new RangeError('track chain requires a bounded fixed step');if(!this.active)return;
    if(this.sleeping){for(let i=0;i<=this.count;i++){const k=i*3;if(Math.abs(terrain.height(this.positions[k],this.positions[k+2])+this.radius-this.floor[i])>.002){this.sleeping=false;this.quiet=0;break;}}
      if(this.sleeping&&wheels.length&&this.wheelContacts(wheels,false,1/240,terrain,true)){this.sleeping=false;this.quiet=0;}if(this.sleeping)return;}
    const n=Math.max(1,Math.ceil(dt/(1/240))),h=dt/n;
    for(let sub=0;sub<n;sub++){
      this.previous.set(this.positions);this.lambda.fill(0);this.bendLambda.fill(0);const p=this.positions,v=this.velocities;
      for(let i=0;i<=this.count;i++){const k=i*3;v[k+1]-=GRAVITY*h;for(let j=0;j<3;j++){v[k+j]*=Math.exp(-.35*h);p[k+j]+=v[k+j]*h;}}
      // Positional correction never becomes kinetic velocity. Rod velocity impulses
      // below are dissipative; contact recovery has zero restitution.
      this.positionPasses(8,terrain,wheels,h);
      let wheelTouch=false;for(let pass=0;pass<4;pass++){this.solveRodVelocities();if(wheels.length)wheelTouch=this.wheelContacts(wheels,true,h/4,terrain)||wheelTouch;this.groundVelocities(h/4);}this.groundContacts(terrain);this.measureResidual();
      let speed=0,move=0,contact=0;for(let i=0;i<=this.count;i++){const k=i*3;if(p[k+1]<=this.floor[i]+.002)contact++;speed=Math.max(speed,Math.hypot(v[k],v[k+1],v[k+2]));move=Math.max(move,Math.hypot(p[k]-this.previous[k],p[k+1]-this.previous[k+1],p[k+2]-this.previous[k+2]));}
      this.peakSpeed=Math.max(this.peakSpeed,speed);this.quiet=speed<.08&&move<.0002&&this.residual<.003&&(contact>0||wheelTouch)?this.quiet+h:0;if(this.quiet>.6){this.settlePasses=64;this.positionPasses(64,terrain,wheels,h);this.groundContacts(terrain);this.measureResidual();if(this.residual<.0005){this.sleeping=true;v.fill(0);break;}this.quiet=0;}
    }
  }
  diagnostics(){return {active:this.active,sleeping:this.sleeping,quiet:this.quiet,peakSpeed:this.peakSpeed,pitchResidual:this.residual,cutPin:this.cutPin,revision:this.revision,settlePasses:this.settlePasses};}
}

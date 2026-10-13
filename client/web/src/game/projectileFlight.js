// One accepted V3 prototype pool shared by live ballistic rounds, missiles and replay.
import {Node} from '../gfx/math.js';
import {ProjectileVisualPool,projectileProfile,projectileDisplayTransform} from './projectileVisuals.js';
import {bulletShell} from './combat.js';
const EMPTY=[];
export function poseProjectile(node,nose,tangent,profile,diameterScale=1,lengthScale=1){
  if(node._poseProfile!==profile||node._diameterScale!==diameterScale||node._lengthScale!==lengthScale){
    const display=projectileDisplayTransform(profile,{diameterScale,lengthScale});node._poseProfile=profile;node._diameterScale=diameterScale;node._lengthScale=lengthScale;node.displayDiagnostic=display.diagnostic;
  }
  const length=Math.hypot(tangent[0],tangent[1],tangent[2])||1,zx=tangent[0]/length,zy=tangent[1]/length,zz=tangent[2]/length,h=Math.hypot(zx,zz),xx=h>1e-8?zz/h:1,xz=h>1e-8?-zx/h:0,m=node.world;
  m[0]=xx*diameterScale;m[1]=0;m[2]=xz*diameterScale;m[3]=0;
  m[4]=zy*xz*diameterScale;m[5]=(zz*xx-zx*xz)*diameterScale;m[6]=-zy*xx*diameterScale;m[7]=0;
  m[8]=zx*lengthScale;m[9]=zy*lengthScale;m[10]=zz*lengthScale;m[11]=0;m[12]=nose[0];m[13]=nose[1];m[14]=nose[2];m[15]=1;
}
export class ProjectileFlightOwner{
  // 256 missiles,64 active replay bodies and64 replacement bodies coexist during acquisition.
  constructor(renderer,catalog,{maxLive=1024,pool=null}={}){this.renderer=renderer;this.catalog=catalog;this.maxLive=maxLive;this.pool=pool||new ProjectileVisualPool(renderer,{maxPrototypes:256,reservedPrototypes:128,maxLeases:maxLive+384});this.profiles=new Map();this.mgProfiles=new WeakMap();this.live=new Map();this.nodes=[];this.present=new Set();}
  profile(shell,missile=null){const key=`${missile?.id||''}|${shell.id}|${shell.caliber_mm}`;let p=this.profiles.get(key);if(!p){p=projectileProfile(shell,missile);if(this.profiles.size>=64)this.profiles.delete(this.profiles.keys().next().value);this.profiles.set(key,p);}return p;}
  acquire(profile,stage='intact',name='projectile_body'){
    const lease=this.pool.acquire(profile,stage,{reserve:name==='replay_projectile'}),node=new Node(name);Object.defineProperty(node,'mesh',{get:()=>lease.mesh,enumerable:true});node.castShadow=false;node.projectileId=profile.id;node.projectileProfile=profile;
    let released=false;return {node,lease,release:()=>{if(released)return;released=true;this.pool.release(lease);}};
  }
  sync(shots,bullets,extraShots=EMPTY){
    this.present.clear();this.nodes.length=0;this._syncRecords(shots,false);this._syncRecords(extraShots,false);this._syncRecords(bullets,true);
    for(const[r,held]of this.live)if(!this.present.has(r)){held.release();this.live.delete(r);}
    return this.nodes;
  }
  _syncRecords(records,mg){
    for(const r of records){
      if(!r.s?.pos||!r.s.vel)continue;this.present.add(r);let held=this.live.get(r);
      if(!held){if(this.live.size>=this.maxLive)continue;try{
        let profile;if(mg){profile=this.mgProfiles.get(r.def);if(!profile){profile=this.profile({...bulletShell(r.def),kind:'mg'});this.mgProfiles.set(r.def,profile);}}else if(r.shell)profile=this.profile(r.shell);
        if(!profile)continue;held=this.acquire(profile);this.live.set(r,held);
      }catch{continue;}}
      poseProjectile(held.node,r.s.pos,r.s.vel,held.node.projectileProfile);held.node.tracer=mg?!!r.tracer:!!r.shell?.tracer;this.nodes.push(held.node);
    }
  }
  reset(){for(const h of this.live.values())h.release();this.live.clear();this.nodes.length=0;}
  contextLost(){this.pool.contextLost();}
  restoreContext(){this.pool.restoreContext(this.renderer);}
  dispose(){this.reset();this.pool.dispose();}
}

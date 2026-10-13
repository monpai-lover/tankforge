// Actual V3 replay facade: one detached session, one clock/frame, two cameras.
// Copyright (c) 2026 Replay Lab Contributors (MIT); complete supplied notice is retained.
import {MODULE_NAME,CREW_NAME} from './combat.js';
import {snapshotReplayTarget} from './replayPose.js';
import {createReplaySession} from './replaySession.js';
import {ProjectileFlightOwner} from './projectileFlight.js';
import {ReplayDraw} from '../gfx/replayDraw.js';
import {validateReplayEvidence} from './replayEvidence.js';
const escapeHtml=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const same=(a,b)=>a&&b&&a.battle===b.battle&&a.entity===b.entity&&a.life===b.life;
export class HitCam{
  constructor(env){
    this.env=env;this.root=env.root;this.cur=null;this.deferred=[];this.serial=0;this.drawSerial=0;this.presentationIds=new WeakMap();this.projectile=null;
    this.projectiles=env.projectiles||new ProjectileFlightOwner(env.renderer,env.catalog||{});this.ownsProjectiles=!env.projectiles;
    this.root.hidden=true;this.root.innerHTML='<div class="hc-frame"><span class="hc-who"></span><b class="hc-title"></b><span class="hc-trust" style="position:absolute;right:6px;top:27px;font-size:10px;opacity:.8"></span></div><div class="hc-foot"><span class="hc-mods"></span><span class="hc-crew"></span></div>';
    this.el=Object.fromEntries(['frame','who','title','mods','crew','trust'].map(k=>[k,this.root.querySelector(`.hc-${k}`)]));
  }
  get active(){return !!this.cur&&!this.cur.session.finished;}
  get victimActive(){return this.active&&this.cur.session.purpose==='victim';}
  _presentation(target,rep,shell,mg){
    let id=this.presentationIds.get(rep);if(!id){id=`presentation:${++this.serial}`;this.presentationIds.set(rep,id);}
    const body=target.body,time=Number.isFinite(target.time_s)?target.time_s:0,actor=target.actor||{battle:0,entity:0,life:0};
    const projectileId=shell?.id||`display:${mg?'mg':shell?.kind||'ap'}:${shell?.caliber_mm||rep.caliber_mm||75}`,displayShell={...shell,id:projectileId,kind:mg?'mg':shell?.kind||'ap',caliber_mm:shell?.caliber_mm||rep.caliber_mm||75,length_mm:shell?.length_mm||(shell?.caliber_mm||75)*4};
    return {authority:'analysis',actor,event_id:id,shot_id:id,commit_seq:this.serial,state_after_version:this.serial,projectile_id:projectileId,build_hash:target.modelId||'legacy:unverified_build',anatomy_hash:'legacy:unverified_anatomy',impact_time_s:time,launch_time_s:time,accepted_pose:{trust:'private_impact_pose',hull_origin:body.worldPoint([0,0,0]),ex:body.worldDir([1,0,0]),ey:body.worldDir([0,1,0]),ez:body.worldDir([0,0,1]),joints:[]},report:rep,flight:[],segments:[],deaths:[],mechanism_records:[],presentation_shell:displayShell};
  }
  show(target,rep,shell,dist,mg=false,detail='',purpose=target.actor?'offensive':'analysis'){
    if(!rep?.impact)return false;const evidence=rep.replay||this._presentation(target,rep,shell,mg);
    if(evidence.authority!=='analysis'&&!validateReplayEvidence(evidence,target.actor||evidence.actor).ok)return false;
    const current=this.cur;
    if(current&&purpose!=='analysis'&&same(current.session.actor,evidence.actor)&&(evidence.actor.entity>0||current.sourceModel===target.model)){
      const result=current.session.append(evidence);if(!result.accepted)return false;current.rep=rep;current.shell=shell;current.mg=mg;current.dist=dist;current.frame=null;this._summary(target,rep,shell,dist,detail);
      if(purpose==='victim'){current.session.purpose='victim';current.session.promoteVictim(evidence.deaths.at(-1));}return true;
    }
    if(this.victimActive&&purpose!=='victim')return false;
    if(current&&purpose!=='analysis'&&purpose!=='victim'){this._defer(target,rep,shell,dist,mg,detail,purpose);return false;}
    let snapshot,draw,session,prepared;
    try{
      snapshot=snapshotReplayTarget(this.env.renderer,target,rep,rep.replay?.accepted_pose||null);draw=new ReplayDraw(this.env.renderer,snapshot,this.projectiles);
      session=createReplaySession(this.env.renderer,snapshot,evidence,purpose,{catalog:this.env.catalog||{},draw,onPressure:this.env.onPressure,onFinish:reason=>this.env.onFinish?.(reason,session?.purpose||purpose)});
      prepared=draw.prepare(session.prepareFrame(`acquire:${this.serial}`));
    }catch{draw?.dispose();snapshot?.dispose();if(purpose==='victim')this.env.onFinish?.('acquisition_failed','victim');return false;}
    const cur={target:snapshot,sourceModel:target.model,rep,shell,dist,mg,session,draw,cam:null,frame:null,rectPx:null};
    Object.defineProperties(cur,{t:{get:()=>session.filmTimeS,set:t=>{if(session.purpose!=='analysis'&&t<session.filmTimeS)throw Error('runtime replay cannot rewind');session.filmTimeS=t;session.frameId=null;}},total:{get:()=>session.endFilm+1.5}});
    current?.session.finish('replaced');this.cur=cur;const body=prepared.nodes.find(n=>n.name==='replay_projectile');this.projectile=body?{shell:body,jet:{visible:false}}:null;if(purpose==='victim')session.promoteVictim(evidence.deaths.at(-1));this._summary(target,rep,shell,dist,detail);return true;
  }
  showVictim(target,evidence,shell){return this.show(target,{...evidence.report,replay:evidence},shell,0,shell?.caliber_mm<20,'','victim');}
  _defer(target,rep,shell,dist,mg,detail,purpose){
    const row={target,rep,shell,dist,mg,detail,purpose};let group=this.deferred.find(q=>same(q.actor,target.actor)||(q.sourceModel===target.model&&!target.actor));
    if(!group){group={actor:target.actor,sourceModel:target.model,rows:[]};this.deferred.push(group);if(this.deferred.length>4){this.deferred.shift();this.env.onPressure?.();}}
    const id=rep.replay?.event_id,i=group.rows.findIndex(q=>id?q.rep.replay?.event_id===id:q.rep===rep);
    if(i>=0)group.rows[i]=row;else group.rows.push(row);
    if(group.rows.length>64){const at=group.rows.findIndex(q=>!q.rep.replay?.deaths.length&&q.rep.replay?.report.state.active_fire_cause?.source_event_id!==q.rep.replay?.event_id);group.rows.splice(at<0?0:at,1);this.env.onPressure?.();}
  }
  _summary(target,rep,shell,dist,detail){
    this.el.mods.innerHTML=(rep.modules||[]).filter(m=>m.damage>0||m.destroyed||m.health<=m.max_health*.5).map(m=>`<i data-dead="${m.destroyed?1:0}">${escapeHtml(target.moduleLabels?.get(m.id)||MODULE_NAME[m.kind]||m.kind)} ${m.destroyed?'損毀':'受損'}</i>`).join('');
    this.el.crew.innerHTML=(rep.crew||[]).map(c=>`<i data-dead="${c.killed?1:0}">${CREW_NAME[c.role]||c.role}${c.killed?'':' 受傷'}</i>`).join('');
    const terminal=rep.replay?.deaths?.at(-1);this.el.title.textContent=terminal?`載具已擊毀 · ${terminal.reason==='fire'?'火災':rep.title}`:rep.title;this.el.title.dataset.bad=terminal||rep.caps?.destroyed?'2':(rep.crew?.length||rep.modules?.some(m=>m.destroyed))?'1':'0';
    this.el.who.textContent=`${target.name||''}　${shell?.name||shell?.id||''}${dist?`　${Math.round(dist)} m`:''}${detail?`　${detail}`:''}`;
    this.el.trust.textContent=!rep.replay?'接觸狀態示意 · 未記錄飛行時間':rep.replay?.segments?.length?'彈體放大示意':'未記錄完整飛行時間';
  }
  hide(reason='manual_exit'){this.cur?.session.finish(reason);this.cur=null;this.deferred.length=0;this.projectile=null;this.root.hidden=true;}
  tick(dt){if(!this.cur)return;this.cur.session.tick(dt);if(this.cur.session.finished){this.cur=null;this.projectile=null;this.root.hidden=true;const next=this.deferred.shift();if(next)for(const row of next.rows)this.show(row.target,row.rep,row.shell,row.dist,row.mg,row.detail,row.purpose);}}
  stage(){const c=this.cur;if(!c)return{name:'hold',k:1};const f=c.frame||c.session.prepareFrame(`stage:${this.drawSerial}`),e=f.event;return{name:f.physicalS<e.contact_s?'approach':c.t>=c.session.endFilm?'hold':'xray',k:1};}
  rect(frame){const s=frame.scale,w=Math.min(frame.cw*.34,470*s),h=w*.56,at=this.place?.(frame,w,h);return at?(at.length===4?at:[at[0],at[1],w,h]):[frame.cw-w-16*s,96*s,w,h];}
  prepareFrame(frameId){if(!this.active)return null;this.cur.frame=this.cur.session.prepareFrame(frameId);return this.cur.frame;}
  render3d(frame){
    if(!this.active)return;
    try{const c=this.cur,f=this.prepareFrame(frame.frameId??++this.drawSerial),prepared=c.draw.prepare(f),rect=this.rect(frame);
    const camera=(r,purpose)=>({...c.session.camera(f,r,purpose),W:p=>c.target.body.worldPoint(p),Wd:p=>c.target.body.worldDir(p),stage:this.stage()});
    if(this.victimActive){const full=[0,0,frame.cw,frame.ch],cam=camera(full,'victim');this.env.renderer.renderInset(prepared.nodes,cam,full,{sky:false,backdrop:[.012,.018,.024],replayDraw:prepared,frame:f,owner:'replay-full'});}
    const cam=camera(rect,'corner');c.cam=cam;c.rectPx=rect;this.env.renderer.renderInset(prepared.nodes,cam,rect,{sky:false,backdrop:[.105,.113,.125],replayDraw:prepared,frame:f,owner:'replay-corner'});
    const shell=prepared.nodes.find(n=>n.name==='replay_projectile');this.projectile=shell?{shell,jet:{visible:false}}:null;
    }catch(error){this.env.onError?.(error);this.hide('renderer_unavailable');}
  }
  // GPU owns all traces/pieces. No legacy plate/body contour or synthetic 2D burst.
  draw2d(ctx,frame){if(!this.active||!this.cur.cam)return;const [x,y,w,h]=this.cur.rectPx,s=frame.scale||1,css=v=>`${(v/s).toFixed(1)}px`;this.root.hidden=false;this.root.style.left=css(x);this.root.style.top=css(y);this.root.style.width=css(w);this.el.frame.style.height=css(h);this.root.style.opacity='1';this.root.dataset.stage=this.stage().name;}
  contextLost(){if(this.ownsProjectiles)this.projectiles.contextLost();}
  restoreContext(ok){if(ok){if(this.ownsProjectiles)this.projectiles.restoreContext();}else this.hide('renderer_unavailable');}
}

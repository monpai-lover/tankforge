// Existing sensor controls produce intent only. Native snapshots own acquisition,
// readiness, launch, ammunition, flight guidance, fuze and damage.
function createFrontlineGuidedControl({group,resolve,targets,reason,activate,pod,podTrack,capture,cancel,nose,now=()=>typeof G4!=='undefined'&&Number.isFinite(G4.time)?G4.time:0,epoch=()=>null}) {
  let life=null,controlEpoch=null,enabled=false,powerOffRequested=false,accepted=null,lastAir=null,lastReleaseStamp=null,cancelledRadioShot=null,selectedStore=null,pendingSight=null,pendingFromPod=false,designationReleased=false,pendingCapture=false,pendingCaptureSeq=null,captureRejected=null;
  const manual=[0,0];
  const key=r=>r&&[r.battle,r.unit,r.life].every(v=>Number.isSafeInteger(v)&&v>=0)?`${r.battle}:${r.unit}:${r.life}`:null;
  const modes=new Set(['ir','sarh','arh','aim54','tv','iir','laser','beam','radio','arm']);
  const guided=d=>!!d&&modes.has(d.guidance);
  const pointGuided=d=>!!d&&d.kind!=='aam'&&['tv','iir','laser','beam'].includes(d.guidance);
  const explain=code=>typeof nativeGroundGuidanceReason==='function'?nativeGroundGuidanceReason(code,typeof L10N==='function'?L10N:undefined):code;
  const vector=v=>v&&v.length===3&&Array.from(v).every(n=>Number.isFinite(n)&&Math.abs(n)<=1e8);
  const direction=v=>{if(!vector(v))return null;const n=Math.hypot(...v);return n>1e-9?Array.from(v,x=>x/n):null;};
  function clearPoint(air=lastAir,preservePod=false){
    pendingSight=null;pendingFromPod=false;pendingCapture=false;pendingCaptureSeq=null;captureRejected=null;
    const sk=air?.ctl?.seeker,p=air?.ctl?.pod;
    if(sk){if(sk.point)sk.est=null;sk.point=null;}
    if(!preservePod&&p?.point){p.point=null;p.est=null;if(p.state==='point')p.state='free';}
  }
  function waitForCapture(air){
    pendingCapture=true;pendingCaptureSeq=null;captureRejected=null;
    air.storeTap=false; // A pre-capture press is discarded, never queued for ACK.
    const sk=air.ctl?.seeker;if(sk){sk.nativeStatus='prep';sk.nativeProgress=0;sk.nativeReason='point_capture_pending';sk.why=explain(sk.nativeReason);}
  }
  function captureIntent(air,perform,view){
    // Sample the explicit capture direction once. A server projection or the
    // aircraft moving later must not turn a fixed-point request into a new ray.
    const d=group(air)?.def,sight=direction(view?.dir),result=perform(air),cfg=typeof seekerOf==='function'?seekerOf(d):d?.seeker;
    const observed=result===true&&resolve(view?.cand||view?.target)?.unitRef;
    pendingSight=null;pendingFromPod=false;pendingCapture=false;pendingCaptureSeq=null;
    if(pointGuided(d)&&sight&&!key(observed)&&!(cfg?.daylight&&typeof daylight==='function'&&!daylight())){
      // Local terrain/LOS cannot veto a native facility/terrain ray. No local
      // point, estimate or ready state is synthesized when that display fails.
      pendingSight=sight;pendingFromPod=view===pod(air);designationReleased=false;waitForCapture(air);
      if(result!==true)reason(air,typeof L10N==='function'?L10N('已请求服务器捕获瞄准点','ground capture requested from the server'):'ground capture requested from the server');
      return true;
    }
    return result;
  }
  function target(value,unit){
    const known=resolve(value),ref=known?.unitRef;
    return key(ref)&&ref.battle===unit.unit.battle?{battle:ref.battle,unit:ref.unit,life:ref.life}:null;
  }
  function clear(){
    if(lastAir?.ctl?.radio?.native){lastAir.ctl.radio=null;lastAir.ctl.holdAim=null;}
    clearPoint();selectedStore=null;controlEpoch=null;designationReleased=false;powerOffRequested=false;
    life=null;enabled=false;accepted=null;lastAir=null;lastReleaseStamp=null;cancelledRadioShot=null;manual[0]=manual[1]=0;
  }
  function bind(air,unit){
    const next=key(unit?.unit);if(!next)return false;
    const requestedEpoch=epoch(),nextEpoch=Number.isSafeInteger(requestedEpoch)?requestedEpoch:Number.isSafeInteger(unit.epoch)?unit.epoch:null;
    if(life!==next||controlEpoch!==nextEpoch){clear();life=next;controlEpoch=nextEpoch;enabled=unit.seeker?.enabled===true;}
    const current=group(air),store=current?.items?.length?current.id:null;
    // Losing/changing the carried weapon clears its request, not the separate
    // pod designator which may still support an already airborne laser weapon.
    if(selectedStore!==store){if(selectedStore!==null)clearPoint(air,true);selectedStore=store;}
    lastAir=air;return true;
  }
  function selectionMatches(air,unit){
    const control=unit?.weapon_control,g=group(air);
    // A changed selected source must wait for its accepted control echo.
    return !!g&&control?.store_id===g.id&&control?.store_index==null;
  }
  function project(air,unit){
    const host=unit?.seeker,sk=air?.ctl?.seeker;
    if(!host||!sk)return;
    const d=group(air)?.def,definition=guided(d)?d:null,matched=!!definition&&selectionMatches(air,unit);
    if(sk.def!==definition)Object.assign(sk,{def:definition,state:'off',t:0,target:null,cand:null,est:null,point:null,cue:null,slew:null,look:null,dir:nose(air.plane)});
    const hostStatus=['off','prep','search','capturing','track','ready'].includes(host.status)?host.status:'off';
    const status=matched?(powerOffRequested?'off':pendingCapture?'prep':captureRejected?'search':hostStatus):definition&&enabled?'prep':'off';
    sk.state=status;sk.t=matched&&Number.isFinite(host.progress_s)?Math.max(0,host.progress_s):0;
    sk.target=matched&&host.target?resolve(host.target):null;sk.cand=status==='capturing'?sk.target:null;
    const wasPoint=!!sk.point,point=!pendingCapture&&!captureRejected&&enabled&&matched&&pointGuided(definition)&&vector(host.point)?Array.from(host.point):null;
    sk.point=point;
    if(point){
      sk.target=sk.cand=null;sk.est={p:point.slice(),v:[0,0,0],t:now()};
    }
    else if(wasPoint)sk.est=null;
    const p=air.ctl.pod,hasDesignation=Object.hasOwn(host,'designation_point');
    const designation=hasDesignation?(host.laser===true&&vector(host.designation_point)?Array.from(host.designation_point):null)
      :point&&p&&(d.guidance==='laser'&&p.cfg?.laser||d.guidance==='beam'&&p.cfg?.beam)?point:null;
    if(p&&(p.cfg?.laser||p.cfg?.beam)&&!designationReleased&&designation){
      p.state='point';p.point=designation.slice();p.target=null;p.est={p:designation.slice(),v:[0,0,0],t:now()};p.nativeDesignation=true;
    }else if(p?.nativeDesignation&&hasDesignation&&!designation&&!pendingFromPod){p.point=p.est=null;p.state='free';p.nativeDesignation=false;}
    const why=pendingCapture?'point_capture_pending':captureRejected|| (matched?host.reason||null:definition?'等待服务器确认所选武器':null);
    sk.nativeStatus=status;sk.nativeProgress=sk.t;sk.nativeReason=why;sk.why=why&&pointGuided(d)?explain(why):why;
  }
  function accept(air,unit,missiles=[]){
    if(!bind(air,unit))return;
    if(pendingCapture&&pendingCaptureSeq!==null&&Number.isSafeInteger(unit.seeker?.accepted_capture_seq)&&unit.seeker.accepted_capture_seq>=pendingCaptureSeq){
      pendingCapture=false;pendingCaptureSeq=null;pendingSight=null;pendingFromPod=false;
    }
    accepted=unit.seeker||null;project(air,unit);
    const radio=missiles.find(row=>row.shooter===unit.unit.unit&&row.phase==='radio'&&row.shot_id!==cancelledRadioShot);
    const ctl=air.ctl;
    if(ctl&&radio){
      if(!ctl.radio?.native||ctl.radio.shot_id!==radio.shot_id){manual[0]=manual[1]=0;ctl.radio={native:true,shot_id:radio.shot_id,guide:{phase:'radio',cmd:[0,0]}};ctl.holdAim=nose(air.plane);}
    }else if(ctl?.radio?.native){ctl.radio=null;ctl.holdAim=null;manual[0]=manual[1]=0;}
  }
  function intent(air,unit){
    if(!bind(air,unit))return null;
    const ctl=air.ctl||{},sk=ctl.seeker||{},rd=ctl.radar,p=ctl.pod,d=group(air)?.def;
    const laser=!!p?.cfg&&(p.cfg.laser===true||p.cfg.beam===true)&&(['acq','track','memory','point'].includes(p.state)||!!(pendingSight&&pendingFromPod));
    let requested;
    if(['sarh','arh','aim54'].includes(d?.guidance))requested=rd?.stt?.target||ctl.selected;
    else if(['laser','beam'].includes(d?.guidance))requested=p?.target||sk.target||sk.cand||ctl.selected;
    else requested=sk.target||sk.cand||p?.target||ctl.selected;
    // A spent station can still illuminate an already airborne native missile.
    if(!guided(d))requested=rd?.stt?.target||p?.target||requested||accepted?.requested;
    const point=enabled&&pointGuided(d)&&(pendingSight||captureRejected||selectionMatches(air,unit)&&vector(unit.seeker?.point))
      ||laser&&p?.state==='point'&&vector(p.point)&&(pointGuided(d)||!guided(d));
    // Enabled with no new sight/UnitRef preserves an accepted server point on
    // rejoin or unrelated ECM/radar/manual changes. Only explicit capture sends
    // sight, never a client coordinate, and stale selected targets cannot win.
    return {enabled,radar:rd?.on===true,target:point?null:target(requested,unit),laser,
      ...(enabled&&pointGuided(d)&&pendingSight?{sight:pendingSight.slice()}:{}),
      ecm:air.ecmOff!==true&&!!air.stores?.items.some(it=>!it.gone&&(it.def?.kind==='ecm'||it.def?.jam)),manual:manual.slice()};
  }
  function action(air,unit,name,stamp){
    if(!bind(air,unit))return undefined;
    const ctl=air.ctl||{},sk=ctl.seeker||{},g=group(air),d=g?.def;
    if(name==='podCenter'){
      designationReleased=true;if(pendingFromPod)clearPoint(air,true);
      return undefined; // Original podCenter still owns its camera direction.
    }
    if(name==='seekerOff'||name==='cancel'){
      if(name==='cancel'&&ctl.radio?.native)cancelledRadioShot=ctl.radio.shot_id;
      enabled=false;powerOffRequested=true;manual[0]=manual[1]=0;
      const wasPodPoint=ctl.pod?.state==='point'&&vector(ctl.pod.point);
      if(name==='cancel')cancel(air);else{sk.state='off';sk.target=sk.cand=null;}
      if(name==='cancel'&&wasPodPoint&&ctl.pod?.state!=='point')designationReleased=true;
      clearPoint(air,true);
      return true;
    }
    if(name==='targetNext'&&d?.guidance==='arm'){
      const list=targets().filter(t=>target(t,unit));if(!list.length)return reason(air,'没有当前可见的原生目标');
      ctl.selected=list[(list.indexOf(ctl.selected)+1)%list.length];return true;
    }
    if(!guided(d))return undefined;
    if(name==='fire'){
      if(pendingCapture)return reason(air,explain('point_capture_pending'));
      // The input bit requests release. Never call launchGuided/releaseStore here.
      if(stamp!=null&&stamp===lastReleaseStamp)return false;lastReleaseStamp=stamp??null;
      air.storeTap=true;return true;
    }
    if(name==='seekerPower'){
      enabled=!enabled;powerOffRequested=!enabled;if(enabled){activate(air);sk.def=d;}else{sk.state='off';sk.target=sk.cand=null;clearPoint(air,true);}
      return true;
    }
    if(name!=='space')return undefined;
    const p=pod(air);
    if(d.kind!=='aam'&&p&&p.state==='free'&&ctl.sensor!=='seeker'){
      enabled=true;powerOffRequested=false;sk.def=d;return captureIntent(air,podTrack,p);
    }
    if(pointGuided(d)&&p?.state==='point'&&vector(p.point)&&ctl.sensor!=='seeker'&&!pendingSight
      &&!(selectionMatches(air,unit)&&vector(unit.seeker?.point)&&!captureRejected)){
      // A new store may explicitly capture the existing designator direction;
      // it receives a fresh native prep/capture cycle, never the old readiness.
      const sight=direction(p.dir);if(!sight)return false;
      enabled=true;powerOffRequested=false;sk.def=d;pendingSight=sight;pendingFromPod=true;designationReleased=false;waitForCapture(air);return true;
    }
    if(!enabled){enabled=true;powerOffRequested=false;activate(air);sk.def=d;return true;}
    if(d.kind==='aam'&&selectionMatches(air,unit)&&['track','ready'].includes(accepted?.status)){
      if(stamp!=null&&stamp===lastReleaseStamp)return false;lastReleaseStamp=stamp??null;air.storeTap=true;return true;
    }
    if(!['arm','radio','laser','beam'].includes(d.guidance)&&d.kind!=='aam'&&sk.state==='search')return captureIntent(air,capture,sk);
    return reason(air,accepted?.reason?(pointGuided(d)?explain(accepted.reason):accepted.reason):(['track','ready'].includes(accepted?.status)?'原生导引已就绪：使用原发射键投放':'等待服务器导引头准备或捕获'));
  }
  function radioSteer(air,dx,dy,dt=1/60){
    if(!air?.ctl?.radio?.native||!Number.isFinite(dx)||!Number.isFinite(dy)||!Number.isFinite(dt))return false;
    const ease=Math.exp(-Math.max(0,Math.min(.25,dt))*.8);
    manual[0]=Math.max(-1,Math.min(1,manual[0]*ease-dy*.004));
    manual[1]=Math.max(-1,Math.min(1,manual[1]*ease+dx*.004));
    const cmd=air.ctl.radio.guide.cmd;cmd[0]=manual[1];cmd[1]=manual[0];return true;
  }
  function neutral(air){manual[0]=manual[1]=0;if(air?.ctl?.radio?.native)air.ctl.radio.guide.cmd[0]=air.ctl.radio.guide.cmd[1]=0;}
  function sent(seq){if(pendingCapture&&pendingCaptureSeq===null&&Number.isSafeInteger(seq)&&seq>0)pendingCaptureSeq=seq;}
  function reject(why){
    if(!pendingCapture)return false;
    // A refusal is terminal for this request, not an automatic retry. Keep the
    // old host track denied until a fresh explicit capture receives its own ACK.
    clearPoint(lastAir,true);captureRejected=typeof why==='string'&&why?why:'no_valid_point_in_seeker';
    const sk=lastAir?.ctl?.seeker;if(sk){sk.state=sk.nativeStatus='search';sk.nativeReason=captureRejected;sk.why=explain(captureRejected);}
    return true;
  }
  return {accept,project,intent,action,radioSteer,neutral,clear,sent,reject};
}

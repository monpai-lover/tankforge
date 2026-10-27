// Reviewable transforms for the actual bundled AGM readiness presentation.
// This does not grant launch, ammunition, guidance, collision or damage authority.
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
export function nativeGroundGuidanceReason(code,L10N=(zh,en)=>typeof LANG!=='undefined'&&LANG==='en'?en:zh) {
  const messages={
    no_valid_target_in_seeker:['未捕获地面目标：对准目标并按空格锁定','no ground target captured: aim the seeker and press Space'],
    seeker_not_locked_or_ready:['导引头尚未锁定或准备完成','seeker is not locked or ready'],
    laser_designator_required:['请先用吊舱追踪目标并开启雷射照射','track the target with the pod and enable its laser'],
    laser_designator_not_fitted_or_destroyed:['未安装可用的雷射指示器','no operational laser designator fitted'],
    beam_sight_not_fitted_or_destroyed:['未安装可用的雷射驾束瞄准系统','no operational beam-riding sight fitted'],
    radio_missile_already_controlled:['已有一枚指令飞弹在操控中','a command missile is already under control'],
    invalid_native_guidance_config:['当前挂载的导引配置无效','the selected store has an invalid guidance configuration'],
    invalid_point_sight:['瞄准方向无效，请重新对准并捕获目标','invalid sight direction: aim and capture the target again'],
    conflicting_point_target:['目标选择冲突，请重新捕获一个目标或地面点','conflicting target selection: capture one target or ground point again'],
    point_guidance_unsupported:['当前挂载不支持地面点捕获','the selected store does not support ground-point capture'],
    point_no_surface_contact:['瞄准方向的武器距离内没有地面或设施，请重新对准','no ground or facility within weapon range along the sight: aim again'],
    point_below_minimum_range:['地面点距离过近，请选择更远的瞄准点','the ground point is below minimum range: select a farther point'],
    point_outside_gimbal:['地面点超出导引头转动范围，请调整机头方向','the ground point is outside the seeker gimbal: adjust aircraft heading'],
    point_blocked:['地面点视线被遮挡，请重新选择清晰瞄准点','line of sight to the ground point is blocked: select a clear point'],
    no_valid_point_in_seeker:['地面点已离开有效视场或被遮挡，请重新捕获','the ground point is no longer visible or in range: capture it again'],
    point_capture_pending:['等待服务器确认新的瞄准点','waiting for the server to confirm the new capture'],
  };
  const known=typeof code==='string'&&Object.hasOwn(messages,code)?messages[code]:['服务器未确认发射条件，请重新捕获目标','Launch conditions were not confirmed. Reacquire the target.'];
  return L10N(...known);
}
export function nativeAgmLaunchCheck(air,d,sk,L10N) {
  if(['bomb','rocket','pod'].includes(d.kind)&&(!d.guidance||d.guidance==='none'))return {ok:true,native:true,unguided:true};
  if(sk.def!==d||!sk.nativeStatus)return {ok:false,reason:L10N('等待服务器确认所选武器','waiting for the accepted weapon selection')};
  if(sk.nativeReason)return {ok:false,reason:nativeGroundGuidanceReason(sk.nativeReason,L10N)};
  if(sk.nativeStatus==='track'||sk.nativeStatus==='ready'&&d.guidance==='radio')return {ok:true,native:true};
  const status={off:['导引头未开启（空格）','seeker off (Space)'],prep:['导引头准备中','seeker preparing'],
    capturing:['正在捕获目标','capturing target'],search:['未捕获地面目标：对准目标并按空格锁定','no ground target captured: aim the seeker and press Space']};
  return {ok:false,reason:L10N(...(status[sk.nativeStatus]||['等待服务器确认导引状态','waiting for accepted guidance state']))};
}

function functionRange(source,name) {
  const marker='function '+name+'(',start=source.indexOf(marker);
  if(start<0||source.lastIndexOf(marker)!==start)throw Error('Expected one actual '+name+' function');
  let parens=0,closed=-1;
  for(let i=source.indexOf('(',start);i<source.length;i++){if(source[i]==='(')parens++;if(source[i]===')'&&!--parens){closed=i;break;}}
  const body=source.indexOf('{',closed);let depth=0,quote=null,escape=false,line=false,block=false;
  for(let i=body;i<source.length;i++){
    const c=source[i],n=source[i+1];
    if(line){if(c==='\n')line=false;continue;}if(block){if(c==='*'&&n==='/'){block=false;i++;}continue;}
    if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote=null;continue;}
    if(c==='/'&&n==='/'){line=true;i++;continue;}if(c==='/'&&n==='*'){block=true;i++;continue;}
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}if(c==='{')depth++;if(c==='}'&&!--depth)return {start,end:i+1,text:source.slice(start,i+1)};
  }
  throw Error('Unclosed actual '+name+' function');
}
export function patchNativeGroundPointControl(source,helperSource) {
  const before=functionRange(source,'createFrontlineGuidedControl'),after=functionRange(helperSource,'createFrontlineGuidedControl');
  source=source.slice(0,before.start)+after.text+source.slice(before.end);
  const old='cancel:airCancel,nose:noseOf}):null;',next='cancel:airCancel,nose:noseOf,epoch:()=>f.epoch}):null;';
  if(source.includes(next)){if(source.split(next).length!==2)throw Error('Duplicate native control epoch hook');}
  else{if(source.split(old).length!==2)throw Error('Expected one native control constructor epoch hook');source=source.replace(old,next);}
  const send="send({op:'air_seeker_control',unit:unit.unit,epoch:f.epoch,seq:++f.seq,...seeker});seekerSignature=nextSeekerSignature;";
  const sent="send({op:'air_seeker_control',unit:unit.unit,epoch:f.epoch,seq:++f.seq,...seeker});guided?.sent?.(f.seq);seekerSignature=nextSeekerSignature;";
  if(source.includes(sent)){if(source.split(sent).length!==2)throw Error('Duplicate native capture send-sequence hook');}
  else{if(source.split(send).length!==2)throw Error('Expected one native seeker send-sequence hook');source=source.replace(send,sent);}
  const oldReject='function rejectSeekerControl(){cancelReleaseIntent();}',newReject='function rejectSeekerControl(reason){cancelReleaseIntent();if(guided?.reject?.(reason))seekerSignature=null;}';
  if(source.includes(newReject)){if(source.split(newReject).length!==2)throw Error('Duplicate native seeker refusal hook');}
  else{if(source.split(oldReject).length!==2)throw Error('Expected one native seeker refusal hook');source=source.replace(oldReject,newReject);}
  return source;
}
function patchSeekerErrorFeedback(source){
  const marker='          const feedback=',at=source.indexOf(marker),end=source.indexOf('\n',at);
  if(at<0||source.lastIndexOf(marker)!==at||end<at)throw Error('Expected one native error feedback owner');
  const line=source.slice(at,end),hook="m.code==='seeker_control_rejected'?nativeGroundGuidanceReason(m.message,typeof L10N==='function'?L10N:undefined):m.message;";
  if(line.includes(hook))return source;
  const old=':m.message;';if(line.split(old).length!==2)throw Error('Original native error feedback fallback differs');
  return source.slice(0,at)+line.replace(old,':'+hook)+source.slice(end);
}
export function patchAgmLaunchFeedback(source) {
  const marker='    function launchCheck(air) {';
  if(source.indexOf(marker)<0||source.indexOf(marker)!==source.lastIndexOf(marker))throw Error('Expected one actual launchCheck owner');
  const stale='      if (G4.online && d.kind !== "aam") return { ok: false, reason: L10N("線上暫不支援對地武器（下一階段）", "air-to-ground stores are not online yet") };';
  if(source.split(stale).length!==2)throw Error('Original AGM online gate changed; review required');
  const oldGate='      if (air.nativeAuthority && d.kind === "agm") return nativeAgmLaunchCheck(air, d, sk, L10N);';
  const newGate='      if (air.nativeAuthority && ["agm","bomb","rocket","pod"].includes(d.kind)) return nativeAgmLaunchCheck(air, d, sk, L10N);';
  if(source.includes('// TF_NATIVE_AGM_LAUNCH_READINESS_20261027')){
    const prior=functionRange(source,'nativeAgmLaunchCheck'),replacement=nativeAgmLaunchCheck.toString();
    if(prior.text!==replacement&&sha(prior.text)!=='49d4c2c469873cf0b3bc7ee37dc3f860635de8825017dd7c1e7d947d63f1b33d')throw Error('Previous AGM readiness helper hash differs; preserve and review');
    source=source.slice(0,prior.start)+replacement+source.slice(prior.end);
    if(source.includes('function nativeGroundGuidanceReason(')){
      if(functionRange(source,'nativeGroundGuidanceReason').text!==nativeGroundGuidanceReason.toString())throw Error('Ground guidance reason helper differs; preserve and review');
    }else source=source.replace('function nativeAgmLaunchCheck(',nativeGroundGuidanceReason.toString()+'\n    function nativeAgmLaunchCheck(');
    if(source.includes(newGate)){if(source.split(newGate).length!==2)throw Error('Duplicate native ground readiness hook');}
    else{if(source.split(oldGate).length!==2)throw Error('Previous native AGM readiness gate differs');source=source.replace(oldGate,newGate);}
    return patchSeekerErrorFeedback(source);
  }
  const helper='    // TF_NATIVE_AGM_LAUNCH_READINESS_20261027\n    '+nativeGroundGuidanceReason.toString()+'\n    '+nativeAgmLaunchCheck.toString()+'\n';
  source=source.replace(marker,helper+marker);
  return patchSeekerErrorFeedback(source.replace(stale,newGate+'\n'+stale));
}

// Apply only after the full native UnitRef regression has failed on the old
// source. The selected target remains a validated live hostile reference;
// native eligibility still enforces gimbal, range, LOS, prep and capture time.
export function patchNativeImagingCue(source) {
  const before='let aim=if matches!(config.mode,guided::Mode::Laser|guided::Mode::Beam){';
  const after='let aim=if matches!(config.mode,guided::Mode::Laser|guided::Mode::Beam|guided::Mode::Tv|guided::Mode::Iir){';
  if(source.includes(after))return source;
  if(source.indexOf(before)<0||source.indexOf(before)!==source.lastIndexOf(before))throw Error('Expected one native selected-guided target-cue owner');
  return source.replace(before,after);
}

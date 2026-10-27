// Common deterministic entertainment limits. Performance figures never set the
// structural limit. Native presentation reads accepted failure state only.
var TFAirframeLimits = (() => {
  const data=TF_AIRFRAME_LIMITS_DATA,rules=data.rules;
  const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const createState=()=>({structure_fraction:0,gear_fraction:0,gear_failed:false});
  const soundSpeed=altitude=>Math.sqrt(1.4*287.05*Math.max(216.65,288.15-.0065*clamp(altitude,0,11000)));
  function sample(id,s){
    const limits=data.aircraft[id];
    if(!limits||!s||![s[1],s[13],s[14],s[33]].every(Number.isFinite))return null;
    const ias=Math.max(0,s[14])*3.6,mach=Math.max(0,s[13])/soundSpeed(s[1]);
    return {ratio:Math.max(ias/limits.structural.iasKmh,limits.structural.mach?mach/limits.structural.mach:0),
      gearRatio:ias/limits.gear.iasKmh,exposure:clamp(s[33],0,1),ias,mach,limits};
  }
  const dose=ratio=>Math.max(0,ratio*ratio-1)**2;
  function advance(state,id,s,dt){
    const m=sample(id,s),result={structure_delta:0,gear_failed_now:false};
    if(!m||!Number.isFinite(dt)||dt<=0)return result;
    const before=state.structure_fraction;
    state.structure_fraction=clamp(before+dt*rules.structuralDamagePerSecond*dose(m.ratio),0,1);
    result.structure_delta=state.structure_fraction-before;
    if(!state.gear_failed&&m.exposure>.02){
      state.gear_fraction=clamp(state.gear_fraction+dt*rules.gearDamagePerSecond*dose(m.gearRatio)*m.exposure*m.exposure,0,1);
      if(state.gear_fraction>=1){state.gear_failed=true;result.gear_failed_now=true;}
    }
    return result;
  }
  function localStep(plane,dt){
    if(plane.nativeAuthority||plane.instrumentContext?.nativeAuthority)return;
    const state=plane.airframeLimitState||(plane.airframeLimitState=createState());
    const result=advance(state,plane.type.id,plane.cur,dt),damage=plane.damage;
    if(result.structure_delta>0&&damage&&!damage.broken){
      // At the cumulative endpoint consume the actual remaining HP exactly:
      // summing fractional deductions may otherwise leave a tiny positive HP
      // and breakUp() alone does not detach the original visible wing nodes.
      for(const id of ['wing_l','wing_r']){const p=damage.by?.[id];if(p)damage.harm(id,state.structure_fraction>=1?p.hp:p.max*result.structure_delta,false,()=>1);}
      if(state.structure_fraction>=1)damage.breakUp();
      plane.applyDamage();
    }
    if(result.gear_failed_now){
      plane.api.set_gear_failure?.(1);
      if(plane.S)plane.cur.set(plane.S);
    }
    return result;
  }
  function accept(plane,unit){
    // Ordinary telemetry must not invent a repair when the optional field is
    // absent. A host service/new-life explicitly sends a fresh false state.
    if(unit.airframe_limits)plane.airframeLimitState={...unit.airframe_limits};
    else if(typeof unit.gear_failed==='boolean'){
      plane.airframeLimitState??=createState();plane.airframeLimitState.gear_failed=unit.gear_failed;
    }
  }
  function flutter(id,s,side){
    const m=sample(id,s);if(!m||!Number.isFinite(s[23]))return 0;
    const amplitude=clamp((m.ratio-rules.warningRatio)/(rules.flutterFullRatio-rules.warningRatio),0,1)*rules.flutterMaxRad;
    const phase=s[23]*(2*Math.PI*11)+(side<0?0:1.7);
    return amplitude*(Math.sin(phase)*.7+Math.sin(phase*1.73+.4)*.3);
  }
  const gearControl=c=>/^(gear|tailgear|wheel_spin)(_|$)/.test(c.param||c.type||'');
  function beginPose(plane){
    for(const n of plane.pieceNodes||[])if(Object.hasOwn(n,'airframeNeutral')){
      if(n.airframeNeutral===null)n.local=null;
      else if(n.local?.set)n.local.set(n.airframeNeutral);
      else n.local=new Float32Array(n.airframeNeutral);
    }
  }
  function bend(node,angle,pivot){
    const m=node.local;if(!m||!angle)return;
    const c=Math.cos(angle),s=Math.sin(angle);
    for(let k=0;k<4;k++){const i=k*4,x=m[i]-(k===3?pivot:0),y=m[i+1];m[i]=c*x-s*y+(k===3?pivot:0);m[i+1]=s*x+c*y;}
  }
  function pose(plane){
    const failed=!!plane.airframeLimitState?.gear_failed;
    for(const c of plane.controls||[])if(gearControl(c)){
      if(failed){
        if(!c.airframeGearDebris&&c.node.mesh){plane._debris?.(c.node,c.p);c.airframeGearDebris=true;}
        c.node.visible=false;
      }else c.airframeGearDebris=false;
    }
    const span=plane.type.airframe?.[3]||10;
    for(const n of plane.pieceNodes||[]){
      if(!/^wing_[lr]/.test(n.part||'')||plane.damage?.gone?.(n.part))continue;
      if(!Object.hasOwn(n,'airframeNeutral'))n.airframeNeutral=n.local?new Float32Array(n.local):null;
      const side=n.part.startsWith('wing_l')?-1:1;
      const angle=flutter(plane.type.id,plane.cur,side)*side;
      if(angle&&!n.local){n.local=n.airframeFlutterMatrix||(n.airframeFlutterMatrix=new Float32Array(16));n.local.set(identity);}
      bend(n,angle,side*span*.04);
    }
    for(const c of plane.controls||[]){
      const owner=c.owner||c.gonePart||'';
      if(!/^wing_[lr]/.test(owner))continue;
      const side=owner.startsWith('wing_l')?-1:1;
      bend(c.node,flutter(plane.type.id,plane.cur,side)*side,side*span*.04);
    }
  }
  function warning(plane,language){
    const en=language==='en',m=sample(plane.type.id,plane.cur);
    if(plane.crashed||!m)return null;
    if(plane.airframeLimitState?.gear_failed)return {critical:true,text:en?'GEAR TORN OFF':'起落架已脫落'};
    const gear=m.exposure>.02&&m.gearRatio>=rules.warningRatio;
    if(m.ratio<rules.warningRatio&&!gear)return null;
    const ratio=Math.max(m.ratio,gear?m.gearRatio:0),critical=ratio>1;
    return {critical,text:(gear&&m.gearRatio>=m.ratio?(en?'GEAR SPEED':'起落架超速'):(en?'AIRFRAME SPEED':'機體超速'))+` ${Math.round(ratio*100)}%`+(critical?(en?' · REDUCE SPEED':' · 立即減速'):(en?' · LIMIT NEAR':' · 接近限制'))};
  }
  function infoRows(id,language){
    const entry=data.aircraft[id];if(!entry)return '';
    const en=language==='en',p=entry.performance,v=[p.maxKmh?`${p.maxKmh} km/h`:'',p.maxMach?`Mach ${p.maxMach}${p.qualifier==='over'?'+':''}`:''].filter(Boolean).join(' / ');
    const condition=p.altitudeM!=null?` · ${p.altitudeM===0?(en?'sea level':'海平面'):`${p.altitudeM} m`}`:'';
    const basis=p.basis==='game_setting'?(en?'game setting':'遊戲設定'):p.basis==='family_reference'?(en?'family reference; variant unverified':'家族參考；此型未核實'):(en?'published reference':'公開性能參考');
    const row=(k,v)=>`<dt>${k}</dt><dd>${v}</dd>`;
    return row(en?'Maximum speed':'最高速度',`${v}${condition} · ${basis}`)+row(en?'Structural limit (game)':'結構限制（遊戲設定）',`${entry.structural.iasKmh} km/h IAS${entry.structural.mach?` / Mach ${entry.structural.mach}`:''}`)+row(en?'Gear limit (game)':'起落架限制（遊戲設定）',`${entry.gear.iasKmh} km/h IAS`)+row(en?'Performance source':'性能出處',(p.sources||[]).map((url,i)=>`<a href="${url}" target="_blank" rel="noopener noreferrer">${en?'Reference':'參考'} ${i+1}</a>`).join(' · ')||basis);
  }
  return {data,createState,soundSpeed,sample,advance,localStep,accept,flutter,beginPose,pose,warning,infoRows};
})();

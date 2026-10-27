// Connect the native world to the completed garage and Aircraft battle surface.
// The original input map, mouse lock, camera, instruments, sights and audio own
// the player experience. This layer projects accepted resources and sends intent.
function createFrontlineExistingRuntime({f,mine,controlled,controlledAirModel,send,height,note,shared}) {
  let shownLife=null,weaponSignature=null,seekerSignature=null,serviceSignature=null,garageContext=null,scoreLabel=null,sharedHeaderOriginal=null;
  const groundViews=new Map();
  const key=u=>u?`${u.battle}:${u.unit}:${u.life}`:'';
  const guided=typeof createFrontlineGuidedControl==='function'?createFrontlineGuidedControl({
    group:air=>storeGroup(air.stores),resolve:resolveTarget,targets:()=>targets().concat(groundTargets().map(e=>e.airTarget)),
    reason:airReason,activate:seekerActivate,pod:airPod,podTrack:podTrackRequest,capture:seekerCaptureRequest,cancel:airCancel,nose:noseOf,epoch:()=>f.epoch}):null;
  function sharedAircraftHeader(id,name){
    const title=hud.el?.vehName||document.getElementById?.('veh-name'),rule=document.getElementById?.('gameplay-rule'),back=document.getElementById?.('to-garage');
    if(!sharedHeaderOriginal)sharedHeaderOriginal=[title,rule,back].filter(Boolean).map(node=>({node,html:node.innerHTML,title:node.title}));
    const label=name||(typeof AIRCRAFT_TYPES!=='undefined'?AIRCRAFT_TYPES[id]?.name:null)||id;
    if(title&&title.textContent!==label)title.textContent=label;
    if(rule)rule.textContent=`纯空战${f.room?.era?` · ${f.room.era} 年`:''}`;
    if(back){back.innerHTML='‹ 出击 <kbd>Tab / F8</kbd>';back.title='返回地图内的飞机与挂载选择；原机与库存由服务器保留';}
  }
  function resources(unit,model){
    frontlineAircraftHud(unit,model,airHudInventory,()=>aircraftGuns(unit.aircraft),AIR_STORE_DEFS);
    const projection=model.hudProjection,stores=model.stores||projection.stores;
    const previous=stores.groups?.[stores.sel||0];
    stores.groups=[...new Set(stores.items.filter(it=>AIR_WEAPON_KINDS.has(it.def.kind)).map(it=>it.id))];
    stores.sel=Math.max(0,stores.groups.indexOf(previous));stores.index=unit.loadout||0;
    stores.program=stores.program||{};
    if(projection.fuel)projection.fuel.type=unit.aircraft;
    return {guns:projection.guns,stores,fuel:projection.fuel,resourceRevision:unit.resource_revision};
  }
  function weaponSelection(air){
    const group=storeGroup(air.stores),guided=group?.def.kind==='aam'||group?.def.kind==='agm';
    const program=group&&!guided?releaseProgram(air.stores,group.def).id:'single';
    return {store_id:group?.id||null,store_index:null,program,
      gun_mode:air.fireAll||air.inputFireAll?'all':air.fireCannon||air.inputFireCannon?'cannon':'all'};
  }
  function stepPresentationSystems(air,dt){
    stepAirSystems(air,dt);
    guided?.accept(air,controlled(),f.missiles||[]);
    // The original predictor is read-only. Its cache belonged to the old local
    // weapon step, which native battles must never call to spend ammo or fuel.
    air.impact=air.ctl?.eq.ccip||air.ctl?.eq.ccrp?storeImpact(air):null;
  }
  const bridge=createEstablishedAircraftBridge({game:G4,document,airHud,project:resources,
    clearInput:()=>cancelPilotInput(),syncTouch:()=>syncAircraftTouchControls(true),
    pilotStep:(air,dt)=>stepPlayerAircraftPilot(dt),systems:stepPresentationSystems,
    audio:(air,dt)=>airAudio(dt),effects:(air,dt)=>airEffects(dt),
    camera:(air,dt,ground)=>{const flight=air.plane.camera(dt,ground);return airViewCamera(air)||flight;},
    drawHud:(air,m,w,h)=>updateAirHud(m,w,h),selection:weaponSelection});
  function sync(){
    const unit=controlled(),model=controlledAirModel();
    if(!unit?.aircraft||!model){bridge.unbind();shownLife=null;return;}
    const life=key(unit.unit);
    if(shownLife!==life){
      if(G4.air&&!G4.air.nativeAuthority)removeAircraft();
      dropAirPreview();setMode('battle');renderer.setMap(null);renderer.zones=[];
      shownLife=life;weaponSignature=seekerSignature=serviceSignature=null;
    }
    const air=bridge.bind(model,unit);air.boardedAt??=performance.now();
    guided?.accept(air,unit,f.missiles||[]);
    sharedAircraftHeader(unit.aircraft,model.plane.type?.name);
    const state=unit.service,signature=state?`${state.status}:${state.revision}:${state.reason}`:'';
    if(signature!==serviceSignature){
      if(state?.status==='complete')hud.toast('机场整备完成：修复、补弹及挂载以服务端记录为准',3);
      else if(state?.status==='cancelled')airReason(air,frontlineAirServiceReason(state.reason),3);
      serviceSignature=signature;
    }
    if(state?.status==='servicing')airReason(air,`机场整备 ${state.elapsed_s.toFixed(1)} / ${state.duration_s.toFixed(0)} 秒`,1);
    const scores=f.room?.team_score;
    if(!scoreLabel){scoreLabel=document.createElement('div');scoreLabel.id='native-air-score';scoreLabel.style.cssText='position:fixed;top:12px;left:50%;transform:translateX(-50%);padding:6px 12px;background:#142027cc;color:#e9ede6;font:13px system-ui;pointer-events:auto;max-width:min(40vw,520px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center';airHud.appendChild(scoreLabel);}
    scoreLabel.textContent=`蓝 ${scores?.[0]??0} / 红 ${scores?.[1]??0} · ${frontlineRoundPresentation(f.room).text}`;
    scoreLabel.title=`${f.map?.name||'纯空战'} · 纯空战 · 目标 ${f.room?.score_limit??1000}`;
  }
  function step(dt){sync();bridge.step(dt);controlledAirModel()?.localStep?.(dt,bridge.intent());}
  function controlSignature(control){
    if(!control||!['store_id','store_index','program','gun_mode'].every(field=>Object.hasOwn(control,field)))return null;
    return JSON.stringify([control.store_id,control.store_index,control.program,control.gun_mode]);
  }
  function cancelReleaseIntent(){
    const air=bridge.getair();if(air)air.storeHeld=air.storeTap=false;
  }
  function rejectWeaponControl(){
    cancelReleaseIntent();
    const air=bridge.getair();
    if(air)air.fireAll=air.fireCannon=air.inputFireAll=air.inputFireCannon=false;
    // Keep the sent signature: a rejected unchanged choice must not be retried
    // every heartbeat. Another selection or an accepted echo can unblock it.
  }
  function rejectSeekerControl(reason){cancelReleaseIntent();if(guided?.reject?.(reason))seekerSignature=null;}
  function transmit(){
    const unit=controlled(),air=bridge.getair();
    if(!unit?.aircraft||!air||!bridge.intent())return false;
    const selection=bridge.selection(),signature=controlSignature(selection);
    if(signature!==weaponSignature){
      // A tap for another weapon/program must not be carried into this one.
      if(weaponSignature!==null)cancelReleaseIntent();
      send({op:'air_weapon_control',unit:unit.unit,epoch:f.epoch,seq:++f.seq,...selection});weaponSignature=signature;
    }
    const seeker=guided?.intent(air,unit),nextSeekerSignature=seeker?JSON.stringify(seeker):null;
    if(seeker&&nextSeekerSignature!==seekerSignature){
      send({op:'air_seeker_control',unit:unit.unit,epoch:f.epoch,seq:++f.seq,...seeker});guided?.sent?.(f.seq);seekerSignature=nextSeekerSignature;
    }
    const intent=bridge.intent(),acknowledged=signature!==null&&controlSignature(unit.weapon_control)===signature;
    let ccrpRelease=false;
    if(air.ccrp&&storeGroup(air.stores)?.def.kind==='bomb'){
      // Exact original computer gate; the native host owns the selected salvo.
      const cue=ccrpCue(air);air.storeTap=false;
      ccrpRelease=!!(air.storeHeld&&cue&&!air.ccrp.released&&cue.along<=0&&cue.along>-150&&Math.abs(cue.across)<80);
      intent.release=ccrpRelease;
    }
    if(!acknowledged)intent.fire=intent.release=false;
    send({op:'air_input',unit:unit.unit,epoch:f.epoch,seq:++f.seq,...intent});
    const pose=controlledAirModel()?.localPose?.(f.seq+1);
    if(pose){f.seq++;send({op:'air_pose',...pose});}
    if(acknowledged){
      bridge.consumeIntent();
      if(ccrpRelease)air.ccrp.released=true;
    }
    return true;
  }
  function clear(){
    const air=bridge.getair();cancelPilotInput();
    if(air){guided?.neutral(air);air.nativeIntent=air.plane.pilotIntent(0);transmit();}
    weaponSignature=null;
  }
  function garage(context){
    garageContext=context;bridge.unbind();shownLife=null;
    toGarage();setAirGarage(true);showAirType(context.aircraftId);deploy.close();lobby.show(false);
    f.returnPending=false;
    refreshGarageControls(context.aircraftId);
    canvas.focus({preventScroll:true});
  }
  function deployment(context){
    bridge.unbind();shownLife=null;garageContext=null;
    document.getElementById('native-air-garage')?.remove();
    if(G4.air&&!G4.air.nativeAuthority)removeAircraft();
    dropAirPreview();setMode('battle');renderer.setMap(null);renderer.zones=[];
    G4.keys?.clear();G4.fireHeld=G4.mgHeld=false;f.returnPending=false;
    sharedAircraftHeader(context.aircraftId);
    return true;
  }
  function refreshGarageControls(id=airGarage.sel){
    if(!garageContext||f.room?.battle_mode!=='air_frontline'||G4.mode!=='garage'||!airGarage.on)return false;
    const panel=document.getElementById('g-air');if(!panel)return false;
    const map=shared.deploymentMap?.()||garageContext.map,availability=shared.availability?.()||garageContext.availability;
    let strip=document.getElementById('native-air-garage');
    if(!strip){strip=document.createElement('div');strip.id='native-air-garage';strip.className='air-lo';panel.appendChild(strip);}
    const selected=Number.isSafeInteger(f.garageSpawn)&&map.spawns[f.garageSpawn]?f.garageSpawn:0;f.garageSpawn=selected;
    strip.replaceChildren();
    const label=document.createElement('p');label.textContent=`${f.map?.name||map.name} · ${f.room?.era} 年及以前 · 双方均可使用各国机型`;
    strip.appendChild(label);
    for(const [index,spawn]of map.spawns.entries()){
      const button=document.createElement('button');button.type='button';button.className='tool';button.textContent=spawn.label;button.setAttribute('aria-pressed',String(index===selected));
      button.onclick=()=>{f.garageSpawn=index;for(const peer of strip.querySelectorAll('button'))peer.setAttribute('aria-pressed',String(peer===button));button.blur();};strip.appendChild(button);
    }
    const allowed=new Set(f.aircraftOptions.map(option=>option.id));
    for(const [id,card]of airGarage.cards){card.button.disabled=!allowed.has(id);card.button.title=allowed.has(id)?'':`本局只允许 ${f.room?.era} 年及以前已核验机型`;}
    const warning=document.createElement('p');warning.textContent=availability?.allowed===false?availability.reason:'在原机库选择飞机与挂载，按原来的「起飞」按钮出击。';strip.appendChild(warning);
    const serviceHint=document.createElement('p');serviceHint.textContent='己方跑道停妥、低油门，按K整备15秒（维修/补弹/加油）';strip.appendChild(serviceHint);
    sharedAircraftHeader(id);return true;
  }
  function launch(id){
    try{sound.start();f.sharedLobby.launchFromGarage(id,f.garageSpawn||0);requestLock();canvas.focus({preventScroll:true});}
    catch(error){hud.toast(error.message,3);}
  }
  function returnToGarage(){
    try{
      // Return is an intent. Accepted control(null) and shared notification own
      // the garage transition; a rejection must leave this pilot controllable.
      clear();shared.returnToDeployment();
    }catch(error){hud.toast(error.message,3);}
  }
  function action(name,stamp){
    const air=bridge.getair();if(!air)return;
    const handled=guided?.action(air,controlled(),name,stamp);if(handled!==undefined)return handled;
    if(name==='rearm'){
      const id=air.plane.type.id,index=G4.airLoadout[id]??0,source=airLoadouts(id)[index];
      try{shared.serviceAir(/自[訂订]|custom/i.test(source?.[0]||'')?{custom:{...(G4.airCustom[id]||{})}}:{loadout:index});airReason(air,'已请求机场整备，须在己方跑道停稳并保持低油门15秒',3);}catch(error){airReason(air,error.message,3);}
      return true;
    }
    if(['bots','jettison','engine','cm','cmPeriodic','cmProgram'].includes(name)){
      airReason(air,({bots:'联机对局的敌机由服务端管理',jettison:'此服务器尚未开放抛弃挂载',engine:'此服务器尚未开放独立启停发动机',cm:'此服务器尚未开放反制投放',cmPeriodic:'此服务器尚未开放反制投放',cmProgram:'此服务器尚未开放反制投放'})[name],2.5);return false;
    }
    return undefined;
  }
  function targets(){
    const team=mine()?.team;
    return f.aircrafts.filter(unit=>unit.alive&&unit.team!==team).flatMap(unit=>{
      const model=f.airModels.get(key(unit.unit));if(!model)return[];
      model.sensorTarget??={bot:{plane:model.plane}};
      model.sensorTarget.unitRef={...unit.unit};model.sensorTarget.bot.unitRef=model.sensorTarget.unitRef;
      model.sensorTarget.bot.target=model.sensorTarget;model.sensorTarget.bot.gone=false;
      return[model.sensorTarget];
    });
  }
  function groundTargets(){
    const team=mine()?.team,present=new Set(),result=[];
    for(const unit of (f.units||[]).concat(f.vessels||[])){
      if(!unit.alive||(unit.team===0?'blue':unit.team===1?'red':unit.team)===team)continue;
      const id=key(unit.unit);present.add(id);let view=groundViews.get(id);
      if(!view){view={unit:null,enemy:{alive:true,unitRef:{...unit.unit},veh:{body:{origin:()=>view.unit.pos.slice()}}}};view.enemy.airTarget={unitRef:view.enemy.unitRef,enemy:view.enemy};groundViews.set(id,view);}
      view.unit=unit;const e=view.enemy;e.alive=unit.alive;e.x=unit.pos[0];e.z=unit.pos[2];e.vx=unit.velocity?.[0]??unit.net?.v?.[0]??0;e.vz=unit.velocity?.[2]??unit.net?.v?.[2]??0;e.name=unit.vehicle||unit.model||unit.role;e.box={top:unit.geometry_id?8:data.vehicles[unit.vehicle]?.vehicle?.hull?.size_m?.[1]||2};
      result.push(e);
    }
    for(const id of groundViews.keys())if(!present.has(id))groundViews.delete(id);
    return result;
  }
  function resolveTarget(value){
    const ref=value?.unitRef||value?.enemy?.unitRef||value?.bot?.unitRef||value;
    if(!ref||![ref.battle,ref.unit,ref.life].every(Number.isSafeInteger))return null;
    return targets().concat(groundTargets().map(e=>e.airTarget)).find(t=>key(t.unitRef)===key(ref))||null;
  }
  function release(leaving=false){guided?.clear();groundViews.clear();bridge.unbind();shownLife=null;weaponSignature=seekerSignature=null;serviceSignature=null;if(leaving){garageContext=null;document.getElementById('native-air-garage')?.remove();for(const card of airGarage.cards.values()){card.button.disabled=false;card.button.title='';}for(const saved of sharedHeaderOriginal||[]){saved.node.innerHTML=saved.html;saved.node.title=saved.title;}sharedHeaderOriginal=null;}}
  return {sync,step,transmit,clear,garage,deployment,refreshGarageControls,launch,returnToGarage,action,targets,groundTargets,release,rejectWeaponControl,rejectSeekerControl,
    targetAlive:target=>!!resolveTarget(target),radioSteer:(dx,dy,dt)=>guided?.radioSteer(bridge.getair(),dx,dy,dt),
    present:(dt)=>bridge.present(dt),view:(dt)=>bridge.view(dt,height),draw:(m,w,h)=>bridge.draw(m,w,h),getair:bridge.getair,
    garageContext:()=>garageContext};
}

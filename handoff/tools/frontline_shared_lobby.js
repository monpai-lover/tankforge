/* Source-owned adapter for the existing LobbyUi and DeployScreen. Native state is
 * read-only here: the same NetClient carries both protocols, and every sortie is
 * admitted by frontline.shared before its accepted Control closes deployment. */
function installFrontlineSharedLobby({lobby,deploy,net,frontline,aircraft,eras=[1953,1976,1986,2022]}) {
  if (!lobby?.el || !deploy?.el || !net || !frontline || !aircraft) throw Error('Shared lobby dependencies are required');
  if (lobby.__frontlineSharedLobby) return lobby.__frontlineSharedLobby;
  const required=['room','rooms','maps','self','controlled','aircraftOptions','deploymentMap','list','create','join','start','leave','deployAir','returnToDeployment','subscribe'];
  for (const key of required) if (typeof frontline[key]!=='function') throw Error(`Missing frontline.shared.${key}`);
  for (const key of ['lineup','selectedId','selectedLoadout','select','selectLoadout','loadouts','openConfiguration']) if(typeof aircraft[key]!=='function') throw Error(`Missing shared aircraft callback ${key}`);
  if(aircraft.openGarage!==undefined&&typeof aircraft.openGarage!=='function')throw Error('Invalid original aircraft garage callback');
  if(aircraft.openBattlefield!==undefined&&typeof aircraft.openBattlefield!=='function')throw Error('Invalid battlefield deployment callback');
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const saved=[];
  let chosenMode='casual',nativeMap='taiwan',nativeEra=2022,legacyFields=null,opened=false,garageOpened=false,lastBattle=null,lastNative=false,disposed=false,deploymentError='';
  const originalLobby={render:lobby.render,click:lobby.click,change:lobby.change,show:lobby.show,connect:lobby.connect,sendVehicle:lobby.sendVehicle};
  const originalDeploy={click:deploy.click,airChoice:deploy.airChoice,update:deploy.update,renderAmmo:deploy.renderAmmo,renderTop:deploy.renderTop,drawMap:deploy.drawMap};
  const native=()=>!!frontline.room();
  const battle=()=>{const r=frontline.room();return !!r&&(r.round_state?r.round_state==='battle':r.started);};
  const key=(mode,id)=>`${mode}:${id}`;
  function parseKey(value){const match=/^(legacy|air_frontline):(\d+)$/.exec(String(value));if(!match||!Number.isSafeInteger(Number(match[2]))||Number(match[2])<1)throw Error('房间编号无效');return {mode:match[1],id:Number(match[2])};}
  function patch(target,name,value){saved.push([target,name,target[name],Object.prototype.hasOwnProperty.call(target,name)]);target[name]=value;}
  function fail(error){lobby.error=error?.message||String(error);if(native()&&deploy.visible){deploymentError=lobby.error;deploy.renderAmmo();deploy.update();}lobby.render();return false;}
  function action(fn){try{const result=fn();if(result?.then)result.catch(fail);return true;}catch(error){fail(error);return true;}}
  const sourceCards=()=>aircraft.lineup()||[];
  const options=()=>frontline.aircraftOptions()||[];
  function admitted(id){return options().find(option=>option.id===id);}
  function sourceLoadouts(id){return (aircraft.loadouts(id)||[]).map((entry,i)=>Array.isArray(entry)?{index:i,name:entry[0],source:entry,custom:/自[訂订]|custom/i.test(entry[0])}:{...entry,index:entry.index??i,source:entry});}
  function customPick(id){const value=aircraft.custom?.(id)||{};return {...value};}
  function loadouts(id){
    const allowed=new Map((admitted(id)?.loadouts||[]).filter(lo=>Number.isSafeInteger(lo.index)&&lo.index>=0).map(lo=>[lo.index,lo]));
    const source=sourceLoadouts(id);if(Array.isArray(admitted(id)?.slots)&&!source.some(lo=>lo.custom))source.push({index:source.length,name:'自订挂载',custom:true});
    return source.map(lo=>{const host=allowed.get(lo.index);if(lo.custom){let why='';try{frontline.configuration(id,{custom:customPick(id)});}catch(error){why=error.message;}return {...lo,online:!why,native:admitted(id),why,what:Object.entries(customPick(id)).map(([slot,store])=>`${slot} · ${store}`).join('、')||'仅内置机炮',cost:0};}return {...lo,name:host?.name||lo.name,online:!!host,native:host||null,why:host?'':'当前服务器未开放此挂载配置；请选择已开放的预设',what:lo.what||'',cost:0};});
  }
  function lineup(){const allowed=new Set(options().map(option=>option.id));return sourceCards().filter(card=>allowed.has(card.id.replace(/^air:/,''))).map(card=>({...card,id:`air:${card.id.replace(/^air:/,'')}`,usable:true,kind:card.kind||'飞机'}));}
  function selection(){
    const id=deploy.vehicle?.startsWith('air:')?deploy.vehicle.slice(4):'';
    const list=id?loadouts(id):[];
    // An explicit unsupported source/custom choice stays unsupported. Never fall
    // back to another loadout while the player's saved configuration says otherwise.
    const index=Number.isSafeInteger(deploy.airLo)?deploy.airLo:aircraft.selectedLoadout(id);
    return {list,lo:list.find(lo=>lo.index===index&&lo.online),selected:index,sp:null,personalSpawnPoints:false};
  }
  function sharedMap(){
    const m=frontline.deploymentMap();
    if(!m||!Array.isArray(m.spawns)||!m.spawns.length)throw Error('服务器地图或出生点尚未就绪');
    if(m.spawns.some(spawn=>!['air','runway'].includes(spawn.id)||![spawn.x,spawn.z,spawn.heading].every(Number.isFinite))||new Set(m.spawns.map(spawn=>spawn.id)).size!==m.spawns.length)throw Error('服务器出生点无效');
    if(![m.x0,m.z0,m.size].every(Number.isFinite)||m.size<=0)throw Error('服务器部署地图无效');
    return m;
  }
  function openDeployment(){
    if(!native())return false;
    const me=frontline.self();
    if(!battle()||!me||me.observer)return false;
    if(frontline.controlled()){action(()=>frontline.returnToDeployment());return false;}
    const cards=lineup();if(!cards.length)return false;
    let map;try{map=sharedMap();}catch{return false;}
    const retained=frontline.retained?.(),selected=retained?.aircraft||aircraft.selectedId(),id=cards.some(card=>card.id===`air:${selected}`)?selected:cards[0].id.slice(4);
    aircraft.select(id);
    deploy.airLo=aircraft.selectedLoadout(id);
    deploy.spawn=Number.isSafeInteger(deploy.spawn)&&deploy.spawn<map.spawns.length?deploy.spawn:0;
    lobby.show(false);
    if(aircraft.openGarage&&!aircraft.openBattlefield){
      deploy.close();
      if(aircraft.openGarage({aircraftId:id,map,availability:frontline.availability?.()})===false)return false;
      frontline.setDeploymentVisible?.(true);opened=garageOpened=true;return true;
    }
    if(aircraft.openBattlefield?.({aircraftId:id,map,availability:frontline.availability?.()})===false)return false;
    deploy.open({title:'选择飞机与挂载',vehicle:`air:${id}`,spawn:deploy.spawn,wait:0});
    frontline.setDeploymentVisible?.(true);opened=true;return true;
  }
  function sendDeployment(id,index,spawnIndex){
    const me=frontline.self();
    if(!battle()||!me||me.observer||frontline.controlled())throw Error('当前不能出击，请等待服务器确认部署状态');
    if(!admitted(id)||!lineup().some(card=>card.id===`air:${id}`))throw Error('当前服务器未开放此飞机');
    const choice=loadouts(id).find(lo=>lo.index===index);if(!Number.isSafeInteger(index)||!choice?.online)throw Error(choice?.why||'当前服务器未开放此挂载配置；请选择已开放的预设');
    const m=sharedMap();if(!Number.isSafeInteger(spawnIndex)||!m.spawns[spawnIndex])throw Error('请选择有效出生点');
    aircraft.select(id);aircraft.selectLoadout(id,index);deploymentError='';
    return frontline.deployAir({aircraft:id,...(choice.custom?{loadout:0,custom:customPick(id)}:{loadout:index}),spawn:m.spawns[spawnIndex].id});
  }
  const roomRows=()=>[...(net.rooms||[]).map(room=>({mode:'legacy',key:key('legacy',room.id),room})),...(frontline.rooms()||[]).map(room=>({mode:'air_frontline',key:key('air_frontline',room.id),room}))];
  function mapOptions(select,values,selected){select.innerHTML=values.map(value=>`<option value="${esc(value.id)}">${esc(value.name)}</option>`).join('');select.value=values.some(value=>String(value.id)===String(selected))?String(selected):String(values[0]?.id??'');}
  function syncModeFields(){
    const mode=lobby.el.querySelector('#lb-gameplay'),map=lobby.el.querySelector('#lb-map'),era=lobby.el.querySelector('#lb-era'),max=lobby.el.querySelector('#lb-max');if(!mode||!map||!era)return;
    if(!mode.querySelector('option[value="air_frontline"]'))mode.insertAdjacentHTML('beforeend','<option value="air_frontline">空中前线</option>');
    mode.value=chosenMode;
    if(chosenMode==='air_frontline'){
      if(map.dataset.sharedMode!=='air_frontline'&&!legacyFields)legacyFields={map:map.value,mapHtml:map.innerHTML,era:era.value,eraHtml:era.innerHTML};
      const maps=frontline.maps()||[];mapOptions(map,maps,nativeMap||map.value);if(map.value)nativeMap=map.value;
      mapOptions(era,eras.map(year=>({id:year,name:`${year}`})),nativeEra);nativeEra=Number(era.value);map.dataset.sharedMode='air_frontline';
    }else if(map.dataset.sharedMode==='air_frontline'&&legacyFields){
      map.innerHTML=legacyFields.mapHtml;map.value=legacyFields.map;era.innerHTML=legacyFields.eraHtml;era.value=legacyFields.era;delete map.dataset.sharedMode;legacyFields=null;
    }
    const maxField=max?.closest('label');if(maxField)maxField.hidden=chosenMode==='air_frontline';
    const create=lobby.el.querySelector('[data-act="create"]');
    if(create){if(chosenMode==='air_frontline')create.disabled=!net.open||!(frontline.maps()||[]).length;
      if(!lobby.el.querySelector('[data-shared-observe-create]'))create.insertAdjacentHTML('afterend','<button type="button" class="tool" data-act="observe" data-shared-observe-create="1">创建 AI 观战</button>');
      const observe=lobby.el.querySelector('[data-shared-observe-create]');observe.hidden=chosenMode!=='air_frontline';observe.disabled=create.disabled;
    }
  }
  function augmentLobby(){
    if(lobby.el.hidden||!net.open||net.room||native())return;
    syncModeFields();
    const rows=lobby.el.querySelector('.lb-rooms');if(!rows)return;
    for(const stale of rows.querySelectorAll('[data-shared-native]'))stale.remove();
    for(const button of rows.querySelectorAll('[data-act="join"]'))if(!button.dataset.room.includes(':'))button.dataset.room=key('legacy',button.dataset.room);
    const list=frontline.rooms()||[];if(list.length)for(const empty of rows.querySelectorAll('.lb-empty'))empty.remove();
    for(const r of list){const count=(r.members||[]).filter(member=>!member.observer).length,playing=r.round_state==='battle'||r.started;
      rows.insertAdjacentHTML('beforeend',`<li data-shared-native="1"><span class="lb-rn">${esc(r.name||`房间 ${r.id}`)}</span><span class="lb-rm">${esc((frontline.maps()||[]).find(map=>map.id===r.map)?.name||r.map)} · 空中前线 · ${esc(r.era)} · ${count} 人 · ${playing?'战斗中':r.round_state==='intermission'?'局间休整':'等待开始'}</span><span><button type="button" class="tool" data-act="join" data-room="${key('air_frontline',r.id)}">加入</button><button type="button" class="tool" data-act="observe" data-room="${key('air_frontline',r.id)}">观战</button></span></li>`);
    }
  }
  function renderNativeRoom(){
    const r=frontline.room();if(!r||lobby.el.hidden)return;
    const me=frontline.self(),scores=new Map((r.scoreboard||[]).map(score=>[score.player,score]));
    const team=side=>`<div class="lb-team" data-team="${side}"><h3>${side==='blue'?'蓝方':'红方'}</h3><ul>${(r.members||[]).filter(member=>!member.observer&&member.team===side).map(member=>{const score=scores.get(member.player),name=esc(member.name||`玩家 ${member.player}`);return `<li data-me="${member.player===net.id?1:0}" style="grid-template-columns:minmax(0,1fr) auto"><span class="lb-mn" style="grid-column:1;grid-row:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${name}">${member.player===r.host?'★ ':''}${name}</span><span class="lb-mv" style="grid-column:2;grid-row:1;white-space:nowrap">${member.connected?'在线':'离线'}</span>${score?`<span class="lb-mk" style="grid-column:1 / -1;grid-row:2;white-space:normal">${esc(score.score)} 分 · 空 ${esc(score.air_kills)} / 地 ${esc(score.ground_kills)} · 损失 ${esc(score.deaths)}</span>`:''}</li>`;}).join('')||'<li class="lb-empty">—</li>'}</ul></div>`;
    const state=r.round_state||(r.started?'battle':'waiting'),observers=(r.members||[]).filter(member=>member.observer);
    const html=`<header class="lb-head"><h2>联机大厅</h2><span class="lb-state" data-on="${net.open?1:0}">${net.open?'已连线':'重新连线中'} · ${esc(net.name)}</span><button type="button" class="tool" data-act="close" aria-label="关闭">✕</button></header><div class="lb-row lb-rename"><label class="lb-field">玩家名称<input id="lb-rename" value="${esc(net.name)}" maxlength="24" autocomplete="off"></label><button type="button" class="tool" data-act="rename">改名</button></div>${lobby.error?`<p class="lb-err">${esc(lobby.error)}</p>`:''}<div class="lb-row"><h3 class="lb-title">${esc(r.name||`房间 ${r.id}`)}</h3><span class="lb-rm">空中前线 · ${esc(r.map)} · ${esc(r.era)} · ${state==='battle'?'战斗中':state==='intermission'?'局间休整':'等待开始'}</span></div><div class="lb-teams">${team('blue')}${team('red')}</div>${observers.length?`<p class="lb-note">观战：${observers.map(member=>esc(member.name||`玩家 ${member.player}`)).join('、')}</p>`:''}<p class="lb-note">驾驶飞机支援地面 AI 争夺三个区域；击毁敌方飞机和地面单位获得个人得分。</p><div class="lb-row"><button type="button" class="tool" data-act="leave">离开房间</button>${state==='waiting'&&r.host===net.id?'<button type="button" class="tool lb-main" data-act="start">开始战斗</button>':''}${state==='battle'&&!me?.observer?'<button type="button" class="tool lb-main" data-act="deploy">选择飞机与挂载</button>':''}</div>`;
    if(lobby.lastHtml!==html||!lobby.el.firstChild){const rename=lobby.el.querySelector('#lb-rename')?.value;lobby.el.innerHTML=html;lobby.lastHtml=html;if(rename!=null)lobby.el.querySelector('#lb-rename').value=rename;}
    lobby.o.onChange?.();
  }
  function handleLobby(act,button){
    if(act==='refresh'){action(()=>frontline.list());return false;}
    if((act==='create'||act==='observe'&&!button.dataset.room)&&chosenMode==='air_frontline')return action(()=>{
      if(net.room||native())throw Error('请先离开当前房间');
      const map=lobby.el.querySelector('#lb-map')?.value,era=Number(lobby.el.querySelector('#lb-era')?.value);
      if(!(frontline.maps()||[]).some(entry=>entry.id===map)||!eras.includes(era))throw Error('请选择有效地图与年代');
      return frontline.create({name:lobby.el.querySelector('#lb-room-name')?.value||'',map,era,observer:act==='observe'});
    });
    if((act==='join'||act==='observe')&&button.dataset.room?.includes(':'))return action(()=>{
      const target=parseKey(button.dataset.room);
      if(target.mode==='legacy'){if(native())throw Error('请先离开当前房间');lobby.sendVehicle(true);return net.send({t:'join',room:target.id});}
      if(net.room||native())throw Error('请先离开当前房间');return frontline.join({room:target.id,observer:act==='observe'});
    });
    if(!native())return false;
    if(act==='start')return action(()=>frontline.start());
    if(act==='leave')return action(()=>frontline.leave());
    if(act==='deploy')return action(()=>openDeployment());
    if(['ready','team','chat','quick','create','join','observe'].includes(act))return action(()=>{throw Error('当前空中前线房间不支持此操作');});
    return false;
  }
  patch(lobby,'render',function(){if(native())renderNativeRoom();else{originalLobby.render.call(this);augmentLobby();}});
  patch(lobby,'click',function(event){const button=event.target.closest('button');if(button&&handleLobby(button.dataset.act,button)){event.preventDefault?.();button.blur?.();this.render();return;}return originalLobby.click.call(this,event);});
  patch(lobby,'change',function(event){const id=event?.target?.id;if(id==='lb-gameplay'){chosenMode=event.target.value;syncModeFields();}else if(chosenMode==='air_frontline'&&id==='lb-map')nativeMap=event.target.value;else if(chosenMode==='air_frontline'&&id==='lb-era')nativeEra=Number(event.target.value);return originalLobby.change?.call(this,event);});
  patch(lobby,'show',function(on){const result=originalLobby.show.call(this,on);if(!this.el.hidden&&net.open)action(()=>frontline.list());return result;});
  patch(lobby,'connect',async function(...args){const result=await originalLobby.connect.apply(this,args);if(net.open&&!disposed)await frontline.list();return result;});
  patch(lobby,'sendVehicle',function(...args){if(!native())return originalLobby.sendVehicle.apply(this,args);});
  function overrideOption(name,fn){const original=deploy.o[name];patch(deploy.o,name,function(...args){return native()?fn(...args):original?.apply(this,args);});}
  overrideOption('lineup',()=>[]);overrideOption('airLineup',lineup);overrideOption('airLoadouts',loadouts);overrideOption('map',sharedMap);
  overrideOption('deploymentPolicy',()=>({airOnly:true,personalSpawnPoints:false}));
  overrideOption('deploy',()=>{throw Error('空中前线仅允许玩家驾驶飞机');});
  overrideOption('deployAir',sendDeployment);overrideOption('leave',()=>frontline.leave());
  overrideOption('chat',()=>{throw Error('当前空中前线尚未开放聊天');});
  patch(deploy,'airChoice',function(){return native()?selection():originalDeploy.airChoice.call(this);});
  patch(deploy,'click',function(event){
    if(!native())return originalDeploy.click.call(this,event);
    const button=event.target.closest('[data-act]');if(!button)return;const act=button.dataset.act;
    if(act==='go'){action(()=>{if(!this.vehicle?.startsWith('air:'))throw Error('空中前线仅允许玩家驾驶飞机');return sendDeployment(this.vehicle.slice(4),selection().selected,this.spawn);});return;}
    if(act==='configure-air'){if(this.isAir())action(()=>aircraft.openConfiguration(this.vehicle.slice(4)));return;}
    if(!['veh','airlo','spawn','leave'].includes(act))return;
    if(act==='veh'){
      const id=button.dataset.id;if(!lineup().some(card=>card.id===id)){fail(Error('当前服务器未开放此飞机'));return;}
      aircraft.select(id.slice(4));this.airLo=aircraft.selectedLoadout(id.slice(4));
    }
    if(act==='airlo'){
      const index=Number(button.dataset.i),id=this.vehicle?.slice(4);if(!loadouts(id).some(lo=>lo.index===index&&lo.online)){fail(Error('当前服务器未开放此挂载配置'));return;}
      aircraft.selectLoadout(id,index);
    }
    if(act==='spawn'){const index=Number(button.dataset.i);if(!Number.isSafeInteger(index)||!sharedMap().spawns[index])return;}
    return originalDeploy.click.call(this,event);
  });
  patch(deploy,'renderAmmo',function(...args){
    if(!native())return originalDeploy.renderAmmo.apply(this,args);
    const target=this.el.querySelector('#dp-ammo');if(!target)return;
    if(!this.isAir()){target.innerHTML='<p class="dp-note">请选择飞机</p>';return;}
    const id=this.vehicle.slice(4),choice=selection(),name=admitted(id)?.name||id;
    const retained=frontline.retained?.(),lost=frontline.self()?.air_sortie_eligible===false&&!retained,error=deploymentError||frontline.deploymentError?.();const html=`<h3>${esc(name)}</h3>`+choice.list.map(lo=>`<button type="button" class="dp-airlo" data-act="airlo" data-i="${lo.index}" aria-pressed="${lo.index===choice.selected}" ${lo.online?'':`disabled title="${esc(lo.why)}"`}><b>${esc(lo.name)}</b><small>${esc(lo.online?lo.what:lo.why)}</small></button>`).join('')+(aircraft.fuelHtml?.(id)||'')+`<button type="button" class="tool" data-act="configure-air">逐挂点配置武器…</button><p class="dp-note">挂点、武器及库存均由服务器确认。${retained?'原机仍在场，出击只接管原机；新挂载须返回机场整备。':lost?'本局飞机已损失，现在以自由视角观战，请等待下一局。':'本局仅一架，实际出击后使用本局资格。'}</p>${error?`<p class="dp-note" role="status">${esc(error)}</p>`:''}${!choice.lo?'<p class="dp-note" role="status">当前配置尚未开放，请选择可用配置。</p>':''}`;
    if(target.innerHTML!==html)target.innerHTML=html;
  });
  patch(deploy,'update',function(...args){
    if(!native())return originalDeploy.update.apply(this,args);if(!this.visible)return;
    if(this.isAir()){
      const selected=aircraft.selectedLoadout(this.vehicle.slice(4));if(selected!==this.airLo){this.airLo=selected;this.renderAmmo();}
    }
    const allowed=frontline.availability?.(),go=this.el.querySelector('#dp-go');if(go){const valid=this.isAir()&&!!selection().lo&&battle()&&!frontline.self()?.observer&&!frontline.controlled()&&(!allowed||allowed.allowed);go.textContent=valid?(allowed?.retained?'接管原机':'起飞！'):allowed?.reason||'请选择可用配置';go.disabled=!valid;go.classList?.toggle('dp-go-long',!valid);}
    this._mapT=(this._mapT||0)+1;if(this._mapT%15===0){this.drawMap();this.renderTop();}
    for(const element of this.el.querySelectorAll('.dp-chat-row,#dp-chat'))element.hidden=true;
  });
  patch(deploy,'renderTop',function(...args){
    if(!native())return originalDeploy.renderTop.apply(this,args);
    const r=frontline.room(),scores=new Map((r.scoreboard||[]).map(score=>[score.player,score])),target=this.el.querySelector('#dp-teams');
    if(target)target.innerHTML=['blue','red'].map(team=>`<div class="dp-team" data-team="${team}"><h4>${team==='blue'?'蓝方':'红方'}</h4><ul>${(r.members||[]).filter(member=>!member.observer&&member.team===team).map(member=>`<li data-me="${member.player===net.id?1:0}"><span>${esc(member.name||`玩家 ${member.player}`)}</span>${scores.has(member.player)?`<b>${esc(scores.get(member.player).score)} 分</b>`:''}</li>`).join('')}</ul></div>`).join('');
    const score=this.el.querySelector('#dp-score');if(score){const points=(sharedMap().points||[]).map(point=>`<span class="dp-pt" data-owner="${esc(point.owner||'')}" data-id="${esc(point.id)}"></span>`).join(''),values=r.team_score;score.innerHTML=Array.isArray(values)&&values.length===2?`<span class="dp-tk" data-team="blue">${esc(values[0])}</span>${points}<span class="dp-tk" data-team="red">${esc(values[1])}</span><small>目标 ${esc(r.score_limit)}</small>`:points;}
  });
  patch(deploy,'drawMap',function(...args){
    const result=originalDeploy.drawMap.apply(this,args);if(native())for(const button of this.el.querySelectorAll('#dp-spawns [data-act="spawn"]')){const spawn=sharedMap().spawns[Number(button.dataset.i)];if(spawn){button.dataset.nativeSpawn=spawn.id;button.title=spawn.label||spawn.id;const label=button.querySelector('span');if(label)label.textContent=spawn.label||spawn.id;}}return result;
  });
  function refresh(){
    if(disposed)return;
    const r=frontline.room(),isNative=!!r;
    if(isNative&&r.battle!==lastBattle){lastBattle=r.battle;deploy.spawn=0;deploy._mapT=0;deploymentError='';garageOpened=false;}
    if(!isNative&&lastNative){if(opened)deploy.close();frontline.setDeploymentVisible?.(false);opened=garageOpened=false;lastBattle=null;}
    lobby.render();
    if(isNative){const me=frontline.self();if(!battle()||!me||me.observer||frontline.controlled()){if(opened)deploy.close();frontline.setDeploymentVisible?.(false);opened=garageOpened=false;}else if(aircraft.openGarage&&!aircraft.openBattlefield){if(!garageOpened)openDeployment();}else if(!deploy.visible)openDeployment();else{deploy.renderAmmo();deploy.update();}}
    lastNative=isNative;
  }
  const unsubscribe=frontline.subscribe(refresh);
  const api={refresh,openDeployment,launchFromGarage(id,spawnIndex=0){return sendDeployment(id,aircraft.selectedLoadout(id),spawnIndex);},mode:()=>native()?'air_frontline':chosenMode,setMode(mode){if(!['casual','historical','air_frontline'].includes(mode))throw Error('Unsupported lobby mode');chosenMode=mode;syncModeFields();},rooms:roomRows,loadouts,parseRoomKey:parseKey,dispose(){if(disposed)return;disposed=true;unsubscribe?.();frontline.setDeploymentVisible?.(false);for(const [target,name,value,own]of saved.reverse()){if(own)target[name]=value;else delete target[name];}delete lobby.__frontlineSharedLobby;}};
  lobby.__frontlineSharedLobby=api;refresh();return api;
}

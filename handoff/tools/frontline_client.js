    // A canonical persisted integer string denotes the same source choice.
    // Invalid or removed choices stay invalid; never clamp them to a new loadout.
    function frontlineLoadoutIndex(value){
      if(typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value))value=Number(value);
      return Number.isSafeInteger(value)&&value>=0?value:NaN;
    }
    function frontlineDeploymentMapView(map){
      const t=map.terrain,points=[];
      for(const a of map.airspawns||[])if(a.enabled&&a.pos?.length===3)points.push([a.pos[0],a.pos[2]]);
      for(const a of map.airfields||[])if(a.enabled&&a.runway?.center)points.push(a.runway.center);
      for(const a of map.objectives||[])if(['W2','C2','E2'].includes(a.id))points.push([a.pos[0],a.pos[2]]);
      const valid=points.filter(p=>p.length===2&&p.every(Number.isFinite));
      if(!valid.length)return {x0:t.x0,z0:t.z0,size:Math.max((t.width-1)*t.cellX,(t.height-1)*t.cellZ)};
      const xs=valid.map(p=>p[0]),zs=valid.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs);
      const size=Math.max(10000,maxX-minX,maxZ-minZ)*1.3;
      return {x0:(minX+maxX-size)/2,z0:(minZ+maxZ-size)/2,size};
    }
    var frontlineDeploymentPictures=new WeakMap();
    function frontlineDeploymentMapPicture(map,view){
      if(typeof document==='undefined'||typeof createFrontlineMapBackground!=='function'||!Array.isArray(map.terrain.waterAreas))return null;
      const signature=[view.x0,view.z0,view.size].join(':'),prior=frontlineDeploymentPictures.get(map);
      if(prior?.signature===signature)return prior.picture;
      const picture=document.createElement('canvas');picture.width=picture.height=768;
      const g=picture.getContext('2d');g.save();g.translate(0,768);g.scale(1,-1);
      try{createFrontlineMapBackground(map).draw(g,{width:768,height:768,centre:[view.x0+view.size/2,view.z0+view.size/2],scale:view.size/768});}finally{g.restore();}
      frontlineDeploymentPictures.set(map,{signature,picture});return picture;
    }
    // These readers describe accepted service state. They never run a clock,
    // repair a part, or grant fuel/ammunition/loadouts in the client.
    function frontlineAirServiceReason(code){
      return ({not_stopped:'尚未在地面停稳（速度须不超过1.5 m/s）',not_friendly_runway:'不在己方可用跑道内',gear_not_down:'起落架尚未完全放下',unsafe_controls:'油门须降至6%以下，并松开操纵、射击和投放',aircraft_fire:'飞机仍在起火',new_damage:'整备期间受到新的损伤',control_released:'驾驶控制已解除',availability_unavailable:'机场设施或补给暂不可用',cancelled:'已手动取消',aircraft_lost:'飞机已损失',not_controlled:'未接管此飞机',runtime_fault:'飞机模拟暂不可用',unknown_loadout:'没有所选挂载',unsupported_loadout:'此挂载尚未开放',service_already_active:'请先取消当前整备，再选择其他挂载',left_service_area:'飞机离开了整备机场'})[code]||code||'条件发生变化';
    }
    function frontlineAirServicePresentation(unit,map,intent={}){
      const service=unit?.service,status=service?.status||'idle',s=unit?.state||[];
      const throttle=intent.throttle??s[27];
      let reason=null,field=null;
      if(!unit?.alive||unit.fault)reason='aircraft_lost';
      else if(unit.damage?.fire)reason='aircraft_fire';
      else if(!Number.isFinite(throttle)||throttle>.06||intent.fire||intent.release||(intent.axes||[]).some(v=>!Number.isFinite(v)||Math.abs(v)>.05))reason='unsafe_controls';
      else if(s[33]<.9||intent.sequencedGear&&(!(unit.aero?.[36]>=.999)||!(unit.aero?.[38]>=.999)))reason='gear_not_down';
      else if(!Number.isFinite(s[75])||s[75]>1.5||s[35]<1.5||s[35]>2.5||s[36]!==4)reason='not_stopped';
      else{const team=unit.team==='blue'?0:1;field=(map?.airfields||[]).find(f=>{const r=f.runway;if(!f.enabled||f.team!==team||!r)return false;const dx=unit.pos[0]-r.center[0],dz=unit.pos[2]-r.center[1];return Math.abs(dx*r.forward[1]-dz*r.forward[0])<=r.widthMeters/2&&Math.abs(dx*r.forward[0]+dz*r.forward[1])<=r.lengthMeters/2;});if(!field)reason='not_friendly_runway';}
      const duration=Number.isFinite(service?.duration_s)?service.duration_s:15,elapsed=Number.isFinite(service?.elapsed_s)?service.elapsed_s:0,remaining=Number.isFinite(service?.remaining_s)?service.remaining_s:duration;
      let text='机场整备：在己方跑道停稳，连续15秒完成维修、补弹、加油及所选挂载更换。';
      if(!service)text+='\n服务器尚未提供整备状态。';
      else if(status==='servicing')text=`${service.airfield||'机场'} 整备 ${elapsed.toFixed(1)} / ${duration.toFixed(0)} 秒，剩余 ${remaining.toFixed(1)} 秒。\n保持低油门、停稳且不起火；操纵、射击、投放、离开或受伤会中断。`;
      else if(status==='complete')text=`${service.airfield||'机场'} 整备完成，库存与损伤以服务器当前记录为准。`;
      else if(status==='cancelled')text=`整备${service.reason==='cancelled'?'已取消':'已中断'}：${frontlineAirServiceReason(service.reason)}。进度清零，未完成的整备不补充库存。`;
      if(status!=='servicing')text+=`\n当前条件：${reason?frontlineAirServiceReason(reason):`${field?.id||'己方机场'} 可申请整备，设施与补给仍由服务器确认。`}`;
      return {status,eligible:!!service&&!reason,reason,field:field?.id||null,elapsed,remaining,duration,text};
    }
    function frontlineObjectivePresentation(objective,team){
      const progress=Number.isFinite(objective.progress)?Math.max(-1,Math.min(1,objective.progress)):0;
      const side=team==='blue'?0:team==='red'?1:null,known=Array.isArray(objective.capturable);
      const locked=known&&(side===null?!objective.capturable.some(Boolean):objective.owner!==team&&!objective.capturable[side]);
      const state=[objective.contested?'争夺':'',locked?'锁定':''].filter(Boolean).join(' ')||(team!=null&&objective.owner===team?'己方':known?'可攻':'');
      return {progress,locked,contested:!!objective.contested,label:`${objective.label||objective.name||objective.id}${state?' '+state:''} ${progress>0?'蓝':progress<0?'红':''}${Math.round(Math.abs(progress)*100)}%`};
    }
    function frontlineAcceptScoreEvents(room,events){
      if(!room)return;
      for(const event of events||[]){
        if(event.kind!=='player_score'&&event.kind!=='team_score')continue;
        if(Array.isArray(event.team_score)&&event.team_score.length===2)room.team_score=event.team_score;
        if(Number.isFinite(event.score_limit))room.score_limit=event.score_limit;
        if(event.kind==='player_score'&&event.totals?.player===event.player){
          const rows=room.scoreboard||[],index=rows.findIndex(row=>row.player===event.player);
          room.scoreboard=index<0?[...rows,event.totals]:rows.map((row,i)=>i===index?event.totals:row);
        }
      }
    }
    function frontlineFrontLabel(front){return ({west:'西线',centre:'中线',east:'东线'})[front]||front||'前线';}
    function frontlineGroundDeploymentPresentation({staging=[],member,company,current,selected,started}){
      const sources=member&&!member.observer?staging.filter(s=>s.team===member.team&&typeof s.id==='string'&&s.id&&Array.isArray(s.pos)&&s.pos.length===3&&s.pos.every(Number.isFinite)):[];
      const chosen=sources.find(s=>s.id===selected)||sources.find(s=>s.id===company?.staging)||sources.find(s=>s.available===true&&s.front==='centre')||sources.find(s=>s.available===true)||sources[0];
      const canDeploy=!!started&&!!member&&!member.observer&&!current&&chosen?.available===true;
      const note=member?.observer?'观战者不部署载具。':!sources.length?'尚无己方部署区。':!chosen?.available?'此部署区暂不可用，请选择其它己方部署区。':company?'原坦克连继续保留。可接管部署区内的原车，或从单位列表接管幸存坦克。':`${frontlineFrontLabel(chosen.front)}后方出击：亲自驾驶一辆坦克，另有九辆 AI，编为三个排。`;
      return {sources,selected:chosen?.id||'',canDeploy,note};
    }
    function frontlineReinforcementPresentation(company){
      const r=company?.reinforcement;if(!r)return '';
      const statuses={full:'编制已满',ready:'等待后方增援',waiting:'等待下一批',source_unavailable:'部署区或补给暂不可用',source_occupied:'部署区繁忙，等待空位',route_blocked:'归队道路中断',readiness_exhausted:'团队战备不足'};
      const incoming=Number.isFinite(r.incoming)?r.incoming:0,pending=Number.isFinite(r.pending)?r.pending:0;
      return `\n增援在途 ${incoming}　待补 ${pending} · ${statuses[r.status]||'等待服务器安排'}${pending>0&&['ready','waiting'].includes(r.status)&&Number.isFinite(r.next_batch_s)?`（下批约 ${Math.ceil(Math.max(0,r.next_batch_s))} 秒）`:''}`;
    }
    function frontlineTheatreMapView(terrain,width,height){
      if(!terrain||![terrain.x0,terrain.z0,terrain.cellX,terrain.cellZ,terrain.width,terrain.height,width,height].every(Number.isFinite)||terrain.width<2||terrain.height<2||terrain.cellX<=0||terrain.cellZ<=0||width<=0||height<=0)return null;
      const spanX=(terrain.width-1)*terrain.cellX,spanZ=(terrain.height-1)*terrain.cellZ;
      return {centre:[terrain.x0+spanX/2,terrain.z0+spanZ/2],scale:Math.max(spanX/width,spanZ/height)*1.08};
    }
    function frontlineAircraftHud(unit,model,reader,gunFactory,storeDefs){
      // Stable display reservoirs prevent each network JSON object from being
      // mistaken for rearm. Only accepted values enter these read-only copies.
      let p=model.hudProjection;
      if(!p){p=model.hudProjection={plane:model.plane,guns:[],fuel:{},stores:{items:[]},gunMetadata:new Map(gunFactory().map(g=>[g.id,g]))};}
      if(unit.fuel){p.fuel=p.fuel||{};for(const k of ['kg','max','flow'])p.fuel[k]=unit.fuel[k];}else p.fuel=null;
      const oldStores=new Map(p.stores.items.map((item,i)=>[`${i}:${item.id}`,item]));
      const stores=(unit.stores||[]).map((host,i)=>{const id=host.id||host.weapon,item=oldStores.get(`${i}:${id}`)||{id,def:storeDefs[id]||{}};for(const k of ['owner','count','gone','fuel','connected','station','pylonN','side'])item[k]=host[k];if(host.owner!=='body'&&p.plane.damage?.gone?.(host.owner))item.gone=true;if(item.def.kind==='tank'&&!Number.isFinite(item.fuel))item.fuel=NaN;return item;});p.stores.items.splice(0,p.stores.items.length,...stores);
      const podFeeds=new Map(stores.filter(item=>item.def.kind==='gunpod'&&item.def.gun).map(item=>[`air_pod_${item.pylonN??item.station}_${item.side}`,item]));
      const oldGuns=new Map(p.guns.map(g=>[g.id,g]));
      const guns=(unit.guns||[]).map(host=>{const pod=podFeeds.get(host.id),g=oldGuns.get(host.id)||{...p.gunMetadata.get(host.id),id:host.id};g.ammo=host.ammo;g.owner=host.owner;
        if(pod){g.kind='cannon';g.belt=pod.def.gun.belt;g.podItem=pod;}else if(host.id.startsWith('air_pod_'))g.podItem=p.orphanPod||(p.orphanPod={gone:true});
        return g;});p.guns.splice(0,p.guns.length,...guns);
      const report=reader.report(p,0,{historyKey:p,timeSeconds:unit.state[23],lifeKey:`${unit.unit.battle}:${unit.unit.unit}:${unit.unit.life}`,resetKey:unit.loadout});
      if(stores.some(s=>s.def.kind==='tank'&&!s.gone&&s.connected!==false&&!p.plane.damage?.dead?.(s.owner)&&!Number.isFinite(s.fuel)))Object.assign(report.fuel,{usableKg:null,externalKg:null,enduranceSeconds:null,timeText:'—',state:'unavailable',statusZh:'外置油箱数据未就绪'});
      const fuel=report.fuel,format=(n,d=0)=>Number.isFinite(n)?n.toFixed(d):'—';
      const gunText=report.guns.map(g=>`${g.labelZh.replace('吊艙機炮','吊舱机炮').replace('機炮','机炮')} ${g.unknownAmmo?'—':g.rounds}`).join('　');
      const fuelStatus=unit.fault?'模拟暂不可用':!unit.alive?'飞机已损失':fuel.statusZh;
      return {report,text:`${model.plane.type.name} #${unit.unit.unit}\nIAS ${format(unit.state[14]*3.6)} km/h　高度 ${format(unit.state[1])} m\n${gunText||'机炮：无'}\n燃油 ${format(fuel.usableKg)} kg（内 ${format(fuel.internalKg)} / ${format(unit.fuel?.max)}，外 ${format(fuel.externalKg)}）\n预计续航 ${unit.alive&&!unit.fault?fuel.timeText:'—'} · ${fuelStatus}\n当前流量 ${format(unit.fuel?.flow,2)} kg/s\n外挂 ${report.stores.map(s=>`${s.name} × ${s.unknownCount?'—':s.count}`).join('　')||'无'}`};
    }
    function frontlineRoundPresentation(room){
      if(!room)return {state:'waiting',text:''};
      const state=room.round_state||(room.started?'battle':'waiting'),elapsed=Number.isFinite(room.round_elapsed_s)?Math.max(0,room.round_elapsed_s):0;
      const clock=`${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(Math.floor(elapsed%60)).padStart(2,'0')}`,number=room.round_number||1;
      const winner=room.result?.winner,verdict=winner?(winner==='blue'?'蓝方':'红方')+'获胜':'平局';
      const reason=({frontline:'战线突破',readiness:'战备耗尽',time:'时间结束',score:'达到目标分数',score_limit:'达到目标分数',air_elimination:'敌方空军全灭',landing_completed:'登陆完成',attacker_fleet_annihilated:'进攻舰队全灭',landing_timeout:'登陆超时'})[room.result?.reason]||'本局结束';
      return {state,text:state==='intermission'?`第 ${number} 局结束 · ${verdict} · ${reason}${Number.isFinite(room.next_round_s)?` · 下一局 ${Math.ceil(Math.max(0,room.next_round_s))} 秒`:' · 正在结算'}`:state==='battle'?`第 ${number} 局 · ${clock}`:'等待开始'};
    }
    // The shared UI sends intents only. Accepted room/life/resources stay native-owned.
    function createFrontlineSharedApi({f,net,send,ensureMapOptions,ensureMap,mine,controlled,clearInput,note,fuelPolicy=null,fuelIntent=null}){
      const listeners=new Set(),eras=new Set([1953,1976,1986,2022]);let disposed=false;
      const native=()=>f.room?.battle_mode==='air_frontline'?f.room:null;
      const state=()=>native()?.round_state||(native()?.started?'battle':'waiting');
      const option=id=>(f.aircraftOptions||[]).find(o=>o.id===id);
      const retained=()=>(f.aircrafts||[]).find(u=>u.owner===net.id&&u.alive);
      const deny=message=>{throw Error(message);};
      const ensureConnected=()=>{if(disposed||!net.open)deny('请先连接服务器');};
      function availability(){
        const member=mine(),old=retained();
        if(!native()||state()!=='battle'||!member||member.observer)return {allowed:false,reason:'当前不能出击，观战者不部署飞机',retained:old};
        if(controlled())return {allowed:false,reason:'请先返回出击界面',retained:old};
        if(f.airDeploymentPending)return {allowed:false,reason:'正在等待服务器确认出击',retained:old};
        if(member.air_sortie_eligible===false||member.air_sorties_remaining===0&&!old)return {allowed:false,reason:'本局出击机会已用完，请等待下一局',retained:null};
        return {allowed:true,reason:'',retained:old};
      }
      function customChoice(id,custom){
        if(!custom||typeof custom!=='object'||Array.isArray(custom))deny('自订挂载配置无效');
        const slots=option(id)?.slots;if(!Array.isArray(slots))deny('服务器尚未提供自订挂点目录');
        const result={};for(const [key,store] of Object.entries(custom)){
          const slot=slots.find(s=>s.key===key);if(!slot)deny(`未知挂点：${key}`);
          if(typeof store!=='string'||!Object.hasOwn(slot.options||{},store))deny(`挂点 ${key} 不支持此武器`);
          if(slot.unsupported?.[store])deny(String(slot.unsupported[store]));
          if(slot.incomplete?.[store])deny(`挂点武器未完成：${String(slot.incomplete[store])}`);
          result[key]=store;
        }return result;
      }
      function configuration(id,{loadout,custom,fuel_minutes}={}){
        if(!option(id))deny('当前服务器未开放此飞机');
        let cfg;
        if(custom!==undefined&&custom!==null)cfg={loadout:0,custom:customChoice(id,custom)};
        else{if(!Number.isSafeInteger(loadout)||!option(id).loadouts?.some(lo=>lo.index===loadout))deny('当前服务器未开放此挂载配置');cfg={loadout};}
        if(fuel_minutes!==undefined){
          if(option(id).fuel_load?.version===1&&fuelPolicy)cfg.fuel_minutes=fuelPolicy.normalize(fuel_minutes);
          else if(fuel_minutes!==null)deny('当前服务器只支持满油；不能发送燃油选择');
        }
        return cfg;
      }
      function deploymentMap(){
        const member=mine(),map=f.map;if(!map||!member)deny('服务器地图或出生点尚未就绪');
        const side=member.team==='blue'?0:1,t=map.terrain,spawns=[];
        const air=(map.airspawns||[]).find(a=>a.enabled&&a.team===side&&Array.isArray(a.pos)&&a.pos.every(Number.isFinite));
        const field=(map.airfields||[]).find(a=>a.enabled&&a.team===side&&a.runway);
        if(air)spawns.push({id:'air',label:'空中出生',x:air.pos[0],z:air.pos[2],heading:air.yawRad||0});
        if(field){const r=field.runway;spawns.push({id:'runway',label:'机场跑道出生',x:r.center[0],z:r.center[1],heading:r.heading??Math.atan2(r.forward[0],r.forward[1])});}
        if(!spawns.length)deny('本队暂时没有可用出生点');
        const label={W2:'A',C2:'B',E2:'C'},view=frontlineDeploymentMapView(map);
        return {name:map.id==='taiwan'?'台湾海峡 · 空中战区':map.name,mode:'纯空战 · 三战区',picture:frontlineDeploymentMapPicture(map,view),...view,grid:6,spawns,team:member.team,points:(f.objectives||[]).filter(o=>Object.hasOwn(label,o.id)).map(o=>({id:o.label||label[o.id],nativeId:o.id,x:o.pos[0],z:o.pos[2],r:o.radius,radius:o.radius,owner:o.owner,progress:o.progress,contested:o.contested})),tickets:native()?.team_score||null,others:(f.units||[]).concat(f.aircrafts||[]).map(u=>({x:u.pos[0],z:u.pos[2],alive:u.alive,friend:u.team===member.team}))};
      }
      const api={room:native,spectating:()=>f.spectator||f.lossPending,rooms:()=>f.rooms||[],maps:()=>f.availableMaps||[],self:mine,controlled,aircraftOptions:()=>f.aircraftOptions||[],deploymentError:()=>f.lastDeploymentError||'',deploymentMap,availability,configuration,retained,
        async list(){ensureConnected();await ensureMapOptions(net.url,true);send({op:'list'});api.notify();},
        create({map,era,name='',observer=false}){ensureConnected();if(native()||net.room)deny('请先离开当前房间');if(!(f.availableMaps||[]).some(m=>m.id===map)||!eras.has(era))deny('请选择有效地图与年代');send({op:'create',map,era,name,observer:!!observer});},
        join({room,observer=false}){ensureConnected();if(native()||net.room)deny('请先离开当前房间');if(!(f.rooms||[]).some(r=>r.id===room&&r.battle_mode==='air_frontline'))deny('空战房间已变化，请刷新或更新服务器');send({op:'join',room,observer:!!observer});},
        start(){ensureConnected();if(native()?.host!==net.id||state()!=='waiting')deny('当前不能开始空战');send({op:'start'});},
        leave(){ensureConnected();if(!native())return;clearInput();send({op:'leave'});},
        deployAir({aircraft,loadout,custom,spawn,fuel_minutes}){ensureConnected();const a=availability();if(!a.allowed)deny(a.reason);if(!deploymentMap().spawns.some(s=>s.id===spawn))deny('请选择有效出生点');const pick=fuel_minutes===undefined?(fuelIntent?.(aircraft)||{}):{fuel_minutes},cfg=configuration(aircraft,{loadout,custom,...pick});if(a.retained&&a.retained.aircraft!==aircraft)deny('原机仍在场，不能更换机型');if(a.retained){const accepted=a.retained.custom!=null?{loadout:0,custom:{...a.retained.custom}}:{loadout:a.retained.loadout};note?.('接管原机，沿用原机损伤、库存和挂载；新配置须在机场整备。');send({op:'deploy_air',aircraft,...accepted,spawn});}else send({op:'deploy_air',aircraft,...cfg,spawn});f.lastDeploymentError=null;f.airDeploymentPending=true;},
        returnToDeployment(){ensureConnected();clearInput();send({op:'return'});},
        serviceAir({loadout,custom,fuel_minutes,cancel=false}={}){ensureConnected();const unit=controlled();if(!unit?.aircraft)deny('尚未接管飞机');const pick=fuel_minutes===undefined?(fuelIntent?.(unit.aircraft)||{}):{fuel_minutes},cfg=cancel?{}:configuration(unit.aircraft,{loadout,custom,...pick});send({op:cancel?'cancel_air_service':'service_air',unit:unit.unit,epoch:f.epoch,seq:++f.seq,...cfg});},
        subscribe(fn){if(typeof fn!=='function')deny('Invalid UI subscriber');listeners.add(fn);return()=>listeners.delete(fn);},
        notify(){if(!disposed)for(const fn of listeners)fn();},
        setDeploymentVisible(on){f.deploymentVisible=!!on;},
        dispose(){disposed=true;listeners.clear();}
      };return api;
    }
    // A contact alone is not a detonation. Burst locations must come from the
    // accepted event, never a moving visual model or a projectile's filler flag.
    function frontlineImpactPresentation(event){
      const vector=p=>{const a=Array.isArray(p)?p:p&&[p.x,p.y,p.z];return a?.length===3&&a.every(Number.isFinite)?a:null;};
      const detail=event.detail||{},report=detail.report||{},hit=report.hit||report;
      const rows=detail.world_bursts||hit.bursts||[],bursts=[],limitations=[];
      if(hit.fuze_status==='unarmed')return {bursts,limitations};
      const accepted=detail.accepted_pose,origin=vector(accepted?.hull_origin),ex=vector(accepted?.ex),ey=vector(accepted?.ey),ez=vector(accepted?.ez);
      for(const burst of rows){
        const delayed=burst.mechanism==='delayed_aphe',contact=burst.mechanism==='immediate_he'&&burst.time_origin==='first_contact'&&burst.time_s===0;
        if(!Number.isFinite(burst.time_s)||burst.time_s<0||!delayed&&!contact){limitations.push('burst_timing_unrecorded');continue;}
        const strength=burst.tnt_equivalent_kg??burst.explosive_kg;
        if(!Number.isFinite(strength)||strength<=0){limitations.push('burst_strength_unrecorded');continue;}
        let position=vector(burst.world_position);
        const local=vector(burst.point||burst.pos);
        if(!position&&origin&&ex&&ey&&ez&&local)position=origin.map((v,k)=>v+ex[k]*local[0]+ey[k]*local[1]+ez[k]*local[2]);
        if(!position&&contact)position=vector(event.pos);
        if(!position){limitations.push('burst_world_pose_unrecorded');continue;}
        bursts.push({position,strength,time_s:burst.time_s});
      }
      return {bursts,limitations};
    }
    // Production client for the versioned native frontline world. The host owns all units.
    const frontline = (() => {
      const ui = document.createElement('section');
      ui.id = 'frontline-ui'; ui.hidden = true;
      ui.innerHTML = `<header><b>纯空战 · A/B/C</b><button data-fl="close">收起</button></header>
        <div class="fl-setup" hidden inert><label>服务器 <input data-fl="server"></label><label>名字 <input data-fl="name" maxlength="24" value="前线指挥官"></label>
        <label>地图 <select data-fl="map"><option value="korea">三八线 · 临津江—铁原</option></select></label>
        <label>年代 <select data-fl="era"><option value="1986">1986 · 冷战</option><option value="1953">1953 · 早期喷气</option><option value="1976">1976 · 超音速</option><option value="2022">2022 · 现代</option></select></label>
        <div class="fl-row"><button data-fl="create">创建前线对局</button><button data-fl="observe">单人 AI 观战</button><button data-fl="list">读取地图与房间</button></div>
        <div data-fl="rooms"></div></div>
        <div data-fl="room"></div><div data-fl="status" role="status">选择参战或观看两队 AI 交战。</div>
        <div class="fl-row fl-battle fl-ground-controls" hidden inert><button data-fl="start">开始</button><select data-fl="vehicle" aria-label="坦克型号"></select><select data-fl="ground-staging" aria-label="坦克连部署区"></select><button data-fl="deploy">坦克连出击</button></div><small data-fl="ground-deployment-note" hidden></small>
        <div class="fl-row fl-battle fl-source-air-controls" hidden inert><select data-fl="aircraft" aria-label="飞机机型"></select><select data-fl="air-loadout" aria-label="飞机挂载"></select><select data-fl="air-spawn" aria-label="飞机出生"><option value="air">后方空中出生</option><option value="runway">机场跑道出生</option></select><button data-fl="deploy-air">飞机出击</button></div>
        <small data-fl="air-deployment-note"></small><div data-fl="air-service-panel" hidden><div data-fl="air-fuel-choice"></div><div class="fl-row"><button data-fl="service-air">开始15秒整备</button><button data-fl="cancel-air-service">取消整备</button></div><div data-fl="air-service-status" role="status"></div></div>
        <div class="fl-row fl-battle"><button data-fl="return">返回出击界面</button><select data-fl="follow"><option value="">自由镜头</option></select><button data-fl="takeover" hidden disabled>接管幸存车</button><button data-fl="leave">退出对局</button></div>
        <div class="fl-command" hidden inert><label>命令对象 <select data-fl="platoon"><option value="all">全连 AI</option><option value="0">1 排</option><option value="1">2 排</option><option value="2">3 排</option></select></label>
        <div class="fl-row"><button data-order="move">行军</button><button data-order="attack">进攻</button><button data-order="defend">防守</button></div></div>
        <details data-fl="support-panel" hidden><summary>工兵与补给</summary><label>支援车辆 <select data-fl="support-unit"></select></label><label>目标设施 <select data-fl="support-target"></select></label><div class="fl-row"><button data-fl="support-repair">派遣维修</button><button data-fl="support-supply">运送补给</button></div><small data-fl="support-status"></small></details>
        <label>战术图范围 <select data-fl="map-range"><option value="14">近距 · 6.7 km</option><option value="50">地区 · 24 km</option><option value="150">空地 · 72 km</option><option value="400">广域 · 192 km</option><option value="theatre">整个战区</option></select></label><label><input type="checkbox" data-fl="map-follow" checked> 跟随当前视角</label><canvas data-fl="mapview" width="480" height="340" aria-label="前线战术地图"></canvas><div data-fl="inventory"></div>
        <small data-fl="help">驾驶：W/S 油门、A/D 转向、空格制动、左键开炮；右键拖动瞄准与镜头。观战：WASD 移动、Q/E 升降；滚轮缩放。选择地图命令后点击战术地图下令。</small>
        <div class="fl-touch"><button data-held="KeyW">前进</button><button data-held="KeyS">后退</button><button data-held="KeyA">左转</button><button data-held="KeyD">右转</button><button data-held="Space">制动</button><button data-held="fire">开炮</button></div><div class="fl-touch fl-air-touch" hidden><button data-held="ShiftLeft">加油门</button><button data-held="ControlLeft">减油门</button><button data-held="KeyQ">左舵</button><button data-held="KeyE">右舵</button><button data-air-toggle="KeyG">起落架</button><button data-air-toggle="KeyF">襟翼</button><button data-air-toggle="KeyV">视角</button></div><details><summary>地图数据来源</summary><small data-fl="credit"></small></details>`;
      // Detached transport/compatibility controls. The player uses the existing
      // garage, aircraft HUD, action bar and minimap rather than this old panel.
      const style = document.createElement('style');
      style.textContent = `#frontline-ui{position:fixed;right:12px;top:12px;bottom:12px;width:380px;overflow:auto;z-index:1400;padding:14px;background:#142027f2;border:1px solid #54676c;color:#e9ede6;font:13px/1.5 system-ui;border-radius:5px}#frontline-ui[hidden]{display:none}#frontline-ui header,.fl-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:7px 0}#frontline-ui header{justify-content:space-between}#frontline-ui label{display:block;margin:5px 0}#frontline-ui input,#frontline-ui select{max-width:100%;background:#24343c;color:inherit;border:1px solid #55676c;padding:5px}#frontline-ui button{padding:6px 9px;border:1px solid #647778;background:#273e46;color:inherit;cursor:pointer}#frontline-ui button:disabled{opacity:.4;cursor:default}#frontline-ui button.active{border-color:#e6b968;color:#e6b968}#frontline-ui [data-fl=status]{padding:8px 0;color:#e6c386;white-space:pre-wrap}#frontline-ui [data-fl=inventory]{font:12px/1.7 monospace;white-space:pre-wrap;margin:8px 0}#frontline-ui canvas{width:100%;height:auto;background:#10232b;touch-action:none}#frontline-ui small{display:block;color:#afc0c1;font-size:11px}.fl-touch{display:none;gap:5px;flex-wrap:wrap;margin-top:8px}#frontline-open{position:fixed;right:18px;bottom:18px;z-index:1350;padding:10px 14px;background:#263e47;color:#e6d3ab;border:1px solid #647778;cursor:pointer}body[data-mode=frontline] #garage,body[data-mode=frontline] #hud,body[data-mode=frontline] #touch{display:none!important}#frontline-reticle{position:fixed;left:50%;top:50%;color:#eee8d0;font:26px monospace;pointer-events:none;z-index:1200;transform:translate(-50%,-50%)}@media(pointer:coarse){.fl-touch{display:flex}}@media(max-width:650px){#frontline-ui{width:min(340px,calc(100% - 20px));top:8px;right:8px;bottom:8px}#frontline-ui small{font-size:10px}.fl-setup{font-size:12px}}`;
      document.head.append(style);
      style.textContent += '#frontline-flight-readout{position:fixed;left:16px;top:16px;z-index:1250;white-space:pre-wrap;color:#e9efdc;text-shadow:0 1px 3px #000;font:14px/1.6 monospace;pointer-events:none}.fl-air-touch[hidden]{display:none!important}';
      style.textContent += '#frontline-ui [data-fl=air-service-status]{white-space:pre-wrap;color:#cbdcbe;padding:7px 0}';
      style.textContent+='body[data-frontline-watch="1"] #drive,body[data-frontline-watch="1"] #gunbox,body[data-frontline-watch="1"] #lock-hint,body[data-frontline-watch="1"] #veh-name,body[data-frontline-watch="1"] #gameplay-rule,body[data-frontline-watch="1"] #help,body[data-frontline-watch="1"] #touch{display:none!important}';
      const open = null; // The existing #net-btn / LobbyUi is the only connection entry.
      const reticle = document.createElement('div');reticle.hidden=true;
      const flightReadout=document.createElement('output');flightReadout.hidden=true;
      const el = key => ui.querySelector(`[data-fl="${key}"]`);
      el('server').value=defaultServer();
      const f={active:false,room:null,rooms:[],units:[],aircrafts:[],missiles:[],aircraftOptions:[],companies:[],vehicles:[],objectives:[],staging:[],control:null,epoch:0,seq:0,orderSeq:0,order:null,map:null,models:new Map(),airModels:new Map(),root:new Node('frontline-world'),terrain:null,terrainOrigin:null,keys:new Set(),yaw:0,pitch:-.32,distance:45,focus:null,follow:null,fire:false,sendAt:0,mouse:null,autoStart:false,lastTick:0,events:[],mapScale:1,mapCentre:null,error:null};
      f.ordnancePresentation=createFrontlineOrdnanceVisual({Node,storeMesh,storeDefs:AIR_STORE_DEFS,quatMatrix,aqLook,fx});f.root.add(f.ordnancePresentation.root);
      f.gunTracerPresentation=createFrontlineGunTracerVisual({fx});
      f.vessels=[];f.navalCatalog=[];f.scenario=null;f.spectator=null;f.lossPending=false;
      f.navalPresentation=createFrontlineNavalVisual({Node,renderer,GeoBuilder});f.root.add(f.navalPresentation.root);
      f.airportPresentation=createFrontlineAirwarAirports({Node,renderer,GeoBuilder,identity:IDENTITY,fx});f.root.add(f.airportPresentation.root);
      const airwarOverlay=document.createElement('aside');airwarOverlay.id='frontline-airwar-mission';airwarOverlay.hidden=true;airwarOverlay.style.cssText='position:fixed;bottom:28px;left:50%;transform:translateX(-50%);max-width:65vw;background:#10202cd9;color:#e5f0ed;border:1px solid #708c93;padding:7px 12px;font:13px/1.5 system-ui;z-index:1240;text-align:center';
      const airwarText=document.createElement('div'),spectatorNext=document.createElement('button');spectatorNext.type='button';spectatorNext.textContent='下一位队友';spectatorNext.style.cssText='margin:5px 0 0;padding:4px 12px;color:#ecf6f3;background:#284350;border:1px solid #8cabae';airwarOverlay.append(airwarText,spectatorNext);document.body.appendChild(airwarOverlay);
      spectatorNext.onclick=()=>{const friends=f.aircrafts.filter(u=>u.alive&&u.team===mine()?.team);if(friends.length){const i=friends.findIndex(u=>unitKey(u.unit)===f.follow);f.follow=unitKey(friends[(i+1)%friends.length].unit);syncAirwarSpectator();}};
      const renderGate=createFrontlineRenderGate(renderer);
      f.facilities=[];f.facilityJobs=[];f.supportSeq=0;
      f.facilityPresentation=createFrontlineFacilityPresentation({renderer});f.root.add(f.facilityPresentation.root);
      f.renderStats={gpu:renderGate.stats,frames:0,last:null,max:{},drawDt:0};
      const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
      const unitKey=r=>r?`${r.battle}:${r.unit}:${r.life}`:'';
      canvas.tabIndex=0;
      const same=(a,b)=>unitKey(a)===unitKey(b);
      const mine=()=>f.room?.members.find(p=>p.player===net.id);
      const owned=()=>f.companies.find(c=>c.owner===net.id);
      const allUnits=()=>f.units.concat(f.aircrafts);
      const controlled=()=>allUnits().find(u=>u.alive&&same(u.unit,f.control));
      const controlledAirModel=()=>f.airModels.get(unitKey(f.control));
      const sharedApi=createFrontlineSharedApi({f,net,send,ensureMapOptions,ensureMap,mine,controlled,clearInput,note,fuelPolicy:typeof TFAircraftFuelLoad!=='undefined'?TFAircraftFuelLoad:null,fuelIntent:id=>typeof aircraftFuelLoad!=='undefined'?aircraftFuelLoad.intentFor(id):{}});
      f.establishedFlight=createFrontlineExistingRuntime({f,mine,controlled,controlledAirModel,send,height,note,shared:sharedApi});
      function note(message){el('status').textContent=message;if(G4.air?.nativeAuthority)airReason(G4.air,message,3);}
      function resetBattlePresentation(){
        f.navalPresentation.clear();f.airportPresentation.clear();f.vessels=[];f.navalCatalog=[];f.scenario=null;f.spectator=null;f.lossPending=false;airwarOverlay.hidden=true;
        f.gunTracerPresentation.clear();
        f.ordnancePresentation.clear();f.missiles=[];
        f.establishedFlight.release();
        renderGate.clear();f.renderStats.drawDt=0;f.renderStats.lastDrawAt=undefined;
        for(const item of f.models.values()){releaseGroundDetail(item);item.lod.dispose();}
        for(const item of f.airModels.values())item.dispose();
        f.models.clear();f.airModels.clear();f.facilityPresentation.dispose();f.facilityIdentity=null;f.facilityCatalog=null;
        f.root.children=f.terrain?[f.terrain,f.facilityPresentation.root,f.ordnancePresentation.root]:[f.facilityPresentation.root,f.ordnancePresentation.root];f.terrainOrigin=null;
        for(const n of [f.navalPresentation.root,f.airportPresentation.root])if(!f.root.children.includes(n))f.root.add(n);
        f.contactPresentation=null;f.contacts=[];f.events=[];f.units=[];f.aircrafts=[];f.companies=[];f.objectives=[];f.facilities=[];f.facilityJobs=[];
        f.control=null;f.epoch=0;f.seq=0;f.orderSeq=0;f.supportSeq=0;f.lastTick=0;f.order=null;f.follow=null;f.fire=false;f.mouse=null;f.inputTime=undefined;f.audioCamera=null;f.lastServiceRejection=null;f.keys.clear();f.active=false;f.error=null;f.airDeploymentPending=false;f.lastDeploymentError=null;
        sound.cancelFull?.();for(const key of ['particles','decals','beams'])if(Array.isArray(fx[key]))fx[key].length=0;
        reticle.hidden=flightReadout.hidden=true;
      }
      function send(command){net.send({t:'frontline',version:1,command});}
      async function connect(){
        if(G4.mode==='battle'||G4.online)toGarage();
        const server=normalizeServer(el('server').value);
        if(net.open&&net.url!==server&&f.room)throw Error('请先退出当前对局，再切换服务器。');
        if(!net.open||net.url!==server)await net.connect(server,el('name').value.trim()||'前线指挥官');
        await ensureMapOptions(net.url);
        if(net.room){net.send({t:'leave'});}
      }
      function grid(g,x,z){
        const u=clamp((x-g.x0)/g.cellX,0,g.width-1),v=clamp((z-g.z0)/g.cellZ,0,g.height-1),i=Math.min(g.width-2,Math.floor(u)),j=Math.min(g.height-2,Math.floor(v)),a=u-i,b=v-j,k=j*g.width+i;
        return g.heights[k]*(1-a)*(1-b)+g.heights[k+1]*a*(1-b)+g.heights[k+g.width]*(1-a)*b+g.heights[k+g.width+1]*a*b;
      }
      function height(x,z){
        const t=f.map.terrain;let h=grid(t,x,z);
        for(const p of t.patches||[]){const maxX=p.x0+(p.width-1)*p.cellX,maxZ=p.z0+(p.height-1)*p.cellZ;if(x<p.x0||z<p.z0||x>maxX||z>maxZ)continue;const d=Math.min(x-p.x0,maxX-x,z-p.z0,maxZ-z),w=clamp(d/p.blendMeters,0,1);h=h*(1-w)+grid(p,x,z)*w;}
        const beds=t.roadbeds;
        if(beds){let total=0,weighted=0,maximum=0;const indices=beds.cells[`${Math.floor(x/beds.cellSize)},${Math.floor(z/beds.cellSize)}`]||[];
          for(const index of indices){const [ax,az,ah,bx,bz,bh,halfWidth,blend]=beds.segments[index],dx=bx-ax,dz=bz-az,u=clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz),0,1),d=Math.hypot(x-ax-dx*u,z-az-dz*u),w=clamp(1-Math.max(0,d-halfWidth)/blend,0,1);total+=w;weighted+=w*(ah+(bh-ah)*u);maximum=Math.max(maximum,w);}
          if(total)h=h*(1-maximum)+weighted/total*maximum;
        }
        for(const p of t.pads||[]){const d=Math.max(0,Math.abs(x-p.center[0])-p.halfSize[0],Math.abs(z-p.center[1])-p.halfSize[1]),w=clamp(1-d/p.blendMeters,0,1);h=h*(1-w)+p.height*w;}
        for(const p of t.runways||[]){const dx=x-p.center[0],dz=z-p.center[1],lat=dx*p.forward[1]-dz*p.forward[0],long=dx*p.forward[0]+dz*p.forward[1],d=Math.max(0,Math.abs(lat)-p.halfSize[0],Math.abs(long)-p.halfSize[1]),w=clamp(1-d/p.blendMeters,0,1);h=h*(1-w)+p.height*w;}
        return h;
      }
      async function ensureMapOptions(server,refresh=false){
        if(refresh&&f.registryServer===server){f.availableMaps=[];f.registryLoad=null;}
        if(f.registryServer===server&&f.availableMaps?.length)return f.availableMaps;
        if(f.registryServer!==server){f.registryServer=server;f.availableMaps=[];f.registryLoad=null;}
        if(!f.registryLoad){const load=(async()=>{
          const response=await fetch(new URL('/frontline/maps.json',server.replace(/^ws/,'http')));if(!response.ok)throw Error('无法读取服务器地图列表');
          const registry=await response.json(),maps=registry.maps;
          if(!Array.isArray(maps)||!maps.length||maps.some(m=>!/^[a-z0-9_-]+$/.test(m.id)||typeof m.name!=='string'||m.path!==`/frontline/${m.id}.json`||!/^[a-f0-9]{64}$/.test(m.sha256))||new Set(maps.map(m=>m.id)).size!==maps.length)throw Error('服务器地图列表无效');
          if(f.registryServer!==server||f.registryLoad!==load)return;
          const selected=el('map').value;el('map').replaceChildren(...maps.map(m=>new Option(m.name,m.id)));el('map').value=maps.some(m=>m.id===selected)?selected:maps[0].id;f.availableMaps=maps;return maps;
        })();f.registryLoad=load;load.catch(()=>{if(f.registryLoad===load)f.registryLoad=null;});}
        return f.registryLoad;
      }
      async function ensureMap(){
        const mapId=f.room?.map||el('map').value,revision=f.room?.map_revision||'';
        if(!/^[a-z0-9_-]+$/.test(mapId))throw Error('前线地图编号无效');
        if(f.map&&f.mapServer===net.url&&f.mapId===mapId&&f.mapRevision===revision)return;
        if(f.mapServer!==net.url||f.mapId!==mapId||f.mapRevision!==revision){f.map=null;f.mapLoad=null;f.mapServer=net.url;f.mapId=mapId;f.mapRevision=revision;f.terrainOrigin=null;f.farTerrain=null;f.farTerrainMap=null;f.farTerrainStats=null;}
        if(!f.mapLoad){const server=net.url,load=(async()=>{
          const url=new URL(`/frontline/${mapId}.json`,server.replace(/^ws/,'http'));
          const response=await fetch(url);if(!response.ok)throw Error('前线地形读取失败');
          const text=await response.text();if(revision&&(!/^[a-f0-9]{64}$/.test(revision)||sha256Text(text)!==revision))throw Error('地图数据已变化，请重新连接对局');
          const map=JSON.parse(text);if(f.mapId!==mapId||f.mapServer!==server||f.mapRevision!==revision)return;
          f.map=map;f.airportPresentation.install(map);if(f.map.schemaVersion!==1||!f.map.terrain?.heights?.length)throw Error('前线地形版本不同');
          // Prepare the whole Taiwan coast once while deployment waits for its
          // accepted map; flying750m never repeats source/water preparation.
          f.farTerrain=map.id==='taiwan'?createFrontlineFarTerrainGeometry({GeoBuilder,terrain:map.terrain,bounds:map.bounds,step:4000,createWaterCutout:createFrontlineWaterCutout,material:{color:hexToLinear('#6e7954'),rough:1,metal:0}}):null;
          f.farTerrainMap=f.farTerrain?map:null;f.farTerrainStats=f.farTerrain?{prepared:f.farTerrain.stats,last:null}:null;
          const objective=f.map.objectives.find(o=>f.map.initialScene.objectiveIds.includes(o.id));
          f.focus=objective?.pos?.slice()||[0,height(0,0),0];f.focus[1]+=3;f.mapCentre=[f.focus[0],f.focus[2]];
          el('credit').textContent=[f.map.provenance.terrain,f.map.provenance.roads].join(' | ');
        })();f.mapLoad=load;load.catch(()=>{if(f.mapLoad===load){f.mapLoad=null;f.map=null;f.terrainOrigin=null;f.farTerrain=null;f.farTerrainMap=null;f.farTerrainStats=null;}});}
        return f.mapLoad;
      }
      function refreshGroundDeployment(){
        const view=frontlineGroundDeploymentPresentation({staging:f.staging,member:mine(),company:owned(),current:controlled(),selected:el('ground-staging').value,started:f.room?.started});
        const signature=view.sources.map(s=>`${s.id}:${s.front}:${s.available}`).join('|');
        if(el('ground-staging').dataset.signature!==signature){const options=view.sources.map(s=>{const option=new Option(`${frontlineFrontLabel(s.front)}后方部署区${s.available===true?'':'（暂不可用）'}`,s.id);option.disabled=s.available!==true;return option;});el('ground-staging').replaceChildren(...options);el('ground-staging').dataset.signature=signature;}
        el('ground-staging').value=view.selected;el('ground-staging').disabled=!view.sources.length||!!mine()?.observer||!!controlled();
        el('deploy').disabled=!view.canDeploy;el('deploy').textContent=owned()?'接管部署区原车':'坦克连出击';el('ground-deployment-note').textContent=view.note;
        return view;
      }
      function requestGroundDeployment(){
        if(f.room?.battle_mode==='air_frontline'){note('纯空战只允许玩家驾驶飞机');return;}
        const view=refreshGroundDeployment();if(!view.canDeploy){note(view.note);return;}
        send({op:'deploy_at',vehicle:el('vehicle').value,staging:view.selected});
      }
      function facilityLabel(facility){
        const field=(f.map?.airfields||[]).find(a=>a.id===facility.airfield),names={bridge:'桥梁',runway_patch:'跑道区段',fuel:'燃油站',arming:'弹药站',repair:'维修站',supply_node:'前线补给点'};
        const peers=f.facilities.filter(a=>a.kind===facility.kind&&a.airfield===facility.airfield),index=peers.findIndex(a=>a.facility_id===facility.facility_id)+1;
        return `${field?.name?field.name+' · ':''}${names[facility.kind]||'设施'} ${index}${facility.damage_state==='destroyed'?'（已毁）':facility.damage_state==='damaged'?'（受损）':''}`;
      }
      function refreshSupportUi(){
        const member=mine(),units=f.units.filter(u=>u.alive&&u.team===member?.team&&['engineer','supply'].includes(u.role));
        el('support-panel').hidden=!f.room?.started||!!member?.observer;
        const targets=f.facilities.filter(t=>(t.team===null||t.team===(member?.team==='blue'?0:1))&&Number.isSafeInteger(t.revision));
        const refresh=(key,entries)=>{const select=el(key),signature=entries.map(e=>e.join(':')).join('|');if(select.dataset.signature!==signature){const old=select.value;select.replaceChildren(...entries.map(([id,label])=>new Option(label,id)));if(entries.some(e=>e[0]===old))select.value=old;select.dataset.signature=signature;}};
        refresh('support-unit',units.map(u=>[unitKey(u.unit),`${u.role==='engineer'?'工兵车':'补给车'} #${u.unit.unit}`]));
        refresh('support-target',targets.map(t=>[t.facility_id,facilityLabel(t)]));
        const unit=units.find(u=>unitKey(u.unit)===el('support-unit').value),target=targets.find(t=>t.facility_id===el('support-target').value),job=f.facilityJobs.find(j=>j.job_id===unit?.support_task?.job_id);
        el('support-repair').disabled=!unit||unit.role!=='engineer'||!target||target.damage_state==='intact';
        el('support-supply').disabled=!unit||unit.role!=='supply'||!target||target.supplied!==false||target.damage_state==='destroyed';
        el('support-status').textContent=unit?`${frontlineSupportStatus(unit.support_task,job)}。支援车沿可通行路线前往，停车到场后才开始作业。`:'支援车等待后方安全位置出发。';
      }
      function requestSupport(kind){
        if(f.room?.battle_mode==='air_frontline'){note('地面 AI 自主进攻与占点');return;}
        const member=mine(),unit=f.units.find(u=>unitKey(u.unit)===el('support-unit').value&&u.alive&&u.team===member?.team),target=f.facilities.find(t=>t.facility_id===el('support-target').value);
        if(!unit||!target||!Number.isSafeInteger(target.revision)||member.observer||(target.team!==null&&target.team!==(member.team==='blue'?0:1))||unit.role!==(kind==='repair'?'engineer':'supply'))return;
        f.supportSeq=Math.max(f.supportSeq,unit.support_order_seq||0)+1;
        send({op:'support_order',unit:unit.unit,kind,facility_id:target.facility_id,expected_revision:target.revision,seq:f.supportSeq});
      }
      function rebuildTerrain(){
        if(['taiwan','taiwan-escort'].includes(f.map?.id)&&typeof createFrontlineTerrainWorker==='function'&&typeof Worker==='function'){
          if(f.terrainWorkerMap!==f.map){f.terrainWorker?.dispose();f.terrainWorker=null;f.terrainWorkerMap=f.map;f.terrainWorkerFailed=false;}
          if(!f.terrainWorker&&!f.terrainWorkerFailed){
            f.terrainWorker=createFrontlineTerrainWorker({f,renderer,Node,build:rebuildTerrainImmediate,grid,height,
              definitions:{m4,mul,translation,scaling,rotX,rotY,rotZ,compose,sub,add,scale,dot,cross,len,norm,transformPoint,transformDir,triangulate,hexToLinear,GeoBuilder,buildFrontlineTerrainGeometry,buildFrontlineWaterGeometry,buildFrontlineBridgeGeometry,createFrontlineWaterCutout,createFrontlineFarTerrainGeometry}});
            if(!f.terrainWorker)f.terrainWorkerFailed=true;
          }
          const aerial=!!controlled()?.aircraft||!!f.aircrafts.find(u=>unitKey(u.unit)===f.follow);
          if(f.terrainWorker?.request({focus:f.map.scenario==='taiwan_landing_escort'?[0,0,0]:f.focus,aerial,facilityReady:f.facilityPresentation.ready}))return;
          if(f.terrainWorker){f.terrainWorker.dispose();f.terrainWorkerFailed=true;}
        }
        rebuildTerrainImmediate();
      }
      function rebuildTerrainImmediate(){
        const compact=f.map.scenario==='taiwan_landing_escort',cx=compact?0:Math.floor(f.focus[0]/750)*750,cz=compact?0:Math.floor(f.focus[2]/750)*750;
        const aerial=!!controlled()?.aircraft||!!f.aircrafts.find(u=>unitKey(u.unit)===f.follow);
        if(f.terrainOrigin?.[0]===cx&&f.terrainOrigin?.[1]===cz&&f.terrainAerial===aerial)return;
        if(f.terrain){f.root.children=f.root.children.filter(n=>n!==f.terrain);for(const node of f.terrain.children)if(node.mesh)renderer.freeMesh(node.mesh);}
        f.terrainOrigin=[cx,cz];f.terrainAerial=aerial;f.terrain=new Node('frontline-terrain');f.root.add(f.terrain);
        const sampledHeights=new Map(),surface=(x,z)=>{const key=`${x},${z}`;if(!sampledHeights.has(key))sampledHeights.set(key,height(x,z));return sampledHeights.get(key);};
        const material={color:hexToLinear('#6e7954'),rough:1,metal:0};
        const radius=compact?Math.ceil(Math.max(...Object.values(f.map.bounds).map(Math.abs))/200)*200+200:aerial?12000:2500,step=compact?100:aerial?200:50; // TF_R84_ESCORT_TERRAIN
        // Registered water polygons have no invented bed elevation. Cut their
        // exact union out of the visual terrain, including raised road earth
        // beneath bridges; native support still comes from its registered deck.
        if(f.waterCutoutMap!==f.map){f.waterCutout=createFrontlineWaterCutout(f.map.terrain.waterAreas||[],height);f.waterCutoutMap=f.map;}
        const detailBounds={minX:cx-radius,maxX:cx+radius,minZ:cz-radius,maxZ:cz+radius};
        const dryTerrain=f.waterCutout.region(detailBounds);
        const beds=f.map.terrain.roadbeds;
        const nearRoad=(x,z,size)=>{if(!beds)return false;const reach=size*Math.SQRT1_2,seen=new Set();for(let ix=Math.floor((x-reach)/beds.cellSize);ix<=Math.floor((x+reach)/beds.cellSize);ix++)for(let iz=Math.floor((z-reach)/beds.cellSize);iz<=Math.floor((z+reach)/beds.cellSize);iz++)for(const index of beds.cells[`${ix},${iz}`]||[]){if(seen.has(index))continue;seen.add(index);const [ax,az,,bx,bz,,halfWidth,blend]=beds.segments[index],dx=bx-ax,dz=bz-az,u=clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz),0,1);if(Math.hypot(x-ax-dx*u,z-az-dz*u)<=reach+halfWidth+blend)return true;}return false;};
        const terrain=buildFrontlineTerrainGeometry({GeoBuilder,roi:{center:[cx,cz],radius},coarseStep:step,fineStep:aerial?25:10,
          needsFine:(x,z,size)=>nearRoad(x+size/2,z+size/2,size),surface,waterCutoutRegion:dryTerrain,material});
        f.terrainStats=terrain.stats;
        // Kind20 shades canonical source grass without legacy height displacement or range cutouts.
        const n=f.terrain.add(new Node('terrain'));n.mesh=renderer.mesh(terrain.data);n.kind=20;
        if(f.farTerrain&&f.farTerrainMap===f.map){
          const far=f.farTerrain.build({detailBounds,detailStep:step,detailSurface:surface});
          const distant=f.terrain.add(new Node('far-source-terrain'));distant.mesh=renderer.mesh(far.data);distant.kind=20;distant.castShadow=false;
          f.farTerrainStats={prepared:f.farTerrain.stats,last:far.stats};
        }
        const r=new GeoBuilder(),roadMaterial={color:hexToLinear('#8d876e'),rough:1,metal:0};
        for(const road of compact?[]:f.map.roads||[]){if(!road.connected||!road.navEnabled)continue;const points=road.points||[];
          for(let i=1;i<points.length;i++){const a=points[i-1],v=points[i];if(Math.hypot((a[0]+v[0])/2-cx,(a[2]+v[2])/2-cz)>radius)continue;const length=Math.hypot(v[0]-a[0],v[2]-a[2]);if(length<.01)continue;const dx=-(v[2]-a[2])/length*(road.halfWidth||3),dz=(v[0]-a[0])/length*(road.halfWidth||3);
            const p=(q,s)=>[q[0]+dx*s,surface(q[0]+dx*s,q[2]+dz*s)+.08,q[2]+dz*s];
            r.quad(IDENTITY,false,p(a,-1),p(v,-1),p(v,1),p(a,1),roadMaterial);
          }
        }
        const rn=f.terrain.add(new Node('source-roads'));rn.mesh=renderer.mesh(r.build());rn.kind=21;rn.castShadow=false;
        const waterMaterial={color:hexToLinear('#4d797a'),rough:.25,metal:.1};
        const water=buildFrontlineWaterGeometry({GeoBuilder,waterAreas:f.map.terrain.waterAreas||[],roi:aerial?null:{center:[cx,cz],radius:radius+500},material:waterMaterial});
        const wn=f.terrain.add(new Node('registered-water-polygons'));wn.mesh=renderer.mesh(water.data);wn.kind=22;wn.castShadow=false;
        if(!f.facilityPresentation.ready){
        const deckMaterial={color:hexToLinear('#77786e'),rough:.85,metal:.05};
        const decks=buildFrontlineBridgeGeometry({GeoBuilder,map:f.map,surface,roi:{center:[cx,cz],radius},material:deckMaterial});
        const dn=f.terrain.add(new Node('authored-physical-bridge-decks'));dn.mesh=renderer.mesh(decks.top);dn.kind=21;dn.polygonOffset=[-1,-1];
        const ds=f.terrain.add(new Node('authored-physical-bridge-shells'));ds.mesh=renderer.mesh(decks.shell);ds.kind=21;
        const strips=new GeoBuilder(),asphalt={color:hexToLinear('#454b4c'),rough:.95,metal:0},paint={color:hexToLinear('#dfdfcc'),rough:1,metal:0};
        for(const field of f.map.airfields||[]){const runway=field.runway;if(!field.enabled||!runway)continue;const [x,z]=runway.center,[fx,fz]=runway.forward,length=runway.lengthMeters,width=runway.widthMeters;
          if(Math.hypot(x-cx,z-cz)>radius+length/2)continue;
          const p=(lat,long,h=.1)=>[x+fz*lat+fx*long,runway.height+h,z-fx*lat+fz*long];
          strips.quad(IDENTITY,false,p(-width/2,-length/2),p(-width/2,length/2),p(width/2,length/2),p(width/2,-length/2),asphalt);
          for(let along=-length/2+70;along<length/2-70;along+=90)strips.quad(IDENTITY,false,p(-.6,along,.12),p(-.6,along+35,.12),p(.6,along+35,.12),p(.6,along,.12),paint);
        }
        const runwayNode=f.terrain.add(new Node('authored-operational-runways'));runwayNode.mesh=renderer.mesh(strips.build());runwayNode.kind=21;runwayNode.castShadow=false;
        }
      }
      function poseModel(item,u,fullDetail){
        // The remote plant reconstructs running gear from accepted native snapshots only.
        // It never advances a local driving simulation or feeds state back to the host.
        const sampleTick=u.sensed?u.sampleTick:f.lastTick;
        if(item.tick!==sampleTick||item.sensed!==!!u.sensed){
          item.sim.applyNet(u.net,item.tick>=0?Math.min(.5,Math.max(0,sampleTick-item.tick)*.05):0);item.tick=sampleTick;item.sensed=!!u.sensed;
          item.model.root.pos=[u.pos[0],0,u.pos[2]];item.model.root.yaw=u.yaw;
          item.model.body.local=item.sim.hullLocal(u.yaw);
        }
        if(fullDetail&&(item.gearTick!==sampleTick||!item.fullDetail)){const t=item.sim.t.travel;item.model.updateRunningGear({lod:1,lifts:item.sim.wheelLifts(),travel:{1:t[1],[-1]:t[-1]},ground:{1:item.sim.groundUnder(1),[-1]:item.sim.groundUnder(-1)},wheels:item.sim.wheelPose(),openBelts:item.sim.runningGearPose()});item.gearTick=sampleTick;}
        for(const [i,t]of item.model.turrets.entries()){t.node.yaw=i===0?u.turret_yaw:0;for(const gun of t.guns)gun.node.pitch=-u.gun_pitch;}
      }
      function releaseGroundDetail(item){
        if(!item.model)return;
        f.root.children=f.root.children.filter(n=>n!==item.model.root);item.model.dispose();
        item.model=item.sim=item.loadout=null;item.tick=item.gearTick=-1;
      }
      function updateModels(){
        const present=new Set(),now=performance.now();
        const cp=Math.cos(f.pitch),eye=[f.focus[0]-Math.sin(f.yaw)*cp*f.distance,f.focus[1]-Math.sin(f.pitch)*f.distance,f.focus[2]-Math.cos(f.yaw)*cp*f.distance],near=renderer.quality==='low'?75:renderer.quality==='medium'?130:220;
        for(const u of f.units){const key=unitKey(u.unit);present.add(key);let item=f.models.get(key);
          if(!item){const bundle=data.vehicles[u.vehicle];if(!bundle){f.error=`缺少载具模型：${u.vehicle}`;continue;}const lod=createFrontlineLod(renderer,bundle);item={bundle,model:null,loadout:null,sim:null,lod,tick:-1,gearTick:-1,fullDetail:false,lastNear:now};f.models.set(key,item);f.root.add(lod.root);}
          const distance=Math.hypot(...u.pos.map((v,i)=>v-eye[i])),threshold=near*(item.fullDetail?1.15:1),fullDetail=same(u.unit,f.control)||key===f.follow||distance<threshold;
          if(fullDetail){
            item.lastNear=now;
            if(!item.model){const loadout=frontlineSupportLoadout(makeLoadout(u.vehicle,item.bundle,data.projectiles,data.machineGuns),u),model=buildTank(renderer,loadout,generatedTurretParts),sim=new VehicleSim(item.bundle,model,{height},'historical');sim.remote=true;Object.assign(item,{model,loadout,sim,tick:-1,gearTick:-1});f.root.add(model.root);}
            poseModel(item,u,true);item.model.root.visible=true;
          }else if(item.model){item.model.root.visible=false;if(distance>near*2&&now-item.lastNear>5000)releaseGroundDetail(item);}
          item.lod.root.visible=!fullDetail;item.lod.turret.visible=!u.role||u.role==='combat';item.lod.pose(u);item.lodTick=u.sensed?u.sampleTick:f.lastTick;item.fullDetail=fullDetail;
        }
        for(const[key,item]of f.models)if(!present.has(key)){releaseGroundDetail(item);f.root.children=f.root.children.filter(n=>n!==item.lod.root);item.lod.dispose();f.models.delete(key);}
      }
      function updateAircraftModels(dt){
        const present=new Set();
        for(const u of f.aircrafts){const key=unitKey(u.unit);present.add(key);let item=f.airModels.get(key);
          if(!item){item=createFrontlineAircraftVisual(renderer,u.aircraft,{interpolate:true,
            createFlightCore:()=>loadFlightCore(createFrontlineFlightWorld(f,height)),flightError:error=>note(`本机飞行启动失败：${error.message}`),
            mountAcceptedStores:(plane,aircraftId,stores)=>mountFrontlineAcceptedStores({renderer,plane,aircraftId,stores,storeMesh,sourceStoreMesh,storeDefs:AIR_STORE_DEFS}),mountPublicStores:(plane,aircraftId,stores)=>mountFrontlinePublicStores({renderer,plane,aircraftId,stores,storeMesh,sourceStoreMesh})});f.airModels.set(key,item);f.root.add(item.root);if(same(u.unit,f.control)){f.focus=[u.pos[0],u.pos[1]+2,u.pos[2]];f.yaw=u.yaw;}}
          item.accept(u,u.sensed?u.sampleTick:f.lastTick);item.setControlled(u.alive&&same(u.unit,f.control));
        }
        for(const [key,item] of f.airModels)if(!present.has(key)){f.root.children=f.root.children.filter(n=>n!==item.root);item.dispose();f.airModels.delete(key);}
        f.establishedFlight.sync();
      }
      function drawAirwarAirportTags(camera,w,h){
        const tags=[];for(const field of f.map?.airfields||[]){if(!field.enabled||!field.runway)continue;const p=field.pos,pr=project(camera.viewProj,[p[0],p[1]+12,p[2]]);if(pr[2]<=0||Math.abs(pr[0])>.98||Math.abs(pr[1])>.95)continue;const d=Math.hypot(p[0]-camera.pos[0],p[1]-camera.pos[1],p[2]-camera.pos[2]);tags.push({x:(pr[0]*.5+.5)*w,y:(1-(pr[1]*.5+.5))*h,text:'✈ '+(field.name||field.id)+' · '+(d/1000).toFixed(1)+' km'});}hud.drawLabels(tags);
      }
      function syncAirwarSpectator(){
        const choice=frontlineAirwarSpectator({member:mine(),current:controlled(),aircrafts:f.aircrafts,vessels:f.vessels,airfields:f.map?.airfields,previous:f.follow});
        const previous=f.spectator;f.spectator=choice;
        if(!choice)return;f.lossPending=false;
        if(!previous){f.establishedFlight.release();clearInput();deploy.close();f.deploymentVisible=false;renderer.setMap(null);renderer.zones=[];setMode('battle');f.pitch=-.18;f.distance=45;}
        if(previous?.key!==choice.key){f.follow=choice.kind==='aircraft'||choice.kind==='vessel'?choice.key:null;f.audioCamera=null;if(choice.target){const p=choice.target.pos;f.focus=[p[0],p[1]+(choice.kind==='base'?30:3),p[2]];f.yaw=choice.target.yaw||0;}if(choice.kind==='vessel')f.distance=180;if(choice.kind==='base')f.distance=350;}
      }
      function refreshUi(){
        const member=mine(),company=owned(),current=controlled(),round=frontlineRoundPresentation(f.room);document.body.dataset.frontlineWatch=f.active&&!current&&!f.deploymentVisible?'1':'0';
        ui.querySelector('.fl-setup').hidden=true;ui.hidden=true;
        const scores=f.room?.team_score;el('room').textContent=f.room?`房间 ${f.room.id} · ${f.room.era} · ${round.text} · ${Array.isArray(scores)?`蓝 ${scores[0]} / 红 ${scores[1]} · 目标 ${f.room.score_limit}`:'分数待服务器同步'}`:'';
        el('start').disabled=!f.room||f.room.host!==net.id||round.state!=='waiting';
        for(const selector of ['.fl-ground-controls','.fl-command','[data-fl=support-panel]','[data-fl=ground-deployment-note]','[data-fl=takeover]']){const target=ui.querySelector(selector);if(target){target.hidden=true;target.inert=true;}}
        el('deploy-air').disabled=!f.room?.started||!!member?.observer||!!current||!f.aircraftOptions.length;
        el('return').disabled=!current||!f.room?.started;el('takeover').disabled=!company||!!current||!f.room?.started;
        ui.querySelector('.fl-command').hidden=true;
        const vehicleSignature=f.vehicles.map(v=>v.id).join('|');
        if(el('vehicle').dataset.signature!==vehicleSignature){const chosen=el('vehicle').value;el('vehicle').replaceChildren(...f.vehicles.map(v=>new Option(v.name,v.id)));el('vehicle').value=f.vehicles.some(v=>v.id===chosen)?chosen:f.vehicles.find(v=>v.id==='su_t72a')?.id||f.vehicles[0]?.id||'';el('vehicle').dataset.signature=vehicleSignature;}
        const airSignature=f.aircraftOptions.map(v=>v.id).join('|');
        if(el('aircraft').dataset.signature!==airSignature){const chosen=el('aircraft').value;el('aircraft').replaceChildren(...f.aircraftOptions.map(v=>new Option(`${v.name} (${v.year})`,v.id)));el('aircraft').value=f.aircraftOptions.some(v=>v.id===chosen)?chosen:f.aircraftOptions[0]?.id||'';el('aircraft').dataset.signature=airSignature;}
        const chosenType=current?.aircraft||G4.airGarage?.sel;if(chosenType&&f.aircraftOptions.some(a=>a.id===chosenType))el('aircraft').value=chosenType;
        const airOption=f.aircraftOptions.find(v=>v.id===el('aircraft').value),loadouts=f.sharedLobby?.loadouts(airOption?.id)||airOption?.loadouts||[],loadoutSignature=`${airOption?.id}:`+loadouts.map(lo=>`${lo.index}:${lo.name}`).join('|');
        if(el('air-loadout').dataset.signature!==loadoutSignature){const selected=el('air-loadout').value;el('air-loadout').replaceChildren(...loadouts.map(lo=>Object.assign(new Option(lo.name,String(lo.index)),{disabled:lo.online===false,title:lo.why||''})));const preferred=String(G4.airLoadout?.[airOption?.id]??selected);el('air-loadout').value=loadouts.some(lo=>String(lo.index)===preferred)?preferred:String(loadouts[0]?.index??0);el('air-loadout').dataset.signature=loadoutSignature;}
        const fuelHtml=airOption&&typeof aircraftFuelLoad!=='undefined'?aircraftFuelLoad.htmlFor(airOption.id):'';if(el('air-fuel-choice').innerHTML!==fuelHtml)el('air-fuel-choice').innerHTML=fuelHtml;
        const retained=f.aircrafts.find(u=>u.owner===net.id&&u.alive),requestedLoadout=G4.airLoadout?.[airOption?.id]??Number(el('air-loadout').value);el('air-loadout').value=String(requestedLoadout);
        el('air-deployment-note').textContent=retained?`原机 #${retained.unit.unit} 的损伤、油弹和现有挂载继续保留。${retained.aircraft!==el('aircraft').value?'原机仍在场，不能借重新出击更换机型。':requestedLoadout!==retained.loadout?'接管时保留原挂载；所选新挂载须在机场完成15秒整备后更换。':'接管原机不会补充油弹；补给请使用机场整备。'}`:'';
        el('deploy-air').textContent=retained?'接管原机':'飞机出击';
        if(retained&&retained.aircraft!==el('aircraft').value)el('deploy-air').disabled=true;
        const selected=f.follow||el('follow').value,allowed=allUnits().filter(u=>member?.observer||(u.aircraft?u.owner===net.id:!!company&&u.company===company.id));
        const signature=allowed.map(u=>`${unitKey(u.unit)}:${u.alive}`).join('|');
        if(el('follow').dataset.signature!==signature){el('follow').replaceChildren(new Option('自由镜头',''),...allowed.map(u=>new Option(`${u.team==='blue'?'蓝':'红'} ${u.aircraft||u.vehicle} #${u.unit.unit}${u.alive?'':' 已损失'}`,unitKey(u.unit))));el('follow').value=selected;el('follow').dataset.signature=signature;}
        const format=(n,d=0)=>Number.isFinite(n)?n.toFixed(d):'—',flying=!!current?.aircraft;
        const pilot=flying?controlledAirModel()?.plane:null,service=flying?frontlineAirServicePresentation(current,f.map,{throttle:pilot?.state.throttle,axes:pilot?pilot._inputs():[],fire:f.fire||f.keys.has('fire'),release:f.keys.has('Space'),sequencedGear:!!AIRCRAFT_TYPES[current.aircraft]?.fighter?.spec.gearSequence}):null;
        el('air-service-panel').hidden=!flying;
        const sameAircraft=flying&&el('aircraft').value===current.aircraft;
        el('service-air').disabled=!service?.eligible||service.status==='servicing'||!sameAircraft;
        el('service-air').textContent=flying&&requestedLoadout!==current.loadout?'整备并更换挂载（15秒）':'开始15秒整备';
        el('cancel-air-service').disabled=service?.status!=='servicing';
        el('air-service-status').textContent=service?service.text+(!sameAircraft?'\n请在机型列表选择当前飞机，再选择整备挂载。':'')+(f.lastServiceRejection?`\n上次申请未获准：${frontlineAirServiceReason(f.lastServiceRejection.reason)}`:''):'';
        const aircraftModel=flying?controlledAirModel():null;
        const aircraftInventory=aircraftModel?frontlineAircraftHud(current,aircraftModel,airHudInventory,()=>aircraftGuns(current.aircraft),AIR_STORE_DEFS).text:'';
        const playerScore=(f.room?.scoreboard||[]).find(row=>row.player===net.id),companyText=playerScore?`\n个人 ${playerScore.score} 分 · 击落 ${playerScore.air_kills} / 对地 ${playerScore.ground_kills} · 损失 ${playerScore.deaths}`:'';
        el('inventory').textContent=flying?aircraftInventory+companyText:current?`驾驶 #${current.unit.unit}　主炮弹药 ${current.ammo}\n${current.alive?'状态：'+(current.caps?.can_move===false?'失去机动':'作战中'):'载具已损失'}${companyText}`:`${member?.observer?'AI 观战 · 自由镜头 / 跟随单位':'在共用出击界面选择飞机与挂载'}\n地面 ${f.units.length}　飞机 ${f.aircrafts.length}　服务器帧 ${f.lastTick}`;
        flightReadout.hidden=true;
        airwarOverlay.hidden=!f.active||G4.mode!=='battle'||!!f.deploymentVisible;airwarText.textContent=[f.spectator?.label,frontlineAirwarMissionText(f.scenario,member?.team)].filter(Boolean).join(' · ');if(!airwarText.textContent)airwarOverlay.hidden=true;spectatorNext.hidden=!f.spectator||!f.aircrafts.some(u=>u.alive&&u.team===member?.team);
        ui.querySelector('.fl-air-touch').hidden=!flying;
        el('help').textContent=flying?'飞行：W 俯冲 / S 拉起，A/D 滚转，Q/E 方向舵，Shift/Ctrl 调油门；G 起落架、F 襟翼、B 减速板、I 教官、L 平飞、V 座舱；右键拖动鼠标瞄准，左键机炮，空格投放。地面 AI 自主进攻与占领 A/B/C；Tab 返回出击界面。':'玩家只驾驶飞机；地面 AI 自主进攻与占点。观战：WASD 移动、Q/E 升降；滚轮缩放。Tab 打开共用出击界面。';
        for(const button of ui.querySelectorAll('.fl-touch [data-held]')){const labels=flying?{KeyW:'俯冲',KeyS:'拉起',KeyA:'左滚',KeyD:'右滚',Space:'投放'}:{KeyW:'前进',KeyS:'后退',KeyA:'左转',KeyD:'右转',Space:'制动'};if(labels[button.dataset.held])button.textContent=labels[button.dataset.held];}
      }
      function applyControl(unit,epoch){
        const member=mine();
        if(!f.room||!member||epoch<Math.max(f.epoch||0,member.epoch||0)||(unit&&f.room.battle!=null&&unit.battle!==f.room.battle))return;
        const changed=!same(f.control,unit)||f.epoch!==epoch;
        if(changed)f.establishedFlight.release();
        if(changed)f.airModels.get(unitKey(f.control))?.setControlled(false);
        f.control=unit;f.epoch=epoch;if(!unit)f.returnPending=false;if(member){member.controlled=unit;member.epoch=epoch;}
        if(!changed)return;
        f.seq=0;f.keys.clear();f.fire=false;f.inputTime=undefined;f.audioCamera=null;f.lastServiceRejection=null;
        if(unit){f.follow=unitKey(unit);el('follow').value=f.follow;const vehicle=controlled();if(vehicle){f.focus=[vehicle.pos[0],vehicle.pos[1]+2,vehicle.pos[2]];f.yaw=vehicle.yaw;f.distance=20;if(vehicle.aircraft){el('map-range').value='theatre';el('map-follow').checked=false;}}canvas.focus({preventScroll:true});}
        if(unit||owned())note(unit?'已接管当前载具，弹药与损伤沿用原车。':'已解除直接驾驶，连队由 AI 继续执行任务。');
      }
      async function receive(message){
        if(message.version!==1){note('前线版本不同，请更新游戏');return;}const m=message.message;
        if(m.op==='left'){f.ordnancePresentation.clear();f.gunTracerPresentation.clear();f.missiles=[];}
        if(m.op==='error'){
          if(m.code==='air_pose_rejected')controlledAirModel()?.rejectLocalPose?.();
          if(m.code==='weapon_control_rejected')f.establishedFlight.rejectWeaponControl(m.message);
          if(m.code==='seeker_control_rejected')f.establishedFlight.rejectSeekerControl(m.message);
          if(f.airDeploymentPending||m.code==='air_sortie_spent')f.lastDeploymentError=m.message;
          f.airDeploymentPending=false;f.shared?.notify();
          const feedback=m.code==='service_rejected'?frontlineAirServiceReason(m.message):m.code==='not_at_deployment'?'请先在己方可用跑道停稳，再按 Tab 返回机库；现在仍可继续驾驶。':m.code==='seeker_control_rejected'?nativeGroundGuidanceReason(m.message,typeof L10N==='function'?L10N:undefined):m.message;
          if(m.code==='service_rejected'){f.lastServiceRejection={unit:f.control,reason:m.message};refreshUi();}
          note(feedback);if(G4.mode==='garage'&&!G4.air?.nativeAuthority)hud.toast(feedback,3);return;
        }
        if(m.op==='rooms'){
          f.rooms=m.rooms.filter(room=>room.battle_mode==='air_frontline');f.shared?.notify();el('rooms').replaceChildren(...f.rooms.map(room=>{const row=document.createElement('div'),join=document.createElement('button'),watch=document.createElement('button');row.textContent=`#${room.id} ${room.name}　`;join.textContent='参战';watch.textContent='观战';join.onclick=()=>send({op:'join',room:room.id,observer:false});watch.onclick=()=>send({op:'join',room:room.id,observer:true});row.append(join,watch);return row;}));return;
        }
        if(m.op==='left'){f.navalPresentation.clear();f.airportPresentation.clear();f.vessels=[];f.navalCatalog=[];f.scenario=null;f.spectator=null;f.lossPending=false;airwarOverlay.hidden=true;f.establishedFlight.release(true);renderGate.clear();f.renderStats.drawDt=0;f.active=false;f.room=null;f.control=null;f.epoch=0;f.seq=0;f.orderSeq=0;f.supportSeq=0;f.inputTime=undefined;f.fire=false;f.units=[];f.aircrafts=[];f.companies=[];f.staging=[];f.facilities=[];f.facilityJobs=[];f.facilityIdentity=null;f.facilityPresentation.dispose();f.follow=null;f.order=null;for(const item of f.models.values()){releaseGroundDetail(item);item.lod.dispose();}for(const item of f.airModels.values())item.dispose();f.models.clear();f.airModels.clear();f.root.children=f.terrain?[f.terrain,f.facilityPresentation.root]:[f.facilityPresentation.root];for(const n of [f.navalPresentation.root,f.airportPresentation.root])f.root.add(n);net.frontlineRoom=null;reticle.hidden=flightReadout.hidden=true;f.keys.clear();setMode('garage');note('已退出空战对局');refreshUi();f.airDeploymentPending=false;f.shared?.notify();return;}
        if(m.op==='room'||m.op==='snapshot'){
          if(f.room&&(m.room.id!==f.room.id||m.room.battle<f.room.battle))return;
          if(!f.room||m.room.battle!==f.room.battle)resetBattlePresentation();
          if(m.room.battle_mode!=='air_frontline')throw Error('服务端空战版本未更新，不能进入旧混合模式');
          f.room=m.room;f.staging=m.room.staging||[];net.frontlineRoom={...m.room,playing:m.room.started};
          if(m.op==='room'){const member=mine();if(member)applyControl(member.controlled,member.epoch);}
          if(f.autoStart&&!m.room.started&&m.room.host===net.id&&frontlineRoundPresentation(m.room).state==='waiting'){f.autoStart=false;send({op:'start'});}
        }
        if(m.op==='snapshot'||m.op==='frame'){
          if(m.op==='frame'&&m.battle!==f.room?.battle)return;
          if(Array.isArray(m.vessels))f.vessels=m.vessels;if(Array.isArray(m.naval_geometry_catalog))f.navalCatalog=m.naval_geometry_catalog;if(Object.hasOwn(m,'scenario'))f.scenario=m.scenario;
          f.navalPresentation.accept(f.navalCatalog,f.vessels,{battle:m.battle??f.room?.battle,tick:m.tick??f.lastTick});
          f.missiles=Array.isArray(m.missiles)?m.missiles:[];
          f.ordnancePresentation.accept(f.missiles,{battle:m.battle??f.room?.battle,tick:m.tick??f.lastTick});
          f.gunTracerPresentation.accept(Array.isArray(m.tracers)?m.tracers:[],{battle:m.battle??f.room?.battle,tick:m.tick??f.lastTick});
          if(Array.isArray(m.staging))f.staging=m.staging;
          if(Array.isArray(m.facilities))f.facilities=m.facilities;
          if(Array.isArray(m.facility_jobs))f.facilityJobs=m.facility_jobs;
          if(m.intel){
            f.contactPresentation||=createFrontlineContactPresentation();
            const presentation=f.contactPresentation.accept({intel:m.intel,units:m.units,aircrafts:m.aircrafts||[],battle:m.battle??f.room?.battle});
            f.units=presentation.units;f.aircrafts=presentation.aircrafts;f.contacts=presentation.contacts;
          }else{
            if(f.room?.intelligence_version===1&&!mine()?.observer)throw Error('缺少服务器团队感知数据');
            f.units=m.units;f.aircrafts=m.aircrafts||[];f.contacts=[];
          }
          f.companies=m.companies;f.objectives=m.objectives;f.lastTick=m.tick||f.lastTick;
          if(m.aircraft_options)f.aircraftOptions=m.aircraft_options;
          if(m.vehicles)f.vehicles=m.vehicles;if(m.readiness)f.room.readiness=m.readiness;if(m.team_score)f.room.team_score=m.team_score;if(m.scoreboard)f.room.scoreboard=m.scoreboard;if(m.score_limit!=null)f.room.score_limit=m.score_limit;
          if(m.events){frontlineAcceptScoreEvents(f.room,m.events);f.events.push(...m.events);if(f.events.length>200)f.events.splice(0,f.events.length-200);for(const event of m.events){
            if(event.kind==='shot'){const velocity=event.detail?.velocity||[0,0,1],length=Math.hypot(...velocity)||1,dir=velocity.map(v=>v/length),shell=data.projectiles[event.detail?.projectile_id],caliber=event.detail?.caliber_mm||shell?.caliber_mm;
              if(event.detail?.airborne){if(!event.detail.store&&Number.isFinite(caliber)){fx.mgFlash(event.pos,dir,caliber);const shooter=f.aircrafts.find(u=>same(u.unit,event.shooter)),gun=shooter&&aircraftGuns(shooter.aircraft).find(g=>g.id===event.detail.weapon_instance);if(!gun||!airShot(gun.sound,event.detail.shot_id,event.pos,velocity,G4.time)){const cue={position:event.pos,direction:dir,emitterId:`frontline:${unitKey(event.shooter)}`,eventId:event.detail.shot_id,time:G4.time};if(caliber<15)sound.mg(caliber,cue);else sound.shot(caliber,{...cue,weaponId:'air_cannon',generic:true});}}}
              else{fx.muzzleBlast(event.pos,dir,caliber||100,null,event.pos[1]-1);sound.shot(caliber||100,{position:event.pos,direction:dir,eventId:`frontline:${m.battle}:${event.detail?.shot_id}`,time:G4.time});}}
            else if(event.kind==='impact'||event.kind==='terrain_impact'||event.kind==='facility_impact'||event.kind==='missile_proximity'){
              const presentation=frontlineImpactPresentation(event);if(event.kind!=='missile_proximity')fx.armorImpact(event.pos,true);
              for(const burst of presentation.bursts)fx.explosion(burst.position,null,burst.strength,event.kind==='terrain_impact');
            }
            else if(event.kind==='destroyed')fx.explosion(event.pos,null,8,true);
          }}
          const admittedBattle=f.room?.battle,admittedRoom=f.room?.id;await ensureMap();
          if(f.room?.battle!==admittedBattle||f.room?.id!==admittedRoom)return;
          if(m.op==='snapshot'&&f.room.facility_layout_version===1){
            const identity=`${admittedBattle}:${f.room.map}:${f.room.facility_layout_hash}`;
            if(f.facilityIdentity!==identity){
              f.facilityIdentity=identity;f.facilityPresentation.dispose();
              const installed=await f.facilityPresentation.install(m.facility_geometry_catalog,{battle:admittedBattle,mapId:f.room.map,layoutHash:f.room.facility_layout_hash});
              if(!installed||f.facilityIdentity!==identity||f.room?.battle!==admittedBattle)return;
              f.facilityCatalog=m.facility_geometry_catalog;f.terrainOrigin=null;
            }
          }
          if(f.room?.started&&!f.active){f.active=true;G4.keys.clear();G4.fireHeld=G4.mgHeld=false;hud.loading(null);el('map-range').value='theatre';el('map-follow').checked=false;if(mine()?.observer&&(f.units.length||f.vessels.length)){renderer.setMap(null);renderer.zones=[];setMode('battle');const unit=f.vessels[0]||f.units[0];f.follow=unitKey(unit.unit);f.focus=[unit.pos[0],unit.pos[1]+2,unit.pos[2]];f.yaw=unit.yaw;}note(mine()?.observer?'正在观看两队 AI 交战。':'在原机库选择飞机和挂载并起飞。');}
          const member=mine();if(member&&m.op==='snapshot')applyControl(member.controlled,member.epoch);
          // Accepted flight buffers, part pose and control ownership follow the
          // network admission, even when the next drawing frame is delayed.
          updateAircraftModels(0);syncAirwarSpectator();
          if(controlled()?.service?.status==='servicing'||controlled()?.service?.status==='complete')f.lastServiceRejection=null;
        }
        if(m.op==='air_pose_accepted'){f.airModels.get(unitKey(m.unit))?.ackLocalPose?.(m);return;}
        if(m.op==='control'){if(m.reason==='controlled_loss')f.lossPending=true;f.airDeploymentPending=false;f.lastDeploymentError=null;applyControl(m.unit,m.epoch);if(f.map)updateAircraftModels(0);}
        if(m.op==='order_accepted')note('服务器已接受连队命令。');
        if(m.op==='support_order_accepted')note('支援任务已接受，车辆将沿可通行路线前往。');
        if(m.op==='ended'&&m.battle===f.room?.battle){
          f.establishedFlight.release();
          f.room.started=false;f.room.round_state='intermission';f.room.result={battle:m.battle,winner:m.winner,reason:m.reason};f.keys.clear();f.fire=false;f.mouse=null;
          f.airModels.get(unitKey(f.control))?.setControlled(false);f.control=null;
          f.establishedFlight.garage({aircraftId:airGarage.sel,map:sharedApi.deploymentMap(),availability:{allowed:false,reason:frontlineRoundPresentation(f.room).text}});
          note(frontlineRoundPresentation(f.room).text);
        }
        refreshUi();f.shared?.notify();
      }
      net.on('frontline',m=>receive(m).catch(error=>{f.error=String(error);note(f.error);console.error('frontline client',error);}));
      net.on('closed',()=>{if(f.active)note('连接已中断，等待重新连接；连队仍在服务器运行。');});
      el('close').onclick=()=>{f.panelCollapsed=true;ui.hidden=true;};
      el('server').onchange=()=>{if(!f.room)ensureMapOptions(normalizeServer(el('server').value)).catch(error=>note(error.message));};
      el('create').disabled=el('observe').disabled=true;
      async function begin(observer){try{await connect();f.autoStart=true;send({op:'create',name:`${el('name').value}的前线`,map:el('map').value,observer,era:Number(el('era').value)});note('正在创建对局…');}catch(error){note(error.message);}}
      el('list').onclick=async()=>{try{await connect();await ensureMapOptions(net.url,true);send({op:'list'});}catch(error){note(error.message);}};
      el('start').onclick=()=>f.shared.start();el('deploy').onclick=()=>note('纯空战只允许玩家驾驶飞机');
      el('ground-staging').onchange=()=>{const view=refreshGroundDeployment(),source=view.sources.find(s=>s.id===view.selected);if(source){f.mapCentre=[source.pos[0],source.pos[2]];if(!controlled()){f.follow=null;f.focus=[source.pos[0],source.pos[1]+3,source.pos[2]];f.audioCamera=null;}}};
      el('aircraft').onchange=refreshUi;
      el('deploy-air').disabled=true; // The existing DeployScreen owns deployments.
      function requestAirService(cancel=false){
        const current=controlled();if(!current?.aircraft)return;
        if(!cancel&&el('aircraft').value!==current.aircraft){note('请先选择当前飞机的整备挂载。');return;}
        f.lastServiceRejection=null;
        const index=G4.airLoadout?.[current.aircraft]??Number(el('air-loadout').value),source=airLoadouts(current.aircraft)[index];
        try{f.shared.serviceAir({cancel,...(/自[訂订]|custom/i.test(source?.[0]||'')?{custom:{...(G4.airCustom[current.aircraft]||{})}}:{loadout:index})});}catch(error){note(error.message);}
      }
      el('service-air').onclick=()=>requestAirService();el('cancel-air-service').onclick=()=>requestAirService(true);
      el('support-repair').disabled=el('support-supply').disabled=true;
      el('support-unit').onchange=el('support-target').onchange=refreshSupportUi;
      el('return').onclick=()=>f.shared.returnToDeployment();el('leave').onclick=()=>f.shared.leave();
      el('follow').onchange=()=>{f.follow=el('follow').value||null;f.audioCamera=null;syncAirwarSpectator();};
      el('takeover').disabled=true;
      ui.querySelectorAll('[data-order]').forEach(button=>{button.disabled=true;});
      ui.querySelectorAll('[data-air-toggle]').forEach(button=>button.onclick=()=>{controlledAirModel()?.plane.toggle(button.dataset.airToggle);transmitInput();});
      const mapCv=hud.map,mapG=hud.mapCtx;
      mapCv.onpointerdown=e=>{if(!f.mapCentre)return;const r=mapCv.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*mapCv.width,z=(e.clientY-r.top)/r.height*mapCv.height,target=[f.mapCentre[0]+(x-mapCv.width/2)*f.mapScale,f.mapCentre[1]+(z-mapCv.height/2)*f.mapScale];
        const company=owned();if(f.order&&company){const p=el('platoon').value;send({op:'order',company:company.id,platoons:p==='all'?[0,1,2]:[Number(p)],kind:f.order,target,seq:++f.orderSeq});f.order=null;ui.querySelectorAll('[data-order]').forEach(b=>b.classList.remove('active'));}else{f.follow=null;f.focus=[target[0],height(...target)+30,target[1]];f.audioCamera=null;}
      };
      function drawMap(){
        if(!f.mapCentre)return;const g=mapG,w=mapCv.width,h=mapCv.height,theatre=el('map-range').value==='theatre'?frontlineTheatreMapView(f.map.terrain,w,h):null;
        const local=frontlineAirwarMapView(f.focus,w,h);
        if(f.room?.battle_mode==='air_frontline'){f.mapScale=local.scale;f.mapCentre=local.centre;}else if(theatre){f.mapScale=theatre.scale;f.mapCentre=theatre.centre;}else{f.mapScale=Number(el('map-range').value)||14;if(el('map-follow').checked&&f.focus)f.mapCentre=[f.focus[0],f.focus[2]];}
        const point=p=>[(p[0]-f.mapCentre[0])/f.mapScale+w/2,(p[2]-f.mapCentre[1])/f.mapScale+h/2];
        if(f.mapBackgroundMap!==f.map){f.mapBackground=createFrontlineMapBackground(f.map);f.mapBackgroundMap=f.map;}
        f.mapBackground.draw(g,{width:w,height:h,centre:f.mapCentre,scale:f.mapScale});
        g.strokeStyle='#607461';g.lineWidth=2;for(const road of f.scenario?[]:f.map.roads||[]){if(!road.connected)continue;g.beginPath();road.points.forEach((p,i)=>{const q=point(p);i?g.lineTo(...q):g.moveTo(...q);});g.stroke();}
        for(const o of f.scenario?[]:f.objectives){const member=mine(),view=frontlineObjectivePresentation(o,member?.observer?null:member?.team),q=point(o.pos),radius=Math.max(5,o.radius/f.mapScale),ownerColor=o.owner==='blue'?'#71b9ff':o.owner==='red'?'#ff9984':'#e7c36d';g.strokeStyle=view.contested?'#f4da84':ownerColor;g.setLineDash(view.locked?[3,3]:[]);g.beginPath();g.arc(...q,radius,0,Math.PI*2);g.stroke();g.setLineDash([]);if(view.progress!==0){g.strokeStyle=view.progress>0?'#71b9ff':'#ff9984';g.beginPath();g.arc(...q,radius+3,-Math.PI/2,-Math.PI/2+Math.abs(view.progress)*Math.PI*2);g.stroke();}g.fillStyle=view.contested?'#f4da84':ownerColor;g.font='11px sans-serif';g.fillText(view.label,q[0]+8,q[1]-8);}
        for(const source of f.scenario?[]:f.staging||[]){if(!mine()?.observer&&source.team!==mine()?.team)continue;const q=point(source.pos),selected=source.id===el('ground-staging').value;g.strokeStyle=source.available?(source.team==='blue'?'#76bdff':'#ff9984'):'#78888a';g.setLineDash(source.available?[]:[3,3]);g.strokeRect(q[0]-5,q[1]-5,10,10);if(selected)g.strokeRect(q[0]-8,q[1]-8,16,16);g.setLineDash([]);g.fillStyle=g.strokeStyle;g.fillText(`${frontlineFrontLabel(source.front)}部署${source.available?'':' · 暂停'}`,q[0]+9,q[1]+4);}
        for(const u of f.units){if(!frontlineAirwarNearby(u.pos,local))continue;const q=point(u.pos);g.fillStyle=!u.alive?'#747775':u.team==='blue'?'#76bdff':'#ff9984';g.fillRect(q[0]-2,q[1]-2,4,4);if(u.alive&&u.role&&u.role!=='combat'){g.font='10px sans-serif';g.fillText(u.role==='engineer'?'工':'补',q[0]+4,q[1]+3);}if(same(u.unit,f.control)){g.strokeStyle='#fff';g.strokeRect(q[0]-5,q[1]-5,10,10);}}
        for(const facility of f.facilities){if(facility.damage_state==='intact')continue;const geometry=f.facilityCatalog?.find(v=>v.facility_id===facility.facility_id);if(!geometry)continue;const [a,b]=geometry.bounds,q=point([(a[0]+b[0])/2,0,(a[2]+b[2])/2]);g.strokeStyle=facility.damage_state==='destroyed'?'#ffab78':'#ead078';g.beginPath();g.moveTo(q[0]-4,q[1]-4);g.lineTo(q[0]+4,q[1]+4);g.moveTo(q[0]+4,q[1]-4);g.lineTo(q[0]-4,q[1]+4);g.stroke();}
        for(const contact of f.contacts||[])if(contact.status==='last_known'&&frontlineAirwarNearby(contact.pos,local)){
          const q=point(contact.pos),age=Math.max(0,(f.lastTick-contact.last_seen_tick)*.05);g.save();g.globalAlpha=.6;g.strokeStyle=contact.team==='blue'?'#76bdff':'#ff9984';g.setLineDash([3,3]);g.beginPath();g.arc(...q,5,0,Math.PI*2);g.stroke();g.setLineDash([]);g.fillStyle=g.strokeStyle;g.fillText(`最后位置 ${Math.floor(age)}秒`,q[0]+8,q[1]+10);g.restore();
        }
        for(const field of f.map.airfields||[]){if(!field.enabled||!field.runway||!frontlineAirwarNearby(field.pos,local))continue;const runway=field.runway,[x,z]=runway.center,[fx,fz]=runway.forward,a=point([x-fx*runway.lengthMeters/2,0,z-fz*runway.lengthMeters/2]),b=point([x+fx*runway.lengthMeters/2,0,z+fz*runway.lengthMeters/2]);g.strokeStyle=field.team===0?'#76bdff':'#ff9984';g.beginPath();g.moveTo(...a);g.lineTo(...b);g.stroke();const q=point(field.pos);g.strokeRect(q[0]-5,q[1]-5,10,10);}
        /* TF_MINIMAP_AIRPORT_LABELS_R84_DRAW */
        TFMinimapLabelsR84.draw(g,f.map.airfields||[],{width:w,height:h,point,nearby:p=>frontlineAirwarNearby(p,local),scale:f.mapScale});
        for(const ship of f.vessels||[]){if(!frontlineAirwarNearby(ship.pos,local))continue;const q=point(ship.pos);g.fillStyle=!ship.alive?'#747775':ship.team===0?'#76bdff':'#ff9984';g.fillRect(q[0]-3,q[1]-5,6,10);if(ship.role==='transport'){g.font='10px system-ui';g.fillText('登陆舰',q[0]+7,q[1]+8);}}
        for(const u of f.aircrafts){if(!frontlineAirwarNearby(u.pos,local))continue;const q=point(u.pos),heading=u.yaw;g.save();g.translate(...q);g.rotate(-heading);g.strokeStyle=!u.alive?'#747775':u.team==='blue'?'#76bdff':'#ff9984';g.beginPath();g.moveTo(0,7);g.lineTo(-5,-5);g.lineTo(0,-2);g.lineTo(5,-5);g.closePath();g.stroke();if(same(u.unit,f.control))g.strokeRect(-8,-8,16,16);g.restore();}
        for(const c of f.companies)if(c.owner===net.id)for(const order of c.orders){const q=point([order.target[0],0,order.target[1]]);g.strokeStyle='#f8d39b';g.beginPath();g.arc(...q,6,0,Math.PI*2);g.stroke();}
        const scaleDistance=f.mapScale>500?100000:f.mapScale>50?10000:1000;
        g.strokeStyle='#c7d6d3';g.beginPath();g.moveTo(15,h-16);g.lineTo(15+scaleDistance/f.mapScale,h-16);g.stroke();g.fillStyle='#c7d6d3';g.font='11px system-ui';g.fillText(`${scaleDistance/1000} km`,15,h-24);g.font='bold 13px system-ui';g.fillText(f.map.name||'台海海峡',12,20);g.font='11px system-ui';g.fillText('附近 10 km',12,36);
      }
      function transmitInput(){
        if(!f.active||!net.open||f.room?.round_state==='intermission')return;const current=controlled();if(!current?.aircraft)return;
        f.establishedFlight.transmit();
      }
      // Input transport has its own heartbeat; slow drawing must not choose control cadence.
      f.inputTimer=setInterval(transmitInput,50);
      function clearInput(){f.keys.clear();f.fire=false;f.mouse=null;f.inputTime=undefined;f.establishedFlight?.clear();}
      // These remaining keys belong only to an observer's free camera. The
      // aircraft uses the completed game's existing keymap and pointer lock.
      document.addEventListener('keydown',e=>{if(!f.active||G4.mode!=='battle'||G4.air?.nativeAuthority||f.deploymentVisible||document.getElementById?.('air-arm')?.hidden===false||['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if(e.code==='Tab'){f.sharedLobby?.openDeployment();}else f.keys.add(e.code);e.preventDefault();e.stopImmediatePropagation();},true);
      document.addEventListener('keyup',e=>{if(!f.active||G4.mode!=='battle'||G4.air?.nativeAuthority)return;f.keys.delete(e.code);e.preventDefault();e.stopImmediatePropagation();},true);
      window.addEventListener('blur',clearInput);document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInput();});
      canvas.addEventListener('contextmenu',e=>{if(f.active)e.preventDefault();},true);
      canvas.addEventListener('pointerdown',e=>{if(!f.active||G4.mode!=='battle'||G4.air?.nativeAuthority)return;e.preventDefault();e.stopImmediatePropagation();canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);if(e.button===2||e.pointerType==='touch')f.mouse={x:e.clientX,y:e.clientY};},true);
      canvas.addEventListener('pointermove',e=>{if(!f.active||G4.mode!=='battle'||G4.air?.nativeAuthority||!f.mouse)return;const dx=e.clientX-f.mouse.x,dy=e.clientY-f.mouse.y;f.yaw-=dx*.004;f.pitch=clamp(f.pitch-dy*.003,-1.3,.4);f.mouse={x:e.clientX,y:e.clientY};e.preventDefault();e.stopImmediatePropagation();},true);
      canvas.addEventListener('pointerup',e=>{if(!f.active||G4.mode!=='battle'||G4.air?.nativeAuthority)return;f.mouse=null;e.preventDefault();e.stopImmediatePropagation();},true);
      canvas.addEventListener('pointercancel',clearInput,true);
      canvas.addEventListener('wheel',e=>{if(!f.active||G4.mode!=='battle'||G4.air?.nativeAuthority)return;f.distance=clamp(f.distance*Math.exp(e.deltaY*.001),8,1600);e.preventDefault();e.stopImmediatePropagation();},{capture:true,passive:false});
      ui.querySelectorAll('[data-held]').forEach(button=>{button.onpointerdown=e=>{button.setPointerCapture(e.pointerId);f.keys.add(button.dataset.held);transmitInput();e.preventDefault();};button.onpointerup=button.onpointercancel=()=>{f.keys.delete(button.dataset.held);transmitInput();};});
      function frame(dt){
        G4.time+=dt;
        // Shared HUD timers follow the original frame cadence, including frames
        // that yield to a busy GPU. The garage may have hidden this canvas.
        if(f.active&&G4.mode==='battle'){hud.tick(dt);hud.overlay.style.visibility='visible';}
        if(!f.map||!f.focus)return;syncAirwarSpectator();const current=controlled(),target=allUnits().concat(f.vessels||[]).find(u=>unitKey(u.unit)===f.follow);
        f.airportPresentation.install(f.map);if(current?.aircraft)f.establishedFlight.step(dt);
        if(f.room?.facility_layout_version===1&&!f.facilityPresentation.ready)return;
        if(target){const desired=[target.pos[0],target.pos[1]+2,target.pos[2]];f.focus=f.focus.map((v,i)=>v+(desired[i]-v)*(1-Math.exp(-dt*8)));}
        else if(!current){const speed=(f.keys.has('ShiftLeft')?100:25)*dt,forward=(f.keys.has('KeyW')?1:0)-(f.keys.has('KeyS')?1:0),right=(f.keys.has('KeyD')?1:0)-(f.keys.has('KeyA')?1:0);f.focus[0]+=(Math.sin(f.yaw)*forward+Math.cos(f.yaw)*right)*speed;f.focus[2]+=(Math.cos(f.yaw)*forward-Math.sin(f.yaw)*right)*speed;f.focus[1]+=((f.keys.has('KeyE')?1:0)-(f.keys.has('KeyQ')?1:0))*speed;}
        f.renderStats.drawDt+=dt;
        if(!renderGate.ready())return;
        dt=Math.min(1,f.renderStats.drawDt);f.renderStats.drawDt=0;
        const phase={},began=performance.now();let at=began;
        // GPU-busy rAF callbacks remain fast. Resolution follows actual drawn
        // frame intervals, including the wait, rather than those skipped rAFs.
        if(f.renderStats.lastDrawAt!==undefined){const wallDt=(began-f.renderStats.lastDrawAt)/1000,scaled=renderScale.sample(Math.min(.25,wallDt));if(scaled!=null)renderer.renderScale=scaled;phase.wallFrameMs=wallDt*1000;}
        f.renderStats.lastDrawAt=began;
        const mark=key=>{const now=performance.now();phase[key]=now-at;at=now;};
        updateModels();mark('modelsMs');for(const item of f.airModels.values())item.pose(dt);f.ordnancePresentation.step(dt);mark('aircraftMs');rebuildTerrain();if(f.facilityPresentation.ready)f.facilityPresentation.update(f.facilities,{center:[f.focus[0],f.focus[2]],radius:f.terrainAerial?12000:2500});mark('terrainMs');f.root.update();const nodes=[];f.root.collect(nodes);mark('sceneMs');
        const airCamera=current?.aircraft?controlledAirModel():target?.aircraft?f.airModels.get(unitKey(target.unit)):null;
        let eye,forward,up=[0,1,0],fov=Math.PI/3,near=.3,far=10000;
        if(airCamera){const view=current?.aircraft?f.establishedFlight.view(dt):airCamera.plane.camera(dt,height);if(!view)return;eye=view.camPos;forward=view.fwd;up=view.up||up;fov=view.fovY;near=airCamera.plane.state.camera ? .05 : .3;far=f.map.id==='taiwan'?300000:50000;}
        else{const cp=Math.cos(f.pitch),dir=[Math.sin(f.yaw)*cp,Math.sin(f.pitch),Math.cos(f.yaw)*cp];eye=f.focus.map((v,i)=>v-dir[i]*f.distance);eye[1]=Math.max(eye[1],height(eye[0],eye[2])+2);forward=f.focus.map((v,i)=>v-eye[i]);}
        const look=lookAtLH(eye,forward,up),[cw,ch]=renderer.resize(),tanY=Math.tan(fov/2),camera={pos:eye,viewProj:mul(perspective(fov,cw/ch,near,far),look.view),forward:look.forward,right:look.right,up:look.up,tanX:tanY*cw/ch,tanY,near,far};
        G4.camPos=eye.slice();sound.setListener?.({position:eye,forward:look.forward,up:look.up,velocity:f.audioCamera&&dt>0?eye.map((v,i)=>(v-f.audioCamera[i])/dt):[0,0,0],time:G4.time});f.audioCamera=eye.slice();
        fx.update(dt);if(current?.aircraft)f.establishedFlight.present(dt);f.gunTracerPresentation.step(dt,camera.pos);f.airportPresentation.draw(camera.pos);fx.build(camera);renderer.advance(dt);renderer.pixelSize=0;mark('cameraEffectsMs');renderer.render(nodes,camera,f.focus,fx);renderGate.submitted();mark('renderSubmitMs');hud.resize(cw,ch);hud.clear();reticle.hidden=true;if(current?.aircraft){f.establishedFlight.draw(camera.viewProj,cw,ch);const plane=G4.air.plane;hud.drawCompass(Math.atan2(look.forward[0],look.forward[2]),plane.heading,plane.heading,canvas.clientWidth<760);}drawAirwarAirportTags(camera,cw,ch);drawMap();refreshUi();mark('mapUiMs');
        phase.totalMs=performance.now()-began;phase.tick=f.lastTick;phase.fullModels=[...f.models.values()].filter(m=>m.fullDetail).length;phase.drawCalls=renderer.drawCalls;
        f.renderStats.last=phase;f.renderStats.frames++;for(const key of ['modelsMs','aircraftMs','terrainMs','sceneMs','cameraEffectsMs','renderSubmitMs','mapUiMs','totalMs'])f.renderStats.max[key]=Math.max(f.renderStats.max[key]||0,phase[key]);
      }
      return Object.assign(f,{frame,send,receive,heightAt:height,ui,open,clearInput,shared:sharedApi,
        launchFromGarage:id=>f.establishedFlight.launch(id),returnToGarage:()=>f.establishedFlight.returnToGarage(),refreshGarageControls:id=>f.establishedFlight.refreshGarageControls(id),
        handleAircraftAction:(name,stamp)=>f.establishedFlight.action(name,stamp),airTargets:()=>f.establishedFlight.targets(),
        groundTargets:()=>f.establishedFlight.groundTargets(),sensorTargetAlive:target=>f.establishedFlight.targetAlive(target),radioSteer:(dx,dy,dt)=>f.establishedFlight.radioSteer(dx,dy,dt)});
    })();
    G4.frontline=frontline;
    function nativeArmReason(id,slotKey,store){const slot=frontline.shared.aircraftOptions().find(o=>o.id===id)?.slots?.find(s=>s.key===slotKey);return slot?.unsupported?.[store]||slot?.incomplete?.[store]||(!slot||!Object.hasOwn(slot.options||{},store)?'服务器未开放此挂点武器':'');}
    function constrainNativeArmEditor(){if(!frontline.shared.room()||armEd.hidden)return;for(const button of armEd.querySelectorAll('.air-arm-cell[data-slot]')){const why=nativeArmReason(armEd.dataset.air,button.dataset.slot,button.dataset.store);if(why){button.disabled=true;button.title=String(why);button.classList.add('todo');}}}
    function openNativeArmEditor(id){frontline.clearInput();openArmEditor(id);constrainNativeArmEditor();}
    const armObserver=new MutationObserver(constrainNativeArmEditor);armObserver.observe(armEd,{childList:true,subtree:true});
    armEd.addEventListener('click',event=>{if(!frontline.shared.room())return;const button=event.target.closest?.('.air-arm-cell[data-slot]');if(button){const why=nativeArmReason(armEd.dataset.air,button.dataset.slot,button.dataset.store);if(why){event.preventDefault();event.stopImmediatePropagation();return;}}queueMicrotask(constrainNativeArmEditor);},true);
    frontline.sharedLobby=installFrontlineSharedLobby({lobby,deploy,net,frontline:frontline.shared,aircraft:{
      lineup:()=>airOnlineLineup(),selectedId:()=>airGarage.sel,selectedLoadout:id=>frontlineLoadoutIndex(G4.airLoadout[id]??0),
      select(id){airGarage.sel=id;G4.lastAirType=id;},
      selectLoadout(id,index){G4.airLoadout[id]=index;saveAirArms();},loadouts:id=>airLoadouts(id),custom:id=>({...G4.airCustom[id]}),fuelHtml:id=>typeof aircraftFuelLoad!=='undefined'?aircraftFuelLoad.htmlFor(id):'',openConfiguration:openNativeArmEditor,
      openBattlefield:context=>frontline.establishedFlight.deployment(context)
    }});
    const serviceChoice=frontline.ui.querySelector('[data-fl=air-loadout]'),servicePanel=frontline.ui.querySelector('[data-fl=air-service-panel]');
    servicePanel.prepend(serviceChoice);serviceChoice.onchange=()=>{const unit=frontline.shared.controlled();if(unit){G4.airLoadout[unit.aircraft]=Number(serviceChoice.value);saveAirArms();}};
    const configureService=document.createElement('button');configureService.type='button';configureService.textContent='逐挂点配置整备挂载';configureService.onclick=()=>{const unit=frontline.shared.controlled();if(unit){airGarage.sel=unit.aircraft;openNativeArmEditor(unit.aircraft);}};servicePanel.prepend(configureService);
    let frontlineDisposed=false;
    frontline.dispose=()=>{if(frontlineDisposed)return;frontlineDisposed=true;frontline.terrainWorker?.dispose();frontline.navalPresentation.dispose();frontline.airportPresentation.dispose();document.getElementById('frontline-airwar-mission')?.remove();frontline.ordnancePresentation.dispose();frontline.gunTracerPresentation.dispose();frontline.sharedLobby.dispose();frontline.shared.dispose();armObserver.disconnect();clearInterval(frontline.inputTimer);frontline.clearInput();};
    window.addEventListener('pagehide',event=>{if(!event.persisted)frontline.dispose();});

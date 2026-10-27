// Offline command-interface and geography review. No game AI or unit movement runs here.
const orderKey=()=>state.team+':'+state.lane;
const ORDER_NAMES={move:'行军',attack:'进攻',defend:'防守',follow:'跟随'};
function companyOrigin(){
  const record=data.groundStaging?.records.find(r=>r.lane===state.lane&&r.frontIndex===state.front[state.lane]);
  return record?.staging.find(s=>s.team===state.team)?.enMeters||null;
}
function focusGround(){
  if(!width||!height){state.focusPending=true;return;}
  state.zoom=2.2;const p=P.lanes.find(l=>l.id===state.lane).nodes[state.front[state.lane]].enMeters;
  const s=Math.min((width-64)/M.widthMeters,(height-100)/M.heightMeters)*state.zoom;
  const base=[(width-M.widthMeters*s)/2,(height-M.heightMeters*s)/2-10];
  state.pan=[width/2-base[0]-(p[0]-M.boundsMeters[0])*s,height/2-base[1]-(M.boundsMeters[3]-p[1])*s];
  state.focusPending=false;render();
}
function setRole(role){
  state.role=role;document.querySelectorAll('[data-role]').forEach(b=>b.classList.toggle('active',b.dataset.role===role));
  document.querySelectorAll('.ground-only').forEach(b=>b.hidden=role!=='ground');
  document.querySelectorAll('.air-only').forEach(b=>b.hidden=role!=='air');
  state.layers.airspawns=role==='air';document.querySelector('[data-layer=airspawns]').checked=state.layers.airspawns;
  el('company-command-title').textContent=role==='air'?'飞行期间 · 连队简化命令':'坦克连地图命令示意';
  document.querySelector('[data-order=follow]').hidden=role==='air';
  if(role==='ground')focusGround();else{state.order=null;refreshOrderButtons();reset();}
}
function refreshOrderButtons(){document.querySelectorAll('[data-order]').forEach(b=>b.classList.toggle('active',b.dataset.order===state.order));}
function storeOrder(kind,target){
  const ids=state.platoon==='all'?['1','2','3']:[state.platoon];
  state.orders[orderKey()]??={};for(const id of ids)state.orders[orderKey()][id]={kind,target:target.slice()};
  el('order-status').textContent=`${state.platoon==='all'?'三个 AI 排':state.platoon+' 排'}：${ORDER_NAMES[kind]}意图已绘制。指挥坦克仍由玩家驾驶；这里没有执行 AI。`;
  state.order=null;refreshOrderButtons();render();
}
function previewOrder(pixel){
  const target=[M.boundsMeters[0]+(pixel[0]-offset[0])/scale,M.boundsMeters[3]-(pixel[1]-offset[1])/scale];
  if(target[0]<M.boundsMeters[0]||target[0]>M.boundsMeters[2]||target[1]<M.boundsMeters[1]||target[1]>M.boundsMeters[3])return;
  storeOrder(state.order,target);
}
function drawCompanyIntent(){
  const origin=companyOrigin();if(!origin)return;const q=xy(origin);g.save();
  g.fillStyle=colours[state.team];g.strokeStyle='#0d2534';g.lineWidth=2;g.fillRect(q[0]-7,q[1]-7,14,14);g.strokeRect(q[0]-7,q[1]-7,14,14);
  g.font='11px system-ui';g.textAlign='center';g.fillStyle='#d5efff';g.fillText('集结候选／指挥车示意',q[0],q[1]-13);
  for(let i=1;i<=3;i++){
    const x=q[0]+(i-2)*25,y=q[1]+20;
    g.fillStyle=state.platoon==='all'||state.platoon===String(i)?colours[state.team]:'#737e7a';g.fillRect(x-10,y-8,20,16);
    g.fillStyle='#10222b';g.font='10px system-ui';g.fillText(i+'排',x,y+3);
    const order=state.orders[orderKey()]?.[i];if(!order)continue;
    const target=xy(order.target);g.strokeStyle=order.kind==='attack'?'#ffae8c':order.kind==='defend'?'#a7dfab':'#8dd7fc';
    g.setLineDash([4,5]);g.beginPath();g.moveTo(q[0],q[1]);g.lineTo(...target);g.stroke();g.setLineDash([]);
    g.beginPath();g.arc(...target,8+i*2,0,Math.PI*2);g.stroke();g.fillStyle=g.strokeStyle;g.font='11px system-ui';g.fillText(i+'排 '+ORDER_NAMES[order.kind],target[0],target[1]-20-i*13);
  }
  g.fillStyle='#d8e2d9';g.font='10px system-ui';g.fillText('排级符号／命令意图示意',q[0],q[1]+43);g.restore();
}
function refreshRoads(){
  const lane=data.roads?.lanes.find(l=>l.lane===state.lane),body=el('route-rows');if(!body)return;
  body.replaceChildren();if(!lane){el('route-note').textContent='该轴线尚无道路分析结果。';return;}
  let missing=0,long=0;
  for(const s of lane.segments){
    const tr=document.createElement('tr'),name=document.createElement('td'),length=document.createElement('td'),bridges=document.createElement('td');
    name.textContent=s.from+' → '+s.to;
    if(s.status==='no_path_in_this_extract'){length.textContent='未连通';length.className='route-warning';bridges.textContent='待查';missing++;}
    else{length.textContent=(s.lengthMeters/1000).toFixed(1)+' km';bridges.textContent=s.bridgeWays.length;if(s.detourRatio>3){length.className='route-warning';long++;}}
    tr.append(name,length,bridges);body.append(tr);
  }
  const gap=Math.max(...lane.controlNodeRoadSnaps.map(s=>s.gapMeters));
  el('route-note').textContent=`${missing?missing+' 段在当前资料中未连通；':''}${long?long+' 段绕行明显；':''}原节点距映射道路最远约 ${Math.round(gap)} m。桥段、便道、坡度与承重仍需核验。`;
  const origin=companyOrigin(),wasBlocked=state.stagingBlocked;state.stagingBlocked=!origin;
  document.querySelectorAll('[data-order]').forEach(b=>b.disabled=!origin);
  if(!origin){state.order=null;refreshOrderButtons();el('order-status').textContent='该战线状态／阵营尚无连通的集结候选，命令示意暂不可用。';}
  else if(wasBlocked)el('order-status').textContent='选择排和命令，再点击地图绘制指挥意图。这里只演示界面，AI 尚未执行。';
  el('staging-note').textContent=origin?'集结候选沿道路距交战参考点 1.2 km；按 20 km/h 匀速约 3.6 分钟。十车停放空间、地形、补给和敌方视线仍待核验。':'当前状态没有已连通的候选接敌路线。西线需要重选路线；轴线末端需要另设后方部署或结束战斗。';
}
function drawProfile(item){
  const cv=el('profile'),note=el('profile-note'),field=data.airfieldStudy?.fields.find(f=>f.id===item.id);
  cv.hidden=!field;note.textContent='';if(!field)return;
  const source=field.profiles.find(p=>p.lengthMeters===2600),alt=item.id==='B-W'?data.pajuAlternative?.alternative.profile:null;
  const pg=cv.getContext('2d'),w=cv.width,h=cv.height,left=58,top=25,rw=w-left-20,rh=h-top-40;
  const all=[source,...(alt?[alt]:[])],values=all.flatMap(p=>p.surfaceElevationMeters),lo=Math.floor(Math.min(...values)/5)*5-2,hi=Math.ceil(Math.max(...values)/5)*5+2;
  const X=x=>left+(x+1300)/2600*rw,Y=y=>top+rh-(y-lo)/(hi-lo)*rh;
  pg.clearRect(0,0,w,h);pg.strokeStyle='#385058';pg.font='16px system-ui';pg.fillStyle='#c3d1cb';pg.textAlign='right';
  for(let k=0;k<=4;k++){const y=lo+(hi-lo)*k/4;pg.beginPath();pg.moveTo(left,Y(y));pg.lineTo(w-20,Y(y));pg.stroke();pg.fillText(y.toFixed(0),left-8,Y(y)+5);}
  pg.textAlign='center';for(const x of [-1000,0,1000])pg.fillText((x/1000).toFixed(0)+' km',X(x),h-8);
  all.forEach((p,i)=>{pg.strokeStyle=i?'#7ddcf3':'#efbd70';pg.lineWidth=2;pg.beginPath();p.distanceMeters.forEach((v,j)=>{const q=[X(v),Y(p.surfaceElevationMeters[j])];j?pg.lineTo(...q):pg.moveTo(...q);});pg.stroke();});
  note.textContent=`2,600 m 走廊的源表面高差约 ${source.surfaceRangeMeters.toFixed(1)} m${alt?'；附近拟改扩建走廊约 '+alt.surfaceRangeMeters.toFixed(1)+' m（蓝线）':''}。DSM 含建筑与植被，数值不等于实测跑道纵坡。${item.id==='R-W'?'该走向仍是依据跑道编号的初步假设。':''}`;
}
document.querySelectorAll('[data-role]').forEach(b=>b.onclick=()=>setRole(b.dataset.role));
document.querySelectorAll('[data-platoon]').forEach(b=>b.onclick=()=>{state.platoon=b.dataset.platoon;document.querySelectorAll('[data-platoon]').forEach(x=>x.classList.toggle('active',x===b));render();});
document.querySelectorAll('[data-order]').forEach(b=>b.onclick=()=>{const origin=companyOrigin();if(!origin)return;if(b.dataset.order==='follow'){storeOrder('follow',origin);return;}state.order=b.dataset.order;refreshOrderButtons();el('order-status').textContent=`${state.platoon==='all'?'三个 AI 排':state.platoon+' 排'}：点击地图选择${ORDER_NAMES[state.order]}区域（命令意图示意）。`;});
el('clear-orders').onclick=()=>{state.orders[orderKey()]={};state.order=null;refreshOrderButtons();el('order-status').textContent='已清除本轴线的命令示意。';render();};

el('team-preview').onchange=()=>{state.team=el('team-preview').value;state.order=null;refreshOrderButtons();refreshRoads();render();};

// Read-only design comparisons, populated from the retained study JSONs.
for(const option of data.taiwanStudy.options.slice().sort((a,b)=>Number(b.id===data.taiwanStudy.selectedExtentId)-Number(a.id===data.taiwanStudy.selectedExtentId))){
  const tr=document.createElement('tr');
  const selected=option.id===data.taiwanStudy.selectedExtentId;
  if(selected)tr.className='gold';
  for(const text of [(selected?'已选：':'对照：')+option.nameZh,`${Math.round(option.dimensions.widthAtMiddleLatitudeKm)} × ${Math.round(option.dimensions.heightAtMiddleLongitudeKm)} km`,option.presence.wholeTaiwanMainIslandPresent?'完整本岛':option.presence.taiwanMainIslandPresent?'含部分本岛':'不含本岛']){const td=document.createElement('td');td.textContent=text;tr.append(td);}
  el('taiwan-options').append(tr);
}
for(const room of data.eraStudy.roomProposals){
  const tr=document.createElement('tr');
  const names=ids=>ids.map(id=>data.eraStudy.aircraftNames[id]||id).join(' / ');
  for(const text of [room.label,names(room.verified_airframe_candidates),names(room.pending_airframe_candidates)||'—']){const td=document.createElement('td');td.textContent=text;tr.append(td);}
  el('era-options').append(tr);
}

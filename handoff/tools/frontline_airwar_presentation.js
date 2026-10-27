// Presentation only: all lives, mission progress and geometry come from the host.
function frontlineAirwarTeam(team){return team==='blue'?0:team==='red'?1:team;}
function frontlineAirwarMapView(focus,width,height){
  return {centre:[focus[0],focus[2]],scale:20000/Math.min(width,height),radius:10000};
}
function frontlineAirwarNearby(pos,view){return Math.hypot(pos[0]-view.centre[0],pos[2]-view.centre[1])<=view.radius;}
function frontlineAirwarSpectator({member,current,aircrafts=[],vessels=[],airfields=[],previous}){
  if(!member||member.observer||current?.alive||!(member.air_sortie_eligible===false||member.air_sorties_remaining===0)||member.player!=null&&aircrafts.some(u=>u.owner===member.player&&u.alive))return null;
  const key=u=>`${u.unit.battle}:${u.unit.unit}:${u.unit.life}`,team=frontlineAirwarTeam(member.team);
  const friendly=aircrafts.filter(u=>u.alive&&frontlineAirwarTeam(u.team)===team);
  const aircraft=friendly.find(u=>key(u)===previous)||friendly[0];
  if(aircraft)return {kind:'aircraft',key:key(aircraft),target:aircraft,label:`观战队友 · ${aircraft.aircraft} #${aircraft.unit.unit}`};
  const fleet=vessels.filter(u=>u.alive&&frontlineAirwarTeam(u.team)===team),ship=fleet.find(u=>key(u)===previous)||fleet[0];
  if(ship)return {kind:'vessel',key:key(ship),target:ship,label:'观战 · 己方舰队'};
  const base=airfields.find(a=>a.enabled&&frontlineAirwarTeam(a.team)===team);
  return base?{kind:'base',key:base.id,target:base,label:`观战 · ${base.name||'己方机场'}`}:{kind:'waiting',key:'',target:null,label:'观战 · 等待下一局'};
}
function frontlineAirwarMissionText(scenario,team){
  if(scenario?.id!=='taiwan_landing_escort')return '';
  const action=frontlineAirwarTeam(team)===scenario.attacker_team?'护送登陆舰抵达台湾并完成卸载':'击沉全部进攻舰队（登陆舰与护航舰）';
  const elapsed=Number.isFinite(scenario.unloading_s)?scenario.unloading_s:0,required=scenario.unload_required_s||15;
  return `${action} · 舰队 ${scenario.surviving_fleet??'—'} / 登陆舰 ${scenario.surviving_transports??'—'} · 登陆 ${elapsed.toFixed(1)} / ${required} 秒`;
}
function frontlineAirwarAirportLayout(field){
  const r=field.runway,[x,z]=r.center,[fx,fz]=r.forward,L=r.lengthMeters/2,W=r.widthMeters/2;
  const p=(lat,long,h=.16)=>[x+fz*lat+fx*long,r.height+h,z-fx*lat+fz*long],quads=[],lights=[];
  const rect=(a,b,c,d,color,h=.18)=>quads.push({points:[p(a,c,h),p(a,d,h),p(b,d,h),p(b,c,h)],color});
  rect(-W,W,-L,L,[.07,.08,.085],.12);
  for(let s=-L+75;s<L-75;s+=90)rect(-.65,.65,s,s+35,[.88,.88,.78]);
  for(const edge of [-W+1,W-1])rect(edge-.25,edge+.25,-L+20,L-20,[.85,.85,.76]);
  for(const end of [-1,1])for(const lat of [-15,-10,-5,5,10,15])rect(lat-1.2,lat+1.2,end*L-end*35,end*L-end*65,[.88,.88,.78]);
  // Fixed red perimeter plus white edge and green threshold lamps. These are
  // attached to registered runway axes, never queued in control-step effects.
  for(let s=-L-10;s<=L+10;s+=50)for(const side of [-1,1]){
    lights.push({pos:p(side*(W+30),s,1.05),color:[1,.025,.015],radius:.8});
    lights.push({pos:p(side*(W+1.5),Math.max(-L,Math.min(L,s)),.25),color:[1,.85,.55],radius:.45});
  }
  for(const end of [-1,1])for(let lat=-W-25;lat<=W+25;lat+=8){
    lights.push({pos:p(lat,end*(L+10),1.05),color:[1,.025,.015],radius:.8});
    if(Math.abs(lat)<=W)lights.push({pos:p(lat,end*(L-4),.3),color:[.05,1,.15],radius:.6});
  }
  return {quads,lights};
}
function createFrontlineAirwarAirports({Node,renderer,GeoBuilder,identity,fx}){
  const root=new Node('airwar-airport-markings'),lights=[];let installed=null;
  function clear(){for(const n of root.children)if(n.mesh)renderer.freeMesh(n.mesh);root.children=[];lights.length=0;installed=null;}
  function install(map){
    if(installed===map)return;clear();installed=map;
    const builder=new GeoBuilder();
    for(const field of map?.airfields||[]){if(!field.enabled||!field.runway)continue;const layout=frontlineAirwarAirportLayout(field);
      for(const q of layout.quads)builder.quad(identity,false,...q.points,{color:q.color,rough:1,metal:0});lights.push(...layout.lights);
    }
    if(lights.length){const n=root.add(new Node('registered-runway-surface-and-markings'));n.mesh=renderer.mesh(builder.build());n.kind=21;n.castShadow=false;}
  }
  function draw(eye){for(const lamp of lights)if(Math.hypot(lamp.pos[0]-eye[0],lamp.pos[1]-eye[1],lamp.pos[2]-eye[2])<12000)fx.glow(lamp.pos,lamp.radius,lamp.color,1);}
  return {root,install,draw,clear,dispose:clear,get lightCount(){return lights.length;}};
}

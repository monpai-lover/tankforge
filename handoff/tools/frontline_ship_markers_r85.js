/* TF_SHIP_MARKERS_R85_BEGIN */
// Stateless labels for permitted native vessel snapshots. Reuses hud.drawLabels
// for leader lines, contrast backing and overlap placement; no second overlay.
var TFShipMarkersR85=(()=>{
  const names=Object.freeze({generic_transport:'运输舰',generic_landing_ship:'登陆舰',generic_escort:'护航舰',generic_frigate:'护卫舰',generic_interceptor:'快艇',generic_patrol:'巡逻艇'});
  const point=p=>(Array.isArray(p)||ArrayBuffer.isView(p))&&p.length===3&&p.every(Number.isFinite);
  function layout({vessels,camera,project,width,height,team}={}){
    if(!Array.isArray(vessels)||!point(camera?.pos)||typeof project!=='function'||!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1)return [];
    const memberTeam=team==='blue'?0:team==='red'?1:team;
    const seen=new Set(),candidates=[];
    for(const vessel of vessels.slice(0,64)){
      if(!vessel?.alive||!point(vessel.pos)||![0,1].includes(vessel.team))continue;
      const ref=vessel.unit;if(!ref||![ref.battle,ref.unit,ref.life].every(n=>Number.isSafeInteger(n)&&n>0))continue;
      const key=`${ref.battle}:${ref.unit}:${ref.life}`;if(seen.has(key))continue;seen.add(key);
      const p=vessel.pos,d=Math.hypot(p[0]-camera.pos[0],p[1]-camera.pos[1],p[2]-camera.pos[2]);if(d>10000)continue;
      const projected=project(camera.viewProj,[p[0],p[1]+14,p[2]]);
      if(!point(projected)||projected[2]<=0||Math.abs(projected[0])>.9||Math.abs(projected[1])>.86)continue;
      const number=String(vessel.id||'').match(/-(\d+)$/)?.[1]||String(ref.unit);
      const name=names[vessel.model]||({transport:'运输舰',escort:'护航舰',interceptor:'拦截舰'}[vessel.role])||'舰船';
      candidates.push({x:(projected[0]*.5+.5)*width,y:(.5-projected[1]*.5)*height,
        text:`${vessel.team===0?'蓝方':'红方'} · ${name} ${number} · ${(d/1000).toFixed(1)} km`,crew:vessel.team===memberTeam,d,key});
    }
    // Nearest-first admission bounds clutter; shared HUD owns final placement.
    return candidates.sort((a,b)=>a.d-b.d||a.key.localeCompare(b.key)).slice(0,16).map(({d,key,...tag})=>tag);
  }
  return Object.freeze({layout});
})();
/* TF_SHIP_MARKERS_R85_END */

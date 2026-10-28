import assert from 'node:assert/strict';

// Shared-canvas presentation only. No new DOM/canvas, authoritative state,
// registry lookup or hidden contact source is introduced by this patch.
export const R86_AIRWAR_HUD_HELPER=String.raw`/* TF_R86_AIRWAR_HUD_BEGIN */
var TFAirwarHudR86=(()=>{
  const strategicRangeMeters=80000; // Covers the ~72km diagonal of the 1:10 theatre; minimap remains 10km.
  const names={generic_transport:'运输舰',generic_landing_ship:'登陆舰',generic_escort:'护航舰',generic_frigate:'护卫舰',generic_interceptor:'快艇',generic_patrol:'巡逻艇'};
  const point=p=>(Array.isArray(p)||ArrayBuffer.isView(p))&&p.length===3&&p.every(Number.isFinite);
  const side=t=>t==='blue'?0:t==='red'?1:t;
  function layout({vessels,camera,project,width,height,team,aircraft=false}={}){
    if(!Array.isArray(vessels)||!point(camera?.pos)||typeof project!=='function'||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return [];
    const seen=new Set(),onScreen=[],offScreen=[null,null],visibleSide=[false,false],memberTeam=side(team);
    for(const vessel of vessels.slice(0,64)){
      const r=vessel?.unit;
      if(!vessel?.alive||![0,1].includes(vessel.team)||!point(vessel.pos)||!r||![r.battle,r.unit,r.life].every(n=>Number.isSafeInteger(n)&&n>0))continue;
      const key=r.battle+':'+r.unit+':'+r.life;if(seen.has(key))continue;seen.add(key);
      const p=vessel.pos,d=Math.hypot(p[0]-camera.pos[0],p[1]-camera.pos[1],p[2]-camera.pos[2]);if(d>strategicRangeMeters)continue;
      const q=project(camera.viewProj,[p[0],p[1]+14,p[2]]);if(!point(q))continue;
      const row={d,key,team:vessel.team,crew:vessel.team===memberTeam};
      if(q[2]>0&&Math.abs(q[0])<=.9&&Math.abs(q[1])<=.86){
        const number=String(vessel.id||'').match(/-(\d+)$/)?.[1]||String(r.unit),name=names[vessel.model]||({transport:'运输舰',escort:'护航舰',interceptor:'拦截舰'}[vessel.role])||'舰船';
        visibleSide[vessel.team]=true;onScreen.push({...row,x:(q[0]*.5+.5)*width,y:(.5-q[1]*.5)*height,text:(vessel.team===0?'蓝方':'红方')+' · '+name+' '+number+' · '+(d/1000).toFixed(1)+' km'});
      }else if(aircraft){
        const old=offScreen[vessel.team];if(!old||d<old.d||d===old.d&&key<old.key)offScreen[vessel.team]={...row,q};
      }
    }
    const result=onScreen.sort((a,b)=>a.d-b.d||a.key.localeCompare(b.key)).slice(0,16).map(({d,key,...tag})=>tag);
    for(let t=0;t<2;t++){
      const row=offScreen[t];if(!row||visibleSide[t])continue;
      let dx=row.q[0],dy=-row.q[1];const behind=row.q[2]<=0;if(behind){dx=-dx;dy=-dy;}if(Math.abs(dx)+Math.abs(dy)<1e-9)dy=1;
      const scale=Math.min(.88/Math.max(1e-9,Math.abs(dx)),.72/Math.max(1e-9,Math.abs(dy))),arrow=Math.abs(dx)>Math.abs(dy)?(dx<0?'←':'→'):(dy<0?'↑':'↓');
      result.push({fleetCue:true,team:t,crew:row.crew,x:(.5+dx*scale*.5)*width,y:(.5+dy*scale*.5)*height,text:arrow+' '+(t===0?'蓝方':'红方')+'舰队'+(behind?' · 后方':'')+' · '+(row.d/1000).toFixed(1)+' km'});
    }
    return result;
  }
  function cues(g,tags,width,height){
    if(width<80||height<80)return;
    g.textAlign='center';g.textBaseline='middle';g.font='600 '+Math.max(10,Math.min(13,height/60))+'px system-ui';
    const placed=[],intersects=(x,y,w,h,r)=>x<r.x+r.w&&x+w>r.x&&y<r.y+r.h&&y+h>r.y;
    for(const tag of tags.slice(0,2)){
      const w=Math.min(Math.max(1,width-16),g.measureText(tag.text).width+16),h=24;
      const x=Math.max(8,Math.min(width-w-8,tag.x-w/2)),top=Math.min(64,Math.max(4,height*.15)),bottom=Math.max(top,height-96-h);let y=Math.max(top,Math.min(bottom,tag.y-h/2));
      if(placed.some(r=>intersects(x,y,w,h,r))){
        // The two factions may share a bearing. Separate their bounded boxes
        // deterministically instead of painting the later faction over the first.
        const alternatives=placed.flatMap(r=>[r.y+r.h+4,r.y-h-4]);
        const free=(a,b)=>alternatives.find(v=>v>=a&&v<=b&&!placed.some(r=>intersects(x,v,w,h,r)));
        y=free(top,bottom)??free(4,height-h-4)??y;
      }
      placed.push({x,y,w,h});
      g.fillStyle='rgba(8,17,23,.88)';g.fillRect(x,y,w,h);g.fillStyle=tag.crew?'#9fd3c7':'#e2b34a';g.fillText(tag.text,x+w/2,y+h/2,w-8);
    }
  }
  function draw(hud,airCanvas,tags,renderWidth,renderHeight,cssWidth,cssHeight){
    if(!hud||typeof hud.drawLabels!=='function'||!Array.isArray(tags))return;
    const regular=tags.filter(t=>!t.fleetCue),edge=tags.filter(t=>t.fleetCue);
    if(!airCanvas){hud.drawLabels(regular);return;}
    const g=airCanvas.getContext?.('2d');if(!g||![renderWidth,renderHeight,cssWidth,cssHeight].every(v=>Number.isFinite(v)&&v>0))return;
    const sx=cssWidth/renderWidth,sy=cssHeight/renderHeight,convert=t=>({...t,bounded:true,x:t.x*sx,y:t.y*sy});
    g.save();try{
      g.setTransform(airCanvas.width/cssWidth,0,0,airCanvas.height/cssHeight,0,0);g.globalAlpha=1;g.globalCompositeOperation='source-over';g.textAlign='left';g.shadowBlur=0;g.shadowOffsetX=g.shadowOffsetY=0;g.filter='none';g.setLineDash([]);
      // drawAirOverlay already cleared this visible canvas in this same frame.
      // Reuse shared labels with logical CSS dimensions under its DPR transform.
      hud.drawLabels.call({ctx:g,overlay:{width:cssWidth,height:cssHeight}},regular.map(convert));
      cues(g,edge.map(convert),cssWidth,cssHeight);
    }finally{g.restore();}
  }
  function drawMission(g,scenario,team,width,height){
    if(scenario?.id!=='taiwan_landing_escort'||!g||width<40||height<80)return;
    const action=side(team)===scenario.attacker_team?'护送登陆':'拦截舰队',fleet=Number.isFinite(scenario.surviving_fleet)?scenario.surviving_fleet:'—',transport=Number.isFinite(scenario.surviving_transports)?scenario.surviving_transports:'—';
    const elapsed=Number.isFinite(scenario.unloading_s)?scenario.unloading_s:0,required=Number.isFinite(scenario.unload_required_s)?scenario.unload_required_s:15;
    g.save();try{g.globalAlpha=1;g.textAlign='left';g.textBaseline='alphabetic';g.font='10px system-ui';g.fillStyle='rgba(8,17,23,.85)';g.fillRect(8,43,width-16,28);g.fillStyle='#e5f0ed';g.fillText(action+' · 舰队 '+fleet+' / 登陆 '+transport,12,54,width-24);g.fillText('卸载 '+elapsed.toFixed(1)+' / '+required+' 秒',12,67,width-24);}finally{g.restore();}
  }
  return Object.freeze({strategicRangeMeters,layout,draw,drawMission});
})();
/* TF_R86_AIRWAR_HUD_END */`;

const edits=[
 ['      function drawAirwarAirportTags(camera,w,h){','      function drawAirwarAirportTags(camera,w,h,airCanvas=null){'],
 ['tags.push(...TFShipMarkersR85.layout({vessels:f.vessels,camera,project,width:w,height:h,team:mine()?.team}));hud.drawLabels(tags);','tags.push(...TFAirwarHudR86.layout({vessels:f.vessels,camera,project,width:w,height:h,team:mine()?.team,aircraft:!!airCanvas}));TFAirwarHudR86.draw(hud,airCanvas,tags,w,h,canvas.clientWidth,canvas.clientHeight);'],
 ['drawAirwarAirportTags(camera,cw,ch);drawMap();','drawAirwarAirportTags(camera,cw,ch,current?.aircraft?airEl.ov:null);drawMap();'],
 ["airwarOverlay.hidden=!f.active||G4.mode!=='battle'||!!f.deploymentVisible;","airwarOverlay.hidden=!f.active||G4.mode!=='battle'||!!f.deploymentVisible||!!current?.aircraft;"],
 ["g.fillText('附近 10 km',12,36);","g.fillText('附近 10 km',12,36);TFAirwarHudR86.drawMission(g,f.scenario,mine()?.team,w,h);"]
];
// Optional tag semantics on the existing shared HUD owner. Only R86 aircraft
// labels opt in; the projected dot stays untouched and old callers keep their
// original placement. Source-client fragments do not contain this class owner.
const sharedLabelEdits=[
 ['        const tw = g.measureText(l.text).width + 12 * s;',`        // TF_R86_BOUNDED_SHARED_LABELS
        const bounded = l.bounded === true;
        if (bounded && (this.overlay.width < 24 || this.overlay.height < size * 1.36 + 8)) continue;
        const measuredWidth = g.measureText(l.text).width + 12 * s;
        const tw = bounded ? Math.min(measuredWidth, Math.max(1, this.overlay.width - 16)) : measuredWidth;`],
 ['        const right = l.x < this.overlay.width * 0.5 ? -1 : 1;',`        let right = l.x < this.overlay.width * 0.5 ? -1 : 1;
        if (bounded) {
          const need = tw + 46 * s, leftFits = l.x - need >= 8, rightFits = l.x + need <= this.overlay.width - 8;
          if (!leftFits && rightFits) right = 1;
          else if (leftFits && !rightFits) right = -1;
          else if (!leftFits && !rightFits) right = l.x < this.overlay.width * 0.5 ? 1 : -1;
        }`],
 ['        let ty = l.y;',`        const minY = size * 0.68 + 4, maxY = this.overlay.height - size * 0.68 - 4;
        let ty = bounded ? Math.max(minY, Math.min(maxY, l.y)) : l.y, labelStep = size * 1.4;`],
 ['        const tx = l.x + right * 46 * s;\n        const x0 = right > 0 ? tx : tx - tw;',`        let tx = l.x + right * 46 * s;
        let x0 = right > 0 ? tx : tx - tw;
        if (bounded) { x0 = Math.max(8, Math.min(this.overlay.width - tw - 8, x0)); tx = right > 0 ? x0 : x0 + tw; }`],
 ['        for (let guard = 0; guard < 12; guard++) {','        for (let guard = 0; guard < (bounded ? 32 : 12); guard++) {'],
 ['          ty = hit.y + size * 1.4;',`          if (bounded && hit.y + labelStep > maxY) labelStep = -size * 1.4;
          ty = bounded ? Math.max(minY, Math.min(maxY, hit.y + labelStep)) : hit.y + size * 1.4;`],
 ['        g.fillText(l.text, x0 + 6 * s, ty + 1);',`        if (bounded) g.fillText(l.text, x0 + 6 * s, ty + 1, Math.max(1, tw - 12 * s));
        else g.fillText(l.text, x0 + 6 * s, ty + 1);`]
];
const eolOf=s=>s.includes('\r\n')&&!/(?<!\r)\n/.test(s)?'\r\n':'\n';
const unique=(s,text,label)=>assert.equal(s.split(text).length-1,1,'Unique reviewed R86 '+label+' required');
function editSharedLabels(source,restore){
 const start=source.indexOf('    drawLabels(labels) {');if(start<0)return source;
 unique(source,'    drawLabels(labels) {','shared HUD owner');const end=source.indexOf('    /**',start);assert.ok(end>start,'Reviewed shared HUD boundary required');
 let owner=source.slice(start,end);if(restore&&!owner.includes('TF_R86_BOUNDED_SHARED_LABELS'))return source;
 for(const[before,after]of sharedLabelEdits){unique(owner,restore?after:before,'shared label hook');owner=owner.replace(restore?after:before,restore?before:after);}
 return source.slice(0,start)+owner+source.slice(end);
}
export function normalizeR86AirwarHud(source){
 const eol=eolOf(source);let s=source.replaceAll('\r\n','\n');
 if(s.includes('/* TF_R86_AIRWAR_HUD_BEGIN */')){
  unique(s,R86_AIRWAR_HUD_HELPER,'shared-canvas helper');s=s.replace(R86_AIRWAR_HUD_HELPER+'\n','');
  for(const [before,after]of edits){unique(s,after,'installed HUD hook');s=s.replace(after,before);}
  s=editSharedLabels(s,true);
 }else{for(const[,after]of edits)assert.ok(!s.includes(after),'Unscoped R86 HUD hook found');assert.ok(!s.includes('TF_R86_BOUNDED_SHARED_LABELS'),'Unscoped R86 shared HUD hook found');}
 return s.replaceAll('\n',eol);
}
export function patchR86AirwarHud(source){
 const eol=eolOf(source);let s=normalizeR86AirwarHud(source).replaceAll('\r\n','\n');
 for(const[before,after]of edits){unique(s,before,'legacy HUD hook');s=s.replace(before,after);}
 const anchor=edits[0][1];unique(s,anchor,'helper insertion owner');s=s.replace(anchor,R86_AIRWAR_HUD_HELPER+'\n'+anchor);
 s=editSharedLabels(s,false);
 return s.replaceAll('\n',eol);
}

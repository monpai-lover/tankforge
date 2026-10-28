import fs from 'node:fs';
import assert from 'node:assert/strict';
import {R84_ESCORT_TERRAIN_HOOK} from './patch_r84_scale30_terrain.mjs';
const helper=fs.readFileSync(new URL('./frontline_airwar_presentation.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const syncSpectator=`      function syncAirwarSpectator(){
        const choice=frontlineAirwarSpectator({member:mine(),current:controlled(),aircrafts:f.aircrafts,vessels:f.vessels,airfields:f.map?.airfields,previous:f.follow});
        const previous=f.spectator;f.spectator=choice;
        if(!choice)return;f.lossPending=false;
        if(!previous){f.establishedFlight.release();clearInput();deploy.close();f.deploymentVisible=false;renderer.setMap(null);renderer.zones=[];setMode('battle');f.pitch=-.18;f.distance=45;}
        if(previous?.key!==choice.key){f.follow=choice.kind==='aircraft'||choice.kind==='vessel'?choice.key:null;f.audioCamera=null;if(choice.target){const p=choice.target.pos;f.focus=[p[0],p[1]+(choice.kind==='base'?30:3),p[2]];f.yaw=choice.target.yaw||0;}if(choice.kind==='vessel')f.distance=180;if(choice.kind==='base')f.distance=350;}
      }
`;
const init=`      f.vessels=[];f.navalCatalog=[];f.scenario=null;f.spectator=null;f.lossPending=false;
      f.navalPresentation=createFrontlineNavalVisual({Node,renderer,GeoBuilder});f.root.add(f.navalPresentation.root);
      f.airportPresentation=createFrontlineAirwarAirports({Node,renderer,GeoBuilder,identity:IDENTITY,fx});f.root.add(f.airportPresentation.root);
      const airwarOverlay=document.createElement('aside');airwarOverlay.id='frontline-airwar-mission';airwarOverlay.hidden=true;airwarOverlay.style.cssText='position:fixed;bottom:28px;left:50%;transform:translateX(-50%);max-width:65vw;background:#10202cd9;color:#e5f0ed;border:1px solid #708c93;padding:7px 12px;font:13px/1.5 system-ui;z-index:1240;text-align:center';
      const airwarText=document.createElement('div'),spectatorNext=document.createElement('button');spectatorNext.type='button';spectatorNext.textContent='下一位队友';spectatorNext.style.cssText='margin:5px 0 0;padding:4px 12px;color:#ecf6f3;background:#284350;border:1px solid #8cabae';airwarOverlay.append(airwarText,spectatorNext);document.body.appendChild(airwarOverlay);
      spectatorNext.onclick=()=>{const friends=f.aircrafts.filter(u=>u.alive&&u.team===mine()?.team);if(friends.length){const i=friends.findIndex(u=>unitKey(u.unit)===f.follow);f.follow=unitKey(friends[(i+1)%friends.length].unit);syncAirwarSpectator();}};
`;
const edits=[
 ["      const open = null; // The existing #net-btn / LobbyUi is the only connection entry.",`      style.textContent+='body[data-frontline-watch="1"] #drive,body[data-frontline-watch="1"] #gunbox,body[data-frontline-watch="1"] #lock-hint,body[data-frontline-watch="1"] #veh-name,body[data-frontline-watch="1"] #gameplay-rule,body[data-frontline-watch="1"] #help,body[data-frontline-watch="1"] #touch{display:none!important}';
      const open = null; // The existing #net-btn / LobbyUi is the only connection entry.`],
 ["        const member=mine(),company=owned(),current=controlled(),round=frontlineRoundPresentation(f.room);", "        const member=mine(),company=owned(),current=controlled(),round=frontlineRoundPresentation(f.room);document.body.dataset.frontlineWatch=f.active&&!current&&!f.deploymentVisible?'1':'0';"],
 ["if(m.op==='control'){f.airDeploymentPending=false;", "if(m.op==='control'){if(m.reason==='controlled_loss')f.lossPending=true;f.airDeploymentPending=false;"],
 ["const controlled=()=>allUnits().find(u=>same(u.unit,f.control));","const controlled=()=>allUnits().find(u=>u.alive&&same(u.unit,f.control));"],
 ["      const renderGate=createFrontlineRenderGate(renderer);",init+"      const renderGate=createFrontlineRenderGate(renderer);"],
 ["      function resetBattlePresentation(){\n","      function resetBattlePresentation(){\n        f.navalPresentation.clear();f.airportPresentation.clear();f.vessels=[];f.navalCatalog=[];f.scenario=null;f.spectator=null;f.lossPending=false;airwarOverlay.hidden=true;\n"],
 ["f.contactPresentation=null;f.contacts=[];", "for(const n of [f.navalPresentation.root,f.airportPresentation.root])if(!f.root.children.includes(n))f.root.add(n);\n        f.contactPresentation=null;f.contacts=[];"],
 ["          f.map=map;if(f.map.schemaVersion", "          f.map=map;f.airportPresentation.install(map);if(f.map.schemaVersion"],
 ["if(f.map?.id==='taiwan'&&typeof createFrontlineTerrainWorker", "if(['taiwan','taiwan-escort'].includes(f.map?.id)&&typeof createFrontlineTerrainWorker"],
 ["f.terrainWorker?.request({focus:f.focus,aerial,facilityReady", "f.terrainWorker?.request({focus:f.map.scenario==='taiwan_landing_escort'?[0,0,0]:f.focus,aerial,facilityReady"],
 ["        const cx=Math.floor(f.focus[0]/750)*750,cz=Math.floor(f.focus[2]/750)*750;", "        const compact=f.map.scenario==='taiwan_landing_escort',cx=compact?0:Math.floor(f.focus[0]/750)*750,cz=compact?0:Math.floor(f.focus[2]/750)*750;"],
 ["        const radius=aerial?12000:2500,step=aerial?200:50;", "        const radius=compact?3600:aerial?12000:2500,step=compact?50:aerial?200:50;"],
 ["for(const road of f.map.roads||[]){if(!road.connected||!road.navEnabled)", "for(const road of compact?[]:f.map.roads||[]){if(!road.connected||!road.navEnabled)"],
 ["item.setControlled(same(u.unit,f.control));", "item.setControlled(u.alive&&same(u.unit,f.control));"],
 ["      function refreshUi(){", syncSpectator+"      function refreshUi(){"],
 ["        flightReadout.hidden=true;", "        flightReadout.hidden=true;\n        airwarOverlay.hidden=!f.active||G4.mode!=='battle'||!!f.deploymentVisible;airwarText.textContent=[f.spectator?.label,frontlineAirwarMissionText(f.scenario,member?.team)].filter(Boolean).join(' · ');if(!airwarText.textContent)airwarOverlay.hidden=true;spectatorNext.hidden=!f.spectator||!f.aircrafts.some(u=>u.alive&&u.team===member?.team);"],
 ["const api={room:native,rooms:","const api={room:native,spectating:()=>f.spectator||f.lossPending,rooms:"],
 ["          f.missiles=Array.isArray(m.missiles)?m.missiles:[];", "          if(Array.isArray(m.vessels))f.vessels=m.vessels;if(Array.isArray(m.naval_geometry_catalog))f.navalCatalog=m.naval_geometry_catalog;if(Object.hasOwn(m,'scenario'))f.scenario=m.scenario;\n          f.navalPresentation.accept(f.navalCatalog,f.vessels,{battle:m.battle??f.room?.battle,tick:m.tick??f.lastTick});\n          f.missiles=Array.isArray(m.missiles)?m.missiles:[];"],
 ["          updateAircraftModels(0);\n", "          updateAircraftModels(0);syncAirwarSpectator();\n"],
 ["if(mine()?.observer&&f.units.length)", "if(mine()?.observer&&(f.units.length||f.vessels.length))"],
 ["const unit=f.units[0];f.follow=", "const unit=f.vessels[0]||f.units[0];f.follow="],
 ["el('follow').onchange=()=>{f.follow=el('follow').value||null;f.audioCamera=null;};", "el('follow').onchange=()=>{f.follow=el('follow').value||null;f.audioCamera=null;syncAirwarSpectator();};"],
 ["        if(theatre){f.mapScale=theatre.scale;", "        const local=frontlineAirwarMapView(f.focus,w,h);\n        if(f.room?.battle_mode==='air_frontline'){f.mapScale=local.scale;f.mapCentre=local.centre;}else if(theatre){f.mapScale=theatre.scale;"],
 ["for(const road of f.map.roads||[]){if(!road.connected)", "for(const road of f.scenario?[]:f.map.roads||[]){if(!road.connected)"],
 ["for(const o of f.objectives){const member=mine()", "for(const o of f.scenario?[]:f.objectives){const member=mine()"],
 ["for(const source of f.staging||[]){if(!mine()", "for(const source of f.scenario?[]:f.staging||[]){if(!mine()"],
 ["for(const u of f.units){const q=point(u.pos)","for(const u of f.units){if(!frontlineAirwarNearby(u.pos,local))continue;const q=point(u.pos)"],
 ["for(const u of f.aircrafts){const q=point(u.pos)","for(const u of f.aircrafts){if(!frontlineAirwarNearby(u.pos,local))continue;const q=point(u.pos)"],
 ["if(contact.status==='last_known'){", "if(contact.status==='last_known'&&frontlineAirwarNearby(contact.pos,local)){"],
 ["if(!field.enabled||!field.runway)continue;const runway=field.runway,[x,z]", "if(!field.enabled||!field.runway||!frontlineAirwarNearby(field.pos,local))continue;const runway=field.runway,[x,z]"],
 ["g.moveTo(...a);g.lineTo(...b);g.stroke();}\n        for(const u of f.aircrafts)", "g.moveTo(...a);g.lineTo(...b);g.stroke();const q=point(field.pos);g.strokeRect(q[0]-5,q[1]-5,10,10);g.font='bold 11px system-ui';g.fillStyle=g.strokeStyle;g.fillText(field.name||field.id,q[0]+8,q[1]-8);}\n        for(const ship of f.vessels||[]){if(!frontlineAirwarNearby(ship.pos,local))continue;const q=point(ship.pos);g.fillStyle=!ship.alive?'#747775':ship.team===0?'#76bdff':'#ff9984';g.fillRect(q[0]-3,q[1]-5,6,10);if(ship.role==='transport'){g.font='10px system-ui';g.fillText('登陆舰',q[0]+7,q[1]+8);}}\n        for(const u of f.aircrafts)"],
 ["g.fillText(f.map.name||'台海海峡',12,20);", "g.fillText(f.map.name||'台海海峡',12,20);g.font='11px system-ui';g.fillText('附近 10 km',12,36);"],
 ["if(!f.map||!f.focus)return;const current=controlled(),target=allUnits().find", "if(!f.map||!f.focus)return;syncAirwarSpectator();const current=controlled(),target=allUnits().concat(f.vessels||[]).find"],
 ["        if(current?.aircraft)f.establishedFlight.step(dt);", "        f.airportPresentation.install(f.map);if(current?.aircraft)f.establishedFlight.step(dt);"],
 ["fx.build(camera);renderer.advance(dt);", "f.airportPresentation.draw(camera.pos);fx.build(camera);renderer.advance(dt);"],
 ["frontline.ordnancePresentation.dispose();", "frontline.navalPresentation.dispose();frontline.airportPresentation.dispose();document.getElementById('frontline-airwar-mission')?.remove();frontline.ordnancePresentation.dispose();"],
 ["nativeMap='taiwan',", "nativeMap='taiwan-escort',"],
 ["if(!battle()||!me||me.observer||frontline.controlled()){if(opened)", "if(!battle()||!me||me.observer||frontline.controlled()||frontline.spectating?.()){if(opened)"],
 ["现在以自由视角观战，请等待下一局。", "现在默认观战存活队友，请等待下一局。"],
 ["air_elimination:'敌方空军全灭'", "air_elimination:'敌方空军全灭',landing_completed:'登陆完成',attacker_fleet_annihilated:'进攻舰队全灭',landing_timeout:'登陆超时'"],
 ["for(const unit of f.units||[]){\n      if(!unit.alive||unit.team===team)","for(const unit of (f.units||[]).concat(f.vessels||[])){\n      if(!unit.alive||(unit.team===0?'blue':unit.team===1?'red':unit.team)===team)"],
 ["e.vx=unit.net?.v?.[0]||0;e.vz=unit.net?.v?.[2]||0;e.name=unit.vehicle;e.box={top:data.vehicles[unit.vehicle]?.vehicle?.hull?.size_m?.[1]||2};", "e.vx=unit.velocity?.[0]??unit.net?.v?.[0]??0;e.vz=unit.velocity?.[2]??unit.net?.v?.[2]??0;e.name=unit.vehicle||unit.model||unit.role;e.box={top:unit.geometry_id?8:data.vehicles[unit.vehicle]?.vehicle?.hull?.size_m?.[1]||2};"],
 ["      function syncAirwarSpectator(){",`      function drawAirwarAirportTags(camera,w,h){
        const tags=[];for(const field of f.map?.airfields||[]){if(!field.enabled||!field.runway)continue;const p=field.pos,pr=project(camera.viewProj,[p[0],p[1]+12,p[2]]);if(pr[2]<=0||Math.abs(pr[0])>.98||Math.abs(pr[1])>.95)continue;const d=Math.hypot(p[0]-camera.pos[0],p[1]-camera.pos[1],p[2]-camera.pos[2]);tags.push({x:(pr[0]*.5+.5)*w,y:(1-(pr[1]*.5+.5))*h,text:'✈ '+(field.name||field.id)+' · '+(d/1000).toFixed(1)+' km'});}hud.drawLabels(tags);
      }
      function syncAirwarSpectator(){`],
 ["}drawMap();refreshUi();mark('mapUiMs');", "}drawAirwarAirportTags(camera,cw,ch);drawMap();refreshUi();mark('mapUiMs');"],

];
// Source and canonical share these small reviewed hooks. Never replace a full
// native client block: installed guided/CM/precision/worker owners remain intact.
export function patchTaiwanAirwarHooks(source,{partial=false}={}){
  const crlf=source.includes('\r\n')&&!/(?<!\r)\n/.test(source);let s=source.replaceAll('\r\n','\n');
  for(const [before,after]of edits){if(s.includes(after))continue;if(after.startsWith('        const radius=compact?3600:')&&s.includes(R84_ESCORT_TERRAIN_HOOK)){assert.equal(s.split(R84_ESCORT_TERRAIN_HOOK).length-1,1);continue;}if(!s.includes(before)&&partial)continue;assert.equal(s.split(before).length-1,1,`Unique airwar presentation hook: ${before.slice(0,100)}`);s=s.replace(before,after);}
  // Leave cleanup is present in the source and carries installed CM cleanup in
  // the canonical artifact. Prefix insertion preserves all following owners.
  const leave="if(m.op==='left'){f.establishedFlight.release(true);",next="if(m.op==='left'){f.navalPresentation.clear();f.airportPresentation.clear();f.vessels=[];f.navalCatalog=[];f.scenario=null;f.spectator=null;f.lossPending=false;airwarOverlay.hidden=true;f.establishedFlight.release(true);";
  if(s.includes(leave))s=s.replace(leave,next);else if(!partial)assert.ok(s.includes(next),'Unique native leave cleanup required');
  const roots="f.root.children=f.terrain?[f.terrain,f.facilityPresentation.root]:[f.facilityPresentation.root];net.frontlineRoom=null;";
  if(s.includes(roots))s=s.replace(roots,"f.root.children=f.terrain?[f.terrain,f.facilityPresentation.root]:[f.facilityPresentation.root];for(const n of [f.navalPresentation.root,f.airportPresentation.root])f.root.add(n);net.frontlineRoom=null;");
  return crlf?s.replaceAll('\n','\r\n'):s;
}
export function patchTaiwanAirwarPresentation(source){
  source=patchTaiwanAirwarHooks(source);const eol=source.includes('\r\n')&&!/(?<!\r)\n/.test(source)?'\r\n':'\n';
  const begin='/* TF_AIRWAR_PRESENTATION_BEGIN */'+eol,end='/* TF_AIRWAR_PRESENTATION_END */'+eol,expected=begin+helper.replaceAll('\n',eol)+eol+end;
  if(source.includes(begin)){const a=source.indexOf(begin),b=source.indexOf(end,a)+end.length;assert.equal(source.slice(a,b),expected,'Reviewed airwar presentation source differs');}
  else if(source.includes('function frontlineAirwarTeam(')){assert.equal(source.split(helper.replaceAll('\n',eol)).length-1,1,'Unique source-matched raw airwar helper required');}
  else{const anchor='    // BEGIN NATIVE FRONTLINE CLIENT'+eol;assert.equal(source.split(anchor).length-1,1);source=source.replace(anchor,anchor+expected);}
  const naval=fs.readFileSync(new URL('./frontline_naval_visual.js',import.meta.url),'utf8').replaceAll('\r\n','\n'),nb='/* TF_NAVAL_VISUAL_BEGIN */'+eol,ne='/* TF_NAVAL_VISUAL_END */'+eol,block=nb+naval.replaceAll('\n',eol)+eol+ne;
  if(source.includes(nb)){const a=source.indexOf(nb),b=source.indexOf(ne,a)+ne.length;assert.equal(source.slice(a,b),block,'Reviewed naval visual source differs');}
  else if(source.includes('function createFrontlineNavalVisual(')){assert.equal(source.split(naval.replaceAll('\n',eol)).length-1,1,'Unique source-matched raw naval helper required');}
  else {assert.equal(source.split(begin).length-1,1,'Native helper insertion boundary required');source=source.replace(begin,block+begin);}
  return source;
}

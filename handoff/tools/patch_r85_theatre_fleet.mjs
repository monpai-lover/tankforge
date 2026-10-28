import fs from 'node:fs';
import assert from 'node:assert/strict';
import {R84_ESCORT_TERRAIN_HOOK} from './patch_r84_scale30_terrain.mjs';
const helper=fs.readFileSync(new URL('./frontline_ship_markers_r85.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
export const R85_ESCORT_TERRAIN_HOOK='        const radius=compact?Math.ceil(Math.max(...Object.values(f.map.bounds).map(Math.abs))/300)*300+300:aerial?12000:2500,step=compact?300:aerial?200:50; // TF_R85_ESCORT_TERRAIN';
const airportBegin='      function drawAirwarAirportTags(camera,w,h){\n',airportEnd='      function syncAirwarSpectator(){';
const insertion='tags.push(...TFShipMarkersR85.layout({vessels:f.vessels,camera,project,width:w,height:h,team:mine()?.team}));hud.drawLabels(tags);';
const eolOf=s=>s.includes('\r\n')&&!/(?<!\r)\n/.test(s)?'\r\n':'\n';
function unique(source,text,description){assert.equal(source.split(text).length-1,1,'Unique reviewed '+description+' required');}
// Apply after legacy R8.3/R8.4 composition. Before reapplying those composers,
// normalize this scoped change, then apply it again last. No file writes here.
export function normalizeR85TheatreFleet(source){
 const eol=eolOf(source);let s=source.replaceAll('\r\n','\n');
 if(s.includes('/* TF_SHIP_MARKERS_R85_BEGIN */')){unique(s,helper,'ship marker helper');s=s.replace(helper+'\n','');}
 if(s.includes(insertion)){unique(s,insertion,'accepted ship marker draw');s=s.replace(insertion,'hud.drawLabels(tags);');}
 if(s.includes(R85_ESCORT_TERRAIN_HOOK)){unique(s,R85_ESCORT_TERRAIN_HOOK,'R85 terrain hook');s=s.replace(R85_ESCORT_TERRAIN_HOOK,R84_ESCORT_TERRAIN_HOOK);}
 return s.replaceAll('\n',eol);
}
export function patchR85TheatreFleet(source){
 const eol=eolOf(source);let s=normalizeR85TheatreFleet(source).replaceAll('\r\n','\n');
 unique(s,R84_ESCORT_TERRAIN_HOOK,'R84 terrain hook');s=s.replace(R84_ESCORT_TERRAIN_HOOK,R85_ESCORT_TERRAIN_HOOK);
 unique(s,airportBegin,'airport/ship tag owner');const a=s.indexOf(airportBegin),b=s.indexOf(airportEnd,a);assert.ok(b>a,'Unique reviewed spectator boundary required');
 const owner=s.slice(a,b);unique(owner,'hud.drawLabels(tags);','shared HUD labels');
 s=s.slice(0,a)+helper+'\n'+owner.replace('hud.drawLabels(tags);',insertion)+s.slice(b);
 return s.replaceAll('\n',eol);
}

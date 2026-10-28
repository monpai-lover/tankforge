import {preserveR86Presentation} from './r86_presentation_state.mjs';
import fs from 'node:fs';
import {normalizeR85TheatreFleet,patchR85TheatreFleet} from './patch_r85_theatre_fleet.mjs';
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8');
function patchFrontlineTerrainWorkerBase(source){
 source=source.replaceAll('\r\n','\n');
 const r85=source.includes('/* TF_SHIP_MARKERS_R85_BEGIN */');
 if(r85)source=normalizeR85TheatreFleet(source);
 const finish=s=>r85?patchR85TheatreFleet(s):s;
 const helper=read('./frontline_terrain_worker.js').replaceAll('\r\n','\n'),client=normalizeR85TheatreFleet(read('./frontline_client.js').replaceAll('\r\n','\n'));
 const a=client.indexOf('      function rebuildTerrain(){'),b=client.indexOf('      function poseModel',a);
 if(a<0||b<a)throw Error('Missing source terrain builder boundaries');
 const section=client.slice(a,b),expected=section.slice(section.indexOf('      function rebuildTerrainImmediate(){')).replace('function rebuildTerrainImmediate(){','function rebuildTerrain(){');
 const helperBegin='/* TF_TERRAIN_WORKER_BEGIN */\n',helperEnd='/* TF_TERRAIN_WORKER_END */\n',helperBlock=helperBegin+helper+helperEnd;
 if(!source.includes('/* TF_TERRAIN_WORKER_BEGIN */')){
   const marker='  // END NATIVE FRONTLINE GLOBAL HELPERS\n';if(source.split(marker).length!==2)throw Error('Unique global boundary required');
   source=source.replace(marker,helperBlock+marker);
 }else{
   if(source.split(helperBegin).length!==2||source.split(helperEnd).length!==2)throw Error('Unique complete terrain helper boundaries required');
   const h=source.indexOf(helperBegin),e=source.indexOf(helperEnd,h)+helperEnd.length;
   if(source.slice(h,e)!==helperBlock)throw Error('Terrain helper source differs from the reviewed embedded helper');
 }
 const start=source.indexOf('      function rebuildTerrain(){'),end=source.indexOf('      function poseModel',start);if(start<0||end<start)throw Error('Missing canonical terrain boundaries');
 const previous=source.slice(start,end);if(previous!==section&&previous!==expected)throw Error('Canonical terrain source changed outside reviewed worker wrapper');
 source=source.slice(0,start)+section+source.slice(end);
 const before='frontlineDisposed=true;',after='frontlineDisposed=true;frontline.terrainWorker?.dispose();';
 if(source.includes(after))return finish(source);
 if(source.split(before).length!==2)throw Error('Missing unique terrain disposal anchor');
 source=source.replace(before,after);
 return finish(source);
}

export function patchFrontlineTerrainWorker(source){return preserveR86Presentation(source,patchFrontlineTerrainWorkerBase);}

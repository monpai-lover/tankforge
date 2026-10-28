import {preserveR86Presentation} from './r86_presentation_state.mjs';
import fs from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {applyR83AirwarFixes} from './apply_r83_airwar_fixes.mjs';
import {patchMinimapLabelsR84} from './patch_minimap_labels_r84.mjs';
import {patchR84Scale30Terrain} from './patch_r84_scale30_terrain.mjs';
import {normalizeR85TheatreFleet,patchR85TheatreFleet} from './patch_r85_theatre_fleet.mjs';
function applyR84AirwarFixesBase(source){const r85=source.includes('/* TF_SHIP_MARKERS_R85_BEGIN */');if(r85)source=normalizeR85TheatreFleet(source);const result=patchMinimapLabelsR84(patchR84Scale30Terrain(applyR83AirwarFixes(source)));return r85?patchR85TheatreFleet(result):result;}
export function applyR84AirwarFixes(source){return preserveR86Presentation(source,applyR84AirwarFixesBase);}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const app=new URL('../bundle/app.js.html',import.meta.url),source=fs.readFileSync(app,'utf8'),output=applyR84AirwarFixes(source);
 if(process.argv.includes('--write'))fs.writeFileSync(app,output);
 else if(process.argv.includes('--check')){if(source!==output)throw Error('Current bundle requires R8.4 source patches');}
 else if(process.argv[2])fs.writeFileSync(process.argv[2],output);
 else throw Error('Use --write, --check, or a new candidate output path');
}

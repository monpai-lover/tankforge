import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {applyR82AirwarFixes} from './apply_r82_airwar_fixes.mjs';
import {applyR84AirwarFixes} from './apply_r84_airwar_fixes.mjs';
import {normalizeR85TheatreFleet,patchR85TheatreFleet} from './patch_r85_theatre_fleet.mjs';
import {patchR85Loadout} from './patch_r85_loadout.mjs';
import {patchR85ClientStateQueries} from './patch_r85_client_state_queries.mjs';
import {patchR85Water} from './patch_r85_water.mjs';
export function applyR85AirwarFixes(source){
 const base=normalizeR85TheatreFleet(source);
 return patchR85TheatreFleet(patchR85Water(patchR85ClientStateQueries(patchR85Loadout(applyR84AirwarFixes(applyR82AirwarFixes(base))))));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const file=new URL('../bundle/app.js.html',import.meta.url),source=fs.readFileSync(file,'utf8'),result=applyR85AirwarFixes(source);
 if(process.argv.includes('--write'))fs.writeFileSync(file,result);
 else if(process.argv.includes('--check')){if(source!==result)throw Error('Current bundle requires R8.5 source patches');}
 else if(process.argv[2])fs.writeFileSync(process.argv[2],result,{flag:'wx'});
 else throw Error('Use --write, --check or a new output path');
}

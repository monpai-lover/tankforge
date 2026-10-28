import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {applyR85AirwarFixes} from './apply_r85_airwar_fixes.mjs';
import {normalizeR86Presentation} from './r86_presentation_state.mjs';
import {patchR86Water} from './patch_r86_water.mjs';
import {patchR86AirwarHud} from './patch_r86_airwar_hud.mjs';
import {patchR86Clouds} from './patch_r86_clouds.mjs';

export function applyR86AirwarFixes(source){
  const base=applyR85AirwarFixes(normalizeR86Presentation(source));
  return patchR86Clouds(patchR86Water(patchR86AirwarHud(base)));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const file=new URL('../bundle/app.js.html',import.meta.url);
  const source=fs.readFileSync(file,'utf8'),result=applyR86AirwarFixes(source);
  if(process.argv.includes('--write'))fs.writeFileSync(file,result);
  else if(process.argv.includes('--check')){if(source!==result)throw Error('Current bundle requires R8.6 source patches');}
  else if(process.argv[2])fs.writeFileSync(process.argv[2],result,{flag:'wx'});
  else throw Error('Use --write, --check or a new output path');
}

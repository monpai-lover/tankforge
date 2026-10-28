import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {patchNativeAirEffectsFrame} from './patch_native_air_effects_frame.mjs';
import {patchNativeGunTracers} from './patch_native_gun_tracers.mjs';
import {patchTaiwanAirwarPresentation} from './patch_taiwan_airwar_presentation.mjs';
import {patchSovietConventionalStores} from './patch_soviet_conventional_stores.mjs';
import {patchMinimapLabelsR84,normalizeMinimapLabelsR84Draw} from './patch_minimap_labels_r84.mjs';
import {normalizeR85TheatreFleet,patchR85TheatreFleet} from './patch_r85_theatre_fleet.mjs';
export function applyR83AirwarFixes(source){const r85=source.includes('/* TF_SHIP_MARKERS_R85_BEGIN */');if(r85)source=normalizeR85TheatreFleet(source);const r84=source.includes('/* TF_MINIMAP_AIRPORT_LABELS_R84_DRAW */');const base=r84?normalizeMinimapLabelsR84Draw(source):source;let result=patchSovietConventionalStores(patchTaiwanAirwarPresentation(patchNativeGunTracers(patchNativeAirEffectsFrame(base))));if(r84)result=patchMinimapLabelsR84(result);return r85?patchR85TheatreFleet(result):result;}
const app=new URL('../bundle/app.js.html',import.meta.url);
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(process.argv.includes('--write'))fs.writeFileSync(app,applyR83AirwarFixes(fs.readFileSync(app,'utf8')));
 else if(process.argv.includes('--check')){if(applyR83AirwarFixes(fs.readFileSync(app,'utf8'))!==fs.readFileSync(app,'utf8'))throw Error('Current bundle needs R8.3 source patches');}
 else if(process.argv[2])fs.writeFileSync(process.argv[2],applyR83AirwarFixes(fs.readFileSync(app,'utf8')));
}

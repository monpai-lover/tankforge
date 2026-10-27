import fs from 'node:fs';
import {patchNativeAirEffectsFrame} from './patch_native_air_effects_frame.mjs';
import {patchNativeGunTracers} from './patch_native_gun_tracers.mjs';
import {patchTaiwanAirwarPresentation} from './patch_taiwan_airwar_presentation.mjs';
import {patchSovietConventionalStores} from './patch_soviet_conventional_stores.mjs';
export function applyR83AirwarFixes(source){return patchSovietConventionalStores(patchTaiwanAirwarPresentation(patchNativeGunTracers(patchNativeAirEffectsFrame(source))));}
const app=new URL('../bundle/app.js.html',import.meta.url);
if(process.argv.includes('--write'))fs.writeFileSync(app,applyR83AirwarFixes(fs.readFileSync(app,'utf8')));
else if(process.argv.includes('--check')){if(applyR83AirwarFixes(fs.readFileSync(app,'utf8'))!==fs.readFileSync(app,'utf8'))throw Error('Current bundle needs R8.3 source patches');}
else if(process.argv[2])fs.writeFileSync(process.argv[2],applyR83AirwarFixes(fs.readFileSync(app,'utf8')));

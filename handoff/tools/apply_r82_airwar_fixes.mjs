// Exact, idempotent source-owned runtime patches. Combat WASM is synchronized
// separately by sync_design_core.mjs after a source-matched native build.
import fs from 'node:fs';
import {patchAircraftFuelLoadHelper} from './patch_aircraft_fuel_load.mjs';
import {patchNativeInventoryHistory} from './patch_native_inventory_history.mjs';
import {patchFrontlineTerrainWorker} from './patch_frontline_terrain_worker.mjs';
import {patchLargeWorldRender} from './patch_large_world_render.mjs';
import {patchNativeGuidedWeaponSelection} from './patch_native_guided_weapon_selection.mjs';
import {patchFrontlineCountermeasures} from './frontline_countermeasures_patch.mjs';
const app=new URL('../bundle/app.js.html',import.meta.url);
export function applyR82AirwarFixes(source){return patchFrontlineCountermeasures(patchNativeGuidedWeaponSelection(patchLargeWorldRender(patchFrontlineTerrainWorker(patchNativeInventoryHistory(patchAircraftFuelLoadHelper(source))))));}
if(process.argv.includes('--write'))fs.writeFileSync(app,applyR82AirwarFixes(fs.readFileSync(app,'utf8')));
else if(process.argv.includes('--check')){if(applyR82AirwarFixes(fs.readFileSync(app,'utf8'))!==fs.readFileSync(app,'utf8'))throw Error('Current bundle needs R8.2 source patches');}
else if(process.argv[2])fs.writeFileSync(process.argv[2],applyR82AirwarFixes(fs.readFileSync(app,'utf8')));

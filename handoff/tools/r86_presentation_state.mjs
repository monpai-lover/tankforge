import {normalizeR86Water,patchR86Water} from './patch_r86_water.mjs';
import {normalizeR86AirwarHud,patchR86AirwarHud} from './patch_r86_airwar_hud.mjs';
import {normalizeR86Clouds,patchR86Clouds} from './patch_r86_clouds.mjs';

/** Normalize only installed, exact R86 owners before older guarded patchers run. */
export function normalizeR86Presentation(source){
  let result=source;
  if(result.includes('TF_R86_CLOUDS_BEGIN'))result=normalizeR86Clouds(result);
  if(result.includes('// TF_R86_WATER_BEGIN'))result=normalizeR86Water(result);
  if(result.includes('/* TF_R86_AIRWAR_HUD_BEGIN */'))result=normalizeR86AirwarHud(result);
  return result;
}

/** An old owner may refresh its own source without erasing a newer presentation. */
export function preserveR86Presentation(source,compose){
  const water=source.includes('// TF_R86_WATER_BEGIN');
  const hud=source.includes('/* TF_R86_AIRWAR_HUD_BEGIN */');
  const clouds=source.includes('TF_R86_CLOUDS_BEGIN');
  let result=compose(normalizeR86Presentation(source));
  if(hud)result=patchR86AirwarHud(result);
  if(water)result=patchR86Water(result);
  if(clouds)result=patchR86Clouds(result);
  return result;
}

import assert from 'node:assert/strict';
export const R84_ESCORT_TERRAIN_HOOK='        const radius=compact?Math.ceil(Math.max(...Object.values(f.map.bounds).map(Math.abs))/200)*200+200:aerial?12000:2500,step=compact?100:aerial?200:50; // TF_R84_ESCORT_TERRAIN';
export function patchR84Scale30Terrain(source){
 const old='        const radius=compact?3600:aerial?12000:2500,step=compact?50:aerial?200:50;';
 if(source.includes(R84_ESCORT_TERRAIN_HOOK)){assert.equal(source.split(R84_ESCORT_TERRAIN_HOOK).length-1,1);return source;}
 assert.equal(source.split(old).length-1,1,'One reviewed escort terrain extent required');return source.replace(old,R84_ESCORT_TERRAIN_HOOK);
}

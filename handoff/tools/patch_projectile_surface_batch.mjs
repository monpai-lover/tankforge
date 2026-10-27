import fs from 'node:fs';
import assert from 'node:assert/strict';
const marker='// TF_PROJECTILE_SURFACE_BATCH_20261026';
const helper=fs.readFileSync(new URL('./projectile_surface_batch.js',import.meta.url),'utf8');
export function patchProjectileSurfaceBatch(source){
 let text=source.replace(/\r\n/g,'\n');
 const endMarker='// TF_PROJECTILE_SURFACE_BATCH_END_20261026';
 const block=marker+'\n'+helper+'\nvar TFProjectileSurfaceBatch=createProjectileSurfaceBatch(surfaceCollisionQuery);\nsurfaceCollisionQuery=TFProjectileSurfaceBatch.query;\n'+endMarker+'\n';
 if(text.includes(marker)){
  const a=text.indexOf(marker),b=text.indexOf(endMarker,a);assert.ok(b>a,'Complete projectile batch owner required');
  for(const name of ['updateShots','updateBullets'])assert.equal(text.split('return TFProjectileSurfaceBatch.run(G4.combat,()=>'+name+'ExactPhase(dt));').length-1,1,'One exact phase wrapper');
  assert.equal(text.split('      M2.poseSerial = (M2.poseSerial || 0) + 1;\n      const ss = G4.ss;').length-1,1,'Local pose owner hook required');
  return text.slice(0,a)+block+text.slice(b+endMarker.length).replace(/^\n/,'');
 }
 const anchor='  // END SURFACE COLLISION READINESS\n';assert.equal(text.split(anchor).length-1,1);
 text=text.replace(anchor,anchor+block);
 for(const name of ['updateShots','updateBullets']){
  const header='    function '+name+'(dt) {';assert.equal(text.split(header).length-1,1,'One synchronous projectile owner '+name);
  text=text.replace(header,header+'\n      return TFProjectileSurfaceBatch.run(G4.combat,()=>'+name+'ExactPhase(dt));\n    }\n    function '+name+'ExactPhase(dt) {');
 }
 const own='      const M2 = G4.model;\n      const ss = G4.ss;';
 assert.equal(text.split(own).length-1,1,'One local model pose boundary');
 text=text.replace(own,'      const M2 = G4.model;\n      M2.poseSerial = (M2.poseSerial || 0) + 1;\n      const ss = G4.ss;');
 return text;
}

import assert from 'node:assert/strict';
const edits=[
 ['    syncTouch(air,dt);pilotStep(air,dt);systems(air,dt);audio(air,dt);effects(air,dt);','    syncTouch(air,dt);pilotStep(air,dt);systems(air,dt);audio(air,dt);'],
 ['  function intent() {\n    if (!air?.active || !air.nativeIntent)',
  '  // Immediate flame/cone geometry belongs to the pose actually being drawn.\n  // Controls continue while the GPU is busy without queuing old attachments.\n  function present(dt) { if (air?.active) effects(air,dt); }\n  function intent() {\n    if (!air?.active || !air.nativeIntent)'],
 ['  return {bind,unbind,step,intent,consumeIntent,','  return {bind,unbind,step,present,intent,consumeIntent,'],
 ['    view:(dt)=>bridge.view(dt,height),draw:(m,w,h)=>bridge.draw(m,w,h),getair:bridge.getair,','    present:(dt)=>bridge.present(dt),view:(dt)=>bridge.view(dt,height),draw:(m,w,h)=>bridge.draw(m,w,h),getair:bridge.getair,'],
 ['        fx.update(dt);','        fx.update(dt);if(current?.aircraft)f.establishedFlight.present(dt);']
];
export function patchNativeAirEffectsFrame(source){
 for(let [before,after]of edits){
  if(source.includes('\r\n')&&!/(?<!\r)\n/.test(source)){before=before.replaceAll('\n','\r\n');after=after.replaceAll('\n','\r\n');}
  // A replacement can be a prefix of the old text (the control-only step is
  // exactly that). Inspect the complete old call first; substring presence of
  // the shorter replacement cannot prove that effects have been removed.
  const oldCount=source.split(before).length-1,nextCount=source.split(after).length-1;
  if(before.startsWith(after)&&before!==after&&oldCount){assert.equal(oldCount,1,'Unique source-owned native FX hook required');source=source.replace(before,after);continue;}
  if(nextCount){assert.equal(nextCount,1,'One drawn-frame FX hook required');continue;}
  assert.equal(oldCount,1,'Unique source-owned native FX hook required');source=source.replace(before,after);
 }
 return source;
}

import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

test('narrow limits injection is idempotent and keeps the current production script parseable',async()=>{
  const {patchAirframeLimits}=await import('../tools/sync_airframe_limits.mjs');
  const source=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
  const next=patchAirframeLimits(source);assert.equal(patchAirframeLimits(next),next);
  assert.doesNotThrow(()=>new vm.Script(next.slice(next.indexOf('<script>')+8,next.lastIndexOf('</script>'))));
  assert.match(next,/api\.core_version\(\) !== 215/);
  for(const marker of ['LOCAL_STEP','BEGIN_POSE','POSE','NEW_LIFE','PRIVATE_ACCEPT','PUBLIC_ACCEPT','PUBLIC_CONTACT','HUD_WARNING','INFO'])assert.equal(next.split(`TF_AIRFRAME_LIMITS_${marker}`).length,2,marker);
  for(const anchor of ['var TFMechanismFit','function stepPlayerAircraftPilot','function createFrontlineExistingRuntime'])assert.ok(next.includes(anchor));
  assert.ok(!next.includes('sourcebuild'),'Current production page is patched in place');
});

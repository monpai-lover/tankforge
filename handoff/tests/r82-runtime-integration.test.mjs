import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyR82AirwarFixes} from '../tools/apply_r82_airwar_fixes.mjs';
const original=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
test('composed runtime patch is exact, idempotent and preserves the current countermeasure/guided extensions',()=>{
 const patched=applyR82AirwarFixes(original);assert.equal(applyR82AirwarFixes(patched),patched);
 new vm.Script(patched.slice(patched.indexOf('<script>')+8,patched.lastIndexOf('</script>')));
 for(const anchor of ['TFNativeCMVisual.clear();frontline.ordnancePresentation.dispose()','TFNativeCMVisual.write(','createFrontlineGuidedControl','_renderCamera = cam','referenceThrottle:1','historyKey:p','createFrontlineTerrainWorker({f,renderer'])assert.ok(patched.includes(anchor),anchor);
 for(const marker of ['/* TF_RENDER_PRECISION_BEGIN */','/* TF_TERRAIN_WORKER_BEGIN */','frontline.terrainWorker?.dispose();'])assert.equal(patched.split(marker).length,2,marker);
});

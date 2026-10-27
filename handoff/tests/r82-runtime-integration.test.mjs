import {patchFrontlineTerrainWorker} from '../tools/patch_frontline_terrain_worker.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyR82AirwarFixes} from '../tools/apply_r82_airwar_fixes.mjs';
const original=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
test('composed runtime patch is exact, idempotent and preserves the current countermeasure/guided extensions',()=>{
 const patched=applyR82AirwarFixes(original);assert.equal(applyR82AirwarFixes(patched),patched);
 new vm.Script(patched.slice(patched.indexOf('<script>')+8,patched.lastIndexOf('</script>')));
 const disposal=patched.match(/frontline\.dispose=\(\)=>\{([^\n]+)\};/);assert.ok(disposal,'Actual lifecycle owner must remain installed');
 for(const call of ['TFNativeCMVisual.clear();','frontline.ordnancePresentation.dispose();'])assert.equal(disposal[1].split(call).length,2,'Actual disposal owns exactly one '+call);
 assert.ok(disposal[1].indexOf('TFNativeCMVisual.clear();')<disposal[1].indexOf('frontline.ordnancePresentation.dispose();'),'Countermeasure cleanup precedes ordnance cleanup despite intervening presentation owners');
 for(const anchor of ['TFNativeCMVisual.clear()','TFNativeCMVisual.write(','createFrontlineGuidedControl','_renderCamera = cam','referenceThrottle:1','historyKey:p','createFrontlineTerrainWorker({f,renderer'])assert.ok(patched.includes(anchor),anchor);
 for(const marker of ['/* TF_RENDER_PRECISION_BEGIN */','/* TF_TERRAIN_WORKER_BEGIN */','frontline.terrainWorker?.dispose();'])assert.equal(patched.split(marker).length,2,marker);
});


test('terrain worker composition supports LF/CRLF while retaining complete owned-block integrity',()=>{
 const lf=original.replaceAll('\r\n','\n'),normalized=patchFrontlineTerrainWorker(lf);
 assert.equal(patchFrontlineTerrainWorker(lf.replaceAll('\n','\r\n')),normalized);
 assert.equal(patchFrontlineTerrainWorker(normalized),normalized);
 const begin='/* TF_TERRAIN_WORKER_BEGIN */\n',end='/* TF_TERRAIN_WORKER_END */\n';
 assert.equal(normalized.split(begin).length,2);assert.equal(normalized.split(end).length,2);
 assert.throws(()=>patchFrontlineTerrainWorker(normalized.replace(end,'')),/Unique complete terrain helper boundaries/);
 assert.throws(()=>patchFrontlineTerrainWorker(normalized.replace(begin,begin+'// changed owned helper\n')),/helper source differs/);
});

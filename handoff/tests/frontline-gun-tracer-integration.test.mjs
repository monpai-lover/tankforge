import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=name=>fs.readFileSync(new URL('../tools/'+name,import.meta.url),'utf8');
const path=new URL('../tools/patch_native_gun_tracers.mjs',import.meta.url);
test('the actual client accepts native samples and owns every tracer lifecycle',()=>{
 const source=read('frontline_client.js');
 for(const call of ['f.gunTracerPresentation=createFrontlineGunTracerVisual({fx})','f.gunTracerPresentation.accept(','f.gunTracerPresentation.clear()','frontline.gunTracerPresentation.dispose()'])assert.ok(source.includes(call),call);
 const start=source.indexOf('      function frame(dt){'),frame=source.slice(start,source.indexOf('      return Object.assign(f,',start));
 assert.ok(frame.includes('f.gunTracerPresentation.step(dt,camera.pos);'));
 assert.ok(frame.indexOf('f.gunTracerPresentation.step(')>frame.indexOf('renderGate.ready()'));
 assert.ok(frame.indexOf('f.gunTracerPresentation.step(')>frame.indexOf('camera={pos:eye'));
 assert.ok(frame.indexOf('f.gunTracerPresentation.step(')<frame.indexOf('fx.build(camera)'));
 assert.ok(!read('frontline_gun_tracer_visual.js').includes('G4.bullets'));
});
test('the narrow canonical patch preserves line endings, composes with drawn-frame FX, and is idempotent',async()=>{
 assert.ok(fs.existsSync(path),'guarded native tracer patch must exist');const {patchNativeGunTracers}=await import(path);
 for(const eol of ['\n','\r\n']){
   const native=read('frontline_client.js').replaceAll('\r\n','\n');
   const original=('prefix\n    // BEGIN NATIVE FRONTLINE CLIENT\n'+native+'\n    // END NATIVE FRONTLINE CLIENT\nsuffix').replaceAll('\n',eol);
   const patched=patchNativeGunTracers(original);assert.equal(patchNativeGunTracers(patched),patched);
   assert.equal(patched.split('function createFrontlineGunTracerVisual(').length-1,1);
   assert.equal(patched.split('f.gunTracerPresentation.step(dt,camera.pos);').length-1,1);
   const reset=patched.slice(patched.indexOf('      function resetBattlePresentation(){'),patched.indexOf('      function send(command)'));assert.equal(reset.split('f.gunTracerPresentation.clear();').length-1,1,'composed battlefield cleanup must not duplicate tracer reset');
   assert.match(patched,/fx\.update\(dt\);if\(current\?\.aircraft\)f\.establishedFlight\.present\(dt\);f\.gunTracerPresentation\.step\(dt,camera\.pos\);(?:f\.airportPresentation\.draw\(camera\.pos\);)?fx\.build\(camera\)/);
   assert.ok(patched.startsWith('prefix'+eol)&&patched.endsWith(eol+'suffix'));
   if(eol==='\r\n')assert.equal(/(?<!\r)\n/.test(patched),false);
   assert.throws(()=>patchNativeGunTracers(original.replace('frontline.ordnancePresentation.dispose();','frontline.ordnancePresentation.MOVED();')),/Unique/);
 }
});

test('upgrading the installed canonical CM cleanup preserves it and inserts each missing tracer hook once',async()=>{
 const {patchNativeGunTracers}=await import(path);
 let baseline=read('frontline_client.js').replaceAll('\r\n','\n');
 baseline=baseline.replace('      f.gunTracerPresentation=createFrontlineGunTracerVisual({fx});\n','').replace('        f.gunTracerPresentation.clear();\n','').replaceAll('f.gunTracerPresentation.clear();','').replace(/^.*f\.gunTracerPresentation\.accept\(.*\n/m,'').replace('frontline.gunTracerPresentation.dispose();','').replace('f.gunTracerPresentation.step(dt,camera.pos);','');
 assert.ok(!baseline.includes('gunTracerPresentation'));
 baseline=baseline.replace("if(m.op==='left'){f.ordnancePresentation.clear();", "if(m.op==='left'){TFNativeCMVisual.clear();f.ordnancePresentation.clear();");
 const wrapped='    // BEGIN NATIVE FRONTLINE CLIENT\n'+baseline+'\n    // END NATIVE FRONTLINE CLIENT\n';
 const result=patchNativeGunTracers(wrapped);
 assert.ok(result.includes("if(m.op==='left'){TFNativeCMVisual.clear();f.ordnancePresentation.clear();f.gunTracerPresentation.clear();f.missiles=[];}"));
 for(const token of ['f.gunTracerPresentation=createFrontlineGunTracerVisual({fx})','f.gunTracerPresentation.accept(','frontline.gunTracerPresentation.dispose()','f.gunTracerPresentation.step(dt,camera.pos);'])assert.equal(result.split(token).length-1,1,token);
 assert.equal(patchNativeGunTracers(result),result);
});
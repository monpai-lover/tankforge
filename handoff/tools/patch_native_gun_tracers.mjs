import fs from 'node:fs';
import assert from 'node:assert/strict';
const helper=fs.readFileSync(new URL('./frontline_gun_tracer_visual.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const edits=[
 ['      f.ordnancePresentation=createFrontlineOrdnanceVisual({Node,storeMesh,storeDefs:AIR_STORE_DEFS,quatMatrix,aqLook,fx});f.root.add(f.ordnancePresentation.root);','      f.ordnancePresentation=createFrontlineOrdnanceVisual({Node,storeMesh,storeDefs:AIR_STORE_DEFS,quatMatrix,aqLook,fx});f.root.add(f.ordnancePresentation.root);\n      f.gunTracerPresentation=createFrontlineGunTracerVisual({fx});'],
 ['        f.ordnancePresentation.clear();f.missiles=[];','        f.gunTracerPresentation.clear();\n        f.ordnancePresentation.clear();f.missiles=[];'],
 ["        if(m.op==='left'){f.ordnancePresentation.clear();f.missiles=[];}","        if(m.op==='left'){f.ordnancePresentation.clear();f.gunTracerPresentation.clear();f.missiles=[];}"],
 ['          f.ordnancePresentation.accept(f.missiles,{battle:m.battle??f.room?.battle,tick:m.tick??f.lastTick});','          f.ordnancePresentation.accept(f.missiles,{battle:m.battle??f.room?.battle,tick:m.tick??f.lastTick});\n          f.gunTracerPresentation.accept(Array.isArray(m.tracers)?m.tracers:[],{battle:m.battle??f.room?.battle,tick:m.tick??f.lastTick});'],
 ['frontline.ordnancePresentation.dispose();','frontline.ordnancePresentation.dispose();frontline.gunTracerPresentation.dispose();'],
 ['fx.build(camera);','f.gunTracerPresentation.step(dt,camera.pos);fx.build(camera);']
];
export function patchNativeGunTracers(source){
 const eol=source.includes('\r\n')&&!/(?<!\r)\n/.test(source)?'\r\n':'\n';
 const start='    // BEGIN NATIVE FRONTLINE CLIENT'+eol,end='    // END NATIVE FRONTLINE CLIENT'+eol;
 assert.equal(source.split(start).length-1,1,'Unique native client start required');assert.equal(source.split(end).length-1,1,'Unique native client end required');
 const a=source.indexOf(start)+start.length,b=source.indexOf(end,a);assert.ok(b>=a,'Native client boundary order');
 let block=source.slice(a,b).replaceAll('\r\n','\n');
 const begin='/* TF_NATIVE_GUN_TRACERS_BEGIN */\n',finish='/* TF_NATIVE_GUN_TRACERS_END */\n',expected=begin+helper+'\n'+finish;
 if(block.includes(begin)){
   assert.equal(block.split(begin).length-1,1,'Unique tracer helper start required');assert.equal(block.split(finish).length-1,1,'Unique tracer helper end required');
   const h=block.indexOf(begin),j=block.indexOf(finish,h)+finish.length;assert.equal(block.slice(h,j),expected,'Reviewed tracer helper differs');
 }else{
   const existing=block.includes('function createFrontlineGunTracerVisual(');
   if(existing){assert.equal(block.split(helper).length-1,1,'Unique source-matched tracer helper required');}
   else block=expected+block;
 }
 for(let [before,after]of edits){
   if(before==='fx.build(camera);'&&block.includes('f.gunTracerPresentation.step(dt,camera.pos);')){
     assert.equal(block.split('f.gunTracerPresentation.step(dt,camera.pos);').length-1,1,'One native tracer draw required');
     assert.ok(/f\.gunTracerPresentation\.step\(dt,camera\.pos\);(?:f\.airportPresentation\.draw\(camera\.pos\);)?fx\.build\(camera\);/.test(block),'Reviewed draw-phase tracer/airport ordering');continue;
   }
   // The installed countermeasure owner has its own leave cleanup here.
   // Preserve that exact reviewed extension while adding the tracer cleanup.
   if(before.startsWith("        if(m.op==='left'){")&&block.includes("        if(m.op==='left'){TFNativeCMVisual.clear();")){
     before=before.replace("if(m.op==='left'){","if(m.op==='left'){TFNativeCMVisual.clear();");
     after=after.replace("if(m.op==='left'){","if(m.op==='left'){TFNativeCMVisual.clear();");
   }
   const n=block.split(after).length-1;if(n){assert.equal(n,1,'Unique installed native tracer hook required');continue;}
   assert.equal(block.split(before).length-1,1,'Unique source-owned native tracer hook required');block=block.replace(before,after);
 }
 if(eol==='\r\n')block=block.replaceAll('\n',eol);
 return source.slice(0,a)+block+source.slice(b);
}

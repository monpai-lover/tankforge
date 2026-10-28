import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const read=name=>fs.readFileSync(new URL('../tools/'+name,import.meta.url),'utf8');
const helperPath=new URL('../tools/frontline_ship_markers_r85.js',import.meta.url);
function api(){assert.ok(fs.existsSync(helperPath),'R85 accepted-snapshot ship marker helper required');const context=vm.createContext({});vm.runInContext(fs.readFileSync(helperPath,'utf8'),context);return context.TFShipMarkersR85;}
const ship=(extra={})=>({id:'blue-transport-1',model:'generic_transport',role:'transport',team:0,alive:true,pos:[100,0,100],unit:{battle:2,unit:10,life:1},...extra});
const view={camera:{pos:[0,650,0],viewProj:[]},width:1280,height:720,project:()=>[0,0,1],team:0};
test('overhead hints name native ship class, team and metric camera distance without mutating accepted rows',()=>{
 const owner=api(),vessels=[ship(),ship({id:'red-frigate-1',team:1,model:'generic_frigate',pos:[1000,0,0],unit:{battle:2,unit:11,life:1}})],before=JSON.stringify(vessels);
 const tags=owner.layout({...view,vessels});assert.equal(tags.length,2);assert.match(tags[0].text,/蓝方.*运输.*0\.7 km/);assert.match(tags[1].text,/红方.*护卫.*1\.2 km/);assert.equal(tags[0].crew,true);assert.equal(tags[1].crew,false);assert.equal(JSON.stringify(vessels),before);
});
test('markers use only provided permitted snapshots and hide dead, malformed, behind-camera, remote and offscreen ships',()=>{
 const owner=api();assert.equal(owner.layout({...view,vessels:[]}).length,0);
 for(const row of [ship({alive:false}),ship({pos:[NaN,0,0]}),ship({pos:[10001,0,0]}),ship({team:3})])assert.equal(owner.layout({...view,vessels:[row]}).length,0);
 for(const projected of [[0,0,-1],[1.1,0,1],[0,-1.1,1],[NaN,0,1]])assert.equal(owner.layout({...view,project:()=>projected,vessels:[ship()]}).length,0);
});
test('fourteen ship hints remain bounded, deterministic, unique and disappear when omitted from the next snapshot',()=>{
 const owner=api(),vessels=Array.from({length:14},(_,i)=>ship({id:'blue-escort-'+i,model:'generic_escort',unit:{battle:2,unit:i+1,life:1},pos:[i*20,0,0]}));
 const tags=owner.layout({...view,vessels});assert.equal(tags.length,14);assert.equal(new Set(tags.map(t=>t.text)).size,14);assert.deepEqual(owner.layout({...view,vessels}),tags);assert.equal(owner.layout({...view,vessels:[vessels[0]]}).length,1);
 assert.equal(owner.layout({...view,vessels:[vessels[0],vessels[0]]}).length,1);assert.equal(owner.layout({...view,width:NaN,vessels}).length,0);
});
test('markers accept numeric typed camera and projection vectors from rendering owners',()=>{
 const owner=api();assert.equal(owner.layout({...view,camera:{pos:new Float64Array([0,650,0]),viewProj:[]},project:()=>new Float64Array([0,0,1]),vessels:[ship()]}).length,1);
});
test('actual blue/red member team strings preserve friendly and hostile shared HUD hint colors',()=>{
 const owner=api();
 for(const [memberTeam,nativeTeam] of [['blue',0],['red',1]]){
  const own=ship({team:nativeTeam}),enemy=ship({id:'enemy-1',team:1-nativeTeam,unit:{battle:2,unit:11,life:1}});
  const tags=owner.layout({...view,team:memberTeam,vessels:[own,enemy]});assert.equal(tags[0].crew,true,'own '+memberTeam+' vessel should receive friendly HUD styling');assert.equal(tags[1].crew,false,'opposing vessel should retain hostile HUD styling');
 }
 assert.equal(owner.layout({...view,team:undefined,vessels:[ship()]} )[0].crew,false,'an observer without a team must not invent a friendly side');
});
test('guarded R85 patch composes with existing owners, preserves minimap and provides legacy normalizer',async()=>{
 const modulePath=new URL('../tools/patch_r85_theatre_fleet.mjs',import.meta.url);assert.ok(fs.existsSync(modulePath),'R85 guarded theatre and tag composition required');const {patchR85TheatreFleet,normalizeR85TheatreFleet,R85_ESCORT_TERRAIN_HOOK}=await import(modulePath);
 const actual=normalizeR85TheatreFleet(read('frontline_client.js')).replaceAll('\r\n','\n');
 for(const eol of ['\n','\r\n']){
  const source=actual.replaceAll('\n',eol),patched=patchR85TheatreFleet(source);assert.equal(patchR85TheatreFleet(patched),patched);assert.equal(normalizeR85TheatreFleet(patched),source);assert.equal(patched.split(R85_ESCORT_TERRAIN_HOOK).length-1,1);assert.equal(patched.split('var TFShipMarkersR85=').length-1,1);assert.equal(patched.split('tags.push(...TFShipMarkersR85.layout(').length-1,1);
  const beforeMap=source.slice(source.indexOf('      function drawMap(){'),source.indexOf('      function transmitInput(){'));
  const afterMap=patched.slice(patched.indexOf('      function drawMap(){'),patched.indexOf('      function transmitInput(){'));assert.equal(afterMap,beforeMap,'188px minimap frame/location/radius/drawing remain byte-identical');new vm.Script(patched);
  assert.throws(()=>patchR85TheatreFleet(source.replace('hud.drawLabels(tags);','hud.unknownTags(tags);')),/reviewed|Unique/);
  if(eol==='\r\n')assert.equal(/(?<!\r)\n/.test(patched),false);
 }
});
test('theatre grid covers expanded bounds at bounded cost while metric runway details stay separate',async()=>{
 const modulePath=new URL('../tools/patch_r85_theatre_fleet.mjs',import.meta.url);assert.ok(fs.existsSync(modulePath));const {R85_ESCORT_TERRAIN_HOOK}=await import(modulePath),map=JSON.parse(fs.readFileSync(new URL('../../data/frontline/taiwan-escort.json',import.meta.url)));
 assert.match(R85_ESCORT_TERRAIN_HOOK,/step=compact\?300/);const radius=Math.ceil(Math.max(...Object.values(map.bounds).map(Math.abs))/300)*300+300;
 assert.ok(radius>=Math.max(...Object.values(map.bounds).map(Math.abs)));assert.ok((2*radius/300)**2*6<210000,'bounded full theatre triangles');
 assert.ok(read('frontline_client.js').includes('f.airportPresentation.draw(camera.pos)'));
});

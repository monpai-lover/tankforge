import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyR83AirwarFixes} from '../tools/apply_r83_airwar_fixes.mjs';
const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
test('guarded source patch composes once while keeping installed countermeasures, guidance and large-world rendering',()=>{
 const output=applyR83AirwarFixes(app);assert.ok(applyR83AirwarFixes(output)===output,'R8.3 composition must be idempotent');
 for(const marker of ['TFNativeCMVisual','createFrontlineTerrainWorker','uModelViewProj','createFrontlineGuidedControl','createFrontlineNavalVisual','frontlineAirwarSpectator','frontlineAirwarAirportLayout'])assert.ok(output.includes(marker),marker);
 assert.throws(()=>applyR83AirwarFixes(app.replace(/const controlled=\(\)=>allUnits\(\)\.find\(u=>(?:u\.alive&&)?same\(u\.unit,f\.control\)\);/,'const controlled=MOVED;')),/Unique/);
 const begin=output.indexOf('<script>')+8,end=output.lastIndexOf('</script>');assert.ok(begin>7&&end>begin);new vm.Script(output.slice(begin,end));
});
test('source receive and draw owners consume ships, mission, airports and automatic friendly spectating',()=>{
 const client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8'),lobby=fs.readFileSync(new URL('../tools/frontline_shared_lobby.js',import.meta.url),'utf8');
 for(const hook of ['m.vessels','m.naval_geometry_catalog','m.scenario','f.navalPresentation.accept','syncAirwarSpectator();','frontlineAirwarMapView(f.focus,w,h)','frontlineAirwarNearby','f.airportPresentation.draw(camera.pos)','f.navalPresentation.clear()'])assert.ok(client.includes(hook),hook);
 assert.ok(client.includes("m.reason==='controlled_loss')f.lossPending=true"));assert.ok(lobby.includes('frontline.spectating?.()'));
 assert.ok(lobby.includes("nativeMap='taiwan-escort'"));
 const draw=client.slice(client.indexOf('      function frame(dt){'));assert.ok(draw.indexOf('f.airportPresentation.draw(')>draw.indexOf('renderGate.ready()'));
 assert.ok(client.includes("focus:f.map.scenario==='taiwan_landing_escort'?[0,0,0]:f.focus"),'compact map terrain is cached for the complete theatre');
});

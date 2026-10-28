import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {patchAircraftFuelLoad,patchFrontlineFuelClient} from '../tools/patch_aircraft_fuel_load.mjs';
import {patchR85Loadout,patchR85LoadoutClient} from '../tools/patch_r85_loadout.mjs';

const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const current=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const countGuard="        if(custom_counts!==undefined){if(cfg.custom===undefined)deny('自订数量必须对应自订挂点配置');cfg.custom_counts=customCountChoice(id,cfg.custom,custom_counts);}\n";
const oldClient=current
 .replace('configuration(id,{loadout,custom,custom_counts,fuel_minutes}', 'configuration(id,{loadout,custom,fuel_minutes}')
 .replace(countGuard,'')
 .replace('deployAir({aircraft,loadout,custom,custom_counts,spawn,fuel_minutes})','deployAir({aircraft,loadout,custom,spawn,fuel_minutes})')
 .replace('configuration(aircraft,{loadout,custom,custom_counts,...pick})','configuration(aircraft,{loadout,custom,...pick})')
 .replace('serviceAir({loadout,custom,custom_counts,fuel_minutes,cancel=false}', 'serviceAir({loadout,custom,fuel_minutes,cancel=false}')
 .replace('configuration(unit.aircraft,{loadout,custom,custom_counts,...pick})','configuration(unit.aircraft,{loadout,custom,...pick})')
 .replace('customCounts:id=>frontlineCustomCountPick(id),','');

test('offline full fuel composer accepts the exact installed R85 quantity extension without changing canonical bytes',()=>{
 assert.ok(patchAircraftFuelLoad(app)===app,'Full composer must retain the frozen R85 client byte for byte');
 const finalApp=patchR85Loadout(app);assert.ok(patchAircraftFuelLoad(finalApp)===finalApp,'Full composer must also retain reviewed stable airport controls');
 const stableClient=patchR85LoadoutClient(current);
 for(const input of [current,stableClient])for(const source of [input,input.replaceAll('\n','\r\n')])assert.ok(patchFrontlineFuelClient(source)===source);
});
test('the original reviewed R84 installed fuel forms remain idempotent with either line ending',()=>{
 assert.ok(!oldClient.includes('configuration(id,{loadout,custom,custom_counts,'));
 for(const source of [oldClient,oldClient.replaceAll('\n','\r\n')])assert.ok(patchFrontlineFuelClient(source)===source);
});
test('R85 compatibility still rejects missing fuel validation, missing count validation and duplicate installed hooks',()=>{
 for(const bad of [
  current.replace('fuelPolicy.normalize(fuel_minutes)','fuelPolicy.unsafe(fuel_minutes)'),
  current.replace(countGuard,''),
  current.replace('deployAir({aircraft,loadout,custom,custom_counts,spawn,fuel_minutes})','deployAir({aircraft,loadout,custom,custom_counts,spawn,unreviewed})'),
  current+'\ndeployAir({aircraft,loadout,custom,custom_counts,spawn,fuel_minutes}){'
 ])assert.throws(()=>patchFrontlineFuelClient(bad),/reviewed|fuel|installed/i);
});

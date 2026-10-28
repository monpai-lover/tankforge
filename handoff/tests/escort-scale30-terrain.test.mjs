import fs from 'node:fs';import vm from 'node:vm';import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeR85TheatreFleet} from '../tools/patch_r85_theatre_fleet.mjs';
// Preserve the R84 compatibility policy; current 1:10/300m coverage is checked
// separately against actual installed code in r85-theatre-fleet.test.mjs.
const client=normalizeR85TheatreFleet(fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8'));
test('legacy R84 whole-theatre bounds cover 1:30 while local samples keep metric units',()=>{
 const a=client.indexOf('        const radius=compact?'),b=client.indexOf('\n',a);assert.ok(a>0);
 const context=vm.createContext({f:{map:{bounds:{minX:-236000/30,maxX:236000/30,minZ:-271000/30,maxZ:269000/30}}},compact:true,aerial:true});
 vm.runInContext(client.slice(a,b)+';globalThis.config={radius,step};',context);
 const {radius,step}=context.config;assert.ok(radius>=271000/30,'expanded land and both airports must not be cropped by the old 3600m ROI');
 assert.ok(radius*2/step<=400,'one cached whole-map mesh has a bounded coarse grid');assert.ok(Number.isSafeInteger(radius*2/step));assert.ok(step<=100,'keep local terrain readable');
});

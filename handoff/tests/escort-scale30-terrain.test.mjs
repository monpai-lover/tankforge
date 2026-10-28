import fs from 'node:fs';import vm from 'node:vm';import test from 'node:test';import assert from 'node:assert/strict';
const client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
test('whole-theatre terrain bounds grow with the 1:30 map while local samples and vehicles keep metric units',()=>{
 const a=client.indexOf('        const radius=compact?'),b=client.indexOf('\n',a);assert.ok(a>0);
 const context=vm.createContext({f:{map:{bounds:{minX:-236000/30,maxX:236000/30,minZ:-271000/30,maxZ:269000/30}}},compact:true,aerial:true});
 vm.runInContext(client.slice(a,b)+';globalThis.config={radius,step};',context);
 const {radius,step}=context.config;assert.ok(radius>=271000/30,'expanded land and both airports must not be cropped by the old 3600m ROI');
 assert.ok(radius*2/step<=400,'one cached whole-map mesh has a bounded coarse grid');assert.ok(Number.isSafeInteger(radius*2/step));assert.ok(step<=100,'keep local terrain readable');
});

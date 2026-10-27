import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sampBomb,sampDefinition} from './samp-bomb.mjs';
import {catalogDefinitions,EXTRA_OPTIONS,REVIEW_CASES,slots} from './catalog.mjs';
import {store,storeEvidence} from './details.mjs';
import {createLayout} from '../hardpoints/actual-layout-fixture.mjs';

test('SAMP250 has an independent finite bomb silhouette and lower detail mesh; no US weapon definition is replaced',()=>{
 const old={mk82:{name:'US Mk82',mass:241,len:2.22,d:.273},fab250:{warhead:{kind:'he',explosive_mass_kg:100,explosive_type:'tnt'}}},snapshot=JSON.stringify(old),defs=catalogDefinitions(old,{}),d=defs.samp250;
 assert.equal(JSON.stringify(old),snapshot);assert.equal(defs.mk82,old.mk82);assert.equal(d.model,undefined);assert.equal(d.dimension_status,'game_estimate');assert.notEqual(d.visual,undefined);
 const a=store(d,0),b=store(d,1);assert.ok(a&&b);assert.ok(a.length>b.length);assert.notEqual(a,store(defs.mk82,0));
 for(const mesh of[a,b]){assert.equal(mesh.length%39,0);assert.ok(mesh.every(Number.isFinite));let minZ=Infinity,maxZ=-Infinity,maxRadius=0;for(let i=0;i<mesh.length;i+=13){minZ=Math.min(minZ,mesh[i+2]);maxZ=Math.max(maxZ,mesh[i+2]);maxRadius=Math.max(maxRadius,Math.hypot(mesh[i],mesh[i+1]));const n=Math.hypot(...mesh.subarray(i+3,i+6));assert.ok(Math.abs(n-1)<1e-6);}assert.ok(Math.abs(maxZ-minZ-d.len)<1e-6);assert.ok(maxRadius>d.d*.8&&maxRadius<d.d);}
 assert.ok(storeEvidence(d).features.includes('four_tail_plates'));assert.equal(sampBomb({kind:'bomb',len:2,d:.3}),null);
});

test('Mirage5F exposes SAMP250 on both existing inner stations and keeps Magic outer stations',()=>{
 const original=[{key:'outer:-1',station:'outer',side:-1,options:new Map([['magic1',1]])},{key:'inner:-1',station:'inner',side:-1,options:new Map([['matra155',1]])},{key:'inner:1',station:'inner',side:1,options:new Map([['matra155',1]])},{key:'outer:1',station:'outer',side:1,options:new Map([['magic1',1]])}],s=slots({id:'mirage3e'},original);
 for(const side of[-1,1]){assert.equal(s.find(x=>x.key==='inner:'+side).options.get('samp250'),1);assert.equal(s.find(x=>x.key==='outer:'+side).options.get('magic1'),1);}
 assert.equal(original[1].options.has('samp250'),false);assert.equal(EXTRA_OPTIONS.mirage3e.inner.samp250,1);assert.ok(REVIEW_CASES.mirage3e.length);
});

test('production layout function mounts all four SAMP/Magic review objects with exact Mirage5F source identity',async()=>{
 process.env.TF_LIVE_APP ||=new URL('./app-fixed.html',import.meta.url).pathname;
 const {bundled}=await import('../../work/tankforge-live-flight-patch/source/handoff/tests/fixtures/live-aircraft.mjs');
 const fixture=JSON.parse(fs.readFileSync(new URL('../all-interior/current-catalog-fixture.json',import.meta.url)));await bundled.decodeAircraftModels(fixture.models);
 const text=fs.readFileSync(new URL('./app-fixed.html',import.meta.url),'utf8'),L=createLayout(text,bundled.AIRCRAFT_TYPES),T=bundled.AIRCRAFT_TYPES.mirage3e;
 assert.match(T.name,/Mirage 5F/);const entries=L.layoutStores(T,REVIEW_CASES.mirage3e[0]);assert.equal(entries.length,4);assert.equal(entries.filter(x=>x.id==='samp250').length,2);assert.ok(entries.every(x=>x.p.every(Number.isFinite)));
 assert.deepEqual(Array.from(entries.filter(x=>x.id==='samp250'),x=>x.side).sort(),[-1,1]);
});

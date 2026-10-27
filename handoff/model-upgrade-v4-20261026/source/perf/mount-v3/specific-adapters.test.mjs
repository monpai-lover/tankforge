import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as details from './details.mjs';
import {createLayout} from '../hardpoints/actual-layout-fixture.mjs';
process.env.TF_LIVE_APP ||= new URL('../model-upgrade-app.html',import.meta.url).pathname;
const {bundled,makeAircraft}=await import('../../work/tankforge-live-flight-patch/source/handoff/tests/fixtures/live-aircraft.mjs');
const source=fs.readFileSync(process.env.TF_LIVE_APP,'utf8');
const fixture=JSON.parse(fs.readFileSync(new URL('../all-interior/current-catalog-fixture.json',import.meta.url)));await bundled.decodeAircraftModels({mig29:fixture.models.mig29});
const T=bundled.AIRCRAFT_TYPES.mig29,L=createLayout(source,bundled.AIRCRAFT_TYPES);

test('S24B-specific adapters select independent stable keys and leave every original MiG29 preset coordinate unchanged',()=>{
 const before=JSON.parse(fs.readFileSync(new URL('./specific-adapters-baseline.json',import.meta.url)));
 for(const c of before.cases.filter(c=>typeof c.index==='number'&&c.index<=L.AIR_LOADOUTS.mig29.length)){
  const lo=c.index===0?['guns',[]]:L.AIR_LOADOUTS.mig29[c.index-1];
  const items=L.layoutStores(T,lo);assert.equal(items.length,c.items.length);
  for(let i=0;i<items.length;i++){assert.equal(items[i].id,c.items[i].id);assert.deepEqual(Array.from(items[i].p),c.items[i].p);assert.equal(items[i].fittedMountKey||null,c.items[i].fittedMountKey);}
 }
 const items=L.layoutStores(T,['S24B',[['s24b',2,'mid']]]);assert.equal(items.length,2);
 for(const it of items){assert.equal(it.fittedMountKey,'mig29:'+(it.side<0?4:5));assert.equal(it.mount[1],-.274);assert.equal(it.p[1],-.394);assert.equal(it.mount[2],-1.22);assert.equal(it.pylon,null);}
 const again=JSON.stringify(items);details.fitItems(T,items);assert.equal(JSON.stringify(items),again);
 const mixed=L.layoutStores(T,['mixed',[['s24b',1,'mid',-1],['r73',1,'mid',1]]]);assert.equal(mixed[0].fittedMountKey,'mig29:4');assert.equal(mixed[1].fittedMountKey,'mig29:2');assert.equal(mixed[1].p[1],-.26849999999999996);
});

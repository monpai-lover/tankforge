#!/usr/bin/env node
// Receipt migration only: refuse if ANY pre-existing physical/resource/model
// field changed. The original core213/model receipt is never rewritten.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {exportProfiles} from './export_frontline_aircraft.mjs';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const oldPath=new URL('../tests/fixtures/aircraft-model-upgrade-baseline-20261025.json',import.meta.url),oldBytes=fs.readFileSync(oldPath),old=JSON.parse(oldBytes),fresh=await exportProfiles(),{source,...semantic}=structuredClone(fresh),slotItems={};
assert.equal(old.provenance.flightWasmSha256,'2450d4ebb7f73f3a155a5bc2a312558e241a511146f81f02f922122eb232568e');
assert.equal(source.flightCoreVersion,214);
assert.equal(source.flightWasmSha256,'b35e59001c3e6d8f1f63c6645396359c2516a5cd1618ee22fbe9cd54d086d0f1');
for(const [id,a]of Object.entries(semantic.aircraft)){
  assert.ok(a.stores.slotItems);slotItems[id]=sha(JSON.stringify(a.stores.slotItems));delete a.stores.slotItems;
  for(const field of ['physics','guns','fuel'])assert.equal(sha(JSON.stringify(a[field])),old.aircraft[id].unchanged[field],id+'/'+field+' may not migrate');
  for(const field of ['metadata','stores'])assert.equal(sha(JSON.stringify(a[field])),old.aircraft[id][field],id+'/'+field+' may not migrate');
  assert.equal(sha(JSON.stringify(a)),old.aircraft[id].full,id+' original full aircraft changed');
}
for(const point of semantic.shells.he_152_rp3.penetration_curve){const v=33.934448686405126;assert.ok(Math.abs(point.pen_mm-v)<=Number.EPSILON*Math.max(1,Math.abs(v)));point.pen_mm=v;}
for(const [key,value]of Object.entries(semantic))assert.equal(sha(JSON.stringify(value)),old.fields[key],key+' original field may not migrate');
assert.equal(sha(JSON.stringify(semantic)),old.semanticSha256);
const receipt={scope:'Explicit native source-socket geometry extension and core214 gear-failure ABI; every previous semantic field unchanged after removing only stores.slotItems and historical RP3 Windows one-ULP normalization.',baseReceiptSha256:sha(oldBytes),kernel:{coreVersion:214,flightWasmSha256:source.flightWasmSha256,reason:'Explicit gear failure/repair ABI; original serialized aircraft physics arguments remain byte-identical.'},slotItems};
const out=new URL('../tests/fixtures/aircraft-native-slot-items-extension-20261026.json',import.meta.url);fs.writeFileSync(out,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({passed:true,aircraft:Object.keys(slotItems).length,receiptSha256:sha(fs.readFileSync(out)),originalReceiptUnchanged:sha(fs.readFileSync(oldPath))===sha(oldBytes)}));

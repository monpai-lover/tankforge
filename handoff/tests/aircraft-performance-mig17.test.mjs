import {migration,ORIGINAL_AIRCRAFT_IDS,assertR7ExportContract} from './fixtures/r7-aircraft-contract.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {normalizeMig17Wing} from '../tools/aircraft_performance/mig17-wing.mjs';
import {exportProfiles} from '../tools/export_frontline_aircraft.mjs';
import {models} from './jet-fixture.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const raw=models.mig17f,bytes=zlib.inflateSync(Buffer.from(raw.blob,'base64'));
const original=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
const triangles=(p,buffer)=>{const indexes=p.idx32?new Uint32Array(buffer,p.idx,p.triangles*3):new Uint16Array(buffer,p.idx,p.triangles*3);return Array.from({length:p.triangles},(_,i)=>`${indexes[i*3]},${indexes[i*3+1]},${indexes[i*3+2]}`).sort();};
test('current source MiG17 correction preserves every triangle/attribute, source inputs and all unrelated movers',()=>{
  const before=JSON.stringify(raw),beforeSha=sha(bytes),fixed=normalizeMig17Wing('mig17f',raw,original);
  assert.equal(fixed.applied,true);assert.equal(fixed.model.parts.length,69);assert.equal(fixed.model.parts.reduce((n,p)=>n+p.triangles,0),85645);
  assert.deepEqual(new Uint8Array(fixed.buf,0,original.byteLength),new Uint8Array(original),'Original positions/normals/UV/indices remain exact bytes');
  for(const p of raw.parts){
    const pieces=fixed.model.parts.filter(q=>(q.source_part||q.name)===p.name);assert.ok(pieces.length,p.name);
    assert.deepEqual(pieces.flatMap(q=>triangles(q,fixed.buf)).sort(),triangles(p,original),p.name+' triangle multiset/winding');
    for(const q of pieces)for(const key of ['vertices','pos','nor','uv','textured','colour','rough','metal','group'])assert.deepEqual(q[key],p[key],p.name+'/'+key);
  }
  for(let i=0;i<raw.movers.length;i++)if(![0,1,11,12].includes(i))assert.deepEqual(fixed.model.movers[i],raw.movers[i]);
  assert.equal(JSON.stringify(raw),before);assert.equal(sha(new Uint8Array(original)),beforeSha);
  const again=normalizeMig17Wing('mig17f',fixed.model,fixed.buf);assert.equal(again.applied,false);assert.equal(again.model,fixed.model);assert.equal(again.buf,fixed.buf);
});
test('unknown MiG17 source/hash/rig/shape falls back unchanged',()=>{
  const changed=original.slice(0);new Uint8Array(changed)[17]^=1;
  for(const [id,model,buffer] of [['mig15',raw,original],['mig17f',{...raw,posScale:raw.posScale*1.001},original],['mig17f',{...raw,sourceBinding:{...raw.sourceBinding,glbSha256:'other'}},original],['mig17f',{...raw,movers:raw.movers.slice(1)},original],['mig17f',raw,changed]]){
    const result=normalizeMig17Wing(id,model,buffer);assert.equal(result.applied,false);assert.equal(result.model,model);assert.equal(result.buf,buffer);
  }
});
test('original26 physics guns fuel and93 preset INDEX/LIST contracts survive explicit source-bound V4/C215/variant migration',async()=>{
 const originalReceipt=fs.readFileSync(new URL('fixtures/aircraft-performance-baseline-20261025.json',import.meta.url));
 const baselineBytes=fs.readFileSync(new URL('fixtures/aircraft-model-upgrade-baseline-20261025.json',import.meta.url)),baseline=JSON.parse(baselineBytes),extensionBytes=fs.readFileSync(new URL('fixtures/aircraft-native-slot-items-extension-20261026.json',import.meta.url)),extension=JSON.parse(extensionBytes),fresh=await exportProfiles();
 assert.equal(baseline.provenance.originalPerformanceReceiptSha256,sha(originalReceipt));
 assert.equal(baseline.provenance.preUpgradeProfileSha256,'b83d74de995bb79189cfe9f9cf44aeeb817f6ed8217826564fdc68cc2b5144db');
 assert.equal(baseline.provenance.oldSemanticMatchedOriginal,true);
 assert.equal(baseline.provenance.flightWasmSha256,'2450d4ebb7f73f3a155a5bc2a312558e241a511146f81f02f922122eb232568e','Original C213 receipt remains immutable');
 assert.equal(extension.baseReceiptSha256,sha(baselineBytes));assert.equal(extension.kernel.coreVersion,214,'Original C214 extension remains immutable');
 assert.equal(migration.provenance.modelBaselineSha256,sha(baselineBytes));assert.equal(migration.provenance.slotExtensionSha256,sha(extensionBytes));
 for(const id of ORIGINAL_AIRCRAFT_IDS){const value=fresh.aircraft[id],pinned=baseline.aircraft[id];for(const f of ['physics','guns','fuel'])assert.equal(sha(JSON.stringify(value[f])),pinned.unchanged[f],id+'/'+f+' exact original contract');assert.equal(sha(JSON.stringify(value.metadata)),pinned.metadata,id+' original metadata');}
 const weaponContract=assertR7ExportContract(fresh);
 // Retain original exact weapon gates after removing only the three explicitly declared V4 definitions and its one SAMP warhead.
 const shells=structuredClone(weaponContract.shells),definitions=structuredClone(weaponContract.storeDefinitions);for(const id of Object.keys(migration.addedShells))delete shells[id];for(const id of Object.keys(migration.addedStoreDefinitions))delete definitions[id];
 const expectedRp3Pen=33.934448686405126,curve=shells.he_152_rp3.penetration_curve;assert.equal(curve.length,7);for(const point of curve){assert.ok(Math.abs(point.pen_mm-expectedRp3Pen)<=Number.EPSILON*Math.max(1,Math.abs(expectedRp3Pen)));point.pen_mm=expectedRp3Pen;}
 assert.equal(sha(JSON.stringify(shells)),baseline.fields.shells,'Every original shell stays exact');assert.equal(sha(JSON.stringify(definitions)),baseline.fields.storeDefinitions,'Every original store definition stays exact');
});

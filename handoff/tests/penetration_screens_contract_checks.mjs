import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {canonical,sha,screenInstallSource,recognizeScreenPacket} from '../tools/penetration_screens.mjs';
const at=process.argv.indexOf('--records');
const recordsFile=at>=0?process.argv[at+1]:'D:/TankForge-validation/m8-investigation-20261027/screens/penetration_screens_packets.json';
const records=JSON.parse(fs.readFileSync(recordsFile,'utf8'));
const installer=screenInstallSource(records);new vm.Script(installer);
assert.ok(Buffer.byteLength(installer)<20000);
let checked=0;
for(const [id,r]of Object.entries(records)){
  assert.equal(recognizeScreenPacket(r.packet,records).armorBindingReview.sourcePinned,true);checked++;
  assert.equal(recognizeScreenPacket({...r.packet,manifestHash:'0'.repeat(64)},records),null);checked++;
  assert.throws(()=>recognizeScreenPacket({...r.packet,catalog:r.packet.catalog+' '},records),/changed/);checked++;
  assert.throws(()=>recognizeScreenPacket({...r.packet,variants:[{}]},records),/changed/);checked++;
  const catalog=JSON.parse(r.packet.catalog),manifest=JSON.parse(r.packet.manifest);
  assert.equal(catalog.anatomyHash,manifest.anatomyDataHash);
  assert.equal(sha(canonical(catalog.acceptedAnatomy)),catalog.anatomyHash);checked++;
  for(const d of catalog.declarations.filter(d=>d.crewSlot))assert.equal(d.crewSlot.anatomyHash,catalog.anatomyHash);
  for(const side of ['r','l']){
    const declarations=catalog.declarations.filter(d=>d.armorBinding.armorRefs.includes('schuerzen_'+side));
    assert.equal(declarations.reduce((s,d)=>s+d.count,0),12);
    assert.equal(declarations.filter(d=>d.armorBinding.boundarySide==='outer').reduce((s,d)=>s+d.count,0),2);
    assert.equal(declarations.filter(d=>d.armorBinding.boundarySide==='inner').reduce((s,d)=>s+d.count,0),2);checked++;
  }
}
const result={schema:'SupplementalScreensContractsV1',passed:true,checks:checked,installerBytes:Buffer.byteLength(installer),
  scope:'Exact derivative allowlist, mutation/variant refusal, anatomy/crew hash propagation, complete24-triangle screen partition, inner/outer pairing and compact installer syntax'};
console.log(JSON.stringify(result));

import fs from 'node:fs';
import assert from 'node:assert/strict';
const args=process.argv.slice(2),get=(n,d)=>{const i=args.indexOf(n);return i<0?d:args[i+1];};
const before=JSON.parse(fs.readFileSync(get('--before'),'utf8')),after=JSON.parse(fs.readFileSync(get('--after'),'utf8'));
const out=get('--out');assert.ok(!fs.existsSync(out),'fresh comparison path');
assert.equal(before.embeddedSHA256,after.embeddedSHA256,'cohort data stays identical');
for(const model of after.models){const prior=before.models.find(m=>m.id===model.id);assert.ok(prior);for(const k of ['geometrySHA256','manifestSHA256','catalogSHA256','triangles','buffers','instances'])assert.equal(prior[k],model[k],model.id+' '+k);}
const cases=[];
for(const c of after.cases.filter(c=>c.mode==='source-queued')){
  const b=before.cases.find(b=>b.mode===c.mode&&b.actor===c.actor&&b.shell===c.shell);assert.ok(b);
  assert.deepEqual(Object.keys(c.stats.coreOps),['combat_surface_near_burst'],'registered after-cohort retains exact scene path');
  assert.equal(c.stats.coreCalls,c.samples);
  for(const proof of c.proofs){assert.ok(proof.geometryContacts>0,'positive physical contacts remain present');assert.ok(proof.casingSamples>0);}
  cases.push({actor:c.actor,shell:c.shell,before:{meanMs:b.timing.meanMs,p50Ms:b.timing.p50Ms,p95Ms:b.timing.p95Ms,maxMs:b.timing.maxMs,coreMeanMs:b.timing.coreMeanMs,casingSamples:b.proofs[0].casingSamples,geometryContacts:b.proofs[0].geometryContacts},after:{meanMs:c.timing.meanMs,p50Ms:c.timing.p50Ms,p95Ms:c.timing.p95Ms,maxMs:c.timing.maxMs,coreMeanMs:c.timing.coreMeanMs,casingSamples:c.proofs[0].casingSamples,geometryContacts:c.proofs[0].geometryContacts},p50Ratio:c.timing.p50Ms/b.timing.p50Ms,p95Ratio:c.timing.p95Ms/b.timing.p95Ms});
}
const summary={schema:'TankForgeRegisteredHEContactCPUComparisonV1',createdUtc:new Date().toISOString(),executionLoad:{before:get('--before-load','unrecorded'),after:get('--after-load','unrecorded')},before:{sourceSHA256:before.sourceSHA256,wasmSHA256:before.wasmSHA256,fixtureSHA256:before.fixtureSHA256},after:{sourceSHA256:after.sourceSHA256,wasmSHA256:after.wasmSHA256,fixtureSHA256:after.fixtureSHA256},embeddedSHA256:after.embeddedSHA256,models:after.models.map(({ray,...model})=>model),cases,scope:after.scope,physicalParityClaim:false,limitations:['Repeated independent real-contact samples, not a sustained browser battle or FPS measurement.','A reduced representative ray count is a labeled statistical quadrature approximation; state/damage parity is not asserted.','Actual source queue comparisons preserve each source cohort policy. R7 ignores the new includePressure argument, so its same-point diagnostic cannot establish pressure-policy parity.','Absolute CPU timing may vary under concurrent native compilation or tests; report execution load, medians and p95 with cohort hashes.']};
fs.writeFileSync(out,JSON.stringify(summary,null,2),{flag:'wx'});
console.log(JSON.stringify(summary,null,2));

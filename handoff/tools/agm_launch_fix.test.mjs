import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const harness=fileURLToPath(new URL('./agm_launch_fix.client_test.mjs',import.meta.url));
function run(args=[]){const r=spawnSync(process.execPath,[harness,...args],{encoding:'utf8',timeout:30000});
  const line=r.stdout.split('\n').find(l=>l.startsWith('{"schema":"AgmLaunchActualClientV1"'));
  assert.ok(line,r.stderr||r.stdout);return {status:r.status,receipt:JSON.parse(line)};}
test('original actual native AGM projection/launch-check seam reproduces estimate crash and obsolete online refusal',()=>{
  const {status,receipt}=run(['--red']);assert.equal(status,1);
  assert.ok(receipt.failures.some(f=>f.error?.includes("reading 'p'")));
  assert.ok(receipt.failures.some(f=>f.online&&f.value?.reason?.includes('線上暫不支援對地武器')));
});
test('all 13 catalog AGMs use accepted native readiness while retaining denial and intent ownership',()=>{
  const {status,receipt}=run();assert.equal(status,0);assert.equal(receipt.catalogAgms.length,13);
  assert.equal(receipt.acceptedTrackChecks,26);assert.equal(receipt.denialChecks,234);assert.equal(receipt.intentChecks,26);
  assert.deepEqual(receipt.failures,[]);
});

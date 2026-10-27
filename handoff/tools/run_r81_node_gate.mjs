// Run the preserved formal inventory and all R8 regressions against one frozen build.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=path.resolve(process.argv[2]||'');assert.ok(process.argv[2]&&!fs.existsSync(out),'Use a fresh output directory');fs.mkdirSync(out,{recursive:true});
const inventory=JSON.parse(fs.readFileSync(new URL('../qa/r81-node-test-inventory.json',import.meta.url)));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
// Extracted source has no Git history or sibling task fixtures. Keep the real
// historical bytes explicit and immutable instead of replacing them with the
// candidate application/core. These are read-only inputs, never copied/rebuilt.
const fixtures={
  optics:{environment:'TF_OPTICS_BASE_APP',path:path.resolve(process.env.TF_OPTICS_BASE_APP||'C:/Users/24908/.codex/scratch/tankforge-airwar-online-20261025/intake/handoff-release/frontend-app.js.html'),sha256:'5f9577fabf415594db7c845d061bd48fc1699cf0105c72f93c873acb28a621ba'},
  legacySurface:{environment:'TF_LEGACY_SURFACE_CORE_BASE_WASM',path:path.resolve(process.env.TF_LEGACY_SURFACE_CORE_BASE_WASM||'C:/Users/24908/.codex/scratch/tankforge-airwar-online-20261025/worktree/task/provenance-recovery-20261026/original-active/surfaceCore.wasm'),sha256:'f88569767f73e291a32c0a7c7b983126075f60a1c0d08f652af60cd99f78c83c'},
};
for(const [name,fixture]of Object.entries(fixtures))assert.equal(sha(fs.readFileSync(fixture.path)),fixture.sha256,'Exact preserved '+name+' fixture required');
// Git/bin/sh.exe is a launcher which prepends real curl/sleep ahead of fixture
// stubs. The direct POSIX binary preserves the tests' deliberately first PATH.
const shell=path.resolve(process.env.TF_TEST_SH||'C:/Program Files/Git/usr/bin/sh.exe');assert.ok(fs.statSync(shell).isFile(),'Real POSIX test shell required');
if(!process.env.TF_TEST_SH)assert.equal(sha(fs.readFileSync(shell)),'92cff5f145d42f85b55aa3be8d3ad9827844a21ec4fbeaa1ddfe1dd4d76c6474','Reviewed direct Git shell required; use an explicit portable TF_TEST_SH override for another runtime');
const fixtureInputs=()=>Object.fromEntries([...Object.entries(fixtures).map(([name,f])=>['historical-fixture/'+name,sha(fs.readFileSync(f.path))]),['test-runtime/sh',sha(fs.readFileSync(shell))]]);
const environment={...process.env,TF_TEST_SH:shell,PATH:path.dirname(shell)+path.delimiter+(process.env.PATH||'')};
for(const fixture of Object.values(fixtures))environment[fixture.environment]=fixture.path;
const inputs=()=>({...Object.fromEntries(['handoff/bundle/app.js.html','data/aircraft/frontline.json','data/aircraft/aircraft.json','handoff/flight/flight_core.wasm','Cargo.lock','handoff/tools/run_r81_node_gate.mjs','handoff/qa/r81-node-test-inventory.json',...inventory.selected].map(f=>[f,sha(fs.readFileSync(path.join(root,f)))])),...fixtureInputs()});
const before=inputs();fs.writeFileSync(path.join(out,'inputs-before.json'),JSON.stringify(before,null,2));
const results=[];let cursor=0;
async function worker(){
 while(cursor<inventory.selected.length){
  const file=inventory.selected[cursor++],log=path.join(out,file.replaceAll(/[\\/:]/g,'_')+'.tap.log');
  const result=await new Promise(resolve=>{
   const sink=fs.createWriteStream(log,{flags:'wx'}),p=spawn(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap',file],{cwd:root,env:environment,stdio:['ignore','pipe','pipe'],windowsHide:true});
   let raw='',timeout=false;const timer=setTimeout(()=>{timeout=true;p.kill();},300000);
   for(const stream of [p.stdout,p.stderr])stream.on('data',b=>{raw+=b;sink.write(b);});
   p.on('error',error=>{raw+=String(error);});p.on('close',exit=>{clearTimeout(timer);sink.end();
    const number=name=>{const a=[...raw.matchAll(new RegExp('^# '+name+' (\\d+)\\s*$','gm'))];return a.length?Number(a.at(-1)[1]):null;};
    resolve({file,log,exitCode:exit,timeout,tests:number('tests'),pass:number('pass'),fail:number('fail'),skipped:number('skipped'),outputSha256:sha(raw)});
   });
  });
  result.passed=result.exitCode===0&&!result.timeout&&result.tests>0&&result.fail===0;
  results.push(result);console.log(`${result.passed?'PASS':'FAIL'} ${file} ${result.pass}/${result.tests}`);
  fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify(results,null,2));
 }
}
await Promise.all([worker(),worker()]);
const after=inputs(),stable=JSON.stringify(before)===JSON.stringify(after);fs.writeFileSync(path.join(out,'inputs-after.json'),JSON.stringify(after,null,2));
const summary={schema:'TankForgeR81NodeGateV1',passed:stable&&results.every(r=>r.passed),inputsStable:stable,historicalFixtures:fixtures,testShell:{path:shell,sha256:before['test-runtime/sh']},files:results.length,tests:results.reduce((s,r)=>s+(r.tests||0),0),pass:results.reduce((s,r)=>s+(r.pass||0),0),skipped:results.reduce((s,r)=>s+(r.skipped||0),0),notRun:inventory.notRun,results};
fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(summary,null,2));
fs.writeFileSync(path.join(out,'combined.tap.log'),results.map(r=>fs.readFileSync(r.log,'utf8')).join('\n'));
console.log(JSON.stringify({...summary,results:undefined}));if(!summary.passed)process.exitCode=1;

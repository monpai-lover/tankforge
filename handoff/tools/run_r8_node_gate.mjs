// Run the preserved formal inventory and all R8 regressions against one frozen build.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url));
const out=path.resolve(process.argv[2]||'');assert.ok(process.argv[2]&&!fs.existsSync(out),'Use a fresh output directory');fs.mkdirSync(out,{recursive:true});
const inventory=JSON.parse(fs.readFileSync(new URL('../qa/r8-node-test-inventory.json',import.meta.url)));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const inputs=()=>Object.fromEntries(['handoff/bundle/app.js.html','data/aircraft/frontline.json','data/aircraft/aircraft.json','handoff/flight/flight_core.wasm','Cargo.lock',...inventory.selected].map(f=>[f,sha(fs.readFileSync(path.join(root,f)))]));
const before=inputs();fs.writeFileSync(path.join(out,'inputs-before.json'),JSON.stringify(before,null,2));
const results=[];let cursor=0;
async function worker(){
 while(cursor<inventory.selected.length){
  const file=inventory.selected[cursor++],log=path.join(out,file.replaceAll(/[\\/:]/g,'_')+'.tap.log');
  const result=await new Promise(resolve=>{
   const sink=fs.createWriteStream(log,{flags:'wx'}),p=spawn(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap',file],{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true});
   let raw='',timeout=false;const timer=setTimeout(()=>{timeout=true;p.kill();},180000);
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
const summary={schema:'TankForgeR8NodeGateV1',passed:stable&&results.every(r=>r.passed),inputsStable:stable,files:results.length,tests:results.reduce((s,r)=>s+(r.tests||0),0),pass:results.reduce((s,r)=>s+(r.pass||0),0),skipped:results.reduce((s,r)=>s+(r.skipped||0),0),notRun:inventory.notRun,results};
fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(summary,null,2));
fs.writeFileSync(path.join(out,'combined.tap.log'),results.map(r=>fs.readFileSync(r.log,'utf8')).join('\n'));
console.log(JSON.stringify({...summary,results:undefined}));if(!summary.passed)process.exitCode=1;

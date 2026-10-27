import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../server/vps/update-page.sh',import.meta.url));
const shellPath=value=>process.platform==='win32'?value.replaceAll('\\','/'):value;
function fixture(t,{oldGzip=true,health='ok'}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tankforge-page-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const target=path.join(dir,'deploy'),dist=path.join(target,'client/web/dist'),bin=path.join(dir,'bin');
  fs.mkdirSync(dist,{recursive:true});fs.mkdirSync(bin);
  const page=path.join(dist,'tankforge-range.html'),source=path.join(dir,'index.html.gz'),events=path.join(dir,'events');
  fs.writeFileSync(page,'old page');if(oldGzip)fs.writeFileSync(page+'.gz',gzipSync('old page'));
  fs.writeFileSync(source,gzipSync('new page'));
  const sha=createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  fs.writeFileSync(source+'.sha256',`${sha}  index.html.gz\n`);
  const stubs={systemctl:'printf "%s\\n" "$*" >> "$TF_UPDATE_TEST_EVENTS"\nexit 0',
    curl:'[ "$TF_UPDATE_TEST_HEALTH" = ok ] || exit 22\nprintf ok',sleep:'exit 0'};
  for(const [name,body] of Object.entries(stubs))fs.writeFileSync(path.join(bin,name),'#!/bin/sh\n'+body+'\n',{mode:0o755});
  return {page,source,dist,events,run(dry=false){
    return spawnSync(process.env.TF_TEST_SH||'sh',[shellPath(script),...(dry?['--dry-run']:[]),shellPath(source)],{encoding:'utf8',timeout:15000,
      env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,TARGET:shellPath(target),SERVICE:'test-service',
        TF_UPDATE_TEST_EVENTS:shellPath(events),TF_UPDATE_TEST_HEALTH:health}});
  }};
}
test('page updater dry run validates without changing files or restarting',t=>{
  const f=fixture(t),before=fs.readdirSync(f.dist),r=f.run(true);
  assert.equal(r.status,0,r.stderr);assert.equal(fs.readFileSync(f.page,'utf8'),'old page');
  assert.deepEqual(fs.readdirSync(f.dist),before);assert.ok(!fs.existsSync(f.events));
});
test('page updater switches both files and keeps recoverable backups',t=>{
  const f=fixture(t),r=f.run();assert.equal(r.status,0,r.stderr);
  assert.equal(fs.readFileSync(f.page,'utf8'),'new page');assert.equal(gunzipSync(fs.readFileSync(f.page+'.gz')).toString(),'new page');
  const backups=fs.readdirSync(f.dist).filter(n=>/\.bak-.*[^z]$/.test(n)&&!n.endsWith('.gz'));
  assert.equal(backups.length,1);assert.equal(fs.readFileSync(path.join(f.dist,backups[0]),'utf8'),'old page');
  assert.equal(gunzipSync(fs.readFileSync(path.join(f.dist,backups[0]+'.gz'))).toString(),'old page');
  assert.equal(fs.readFileSync(f.events,'utf8'),'restart test-service\n');
  assert.ok(!fs.readdirSync(f.dist).some(n=>n.includes('.new-')));
});
for(const oldGzip of [true,false])test(`failed health check restores old page and gzip presence (${oldGzip})`,t=>{
  const f=fixture(t,{oldGzip,health:'fail'}),r=f.run();assert.notEqual(r.status,0);
  assert.match(r.stderr,/已自動恢復舊頁面/);assert.equal(fs.readFileSync(f.page,'utf8'),'old page');
  assert.equal(fs.existsSync(f.page+'.gz'),oldGzip);
  if(oldGzip)assert.equal(gunzipSync(fs.readFileSync(f.page+'.gz')).toString(),'old page');
  assert.equal(fs.readFileSync(f.events,'utf8'),'restart test-service\nrestart test-service\n');
});
test('incorrect update hash is rejected before writing or restarting',t=>{
  const f=fixture(t),before=fs.readdirSync(f.dist);
  fs.writeFileSync(f.source+'.sha256','0'.repeat(64)+'  index.html.gz\n');
  const r=f.run();assert.notEqual(r.status,0);assert.match(r.stderr,/SHA-256 不符/);
  assert.deepEqual(fs.readdirSync(f.dist),before);assert.ok(!fs.existsSync(f.events));
});

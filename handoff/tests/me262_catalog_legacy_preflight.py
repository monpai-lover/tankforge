#!/usr/bin/env python3
"""Load the candidate catalog in an existing binary and deploy both new IDs.

Uses a temporary data directory, private loopback port and child process only.
Does not change/restart the installed service, compile code or load a browser.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request

NODE = r'''
const url=process.argv[2],results=[];
async function one(aircraft){
 const ws=new WebSocket(url),messages=[],waiters=[];
 const push=value=>{messages.push(value);for(const done of waiters.splice(0))done();};
 ws.onmessage=e=>push(JSON.parse(e.data));
 await new Promise((ok,bad)=>{ws.onopen=ok;ws.onerror=bad;});
 const send=v=>ws.send(JSON.stringify(v));
 async function wait(t){const end=Date.now()+4000;for(;;){
  const i=messages.findIndex(m=>m.t===t||m.t==='error');if(i>=0){const m=messages.splice(i,1)[0];if(m.t==='error')throw Error(JSON.stringify(m));return m;}
  if(Date.now()>end)throw Error('Timeout '+t+' '+JSON.stringify(messages));await new Promise(ok=>{const timer=setTimeout(ok,30);waiters.push(()=>{clearTimeout(timer);ok();});});
 }}
 try{
  send({t:'hello',name:'Me262 catalog private preflight',gameplay_rules_version:2,ammo_protocol_version:1});
  const first=await wait('welcome');send({t:'hello',name:'Me262 catalog private preflight',gameplay_rules_version:first.gameplay_rules_version||1,ammo_protocol_version:first.ammo_protocol_version||1});
  const welcome=await wait('welcome');
  send({t:'create',name:'Temporary catalog preflight',map:'range',max:2,deploy:true,gameplay_mode:'historical',gameplay_rules_version:welcome.gameplay_rules_version||1});
  await wait('room');send({t:'start'});await wait('start');send({t:'deploy_air',aircraft,loadout:0,spawn:0});
  const spawned=await wait('air_spawned');if(spawned.aircraft!==aircraft)throw Error('Wrong type');
  send({t:'leave'});await wait('left_room');results.push({aircraft,accepted:true,loadout:spawned.loadout});
 }finally{ws.close();}
}
for(const id of ['me262a2a','me262u4'])await one(id);
console.log(JSON.stringify({actualWebSocket:true,results}));
'''


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--binary',type=Path,default=Path('/opt/tankforge/target/release/tg-server'))
    p.add_argument('--catalog',type=Path,default=Path('data/aircraft/aircraft.json'))
    p.add_argument('--out',type=Path,default=Path('handoff/tests/out/me262-game-v2-20261025/legacy-catalog-preflight.json'))
    a=p.parse_args();binary=a.binary.resolve();catalog=a.catalog.resolve()
    with tempfile.TemporaryDirectory(prefix='tf-me262-catalog-') as td:
        root=Path(td);(root/'aircraft').mkdir();shutil.copyfile(catalog,root/'aircraft/aircraft.json')
        with socket.socket() as probe:probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
        log=root/'server.log'
        with log.open('w') as output:
            child=subprocess.Popen([str(binary),'--bind','127.0.0.1','--port',str(port),'--data',str(root),'--page',str(root/'no-page.html'),'--start-sp','1000'],stdout=output,stderr=subprocess.STDOUT)
            try:
                for _ in range(60):
                    if child.poll() is not None:raise RuntimeError(log.read_text())
                    try:
                        with urllib.request.urlopen(f'http://127.0.0.1:{port}/health',timeout=.25) as response:
                            if response.read()==b'ok':break
                    except OSError:pass
                    time.sleep(.1)
                else:raise RuntimeError('Temporary server did not become healthy')
                client=subprocess.run(['node','--input-type=module','-',f'ws://127.0.0.1:{port}/ws'],input=NODE,text=True,capture_output=True,timeout=20)
                if client.returncode:raise RuntimeError(client.stdout+client.stderr)
                network=json.loads(client.stdout)
                text=log.read_text()
                if '飛機:26 型' not in text:raise RuntimeError('Existing binary did not load all26 types: '+text)
                result=dict(passed=True,existing_binary_sha256=hashlib.sha256(binary.read_bytes()).hexdigest(),catalog_sha256=hashlib.sha256(catalog.read_bytes()).hexdigest(),
                    existing_service_untouched=True,temporary_private_process=True,loaded_types=26,network=network,server_log=text,
                    scope='Legacy catalog schema and actual deploy_air dynamic type lookup only; not combined mode or render-triangle combat')
            finally:
                child.terminate()
                try:child.wait(timeout=3)
                except subprocess.TimeoutExpired:child.kill();child.wait()
        a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))


if __name__=='__main__':main()

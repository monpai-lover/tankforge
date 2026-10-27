#!/usr/bin/env python3
"""Archive the published runtime and a separately labelled local source handoff."""
import hashlib,json,os,zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
PACKAGE=ROOT/'handoff/server/dist/tankforge-combined-flight-upgrade-20261025'
QA=ROOT/'handoff/tests/out/combined-upgrade-final-20261025'
OUT=Path('/home/boyang/Desktop/TankForge_handoff_20261025.zip')
BACKUP=Path('/tmp/tf-pureair-20261025')
manifest=json.loads((PACKAGE/'release.json').read_text())
app=(QA/'released-app.js.html').read_bytes()
assert hashlib.sha256(app).hexdigest()==manifest['appSha256']
assert not OUT.exists()
overrides={f'crates/server/src/{n}':BACKUP/n for n in ['frontline.rs','frontline_campaign.rs','frontline_air.rs','frontline_sim.rs','lobby.rs']}
assert all(p.is_file() for p in overrides.values())
overrides['data/aircraft/frontline.json']=PACKAGE/'data/aircraft/frontline.json'
client=(ROOT/'handoff/tools/frontline_client.js').read_text()
latest="state==='battle'?(Number.isFinite(room.round_elapsed_s)?`第 ${number} 局 · ${clock}`:'本局进行中'):'等待开始'"
prior="state==='battle'?`第 ${number} 局 · ${clock}`:'等待开始'"
assert latest in client
client=client.replace(latest,prior,1).encode()
skip={'.git','target','node_modules','__pycache__','.pytest_cache','.cache','dist'}
wip=set()
for folder in ['handoff/tools','handoff/tests']:
 for p in (ROOT/folder).glob('*'):
  if any(k in p.name for k in ['shared_lobby','shared-lobby','shared-ui','pureair','pure-air']):wip.add(p.relative_to(ROOT).as_posix())
readme='''TankForge 本地交接包（2026-10-25）

release/：已上线运行包，客户端app5f9577、服务端13571854。包含现有混合前线和飞机模型升级。纯空战与统一大厅尚未完成，未纳入运行版本。观战接收18Hz目标未达成，原生模拟约20Hz；没有宣称性能验收通过。

source-baseline/：纯空战任务前的源码基线，包含已发布的精确客户端代码和资源。5份原生源码来自任务前备份；未重新编译证明与发布二进制逐字复现。
work-in-progress/：尚未完成的纯空战/共享大厅修改，不能当成已验证构建直接部署。

Linux x86_64：进入release，执行sh run-linux.sh，打开http://127.0.0.1:8787/。
Windows/macOS：解压release/client/web/dist/tankforge-range.html.gz可取得单文件客户端；原生服务端需在本机使用Rust源码编译。
前端资源位于source-baseline/handoff/bundle/data.line.gz.part00..04；主体页面为handoff/bundle/app.js.html。历史QA输出、target、node_modules、密钥及.git未打包。

你可以在自己电脑继续完成模式，再提供构建产物/源码用于部署。
'''
run='''#!/bin/sh
set -eu
cd "$(dirname "$0")"
TF_PAGE=client/web/dist/tankforge-range.html
if [ ! -f "$TF_PAGE" ]; then gzip -dk "$TF_PAGE.gz"; fi
exec ./tg-server --bind 127.0.0.1 --port 8787 --data ./data --page "$TF_PAGE"
'''
counts={'release':0,'source':0,'wip':0}
with zipfile.ZipFile(OUT,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=1,allowZip64=True) as z:
 def put(p,name):
  stored=p.suffix.lower() in {'.gz','.zip','.png','.jpg','.jpeg','.webp','.mp3','.ogg'} or '.gz.part' in p.name
  z.write(p,'TankForge/'+name,compress_type=zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED,compresslevel=None if stored else 1)
 z.writestr('TankForge/README.txt',readme);z.writestr('TankForge/release/run-linux.sh',run)
 for n in ['tg-server','release.json','update-combined.py']:put(PACKAGE/n,'release/'+n);counts['release']+=1
 put(PACKAGE/'index.html.gz','release/client/web/dist/tankforge-range.html.gz')
 z.writestr('TankForge/release/frontend-app.js.html',app)
 for p in sorted((PACKAGE/'data').rglob('*')):
  if p.is_file():put(p,'release/data/'+p.relative_to(PACKAGE/'data').as_posix());counts['release']+=1
 selected={}
 for folder in ['client','crates','data','docs','scripts','handoff/tools','handoff/flight','handoff/tests','handoff/server','handoff/aircraft_assets']:
  if not (ROOT/folder).is_dir():continue
  for current,dirs,files in os.walk(ROOT/folder,followlinks=False):
   dirs[:]=[n for n in dirs if n not in skip and not (Path(current).relative_to(ROOT).as_posix()=='handoff/tests' and n=='out')]
   for n in files:
    p=Path(current)/n;rel=p.relative_to(ROOT).as_posix()
    if p.is_symlink() or n.startswith(('.env','id_rsa','id_ed25519','credentials')) or p.suffix.lower() in {'.pem','.key','.p12'} or rel in wip:continue
    if rel=='data/vehicles/ru_pantsir_sm_sv/surface_armor.json':continue
    selected[rel]=p
 for p in ROOT.iterdir():
  if p.is_file() and ((not p.name.startswith('.') and p.suffix in {'.toml','.lock','.json','.md','.sh','.txt'}) or p.name in {'LICENSE','NOTICE','COPYING','Makefile','Dockerfile','.gitignore','.gitattributes'}):selected[p.name]=p
 if (ROOT/'.cargo/config.toml').is_file():selected['.cargo/config.toml']=ROOT/'.cargo/config.toml'
 for p in (ROOT/'handoff/bundle').iterdir():
  if p.name in {'head.html','app.js.html'} or p.name.startswith('data.line.gz.part'):selected[p.relative_to(ROOT).as_posix()]=p
 for rel,p in sorted(selected.items()):
  name='TankForge/source-baseline/'+rel
  if rel=='handoff/bundle/app.js.html':z.writestr(name,app)
  elif rel=='handoff/tools/frontline_client.js':z.writestr(name,client)
  elif rel=='handoff/tests/frontline-round-client.test.mjs':z.writestr(name,'\n'.join(s for s in p.read_text().split('\n') if 'Older native versions supply no accepted elapsed clock' not in s))
  else:put(overrides.get(rel,p),'source-baseline/'+rel)
  counts['source']+=1
 for rel in sorted(set(overrides)|wip|{'handoff/tools/frontline_client.js','data/aircraft/frontline.json'}):
  p=ROOT/rel
  if p.is_file():put(p,'work-in-progress/'+rel);counts['wip']+=1
 z.writestr('TankForge/HANDOFF.json',json.dumps({'releaseBinarySha256':manifest['newBinarySha256'],'releaseAppSha256':manifest['appSha256'],'releasePageSha256':manifest['newPageSha256'],'nativeSourceReproducibleBuildCertified':False,'unfinishedChangesSeparate':True,'counts':counts},ensure_ascii=False,indent=2)+'\n')
with zipfile.ZipFile(OUT) as z:assert z.testzip() is None
h=hashlib.sha256()
with OUT.open('rb') as f:
 for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
result={'path':str(OUT),'bytes':OUT.stat().st_size,'sha256':h.hexdigest(),'counts':counts,'zipCrcPassed':True}
(QA/'handoff-archive.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))

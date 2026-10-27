#!/usr/bin/env python3
"""Create a bounded actual-client QA page from the current pinned tracked assets.

The gameplay world remains the real three-front map/60 actors. Only the client
asset catalog is bounded; retained model bytes are not converted or substituted.
"""
import argparse,gzip,hashlib,importlib.util,json,mmap,re,shutil,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];PIN='7a35444f326a3234f7bdf6ad84ff8d2a561edc00d1824740ebc236dd6bf46bd4'
CHUNK=1024*1024
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--out',type=Path,default=ROOT/'handoff/tests/out/three-front-browser-20261025');p.add_argument('--aircraft',help='Comma-separated exact source model IDs for a bounded aircraft QA scene');p.add_argument('--flight-upgrade-api',action='store_true',help='Expose read-only renderer/aircraft paths for offline upgrade QA');args=p.parse_args();out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(CHUNK),b''):h.update(b)
 return h.hexdigest()
subprocess.run(['python3',str(ROOT/'handoff/tools/sync_frontline_client.py'),'--check'],check=True)
scanner=out/'jscan';subprocess.run(['cc','-O2',str(ROOT/'handoff/tests/jscan.c'),'-o',str(scanner)],check=True)
with tempfile.TemporaryDirectory(prefix='tf-current-page-',dir=out) as tmp:
 tmp=Path(tmp);compressed=tmp/'assets.gz';raw=tmp/'assets.line'
 with compressed.open('wb') as dest:
  for part in sorted((ROOT/'handoff/bundle').glob('data.line.gz.part[0-9][0-9]')):
   with part.open('rb') as source:shutil.copyfileobj(source,dest,CHUNK)
 h=hashlib.sha256()
 with gzip.open(compressed,'rb') as source,raw.open('wb') as dest:
  for b in iter(lambda:source.read(CHUNK),b''):h.update(b);dest.write(b)
 assert h.hexdigest()==PIN,'Current assets differ from the reviewed Me262-family source'
 index=out/'keys2.txt'
 with index.open('wb') as dest:subprocess.run([str(scanner),str(raw),'2'],stdout=dest,check=True)
 rows=[]
 for line in index.read_text().splitlines():
  m=re.match(r'^( *)(\S+) ([{\[]) (\d+)\.\.(\d+)',line)
  if m:rows.append((len(m[1]),m[2],int(m[4]),int(m[5])+1))
 top={k:(a,b) for depth,k,a,b in rows if depth==0}
 with raw.open('rb') as source,mmap.mmap(source.fileno(),0,access=mmap.ACCESS_READ) as data:
  def children(key):
   a,b=top[key];return {k:(x,y) for depth,k,x,y in rows if depth==2 and a<x<y<b}
  keptVehicles=['proto_a','su_t72a','de_pzjg1','de_rso_pak40','su_att_m46'];keptAir=args.aircraft.split(',') if args.aircraft else ['su25','mig21','f15c','me262','me262a2a','me262u4'];retained={}
  assert keptAir and len(set(keptAir))==len(keptAir) and all(re.fullmatch(r'[a-z0-9_]+',id) for id in keptAir),'Invalid or duplicate aircraft IDs'
  def selected(key,names,require=True):
   entries=children(key);values=[]
   for name in names:
    if not require and name not in entries:continue
    a,b=entries[name];value=data[a:b];json.loads(value);retained[f'{key}.{name}']={'bytes':b-a,'sha256':hashlib.sha256(value).hexdigest()};values.append(json.dumps(name).encode()+b':'+value)
   return b'{'+b','.join(values)+b'}'
  replacements={key:b'{}' for key in ['maps','fullAudio','storeModels','reloadAudio','images','mgModels'] if key in top}
  replacements.update(vehicles=selected('vehicles',keptVehicles),surfaceCatalog=selected('surfaceCatalog',keptVehicles,False),aircraftModels=selected('aircraftModels',keptAir),order=json.dumps(keptVehicles).encode())
  assetline=out/'data.frontline.current.line'
  with assetline.open('wb') as dest:
   cursor=0
   for a,b,value in sorted((*top[k],v) for k,v in replacements.items()):
    assert a>=cursor
    for i in range(cursor,a,CHUNK):dest.write(data[i:min(i+CHUNK,a)])
    dest.write(value);cursor=b
   for i in range(cursor,len(data),CHUNK):dest.write(data[i:min(i+CHUNK,len(data))])
head=ROOT/'handoff/bundle/head.html';appfile=ROOT/'handoff/bundle/app.js.html';app=appfile.read_text();marker='    window.__tf = {';assert app.count(marker)==1
hooks="""    // QA only: skip legacy garage thumbnail work; native simulation is unchanged.
    if(G4.mode==='garage'){G4.paused=true;G4.thumbs.length=0;G4.airThumbQ=[];airGarage.thumbsDone=true;hud.loading(null);}
    window.__tfx={data,flightCoreP,Aircraft,AIRCRAFT_TYPES,exitAircraft};
"""
if args.flight_upgrade_api:
 hooks += """    // Offline upgrade QA: actual renderer/model paths, never used by a deployment page.
    Object.assign(window.__tfx,{AIRCRAFT_MODELS,AIR_FIGHTERS,enterAircraft,clearBots,airEl,aircraftGuns,aircraftGeometry,storeImpact,
      engineLayout:typeof TFEngineLayout==='undefined'?null:TFEngineLayout,
      mechanismFit:typeof TFMechanismFit==='undefined'?null:TFMechanismFit,
      mechanismView:typeof TFMechanismView==='undefined'?null:TFMechanismView});
"""
app=app.replace(marker,hooks+marker).replace(': rangeVehicleTargets();',': rangeVehicleTargets().filter(t=>data.vehicles[t.id]);')
page=out/'dev.html';h=hashlib.sha256()
with page.open('wb') as dest:
 for file in [head,assetline]:
  with file.open('rb') as source:
   for b in iter(lambda:source.read(CHUNK),b''):h.update(b);dest.write(b)
 b=app.encode();h.update(b);dest.write(b)
assert page.stat().st_size<(100 if args.aircraft else 70)*1024*1024,'Unexpected bounded QA payload size'
manifest={'purpose':'Actual current client/source models/three-front native QA; bounded client catalog only, no world/physics reduction','baselineSha256':PIN,'currentAppSha256':sha(appfile),'headSha256':sha(head),'page':str(page),'pageSha256':h.hexdigest(),'pageBytes':page.stat().st_size,'retainedVehicles':keptVehicles,'retainedAircraftModels':keptAir,'retainedSourceBytes':retained,'omittedOptionalMedia':list(k for k in replacements if k not in ['vehicles','surfaceCatalog','order','aircraftModels']),'fixtureSourceEdits':['skip initial legacy garage thumbnails','read-only QA API exposure','filter omitted range targets'],'nativeSimulationStateInjected':False,'productionDeploymentAsset':False}
(out/'page-provenance.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest,indent=2))

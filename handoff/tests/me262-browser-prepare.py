#!/usr/bin/env python3
"""Bounded offline page from pinned asset bytes and the actual current game code."""
import argparse,base64,hashlib,json,mmap,re,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
P=runpy.run_path(str(Path(__file__).with_name('public-air-radar-prepare.py')))
sha=P['sha'];base=P['BASELINE'];index=P['INDEX']
assert sha(base)==P['BASE_SHA'] and sha(index)==P['INDEX_SHA']
parser=argparse.ArgumentParser();parser.add_argument('--app',type=Path,default=ROOT/'handoff/bundle/app.js.html');parser.add_argument('--head',type=Path,default=ROOT/'handoff/bundle/head.html');parser.add_argument('--out',type=Path,default=ROOT/'handoff/tests/out/me262-game-v2-20261025/browser');args=parser.parse_args()
out=args.out.resolve();out.mkdir(parents=True,exist_ok=True)
assets=ROOT/'handoff/aircraft_assets/me262-game-v2-20261025'
records={id:assets/(id+'.json') for id in ['me262','me262a2a','me262u4']}
models={id:p.read_bytes().strip() for id,p in records.items()}
rows=[]
for line in index.read_text().splitlines():
 m=re.match(r'^( *)(\S+) ([{\[]) (\d+)\.\.(\d+)',line)
 if m:rows.append((len(m[1]),m[2],int(m[4]),int(m[5])+1))
top={k:(a,b) for d,k,a,b in rows if d==0}
head=args.head.resolve();appfile=args.app.resolve();app=appfile.read_text()
assert app.count('    window.__tf = {')==1
hooks="""    // OFFLINE QA ONLY: expose actual game paths and skip garage thumbnails.
    if(G4.mode==='garage'){G4.paused=true;G4.thumbs.length=0;G4.airThumbQ=[];airGarage.thumbsDone=true;hud.loading(null);}
    window.__tfx={data,flightCoreP,loadFlightCore,Aircraft,AIRCRAFT_TYPES,AIR_FIGHTERS,AIRCRAFT_MODELS,AIR_EQUIP,AIR_RADARS,
      enterAircraft,exitAircraft,clearBots,airBots,airOrdnance,airEl,aircraftSightAperture,project,
      mountStores,layoutStores,airLoadouts,aircraftGuns,releaseStore,applyStoreLoad,drawOrdnance,storeMesh,storeLodStep,aircraftGeometry};
"""
app=app.replace('    window.__tf = {',hooks+'    window.__tf = {').replace(': rangeVehicleTargets();',': rangeVehicleTargets().filter(t=>data.vehicles[t.id]);')
with base.open('rb') as f,mmap.mmap(f.fileno(),0,access=mmap.ACCESS_READ) as data:
 a,b=top['vehicles'];vehicles={k:(x,y) for d,k,x,y in rows if d==2 and a<x<y<b}
 keep=['proto_a'];v=b'{'+b','.join(json.dumps(k).encode()+b':'+data[s:e] for k in keep for s,e in [vehicles[k]])+b'}'
 replacements={k:b'{}' for k in ['surfaceCatalog','maps','fullAudio','reloadAudio','images','storeModels','mgModels']}
 replacements.update(vehicles=v,order=json.dumps(keep).encode(),aircraftModels=b'{'+b','.join(json.dumps(k).encode()+b':'+v for k,v in models.items())+b'}')
 edits=sorted((*top[k],v) for k,v in replacements.items())
 page=out/'dev.html';h=hashlib.sha256()
 with page.open('wb') as dest:
  def write(b):dest.write(b);h.update(b)
  def copy(a,b):
   for i in range(a,b,1024*1024):write(data[i:min(i+1024*1024,b)])
  write(head.read_bytes());cursor=0
  for a,b,v in edits:copy(cursor,a);write(v);cursor=b
  copy(cursor,len(data));write(app.encode())
manifest={'purpose':'Actual offline Me262 model, gear, source interiors and weapon paths; not deployment or GPU performance certification',
 'baselineSha256':sha(base),'head':str(head),'headSha256':sha(head),'app':str(appfile),'appSha256':sha(appfile),
 'models':{k:{'path':str(p),'sha256':sha(p)} for k,p in records.items()},'page':str(page),'pageBytes':page.stat().st_size,'pageSha256':h.hexdigest(),
 'fixtureEdits':['read-only game API exposure','pause initial garage and skip thumbnails','filter omitted range targets'],'omittedOptionalData':list(replacements)}
(out/'page-provenance.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps(manifest,indent=2))

#!/usr/bin/env python3
"""Bounded OFFLINE QA page from public f3 assets + explicitly supplied final app/records.

Never uses implementation head/app, deploys, starts a process, or copies the
378 MB source. --check computes the planned byte budget without writing a page.
"""
import argparse
import base64
import hashlib
import json
import mmap
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[2]
BASELINE=Path('/home/boyang/Desktop/worldbox/tankforge-jet-fixes/handoff/tests/out/parked-roll-f3c6d88-20261024/committed-data.line')
BASE_SHA='56eaa206dfda19a831d1c82c869e411d1c3ba7e82d979ff6f96b13dd3a0366ee'
INDEX=ROOT/'handoff/tests/out/frontline-browser-20261024/keys2.txt'
INDEX_SHA='264ad1adfbe46b9f2387b16fb77e697dbaf2a1046eb1176743fa3be1924c5d8b'
DEFAULT_OUT=ROOT/'handoff/tests/out/public-air-radar-20261025'
CHUNK=1024*1024

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(CHUNK),b''):h.update(b)
    return h.hexdigest()

def prepare(args):
    assert BASELINE.stat().st_size==377797380 and sha(BASELINE)==BASE_SHA
    assert sha(INDEX)==INDEX_SHA,'Index belongs to a different source scan'
    head=args.head.read_bytes();app=args.app.read_text()
    assert args.app.resolve()!=(ROOT/'handoff/bundle/app.js.html').resolve(),'Unpublished implementation app is forbidden'
    assert 'BEGIN NATIVE FRONTLINE CLIENT' not in app and 'service_air' not in app
    assert 'function padRadarDogfight()' in app,'Final public app must include the ground-radar patch'
    core=re.search(r'var FLIGHT_CORE_WASM = "([A-Za-z0-9+/=]+)";',app)
    assert core,'Missing actual public flight WASM'
    flight=base64.b64decode(core[1],validate=True)
    assert hashlib.sha256(flight).hexdigest()=='a52a939b991eee2ac7c64f2a3aabb6b5ab7f69142d4bd887e2fc12bc268d1342'
    records={}
    for name,path in [('mig17f',args.mig17),('f104g',args.f104)]:
        raw=path.read_bytes().strip();record=json.loads(raw)
        assert record['type']==name and record['version']==2 and record['parts']
        assert b'</script' not in raw.lower()
        records[name]=raw
    rows=[]
    for line in INDEX.read_text().splitlines():
        m=re.match(r'^( *)(\S+) ([{\[]) (\d+)\.\.(\d+)',line)
        if m:rows.append((len(m[1]),m[2],int(m[4]),int(m[5])+1))
    top={name:(a,b) for depth,name,a,b in rows if depth==0}
    retained=['de_gepard','ru_pantsir_sm_sv','proto_a']
    with BASELINE.open('rb') as source,mmap.mmap(source.fileno(),0,access=mmap.ACCESS_READ) as data:
        def children(name):
            a,b=top[name]
            return {key:(x,y) for depth,key,x,y in rows if depth==2 and a<x<y<b}
        vehicles=children('vehicles');assert set(retained)<=vehicles.keys()
        vehicle_value=b'{'+b','.join(json.dumps(name).encode()+b':'+data[s:e] for name in retained for s,e in [vehicles[name]])+b'}'
        replacement={name:b'{}' for name in ['surfaceCatalog','maps','fullAudio','reloadAudio','images','storeModels','mgModels']}
        replacement.update(vehicles=vehicle_value,order=json.dumps(retained).encode(),
            aircraftModels=b'{'+b','.join(json.dumps(name).encode()+b':'+raw for name,raw in records.items())+b'}')
        edits=sorted((*top[name],raw) for name,raw in replacement.items())
        old=': rangeVehicleTargets();'
        assert app.count(old)==1;app=app.replace(old,': rangeVehicleTargets().filter(t => data.vehicles[t.id]);')
        marker='    window.__tf = {';assert app.count(marker)==1
        hooks='''    // QA ONLY: native offline scenes; skip only legacy card-thumbnail work.
    if (G4.mode === "garage") { G4.paused=true; G4.thumbs.length=0; G4.airThumbQ=[]; airGarage.thumbsDone=true; hud.loading(null); }
    window.__tfx={data,flightCoreP,loadFlightCore,Aircraft,AIRCRAFT_TYPES,AIR_FIGHTERS,AIRCRAFT_MODELS,AIR_RADARS,AIR_EQUIP,RADAR_ACM,
      surfaceAt,project,sub,norm,cross,dirFrom2,enterAircraft,exitAircraft,clearBots,spawnBot,airBots,airOrdnance,airEl,aircraftSightAperture,
      adHead,adUnitOf,padAction,padRadarDogfight,padRadarSense,stepPlayerAd,drawPlayerAd,airCtl};
'''
        patched_app=app.replace(marker,hooks+marker).encode()
        estimated=len(head)+len(data)+sum(len(raw)-(e-s) for s,e,raw in edits)+len(patched_app)
        assert estimated<45*1024*1024,'Unexpectedly large bounded QA page'
        manifest={'purpose':'OFFLINE public f3 AA/MiG17/F104 renderer + native flight QA; not a deployment package',
            'baseline':str(BASELINE),'baselineBytes':len(data),'baselineSha256':BASE_SHA,
            'freshMatchedIndex':str(INDEX),'indexSha256':INDEX_SHA,'head':str(args.head),'headSha256':sha(args.head),
            'publicApp':str(args.app),'publicAppSha256':sha(args.app),'qaAppSha256':hashlib.sha256(patched_app).hexdigest(),
            'nativeRecords':{name:{'path':str(path),'sha256':sha(path),'bytes':len(records[name])} for name,path in [('mig17f',args.mig17),('f104g',args.f104)]},
            'retainedVehicles':retained,'retainedAircraftModels':['mig17f','f104g'],
            'preservedCores':['embedded FLIGHT_CORE_WASM212','data.designCore','data.surfaceCore'],
            'flightWasmSha256':hashlib.sha256(flight).hexdigest(),'flightWasmBytes':len(flight),
            'omittedOptionalData':list(name for name in replacement if name not in ['vehicles','order','aircraftModels']),
            'fixtureSourceEdits':['filter missing range targets','read-only QA API exposure','pause initial garage; skip legacy thumbnails'],
            'pageBytes':estimated,'page':str(args.out/'dev.html'),'checkOnly':args.check}
        if not args.check:
            args.out.mkdir(parents=True,exist_ok=True);digest=hashlib.sha256()
            with (args.out/'dev.html').open('wb') as dest:
                def write(raw):dest.write(raw);digest.update(raw)
                def copy(s,e):
                    for i in range(s,e,CHUNK):write(data[i:min(i+CHUNK,e)])
                write(head);cursor=0
                for start,end,raw in edits:copy(cursor,start);write(raw);cursor=end
                copy(cursor,len(data));write(patched_app)
            assert (args.out/'dev.html').stat().st_size==estimated
            manifest['pageSha256']=digest.hexdigest()
            (args.out/'page-provenance.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
        return manifest

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--head',type=Path,required=True);p.add_argument('--app',type=Path,required=True)
    p.add_argument('--mig17',type=Path,required=True);p.add_argument('--f104',type=Path,required=True)
    p.add_argument('--out',type=Path,default=DEFAULT_OUT);p.add_argument('--check',action='store_true')
    print(json.dumps(prepare(p.parse_args()),ensure_ascii=False,indent=2))
if __name__=='__main__':main()

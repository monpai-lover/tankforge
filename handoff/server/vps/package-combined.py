#!/usr/bin/env python3
"""Prepare a pinned combined-mode candidate; --seal requires live QA evidence."""
import argparse,gzip,hashlib,json,re,shutil,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
PACKAGE=ROOT/'handoff/server/dist/tankforge-combined-20261025'
QA=ROOT/'handoff/tests/out/combined-release-20261025'
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def tree(p):
    h=hashlib.sha256()
    for f in sorted(p.rglob('*')):
        if f.is_symlink():raise ValueError('Symlink in runtime data')
        if f.is_file():h.update((f.relative_to(p).as_posix()+'\0'+sha(f)+'\0').encode())
    return h.hexdigest()
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--seal',action='store_true')
    parser.add_argument('--release-name',default='tankforge-combined-20261025')
    parser.add_argument('--qa-dir',type=Path,default=QA)
    parser.add_argument('--baseline',type=Path,default=ROOT/'handoff/server/dist/tankforge-page-update-20261025-u4-audio/release.json')
    parser.add_argument('--native-log',type=Path,default=ROOT/'handoff/tests/out/three-front-native-20261025/resumed-full-lib-final.log')
    parser.add_argument('--node-log',type=Path,default=ROOT/'handoff/tests/out/three-front-native-20261025/resumed-full-node-2.log')
    parser.add_argument('--extra-evidence',type=Path,help='JSON list of label/path/key entries, relative to qa-dir')
    parser.add_argument('--scope',default='Combined ground/air frontline foundation with physical support/facilities and team perception; advanced troop types/AA/guided avionics/automatic round reset remain tracked separately')
    args=parser.parse_args();assert re.fullmatch(r'tankforge-[a-z0-9-]+',args.release_name),'Invalid release name'
    package=ROOT/'handoff/server/dist'/args.release_name;qa=args.qa_dir.resolve()
    required=[('ground','ground-browser/result.json','pass'),('taiwan','taiwan-browser/result.json','pass'),('service','service-browser/result.json','functionalPass'),('solo','wire-solo.json','passed'),('mixed','wire-mixed.json','passed')]
    if args.extra_evidence:
        required.extend((r['label'],r['path'],r['key']) for r in json.loads(args.extra_evidence.read_text()))
    assert len(set(r[0] for r in required))==len(required),'Duplicate evidence label'
    if args.seal:
        m=json.loads((package/'candidate.json').read_text());assert sha(package/'tg-server')==m['newBinarySha256'] and tree(package/'data')==m['newDataSha256']
        assert m['requiredEvidence']==[r[0] for r in required],'Seal must use the candidate evidence policy'
        evidence={}
        for label,name,key in required:
            p=(qa/name).resolve();assert p.is_relative_to(qa),'Evidence escapes QA directory'
            d=json.loads(p.read_text());assert d.get(key) is True,(label,d.get('failure'));evidence[label]={'path':str(p.relative_to(ROOT)),'sha256':sha(p)}
        m['evidence']=evidence;(package/'release.json').write_text(json.dumps(m,indent=2)+'\n');print(json.dumps({'sealed':True,'release':str(package/'release.json')}));return
    native=args.native_log;node=args.node_log
    assert 'test result: ok.' in native.read_text() and '# fail 0' in node.read_text(),'Current full tests must pass'
    provenance=json.loads((qa/'current-page/page-provenance.json').read_text());assert sha(ROOT/'handoff/bundle/app.js.html')==provenance['currentAppSha256']
    package.mkdir(parents=True,exist_ok=True);assert not (package/'release.json').exists(),'Use a new release directory after a sealed release'
    old=json.loads(args.baseline.read_text());old_binary=old.get('newBinarySha256',old.get('binarySha256'))
    deployed=Path('/opt/tankforge');assert sha(deployed/'target/release/tg-server')==old_binary and sha(deployed/'client/web/dist/tankforge-range.html')==old['newPageSha256']
    assert sha(deployed/'client/web/dist/tankforge-range.html.gz')==old['newGzipSha256']
    if 'newDataSha256' in old:assert tree(deployed/'data')==old['newDataSha256']
    data=package/'data';assert not data.exists(),'Candidate already exists; never overwrite prior evidence'
    shutil.copytree(deployed/'data',data)
    files=[]
    for name in ['materials.json','machine_guns.json','missiles.json','terrains.json','aircraft/aircraft.json','aircraft/frontline.json','frontline/korea.json','frontline/taiwan.json']:
        files.append(ROOT/'data'/name)
    files.extend((ROOT/'data/projectiles').glob('*.json'));files.extend((ROOT/'data/maps').glob('*/map.json'))
    for folder in (ROOT/'data/vehicles').iterdir():
        if not (folder/'vehicle.json').is_file():continue
        definition=json.loads((folder/'vehicle.json').read_text());names={'vehicle.json'}
        for key in ['armor','weapons','engine','crew','modules','visual']:
            name=definition['files'].get(key)
            if name:
                relative=Path(name);assert not relative.is_absolute() and '..' not in relative.parts;names.add(name)
        # This release adds native campaign physics, not an unverified switch
        # of the existing legacy vehicle damage model to experimental surfaces.
        if (folder/'surface_armor.json').is_file() and (deployed/'data/vehicles'/folder.name/'surface_armor.json').is_file():names.add('surface_armor.json')
        files.extend(folder/name for name in names)
    for source in files:
        destination=data/source.relative_to(ROOT/'data');destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,destination)
    binary=ROOT/'target/release/tg-server';shutil.copy2(binary,package/'tg-server')
    output=package/'index.html.gz';h=hashlib.sha256();asset=hashlib.sha256();size=0
    with tempfile.TemporaryDirectory(prefix='tf-combined-package-') as temporary:
        raw=Path(temporary)/'assets.gz'
        with raw.open('wb') as f:
            for part in sorted((ROOT/'handoff/bundle').glob('data.line.gz.part[0-9][0-9]')):
                with part.open('rb') as src:shutil.copyfileobj(src,f,1024*1024)
        with output.open('wb') as f,gzip.GzipFile(filename='',fileobj=f,mode='wb',compresslevel=9,mtime=0) as gz:
            def write(b):
                nonlocal size
                h.update(b);size+=len(b);gz.write(b)
            write((ROOT/'handoff/bundle/head.html').read_bytes())
            with gzip.open(raw,'rb') as src:
                for b in iter(lambda:src.read(1024*1024),b''):asset.update(b);write(b)
            assert asset.hexdigest()==old['assetPinUnchanged']
            write((ROOT/'handoff/bundle/app.js.html').read_bytes())
    updater=Path(__file__).with_name('update-combined.py');shutil.copy2(updater,package/updater.name)
    m={'version':args.release_name.removeprefix('tankforge-'),'scope':args.scope,'requiredEvidence':[r[0] for r in required],
       'oldPageSha256':old['newPageSha256'],'oldGzipSha256':old['newGzipSha256'],'oldBinarySha256':old_binary,'oldDataSha256':tree(deployed/'data'),
       'newPageSha256':h.hexdigest(),'newPageBytes':size,'newGzipSha256':sha(output),'newBinarySha256':sha(package/'tg-server'),'newDataSha256':tree(data),
       'appSha256':sha(ROOT/'handoff/bundle/app.js.html'),'headSha256':sha(ROOT/'handoff/bundle/head.html'),'assetPinUnchanged':asset.hexdigest(),
       'maps':{name:sha(data/'frontline'/f'{name}.json') for name in ['korea','taiwan']},'profileSha256':sha(data/'aircraft/frontline.json'),'updaterSha256':sha(package/updater.name),
       'fullNativeTestLogSha256':sha(native),'fullNodeTestLogSha256':sha(node),'overlaidDataFiles':len(files)}
    (package/'candidate.json').write_text(json.dumps(m,indent=2)+'\n');print(json.dumps(m,indent=2))
if __name__=='__main__':main()

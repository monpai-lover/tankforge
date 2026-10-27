#!/usr/bin/env python3
"""Atomically install the pinned audio page. Page files are opened per request,
so this client-only update preserves the running process and active rooms.
"""
import argparse,gzip,hashlib,json,os,shutil,time,urllib.request
from pathlib import Path
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--dry-run',action='store_true');p.add_argument('package',type=Path);a=p.parse_args()
    package=a.package.resolve();m=json.loads((package/'release.json').read_text());target=Path(os.environ.get('TARGET','/opt/tankforge')).resolve();port=int(os.environ.get('PORT','8787'))
    page=target/'client/web/dist/tankforge-range.html';compressed=Path(str(page)+'.gz');source=package/'index.html.gz'
    binary=target/'target/release/tg-server';catalog=target/'data/aircraft/aircraft.json'
    assert sha(binary)==m['binarySha256'] and sha(catalog)==m['catalogSha256'],'Runtime/catalog changed; no mutation'
    assert sha(source)==m['newGzipSha256'],'Package gzip changed'
    assert sha(Path(__file__))==m['updaterSha256'],'Updater changed'
    h=hashlib.sha256();count=0
    with gzip.open(source,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b);count+=len(b)
    assert h.hexdigest()==m['newPageSha256'] and count==m['newPageBytes'],'Truncated package'
    current=(sha(page),sha(compressed));old=(m['oldPageSha256'],m['oldGzipSha256']);new=(m['newPageSha256'],m['newGzipSha256'])
    assert current in (old,new),'Published page differs from inspected baseline; no mutation'
    if a.dry_run:print(json.dumps({'validated':True,'alreadyInstalled':current==new,'dryRun':True}));return
    assert shutil.disk_usage(page.parent).free>2*(count+source.stat().st_size)+64*1024*1024,'Insufficient staging/rollback disk space'
    stamp=time.strftime('%Y%m%d%H%M%S')+'-'+str(os.getpid());destinations=[page,compressed];staged=[Path(str(x)+'.new-'+stamp) for x in destinations];backups=[Path(str(x)+'.bak-'+stamp) for x in destinations];switched=[]
    try:
        if current!=new:
            with gzip.open(source,'rb') as src,staged[0].open('xb') as dst:shutil.copyfileobj(src,dst,1024*1024)
            shutil.copy2(source,staged[1])
            for dst,backup in zip(destinations,backups):shutil.copy2(dst,backup)
            assert (sha(page),sha(compressed))==old,'Page changed during staging'
            assert sha(binary)==m['binarySha256'] and sha(catalog)==m['catalogSha256']
            for src,dst in zip(staged,destinations):os.replace(src,dst);switched.append(dst)
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/health',timeout=5) as r:assert r.read()==b'ok'
        hashes={}
        for encoding,expected in [('identity',m['newPageSha256']),('gzip',m['newGzipSha256'])]:
            h=hashlib.sha256();request=urllib.request.Request(f'http://127.0.0.1:{port}/',headers={'Accept-Encoding':encoding})
            with urllib.request.urlopen(request,timeout=60) as r:
                assert (r.headers.get('Content-Encoding')=='gzip')==(encoding=='gzip')
                for b in iter(lambda:r.read(1024*1024),b''):h.update(b)
            assert h.hexdigest()==expected,'HTTP served stale or mismatched page';hashes[encoding]=h.hexdigest()
        assert sha(binary)==m['binarySha256'] and sha(catalog)==m['catalogSha256']
        receipt={'installed':True,'servedSha256':hashes,'serverRestarted':False,'backups':[str(x) for x in backups] if switched else []}
        Path(str(page)+'.audio-release.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
    except BaseException:
        for dst,backup in zip(destinations,backups):
            if dst in switched:
                restore=Path(str(dst)+'.restore-'+stamp);shutil.copy2(backup,restore);os.replace(restore,dst)
        raise
    finally:
        for x in staged:x.unlink(missing_ok=True)
if __name__=='__main__':main()

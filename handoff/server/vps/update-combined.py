#!/usr/bin/env python3
"""Install the sealed binary/data/page as one rollback group on this VPS."""
import argparse,gzip,hashlib,json,os,shutil,signal,subprocess,time,urllib.request
from pathlib import Path
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def tree(p):
    h=hashlib.sha256()
    for f in sorted(p.rglob('*')):
        assert not f.is_symlink(),'Symlink in runtime data'
        if f.is_file():h.update((f.relative_to(p).as_posix()+'\0'+sha(f)+'\0').encode())
    return h.hexdigest()
def running(service):
    pid=int(subprocess.check_output(['systemctl','show','-p','MainPID','--value',service]));assert pid>1,'Service is not running'
    p=Path('/proc')/str(pid);return {'pid':pid,'startTicks':p.joinpath('stat').read_text().rsplit(')',1)[1].split()[19],'imageSha256':sha(p/'exe'),'uid':p.stat().st_uid}
def restart(service,before):
    restarted=False
    for cmd in [['systemctl','restart',service],['sudo','-n','systemctl','restart',service]]:
        if shutil.which(cmd[0]) and subprocess.run(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:restarted=True;break
    if not restarted:
        assert running(service)==before and before['uid']==os.getuid(),'Service identity changed; refusing to signal'
        os.kill(before['pid'],signal.SIGTERM)
    for _ in range(60):
        try:
            current=running(service)
            if (current['pid'],current['startTicks'])!=(before['pid'],before['startTicks']):return current
        except (AssertionError,OSError):pass
        time.sleep(.5)
    raise RuntimeError('Updated service did not start')
def verify(port,m):
    base=f'http://127.0.0.1:{port}'
    for _ in range(40):
        try:
            with urllib.request.urlopen(base+'/health',timeout=3) as f:
                if f.read()==b'ok':break
        except OSError:time.sleep(.5)
    else:raise RuntimeError('Health check failed')
    hashes={}
    for encoding,expected in [('identity',m['newPageSha256']),('gzip',m['newGzipSha256'])]:
        h=hashlib.sha256();request=urllib.request.Request(base+'/',headers={'Accept-Encoding':encoding})
        with urllib.request.urlopen(request,timeout=60) as f:
            for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
        assert h.hexdigest()==expected,'Served page differs from release';hashes[encoding]=h.hexdigest()
    with urllib.request.urlopen(base+'/frontline/maps.json',timeout=15) as f:maps=json.load(f)
    assert {v['id']:v['sha256'] for v in maps['maps']}==m['maps'],'Native map registry differs'
    return hashes
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--dry-run',action='store_true');p.add_argument('package',type=Path);a=p.parse_args();package=a.package.resolve()
    m=json.loads((package/'release.json').read_text())
    required=m.get('requiredEvidence',['ground','taiwan','service','solo','mixed'])
    assert len(required)>=5 and len(set(required))==len(required) and set(m['evidence'])==set(required),'Candidate is not sealed'
    target=Path(os.environ.get('TARGET','/opt/tankforge')).resolve();service=os.environ.get('SERVICE','tankforge');port=int(os.environ.get('PORT','8787'))
    binary=target/'target/release/tg-server';data=target/'data';page=target/'client/web/dist/tankforge-range.html';gz=Path(str(page)+'.gz')
    assert sha(Path(__file__))==m['updaterSha256'] and sha(package/'tg-server')==m['newBinarySha256'] and tree(package/'data')==m['newDataSha256'] and sha(package/'index.html.gz')==m['newGzipSha256']
    before=running(service);current=(sha(binary),tree(data),sha(page),sha(gz));old=tuple(m[k] for k in ['oldBinarySha256','oldDataSha256','oldPageSha256','oldGzipSha256']);new=tuple(m[k] for k in ['newBinarySha256','newDataSha256','newPageSha256','newGzipSha256'])
    assert current in (old,new),'Deployment changed from pinned baseline; no files changed'
    if current==new:
        assert before['imageSha256']==m['newBinarySha256'];print(json.dumps({'alreadyInstalled':True,'verified':verify(port,m)}));return
    assert before['imageSha256']==m['oldBinarySha256']
    h=hashlib.sha256();count=0
    with gzip.open(package/'index.html.gz','rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b);count+=len(b)
    assert h.hexdigest()==m['newPageSha256'] and count==m['newPageBytes']
    assert shutil.disk_usage(target).free>2*(count+(package/'index.html.gz').stat().st_size)+512*1024*1024
    if a.dry_run:print(json.dumps({'validated':True,'dryRun':True,'process':before}));return
    stamp=time.strftime('%Y%m%d%H%M%S')+'-'+str(os.getpid());destinations=[binary,page,gz];staged=[Path(str(x)+'.new-'+stamp) for x in destinations];backups=[Path(str(x)+'.bak-'+stamp) for x in destinations];data_stage=Path(str(data)+'.new-'+stamp);data_backup=Path(str(data)+'.bak-'+stamp);switched=[];data_moved=False;new_process=None
    try:
        shutil.copy2(package/'tg-server',staged[0]);shutil.copy2(package/'index.html.gz',staged[2]);shutil.copytree(package/'data',data_stage)
        with gzip.open(package/'index.html.gz','rb') as src,staged[1].open('xb') as dst:shutil.copyfileobj(src,dst,1024*1024)
        for dst,backup in zip(destinations,backups):shutil.copy2(dst,backup)
        assert (sha(binary),tree(data),sha(page),sha(gz))==old and running(service)==before,'Deployment changed during staging'
        os.replace(data,data_backup);data_moved=True;os.replace(data_stage,data)
        for src,dst in zip(staged,destinations):os.replace(src,dst);switched.append(dst)
        new_process=restart(service,before);assert new_process['imageSha256']==m['newBinarySha256']
        served=verify(port,m);receipt={'installed':True,'process':new_process,'servedSha256':served,'backups':[str(x) for x in backups]+[str(data_backup)]}
        (target/('combined-release-'+stamp+'.json')).write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
    except BaseException:
        prior=None
        try:prior=running(service)
        except (AssertionError,OSError):pass
        for dst,backup in zip(destinations,backups):
            if dst in switched:restore=Path(str(dst)+'.restore-'+stamp);shutil.copy2(backup,restore);os.replace(restore,dst)
        if data_moved:
            if data.exists():os.replace(data,Path(str(data)+'.failed-'+stamp))
            os.replace(data_backup,data)
        if prior and (prior['pid'],prior['startTicks'])!=(before['pid'],before['startTicks']):restart(service,prior)
        raise
    finally:
        for f in staged:f.unlink(missing_ok=True)
        if data_stage.exists():shutil.rmtree(data_stage)
if __name__=='__main__':main()

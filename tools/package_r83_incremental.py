#!/usr/bin/env python3
"""Package exact replacement files for an existing verified R8.2 installation."""
import argparse,hashlib,io,json,tarfile
from pathlib import Path
from package_current_linux import inspect_elf,sha
from rebuild_current_handoff import RELEASE_SHA256

def package(root,page,server,output):
    root,page,server,output=map(lambda p:Path(p).resolve(),(root,page,server,output))
    if output.exists():raise ValueError('Choose a new output archive')
    if sha(page)!=RELEASE_SHA256:raise ValueError('Release HTML pin differs')
    elf=inspect_elf(server)
    files={'tg-server':server,'tankforge-r83.html':page,**{s:root/s for s in ['data/aircraft/frontline.json','data/frontline/taiwan-escort.json','data/frontline/scenarios/taiwan-landing-escort.json']}}
    embedded={'start.sh':b'#!/bin/sh\nset -eu\ncd -- "$(dirname -- "$0")"\nexec ./tg-server --bind "${TF_BIND:-0.0.0.0}" --port "${TF_PORT:-8787}" --data ./data --page ./tankforge-r83.html\n',
      'README.txt':('TankForge R8.3 incremental replacements for R8.2\n\n'
        'Requires the verified R8.2 complete installation. Base HTML SHA256:\n'
        'eeac869b23139cbcfd05512e3c6ab016c8032015704e4bb0168af5d4cc22ee3f\n'
        'This is NOT a standalone package. All existing data/config must be retained.\n'
        'For unknown server versions, use the R8.3 complete package instead.\n'
        'Stop the old server; extract this archive to a temporary directory.\n'
        'Back up the existing server/page and the listed replaced data files.\n'
        'Copy these files over the existing installation without removing other data/config.\n'
        'Run: chmod +x tg-server start.sh && ./start.sh\n'
        'Keep HTTP and /ws on the same updated service. Refresh old browser caches.\n'
        'No production server was changed by this packaging tool.\n').encode()}
    manifest={n:{'bytes':p.stat().st_size,'sha256':sha(p)}for n,p in files.items()}
    manifest.update({n:{'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}for n,b in embedded.items()})
    embedded['manifest.json']=(json.dumps({'schema':'TankForgeIncrementalV1','baseRelease':'R8.2','htmlSha256':RELEASE_SHA256,'elf':elf,'files':manifest},indent=2)+'\n').encode()
    prefix=output.name.removesuffix('.tar.gz')
    with output.open('xb')as f,tarfile.open(fileobj=f,mode='w:gz',compresslevel=6)as t:
      for n,p in files.items():
        info=t.gettarinfo(str(p),arcname=prefix+'/'+n);info.uid=info.gid=0;info.uname=info.gname='';info.mode=0o755 if n=='tg-server' else 0o644
        with p.open('rb')as r:t.addfile(info,r)
      for n,b in embedded.items():
        info=tarfile.TarInfo(prefix+'/'+n);info.size=len(b);info.mode=0o755 if n=='start.sh' else 0o644;t.addfile(info,io.BytesIO(b))
    count=0
    with tarfile.open(output,'r:gz')as t:
      for m in t:
        n=m.name.removeprefix(prefix+'/')
        if n=='manifest.json':continue
        h=hashlib.sha256();size=0
        with t.extractfile(m)as f:
          while b:=f.read(1024*1024):size+=len(b);h.update(b)
        if {'bytes':size,'sha256':h.hexdigest()}!=manifest[n]:raise ValueError('Archive mismatch: '+n)
        count+=1
    result={'archive':str(output),'bytes':output.stat().st_size,'sha256':sha(output),'verifiedFiles':count,'requiresBaseRelease':'R8.2','htmlSha256':RELEASE_SHA256,'serverSha256':sha(server)}
    output.with_name(output.name+'.receipt.json').write_bytes((json.dumps(result,indent=2)+'\n').encode());return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',default=Path(__file__).resolve().parents[1]);p.add_argument('--page',required=True);p.add_argument('--server',required=True);p.add_argument('--output',required=True);a=p.parse_args();print(json.dumps(package(a.root,a.page,a.server,a.output),indent=2))

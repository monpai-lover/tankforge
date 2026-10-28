#!/usr/bin/env python3
"""Create a new complete Linux amd64 package from explicit, verified inputs.

Does not deploy, stop services, modify the source tree or overwrite an archive.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import struct
import tarfile
# Archived R8.5 packager: preserve its original identity after current releases advance.
RELEASE_SHA256 = 'c40762271537e5377100b660289db7081d65c6f3401dd6876c0b0e2def6980b5'

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        while b:=f.read(1024*1024):h.update(b)
    return h.hexdigest()

def inspect_elf(path):
    with path.open('rb') as f:
        header=f.read(64)
        if len(header)!=64 or header[:6]!=b'\x7fELF\x02\x01' or struct.unpack_from('<H',header,18)[0]!=62:
            raise ValueError('Expected a Linux ELF64 little-endian x86_64 server')
        offset=struct.unpack_from('<Q',header,32)[0]
        size,count=struct.unpack_from('<HH',header,54)
        for i in range(count):
            f.seek(offset+i*size)
            if struct.unpack('<I',f.read(4))[0]==3:raise ValueError('Expected static musl binary; found PT_INTERP')
    return {'format':'ELF64','machine':'x86_64','dynamicInterpreter':False,'executedOnLinux':False}

def package(root,page,server,output):
    root,page,server,output=map(lambda p:Path(p).resolve(),(root,page,server,output))
    if output.exists():raise ValueError('Output exists; choose a new archive')
    if not output.parent.is_dir():raise ValueError('Output parent must exist')
    elf=inspect_elf(server)
    if sha(page)!=RELEASE_SHA256:raise ValueError('Page does not match the current verified release pin')
    files={'tg-server':server,'tankforge-r85.html':page}
    for folder in ['data','config']:
        for path in sorted((root/folder).rglob('*')):
            if path.is_symlink():raise ValueError('Symlink input refused: '+str(path))
            if path.is_file():files[path.relative_to(root).as_posix()]=path
    for name in ['SOURCES.md','docs/third-party/afl_ext-prococean-LICENSE.txt','docs/third-party/afl_ext-prococean-reference.glsl']:
        if (root/name).is_file():files[name]=root/name
    manifest={name:{'bytes':path.stat().st_size,'sha256':sha(path)}for name,path in files.items()}
    embedded={
      'start.sh':b'#!/bin/sh\nset -eu\ncd -- "$(dirname -- "$0")"\nexec ./tg-server --bind "${TF_BIND:-0.0.0.0}" --port "${TF_PORT:-8787}" --data ./data --page ./tankforge-r85.html\n',
      'README.txt':('TankForge R8.5 Linux amd64 complete server + client\n\n'
        'Extract to a NEW directory. Stop the old service before switching it.\n'
        'Run: chmod +x tg-server start.sh && ./start.sh\n'
        'Default HTTP/WebSocket port: 8787; override TF_PORT / TF_BIND as needed.\n'
        'Use this HTML with this server and data together. Do not mix older clients.\n'
        'Nginx/proxy must forward both / and /ws to the same server.\n'
        'No remote server was modified by this package builder.\n'
        'Linux binary was cross-built on Windows; Linux runtime execution is not claimed.\n').encode(),
    }
    for name,data in embedded.items():manifest[name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
    receipt={'schema':'TankForgeLinuxCompleteV1','elf':elf,'files':manifest}
    embedded['manifest.json']=(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n').encode()
    prefix=output.name.removesuffix('.tar.gz')
    with output.open('xb') as destination:
        with tarfile.open(fileobj=destination,mode='w:gz',compresslevel=6) as archive:
            for name,path in files.items():
                info=archive.gettarinfo(str(path),arcname=prefix+'/'+name);info.uid=info.gid=0;info.uname=info.gname='';info.mode=0o755 if name=='tg-server' else 0o644
                with path.open('rb') as f:archive.addfile(info,f)
            for name,data in embedded.items():
                info=tarfile.TarInfo(prefix+'/'+name);info.size=len(data);info.mode=0o755 if name=='start.sh' else 0o644;archive.addfile(info,io.BytesIO(data))
    # Read every actual archive member back; compressed bytes and unpacked input
    # pins are verified independently of the original manifest construction.
    verified=0
    with tarfile.open(output,'r:gz') as archive:
        for member in archive:
            if not member.isfile():raise ValueError('Unexpected non-file archive member')
            name=member.name.removeprefix(prefix+'/')
            if name=='manifest.json':continue
            expected=manifest[name];h=hashlib.sha256();size=0
            with archive.extractfile(member) as f:
                while b:=f.read(1024*1024):h.update(b);size+=len(b)
            if size!=expected['bytes']or h.hexdigest()!=expected['sha256']:raise ValueError('Archive mismatch: '+name)
            verified+=1
    result={'archive':str(output),'bytes':output.stat().st_size,'sha256':sha(output),'verifiedFiles':verified,'htmlSha256':manifest['tankforge-r85.html']['sha256'],'serverSha256':manifest['tg-server']['sha256'],'elf':elf}
    output.with_name(output.name+'.receipt.json').write_text(json.dumps(result,indent=2)+'\n')
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);p.add_argument('--page',required=True);p.add_argument('--server',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    print(json.dumps(package(a.root,a.page,a.server,a.output),indent=2))

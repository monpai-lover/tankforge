#!/usr/bin/env python3
"""Splice the reviewed Me262 family into current pinned asset chunks, preserving other bytes.

Default writes only candidate gzip/proof under the ignored QA directory. --install
atomically replaces same-size chunk names from a staged deterministic gzip. It
never changes an application, server catalog or running deployment.
"""
import argparse,gzip,hashlib,importlib.util,json,mmap,os,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
PIN='73a55fd1a23068a6a517d2643a4f9b5d978107a90b26bce218fbee7ed114ef18'
RECORDS={'me262':'fd9b7acf1273d1e0c14d2be0785d8293455c1d138cf415f7afb762103c730e88','me262a2a':'57d18a8ed21112cc1399e02ad0456c07e6a5e32de2e2c11566d10e0d24031a85','me262u4':'c2160da2187238570e206198ecbe735cabbea1b89401fd7eacd10ce9ec83dad4'}
CHUNK=1024*1024
spec=importlib.util.spec_from_file_location('native_splice',Path(__file__).with_name('patch_native_record.py'));mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
def sha(p):return mod.range_sha_file(p)
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--install',action='store_true');p.add_argument('--out',type=Path,default=ROOT/'handoff/tests/out/me262-game-v2-20261025/splice');args=p.parse_args();args.out.mkdir(parents=True,exist_ok=True)
 bundle=ROOT/'handoff/bundle';parts=sorted(bundle.glob('data.line.gz.part[0-9][0-9]'));assert len(parts)==5
 records={}
 for id,digest in RECORDS.items():
  record=ROOT/'handoff/aircraft_assets/me262-game-v2-20261025'/f'{id}.json';assert sha(record)==digest
  raw=record.read_bytes().strip();d=json.loads(raw);assert d['type']==id and d['version']==2 and b'</script' not in raw.lower();records[id]=raw
 with tempfile.TemporaryDirectory(prefix='tf-me262-splice-',dir=args.out) as temp:
  temp=Path(temp);compressed=temp/'current.gz';rawpath=temp/'current.line'
  with compressed.open('wb') as dest:
   for part in parts:
    with part.open('rb') as source:
     for b in iter(lambda:source.read(CHUNK),b''):dest.write(b)
  h=hashlib.sha256()
  with gzip.open(compressed,'rb') as source,rawpath.open('wb') as dest:
   for b in iter(lambda:source.read(CHUNK),b''):dest.write(b);h.update(b)
  assert h.hexdigest()==PIN,'Current asset bytes do not match the reviewed previous release'
  with rawpath.open('rb') as source,mmap.mmap(source.fileno(),0,access=mmap.ACCESS_READ) as data:
   scan=mod.JsonRanges(data).document();assert set(records)&set(scan.models)=={'me262'}
   a,b=scan.models['me262'];_,end=scan.top['aircraftModels'];added=b','+b','.join(json.dumps(id).encode()+b':'+records[id] for id in ['me262a2a','me262u4'])
   edits=[(a,b,records['me262']),(end-1,end-1,added)]
   output=args.out/'data.me262.candidate.gz';h=hashlib.sha256();size=0;preserved=[]
   with output.open('wb') as dest,gzip.GzipFile(filename='',mode='wb',fileobj=dest,mtime=0,compresslevel=9) as gz:
    cursor=0
    def write(b):
     nonlocal size
     h.update(b);gz.write(b);size+=len(b)
    for a,b,v in edits:
     preserved.append({'start':cursor,'end':a,'sha256':mod.range_sha(data,cursor,a)})
     for piece in mod.range_chunks(data,cursor,a):write(piece)
     write(v);cursor=b
    preserved.append({'start':cursor,'end':len(data),'sha256':mod.range_sha(data,cursor,len(data))})
    for piece in mod.range_chunks(data,cursor,len(data)):write(piece)
   proof={'sourceSha256':PIN,'sourceBytes':len(data),'outputSha256':h.hexdigest(),'outputBytes':size,'gzipSha256':sha(output),'gzipBytes':output.stat().st_size,'records':RECORDS,'unchangedModels':{id:mod.range_sha(data,a,b) for id,(a,b) in scan.models.items() if id!='me262'},'preservedByteRanges':preserved,'installed':False}
  if args.install:
   # Stage every chunk first. The prior files are retained for rollback until all
   # replacements succeed; no half-written chunk is ever installed.
   staged=[];backups=[]
   with output.open('rb') as source:
    for i in range(5):
     value=source.read(30*1024*1024) if i<4 else source.read();assert value
     target=bundle/f'data.line.gz.part{i:02d}';stage=temp/target.name;stage.write_bytes(value);staged.append((stage,target))
    assert not source.read(1)
   try:
    for stage,target in staged:
     backup=temp/(target.name+'.old');os.replace(target,backup);backups.append((backup,target));os.replace(stage,target)
   except BaseException:
    for backup,target in reversed(backups):os.replace(backup,target)
    raise
   proof['installed']=True
  (args.out/'splice-proof.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof,indent=2))
if __name__=='__main__':main()

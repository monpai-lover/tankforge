#!/usr/bin/env python3
"""Build the eight reviewed audio hunks against the pinned published page only."""
import gzip, hashlib, importlib.util, json, shutil
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def main():
    base=ROOT/'handoff/server/dist/tankforge-page-update-20261025-me262'
    old=json.loads((base/'release.json').read_text())
    suffix=ROOT/'handoff/tests/out/me262-game-v2-20261025/public/app.js.html'
    assert sha(suffix)==old['publicAppSha256'] and sha(base/'index.html.gz')==old['newGzipSha256']
    spec=importlib.util.spec_from_file_location('audio',ROOT/'handoff/tools/patch_aircraft_audio.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    original=suffix.read_text();patched,hunks=module.apply_patch(original)
    assert all(not h['alreadyPatched'] for h in hunks) and len(hunks)==8
    assert 'BEGIN NATIVE FRONTLINE CLIENT' not in patched
    package=ROOT/'handoff/server/dist/tankforge-page-update-20261025-u4-audio'
    package.mkdir(parents=True,exist_ok=True)
    (package/'app.js.html').write_text(patched)
    output=package/'index.html.gz';before=hashlib.sha256();after=hashlib.sha256();prefix=hashlib.sha256();size=0
    with gzip.open(base/'index.html.gz','rb') as src,output.open('wb') as dest,gzip.GzipFile(filename='',fileobj=dest,mode='wb',compresslevel=9,mtime=0) as gz:
        remaining=old['newPageBytes']-len(original.encode())
        while remaining:
            b=src.read(min(1024*1024,remaining));assert b
            remaining-=len(b);before.update(b);prefix.update(b);after.update(b);gz.write(b);size+=len(b)
        tail=src.read();assert tail==original.encode()
        before.update(tail);assert before.hexdigest()==old['newPageSha256']
        b=patched.encode();after.update(b);gz.write(b);size+=len(b)
    updater=Path(__file__).with_name('update-u4-audio.py');shutil.copy2(updater,package/updater.name)
    receipt={'version':'20261025-u4-audio','scope':'Eight audio-only app suffix hunks; all prior page prefix bytes retained',
        'oldPageSha256':old['newPageSha256'],'oldGzipSha256':old['newGzipSha256'],
        'newPageSha256':after.hexdigest(),'newPageBytes':size,'newGzipSha256':sha(output),
        'catalogSha256':old['newCatalogSha256'],'binarySha256':'1cc923ce8707cff1f8d499f6963b7387dfc2aa92664f36dfa416d14fab667dce',
        'oldAppSha256':old['publicAppSha256'],'newAppSha256':sha(package/'app.js.html'),
        'unchangedPrefixSha256':prefix.hexdigest(),'assetPinUnchanged':module.ASSET_PIN,
        'cue':'report_kwk39_50','cueSha256':module.CUE_SHA,
        'recordingIdentity':'Existing OPEX KwK39 50 mm cue used as a substitute for MK214A',
        'updaterSha256':sha(package/updater.name),'hunks':hunks}
    (package/'release.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2))
if __name__=='__main__':main()

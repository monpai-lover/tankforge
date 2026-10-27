#!/usr/bin/env python3
"""Build small exact-context hunks from a reviewed app-only change."""
import argparse, base64, difflib, hashlib, json
from pathlib import Path
def sha(data): return hashlib.sha256(data).hexdigest()
def build(old, new):
    aa, bb = old.splitlines(keepends=True), new.splitlines(keepends=True)
    for context in (8, 16, 32, 64):
        hunks = []
        for group in difflib.SequenceMatcher(None, aa, bb, autojunk=False).get_grouped_opcodes(context):
            before = b''.join(aa[group[0][1]:group[-1][2]])
            after = b''.join(bb[group[0][3]:group[-1][4]])
            if not before or old.count(before) != 1: break
            hunks.append({'old':base64.b64encode(before).decode(), 'new':base64.b64encode(after).decode(),
                          'old_sha256':sha(before),'new_sha256':sha(after)})
        else:
            if not hunks: raise ValueError('No model changes')
            return {'format':'tankforge-model-context-v1','base_sha256':sha(old),'target_sha256':sha(new),'hunks':hunks}
    raise ValueError('Could not find unambiguous model patch contexts')
def main():
    p=argparse.ArgumentParser();p.add_argument('base_app',type=Path);p.add_argument('target_app',type=Path);p.add_argument('output',type=Path);p.add_argument('--previous-app',type=Path);a=p.parse_args()
    old,new=a.base_app.read_bytes(),a.target_app.read_bytes();payload=build(old,new)
    if a.previous_app:payload={'format':'tankforge-model-context-multi-v1','profiles':[payload,build(a.previous_app.read_bytes(),new)]}
    data=json.dumps(payload,separators=(',',':')).encode();a.output.mkdir(parents=True,exist_ok=True)
    (a.output/'model-hunks.json').write_bytes(data)
    count=sum(len(p['hunks'])for p in payload['profiles'])if'profiles'in payload else len(payload['hunks'])
    manifest={'format':payload['format'],'payload_sha256':sha(data),'base_app_sha256':sha(old),'target_app_sha256':sha(new),'hunks':count,
              'scope':'aircraft model presentation and physical station layout; native combat blocks preserved'}
    (a.output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'hunks':count,'payload_bytes':len(data),'target_app_sha256':sha(new)}))
if __name__=='__main__':main()

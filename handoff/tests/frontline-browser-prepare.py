#!/usr/bin/env python3
"""Build a bounded test page from the pinned, read-only verified asset baseline.

Run jscan.c once on this exact input before invoking this script. No production
data.line is read or written, and the377MB source is never copied.
"""
import argparse
import hashlib
import json
import mmap
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BASELINE = Path('/home/boyang/Desktop/worldbox/tankforge-jet-fixes/handoff/tests/out/parked-roll-f3c6d88-20261024/committed-data.line')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path, default=DEFAULT_BASELINE)
    parser.add_argument('--out', type=Path, default=ROOT/'handoff/tests/out/frontline-browser-20261024')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    index = args.out/'keys2.txt'
    if not index.is_file() or index.stat().st_mtime < args.baseline.stat().st_mtime:
        raise SystemExit('Run jscan once on the exact frozen source to produce fresh keys2.txt')
    digest = hashlib.sha256()
    with args.baseline.open('rb') as source:
        for chunk in iter(lambda: source.read(1024*1024), b''):
            digest.update(chunk)
    source_sha = digest.hexdigest()
    assert source_sha.startswith('56eaa206'), f'Unexpected frozen baseline SHA256:{source_sha}'
    rows = []
    for line in index.read_text().splitlines():
        match = re.match(r'^( *)(\S+) ([{\[]) (\d+)\.\.(\d+)', line)
        if match:
            rows.append((len(match[1]), match[2], int(match[4]), int(match[5])))
    top = {key: (start, end) for depth, key, start, end in rows if depth == 0}
    keep = ['su_t72a', 'de_pz3_j', 'de_tiger_e', 'us_m8', 'proto_a']
    replacements = []
    with args.baseline.open('rb') as source, mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ) as data:
        for name in ['vehicles', 'surfaceCatalog']:
            start, end = top[name]
            children = {key: (a, b) for depth, key, a, b in rows if depth == 2 and start < a < end}
            if name == 'vehicles':
                assert set(keep) <= children.keys()
            items = []
            for key in keep:
                if key not in children:
                    continue
                a, b = children[key]
                payload = data[a:b+1]
                json.loads(payload)  # Verify this fresh byte range is a complete JSON value.
                items.append(json.dumps(key).encode()+b':'+payload)
            replacements.append((start, end+1, b'{'+b','.join(items)+b'}'))
        for name in ['aircraftModels', 'fullAudio', 'storeModels', 'reloadAudio', 'images']:
            if name in top:
                start, end = top[name]
                replacements.append((start, end+1, b'{}'))
        start, end = top['order']
        original_order = json.loads(data[start:end+1])
        replacements.append((start, end+1, json.dumps([x for x in original_order if x in keep]).encode()))
        output = args.out/'data.frontline.dev.line'
        with output.open('wb') as dest:
            cursor = 0
            for start, end, replacement in sorted(replacements):
                assert start >= cursor
                dest.write(data[cursor:start]); dest.write(replacement); cursor = end
            dest.write(data[cursor:])
    assert output.stat().st_size < 70*1024*1024, 'Unexpectedly large trimmed test payload'
    page = args.out/'dev.html'
    subprocess.run(['sh', str(ROOT/'handoff/tests/devpage.sh'), str(output), str(page)], check=True)
    app = ROOT/'handoff/bundle/app.js.html'
    manifest = {'purpose': 'Real browser ground-frontline verification only; not a deployment asset',
        'baseline': str(args.baseline), 'baselineBytes': args.baseline.stat().st_size,
        'baselineSha256': source_sha, 'freshIndex': str(index),
        'freshIndexSha256': hashlib.sha256(index.read_bytes()).hexdigest(),
        'vehicles': keep, 'aircraftModelsRetained': 0,
        'omittedOptionalMedia': ['fullAudio','storeModels','reloadAudio','images'],
        'trimmedDataBytes': output.stat().st_size,
        'trimmedDataSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
        'currentAppSha256': hashlib.sha256(app.read_bytes()).hexdigest(),
        'page': str(page), 'pageBytes': page.stat().st_size,
        'pageSha256': hashlib.sha256(page.read_bytes()).hexdigest()}
    (args.out/'page-provenance.json').write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Replace only MiG17 accepted legacy parts/skin, preserving other source bytes.

This consumes an actual Aircraft-constructor export. It does not migrate combat
to triangles or change guns, performance, dates, loadouts or any other aircraft.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import re


def patch_catalog(raw, patch, native_sha):
    text = raw.decode()
    catalog = json.loads(text)
    assert patch['type'] == 'mig17f'
    assert patch['source']['nativeSha256'] == native_sha
    old = catalog['types']['mig17f']
    assert {p['id'] for p in old['parts']} == {p['id'] for p in patch['parts']}
    new = copy.deepcopy(old)
    new['parts'], new['skin'] = patch['parts'], patch['skin']
    starts = list(re.finditer(r'"mig17f"\s*:\s*', text))
    assert len(starts) == 1, 'Ambiguous aircraft type key'
    start = starts[0].end()
    parsed, end = json.JSONDecoder().raw_decode(text, start)
    assert parsed == old
    # A single object splice retains every byte before/after the selected type.
    encoded = json.dumps(new, ensure_ascii=False, indent=2).replace('\n', '\n    ')
    result = (text[:start] + encoded + text[end:]).encode()
    check = json.loads(result)
    restored = copy.deepcopy(check)
    restored['types']['mig17f'] = old
    assert restored == catalog
    assert {k: v for k, v in new.items() if k not in ('parts', 'skin')} == {k: v for k, v in old.items() if k not in ('parts', 'skin')}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--patch', type=Path, required=True)
    parser.add_argument('--native-sha256', required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.out.exists() or args.out.resolve() == args.input.resolve():
        parser.error('Output must be a new file')
    raw = args.input.read_bytes()
    if hashlib.sha256(raw).hexdigest() != args.expected_sha256:
        raise ValueError('Aircraft catalog differs from the inspected source')
    result = patch_catalog(raw, json.loads(args.patch.read_bytes()), args.native_sha256)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(result)
    print(json.dumps({'bytes': len(result), 'sha256': hashlib.sha256(result).hexdigest(), 'sourceSha256': args.expected_sha256, 'scope': 'Only mig17f parts/skin legacy boxes'}))


if __name__ == '__main__':
    main()

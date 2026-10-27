#!/usr/bin/env python3
"""Apply three actual-CPU-exported Me262 entries without reserializing others.

Only the existing Me262 value, two new type values and missing referenced shell
values may change. All other original type/shell/top-level values stay byte-for-
byte intact. Does not change contacts to triangles or modify an executable.
"""
import argparse
import hashlib
import json
from pathlib import Path
from patch_native_record import JsonRanges, no_duplicate_keys, reject_constant

IDS = ('me262', 'me262a2a', 'me262u4')
ORIGINAL_ME262_SHA = {'0a5fb5186b043c9c7c7afe31e2247d5763bee3f7c9888e8c97809b0508bd61d2',
                      '3cba2f629f800de028c1c021e7c7dcb8085306d32ef01488afc241f389fd032f'}
NATIVE_PINS = {'me262':'fd9b7acf1273d1e0c14d2be0785d8293455c1d138cf415f7afb762103c730e88',
               'me262a2a':'57d18a8ed21112cc1399e02ad0456c07e6a5e32de2e2c11566d10e0d24031a85',
               'me262u4':'c2160da2187238570e206198ecbe735cabbea1b89401fd7eacd10ce9ec83dad4'}


def sha(b): return hashlib.sha256(b).hexdigest()


def decode(b):
    return json.loads(b, object_pairs_hook=no_duplicate_keys, parse_constant=reject_constant)


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()


def members(b, start=0):
    scan = JsonRanges(b); scan.i = start; scan.whitespace()
    if b[scan.i:scan.i+1] != b'{': raise ValueError('Expected object')
    scan.i += 1; result = {}
    while True:
        scan.whitespace()
        if b[scan.i:scan.i+1] == b'}': break
        key = scan.string(capture=True); scan.whitespace()
        if b[scan.i:scan.i+1] != b':': raise ValueError('Expected colon')
        scan.i += 1; scan.whitespace(); a = scan.i; scan.value(); result[key] = (a, scan.i)
        scan.whitespace()
        if b[scan.i:scan.i+1] == b'}': break
        if b[scan.i:scan.i+1] != b',': raise ValueError('Expected comma')
        scan.i += 1
    return result, scan.i


def apply(original, exported):
    old = decode(original); export = decode(exported)
    if set(export['types']) != set(IDS): raise ValueError('Expected only the three reviewed Me262 IDs')
    if not export.get('proof', {}).get('actualProductionDecoderConstructorAndGunFactory'):
        raise ValueError('Expected actual production-class export proof')
    if not export['proof'].get('legacyBoxesNotRenderTriangles'): raise ValueError('Missing accepted contact-model scope')
    if export['proof'].get('nativeSha256') != NATIVE_PINS: raise ValueError('Native records are not the final reviewed Me262 candidates')
    top, _ = members(original); ranges, close = members(original, top['types'][0]); shell_ranges, shell_close = members(original, top['shells'][0])
    a,b = ranges['me262']
    if sha(original[a:b]) not in ORIGINAL_ME262_SHA and old['types']['me262'] != export['types']['me262']:
        raise ValueError('Existing Me262 catalog value differs from reviewed baseline and target')
    edits = []; append = []
    for ident in IDS:
        value = export['types'][ident]
        if not value['parts'] or not value['skin']: raise ValueError('Empty accepted geometry')
        guns = value['guns']; expected = {'me262':[100,100,80,80], 'me262a2a':[100,100], 'me262u4':[32]}[ident]
        if [g['ammo'] for g in guns] != expected: raise ValueError('Wrong actual fixed-gun feeds')
        if len({p['id'] for p in value['parts']}) != len(value['parts']): raise ValueError('Duplicate damage identity')
        if ident in ranges:
            a,b = ranges[ident]; edits.append((a,b,encoded(value)))
        else: append.append(encoded(ident)+b':'+encoded(value))
    if append: edits.append((close,close,b','+b','.join(append)))
    new_shells = []
    for key,value in export['shells'].items():
        if key in old['shells']:
            if value != old['shells'][key]: raise ValueError('Refusing to change an existing shell: '+key)
        else: new_shells.append(encoded(key)+b':'+encoded(value))
    if new_shells: edits.append((shell_close,shell_close,b','+b','.join(new_shells)))
    result = original
    for a,b,value in sorted(edits, reverse=True): result = result[:a]+value+result[b:]
    new = decode(result); after_top,_ = members(result); after_types,_ = members(result,after_top['types'][0]); after_shells,_ = members(result,after_top['shells'][0])
    preserved = {}
    for key,(a,b) in ranges.items():
        if key in IDS: continue
        x,y = after_types[key]
        if original[a:b] != result[x:y]: raise ValueError('Unrelated aircraft bytes changed: '+key)
        preserved[key] = dict(bytes=b-a, sha256=sha(original[a:b]))
    for key,(a,b) in shell_ranges.items():
        x,y = after_shells[key]
        if original[a:b] != result[x:y]: raise ValueError('Original shell bytes changed: '+key)
    for key,(a,b) in top.items():
        if key in ('types','shells'): continue
        x,y = after_top[key]
        if original[a:b] != result[x:y]: raise ValueError('Top-level value changed: '+key)
    assert set(new['types']) == set(old['types']) | set(IDS)
    for ident in IDS:
        if new['types'][ident] != export['types'][ident]: raise ValueError('Export mismatch: '+ident)
        for gun in new['types'][ident]['guns']:
            for shell in gun['shells']:
                if shell not in new['shells']: raise ValueError('Missing referenced shell')
    proof = dict(before_sha256=sha(original), after_sha256=sha(result), export_sha256=sha(exported),
                 changed_types=list(IDS), preserved_original_type_values=preserved,
                 preserved_original_shells=list(shell_ranges), appended_shells=sorted(set(new['shells'])-set(old['shells'])),
                 before_types=len(old['types']), after_types=len(new['types']), bytes_preserved=True,
                 source=export['proof'], contact_model='Existing accepted legacy part/skin AABBs; no render-triangle combat migration')
    return result, proof


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('catalog', type=Path); ap.add_argument('export', type=Path)
    ap.add_argument('--write', action='store_true'); ap.add_argument('--out', type=Path); ap.add_argument('--proof', type=Path, required=True)
    ap.add_argument('--app',type=Path,default=Path('handoff/bundle/app.js.html'))
    a = ap.parse_args()
    if a.write and a.out: raise ValueError('Choose --write or --out')
    exported=a.export.read_bytes()
    if decode(exported)['proof']['appSha256'] != sha(a.app.read_bytes()): raise ValueError('Actual export is stale relative to app source')
    original = a.catalog.read_bytes(); result, proof = apply(original, exported)
    second, _ = apply(result, a.export.read_bytes())
    if second != result: raise ValueError('Patch is not idempotent')
    if a.write: a.catalog.write_bytes(result)
    elif a.out: a.out.parent.mkdir(parents=True,exist_ok=True); a.out.write_bytes(result)
    a.proof.parent.mkdir(parents=True,exist_ok=True); a.proof.write_text(json.dumps(proof,indent=2)+'\n')
    print(json.dumps({k:proof[k] for k in ['before_sha256','after_sha256','changed_types','appended_shells','before_types','after_types']}))


if __name__ == '__main__': main()

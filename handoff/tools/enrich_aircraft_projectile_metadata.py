#!/usr/bin/env python3
"""Stage legacy aircraft raw filler/fuze metadata from the exact source profile.

filler_kg is existing TNT-equivalent strength and is deliberately never changed.
Only explicit source projectile IDs and gun-definition/single-belt aliases map.
"""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = ROOT / 'data/aircraft/aircraft.json'
PROFILE = ROOT / 'data/aircraft/frontline.json'
FIELDS = ('kind', 'fuse_delay_s', 'fuse_sensitivity_mm', 'explosive_mass_kg', 'explosive_type')


def enrich(catalog, profile):
    result = copy.deepcopy(catalog)
    shells = profile.get('shells', {})
    aliases = {}
    for aircraft in profile.get('aircraft', {}).values():
        guns = list(aircraft.get('guns', []))
        for loadout in aircraft.get('stores', {}).get('loadouts', []):
            guns.extend(loadout.get('gunPods', []))
        for gun in guns:
            definition = gun.get('definition') or {}
            belt = set(gun.get('belt', []))
            if definition.get('id') and len(belt) == 1:
                aliases.setdefault('bullet:' + definition['id'], set()).update(belt)
    resolved, unverified = [], []
    for legacy_id, target in result.get('shells', {}).items():
        sid = legacy_id if legacy_id in shells else None
        if sid is None and len(aliases.get(legacy_id, set())) == 1:
            sid = next(iter(aliases[legacy_id]))
        source = shells.get(sid) if sid is not None else None
        if source is None:
            unverified.append(legacy_id)
            continue
        copied = []
        for key in FIELDS:
            if key not in source:
                continue
            value = source[key]
            if key in ('kind', 'explosive_type'):
                if not isinstance(value, str):
                    raise ValueError(f'{sid}.{key}: source string required')
            elif isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ValueError(f'{sid}.{key}: finite nonnegative source number required')
            target[key] = value
            copied.append(key)
        resolved.append({'legacyShell': legacy_id, 'sourceShell': sid, 'fields': copied})
        if 'kind' not in source or 'explosive_mass_kg' not in source:
            unverified.append(legacy_id)
    return result, {'resolved': resolved, 'unverified': unverified,
                    'invariant': 'existing filler_kg TNT equivalent, incendiary flag, physical values and aircraft definitions preserved'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', type=Path, default=CATALOG)
    p.add_argument('--source', type=Path, default=PROFILE)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--manifest', type=Path)
    a = p.parse_args()
    if a.output.resolve() in (CATALOG.resolve(), PROFILE.resolve()):
        p.error('Stage a separate candidate; ROOT owns shared catalog integration')
    old = a.input.read_bytes()
    source = a.source.read_bytes()
    result, proof = enrich(json.loads(old), json.loads(source))
    output = (json.dumps(result, ensure_ascii=False, indent=1) + '\n').encode('utf8')
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_bytes(output)
    proof.update(inputSha256=hashlib.sha256(old).hexdigest(), sourceSha256=hashlib.sha256(source).hexdigest(), outputSha256=hashlib.sha256(output).hexdigest())
    if a.manifest:
        a.manifest.write_text(json.dumps(proof, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(json.dumps(proof, ensure_ascii=False))


if __name__ == '__main__':
    main()

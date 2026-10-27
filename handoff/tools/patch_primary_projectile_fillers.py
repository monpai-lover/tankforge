#!/usr/bin/env python3
"""Stage primary-supported material corrections, preserving raw fill and assets."""
import argparse
import copy
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
APP = ROOT / 'handoff/bundle/app.js.html'
CATALOG = ROOT / 'data/projectiles'
IDS = ('apcbc_75_pzgr39', 'apcbc_75_pzgr39_l43', 'apcbc_75_pzgr39_42')
START = '  // BEGIN PRIMARY PROJECTILE FILLER CORRECTIONS\n'
END = '  // END PRIMARY PROJECTILE FILLER CORRECTIONS\n'
SOURCE = 'https://www.ibiblio.org/hyperwar/USA/ref/TM/pdfs/TM9-1985-3-German.pdf'


def correct_catalog(projectiles):
    result = copy.deepcopy(projectiles)
    for sid in IDS:
        s = result.get(sid)
        if not s or s.get('id') != sid or s.get('kind') != 'apcbc' or s.get('caliber_mm') != 75 or s.get('explosive_mass_kg') != .017 or s.get('explosive_type') not in ('petn', 'hexogen'):
            raise ValueError('Primary projectile correction identity/mass drift: ' + sid)
    for sid in IDS:
        result[sid]['explosive_type'] = 'hexogen'
    return result


def patch_app(text):
    helper = (HERE / 'primary_projectile_fillers.js').read_text(encoding='utf8')
    block = START + helper + '\n' + END
    if START in text:
        if text.count(START) != 1 or text.count(END) != 1:
            raise ValueError('Ambiguous primary material correction block')
        a = text.index(START)
        b = text.index(END, a) + len(END)
        text = text[:a] + block + text[b:]
    else:
        anchor = '<script>(() => {\n'
        if not text.startswith(anchor):
            raise ValueError('Original application closure anchor required')
        text = anchor + block + text[len(anchor):]
    anchor = '    const data = JSON.parse(document.getElementById("tf-data").textContent);'
    call = anchor + '\n    applyPrimaryProjectileFillerCorrections(data.projectiles);'
    if call not in text:
        if text.count(anchor) != 1:
            raise ValueError('Original data parse boot anchor required')
        text = text.replace(anchor, call, 1)
    return text


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input-app', type=Path, default=APP)
    p.add_argument('--output-app', type=Path, required=True)
    p.add_argument('--output-catalog', type=Path, required=True)
    p.add_argument('--manifest', type=Path)
    a = p.parse_args()
    if a.output_app.resolve() == APP.resolve() or a.output_catalog.resolve() == CATALOG.resolve():
        p.error('Stage separate candidates; ROOT owns application/catalog integration')
    current = {sid: json.loads((CATALOG / (sid + '.json')).read_bytes()) for sid in IDS}
    corrected = correct_catalog(current)
    before = a.input_app.read_bytes().decode('utf8')
    after = patch_app(before)
    a.output_app.parent.mkdir(parents=True, exist_ok=True)
    a.output_catalog.mkdir(parents=True, exist_ok=True)
    a.output_app.write_bytes(after.encode('utf8'))
    records = []
    for sid in IDS:
        content = (json.dumps(corrected[sid], ensure_ascii=False, indent=1) + '\n').encode('utf8')
        target = a.output_catalog / (sid + '.json')
        target.write_bytes(content)
        records.append({'id': sid, 'field': 'explosive_type', 'before': current[sid]['explosive_type'], 'after': 'hexogen',
                        'rawMassKgPreserved': current[sid]['explosive_mass_kg'], 'source': SOURCE,
                        'printedPages': [423] if sid.endswith('_42') else [398, 399],
                        'catalogSourceSha256': hashlib.sha256((CATALOG / (sid + '.json')).read_bytes()).hexdigest(),
                        'candidateSha256': hashlib.sha256(content).hexdigest()})
    result = {'scope': 'Three exact75mmPzgr39-family explosive material corrections; no mass/fuze/penetration changes; original compressed assets untouched',
              'sourcePdfSha256': '3f402900ffea30ed1e10d1f307ac141f87efc5d0fe76bf189771bfbc12445efb',
              'appInputSha256': hashlib.sha256(before.encode()).hexdigest(), 'appOutputSha256': hashlib.sha256(after.encode()).hexdigest(),
              'corrections': records,
              'limitations': ['hexogen is the existing game RDX enum, not an exact RDX/wax mixture model',
                              '17g raw mass preserved; primary scan masses vary and are not merged across variants',
                              '50mm and88mm ambiguous variant/material values are preserved',
                              'Profile exporter must call the identical overlay after loading the pinned data and before derived shells']}
    if a.manifest:
        a.manifest.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()

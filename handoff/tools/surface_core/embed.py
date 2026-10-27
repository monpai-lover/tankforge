#!/usr/bin/env python3
"""The surface core (this repository's tg-design-wasm, with crates/combat's triangle-surface armour) into
data.line as data.surfaceCore (base64) and data.surfaceCoreInfo (its SHA-256 and the commit it was
built from). The game runs a vehicle with surface armour (its surfaceArmor) on it; every other vehicle
stays on the main core (data.designCore, built from a newer source than this repository holds).

    cargo build -p tg-design-wasm --release --target wasm32-unknown-unknown
    python3 -I handoff/tools/surface_core/embed.py DATA_LINE
"""
import base64, hashlib, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
wasm = open(os.path.join(ROOT, 'target', 'wasm32-unknown-unknown', 'release', 'tg_design_wasm.wasm'), 'rb').read()
commit = subprocess.run(['git', '-C', ROOT, 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True).stdout.strip()
dirty = bool(subprocess.run(['git', '-C', ROOT, 'status', '--porcelain', 'crates'], capture_output=True, text=True).stdout.strip())
line = sys.argv[1]
s = open(line, encoding='utf-8').read()
i, j = s.index('>') + 1, s.rindex('</script>')
d = json.loads(s[i:j])
d['surfaceCore'] = base64.b64encode(wasm).decode()
d['surfaceCoreInfo'] = {'sha256': hashlib.sha256(wasm).hexdigest(), 'bytes': len(wasm), 'built_from': commit + ('+uncommitted crates' if dirty else ''), 'crate': 'tg-design-wasm'}
out = s[:i] + json.dumps(d, ensure_ascii=False, separators=(',', ':')) + s[j:]
tmp = line + '.tmp'
open(tmp, 'w', encoding='utf-8').write(out)
json.loads(open(tmp, encoding='utf-8').read()[i:-(len(s) - j)])
os.replace(tmp, line)
print('surfaceCore', len(wasm), 'bytes', d['surfaceCoreInfo'])

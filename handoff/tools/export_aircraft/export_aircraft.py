#!/usr/bin/env python3
"""Runs tests/export_aircraft.js on the test page and writes the online server's aircraft data.

    python3 tools/export_aircraft/export_aircraft.py OUT_JSON   (after tests/run.sh page)
"""
import json, os, subprocess, sys
H = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
out = sys.argv[1]
r = subprocess.run(['sh', os.path.join(H, 'tests', 'run.sh'), 'export_aircraft.js'], capture_output=True, text=True, env={**os.environ, 'EVAL_TIMEOUT': '1200'})
parts = {}
for line in r.stdout.splitlines():
    if line.startswith('@@JSON '):
        k, chunk = line[7:].split(' ', 1)
        parts[int(k)] = chunk
if not parts:
    print(r.stdout[-3000:]); sys.exit(1)
data = json.loads(''.join(parts[k] for k in sorted(parts)))
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=1)
print(out, len(data['types']), 'types', len(data['shells']), 'shells', len(data['missiles']), 'missiles', os.path.getsize(out), 'bytes')

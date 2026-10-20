#!/usr/bin/env python3
"""Puts one vehicle of data/vehicles into the handoff build's embedded data (bundle/data.line).

    python3 tools/add_vehicle_to_data_line.py de_vk3002_db [after_id]

The vehicle's files (vehicle.json's 'files', plus model.json when it names one) go in as
data.vehicles[id] = {vehicle, weapons, engine, visual, armor, modules, crew, model}, the way the
other vehicles are embedded; the id joins data.order after `after_id` (else at the end).
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
vid = sys.argv[1]
after = sys.argv[2] if len(sys.argv) > 2 else None
vdir = os.path.join(ROOT, 'data', 'vehicles', vid)
line = os.path.join(ROOT, 'handoff', 'bundle', 'data.line')
s = open(line, encoding='utf-8').read()
i, j = s.index('>') + 1, s.rindex('</script>')
d = json.loads(s[i:j])
veh = json.load(open(os.path.join(vdir, 'vehicle.json')))
entry = {'vehicle': veh}
for key, name in veh['files'].items():
    entry[key] = json.load(open(os.path.join(vdir, name)))
if veh.get('model', '').endswith('.json'):
    entry['model'] = json.load(open(os.path.join(vdir, veh['model'])))
d['vehicles'][vid] = {k: entry[k] for k in ('vehicle', 'weapons', 'engine', 'visual', 'armor', 'modules', 'crew', 'model') if k in entry}
order = [x for x in d['order'] if x != vid]
order.insert(order.index(after) + 1 if after in order else len(order), vid)
d['order'] = order
open(line, 'w', encoding='utf-8').write(s[:i] + json.dumps(d, ensure_ascii=False, separators=(',', ':')) + s[j:])
print(vid, 'in data.line;', len(order), 'vehicles; keys', list(d['vehicles'][vid]))

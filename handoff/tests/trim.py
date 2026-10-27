# Build a trimmed tf-data line keeping only selected vehicles (and their surfaceCatalog entries).
import sys, re, json
src, keys2, out = sys.argv[1], sys.argv[2], sys.argv[3]
keep = sys.argv[4].split(',')
b = open(src,'rb').read()
if __import__('os').path.getmtime(keys2) < __import__('os').path.getmtime(src):
    raise ValueError('Stale JSON offsets: run jscan on the current data.line before trimming')
top = {}; child = {}
cur = None
for line in open(keys2):
    m = re.match(r'^( *)(\S*) (.) (\d+)\.\.(\d+)', line)
    ind, k, br, a, z = len(m.group(1)), m.group(2), m.group(3), int(m.group(4)), int(m.group(5))
    if ind == 0: top[k] = (a, z)
# children of vehicles / surfaceCatalog: within ranges
def kids(name):
    a, z = top[name]; res = {}
    for line in open(keys2):
        m = re.match(r'^  (\S*) (.) (\d+)\.\.(\d+)', line)
        if m:
            s, e = int(m.group(3)), int(m.group(4))
            if a < s < z: res[m.group(1)] = (s, e)
    return a, z, res
pieces = []; pos = 0
for name in ['vehicles', 'surfaceCatalog'] + (['aircraftModels'] if len(sys.argv) > 5 else []):
    a, z, res = kids(name)
    pieces.append(b[pos:a+1])
    selected = sys.argv[5].split(',') if name == 'aircraftModels' else keep
    parts = [json.dumps(k).encode() + b':' + b[s:e+1] for k, (s, e) in res.items() if k in selected]
    pieces.append(b','.join(parts)); pos = z
pieces.append(b[pos:])
o = b''.join(pieces)
# fix order list
a = o.index(b'"order":['); z = o.index(b']', a)
order = json.loads(o[a+8:z+1]); order = [v for v in order if v in keep]
o = o[:a+8] + json.dumps(order).encode() + o[z+1:]
open(out,'wb').write(o)
print(len(o))

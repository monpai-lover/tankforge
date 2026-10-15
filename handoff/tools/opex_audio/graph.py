"""FMOD Studio bank: event path -> [(fsb, subsound)] through a GUID reference graph."""
import sys, struct, json, collections
sys.path.insert(0, __file__.rsplit('/', 1)[0]); import riff
TRAVERSE = {'EVNT', 'TMLN', 'MUIT', 'SPIT', 'EVIT', 'WAIT', 'PMLO', 'TRAN', 'CMDI'}
def load(bank_path, guid_names):
    b = open(bank_path, 'rb').read()
    objs = {}  # guid -> (type, start, end)
    def scan(o, end, depth):
        while o + 8 <= end:
            cid = b[o:o+4]; sz = struct.unpack('<I', b[o+4:o+8])[0]
            if cid in (b'RIFF', b'LIST'):
                typ = b[o+8:o+12].decode('latin1')
                if typ in TRAVERSE | {'WAVS'} and typ != 'WAVS':
                    body = o + 12 + 8  # first sub-chunk data
                    objs[b[body:body+16]] = (typ, o + 12, o + 8 + sz)
                scan(o + 12, o + 8 + sz, depth + 1)
            elif cid == b'WAV ':
                d = b[o+8:o+8+sz]
                objs[d[:16]] = ('WAV', struct.unpack('<H', d[18:20])[0], struct.unpack('<I', d[22:26])[0])
            o += 8 + sz + (sz & 1)
    scan(0, len(b), 0)
    keys = set(objs)
    adj = collections.defaultdict(set)
    for g, (t, s, e) in objs.items():
        if t == 'WAV': continue
        for k in range(s, e - 15):
            h = b[k:k+16]
            if h in keys and h != g:
                adj[g].add(h); adj[h].add(g)
    def own(g):
        """Waveforms of event g without entering other events; also the events its instruments nest."""
        seen, q, wavs, nested = {g}, [g], set(), set()
        while q:
            x = q.pop()
            for y in adj[x]:
                if y in seen: continue
                seen.add(y)
                t = objs[y][0]
                if t == 'WAV': wavs.add((objs[y][1], objs[y][2])); continue
                if t == 'EVNT':
                    if objs[x][0] == 'EVIT': nested.add(y)
                    continue
                q.append(y)
        return wavs, nested
    out = {}
    for g, name in guid_names.items():
        if g not in objs or objs[g][0] != 'EVNT': continue
        wavs, nested = own(g)
        if not wavs:
            for n in nested:
                w2, _ = own(n)
                wavs |= w2
        out[name] = sorted(wavs)
    return out
if __name__ == '__main__':
    names = {bytes.fromhex(k): v for k, v in json.load(open(sys.argv[2])).items()}
    m = load(sys.argv[1], names)
    json.dump(m, open(sys.argv[3], 'w'), indent=0)
    for k in sorted(m)[:5]: print(k, len(m[k]), m[k][:6])
    print(len(m), 'events;', sum(1 for v in m.values() if v), 'with waveforms')

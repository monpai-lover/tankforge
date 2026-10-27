"""FMOD Studio strings bank (STDT trie) -> {string index: path}; GUID table -> {guid bytes: path}."""
import sys, struct, re, json
def load(path):
    b = open(path, 'rb').read()
    i = b.index(b'STDT'); n = struct.unpack('<I', b[i+4:i+8])[0]; d = b[i+8:i+8+n]
    P = re.search(rb'b\x00ank:/\x00', d).start(); pool = d[P:]
    frag = lambda o: '' if o == 0xffffff else pool[o:pool.index(b'\0', o)].decode('utf-8', 'replace')
    rec = lambda k: struct.unpack('<I', d[8 + 4*k:12 + 4*k])[0]
    names = {}
    def walk(pair, prefix, depth=0):
        a, c = rec(2*pair), rec(2*pair+1)
        s = prefix + frag(a & 0xffffff)
        cnt, val = c >> 24, c & 0xffffff
        if cnt == 0: names[val] = s; return
        for k in range(cnt): walk(val + k, s, depth+1)
    walk(0, '')
    N = max(names) + 1
    G = P - 4 - 16 * N   # sorted GUID array, then one u32, then the fragment pool
    guids = {d[G + 16*k: G + 16*k + 16]: names[k] for k in names}
    return names, guids, (P, G, N)
if __name__ == '__main__':
    names, guids, info = load(sys.argv[1])
    print(info, len(names))
    ev = sorted(v for v in names.values() if v.startswith('event:/'))
    print(len(ev)); print('\n'.join(ev[:20]))
    json.dump({k.hex(): v for k, v in guids.items()}, open(sys.argv[2], 'w'), ensure_ascii=False, indent=0)

"""FSB5 inside an FMOD bank SND chunk: sample headers and raw data."""
import struct, zlib
RATES = {1: 8000, 2: 11000, 3: 11025, 4: 16000, 5: 22050, 6: 24000, 7: 32000, 8: 44100, 9: 48000}
def parse(b, at):
    assert b[at:at+4] == b'FSB5'
    ver, ns, shs, nts, ds, mode = struct.unpack('<6I', b[at+4:at+28])
    hdr = 0x3c
    o = at + hdr; samples = []
    for i in range(ns):
        raw = struct.unpack('<Q', b[o:o+8])[0]; o += 8
        nxt = raw & 1; rate = RATES.get((raw >> 1) & 0xf, 44100); ch = ((raw >> 5) & 1) + 1
        off = ((raw >> 6) & 0x0fffffff) * 16; n = (raw >> 34) & 0x3fffffff
        s = {'rate': rate, 'channels': ch, 'offset': off, 'samples': n, 'chunks': {}}
        while nxt:
            c = struct.unpack('<I', b[o:o+4])[0]; o += 4
            nxt = c & 1; size = (c >> 1) & 0xffffff; typ = (c >> 25) & 0x7f
            s['chunks'][typ] = b[o:o+size]; o += size
        if 1 in s['chunks']: s['channels'] = s['chunks'][1][0]
        if 2 in s['chunks']: s['rate'] = struct.unpack('<I', s['chunks'][2][:4])[0]
        samples.append(s)
    data0 = at + hdr + shs + nts
    for i, s in enumerate(samples):
        end = samples[i+1]['offset'] if i + 1 < ns else ds
        s['data'] = b[data0 + s['offset']: data0 + end]
    return mode, samples
def fsbs(b):
    out = []; i = b.find(b'FSB5')
    while i >= 0:
        try:
            ver, ns, shs, nts, ds, mode = struct.unpack('<6I', b[i+4:i+28])
            if ver == 1 and 0 < ns < 100000 and mode in (2, 15, 16): out.append(parse(b, i))
        except Exception: pass
        i = b.find(b'FSB5', i + 4)
    return out

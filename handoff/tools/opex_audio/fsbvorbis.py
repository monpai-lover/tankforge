"""FSB5 Vorbis sample -> Ogg Vorbis bytes (headers rebuilt by vorbis_headers)."""
import struct
_T = []
for i in range(256):
    r = i << 24
    for _ in range(8): r = ((r << 1) ^ 0x04c11db7) & 0xffffffff if r & 0x80000000 else (r << 1) & 0xffffffff
    _T.append(r)
def _crc(d):
    c = 0
    for x in d: c = ((c << 8) & 0xffffffff) ^ _T[((c >> 24) ^ x) & 0xff]
    return c
def _page(packet, serial, seq, granule, flags):
    segs = []; n = len(packet)
    while n >= 255: segs.append(255); n -= 255
    segs.append(n)
    h = b'OggS' + bytes([0, flags]) + struct.pack('<qIIi', granule, serial, seq, 0) + bytes([len(segs)]) + bytes(segs)
    pg = bytearray(h + packet); pg[22:26] = struct.pack('<I', _crc(pg)); return bytes(pg)
def packets(data):
    o, out = 0, []
    while o + 2 <= len(data):
        n = struct.unpack('<H', data[o:o+2])[0]; o += 2
        if n == 0: break
        out.append(data[o:o+n]); o += n
    return out
def ogg(sample, hdrs):
    idh, com, setup = hdrs
    pk = packets(sample['data']); total = sample['samples']; serial = 0x0f5b
    out = [_page(idh, serial, 0, 0, 2), _page(com + setup, serial, 1, 0, 0)] if False else [_page(idh, serial, 0, 0, 2)]
    # comment and setup on one page each (simple, valid)
    out.append(_page(com, serial, 1, 0, 0)); out.append(_page(setup, serial, 2, 0, 0))
    for i, p in enumerate(pk):
        last = i == len(pk) - 1
        g = total if last else int(total * (i + 1) / len(pk))
        out.append(_page(p, serial, 3 + i, g, 4 if last else 0))
    return b''.join(out)

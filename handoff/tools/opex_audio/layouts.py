"""FMOD Studio event layouts: where an event's instruments sit on its parameters.

An OPEX engine event places its recordings on parameter sheets (PMLO): the engine speed
('rpm_result_<engine>' or 'rpm', 0-100), 'ground/engines/load' and 'ground/engines/loadswitch'. Each
sheet's PMLB chunk names its parameter (bytes 16-32) and lists its instruments by GUID; an instrument's
INST chunk holds its volume (float at 16, dB) and its region on the sheet (float at 72 start, at 158
end). Read from the banks (no documentation; offsets found by comparing an event's instruments:
the T-34's seven speed layers 1-27, 5-20, 24.5-43, 25-50, 40-100, 46.5-100, 65-80). A wave
instrument plays one recording; a multi-instrument or scatterer plays one of several.

    layouts(bank_path, guid_names) -> {event name: {parameter name: [instrument, ...]}}
    instrument: {'kind', 'start', 'end', 'db', 'waves': [(fsb, subsound), ...]}
"""
import struct

INSTRUMENTS = ('WAIT', 'MUIT', 'SPIT', 'SCIT')
STRUCTURE = ('PARM', 'EVNT', 'PMLO', 'TMLN', 'GBUS', 'IBUS', 'MBUS', 'RBUS', 'VCAS')


class Bank:
    def __init__(self, path):
        self.b = b = open(path, 'rb').read()
        self.objs, self.wavs = {}, {}
        self._scan(0, len(b))

    def _scan(self, o, end):
        b = self.b
        while o + 8 <= end:
            cid = b[o:o + 4]; sz = struct.unpack('<I', b[o + 4:o + 8])[0]
            if cid in (b'RIFF', b'LIST'):
                body = o + 12 + 8
                self.objs.setdefault(b[body:body + 16], (b[o + 8:o + 12].decode('latin1'), o, o + 8 + sz))
                self._scan(o + 12, o + 8 + sz)
            elif cid == b'WAV ':
                d = b[o + 8:o + 8 + sz]
                self.wavs[d[:16]] = (struct.unpack('<H', d[18:20])[0], struct.unpack('<I', d[22:26])[0])
            o += 8 + sz + (sz & 1)

    def chunk(self, o, end, want):
        b = self.b
        while o + 8 <= end:
            cid = b[o:o + 4]; sz = struct.unpack('<I', b[o + 4:o + 8])[0]
            if cid == want:
                return b[o + 8:o + 8 + sz]
            if cid in (b'RIFF', b'LIST'):
                r = self.chunk(o + 12, o + 8 + sz, want)
                if r is not None:
                    return r
            o += 8 + sz + (sz & 1)

    def refs(self, data):
        return [data[k:k + 16] for k in range(0, len(data) - 15) if data[k:k + 16] in self.objs or data[k:k + 16] in self.wavs]

    def waves(self, g, depth=0):
        """The recordings an instrument plays (its own, or those of the instruments it holds)."""
        if g in self.wavs:
            return [self.wavs[g]]
        if depth > 3 or g not in self.objs:
            return []
        t, o, e = self.objs[g]
        out = []
        for h in self.refs(self.b[o + 12 + 8 + 16:e]):
            if h in self.wavs:
                out.append(self.wavs[h])
            elif self.objs.get(h, ('',))[0] not in STRUCTURE:
                out += self.waves(h, depth + 1)
        return sorted(set(out))

    def event(self, g, names):
        """{parameter name: [instrument]} of the event with GUID g."""
        if self.objs.get(g, ('',))[0] != 'EVNT':
            return {}
        t, o, e = self.objs[g]
        out = {}
        for pm in sorted({h for h in self.refs(self.b[o:e]) if self.objs.get(h, ('',))[0] == 'PMLO'}):
            t, po, pe = self.objs[pm]
            pmlb = self.chunk(po + 12, pe, b'PMLB')
            if not pmlb or len(pmlb) < 32:
                continue
            param = names.get(pmlb[16:32], pmlb[16:32].hex())
            items = []
            for k in range(32, len(pmlb) - 15):
                h = pmlb[k:k + 16]
                kind = self.objs.get(h, ('',))[0]
                if kind not in INSTRUMENTS:
                    continue
                ti, io, ie = self.objs[h]
                inst = self.chunk(io + 12, ie, b'INST')
                f = lambda off: struct.unpack('<f', inst[off:off + 4])[0] if inst and len(inst) >= off + 4 else None
                items.append({'kind': kind, 'start': f(72), 'end': f(158), 'db': f(16), 'waves': self.waves(h)})
            if items:
                out[param] = items
        return out


def layouts(bank_path, guid_names, events=None):
    bank = Bank(bank_path)
    out = {}
    for g, name in guid_names.items():
        if events is not None and name not in events:
            continue
        lay = bank.event(g, guid_names)
        if lay:
            out[name] = lay
    return out


def speed_layers(lay):
    """The instruments on an engine event's speed parameter ('rpm_result...' first, else 'rpm')."""
    for key in sorted(lay, key=lambda p: (not p.rsplit('/', 1)[-1].startswith('rpm_result'), p)):
        if key.rsplit('/', 1)[-1].startswith('rpm'):
            items = [i for i in lay[key] if i['waves'] and i['start'] is not None and i['end'] is not None and i['end'] > i['start']]
            if items:
                return items
    return []

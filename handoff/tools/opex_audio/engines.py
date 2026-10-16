#!/usr/bin/env python3
"""Replace every vehicle engine family's sounds with OPEX's recorded tank engines (in place).

    python3 -I engines.py OPEX_DIR DATA_LINE WORK_DIR [FAMILY...]

Each engine family (fullAudio profiles engine_E01..E26) takes the OPEX engine of the same or the
nearest vehicle (FAMILY_ENGINE). An OPEX engine event holds ~25 recordings: the 8 s layers several
engines share (transmission / ambience beds) are left out; of the rest, loops of 1.8 s or more are
ranked by brightness (zero crossings, a stand-in for engine speed): the darkest is idle, the one
nearest the median mid, the brightest high, and the loudest left over the load layer. Start and
stop are the engine's own engine_start / engine_stop events. Loops are encoded at -16 dBFS mean
(the generated cues were -19), start -17, stop -19. Same decode/encode pipeline as build.py.
"""
import array, collections, json, math, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build as b, fsb, graph, strings

N = 'tanks_engines'
G = 'event:/ground/engines/'
# family -> OPEX engine (vehicles of the family; why)
FAMILY_ENGINE = {
    'E01': 'hetzer',          # Praga AC (38(t), Hetzer, Flakpanzer 38(t))
    'E02': 'panzer4',         # Maybach HL 120 (Pz.III J, Pz.IV H)
    'E03': 'panther',         # Maybach HL 230 (Tiger E, Panther)
    'E04': 'sherman_m4a3',    # Ford GAA V8 (M4A3)
    'E05': 'sherman_m4a1',    # Continental R975 radial (M4A1)
    'E06': 'panzer3',         # Maybach HL 157 (VK 16.02 Leopard; nearest the HL 120)
    'E07': 'm109',            # Detroit diesel (M901 ITV on the M113)
    'E08': 't34',             # V-2 diesel (T-34, IS-2)
    'E09': 'kv220',           # V-2 heavy-tank derivative (T-10M)
    'E10': 'm10',             # GM 6046 twin diesel (M4A2 and M10 share it)
    'E11': 'bmp',             # BMP-type diesel (BMP K64)
    'E12': 'su100',           # V-2 derivative (AT-T tractor)
    'E13': 'scania_v8',       # Steyr V8 petrol (RSO)
    'E14': 'chaffee_m24',     # light US petrol (M56 Scorpion)
    'E15': 't72',             # V-84/V-92 (BMPT on the T-72 hull; OPEX's t90a has one usable layer)
    'E16': 't72',             # V-46 (T-72A)
    'E17': 'm8',              # Hercules JXD (M8)
    'E18': 'hetzer',          # Praga / light German petrol (Panzerjäger I, Hetzer variants)
    'E19': 'kamaz',           # truck engine (CMP portee; OPEX's fiat_8144 has no usable layer)
    'E20': 'cromwell',        # Rolls-Royce Meteor (Cromwell)
    'E21': 't34',             # V-54 diesel (T-54, V-2 family)
    'E22': 'm10',             # GM 6046 twin diesel (M10)
    'E23': 'leo1',            # MTU MB 838 (Gepard on the Leopard 1)
    'E24': 'amx10rc',         # wheeled diesel (Sd.Kfz. 234/2 Puma, Tatra V12)
    'E25': 'tank01',          # generic tank engine (Prototype A, the fallback family)
    'E26': 'patria',          # modern wheeled diesel (KDA 35, W78)
}
MEAN_DB = {'idle': -16.0, 'mid': -16.0, 'high': -16.0, 'load': -17.0, 'start': -17.0, 'stop': -19.0}

class EngineBanks(b.Banks):
    def __init__(self, opex, work):
        self.work = work; os.makedirs(work, exist_ok=True)
        _, guids, _ = strings.load(os.path.join(opex, 'masterbank.strings.bank'))
        raw = open(os.path.join(opex, N + '.bank'), 'rb').read()
        self.fsbs, self.maps, self.headers = {N: fsb.fsbs(raw)}, {N: graph.load(os.path.join(opex, N + '.bank'), guids)}, {}
        self.fadpcm = os.path.join(HERE, 'fadpcm')
        if not os.path.exists(self.fadpcm): b.run(['gcc', '-O2', '-o', self.fadpcm, os.path.join(HERE, 'fadpcm.c')])

def brightness(path):
    """Zero crossings per second (8 kHz mono): higher for a faster-running engine."""
    a = array.array('h', b.run(['ffmpeg', '-v', 'error', '-i', path, '-af', 'highpass=f=25', '-f', 's16le', '-ac', '1', '-ar', '8000', '-']))
    return sum(1 for i in range(1, len(a)) if (a[i - 1] < 0) != (a[i] < 0)) / 2 / max(1e-3, len(a) / 8000)

def main(opex, data_line, work, *only):
    B = EngineBanks(opex, work)
    s = open(data_line, encoding='utf-8').read()
    i, j = s.index('>') + 1, s.rindex('</script>')
    d = json.loads(s[i:j]); fa = d['fullAudio']
    uses = collections.Counter(tuple(w) for ev, ws in B.maps[N].items() if ev.endswith('/engine') for w in ws)
    os.makedirs(os.path.join(work, 'cues'), exist_ok=True)
    report = {}
    for p in fa['profiles']:
        if p.get('kind') != 'engine' or p.get('family') not in FAMILY_ENGINE or only and p['family'] not in only: continue
        name = FAMILY_ENGINE[p['family']]
        picks = {}
        cands = []
        for w in B.maps[N].get(G + name + '/engine', []):
            if uses[tuple(w)] >= 3: continue
            path = B.wav(N, *w); f = path and b.features(path)
            if f and f['peak'] > 0.01 and f['duration'] >= 1.8: cands.append((w, path, f, brightness(path)))
        if len(cands) < 3: print('SKIP', p['family'], name, len(cands)); continue
        cands.sort(key=lambda c: c[3])
        picks['idle'], picks['high'] = cands[0], cands[-1]
        med = cands[len(cands) // 2][3]
        picks['mid'] = min(cands[1:-1], key=lambda c: abs(c[3] - med))
        rest = [c for c in cands if c not in picks.values()]
        picks['load'] = max(rest or [cands[-1]], key=lambda c: c[2]['energy'])
        for role, suffix in (('start', 'engine_start'), ('stop', 'engine_stop')):
            ws = B.maps[N].get(G + name + '/' + suffix, [])
            got = [(w, B.wav(N, *w)) for w in ws[:4]]
            got = [(w, path) for w, path in got if path]
            if got: picks[role] = (got[0][0], got[0][1], None, None)
        for role, (w, path, _, bright) in picks.items():
            cue_id = p['cues'].get(role)
            if not cue_id: continue
            cue = fa['cues'][cue_id]; loop = role in ('idle', 'mid', 'high', 'load')
            b.NEW_CUE_MEAN_DB_BY_ID[cue_id] = MEAN_DB[role]
            cue.update(b.encode(path, None, loop, os.path.join(work, 'cues', cue_id)))
            cue['loop'] = loop
            cue['source'] = f'OPEX {N}.bank {G}{name}/{"engine" if loop else ("engine_start" if role == "start" else "engine_stop")} FSB{w[0]}#{w[1]}'
            cue['subjectiveAudition'] = 'NOT RUN'
            cue.pop('engineRpm', None); cue.pop('referenceRpm', None)
        p['opexEngine'] = name
        report[p['family']] = {'engine': name, 'candidates': len(cands), **{r: [list(v[0]), round(v[3]) if v[3] else None] for r, v in picks.items()}}
        print(p['family'], name, len(cands), {r: (tuple(v[0]), round(v[3]) if v[3] else None) for r, v in picks.items()})
    prev = fa.setdefault('opexSource', {}).get('engines', {}).get('families', {}) if only else {}
    fa['opexSource']['engines'] = {'tool': 'handoff/tools/opex_audio/engines.py', 'families': {**prev, **report}}
    open(data_line, 'w', encoding='utf-8').write(s[:i] + json.dumps(d, ensure_ascii=False, separators=(',', ':')) + s[j:])
    json.dump(report, open(os.path.join(work, 'engines.json'), 'w'), indent=1)

if __name__ == '__main__':
    main(*sys.argv[1:])

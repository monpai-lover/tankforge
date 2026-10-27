#!/usr/bin/env python3
"""Replace every vehicle engine family's sounds with OPEX's recorded tank engines (in place).

    python3 -I engines.py OPEX_DIR DATA_LINE WORK_DIR [FAMILY...]

Each engine family (fullAudio profiles engine_E01..E26) takes the OPEX engine of the same or the
nearest vehicle (FAMILY_ENGINE). Its idle, mid and high loops follow the event's own layout
(layouts.py): every speed layer covering the band's point on the 0-100 speed sheet, mixed at its
volume (see band_point / mix_layers), the point kept as the profile's rpmAnchor for pitch.
Acceleration is the event's load-switch recordings (cues <load>_on_N listed in the profile's
loadOn, one-shots as the load comes on). Start and stop are the
engine's engine_start / engine_stop events. Mean levels: idle -20 dBFS, mid -17, high -15, load -16,
start -17, stop -19 (OPEX's layers are all near one level; the game sets it by engine speed). Same decode/encode pipeline as build.py.
"""
import array, collections, json, math, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build as b, fsb, graph, strings, layouts

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
# OPEX keeps every layer at about the same level (the game sets it by engine speed): idle quieter
MEAN_DB = {'idle': -20.0, 'mid': -17.0, 'high': -15.0, 'load': -16.0, 'start': -17.0, 'stop': -19.0}
class EngineBanks(b.Banks):
    def __init__(self, opex, work):
        self.work = work; os.makedirs(work, exist_ok=True)
        _, guids, _ = strings.load(os.path.join(opex, 'masterbank.strings.bank'))
        raw = open(os.path.join(opex, N + '.bank'), 'rb').read()
        self.fsbs, self.maps, self.headers = {N: fsb.fsbs(raw)}, {N: graph.load(os.path.join(opex, N + '.bank'), guids)}, {}
        self.fadpcm = os.path.join(HERE, 'fadpcm')
        if not os.path.exists(self.fadpcm): b.run(['gcc', '-O2', '-o', self.fadpcm, os.path.join(HERE, 'fadpcm.c')])

# Bands from OPEX's own layout (user report: idle and acceleration sounded wrong; the brightness
# guess had put the T-34's 25-50 layer at idle and a 2 s load-switch burst on as the looped mid): each
# band is every speed layer covering its point on the event's 0-100 speed sheet, mixed at the layer's
# own volume, as FMOD plays them there; idle at 8, mid at the most covered point of 30-65 (nearest
# 45), high at the most covered point of 70-100 (nearest 90). Acceleration is the event's load-switch
# recordings, played once as the load comes on (OPEX's 'loadswitch'), not a looped bed.
BAND_RANGE = {'idle': (8, 8, 8), 'mid': (30, 65, 45), 'high': (70, 100, 90)}
MIX_MAX_S, MIX_XFADE_S = 10.0, 0.35

def band_point(layers, band):
    lo, hi, want = BAND_RANGE[band]
    cover = lambda t: [l for l in layers if l['start'] <= t <= l['end']]
    pts = [t for t in range(lo, hi + 1)]
    best = max(pts, key=lambda t: (len(cover(t)), -abs(t - want)))
    # at most three, the most specific first (the Panther's layers all start at 1: at idle all nine
    # cover it, the narrow ones are its idle)
    got = sorted(cover(best), key=lambda l: l['end'] - l['start'])[:3]
    if not got:  # a gap: the layer whose middle is nearest
        got = [min(layers, key=lambda l: abs((l['start'] + l['end']) / 2 - want))]
        best = (got[0]['start'] + got[0]['end']) / 2
    return best, got

def mix_layers(B, layers, work, name):
    """The recordings of `layers` mixed at their volumes into one seamless loop (mono 44.1 kHz)."""
    paths = [(B.wav(N, *l['waves'][0]), l['db'] or 0.0) for l in layers]
    paths = [(q, db) for q, db in paths if q]
    if not paths: return None
    durs = [b.features(q)['duration'] for q, _ in paths]
    length = min(MIX_MAX_S, max(durs))
    args, chains = [], []
    for k, (q, db) in enumerate(paths):
        args += ['-stream_loop', '-1', '-i', q]
        chains.append(f'[{k}:a]aformat=sample_rates=44100:channel_layouts=mono,volume={db:.2f}dB[a{k}]')
    mix = ';'.join(chains) + ';' + ''.join(f'[a{k}]' for k in range(len(paths))) + f'amix=inputs={len(paths)}:normalize=0:duration=longest[m]'
    raw = b.run(['ffmpeg', '-v', 'error'] + args + ['-filter_complex', mix, '-map', '[m]', '-t', f'{length + MIX_XFADE_S:.3f}', '-f', 's16le', '-ac', '1', '-ar', '44100', '-'])
    a = array.array('h', raw)
    x = int(MIX_XFADE_S * 44100)
    if len(a) <= 2 * x: return None
    body = array.array('h', a[x:len(a)])
    n = len(body)
    for i in range(x):  # the end blends into the start: the loop has no seam
        w = i / x
        body[n - x + i] = int(max(-32768, min(32767, body[n - x + i] * (1 - w) + a[i] * w)))
    out = os.path.join(work, 'cues', name + '.mix.wav')
    b.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', '44100', '-ac', '1', '-i', '-', out], body.tobytes())
    return out

def main(opex, data_line, work, *only):
    B = EngineBanks(opex, work)
    s = open(data_line, encoding='utf-8').read()
    i, j = s.index('>') + 1, s.rindex('</script>')
    d = json.loads(s[i:j]); fa = d['fullAudio']
    global LAYOUTS
    _, guids, _ = strings.load(os.path.join(opex, 'masterbank.strings.bank'))
    LAYOUTS = layouts.layouts(os.path.join(opex, N + '.bank'), guids, {G + n + '/engine' for n in FAMILY_ENGINE.values()})
    os.makedirs(os.path.join(work, 'cues'), exist_ok=True)
    report = {}
    for p in fa['profiles']:
        if p.get('kind') != 'engine' or p.get('family') not in FAMILY_ENGINE or only and p['family'] not in only: continue
        name = FAMILY_ENGINE[p['family']]
        picks = {}
        lay = LAYOUTS.get(G + name + '/engine', {})
        layers = layouts.speed_layers(lay)
        if len(layers) < 2: print('SKIP', p['family'], name, len(layers)); continue
        anchors = {}
        for band in ('idle', 'mid', 'high'):
            t, got = band_point(layers, band)
            path = mix_layers(B, got, work, p['cues'].get(band, p['family'] + band))
            if not path: continue
            anchors[band] = round(t / 100, 3)
            picks[band] = (got[0]['waves'][0], path, None, f"speed {t:g}: " + ', '.join(f"{l['start']:g}-{l['end']:g} {l['db']:+.1f} dB FSB{l['waves'][0][0]}#{l['waves'][0][1]}" for l in got))
        switch = [l for k, v in lay.items() if k.endswith('/loadswitch') for l in v if l['waves']]
        load_on = []
        if switch:
            for k, w in enumerate(switch[0]['waves'][:4]):
                q = B.wav(N, *w)
                if q: load_on.append((w, q))
        for role, suffix in (('start', 'engine_start'), ('stop', 'engine_stop')):
            ws = B.maps[N].get(G + name + '/' + suffix, [])
            got = [(w, B.wav(N, *w)) for w in ws[:4]]
            got = [(w, path) for w, path in got if path]
            if got: picks[role] = (got[0][0], got[0][1], None, None)
        # pitch anchors rising with the band (an engine laid out only to 45 put high below mid)
        if 'mid' in anchors and 'high' in anchors and anchors['high'] < anchors['mid'] + 0.15: anchors['high'] = round(min(1.0, anchors['mid'] + 0.3), 3)
        if 'idle' in anchors and 'mid' in anchors and anchors['mid'] < anchors['idle'] + 0.15: anchors['mid'] = round(anchors['idle'] + 0.3, 3)
        p['rpmAnchors'] = {**p.get('rpmAnchors', {}), **anchors}
        # acceleration: one-shots as the load comes on (replacing the looped load bed)
        base = p['cues'].pop('load', None) or (p['family'] + '_load')
        fa['cues'].pop(base, None)
        ids = []
        for k, (w, q) in enumerate(load_on):
            cid = f'{base}_on_{k + 1}'
            b.NEW_CUE_MEAN_DB_BY_ID[cid] = MEAN_DB['load']
            cue = fa['cues'].setdefault(cid, {'level': 0.8})
            cue.update(b.encode(q, None, False, os.path.join(work, 'cues', cid)))
            cue['loop'] = False
            cue['source'] = f'OPEX {N}.bank {G}{name}/engine loadswitch FSB{w[0]}#{w[1]}'
            cue['subjectiveAudition'] = 'NOT RUN'
            ids.append(cid)
        # the profile's own field (its cues map a role to one cue id each)
        p.pop('loadOn', None)
        if ids: p['loadOn'] = ids
        cands = layers
        for role, (w, path, _, bright) in picks.items():
            cue_id = p['cues'].get(role)
            if not cue_id: continue
            cue = fa['cues'][cue_id]; loop = role in ('idle', 'mid', 'high')
            b.NEW_CUE_MEAN_DB_BY_ID[cue_id] = MEAN_DB[role]
            cue.update(b.encode(path, None, loop, os.path.join(work, 'cues', cue_id)))
            cue['loop'] = loop
            ev = 'engine_start' if role == 'start' else 'engine_stop' if role == 'stop' else 'engine'
            cue['source'] = f'OPEX {N}.bank {G}{name}/{ev} ' + (bright + ' (mixed as laid out, looped)' if isinstance(bright, str) else f'FSB{w[0]}#{w[1]}')
            cue['subjectiveAudition'] = 'NOT RUN'
            cue.pop('engineRpm', None); cue.pop('referenceRpm', None)
        p['opexEngine'] = name
        report[p['family']] = {'engine': name, 'speedLayers': len(cands), 'anchors': anchors, 'loadOn': len(ids), **{r: v[3] or f'FSB{v[0][0]}#{v[0][1]}' for r, v in picks.items()}}
        print(p['family'], name, report[p['family']])
    prev = fa.setdefault('opexSource', {}).get('engines', {}).get('families', {}) if only else {}
    fa['opexSource']['engines'] = {'tool': 'handoff/tools/opex_audio/engines.py', 'families': {**prev, **report}}
    open(data_line, 'w', encoding='utf-8').write(s[:i] + json.dumps(d, ensure_ascii=False, separators=(',', ':')) + s[j:])
    json.dump(report, open(os.path.join(work, 'engines.json'), 'w'), indent=1)

if __name__ == '__main__':
    main(*sys.argv[1:])

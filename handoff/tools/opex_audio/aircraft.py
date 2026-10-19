#!/usr/bin/env python3
"""Add the NF-01 aircraft's sounds from the OPEX aircraft banks to data.line (new fullAudio cues).

    python3 -I aircraft.py OPEX_DIR DATA_LINE WORK_DIR

OPEX_DIR holds aircraft_engines / aircraft_guns / aircraft_effects .bank and masterbank.strings.bank.
Same pipeline as build.py (strings trie -> GUID graph -> FSB5 decode -> one waveform per cue by a
rule -> loudness -> Ogg loops / MP3 one-shots). Cues already taken from OPEX are re-encoded.
"""
import array, collections, json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build as b, fsb, graph, strings

EN, GU, EF = 'aircraft_engines', 'aircraft_guns', 'aircraft_effects'
A = 'event:/aircraft/'
# cue -> (bank, event, rule or ('sample', (fsb, index)), loop, mean dBFS)
# The engine is OPEX's engine01 (a piston engine, 9 recorded layers): the darkest layer by zero
# crossings (FSB0#1030, ~270 Hz) for low power and the brightest (FSB0#1349, ~600 Hz) for full power.
# Guns: the MG 17 and MG 151/20 heard from outside.
AIR_CUES = {
    'air_engine_low': (EN, A + 'engines/engine01', ('sample', (0, 1030)), True, -21.0),
    'air_engine_high': (EN, A + 'engines/engine01', ('sample', (0, 1349)), True, -19.0),
    'air_wind': (EF, A + 'effects/wind', 'longest', True, -26.0),
    # NF-02 jet (J79 turbojet, M61A1): the J79's steady compressor whine (FSB0#557, ~1.1 kHz) at low
    # thrust, its jet roar (FSB0#1380, 18.6 s) at high thrust, the afterburner layer of the J79 WEP
    # event (FSB0#755); the M61's firing loop (FSB0#382: a flat 3 s 'brrrt') and its burst tail (FSB0#181)
    'air_jet_whine': (EN, A + 'engines/engine05_05_J79_N1', ('sample', (0, 557)), True, -22.0),
    'air_jet_roar': (EN, A + 'engines/engine05_05_J79_N1', ('sample', (0, 1380)), True, -18.0),
    'air_jet_afterburner': (EN, A + 'engines/engine05_04_J79GE_N1_WEP', ('sample', (0, 755)), True, -18.0),
    'air_vulcan_fire': (GU, A + 'weapon/m61_gun_outside', ('sample', (0, 382)), True, -15.0),
    'air_vulcan_tail': (GU, A + 'weapon/m61_gun_outside', ('sample', (0, 181)), False, -21.0),
    # one crack per round (OPEX keeps each gun's report as 0.05-0.09 s variants) and, when a burst
    # ends, the echo tail (the 0.9 / 2.1 s Vorbis layers decay from the first frame: they are not
    # firing loops, and looped they pulsed once a second)
    **{f'air_mg_shot_{k + 1}': (GU, A + 'weapon/mg17_gun_outside', ('sample', w), False, -15.0) for k, w in enumerate([(1, 701), (1, 759), (1, 948), (1, 1498)])},
    **{f'air_cannon_shot_{k + 1}': (GU, A + 'weapon/mg151_gun_outside', ('sample', w), False, -13.0) for k, w in enumerate([(1, 601), (1, 1088), (1, 1848), (1, 2213)])},
    'air_mg_tail': (GU, A + 'weapon/mg17_gun_outside', ('sample', (0, 447)), False, -23.0),
    'air_cannon_tail': (GU, A + 'weapon/mg151_gun_outside', ('sample', (0, 285)), False, -21.0),
    'air_hit': (EF, A + 'effects/bullethit_plane', 'shortest', False, -21.0),
    'air_hit_he': (EF, A + 'effects/bullethit_plane_he', 'loudest', False, -18.0),
    'air_fire': (EF, A + 'effects/plane_fire', None, True, -24.0),
    'air_broken': (EF, A + 'effects/plane_broken', 'longest', False, -17.0),
    'air_crash': (EF, A + 'effects/ground_collision', None, False, -14.0),
    'air_gear': (EF, A + 'effects/chasis', 'longest', False, -25.0),
    'air_flap': (EF, A + 'effects/flap', 'loudest', False, -27.0),
    'air_prop_dead': (EF, A + 'effects/prop_dead', 'longest', False, -21.0),
    'air_tire': (EF, A + 'effects/tire_screech', 'loudest', False, -23.0),
    # the boom as the aircraft goes through Mach 1
    'air_sonic_boom': (EF, A + 'effects/plane_sonic_boom', 'loudest', False, -14.0),
}

# hangar fighters: picked automatically (see fighter_cues): (cue prefix, bank, event, role)
FIGHTER_ENGINES = [
    ('air_eng_p51d', A + 'engines/engine02', 'piston'), ('air_eng_bf109g', A + 'engines/engine06', 'piston'),
    ('air_eng_spitfire9', A + 'engines/engine10', 'piston'),
    ('air_jet_mig15', A + 'engines/engine05_02_nene_N1', 'jet'), ('air_jet_f86f', A + 'engines/engine05_06_J47_N1', 'jet'),
    ('air_jet_mig21', A + 'engines/engine05_r11_N1_WEP', 'jet_ab'),
]
FIGHTER_GUNS = [
    ('m2', A + 'weapon/m2_gun_outside'), ('m3', A + 'weapon/m3_gun_outside'), ('mg131', A + 'weapon/mg_131_gun_outside'),
    ('hispano', A + 'weapon/shvak_gun_outside'), ('nr23', A + 'weapon/nr23_gun_outside'), ('n37', A + 'weapon/ns37_gun_outside'),
    ('nr30', A + 'weapon/cannon_nr_30_outside'),
]
GUN_DB = {'m2': (-16.0, -24.0), 'm3': (-16.0, -24.0), 'mg131': (-15.0, -23.0), 'hispano': (-13.0, -21.0), 'nr23': (-13.0, -21.0), 'n37': (-12.0, -19.0), 'nr30': (-12.0, -20.0)}

def levels(path, q_s=0.25):
    a = array.array('h', b.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', '8000', '-']))
    q = int(8000 * q_s)
    return [10 * math.log10(sum(v * v for v in a[i:i + q]) / q + 1) for i in range(0, max(0, len(a) - q + 1), q)]

def brightness(path):
    a = array.array('h', b.run(['ffmpeg', '-v', 'error', '-i', path, '-af', 'highpass=f=25', '-f', 's16le', '-ac', '1', '-ar', '8000', '-']))
    return sum(1 for i in range(1, len(a)) if (a[i - 1] < 0) != (a[i] < 0)) / 2 / max(1e-3, len(a) / 8000)

USED_SHOTS = set()
def fighter_cues(B, bank, event, role, uses):
    """[(cue suffix, (fsb, sample), path, loop, mean dB)] for an engine (piston: darkest / brightest loop of
    2 s or more; jet: brightest steady loop = whine, loudest other steady loop = roar, and with an
    afterburner event the loudest steady loop left = ab) or a gun (the four loudest cracks of 0.2 s or
    less, one per round, and the longest decaying 0.5-3 s layer as the burst's echo tail)."""
    waves = [tuple(w) for w in (B.maps[bank].get(event) or [])[:80]]
    cands = []
    for w in waves:
        # beds shared across engines left out (a jet's own layers recur in its _ai / cockpit variants)
        if bank == EN and uses[w] >= (3 if role == 'piston' else 20): continue
        p = B.wav(bank, *w); f = p and b.features(p)
        if f and f['peak'] > 0.01: cands.append((w, p, f))
    if role in ('piston', 'jet', 'jet_ab'):
        loops = [c for c in cands if c[2]['duration'] >= (2 if role == 'piston' else 4)]
        if role != 'piston':
            loops = [c for c in loops if (lambda lv: lv and max(lv) - min(lv) < 7)(levels(c[1]))]
        br = {c[0]: brightness(c[1]) for c in loops}
        if len(loops) < 2: return []
        loops.sort(key=lambda c: br[c[0]])
        if role == 'piston':
            return [('_low', loops[0][0], loops[0][1], True, -21.0), ('_high', loops[-1][0], loops[-1][1], True, -19.0)]
        whine = loops[-1]; rest = [c for c in loops if c is not whine and br[c[0]] < 900] or loops[:-1]
        roar = max(rest, key=lambda c: c[2]['energy']); out = [('_whine', whine[0], whine[1], True, -22.0), ('_roar', roar[0], roar[1], True, -18.0)]
        left = [c for c in loops if c is not roar and c is not whine]
        if role == 'jet_ab' and left:
            ab = max(left, key=lambda c: c[2]['energy']); out.append(('_ab', ab[0], ab[1], True, -18.0))
        return out
    shot_db, tail_db = GUN_DB[role]
    # cracks another gun already took avoided where the event has others (NS-37 lists NR-23's)
    short = [c for c in cands if c[2]['duration'] <= 0.2]
    fresh = [c for c in short if c[0] not in USED_SHOTS]
    shots = sorted(fresh if len(fresh) >= 2 else short, key=lambda c: -c[2]['peak'])[:4]
    USED_SHOTS.update(c[0] for c in shots)
    tails = [c for c in cands if 0.5 <= c[2]['duration'] <= 3.2 and c[2]['rising'] < 0.4]
    out = [(f'_shot_{k + 1}', c[0], c[1], False, shot_db) for k, c in enumerate(shots)]
    while shots and len(out) < 4: out.append((f'_shot_{len(out) + 1}', shots[len(out) % len(shots)][0], shots[len(out) % len(shots)][1], False, shot_db))
    if tails:
        t = max(tails, key=lambda c: c[2]['duration']); out.append(('_tail', t[0], t[1], False, tail_db))
    return out

class AirBanks(b.Banks):
    def __init__(self, opex, work):
        self.work = work; os.makedirs(work, exist_ok=True)
        _, guids, _ = strings.load(os.path.join(opex, 'masterbank.strings.bank'))
        self.fsbs, self.maps, self.headers = {}, {}, {}
        for bank in (EN, GU, EF):
            raw = open(os.path.join(opex, bank + '.bank'), 'rb').read()
            self.fsbs[bank] = fsb.fsbs(raw)
            self.maps[bank] = graph.load(os.path.join(opex, bank + '.bank'), guids)
        self.fadpcm = os.path.join(HERE, 'fadpcm')
        if not os.path.exists(self.fadpcm): b.run(['gcc', '-O2', '-o', self.fadpcm, os.path.join(HERE, 'fadpcm.c')])

def main(opex, data_line, work):
    B = AirBanks(opex, work)
    s = open(data_line, encoding='utf-8').read()
    i, j = s.index('>') + 1, s.rindex('</script>')
    d = json.loads(s[i:j]); cues = d['fullAudio']['cues']
    for old in ('air_mg_fire', 'air_cannon_fire'): cues.pop(old, None)
    os.makedirs(os.path.join(work, 'cues'), exist_ok=True)
    for cue_id, (bank, event, rule, loop, mean_db) in AIR_CUES.items():
        waves = B.maps[bank].get(event) or []
        if isinstance(rule, tuple): waves, rule = [w for w in waves if tuple(w) == rule[1]], None
        cands = []
        for fi, si in waves[:60]:
            p = B.wav(bank, fi, si); f = p and b.features(p)
            if f and f['peak'] > 0.01: cands.append(((fi, si, p), f))
        pick = b.choose(cands, rule)
        if not pick: print('MISSING', cue_id, event, len(waves)); continue
        fi, si, p = pick
        b.NEW_CUE_MEAN_DB_BY_ID[cue_id] = mean_db
        cue = cues.setdefault(cue_id, {'loop': loop, 'level': 0.8})
        cue['loop'] = loop
        cue.update(b.encode(p, None, loop, os.path.join(work, 'cues', cue_id)))
        cue['source'] = f'OPEX {bank}.bank {event} FSB{fi}#{si}'
        cue['subjectiveAudition'] = 'NOT RUN'
        print(cue_id, cue['durationSeconds'], cue['source'])
    uses = collections.Counter(tuple(w) for ev, ws in B.maps[EN].items() if '/engines/' in ev for w in ws)
    for prefix, event, role in FIGHTER_ENGINES:
        for suffix, w, path, loop, mean_db in fighter_cues(B, EN, event, role, uses):
            add(cues, prefix + suffix, EN, event, w, path, loop, mean_db, work)
    for snd, event in FIGHTER_GUNS:
        for suffix, w, path, loop, mean_db in fighter_cues(B, GU, event, snd, uses):
            add(cues, f'air_{snd}' + suffix, GU, event, w, path, loop, mean_db, work)
    open(data_line, 'w', encoding='utf-8').write(s[:i] + json.dumps(d, ensure_ascii=False, separators=(',', ':')) + s[j:])

def add(cues, cue_id, bank, event, w, path, loop, mean_db, work):
    b.NEW_CUE_MEAN_DB_BY_ID[cue_id] = mean_db
    cue = cues.setdefault(cue_id, {'loop': loop, 'level': 0.8}); cue['loop'] = loop
    cue.update(b.encode(path, None, loop, os.path.join(work, 'cues', cue_id)))
    cue['source'] = f'OPEX {bank}.bank {event} FSB{w[0]}#{w[1]}'; cue['subjectiveAudition'] = 'NOT RUN'
    print(cue_id, cue['durationSeconds'], cue['source'])

if __name__ == '__main__':
    main(*sys.argv[1:4])

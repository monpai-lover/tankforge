#!/usr/bin/env python3
"""Add the NF-01 aircraft's sounds from the OPEX aircraft banks to data.line (new fullAudio cues).

    python3 -I aircraft.py OPEX_DIR DATA_LINE WORK_DIR

OPEX_DIR holds aircraft_engines / aircraft_guns / aircraft_effects .bank and masterbank.strings.bank.
Same pipeline as build.py (strings trie -> GUID graph -> FSB5 decode -> one waveform per cue by a
rule -> loudness -> Ogg loops / MP3 one-shots). Cues already taken from OPEX are re-encoded.
"""
import json, os, sys
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
}

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
    open(data_line, 'w', encoding='utf-8').write(s[:i] + json.dumps(d, ensure_ascii=False, separators=(',', ':')) + s[j:])

if __name__ == '__main__':
    main(*sys.argv[1:4])

#!/usr/bin/env python3
"""Add the aircraft weapons' and the Mach 2 fighters' sounds from the OPEX aircraft banks to data.line.

    python3 -I stores.py OPEX_DIR DATA_LINE WORK_DIR [--probe] [--only=cue,cue,...]

Only these cues are written (aircraft.py's are left as they are): missiles leaving the rail and their
motors, rockets, a bomb's release, whistle and burst, flares, the seeker's tones, and the
F-4E / F-15C / MiG-29 / Su-27 engines and the GSh-30-1. Same pipeline as aircraft.py (strings trie ->
GUID graph -> FSB5 decode -> one waveform per cue by a rule -> loudness -> Ogg loops / MP3 one-shots).
--probe lists each event's candidate waveforms (duration, peak, energy, brightness) and writes nothing.
--only writes just the named STORE_CUES (no engines or guns).
"""
import collections, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import aircraft as air, build as b, fsb, graph, strings

EN, GU, EF, CO, GUI, TW = 'aircraft_engines', 'aircraft_guns', 'aircraft_effects', 'aircraft_common', 'aircraft_gui', 'tanks_weapons'
A = 'event:/aircraft/'
# cue -> (bank, event, rule or ('sample', (fsb, index)), loop, mean dBFS)
STORE_CUES = {
    # the three missile events share their recordings: a rail launch (the loudest) and a motor loop
    'air_missile_launch': (GU, A + 'weapon/missile_light_start', 'loudest', False, -14.0),
    'air_missile_motor': (GU, A + 'weapon/missile_light_fly', 'longest', True, -24.0),
    'air_rocket_launch': (GU, A + 'weapon/rocket_start', None, False, -14.0),
    'air_rocket_motor': (GU, A + 'weapon/rocket_fly', 'longest', True, -24.0),
    'air_bomb_drop': (CO, A + 'common/bomb_drop', None, False, -20.0),
    'air_bomb_whistle': (CO, A + 'common/bomb_whistle', None, False, -22.0),
    'air_bomb_burst': (EF, A + 'explosions/bomb_explosion_ground', None, False, -10.0),
    'air_flare': (GU, A + 'weapon/flare_launcher_outside', None, False, -20.0),
    # the seeker's tones: alarm_heatseeker_scan's own recordings are Vorbis streams whose setup header
    # is not among those found here, so two steady tones of alarm_radar: the low one (FSB0#1, ~800 Hz,
    # 1.9 s) as the searching growl, the high one (FSB0#2, ~1.4 kHz, 1.2 s) as the lock tone (as an
    # AIM-9's growl rises to a high tone on a lock)
    'air_seeker_search': (GUI, A + 'gui/alarm_radar', ('sample', (0, 1)), True, -27.0),
    'air_seeker_lock': (GUI, A + 'gui/alarm_radar', ('sample', (0, 2)), True, -25.0),
    # countermeasures and the warnings (radar warning receiver: a launch detected; a missile closing)
    'air_chaff': (GU, A + 'weapon/chaff_launcher_outside', None, False, -20.0),
    'air_rwr_launch': (GUI, A + 'gui/alarm_launch_detected', ('sample', (0, 18)), False, -22.0),
    'air_missile_warn': (GUI, A + 'gui/alarm_rocket', ('sample', (1, 5)), False, -22.0),
    # the GSh-30-1 (user report: no sound): its _outside event's short layers are quiet mechanism
    # clicks (peak 0.05-0.13); the cracks are the AI event's 0.16 s report (FSB0#250) and the outside
    # event's 0.5 s reports (FSB1#1824, #2442), cut to 0.15 s with a fade (27 rounds a second would
    # stack a dozen 0.5 s voices); the burst's tail the outside event's FSB1#995 as before
    'air_gsh301_shot_1': (GU, A + 'weapon/gsh_30_1_ai', ('sample', (0, 250)), False, -12.0, 0.15),
    'air_gsh301_shot_2': (GU, A + 'weapon/gsh_30_1_outside', ('sample', (1, 1824)), False, -12.0, 0.15),
    'air_gsh301_shot_3': (GU, A + 'weapon/gsh_30_1_outside', ('sample', (1, 2442)), False, -12.0, 0.15),
    'air_gsh301_shot_4': (GU, A + 'weapon/gsh_30_1_ai', ('sample', (0, 250)), False, -13.0, 0.12),
    'air_gsh301_tail': (GU, A + 'weapon/gsh_30_1_outside', ('sample', (1, 995)), False, -19.0),
    # the Pantsir-S1's twin 2A38M (user report: no sound): OPEX's ground event 30mm_2A38 is a burst's
    # onset (1.7 s, FSB1#94), a steady fire loop (6 s, ~50 cracks a second, FSB0#316) and a long tail
    # (8.3 s, FSB0#507, cut to 3.5 s)
    'ad_2a38_onset': (TW, 'event:/ground/weapon/cannons/30mm_2A38', ('sample', (1, 94)), False, -12.0),
    'ad_2a38_loop': (TW, 'event:/ground/weapon/cannons/30mm_2A38', ('sample', (0, 316)), True, -15.0),
    'ad_2a38_tail': (TW, 'event:/ground/weapon/cannons/30mm_2A38', ('sample', (0, 507)), False, -19.0, 3.5),
    # the warning receiver and the cockpit (user request: OPEX's own alarms): a radar painting the
    # aircraft (a short ping), a radar locked on it (a high repeating tone), the aircraft's own radar
    # locking, a refused action, the angle-of-attack warners (US and Soviet) and the low-altitude beep
    'air_rwr_search': (GUI, A + 'gui/alarm_radar', ('sample', (0, 10)), False, -22.0),
    'air_rwr_lock': (GUI, A + 'gui/alarm_radar', ('sample', (0, 232)), False, -22.0),
    'air_radar_lock': (GUI, A + 'gui/alarm_radar', ('sample', (0, 258)), False, -24.0),
    'air_ui_refuse': (GUI, A + 'gui/no_bullets', ('sample', (1, 7)), False, -24.0),
    'air_aoa_us': (GUI, A + 'gui/alarm_attack_angle_us', ('sample', (0, 304)), True, -24.0),
    'air_aoa_ussr': (GUI, A + 'gui/alarm_attack_angle_ussr_1', ('sample', (0, 203)), False, -24.0),
    'air_alt_low': (GUI, A + 'gui/alarm_alt', ('sample', (1, 3)), False, -22.0),
}
# the voice warning systems: Rita (the Soviet one) and Betty (English), one clean sample each. The Chinese
# voice (xiao906) is not used. 57 of Betty's 61 calls decode: two of her Vorbis setups are FMOD's own
# (libvorbisenc does not rebuild them) and come from vgmstream's table (fsb_vorbis_setups.json).
VWS_EVENTS = ['missile_launch', 'missile', 'pull_up', 'altitude', 'over_g', 'critical_angle', 'critical_speed', 'fire', 'engine_fire',
              'left', 'right', 'ahead', 'behind', 'chaff_flare', 'counter', 'lock', 'attack_air', 'attack_sam', 'check_gear', 'warning',
              'fuel_low', 'bingo']
for ev in VWS_EVENTS:
    STORE_CUES[f'air_vws_rita_{ev}'] = (GUI, A + f'gui/vws/rita/vws_{ev}', 'loudest', False, -16.0)
# Betty's events are a shared chime / "warning" part and the call's own part: each takes the sample the
# fewest Betty events use (the "loudest" rule took the shared part: attack_air and attack_sam came out the
# same); of several own parts, the one nearest a second long. warning's part is shared with critical_speed only.
BETTY_PICK = {'missile_launch': 9, 'missile': 80, 'pull_up': 227, 'altitude': 22, 'over_g': 121, 'critical_angle': 47,
              'critical_speed': 287, 'fire': 45, 'engine_fire': 97, 'left': 172, 'right': 284, 'ahead': 163, 'behind': 59,
              'chaff_flare': 244, 'counter': 328, 'lock': 291, 'attack_air': 12, 'attack_sam': 207, 'check_gear': 256,
              'warning': 74, 'fuel_low': 224, 'bingo': 263}
for ev, k in BETTY_PICK.items():
    STORE_CUES[f'air_vws_betty_{ev}'] = (GUI, A + f'gui/vws/betty/vws_{ev}', ('sample', (0, k)), False, -16.0)
FIGHTER_ENGINES = [
    ('air_jet_f4e', A + 'engines/engine05_04_J79GE_N1_WEP', 'jet_ab'), ('air_jet_f15c', A + 'engines/engine05_f100_pw_100_WEP', 'jet_ab'),
    ('air_jet_mig29', A + 'engines/engine05_rd33_WEP', 'jet_ab'), ('air_jet_su27', A + 'engines/engine05_aL_31f_WEP', 'jet_ab'),
    # the attack aircraft (no afterburner): the A-10A's TF34, the Su-25's R-195 (the R-95Sh's successor)
    ('air_jet_a10', A + 'engines/engine05_TF34_N1', 'jet'), ('air_jet_su25', A + 'engines/engine05_r195', 'jet'),
]
# the attack aircraft's guns: the GSh-30-2's steady burst layer and its tail; the GAU-8/A's burst made
# from one of its own cracks repeated at its 3,900 rounds a minute (OPEX has its single reports and
# tails, not a burst), its tail and the rotor's spin
ATTACK_GUNS = {
    'air_gsh302_fire': (GU, A + 'weapon/cannon_gsh_30_2_outside', ('sample', (0, 55)), True, -12.0),
    'air_gsh302_tail': (GU, A + 'weapon/cannon_gsh_30_2_outside', ('sample', (0, 199)), False, -18.0),
    'air_gau8_fire': (GU, A + 'weapon/gau_8a_gun_outside', ('burst', (1, 1190), 65.0, 1.0), True, -11.0),
    'air_gau8_tail': (GU, A + 'weapon/gau_8a_gun_ai', ('sample', (1, 54)), False, -16.0),
    'air_gau8_rotor': (GU, A + 'weapon/gau_8a_gun_rotor', ('sample', (0, 137)), True, -24.0),
    # engine start and stop (the longest layer of each event: the spool up / down): a piston engine,
    # the J79 for the Western jets, the RD-33 for the Soviet ones, the A-10A's TF34 and the Su-25's R-195
    'air_start_piston': (EN, A + 'engines/engine01_start', 'longest', False, -18.0),
    'air_stop_piston': (EN, A + 'engines/engine01_stop', 'longest', False, -20.0),
    'air_start_jet': (EN, A + 'engines/engine05_04_J79GE_N1_start', 'longest', False, -18.0),
    'air_stop_jet': (EN, A + 'engines/engine05_04_J79GE_N1_stop', 'longest', False, -20.0),
    'air_start_soviet': (EN, A + 'engines/engine05_rd33_start', 'longest', False, -18.0),
    'air_stop_soviet': (EN, A + 'engines/engine05_rd33_stop', 'longest', False, -20.0),
    'air_start_a10': (EN, A + 'engines/engine05_TF34_N1_start', 'longest', False, -18.0),
    'air_stop_a10': (EN, A + 'engines/engine05_TF34_N1_stop', 'longest', False, -20.0),
    'air_start_su25': (EN, A + 'engines/engine05_r195_start', 'longest', False, -18.0),
    'air_stop_su25': (EN, A + 'engines/engine05_r195_stop', 'longest', False, -20.0),
}
FIGHTER_GUNS = []  # the GSh-30-1's cues are picked by hand in STORE_CUES
air.GUN_DB['gsh301'] = (-12.0, -19.0)


class StoreBanks(air.AirBanks):
    def __init__(self, opex, work):
        self.work = work; os.makedirs(work, exist_ok=True)
        _, guids, _ = strings.load(os.path.join(opex, 'masterbank.strings.bank'))
        self.fsbs, self.maps, self.headers = {}, {}, {}
        for bank in (EN, GU, EF, CO, GUI, TW):
            raw = open(os.path.join(opex, bank + '.bank'), 'rb').read()
            self.fsbs[bank] = fsb.fsbs(raw)
            self.maps[bank] = graph.load(os.path.join(opex, bank + '.bank'), guids)
        self.fadpcm = os.path.join(HERE, 'fadpcm')
        if not os.path.exists(self.fadpcm): b.run(['gcc', '-O2', '-o', self.fadpcm, os.path.join(HERE, 'fadpcm.c')])


def candidates(B, bank, event):
    out = []
    for fi, si in (B.maps[bank].get(event) or [])[:60]:
        p = B.wav(bank, fi, si); f = p and b.features(p)
        if f and f['peak'] > 0.01: out.append(((fi, si, p), f))
    return out


def main(opex, data_line, work, probe=False, only=None):
    B = StoreBanks(opex, work)
    if probe:
        for cue_id, (bank, event, rule, loop, mean_db, *trim) in STORE_CUES.items():
            print(cue_id, event)
            for (fi, si, p), f in candidates(B, bank, event):
                print(f"   FSB{fi}#{si}  {f['duration']:.2f} s  peak {f['peak']:.2f}  energy {f['energy']:.4f}  rising {f['rising']:.2f}  {air.brightness(p):.0f} Hz")
        return
    s = open(data_line, encoding='utf-8').read()
    i, j = s.index('>') + 1, s.rindex('</script>')
    d = json.loads(s[i:j]); cues = d['fullAudio']['cues']
    os.makedirs(os.path.join(work, 'cues'), exist_ok=True)
    for cue_id, (bank, event, rule, loop, mean_db, *trim) in {**STORE_CUES, **ATTACK_GUNS}.items():
        if only and cue_id not in only: continue
        if isinstance(rule, tuple) and rule[0] == 'burst':
            # a burst loop: the crack summed at the rate over the loop's length (16-bit mono)
            import wave, array
            src = B.wav(bank, *rule[1]); w = wave.open(src); sr, ch = w.getframerate(), w.getnchannels()
            a = array.array('h', w.readframes(w.getnframes())); crack = [sum(a[i:i + ch]) / ch for i in range(0, len(a), ch)]
            n = int(sr * rule[3]); acc = [0.0] * n; step = sr / rule[2]
            for k in range(int(rule[3] * rule[2])):
                o = int(k * step)
                for j, v in enumerate(crack):
                    acc[(o + j) % n] += v
            peak = max(abs(v) for v in acc) or 1; out = array.array('h', (int(v / peak * 30000) for v in acc))
            p = os.path.join(work, 'wav', f'{cue_id}.burst.wav'); os.makedirs(os.path.dirname(p), exist_ok=True)
            with wave.open(p, 'wb') as o: o.setnchannels(1); o.setsampwidth(2); o.setframerate(sr); o.writeframes(out.tobytes())
            air.add(cues, cue_id, bank, event, rule[1], p, loop, mean_db, work)
            continue
        cands = candidates(B, bank, event)
        if isinstance(rule, tuple): cands, rule = [c for c in cands if c[0][:2] == rule[1]], None
        pick = b.choose(cands, rule)
        if not pick: print('MISSING', cue_id, event); continue
        fi, si, p = pick
        if trim:
            # the report only: cut with a short fade out
            cut = os.path.join(work, 'wav', f'{cue_id}.cut.wav')
            b.run(['ffmpeg', '-v', 'error', '-y', '-i', p, '-af', f'atrim=0:{trim[0]},afade=t=out:st={trim[0] * 0.6:.3f}:d={trim[0] * 0.4:.3f}', cut])
            p = cut
        air.add(cues, cue_id, bank, event, (fi, si), p, loop, mean_db, work)
    if only and not any(c.startswith('air_jet_') for c in only):
        write_data(data_line, s[:i], d, s[j:])
        return
    # engines: OPEX's own layers of each type's engine, picked as aircraft.py picks them (roar layers
    # the existing jets took are avoided)
    uses = collections.Counter(tuple(w) for ev, ws in B.maps[EN].items() if '/engines/' in ev for w in ws)
    air.USED_ROARS.update(rule[1] for bank, event, rule, loop, db in air.AIR_CUES.values() if bank == EN and isinstance(rule, tuple))
    for prefix, event, role in air.FIGHTER_ENGINES:
        for suffix, w, path, loop, mean_db in air.fighter_cues(B, EN, event, role, uses): air.USED_ROARS.add(w)
    for prefix, event, role in FIGHTER_ENGINES:
        picked = air.fighter_cues(B, EN, event, role, uses)
        # --only=air_jet_x,... writes just those engines (the others picked again only to keep the roars apart)
        if only and prefix not in only: continue
        for suffix, w, path, loop, mean_db in picked:
            air.add(cues, prefix + suffix, EN, event, w, path, loop, mean_db, work)
    for snd, event in FIGHTER_GUNS:
        for suffix, w, path, loop, mean_db in air.fighter_cues(B, GU, event, snd, uses):
            air.add(cues, f'air_{snd}' + suffix, GU, event, w, path, loop, mean_db, work)
    write_data(data_line, s[:i], d, s[j:])


def write_data(data_line, head, d, tail):
    """data.line written whole to a temporary file, checked to hold exactly one JSON, then put in place
    (a data.line once came out with an older copy's remainder after the new JSON)."""
    body = json.dumps(d, ensure_ascii=False, separators=(',', ':')); tmp = data_line + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f: f.write(head + body + tail)
    t = open(tmp, encoding='utf-8').read(); k = t.index('>') + 1
    obj, end = json.JSONDecoder().raw_decode(t[k:])
    if t[k + end:] != tail: raise SystemExit('data.line check failed: not one JSON followed by the original tail')
    os.replace(tmp, data_line)


if __name__ == '__main__':
    only = next((a.split('=', 1)[1].split(',') for a in sys.argv if a.startswith('--only=')), None)
    main(*sys.argv[1:4], probe='--probe' in sys.argv, only=only)

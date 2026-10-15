#!/usr/bin/env python3
"""Replace TankForge's game sounds with audio from the OPEX War Thunder sound banks.

    python3 -I build.py OPEX_DIR DATA_LINE WORK_DIR

OPEX_DIR holds the unpacked .bank files (tanks_weapons, tanks_effects, tanks_explosions,
tanks_engines, tanks_ambient, masterbank.strings). DATA_LINE is handoff/bundle/data.line; its
fullAudio / reloadAudio cues are rewritten in place (ids, bindings and levels kept). WORK_DIR
receives decoded WAVs, the encoded cues and mapping.json (what each cue now plays).

How: event names come from the strings bank trie (strings.py), each event's waveforms from the
bank's GUID graph (graph.py), samples are decoded from FSB5 (Vorbis with rebuilt setup headers,
vorbis_headers.py / fsbvorbis.py; FADPCM with fadpcm.c), one representative waveform is chosen
per cue by a rule, its loudness matched to the cue it replaces, and it is encoded (loops Ogg
Vorbis, one-shots MP3).
"""
import base64, hashlib, json, math, os, struct, subprocess, sys, array
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fsb, graph, strings, vorbis_headers, fsbvorbis

W, E, X, N, A, U = 'tanks_weapons', 'tanks_effects', 'tanks_explosions', 'tanks_engines', 'tanks_ambient', 'aircraft_gui'
G = 'event:/ground/'
def gun(name): return (W, G + 'weapon/cannons/' + name)
def mg(name): return (W, G + 'weapon/mguns/' + name)
# cue id -> (bank, event, rule). Rules pick one waveform of the event (see choose()).
CUES = {
    # main guns, autocannons and machine guns: the gun itself where OPEX has it, else the nearest
    'report_2a46_1_125': gun('125mm_2a46_t72'), 'report_d10t_100': gun('100mm_d10t'), 'report_d25t_122': gun('122mm_d25t'),
    'report_m62_t2_122': gun('122mm_d25t'), 'report_m46_130': gun('130mm_b13'), 'report_zis_s_53_85': gun('85mm_zis_c53'),
    'report_l11_76': gun('76mm_l11'), 'report_kwk36_88_l56': gun('88mm_kwk36'), 'report_kwk39_50': gun('50mm_kwk39'),
    'report_kwk40_75_l48': gun('75mm_kwk40'), 'report_pak39_75_l48': gun('75mm_kwk40'), 'report_pak40_75': gun('75mm_kwk40'),
    'report_gun_75': gun('75mm_kwk40'), 'report_kwk42_75_l70': gun('75mm_kwk42'), 'report_kwk44_1_75_l70': gun('75mm_kwk42'),
    'report_m3_75': gun('75mm_m3'), 'report_m1a1_76': gun('76mm_m1a1'), 'report_m1a2_76': gun('76mm_m1'), 'report_m7_3in': gun('76mm_m7'),
    'report_m54_90mm': gun('90mm_m3a1'), 'report_m6_37mm': gun('37mm_m6'), 'report_qf6pdr_mk2': gun('57mm_qf6'),
    'report_qf_75_mk5': gun('75mm_qf75'), 'report_xp_78_lr': gun('76mm_qf17'), 'report_pak36t_47': gun('45mm_20k'),
    'report_custom_heavy': gun('122mm_d25t'), 'report_custom_light': gun('37mm_m6'),
    'report_72k_25': gun('25mm_72k'), 'report_flak38_20': gun('20mm_flak38'), 'report_kwk38_20': gun('20mm_kwk30'),
    'report_kda_35': gun('35mm_oerlikon_kda'), 'report_mk103_30': gun('30mm_mk103_38'),
    'report_besa_single': mg('8mm_besa'), 'report_dshk_single': mg('13mm_dshk'), 'report_dt_single': mg('8mm_dt'),
    'report_kpvt_single': mg('16mm_kpvt'), 'report_m1919a4_single': mg('8mm_m1919'), 'report_m2hb_single': mg('12mm_m2'),
    'report_mg34_single': mg('8mm_mg34'), 'report_mg42_single': mg('8mm_mg42'), 'report_mg_proto_single': mg('8mm_m240'),
    'report_nsvt_single': mg('13mm_nsvt'), 'report_pkt_single': mg('8mm_pkt'), 'report_sgmt_single': mg('8mm_sgmt'),
    # rotary guns: GSh-6-23 ~ GAU-12 rotor, 14.5 mm six-barrel ~ M61 rotor
    'rotary_oplot23_gsh6_23_custom_fire_loop': gun('25mm_gau12_rotor') + ('longest',),
    'rotary_oplot23_gsh6_23_custom_spin_up': gun('25mm_gau12_rotor') + ('rising',),
    'rotary_oplot23_gsh6_23_custom_stop': gun('25mm_gau12_rotor') + ('falling',),
    'rotary_oplot_mo_14_5x6_fire_loop': gun('20mm_m61_rotor') + ('longest',),
    'rotary_oplot_mo_14_5x6_spin_up': gun('20mm_m61_rotor') + ('rising',),
    'rotary_oplot_mo_14_5x6_stop': gun('20mm_m61_rotor') + ('falling',),
    # missiles and rockets
    'launch_9m113_konkurs': (W, G + 'weapon/atgm/atgm_ussr', 'loudest'), 'motor_9m113_konkurs': (W, G + 'weapon/atgm/atgm_ussr', 'longest'),
    'launch_9m133_kornet': (W, G + 'weapon/atgm/atgm_kornet', 'loudest'), 'motor_9m133_kornet': (W, G + 'weapon/atgm/atgm_kornet', 'longest'),
    'launch_bgm71a_tow': (W, G + 'weapon/atgm/atgm_TOW', 'loudest'), 'motor_bgm71a_tow': (W, G + 'weapon/atgm/atgm_TOW', 'longest'),
    'launch_tt250_rocket': (W, G + 'weapon/rockets/380mm_sturmtiger', 'loudest'), 'motor_tt250_rocket': (W, G + 'weapon/rockets/380mm_sturmtiger', 'longest'),
    # hits on armour
    'impact_penetrated': (E, G + 'effects/hit_mid'), 'impact_stopped': (E, G + 'effects/hit_mid_unpierce'),
    'impact_ricochet': (E, G + 'effects/rico_mid'), 'impact_shattered': (E, G + 'effects/hit_big_unpierce'),
    'tail_steel': (E, G + 'effects/hit_big', 'longest'), 'tail_aluminium': (E, G + 'effects/hit_small', 'longest'),
    'tail_composite': (E, G + 'effects/hit_heat_mid_unpierce', 'longest'), 'tail_earth_gravel': (X, G + 'explosions/no_explosive_ground'),
    'armour_spall': (E, G + 'effects/metalclanks'), 'metal_debris': (E, G + 'effects/part_fall'),
    'earth_debris': (X, G + 'explosions/no_explosive_ground', 'second'),
    'heat_small': (E, G + 'effects/hit_heat_small'), 'heat_large': (E, G + 'effects/hit_heat_big'),
    'internal_filler_small': (E, G + 'effects/aphe_explosion', 'second'), 'internal_filler_medium': (E, G + 'effects/aphe_explosion'),
    # explosions by charge, cook-off
    'blast_micro': (X, G + 'explosions/explosion_ground_20_37'), 'blast_small': (X, G + 'explosions/explosion_ground_37_50'),
    'blast_medium': (X, G + 'explosions/explosion_ground'), 'blast_large': (X, G + 'explosions/art_explosion_ground'),
    'blast_very_heavy': (X, G + 'explosions/art_heavy_ground'), 'ammo_cookoff': (X, G + 'explosions/ammo_explode', 'longest'),
    # shells in flight, ricochets
    'flight_small_approach': (E, G + 'effects/shell_whiz', 'shortest'), 'flight_small_recede': (E, G + 'effects/shell_whiz', 'second_shortest'),
    'flight_large_approach': (E, G + 'effects/shell_whiz', 'longest'), 'flight_large_recede': (E, G + 'effects/shell_whiz', 'second_longest'),
    'supersonic_small_crack': (E, G + 'effects/killscene/shell_flight', 'shortest'), 'supersonic_large_crack': (E, G + 'effects/killscene/shell_flight', 'loudest'),
    'ricochet_small_pass': (E, G + 'effects/rico_small'), 'ricochet_large_pass': (E, G + 'effects/rico'),
    # running gear and ground
    'track_light': (N, G + 'engines/tracks_light', 'longest'), 'track_medium': (N, G + 'engines/tracks_t34', 'longest'),
    'track_heavy': (N, G + 'engines/tracks_heavy', 'longest'), 'wheel_road': (N, G + 'engines/tracks_wheels', 'longest'),
    'surface_soft': (N, G + 'engines/surface_light', 'longest'), 'surface_gravel': (N, G + 'engines/surface_heavy', 'longest'),
    'collision_tree_wood': (E, G + 'effects/collision_tree'),
    # loading
    'feed_belt_grab': (E, G + 'effects/reload_cannon_auto', 'shortest'), 'feed_belt_load': (E, G + 'effects/reload_cannon_auto', 'longest'), 'feed_belt_lock': (E, G + 'effects/reload_cannon_auto', 'loudest'),
    'feed_clip_grab': (E, G + 'effects/reload_cannon_20mm', 'shortest'), 'feed_clip_load': (E, G + 'effects/reload_cannon_20mm', 'longest'), 'feed_clip_lock': (E, G + 'effects/reload_cannon_20mm', 'loudest'),
    'feed_disc_grab': (E, G + 'effects/reload_cannon_aa_mag', 'shortest'), 'feed_disc_load': (E, G + 'effects/reload_cannon_aa_mag', 'longest'), 'feed_disc_lock': (E, G + 'effects/reload_cannon_aa_mag', 'loudest'),
    'separate_charge_grab': (E, G + 'effects/reload_cannon_heavy', 'shortest'), 'separate_charge_load': (E, G + 'effects/reload_cannon_heavy', 'longest'),
    'separate_projectile_grab': (E, G + 'effects/reload_cannon_heavy', 'second_shortest'), 'separate_projectile_load': (E, G + 'effects/reload_cannon_heavy', 'second_longest'),
    'ready_light': (E, G + 'effects/reload_cannon_manual', 'shortest'), 'ready_medium': (E, G + 'effects/reload_cannon_manual', 'second_shortest'), 'ready_heavy': (E, G + 'effects/reload_cannon_manual', 'loudest'),
    'reload_9m113_konkurs_grab': (E, G + 'effects/reload_rocket', 'shortest'), 'reload_9m113_konkurs_load': (E, G + 'effects/reload_rocket', 'longest'), 'reload_9m113_konkurs_lock': (E, G + 'effects/reload_rocket', 'loudest'),
    'reload_9m133_kornet_grab': (E, G + 'effects/reload_rocket', 'shortest'), 'reload_9m133_kornet_load': (E, G + 'effects/reload_rocket', 'longest'), 'reload_9m133_kornet_lock': (E, G + 'effects/reload_rocket', 'loudest'),
    'reload_bgm71a_tow_grab': (E, G + 'effects/reload_rocket_it1', 'shortest'), 'reload_bgm71a_tow_load': (E, G + 'effects/reload_rocket_it1', 'longest'), 'reload_bgm71a_tow_lock': (E, G + 'effects/reload_rocket_it1', 'loudest'),
    'rangefinder_confirmation': (E, G + 'effects/binoculars_zoom'), 'console_action': (E, G + 'effects/binoculars_on'),
    # interface tones (APS, rangefinder, overheating): the OPEX interface sounds
    'ui_tone_on': (U, 'event:/aircraft/gui/check'), 'ui_tone_off': (U, 'event:/aircraft/gui/uncheck'),
    'ui_tone_detect': (U, 'event:/aircraft/gui/alarm_launch_detected'), 'ui_tone_lock': (U, 'event:/aircraft/gui/alarm_radar'),
    'ui_tone_overheat': (U, 'event:/aircraft/gui/alarm_wep'), 'ui_tone_empty': (U, 'event:/aircraft/gui/no_bullets'),
    'ui_tone_fault': (U, 'event:/aircraft/gui/alarm_rocket', 'shortest'),
}
# reloadAudio (and fullAudio.externalCues): manual loading by nation, the T-72 autoloader
RELOADS = {
    'de_manual_grab': (E, G + 'effects/reload_cannon_manual', 'shortest'), 'de_manual_load': (E, G + 'effects/reload_cannon_manual', 'longest'), 'de_manual_lock': (E, G + 'effects/reload_cannon_manual', 'loudest'),
    'su_manual_grab': (E, G + 'effects/reload_cannon_manual', 'second_shortest'), 'su_manual_load': (E, G + 'effects/reload_cannon_manual', 'second_longest'), 'su_manual_lock': (E, G + 'effects/reload_cannon_manual', 'second'),
    'us_manual_grab': (E, G + 'effects/reload_cannon', 'shortest'), 'us_manual_load': (E, G + 'effects/reload_cannon', 'longest'), 'us_manual_lock': (E, G + 'effects/reload_cannon', 'loudest'),
    'az_t72_drive': (E, G + 'effects/reload_cannon_T72', 'loudest'), 'az_t72_ram': (E, G + 'effects/reload_cannon_T64', 'loudest'), 'az_t72_lock': (E, G + 'effects/reload_cannon_T72', 'loudest'),
}
# cues the game did not have before: (bank, event, rule, fsb sample or None, loop)
# tank_warfare's beds use low-rate Vorbis setups the system libvorbis does not reproduce: the forest bed
NEW_CUES = {'ambient_battlefield': (A, G + 'ambient/forest', 'sample', (0, 19), True)}
NEW_CUE_MEAN_DB = -30.0
# engine families still on generated audio -> the OPEX family already in the bank for that engine
ENGINE_REMAP = {'E01': 'E18', 'E08': 'E12'}

def run(cmd, data=None):
    r = subprocess.run(cmd, input=data, capture_output=True)
    if r.returncode: raise RuntimeError(' '.join(map(str, cmd[:3])) + ': ' + r.stderr.decode()[-300:])
    return r.stdout

class Banks:
    def __init__(self, opex, work):
        self.work = work; os.makedirs(work, exist_ok=True)
        names, guids, _ = strings.load(os.path.join(opex, 'masterbank.strings.bank'))
        self.fsbs, self.maps, self.headers = {}, {}, {}
        for bank in (W, E, X, N, A, U):
            raw = open(os.path.join(opex, bank + '.bank'), 'rb').read()
            self.fsbs[bank] = fsb.fsbs(raw)
            self.maps[bank] = graph.load(os.path.join(opex, bank + '.bank'), guids)
        self.fadpcm = os.path.join(HERE, 'fadpcm')
        if not os.path.exists(self.fadpcm): run(['gcc', '-O2', '-o', self.fadpcm, os.path.join(HERE, 'fadpcm.c')])
    def wav(self, bank, fi, si):
        """Decoded sample as a WAV path, or None when it cannot be decoded here."""
        path = os.path.join(self.work, 'wav', f'{bank}_{fi}_{si}.wav')
        if os.path.exists(path): return path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        mode, ss = self.fsbs[bank][fi]; s = ss[si]
        if mode == 15:
            key = (s['channels'], s['rate'], struct.unpack('<I', s['chunks'][11][:4])[0])
            if key not in self.headers: self.headers[key] = vorbis_headers.find({key}).get(key)
            if not self.headers[key]: return None
            run(['ffmpeg', '-v', 'error', '-y', '-f', 'ogg', '-i', '-', path], fsbvorbis.ogg(s, self.headers[key][:3]))
        elif mode == 16:
            pcm = run([self.fadpcm, str(s['channels'])], s['data'])
            run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(s['rate']), '-ac', str(s['channels']), '-i', '-', path], pcm)
        else:
            return None
        return path

def features(path):
    pcm = run(['ffmpeg', '-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', '8000', '-'])
    a = array.array('h', pcm)
    if not a: return None
    n = len(a); e = sum(x * x for x in a) / 32768.0 ** 2
    peak = max(abs(x) for x in a) / 32768
    q = max(1, n // 4); first = sum(x * x for x in a[:q]); last = sum(x * x for x in a[-q:])
    return {'duration': n / 8000, 'energy': e, 'peak': peak, 'rising': last / (first + 1e-9)}

def choose(cands, rule):
    """cands: [(key, features)] -> one key."""
    if not cands: return None
    by = lambda f: sorted(cands, key=lambda c: f(c[1]))
    rules = {
        None: lambda: by(lambda f: -f['energy'])[0], 'loudest': lambda: by(lambda f: -f['peak'])[0],
        'second': lambda: by(lambda f: -f['energy'])[min(1, len(cands) - 1)],
        'longest': lambda: by(lambda f: -f['duration'])[0], 'second_longest': lambda: by(lambda f: -f['duration'])[min(1, len(cands) - 1)],
        'shortest': lambda: by(lambda f: f['duration'])[0], 'second_shortest': lambda: by(lambda f: f['duration'])[min(1, len(cands) - 1)],
        'rising': lambda: by(lambda f: -f['rising'])[0], 'falling': lambda: by(lambda f: f['rising'])[0],
    }
    return rules[rule]()[0]

def loudness(path):
    out = subprocess.run(['ffmpeg', '-v', 'info', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True).stderr
    mean = next((float(l.split(':')[1].split()[0]) for l in out.splitlines() if 'mean_volume' in l), None)
    peak = next((float(l.split(':')[1].split()[0]) for l in out.splitlines() if 'max_volume' in l), None)
    return mean, peak

def encode(src, old_url, loop, out_base):
    """Match the replaced cue's mean loudness (peak <= -0.5 dBFS); loops Ogg Vorbis, one-shots MP3."""
    target = NEW_CUE_MEAN_DB
    if old_url:
        old = out_base + '.old'
        open(old, 'wb').write(base64.b64decode(old_url.split(',', 1)[1]))
        target, _ = loudness(old)
    mean, peak = loudness(src)
    gain = (target - mean) if target is not None and mean is not None else 0.0
    if peak is not None: gain = min(gain, -0.5 - peak)
    fx = [f'volume={gain:.2f}dB']
    dur = features(src)['duration']
    if dur > 29 and loop:
        # fit the 30 s cue limit and stay seamless: the last 2 s cross-fade into the start
        looped = out_base + '.loop.wav'
        run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-filter_complex',
             '[0]asplit[a][b];[a]atrim=0:27,asetpts=PTS-STARTPTS[body];[b]atrim=27:29,asetpts=PTS-STARTPTS,afade=t=out:d=2[tail];'
             '[body]asplit[h][r];[h]atrim=0:2,asetpts=PTS-STARTPTS,afade=t=in:d=2[head];[r]atrim=2:27,asetpts=PTS-STARTPTS[rest];'
             '[tail][head]amix=inputs=2:normalize=0[x];[x][rest]concat=n=2:v=0:a=1', looped])
        src, dur = looped, 27.0
    elif dur > 29: fx.append('atrim=0:29')
    if not loop: fx += ['silenceremove=start_periods=1:start_threshold=-55dB', f'afade=t=out:st={max(0, min(dur, 29) - 0.12):.3f}:d=0.12']
    ext, codec = ('ogg', ['-c:a', 'libvorbis', '-q:a', '5']) if loop else ('mp3', ['-c:a', 'libmp3lame', '-b:a', '160k'])
    out = out_base + '.' + ext
    # mono: every game sound goes through a 3D panner, and the runtime caps decoded audio (float32)
    rate = '22050' if dur > 12 else '44100'
    run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-af', ','.join(fx), '-ac', '1', '-ar', rate, *codec, out])
    data = open(out, 'rb').read()
    d = float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).strip())
    mime = 'audio/ogg' if loop else 'audio/mpeg'
    return {'url': f'data:{mime};base64,' + base64.b64encode(data).decode(), 'sha256': hashlib.sha256(data).hexdigest(), 'durationSeconds': round(min(d, 29.9), 4)}

def main(opex, data_line, work):
    B = Banks(opex, work)
    s = open(data_line, encoding='utf-8').read()
    i, j = s.index('>') + 1, s.rindex('</script>')
    d = json.loads(s[i:j])
    fa, ra = d['fullAudio'], d['reloadAudio']
    mapping, missing = {}, {}
    def replace(cue_id, spec, cue):
        bank, event = spec[0], spec[1]; rule = spec[2] if len(spec) > 2 else None
        waves = B.maps[bank].get(event) or []
        if rule == 'sample': waves = [w for w in waves if tuple(w) == tuple(spec[3])]; rule = None
        cands = []
        for fi, si in waves[:80]:
            p = B.wav(bank, fi, si)
            f = p and features(p)
            if f and f['peak'] > 0.01: cands.append(((fi, si, p), f))
        pick = choose(cands, rule)
        if not pick: missing[cue_id] = f'{event}: no decodable waveform ({len(waves)} listed)'; return False
        fi, si, p = pick
        new = encode(p, cue.get('url'), bool(cue.get('loop')), os.path.join(work, 'cues', cue_id))
        cue.update(new)
        cue['source'] = f'OPEX {bank}.bank {event} FSB{fi}#{si}'
        cue['subjectiveAudition'] = 'NOT RUN'
        mapping[cue_id] = {'event': event, 'bank': bank, 'fsb': fi, 'sample': si, 'rule': rule or 'max_energy', 'candidates': len(cands)}
        return True
    os.makedirs(os.path.join(work, 'cues'), exist_ok=True)
    for cue_id, spec in CUES.items():
        if cue_id in fa['cues']: replace(cue_id, spec, fa['cues'][cue_id])
        else: missing[cue_id] = 'not in the game bank'
    for cue_id, spec in NEW_CUES.items():
        cue = fa['cues'].setdefault(cue_id, {'loop': spec[4], 'level': 0.6})
        if not cue.get('url', '').startswith('data:') or 'OPEX' not in cue.get('source', ''): cue['url'] = None; replace(cue_id, spec, cue)
    for cue_id, spec in RELOADS.items():
        if cue_id in ra['cues'] and replace(cue_id, spec, ra['cues'][cue_id]) and cue_id in fa.get('externalCues', {}):
            fa['externalCues'][cue_id].update({k: ra['cues'][cue_id][k] for k in ('url', 'sha256')})
    for vid, fam in list(fa['vehicleEngines'].items()):
        if fam in ENGINE_REMAP: fa['vehicleEngines'][vid] = ENGINE_REMAP[fam]; mapping.setdefault('_engines', {})[vid] = f'{fam} -> {ENGINE_REMAP[fam]}'
    fa['opexSource'] = {'pack': 'OPEX 问鼎九天 公开版 3.7.6 (War Thunder FMOD banks, user supplied)', 'tool': 'handoff/tools/opex_audio/build.py', 'replaced': len([k for k in mapping if not k.startswith('_')]), 'missing': missing}
    out = s[:i] + json.dumps(d, ensure_ascii=False, separators=(',', ':')) + s[j:]
    open(data_line, 'w', encoding='utf-8').write(out)
    json.dump({'mapping': mapping, 'missing': missing}, open(os.path.join(work, 'mapping.json'), 'w'), ensure_ascii=False, indent=1)
    remaining = [k for k in fa['cues'] if k not in CUES and k not in NEW_CUES and not k.startswith('engine_')]
    print('replaced', len([k for k in mapping if not k.startswith('_')]), 'missing', len(missing), 'not mapped (non-engine, non-ui):', remaining)
    for k, v in missing.items(): print('  missing', k, v)

if __name__ == '__main__':
    main(*sys.argv[1:4])

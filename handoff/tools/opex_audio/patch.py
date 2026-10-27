#!/usr/bin/env python3
"""Re-run build.py's selection for a few cues in place (loudness matched to the pre-OPEX originals).
    python3 -I patch.py OPEX_DIR DATA_LINE WORK_DIR ORIGINAL_DATA_LINE CUE_ID..."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build as b
opex, data_line, work, original = sys.argv[1:5]; ids = sys.argv[5:]
B = b.Banks(opex, work)
load = lambda p: (lambda s: (s, s.index('>') + 1, s.rindex('</script>')))(open(p, encoding='utf-8').read())
s, i, j = load(data_line); d = json.loads(s[i:j])
o, oi, oj = load(original); od = json.loads(o[oi:oj])
mapping = json.load(open(os.path.join(work, 'mapping.json')))
for cue_id in ids:
    spec = b.CUES.get(cue_id) or b.NEW_CUES[cue_id]
    bank, event, *rest = spec; rule = rest[0] if rest else None
    if cue_id in b.NEW_CUES: d['fullAudio']['cues'].setdefault(cue_id, {'loop': spec[4], 'level': 0.8})
    cands = []
    for fi, si in (B.maps[bank].get(event) or [])[:120]:
        p = B.wav(bank, fi, si); f = p and b.features(p)
        if f and f['peak'] > 0.01: cands.append(((fi, si, p), f))
    if rule == 'shot_tail':
        p = b.shot_tail(cands, os.path.join(work, 'cues', cue_id + '.composite.wav')); fi = si = None
    else:
        fi, si, p = b.choose(cands, rule)
    cue = d['fullAudio']['cues'][cue_id]
    old = od['fullAudio']['cues'].get(cue_id, {}).get('url')
    cue.update(b.encode(p, old, bool(cue.get('loop')), os.path.join(work, 'cues', cue_id)))
    cue['source'] = f'OPEX {bank}.bank {event} ' + ('crack+tail composite' if rule == 'shot_tail' else f'FSB{fi}#{si}')
    mapping['mapping'][cue_id] = {'event': event, 'bank': bank, 'fsb': fi, 'sample': si, 'rule': rule or 'max_energy', 'candidates': len(cands)}
    print(cue_id, cue['durationSeconds'], cue['source'][-60:])
open(data_line, 'w', encoding='utf-8').write(s[:i] + json.dumps(d, ensure_ascii=False, separators=(',', ':')) + s[j:])
json.dump(mapping, open(os.path.join(work, 'mapping.json'), 'w'), ensure_ascii=False, indent=1)

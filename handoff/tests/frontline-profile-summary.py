#!/usr/bin/env python3
"""Summarise cumulative native diagnostic counters over one stable population.

This reads stderr only. Timers overlap by nesting; their values must not be
added across groups. Diagnostic runs do not certify a release's realtime budget.
"""
import argparse
import hashlib
import json
from pathlib import Path


def summary(path, ground, aircraft):
    prefix = 'TANKFORGE_NATIVE_TIMING '
    groups = {}
    for line in path.read_text().splitlines():
        if not line.startswith(prefix):
            continue
        record = json.loads(line[len(prefix):])
        for room in record['rooms']:
            if room['ground_units'] == ground and room['air_units'] == aircraft:
                groups.setdefault((room['room'], room['map']), []).append((record, room))
    candidates = [g for g in groups.values() if len(g) >= 2]
    if not candidates:
        raise ValueError('Need at least two native records with the requested stable population')
    samples = max(candidates, key=len)
    first, old_room = samples[0]
    last, room = samples[-1]
    wall = last['wall_seconds'] - first['wall_seconds']
    if wall <= 0:
        raise ValueError('Nonincreasing diagnostic wall time')
    sections = {}
    stages = [('ticker', first['ticker'], last['ticker']),
                            ('network', first['network'], last['network']),
                            ('room', old_room['room_timings'], room['room_timings']),
                            ('simulation', old_room['sim'], room['sim']),
                            ('aircraft', old_room['air'], room['air'])]
    if isinstance(room['sim'].get('tank_detail'), dict):
        stages.append(('tank', old_room['sim']['tank_detail'], room['sim']['tank_detail']))
    for key, start, end in stages:
        delta = {k: end[k] - start[k] for k in end if isinstance(end[k], (int, float))}
        if any(v < 0 for v in delta.values()):
            raise ValueError(f'{key} counters reset during the selected window')
        count = delta.get('loops', delta.get('fixed_steps', delta.get('steps', delta.get('calls'))))
        sections[key] = {'counterDeltas': delta,
                         'milliseconds': {k: v / 1e6 for k, v in delta.items() if k.endswith('_ns')},
                         'meanMillisecondsPerCall': {k: v / 1e6 / count for k, v in delta.items() if k.endswith('_ns')} if count else None}
    steps = sections['room']['counterDeltas']['steps']
    return {'scope': 'Read-only actual stderr timing deltas; nested sections overlap and parallel unit durations may overlap in wall time; unit sums are elapsed measurements, not measured OS thread CPU; no realtime/GPU/WAN acceptance',
            'log': str(path), 'logSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'room': room['room'], 'map': room['map'], 'ground': ground, 'aircraft': aircraft,
            'records': len(samples), 'wallSeconds': wall,
            'simulationSeconds': room['simulation_seconds'] - old_room['simulation_seconds'],
            'nativeTicksPerWallSecond': steps / wall, 'sections': sections}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('log', type=Path)
    p.add_argument('--ground', type=int, default=60)
    p.add_argument('--aircraft', type=int, default=2)
    p.add_argument('--out', type=Path)
    args = p.parse_args()
    text = json.dumps(summary(args.log, args.ground, args.aircraft), ensure_ascii=False, indent=2) + '\n'
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text)
    else:
        print(text, end='')

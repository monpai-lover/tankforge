#!/usr/bin/env python3
"""Bounded F-104 seated-eye repair and cockpit-only generic-marker removal.

The record repair accepts only the verified production F-104. Geometry, moving
parts, textures, instrumentation and the source combiner are preserved exactly.
The app patch is independent of the unfinished frontline client.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path

SOURCE_SHA256 = 'ecb310ba8cc83f250abfbd83ed2b9f7623e7e1cdc8af6c8f7d88a2159868eab5'
OLD_EYE = [0.0, 0.520406, 6.188]
SEATED_EYE = [0.0, 0.520406, 5.948]
OLD_HUD = '''      place(airEl.aim, h.aim);

      place(airEl.nose, h.nose);'''
NEW_HUD = '''      // In the seat, aim through the registered optical sight rather than DOM steering marks.
      if (air.plane.state.camera === 1) {
        airEl.aim.hidden = airEl.nose.hidden = true;
      } else {
        place(airEl.aim, h.aim);
        place(airEl.nose, h.nose);
      }'''


def repair_record(raw):
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA256:
        raise ValueError('F-104 input differs from the verified production record')
    record = repair_metadata(json.loads(raw))
    return (json.dumps(record, ensure_ascii=False, separators=(',', ':')) + '\n').encode()


def repair_metadata(record):
    record = copy.deepcopy(record)
    before = copy.deepcopy(record)
    spec = record['spec']
    assert record['type'] == 'f104g' and spec['eye'] == OLD_EYE
    assert spec['sight']['eye'] == OLD_EYE
    spec['eye'] = SEATED_EYE.copy()
    spec['sight']['eye'] = SEATED_EYE.copy()
    calibration = spec['opticsCalibration']
    calibration['eyeOffset'] = [round(v - spec['eyeSeated'][i], 6) for i, v in enumerate(SEATED_EYE)]
    calibration['eyeRevision'] = {
        'date': '2026-10-25', 'previousEye': OLD_EYE,
        'rearwardM': 0.24,
        'basis': 'Actual indexed seat-triangle clearance and retained source-combiner boresight',
        'seatTriangleClearanceM': 0.148334,
        'headProbeRadiusM': 0.08,
        'historicalEyeCertification': False,
    }
    assert not calibration['opaqueSupportWarp']
    # This gate makes an accidental non-camera model edit fail before packaging.
    for key in before:
        if key != 'spec':
            assert record[key] == before[key], key
    allowed = {'eye', 'sight', 'opticsCalibration'}
    for key in spec:
        if key not in allowed:
            assert spec[key] == before['spec'][key], key
    assert spec['sight']['points'] == before['spec']['sight']['points']
    assert spec['sight']['eyeBox'] == before['spec']['sight']['eyeBox']
    return record


def patch_app(source):
    if source.count(OLD_HUD) != 1 or NEW_HUD in source:
        raise ValueError('Expected exactly one unpatched cockpit HUD span')
    return source.replace(OLD_HUD, NEW_HUD, 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record', type=Path)
    parser.add_argument('--record-out', type=Path)
    parser.add_argument('--app', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.record:
        if not args.record_out and not args.check:
            parser.error('--record requires --record-out or --check')
        result = repair_record(args.record.read_bytes())
        if not args.check:
            args.record_out.parent.mkdir(parents=True, exist_ok=True)
            args.record_out.write_bytes(result)
        print(json.dumps({'recordBytes': len(result), 'recordSha256': hashlib.sha256(result).hexdigest(), 'eye': SEATED_EYE}))
    if args.app:
        result = patch_app(args.app.read_text())
        if not args.check:
            args.app.write_text(result)
        print(json.dumps({'appSha256': hashlib.sha256(result.encode()).hexdigest()}))
    if not args.record and not args.app:
        parser.error('Provide --record and/or --app')


if __name__ == '__main__':
    main()

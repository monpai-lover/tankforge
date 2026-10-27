#!/usr/bin/env python3
"""Stage the one-branch live result ownership repair in a separate artifact."""
import argparse
import hashlib
import json
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / 'bundle/app.js.html'
BEFORE = '''      } else report.replay_unavailable = "non_authoritative_analysis";
      if (report.shape_transition) report.shape_committed = this.surfaceOwner.commitShape(id2, report.shape_transition);'''
AFTER = '''      } else {
        // The core issued this target state even when this contact has no
        // admitted replay source (for example, an aircraft round on the player).
        // Keep the current actor/life ownership for subsequent admitted fire.
        this.replayAdmission?.bindState(id2, report.state);
        report.replay_unavailable = "non_authoritative_analysis";
      }
      if (report.shape_transition) report.shape_committed = this.surfaceOwner.commitShape(id2, report.shape_transition);'''

def apply(source):
    if AFTER in source:
        return source
    if source.count(BEFORE) != 1:
        raise ValueError('expected canonical Combat.shoot result branch not found exactly once')
    return source.replace(BEFORE, AFTER, 1)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=APP)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve() in {APP.resolve(), args.input.resolve()}:
        parser.error('ROOT owns canonical app; choose a separate candidate artifact')
    source = args.input.read_text(encoding='utf8')
    candidate = apply(source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(candidate.encode('utf8'))
    print(json.dumps({'inputSha256': hashlib.sha256(source.encode()).hexdigest(),
                      'outputSha256': hashlib.sha256(candidate.encode()).hexdigest(),
                      'scope': 'core-issued result ownership for current target actor/life; no replay evidence invented'}))

if __name__ == '__main__':
    main()

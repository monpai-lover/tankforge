#!/usr/bin/env python3
"""Stage a matched AAM flight/seeker budget in a separate app artifact."""
import argparse
import hashlib
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
APP=HERE.parent/'bundle/app.js.html'
START='// BEGIN AAM REALISM BUDGET'
END='// END AAM REALISM BUDGET'

def once(source,before,after):
    if after in source:return source
    if source.count(before)!=1:raise ValueError('expected live AAM source anchor exactly once: '+before[:90])
    return source.replace(before,after,1)

def apply(source):
    helper=(HERE/'aam_realism.js').read_text(encoding='utf8').rstrip()
    if START in source:
        a=source.index(START);b=source.index(END,a)+len(END)
        source=source[:a]+helper+source[b:]
    else:
        source=once(source,'    const AIR_STORE_DEFS = TFMountedDetails.catalogDefinitions({',helper+'\n    const AIR_STORE_DEFS = TFMountedDetails.catalogDefinitions({')
    source=once(source,
      '      if (d > range || angleOf(o.vel, l) > half || !airLos(o.pos, p)) return null;',
      '      if (d > range || angleOf(o.vel, l) > half || !airLos(o.pos, p) || !TF_AAM_REALISM.observationAllowed(o.def, o.pos, o.vel, p, airTargetVel(t), !!(t.flare || t.chaff))) return null;')
    source=source.replace('TF_AAM_REALISM.budget(d, rho, sp, a);','TF_AAM_REALISM.budget(d, rho, sp, a, thrust);')
    source=once(source,
      '              if (la > lim) a = a.map((v2) => v2 * lim / la);',
      '''              if (o.kind === "aam") {
                const budget = TF_AAM_REALISM.budget(d, rho, sp, a, thrust);
                a = budget.accel;
                for (let j = 0; j < 3; j++) acc[j] -= vh[j] * budget.drag;
              } else if (la > lim) a = a.map((v2) => v2 * lim / la);''')
    return source

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',type=Path,default=APP);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    if a.output.resolve() in {APP.resolve(),a.input.resolve()}:p.error('ROOT owns canonical app; choose a separate candidate artifact')
    source=a.input.read_text(encoding='utf8');candidate=apply(source)
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_bytes(candidate.encode())
    print(json.dumps({'inputSha256':hashlib.sha256(source.encode()).hexdigest(),'outputSha256':hashlib.sha256(candidate.encode()).hexdigest(),'scope':'air-target flight/observation only; authoritative hits and damage unchanged'}))

if __name__=='__main__':main()

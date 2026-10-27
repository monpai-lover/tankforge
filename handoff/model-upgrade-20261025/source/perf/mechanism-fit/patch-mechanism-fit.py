#!/usr/bin/env python3
"""Install precomputed mechanism position corrections in both host paths."""
from pathlib import Path
import argparse
HERE=Path(__file__).resolve().parent
def patch(source):
 assert 'var TFMechanismFit=' not in source,'Mechanism fitting already installed'
 marker='  var aircraftGeometry = (() => {'
 assert source.count(marker)==1
 helper=(HERE/'mechanism-fit-runtime.js').read_text().replace('</script','<\\/script')
 source=source.replace(marker,helper+'\n'+marker,1)
 old='      const baseInternal=b.finish();'
 assert source.count(old)==1,'Legacy mechanism input hook is ambiguous'
 source=source.replace(old,'      const baseInternal=TFMechanismFit.fitLegacy(T.id, T.model || AIRCRAFT_MODELS[T.id], b.finish());',1)
 old='upgrade.buildAircraftInterior(plane, { Node, GeoBuilder, engineLayout: TFEngineLayout })'
 if old in source:
  assert source.count(old)==1
  source=source.replace(old,'upgrade.buildAircraftInterior(plane, { Node, GeoBuilder, engineLayout: TFEngineLayout, mechanismFit: TFMechanismFit })',1)
 return source
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
 assert a.input.resolve()!=a.output.resolve()
 a.output.write_text(patch(a.input.read_text()))

#!/usr/bin/env python3
"""Add the all-aircraft rich interior renderer to the current C213 host only."""
from pathlib import Path
import argparse,subprocess
HERE=Path(__file__).resolve().parent
ROOT=HERE.parent.parent
def patch(source,compiled=None):
 if 'TF_ALL_AIRCRAFT_INTERIORS_BEGIN' in source:raise ValueError('All-aircraft interiors already installed')
 if compiled is None:
  compiled=subprocess.check_output([str(ROOT/'perf/node_modules/.bin/esbuild'),str(HERE/'browser-entry.mjs'),'--bundle','--format=iife','--global-name=TFAllAircraftInteriors','--target=es2020','--log-level=warning'],text=True)
 marker='  var aircraftGeometry = (() => {'
 assert source.count(marker)==1,'Aircraft geometry boundary is ambiguous'
 source=source.replace(marker,'  /* TF_ALL_AIRCRAFT_INTERIORS_BEGIN */\n'+compiled.replace('</script','<\\/script')+'\n  /* TF_ALL_AIRCRAFT_INTERIORS_END */\n'+marker,1)
 old='      this.cam = null;\n    }\n    /** On the ground (gear down, flaps half, idle)'
 new='      this.cam = null;\n      TFAllAircraftInteriors.install(this, { Node, engineLayout: TFEngineLayout, mechanismFit: TFMechanismFit });\n    }\n    /** On the ground (gear down, flaps half, idle)'
 assert source.count(old)==1,'Aircraft constructor hook is ambiguous'
 source=source.replace(old,new,1)
 old='      this.partNodes.forEach(n => n.part = this.damage.by[n.part.id]);'
 new=old+'\n      TFAllAircraftInteriors.install(this, { Node, engineLayout: TFEngineLayout, mechanismFit: TFMechanismFit });'
 assert source.count(old)==1,'Damage reset hook is ambiguous'
 source=source.replace(old,new,1)
 start=source.index('    _showParts() {');end=source.index('    /** A piece shot away falls',start)
 scope=source[start:end]
 old='        n.highlight = this.xray && level ? [[1,.76,.12,.5],[1,.3,.03,.65],[.65,.04,.025,.8]][level-1] : null;\n      }\n    }'
 new='        n.highlight = this.xray && level ? [[1,.76,.12,.5],[1,.3,.03,.65],[.65,.04,.025,.8]][level-1] : null;\n      }\n      TFAllAircraftInteriors.show(this);\n    }'
 assert scope.count(old)==1,'X-ray/damage update hook is ambiguous'
 scope=scope.replace(old,new,1);source=source[:start]+scope+source[end:]
 old='      this.disposed = true;\n      this.instruments?.dispose();'
 new='      this.disposed = true;\n      TFAllAircraftInteriors.dispose(this);\n      this.instruments?.dispose();'
 assert source.count(old)==1,'Aircraft disposal hook is ambiguous'
 source=source.replace(old,new,1)
 return source
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
 assert a.input.resolve()!=a.output.resolve()
 a.output.write_text(patch(a.input.read_text()))

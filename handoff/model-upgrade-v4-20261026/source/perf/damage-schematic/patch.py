#!/usr/bin/env python3
"""Replace only the aircraft damage schematic; physics and HP stay untouched."""
from pathlib import Path
import argparse,subprocess
HERE=Path(__file__).resolve().parent
def patch(source,compiled):
 if 'TF_DAMAGE_SCHEMATIC_BEGIN' in source:raise ValueError('Damage schematic already installed')
 marker='  var aircraftGeometry = (() => {'
 assert source.count(marker)==1
 code=compiled.replace('</script','<\\/script')
 source=source.replace(marker,'  /* TF_DAMAGE_SCHEMATIC_BEGIN */\n'+code+'\n  /* TF_DAMAGE_SCHEMATIC_END */\n'+marker,1)
 start=source.index('    function drawDamage(air) {');end=source.index('    /**',start)
 body='''    function drawDamage(air) {
      TFAircraftDamagePanel.draw(air.plane, airEl.dmg, {
        language: LANG, engineLayout: typeof TFEngineLayout === "undefined" ? null : TFEngineLayout
      });
    }
'''
 return source[:start]+body+source[end:]
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('output',type=Path);p.add_argument('--esbuild',type=Path,default=HERE.parent/'node_modules/.bin/esbuild');a=p.parse_args()
 compiled=subprocess.check_output([str(a.esbuild),str(HERE/'helper.mjs'),'--bundle','--format=iife','--global-name=TFAircraftDamagePanel','--target=es2020','--log-level=warning'],text=True)
 a.output.write_text(patch(a.input.read_text(),compiled))

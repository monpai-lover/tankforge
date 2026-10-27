#!/usr/bin/env python3
"""Install source-guarded Me262 optics placement before imported-model setup."""
from pathlib import Path
import argparse,subprocess
def patch(source,compiled):
 if 'TF_ME262_SIGHT_BEGIN' in source:raise ValueError('Me262 sight normalization already installed')
 wrapper='<script>(() => {'
 if source.count(wrapper)!=1:raise ValueError('Unknown main script wrapper')
 source=source.replace(wrapper,wrapper+'\n/* TF_ME262_SIGHT_BEGIN */\n'+compiled.replace('</script','<\\/script')+'\n/* TF_ME262_SIGHT_END */\n',1)
 old='    for (const [id2, m] of Object.entries(models || {})) {\n      try {\n        const buf = await inflate(m.blob), img = typeof Image === "undefined" ? null : new Image(), nimg = typeof Image === "undefined" ? null : new Image();'
 new='''    for (const [id2, inputModel] of Object.entries(models || {})) {
      try {
        let m = inputModel;
        const sourceBuffer = await inflate(m.blob);
        const sightCorrection = TFMe262Sight.normalizeMe262Sight(id2, m, sourceBuffer);
        m = sightCorrection.model;
        const buf = sightCorrection.buf, img = typeof Image === "undefined" ? null : new Image(), nimg = typeof Image === "undefined" ? null : new Image();'''
 if source.count(old)!=1:raise ValueError('Imported model decoder hook is ambiguous')
 return source.replace(old,new,1)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('output',type=Path);p.add_argument('--module',type=Path,default=Path(__file__).with_name('normalize-me262-sight.mjs'));p.add_argument('--esbuild',default='perf/node_modules/.bin/esbuild');a=p.parse_args()
 compiled=subprocess.check_output([a.esbuild,str(a.module),'--bundle','--format=iife','--global-name=TFMe262Sight','--target=es2020','--log-level=warning'],text=True)
 if a.input.resolve()==a.output.resolve():raise ValueError('Preserve the input')
 a.output.write_text(patch(a.input.read_text(),compiled));print(a.output)

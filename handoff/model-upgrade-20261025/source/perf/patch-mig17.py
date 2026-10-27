from pathlib import Path
import re,subprocess,argparse

def patch(source,compiled):
 if 'TF_MIG17_WING_BEGIN' in source:raise ValueError('MiG17 correction already installed')
 a='<script>(() => {'
 if source.count(a)!=1:raise ValueError('Unsupported main script wrapper')
 old='      AIRCRAFT_MODELS[id2] = { ...m, blob: null, buf, img, nimg };'
 new='      const correctedWing = TFMig17Wing.normalizeMig17Wing(id2, m, buf);\n      AIRCRAFT_MODELS[id2] = { ...correctedWing.model, blob: null, buf: correctedWing.buf, img, nimg };'
 if source.count(old)!=1:raise ValueError('Aircraft decode hook is not unique')
 code=compiled.replace('</script','<\\/script')
 return source.replace(a,a+'\n/* TF_MIG17_WING_BEGIN */\n'+code+'\n/* TF_MIG17_WING_END */\n',1).replace(old,new,1)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('output',type=Path);p.add_argument('--module',type=Path,default=Path('work/tankforge-live-flight-patch/source/handoff/flight-rust/mig17-wing.mjs'));p.add_argument('--esbuild',default='perf/node_modules/.bin/esbuild');a=p.parse_args()
 compiled=subprocess.check_output([a.esbuild,str(a.module),'--bundle','--format=iife','--global-name=TFMig17Wing','--target=es2020','--log-level=warning'],text=True)
 result=patch(a.input.read_text(),compiled)
 if a.input.resolve()==a.output.resolve():raise ValueError('Use a separate output')
 a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(result)
 print(a.output)

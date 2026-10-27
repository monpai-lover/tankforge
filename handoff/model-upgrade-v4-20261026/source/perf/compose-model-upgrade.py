#!/usr/bin/env python3
"""Compose model presentation/station fixes without replacing combat or flight."""
from pathlib import Path
import argparse,hashlib,importlib.util,json,re,subprocess
ROOT=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('--skip-hardpoints',action='store_true');p.add_argument('--output',type=Path,default=ROOT/'perf/model-upgrade-app.html');args=p.parse_args()
def mod(name,file):
    spec=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def bundle(path,name):
    return subprocess.check_output([str(ROOT/'perf/node_modules/.bin/esbuild'),str(ROOT/path),'--bundle','--format=iife','--global-name='+name,'--target=es2020','--log-level=warning'],text=True)
original=(ROOT/'perf/site-live-current-app.html').read_text();s=original
s,render=mod('render',ROOT/'perf/patch-render.py').patch(s,(ROOT/'perf/aircraft-render-cull.mjs').read_text())
s=mod('wing',ROOT/'perf/patch-mig17.py').patch(s,bundle('work/tankforge-live-flight-patch/source/handoff/flight-rust/mig17-wing.mjs','TFMig17Wing'))
s=mod('engine',ROOT/'perf/engine/patch-engine.py').patch_app(s)
s=mod('view',ROOT/'perf/patch-mechanism-view.py').patch(s)
s=mod('fit',ROOT/'perf/mechanism-fit/patch-mechanism-fit.py').patch(s)
old='      const noz = P.type.nozzle;';assert s.count(old)==1
s=s.replace(old,'      const noz = TFEngineLayout.nozzleFor(P.type.id, P.type.model) || P.type.nozzle;',1)
s=mod('me262',ROOT/'perf/me262-sight/patch-me262-sight.py').patch(s,bundle('perf/me262-sight/normalize-me262-sight.mjs','TFMe262Sight'))
s=mod('all_interiors',ROOT/'perf/all-interior/patch.py').patch(s)
s=mod('damage_panel',ROOT/'perf/damage-schematic/patch.py').patch(s,bundle('perf/damage-schematic/helper.mjs','TFAircraftDamagePanel'))
if not args.skip_hardpoints:
    s=mod('hardpoints',ROOT/'perf/hardpoints/patch.py').patch(s)
    s=mod('mounted_details',ROOT/'perf/mount-v3/patch.py').patch(s)
preserved={}
presentation_hooks={
    'item.node.local = quatMatrix(item.p, [0, 0, 0, 1]);':'item.node.local = quatMatrix(item.p, TFModelHardpoints.storeRotation(item));',
    'node.local=quatMatrix(store.p,[0,0,0,1]);':'node.local=quatMatrix(store.p,TFModelHardpoints.storeRotation(store,plane.type));',
}
reviewed_presentation_blocks={}
for label in re.findall(r'^\s*// BEGIN (.+)$',original,re.M):
    start=original.index('// BEGIN '+label);endmarker='// END '+label
    if endmarker in original[start:]:
        end=original.index(endmarker,start)+len(endmarker);before=original[start:end];expected=before
        changes=[]
        for old,new in presentation_hooks.items():
            if old in expected:
                assert expected.count(old)==1
                expected=expected.replace(old,new,1);changes.append({'old':old,'new':new})
        preserved[label]=expected in s
        if changes:reviewed_presentation_blocks[label]=changes
assert all(preserved.values()),preserved
out=args.output;out.write_text(s)
report={'base_app_sha256':hashlib.sha256(original.encode()).hexdigest(),'target_app_sha256':hashlib.sha256(s.encode()).hexdigest(),
        'target_app_bytes':len(s.encode()),'tagged_features_preserved':preserved,
        'reviewed_native_presentation_hooks':reviewed_presentation_blocks,
        'flight_backend_replaced':False,'ccip_modified':False,'server_combat_modified':False,
        'hardpoints_included':not args.skip_hardpoints,
        'render_culling':render['hooks'],'station_changes':'measured source mounts and documented procedural adapters; native host positions retain authority'}
report_path=ROOT/'perf/model-upgrade-merge-report.json' if out.resolve()==(ROOT/'perf/model-upgrade-app.html').resolve() else out.with_name(out.stem+'-merge-report.json')
report_path.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))

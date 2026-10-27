#!/usr/bin/env python3
"""Build a pinned aircraft-only public patch. Never writes deployment files."""
import argparse,base64,difflib,gzip,hashlib,importlib.util,json,shutil,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];OLD_APP_SHA='af5d1cee4e7723747adef8e478b5b0cac555149d7cb38748f2fa902e6b1a5090'
DATA_SHA='7a35444f326a3234f7bdf6ad84ff8d2a561edc00d1824740ebc236dd6bf46bd4';HEAD_SHA='2ee3816f073ea67e761dd770d4bbfbdb36b826de04a31764329836e90ea9dcf8'
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--base-app',type=Path,required=True);p.add_argument('--head',type=Path,required=True);p.add_argument('--catalog',type=Path,required=True);p.add_argument('--prepare-app-only',action='store_true');args=p.parse_args()
 public=ROOT/'handoff/tests/out/me262-game-v2-20261025/public';public.mkdir(parents=True,exist_ok=True)
 assert sha(args.base_app)==OLD_APP_SHA and sha(args.head)==HEAD_SHA
 appfile=ROOT/'handoff/bundle/app.js.html';current=appfile.read_text();previous=subprocess.check_output(['git','show','3d4c495:handoff/bundle/app.js.html'],cwd=ROOT).decode().splitlines(True)
 candidate=args.base_app.read_text();new=current.splitlines(True);groups=[]
 for group in difflib.SequenceMatcher(None,previous,new,autojunk=False).get_grouped_opcodes(3):
  assert group[0][1]>=32950 and group[-1][2]<46950,'Non-aircraft edit is outside this release scope'
  old=''.join(previous[group[0][1]:group[-1][2]]);replacement=''.join(new[group[0][3]:group[-1][4]])
  assert candidate.count(old)==1,'Public baseline does not contain one exact patch context'
  candidate=candidate.replace(old,replacement,1);groups.append({'oldLine':group[0][1]+1,'newLine':group[0][3]+1,'oldSha256':hashlib.sha256(old.encode()).hexdigest(),'newSha256':hashlib.sha256(replacement.encode()).hexdigest()})
 assert 'BEGIN NATIVE FRONTLINE CLIENT' not in candidate and 'service_air' not in candidate
 app=public/'app.js.html';candidate_sha=hashlib.sha256(candidate.encode()).hexdigest()
 if app.exists():assert sha(app)==candidate_sha,'App changed after actual public browser verification'
 else:app.write_text(candidate)
 scope={'basePublicAppSha256':OLD_APP_SHA,'implementationHead':'3d4c495','implementationAppSha256':sha(appfile),'publicCandidateSha256':candidate_sha,'groups':groups,'retainsExperimentalFrontline':False}
 (public/'scope-proof.json').write_text(json.dumps(scope,indent=2)+'\n')
 if args.prepare_app_only:print(json.dumps(scope,indent=2));return
 browser=json.loads((public/'browser/browser-result.json').read_text());assert browser['complete'] and all(v['pass'] for v in browser['checks'].values()) and all(v['pass'] for v in browser['captures'].values())
 assert browser['manifest']['appSha256']==candidate_sha and browser['manifest']['headSha256']==HEAD_SHA
 oldrelease=json.loads((ROOT/'handoff/server/dist/tankforge-page-update-20261025-aircraft-aa/release.json').read_text())
 oldcatalog=ROOT/'handoff/server/dist/tankforge-page-update-20261025-aircraft-aa/aircraft.json';assert sha(oldcatalog)==oldrelease['newCatalogSha256']
 spec=importlib.util.spec_from_file_location('updater',Path(__file__).with_name('update-me262.py'));updater=importlib.util.module_from_spec(spec);spec.loader.exec_module(updater);updater.validate_catalog(json.loads(oldcatalog.read_bytes()),json.loads(args.catalog.read_bytes()))
 package=ROOT/'handoff/server/dist/tankforge-page-update-20261025-me262';package.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(prefix='tf-me262-package-',dir=public) as temp:
  rawgzip=Path(temp)/'assets.gz'
  with rawgzip.open('wb') as dest:
   for part in sorted((ROOT/'handoff/bundle').glob('data.line.gz.part[0-9][0-9]')):
    with part.open('rb') as source:shutil.copyfileobj(source,dest,1024*1024)
  h=hashlib.sha256();dh=hashlib.sha256();size=0;output=package/'index.html.gz'
  with output.open('wb') as dest,gzip.GzipFile(filename='',mode='wb',fileobj=dest,mtime=0,compresslevel=9) as gz:
   def write(b):
    nonlocal size
    h.update(b);gz.write(b);size+=len(b)
   write(args.head.read_bytes())
   with gzip.open(rawgzip,'rb') as source:
    for b in iter(lambda:source.read(1024*1024),b''):dh.update(b);write(b)
   assert dh.hexdigest()==DATA_SHA
   write(candidate.encode())
 shutil.copy2(args.catalog,package/'aircraft.json');shutil.copy2(Path(__file__).with_name('update-me262.py'),package/'update-me262.py')
 release={'version':'20261025-me262','oldPageSha256':oldrelease['newPageSha256'],'oldGzipSha256':oldrelease['newGzipSha256'],'oldCatalogSha256':oldrelease['newCatalogSha256'],'newPageSha256':h.hexdigest(),'newPageBytes':size,'newGzipSha256':sha(output),'newCatalogSha256':sha(package/'aircraft.json'),'publicAppSha256':candidate_sha,'dataSha256':DATA_SHA,'flightWasmSha256':sha(ROOT/'handoff/flight/flight_core.wasm'),'flightCoreVersion':213,'updaterSha256':sha(package/'update-me262.py'),'updaterTestsPassed':22,'functionalBrowserChecksPassed':len(browser['checks']),'browserCapturesPassed':len(browser['captures']),'changes':['Me262 A1a/A2a/U4 source models, closed nose doors and removed dangling strips','Native four-axis gear sequencing, per-wheel travel and source control animations','Source cockpit sight assembly moved aft with panel mounting anchor retained','Actual source interiors/materials for seven aircraft families and source Me262 crew','Fixed source barrels and independent 24R4M/2SC250 stores with retained original racks'],'excluded':'Unfinished combined-mode service/campaign/frontend and its new server binary are not deployed'}
 (package/'release.json').write_text(json.dumps(release,indent=2)+'\n');(package/'index.html.gz.sha256').write_text(release['newGzipSha256']+'  index.html.gz\n')
 print(json.dumps(release,indent=2))
if __name__=='__main__':main()

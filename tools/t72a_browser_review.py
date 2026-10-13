"""Local, reproducible WebGL2 review of the actual game modules.
Requires Python Playwright, Node, Chromium and (on headless Linux) an existing X display.
No remote URL, repository edits, production build or screenshot forgery.
Example: python tools/t72a_browser_review.py --root . --out target/review-new --label after --display :98
The output directory must be new, so no previous test HTML or evidence is overwritten.
"""
import argparse, os, json, sys, re, traceback, posixpath, shutil, subprocess, hashlib
from pathlib import Path
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1])
parser.add_argument('--out',type=Path,required=True)
parser.add_argument('--label',choices=['before','after'],default='after')
parser.add_argument('--chromium',default=shutil.which('chromium') or shutil.which('chromium-browser'))
parser.add_argument('--display',default=os.environ.get('DISPLAY'))
args=parser.parse_args()
repo=args.root.resolve(); evidence=args.out.resolve(); prefix=args.label
if not (repo/'client/web/src/boot.js').is_file(): parser.error('Not a TankForge source root')
if not args.chromium: parser.error('Pass an installed Chromium executable via --chromium')
if evidence.exists(): parser.error('Output exists. Use a new directory to preserve earlier evidence')
evidence.mkdir(parents=True)
if args.display: os.environ['DISPLAY']=args.display
prepared=evidence/'page'
subprocess.run(['node',str(Path(__file__).with_name('t72a_prepare_review.mjs')),str(repo),str(prepared)],check=True)
failed=False
sources={}
# Preserve the source modules, using a local import map in an about:blank document.
# Browser enterprise policy denies URL navigations; these blobs contain only repo code.
for file in (repo/'client/web/src').rglob('*.js'):
 name=file.relative_to(repo).as_posix()
 text=file.read_text()
 def replace(m):
  head, quote, target=m.groups()
  return head+quote+'tf:'+posixpath.normpath(posixpath.join(posixpath.dirname(name),target))+quote
 text=re.sub(r'''(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(['"])(\.[^'"\n]+)\2''',replace,text)
 text=re.sub(r"\s+with\s*\{\s*type\s*:\s*['\"]json['\"]\s*\}",'',text)
 sources['tf:'+name]=text
for file in (repo/'client/web/src').rglob('*.json'):
 sources['tf:'+file.relative_to(repo).as_posix()]='export default '+file.read_text()+';\n'
for name, code in list(sources.items()):
 for dependency in re.findall(r'[\"\'](tf:[^\"\']+)[\"\']',code):
  if dependency not in sources:
   file=repo/dependency[3:]
   if file.suffix=='.json' and file.is_file():sources[dependency]='export default '+file.read_text()+';\n'
   else:print('UNRESOLVED',dependency,flush=True)
html=(prepared/'index.html').read_text()
html=re.sub(r'<script\b[^>]*>.*?</script>','',html,flags=re.S)
html=re.sub(r'<link\b[^>]*>','',html)
data=(prepared/'data.json').read_text()
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox','--disable-gpu-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
 page=b.new_page(viewport={'width':1440,'height':1000},device_scale_factor=1)
 errors=[]; messages=[]
 page.on('pageerror', lambda err: (errors.append(str(err)),print('PAGE ERROR',str(err),flush=True)))
 page.on('console',lambda m: (messages.append(m.type+': '+m.text),print('console',m.type,m.text,flush=True)) if m.type in ['error','warning'] else None)
 page.on('requestfailed',lambda r:print('FAILED',r.url[:150],r.failure,flush=True))
 page.route('https://**',lambda r:r.abort())
 try:
  page.set_content(html,wait_until='domcontentloaded')
  page.evaluate('''({sources,data})=>{
    // This review document has no network origin. Supply ephemeral storage only.
    const store=new Map(); const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k),clear:()=>store.clear()};
    Object.defineProperty(window,'localStorage',{value:storage});Object.defineProperty(window,'sessionStorage',{value:storage});
    const element=document.createElement('script');element.id='tf-data';element.type='application/json';element.textContent=data;document.body.append(element);
    const imports=Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,URL.createObjectURL(new Blob([v],{type:'text/javascript'}))]));
    const map=document.createElement('script');map.type='importmap';map.textContent=JSON.stringify({imports});document.head.append(map);
    const boot=document.createElement('script');boot.type='module';boot.textContent='import "tf:client/web/src/boot.js";';document.body.append(boot);
  }''',{'sources':sources,'data':data})
  for tick in range(30):
   page.wait_for_timeout(1000)
   status=page.evaluate("()=>({ready:!!window.__tf, stage:document.getElementById('boot-stage')?.textContent, fatal:document.getElementById('fatal-text')?.textContent})")
   print('boot',status,'errors:',errors,'messages:',messages,flush=True)
   if status['ready']:break
   if status.get('fatal'):raise RuntimeError(status['fatal'])
  page.wait_for_function('window.__tf',timeout=5000)
  page.evaluate("""()=>{const t=window.__tf;t.pause();t.setQuality('low');t.renderer.q={...t.renderer.q,dome:256};t.renderer._buildDome(256);t.G.thumbs.length=0;t.G.spinHold=1e6;document.getElementById('g-loading').hidden=true;t.toGarage();t.select('su_t72a');t.G.thumbs.length=0;t.advance(1,[],false);t.setPixel(0);document.body.dataset.touch='1';}""")
  uiStyle=page.add_style_tag(content="#garage,#battle-ui,#hud,#overlay,#toast{display:none!important}")
  def frame(name,cam=2.3,cp=-.23,dist=20,center=1.0,height=1.08,yaw=0,pitch=0,recoil=0):
   state=page.evaluate("""({cam,cp,dist,center,height,yaw,pitch,recoil})=>{const t=window.__tf,G=t.G;
    G.T[0].yaw=yaw*Math.PI/180;G.T[0].guns[0].pitch=pitch*Math.PI/180;
    G.T[0].guns[0].recoil=recoil*.31;
    G.cam.yaw=G.s.heading+cam;G.cam.pitch=cp;G.cam.shake=0;G.cam.kick=0;
    G.camOverride={fov:.42,dist,pivot:[G.s.x+Math.sin(G.s.heading)*center,height+(G.s.y||0),G.s.z+Math.cos(G.s.heading)*center]};
    t.advance(1/60);return {state:t.state(),barrelSlide:G.model.turrets[0].guns[0].barrel.pos.slice(),camera:{pos:G.camPos,forward:G.camFwd},bindingErrors:G.bundle.binding_errors||[]};
   }""",dict(cam=cam,cp=cp,dist=dist,center=center,height=height,yaw=yaw,pitch=pitch,recoil=recoil))
   filename=f'{prefix}-{name}.png'
   page.screenshot(path=str(evidence/filename))
   print('CAPTURED',filename,flush=True)
   frames.append(dict(file=filename,**state))
  frames=[]
  frame('front3q')
  frame('side',cam=1.57079632679,cp=-.035,dist=23,center=1.05)
  frame('rear3q',cam=.58,cp=-.26,center=-.4)
  frame('turret',cam=2.30,cp=-.23,dist=9,center=.35,height=1.86)
  frame('front',cam=3.14159265,cp=-.12,dist=17,center=.3)
  frame('elevation',cam=1.5707963,cp=-.10,dist=23,center=.9,pitch=13)
  frame('depression-recoil',cam=1.5707963,cp=-.05,dist=23,center=-1.0,yaw=180,pitch=-6,recoil=1)
  page.evaluate('()=>{const t=window.__tf;t.setXray(true);t.G.xrayLatched=true;}')
  frame('interior',cam=2.1,cp=-.40,dist=14,center=.0,height=1.0)
  page.evaluate('()=>{const t=window.__tf;t.setXray(false);t.G.xrayLatched=false;}')
  battle=page.evaluate("""async()=>{const t=window.__tf;await t.coreReady();t.G.camOverride=null;t.setMapChoice('range');t.startBattle();t.advance(2,[],false);return {state:t.state(),bindingErrors:t.G.bundle.binding_errors||[]};}""")
  frame('battle',cam=2.3,cp=-.23,dist=19,center=.6)
  movement=page.evaluate("""()=>{const t=window.__tf,G=t.G;const before={state:t.state(),wheelAngles:G.model.wheels.map(w=>w.node.pitch)};t.advance(1.5,['fwd'],false);return {before,after:{state:t.state(),wheelAngles:G.model.wheels.map(w=>w.node.pitch)}};}""")
  frame('running',cam=1.8,cp=-.22,dist=21,center=.7)
  mg=page.evaluate("""()=>{const t=window.__tf,G=t.G;let n=0;while(G.sightM!==1&&n++<8)t.cycleSightGun();
    const e=G.MG[1],pm=G.model.mgs.find(m=>m.index===1);const before=pm.post.pos.slice();
    G.camOverride=null;G.ret=null;G.cam.yaw=G.s.heading+.4;G.cam.pitch=.10;G.cam.shake=0;G.cam.kick=0;t.advance(5,[],false);
    const flashes=[],prior=t.fx.mgFlash.bind(t.fx);t.fx.mgFlash=(p,d,c)=>{flashes.push(p.slice());return prior(p,d,c);};
    G.fireHeld=true;t.advance(.5);G.fireHeld=false;t.fx.mgFlash=prior;
    const m=pm.node.world,v=pm.muzzleVector,expected=[0,1,2].map(k=>m[12+k]+m[k]*v[0]+m[4+k]*v[1]+m[8+k]*v[2]);
    const emitted=flashes.at(-1);return {selected:G.sightM,control:G.weaponControl,postBefore:before,postAfter:pm.post.pos.slice(),expected,emitted:emitted||null,error:emitted?Math.hypot(...expected.map((x,k)=>x-emitted[k])):null,fired:e.st.fired,state:t.state(),caps:G.caps};
  }""")
  frame('mg-control',cam=2.8,cp=-.17,dist=11,center=.25,height=1.95)
  uiStyle.evaluate('(el)=>el.remove()')
  page.evaluate("""()=>{const t=window.__tf,G=t.G;let n=0;while(G.sightM>=0&&n++<8)t.cycleSightGun();
   G.camOverride=null;G.ret=null;G.free=false;G.cam.yaw=G.s.heading;G.cam.pitch=.015;G.cam.shake=G.cam.kick=0;
   t.advance(3,[],false);t.toggleSight();t.advance(3);}""")
  # The real sight image, not a front-facing exterior photo.
  page.screenshot(path=str(evidence/f'{prefix}-sight.png'))
  receipt={'renderer':'Chromium '+b.version+' / WebGL2 / ANGLE SwiftShader / Xvfb; actual boot.js/main.js, local blob import-map packaging',
   'sourceRoot':str(repo),'sourceHashes':{f:hashlib.sha256((repo/f).read_bytes()).hexdigest() for f in ['data/vehicles/su_t72a/visual.json','client/web/src/gfx/tankmodel.js','client/web/src/gfx/mgmodel.js','data/machine_guns.json']},'frames':frames,'battle':battle,'movement':movement,'machineGunControl':mg,
   'sightState':page.evaluate('()=>window.__tf.state()'),'errors':errors,'messages':messages,
   'scopeLimits':['No replay-controller or hit-camera sequence exercised.','Only the existing closed hatch state is available.',
   'UI hidden for clean geometry comparisons; world, tank, animation and gunnery use existing game code.','Audio muted by Chromium; audio is not accepted in this task.']}
  (evidence/f'{prefix}-browser-receipt.json').write_text(json.dumps(receipt,indent=2))
  print('RECEIPT',json.dumps({'errors':errors,'mg':mg,'frames':len(frames)}),flush=True)

 except Exception:
  failed=True
  traceback.print_exc()
  page.screenshot(path=str(evidence/f'{prefix}-browser-failure.png'))
 finally:
  print('errors',errors);print('messages',messages)
  (evidence/f'{prefix}-browser-errors.json').write_text(json.dumps({'errors':errors,'messages':messages},indent=2))
  b.close()

if failed or errors: sys.exit(1)

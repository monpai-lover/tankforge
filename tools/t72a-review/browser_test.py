"""Independent GPU/CPU review acceptance. Needs Python Playwright and Chromium.
Writes only a NEW evidence directory. Does not modify the production game.
"""
import argparse, hashlib, os, json
from pathlib import Path
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser()
parser.add_argument('--html',type=Path,required=True)
parser.add_argument('--out',type=Path,required=True)
parser.add_argument('--chromium',default='/usr/bin/chromium')
parser.add_argument('--display')
args=parser.parse_args()
if args.display: os.environ['DISPLAY']=args.display
if not args.html.is_file(): parser.error('Missing HTML review')
out=args.out
if out.exists(): parser.error('Output already exists; choose a new directory')
out.mkdir(parents=True)
html_sha256=hashlib.sha256(args.html.read_bytes()).hexdigest()
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
 page=b.new_page(viewport={'width':1440,'height':960},device_scale_factor=1)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.set_content(args.html.read_text(encoding='utf-8'),wait_until='load');page.wait_for_function('window.__realHitReview',timeout=20000)
 page.screenshot(path=str(out/'details-front.png'))
 rasters=[]
 for i,(yaw,elev,recoil,angle) in enumerate([(0,0,0,.92),(72,13,1,2.1),(-110,-6,1,.5),(180,0,0,1.570796)]):
  page.evaluate('''([y,p,r,a])=>{document.querySelector('#turret').value=y;document.querySelector('#elev').value=p;document.querySelector('#recoil').value=r;__realHitReview.pose();__realHitReview.view(a,.22,15.7,[0,1.1,1.1]);}''',[yaw,elev,recoil,angle])
  result=page.evaluate('()=>__realHitReview.verifyRaster(28,20)');rasters.append({'pose':[yaw,elev,recoil,angle],**result});print('RASTER',i,result,flush=True)
 page.evaluate('''()=>{document.querySelector('#turret').value=0;document.querySelector('#elev').value=0;document.querySelector('#recoil').value=0;__realHitReview.pose();__realHitReview.view(.92,.28,15.7,[0,1.1,1.1]);}''')
 page.check('#wire');page.screenshot(path=str(out/'realhit-wireframe.png'))
 page.uncheck('#wire');hit=page.evaluate('()=>__realHitReview.fire([0,1.1,4],[0,1.1,2.5])');page.screenshot(path=str(out/'realhit-glacis.png'))
 page.click('#bore');bore=page.evaluate('()=>__realHitReview.last()');page.screenshot(path=str(out/'realhit-bore.png'))
 page.select_option('#radius','.0625');page.click('#bore');rim=page.evaluate('()=>__realHitReview.last()');page.screenshot(path=str(out/'realhit-bore-volume.png'))
 page.select_option('#radius','0');page.click('#gap');gap=page.evaluate('()=>__realHitReview.last()');page.screenshot(path=str(out/'realhit-wheel-gap.png'))
 page.click('#home');page.set_viewport_size({'width':393,'height':852});page.screenshot(path=str(out/'mobile.png'),full_page=True)
 result={'loadingMode':'about:blank set_content; direct file navigation not verified','htmlSha256':html_sha256,'browser':b.version,'errors':errors,'rasterComparisons':rasters,'glacis':hit,'bore':bore,'rimVolume':rim,'wheelGap':gap,'mode':'Geometry review renderer using unmodified model vertex buffers; not combat authority'}
 (out/'browser-receipt.json').write_text(json.dumps(result,indent=2),encoding="utf-8");print('DONE',errors,flush=True)
 b.close()
 assert not errors
 assert all(not r['coverageMismatches'] and not r['depthMismatches'] for r in rasters)
 assert bore['hit'] is None and gap['hit'] is None and hit['hit'] and rim['hit']

#!/usr/bin/env python3
"""One offline SwiftShader browser using actual game code/meshes/WASM213."""
import argparse,asyncio,hashlib,json,runpy,time,traceback
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,default=ROOT/'handoff/tests/out/me262-game-v2-20261025/browser');OUT=parser.parse_args().out.resolve()
ARGS=runpy.run_path(str(Path(__file__).with_name('public-air-radar-browser.py')))['ARGS']
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
async def run():
 manifest=json.loads((OUT/'page-provenance.json').read_text());result={'scope':'Offline actual game GPU visual/function fixture; no online authority or GPU performance certification','checks':{},'phases':{},'captures':{},'manifest':manifest};logs=[]
 def save():(OUT/'browser-result.json').write_text(json.dumps(result,indent=2)+'\n');(OUT/'browser-console.json').write_text(json.dumps(logs,indent=2)+'\n')
 def check(k,ok,detail=None):
  result['checks'][k]={'pass':bool(ok),'detail':detail};save()
  if not ok:raise AssertionError(k)
 async with async_playwright() as pw:
  browser=None
  try:
   check('frozen_source',sha(Path(manifest['page']))==manifest['pageSha256'] and sha(Path(manifest['app']))==manifest['appSha256'] and all(sha(Path(v['path']))==v['sha256'] for v in manifest['models'].values()))
   browser=await pw.chromium.launch(headless=True,args=ARGS);page=await browser.new_page(viewport={'width':1080,'height':720},locale='zh-CN')
   await page.route_web_socket('**',lambda ws:ws.close());page.on('console',lambda m:logs.append({'type':m.type,'text':m.text[:1500]}));page.on('pageerror',lambda e:logs.append({'type':'pageerror','text':str(e)}))
   await page.add_init_script("localStorage.setItem('tankforge.lang','zh');localStorage.setItem('tankforge.quality.v1','low');localStorage.removeItem('tf.airKeys');")
   await page.goto(Path(manifest['page']).as_uri(),wait_until='load',timeout=120000);await page.wait_for_function('!!window.__tf&&!!window.__tfx&&!document.getElementById("boot-splash")',timeout=120000)
   await page.evaluate((ROOT/'handoff/tests/me262-browser.js').read_text());boot=await page.evaluate('__meQa.ready()');check('actual_core_and_variant_cards',boot['core']==213 and all(boot['cards']),boot)
   async def capture(name):
    try:await page.screenshot(path=str(OUT/(name+'.png')),timeout=10000);result['captures'][name]={'pass':True}
    except Exception as e:result['captures'][name]={'pass':False,'error':str(e)}
    save()
   await page.evaluate("__tf.setMapChoice('range');__tf.startBattle();__tf.pause(true)")
   for id,guns in [('me262',4),('me262a2a',2),('me262u4',1)]:
    print('PHASE '+id,flush=True)
    if await page.evaluate('!!__tf.G.air?.active'):await page.evaluate('__tfx.exitAircraft(true)')
    await page.evaluate('__tf.pause(false)');await page.keyboard.press('F8');await page.evaluate('__tf.pause(true)');await page.locator(f'#hangar .hangar-card[data-air="{id}"]').click(timeout=15000);await page.wait_for_function(f'__tf.G.air?.active&&__tf.G.air.plane.type.id==="{id}"',timeout=20000)
    start=await page.evaluate('__meQa.air()');check(id+'_source_model_gpu_and_guns',start['core']==213 and start['finite'] and not start['crashed'] and start['gpuBuffers']==start['meshCount'] and len(start['internal'])>10 and len(start['guns'])==guns and all(g['belt'] and g['mount'][2]>3 for g in start['guns']),start)
    await page.evaluate('__meQa.camera([10,-3.5,10])');await capture(id+'-gear-up')
    down=await page.evaluate('__meQa.gear()');check(id+'_native_gear_down',all(abs(v-1)<1e-5 for v in down['end']['axes']),{'end':down['end']['axes'],'samples':down['samples']});await capture(id+'-gear-down')
    up=await page.evaluate('__meQa.gear()');check(id+'_native_gear_up',all(abs(v)<1e-5 for v in up['end']['axes']),{'end':up['end']['axes'],'samples':up['samples']})
    await page.evaluate('__meQa.camera([8,3,7])');await page.evaluate('__meQa.xray(true)');await capture(id+'-source-interior');await page.evaluate('__meQa.xray(false)')
    cockpit=await page.evaluate('__meQa.cockpit()');check(id+'_sight_eye_and_no_white_cross',cockpit['aimHidden'] and cockpit['noseHidden'] and abs(cockpit['eye'][2]+.195)<1e-6 and len(cockpit['sight'])>=4,cockpit);await capture(id+'-cockpit')
    before=[g['ammo'] for g in cockpit['guns']];await page.evaluate('__tf.G.air.fireAll=true;__tf.advance(.4,[],false);__tf.G.air.fireAll=false;__tf.advance(1/60,[],true)');fired=await page.evaluate('__meQa.probe()');check(id+'_actual_gun_discharge',all(g['ammo']<n and g['fired']>0 for g,n in zip(fired['guns'],before)),fired['guns'])
    if id!='me262u4':
     st=await page.evaluate('__meQa.mount(1)');n=24 if id=='me262' else 2
     check(id+'_original_store_and_rack_count',len(st['stores'])==n and len({i['socket'] for i in st['stores']})==n and all(i['source'] and i['rack'] and i['vertices']>0 for i in st['stores']),st['stores'])
     await page.evaluate('__meQa.camera([7,-3,6])');await capture(id+'-original-stores');drops=await page.evaluate('__meQa.releaseAll()');check(id+'_individual_native_store_release',len(drops)==n and all(d['after']==d['before']-1 and d['source'] and d['racks']==n for d in drops),drops)
    result['phases'][id]={'initial':start,'cockpit':cockpit,'fired':fired};save()
   check('no_page_errors',not any(x['type']=='pageerror' for x in logs),logs);result['cleanup']=await page.evaluate('__meQa.cleanup()');result['complete']=True
  except Exception as e:result['complete']=False;result['error']=str(e);result['traceback']=traceback.format_exc();save();raise
  finally:
   if browser:await browser.close()
   save()
asyncio.run(run())

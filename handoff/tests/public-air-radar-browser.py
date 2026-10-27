#!/usr/bin/env python3
"""One Chromium: actual public AA keys, native MiG17 gear and F104 cockpit.

CPU preparation is separate. Launch only on the root agent's GPU GO after final
public app + both records are frozen. Uses file://, never starts/connects to a
game server or joins an online world. Captures have independent bounded results.
"""
import argparse
import asyncio
import hashlib
import json
import time
import traceback
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[2]
DEFAULT=ROOT/'handoff/tests/out/public-air-radar-20261025'
ARGS=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required','--js-flags=--max-old-space-size=1800']

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()

async def run(out):
    manifest=json.loads((out/'page-provenance.json').read_text());page_path=Path(manifest['page'])
    result={'startedAtUnix':time.time(),'fixture':manifest,'checks':{},'phases':{},'captures':{},
      'scope':'One offline Chromium/SwiftShader; actual public native flight/visuals and AA input. No online authority, GPU performance or full fleet certification claim.'}
    logs=[];browser=None;page=None
    def save():
        (out/'browser-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
        (out/'browser-console.json').write_text(json.dumps(logs,ensure_ascii=False,indent=2)+'\n')
    def check(name,value,detail=None):
        result['checks'][name]={'pass':bool(value),'detail':detail};save()
        if not value:raise AssertionError(name)
    async def capture(name):
        started=time.monotonic()
        try:
            await asyncio.wait_for(page.screenshot(path=str(out/f'{name}.png'),timeout=8000),timeout=10)
            result['captures'][name]={'pass':True,'path':str(out/f'{name}.png'),'seconds':time.monotonic()-started}
        except Exception as e:
            result['captures'][name]={'pass':False,'error':str(e),'seconds':time.monotonic()-started}
        save()
    async def key(code,down=False,up=False):
        await page.evaluate('__publicQa.live()')
        if down:await page.keyboard.down(code)
        elif up:await page.keyboard.up(code)
        else:await page.keyboard.press(code)
        await page.evaluate('__publicQa.pause()')
    async def chord():
        await page.evaluate('__publicQa.live()');await page.keyboard.down('Space')
        braking=await page.evaluate('__publicQa.probe().brake')
        await page.keyboard.down('r');await page.keyboard.up('r');await page.keyboard.up('Space')
        await page.evaluate('__publicQa.pause()')
        return braking,await page.evaluate('__publicQa.probe()')
    async def board(id):
        await page.evaluate('__publicQa.prepareAir()')
        if await page.evaluate('!!__tf.G.air?.active'):
            # Actual offline abandon API disposes the prior scene; not an online lifecycle claim.
            await page.evaluate('__tfx.exitAircraft(true)')
        await key('F8')
        await page.wait_for_function("!document.getElementById('hangar').hidden",timeout=15000,polling=50)
        await page.locator(f'#hangar .hangar-card[data-air="{id}"]').click(timeout=15000)
        await page.wait_for_function(f'__tf.G.air?.active&&__tf.G.air.plane.type.id==="{id}"',timeout=20000,polling=50)
        await page.evaluate('__publicQa.pause()');return await page.evaluate('__publicQa.airPosition()')
    async with async_playwright() as pw:
        try:
            check('frozen_inputs_and_bounded_page',sha(page_path)==manifest['pageSha256'] and
                  sha(Path(manifest['publicApp']))==manifest['publicAppSha256'] and
                  all(sha(Path(v['path']))==v['sha256'] for v in manifest['nativeRecords'].values()) and
                  manifest['pageBytes']<45*1024*1024)
            browser=await pw.chromium.launch(headless=True,args=ARGS)
            page=await browser.new_page(viewport={'width':960,'height':640},locale='zh-CN')
            async def block_socket(socket):
                logs.append({'type':'qa-network-block','text':'Offline fixture blocked a WebSocket before connecting to any service'})
                await socket.close()
            await page.route_web_socket('**',block_socket)
            page.on('console',lambda m:logs.append({'type':m.type,'text':m.text[:3000]}))
            page.on('pageerror',lambda e:logs.append({'type':'pageerror','text':str(e)}))
            await page.add_init_script("localStorage.setItem('tankforge.lang','zh');localStorage.setItem('tankforge.quality.v1','low');localStorage.removeItem('tf.airKeys');")
            await page.goto(page_path.as_uri(),wait_until='load',timeout=120000)
            await page.wait_for_function('!!window.__tf&&!!window.__tfx&&!document.getElementById("boot-splash")',timeout=120000,polling=100)
            await page.evaluate((ROOT/'handoff/tests/public-air-radar-browser.js').read_text())
            boot=await page.evaluate('__publicQa.ready()');result['phases']['boot']=boot
            check('actual_public_core_and_models',boot['core']==212 and boot['stateLength']==80 and set(boot['nativeModels'])=={'f104g','mig17f'},boot)
            for vehicle in ['de_gepard','ru_pantsir_sm_sv']:
                start=await page.evaluate('(id)=>__publicQa.ground(id)',vehicle)
                check(vehicle+'_real_radar_initial_search',start['pad']['radar'] and start['pad']['mode']=='search' and start['pad']['contacts']>=1,start)
                await key('r');locked=await page.evaluate('__publicQa.probe()')
                await key('r');released=await page.evaluate('__publicQa.probe()')
                check(vehicle+'_plain_R_lock_release',locked['pad']['lock'] is not None and released['pad']['lock'] is None,{'locked':locked,'released':released})
                braking,enabled=await chord();tracked=await page.evaluate('__publicQa.scan()')
                check(vehicle+'_actual_space_R_and_sensor_track',braking and enabled['pad']['mode']=='acm' and tracked['pad']['radarTrack'] and '10 Hz' in tracked['pad']['info'],{'spaceBrake':braking,'enabled':enabled,'tracked':tracked})
                await capture(vehicle+'-acm')
                _,restored=await chord();search=await page.evaluate('__publicQa.scan()')
                check(vehicle+'_returns_to_search',restored['pad']['mode']=='search' and search['pad']['mode']=='search' and search['pad']['lock'] is None,search)
                result['phases'][vehicle]={'before':start,'focused':tracked,'restored':search};save()
            initial=await board('mig17f');check('mig17_actual_native_model_and_WASM',initial['plane']['imported'] and initial['plane']['core']==212 and initial['plane']['nativeMovers']==14 and initial['plane']['uploaded']>0,initial)
            await page.evaluate('__publicQa.gearCamera()')
            await key('g');down=await page.evaluate('__publicQa.advanceGear(1)');await capture('mig17-gear-down')
            await key('g');half=await page.evaluate('__publicQa.advanceGear(0,true)');await capture('mig17-gear-half')
            up=await page.evaluate('__publicQa.advanceGear(0)');await capture('mig17-gear-up')
            await key('g');again=await page.evaluate('__publicQa.advanceGear(1)')
            samples=down['samples']+half['samples']+up['samples']+again['samples']
            finite=all(len(p['controls'])>=7 and all(all(isinstance(x,(float,int)) and abs(x)<1e10 for x in c['local']+c['world']) for c in p['controls']) for p in samples)
            travelling=any(.05<p['gear']<.95 for p in half['samples']+up['samples'])
            check('mig17_native_full_gear_roundtrip_and_original_movers',down['end']['plane']['state'][33]>.995 and up['end']['plane']['state'][33]<.005 and again['end']['plane']['state'][33]>.995 and travelling and finite,{'down':down,'half':half,'up':up,'downAgain':again})
            result['phases']['mig17']={'initial':initial,'gear':{'down':down,'half':half,'up':up,'downAgain':again}};save()
            initial=await board('f104g');await key('v');centre=await page.evaluate('__publicQa.cockpit()')
            check('f104_actual_cockpit_eye_combiner_and_DOM_gate',centre['probe']['plane']['imported'] and centre['probe']['plane']['camera']==1 and centre['probe']['plane']['aimHidden'] and centre['probe']['plane']['noseHidden'] and centre['probe']['plane']['sightGlass']>=3 and abs(centre['probe']['plane']['eye'][2]-5.948)<1e-5 and all(abs(x)<1e10 for x in centre['actualEyeLocal']),centre)
            await capture('f104-cockpit-centre')
            side=await page.evaluate('__publicQa.shiftEye([.025,0,0])');await capture('f104-cockpit-side-eye')
            outside=await page.evaluate('__publicQa.shiftEye([.5,0,0])');await capture('f104-cockpit-outside-eye-box')
            result['phases']['f104']={'initial':initial,'centre':centre,'side':side,'outside':outside,
              'scope':'Real overlay pixel/projection observations + screenshots; visual interpretation is reviewed separately. No invented pixel threshold or full optical certification.'};save()
            check('runtime_has_no_page_errors',not any(x['type']=='pageerror' for x in logs),logs)
        except Exception as e:
            result['failure']={'type':type(e).__name__,'message':str(e),'trace':traceback.format_exc()}
            if page:
                try:result['failureState']=await asyncio.wait_for(page.evaluate('window.__publicQa?.probe()'),timeout=5)
                except Exception as state_error:result['failureStateError']=str(state_error)
        finally:
            if page:
                try:result['cleanup']=await asyncio.wait_for(page.evaluate('window.__publicQa?.cleanup()'),timeout=8)
                except Exception as e:result['cleanupError']=str(e)
            if browser:
                try:await asyncio.wait_for(browser.close(),timeout=15);result['browserClosed']=True
                except Exception as e:result['browserCloseError']=str(e)
            result['functionalPass']='failure' not in result and bool(result['checks']) and all(v['pass'] for v in result['checks'].values())
            result['capturePass']=all(v['pass'] for v in result['captures'].values()) if result['captures'] else None
            result['finishedAtUnix']=time.time();save()
    print(json.dumps({'functionalPass':result['functionalPass'],'checks':len(result['checks']),'capturePass':result['capturePass'],'captures':len(result['captures']),'result':str(out/'browser-result.json')},ensure_ascii=False))
    return 0 if result['functionalPass'] else 1

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--out',type=Path,default=DEFAULT)
    raise SystemExit(asyncio.run(run(parser.parse_args().out)))

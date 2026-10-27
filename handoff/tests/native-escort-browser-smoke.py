#!/usr/bin/env python3
"""Actual Edge/WebGL boot plus normal shared-lobby Taiwan observer smoke.

No fabricated snapshots, poses, damage, assets, or replacement rendering paths.
The only page writes are normal preference setup; cleanup uses the accepted
shared leave API if the ordinary lobby button is not available.
"""
import argparse
import asyncio
import hashlib
import json
import time
import traceback
import urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

PROBE = r"""(()=>{
 const t=window.__tf,g=t?.G,r=t?.renderer,gl=r?.gl,f=g?.frontline;
 const linked=p=>p?.p?gl.getProgramParameter(p.p,gl.LINK_STATUS):null;
 const uniforms=p=>p?.u?Object.keys(p.u):[];
 return {ready:!!g,mode:g?.mode,frameError:g?.frameError||null,webgl:!!gl,
  webglVersion:gl?.getParameter(gl.VERSION),renderer:gl?.getParameter(gl.RENDERER),lost:gl?.isContextLost(),drawCalls:r?.drawCalls,
  shaders:{lit:linked(r?.lit),depth:linked(r?.depth),litUniforms:uniforms(r?.lit),depthUniforms:uniforms(r?.depth)},
  frontline:f?{active:f.active,tick:f.lastTick,error:f.error||null,map:f.map?.id,room:f.room?.id,
   frameStats:f.renderStats?.last,terrainWorker:f.terrainWorker?.stats||null,terrainWorkerFailed:f.terrainWorkerFailed,
   terrainChildren:f.terrain?.children?.map(n=>({name:n.name,vertices:n.mesh?.count||0})),ground:f.units?.length,
   facilityReady:f.facilityPresentation?.ready,vessels:f.vessels?.length,naval:f.navalPresentation?.stats,airportLights:f.airportPresentation?.lightCount,mapScale:f.mapScale,mapCentre:f.mapCentre,focus:f.focus,scenario:f.scenario}:null};
})()"""

async def run(args):
    args.out.mkdir(parents=True,exist_ok=True)
    result={'url':args.url,'startedUnix':time.time(),'checks':{},'phases':{},'captures':{},'cleanup':[],
      'scope':'Full served page in actual headless Microsoft Edge with WebGL2/SwiftShader; normal lobby UI creates/starts a Taiwan observer room. No pose/damage/resource injection or performance claim.'}
    logs=[]
    page=browser=p=None
    def save(): (args.out/'receipt.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    def check(name,value,detail=None):
        result['checks'][name]={'passed':bool(value),'detail':detail};save()
        if not value: raise AssertionError(name)
    async def capture(name):
        path=args.out/(name+'.png')
        await page.screenshot(path=str(path),timeout=45000)
        result['captures'][name]={'path':str(path.resolve()),'bytes':path.stat().st_size};save()
    try:
        digest=hashlib.sha256();size=0
        with urllib.request.urlopen(args.url,timeout=60) as response:
            for chunk in iter(lambda:response.read(1024*1024),b''): digest.update(chunk);size+=len(chunk)
        result['servedPage']={'sha256':digest.hexdigest(),'bytes':size};save()
        if args.sha256: check('served_page_sha256',digest.hexdigest()==args.sha256,result['servedPage'])
        p=await async_playwright().start()
        browser=await p.chromium.launch(channel='msedge',headless=True,args=[
          '--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist',
          '--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling',
          '--disable-renderer-backgrounding','--js-flags=--max-old-space-size=1800'])
        result['browserVersion']=browser.version
        page=await browser.new_page(viewport={'width':1100,'height':720},locale='zh-CN')
        page.set_default_timeout(30000)
        await page.add_init_script("localStorage.setItem('tankforge.lang','zh');localStorage.setItem('tankforge.quality.v1','low')")
        page.on('pageerror',lambda e:logs.append({'kind':'pageerror','text':str(e)}))
        page.on('console',lambda m:logs.append({'kind':m.type,'text':m.text[:2000]}) if m.type in ['error','warning'] and len(logs)<200 else None)
        print('PHASE full-page boot',flush=True)
        await page.goto(args.url,wait_until='load',timeout=240000)
        await page.wait_for_function("window.__tf?.G&&window.__tf?.renderer?.gl&&!document.getElementById('boot-splash')",timeout=240000,polling=1000)
        await asyncio.sleep(3)
        boot=await page.evaluate(PROBE);result['phases']['boot']=boot
        check('actual_full_page_webgl_boot',boot['webgl'] and not boot['lost'] and not boot['frameError'],boot)
        check('precision_shader_programs_linked',boot['shaders']['lit'] and boot['shaders']['depth'] and 'uModelViewProj' in boot['shaders']['litUniforms'] and 'uModelLightVP' in boot['shaders']['depthUniforms'],boot['shaders'])
        await capture('garage-full-page')
        print('PHASE normal lobby and Taiwan observer',flush=True)
        await page.locator('#net-btn').click()
        await page.wait_for_selector('#lb-gameplay',timeout=60000)
        await page.wait_for_function("document.querySelector('#lb-gameplay option[value=air_frontline]')",timeout=60000)
        await page.select_option('#lb-gameplay','air_frontline')
        await page.select_option('#lb-map','taiwan-escort')
        await page.select_option('#lb-era','2022')
        await page.fill('#lb-room-name','Edge Taiwan browser smoke '+str(int(time.time())))
        await page.locator('#lobby [data-shared-observe-create]').click()
        await page.wait_for_function("__tf.G.frontline.room?.map==='taiwan-escort'",timeout=45000)
        await page.locator('#lobby [data-act=start]').click()
        await page.wait_for_function("__tf.G.frontline.active&&__tf.G.frontline.map?.id==='taiwan-escort'",timeout=120000,polling=500)
        if await page.locator('#lobby').is_visible(): await page.locator('#lobby [data-act=close]').click()
        await page.wait_for_function("__tf.G.frontline.terrainWorker?.stats.swaps>=1",timeout=180000,polling=500)
        await asyncio.sleep(3)
        terrain=await page.evaluate(PROBE);result['phases']['taiwanObserver']=terrain
        worker=terrain['frontline']['terrainWorker']
        check('real_taiwan_worker_atomic_swap',worker and worker['swaps']>=1 and worker['errors']==0 and not terrain['frontline']['terrainWorkerFailed'],worker)
        check('accepted_five_native_ships_rendered',terrain['frontline']['vessels']==5 and terrain['frontline']['naval']['live']==5,terrain['frontline']['naval'])
        check('registered_airport_lights_visible',terrain['frontline']['airportLights']>=120,terrain['frontline']['airportLights'])
        check('local_ten_km_minimap',await page.evaluate('Math.abs(__tf.G.frontline.mapScale-20000/Math.min(document.getElementById("minimap").width,document.getElementById("minimap").height))<1e-6'),terrain['frontline']['mapScale'])
        check('actual_taiwan_frame_without_error',not terrain['frameError'] and not terrain['frontline']['error'] and terrain['drawCalls']>0,terrain)
        await capture('taiwan-observer-worker')
        # Use the existing minimap pointer route to inspect a registered airport.
        q=await page.evaluate('''(()=>{const f=__tf.G.frontline,c=document.getElementById('minimap'),r=c.getBoundingClientRect(),a=f.map.airfields.find(a=>a.enabled&&a.team===0);return {x:r.x+((a.pos[0]-f.mapCentre[0])/f.mapScale+c.width/2)/c.width*r.width,y:r.y+((a.pos[2]-f.mapCentre[1])/f.mapScale+c.height/2)/c.height*r.height}})()''')
        await page.mouse.click(q['x'],q['y'])
        await page.mouse.move(500,350)
        await page.mouse.wheel(0,1800)
        await asyncio.sleep(3)
        await capture('fujian-runway-lights')
        print('PHASE explicit accepted leave',flush=True)
        await page.evaluate('__tf.G.frontline.shared.leave()')
        await page.wait_for_function('!__tf.G.frontline.room',timeout=30000)
        result['cleanup'].append({'explicitSharedLeaveAcknowledged':True});save()
        check('no_uncaught_page_errors',not [m for m in logs if m['kind']=='pageerror'],logs)
        result['passed']=True
        await browser.close();browser=None
    except BaseException as error:
        result['passed']=False;result['failure']={'message':str(error),'trace':traceback.format_exc()}
        if page:
            try: result['phases']['failure']=await page.evaluate(PROBE)
            except BaseException as probe_error: result['probeError']=str(probe_error)
            try: await capture('failure')
            except BaseException as capture_error: result['captureError']=str(capture_error)
    finally:
        if page and browser:
            try:
                if await page.evaluate('!!window.__tf?.G?.frontline?.room'):
                    await page.evaluate('__tf.G.frontline.shared.leave()')
                    await page.wait_for_function('!__tf.G.frontline.room',timeout=30000)
                    result['cleanup'].append({'finallyExplicitLeaveAcknowledged':True})
            except BaseException as error: result['cleanup'].append({'error':str(error)})
        if browser:
            try: await browser.close()
            except BaseException: pass
        if p: await p.stop()
        result['logs']=logs;result['finishedUnix']=time.time();save()
    print(json.dumps({'passed':result.get('passed'),'failure':result.get('failure',{}).get('message'),'checks':result['checks'],'out':str(args.out)},ensure_ascii=False),flush=True)
    return result.get('passed',False)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('url');parser.add_argument('--out',type=Path,required=True);parser.add_argument('--sha256');args=parser.parse_args()
    raise SystemExit(0 if asyncio.run(run(args)) else 1)

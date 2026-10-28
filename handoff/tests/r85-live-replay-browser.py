#!/usr/bin/env python3
"""Run the separate instrumented final-page V3 GPU regression in real WebGL2.
Synthetic recorded trajectories test presentation, not native damage or FPS.
"""
import argparse,asyncio,json,time,traceback,hashlib
from pathlib import Path
from playwright.async_api import async_playwright

async def run(a):
    a.out.mkdir(parents=True,exist_ok=False)
    h=hashlib.sha256()
    with a.production.open('rb')as f:
        for b in iter(lambda:f.read(1048576),b''):h.update(b)
    result={'started':time.time(),'url':a.url,'productionSha256':h.hexdigest(),'passed':False,'scope':'supplied V3 GPU renderer, actual game snapshots, synthetic recorded trajectories; not a damage/FPS test'}
    errors=[]
    async with async_playwright()as p:
        browser=await p.chromium.launch(channel='msedge',headless=True,args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required'])
        try:
            page=await browser.new_page(viewport={'width':1280,'height':800})
            page.on('pageerror',lambda e:errors.append(str(e)))
            await page.add_init_script("localStorage.setItem('tankforge.quality.v1','low')")
            await page.goto(a.url,wait_until='load',timeout=240000)
            await page.wait_for_function("(()=>{try{const s=JSON.parse(document.getElementById('r8-replay-result')?.textContent||'{}');return s.passed||s.errors?.length>0;}catch{return false;}})()",timeout=240000,polling=500)
            result['gate']=await page.evaluate("JSON.parse(document.getElementById('r8-replay-result').textContent)")
            await page.screenshot(path=str(a.out/'final-v3-replay.png'))
            if not result['gate']['passed']:raise AssertionError('V3 live renderer target switching failed')
            for key in ['unfinishedNextTargetImmediate','oldTargetReleasedInSameCall','noDeferredNewTarget','actualV3ReplacementPublished','finishedDifferentTargetImmediate','finishedTargetReplacementPublished','all48Bodies','all48Paths','all48Flashes']:
                if not result['gate']['checks'].get(key):raise AssertionError('Missing actual replay check: '+key)
            if errors:raise AssertionError('uncaught page error')
            result['passed']=True
        except Exception as e:
            result['failure']={'message':str(e),'trace':traceback.format_exc()}
            try:await page.screenshot(path=str(a.out/'failure.png'))
            except Exception:pass
        finally:await browser.close()
    result['errors']=errors;result['finished']=time.time()
    (a.out/'receipt.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps(result,ensure_ascii=False));return result['passed']

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('url');p.add_argument('--production',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();raise SystemExit(0 if asyncio.run(run(a))else 1)

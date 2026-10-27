#!/usr/bin/env python3
"""One final F104 centre screenshot; no AA/gear rerun and no second GPU process."""
import asyncio
import hashlib
import json
import time
import traceback
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'handoff/tests/out/public-air-radar-20261025'
DEST=OUT/'centre-only'
ARGS=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required','--js-flags=--max-old-space-size=1800']
RAF=r'''(()=>{
 const request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window),pending=new Set();let stopped=false;
 window.requestAnimationFrame=callback=>{const id=request(time=>{pending.delete(id);if(!stopped)callback(time);});pending.add(id);return id;};
 window.cancelAnimationFrame=id=>{pending.delete(id);cancel(id);};
 window.__qaRAF={stop(){stopped=true;const count=pending.size;for(const id of pending)cancel(id);pending.clear();return {stopped:true,cancelledCallbacks:count,pendingCallbacks:pending.size};}};
})()'''
def sha(path):
    digest=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):digest.update(b)
    return digest.hexdigest()

async def main():
    DEST.mkdir(parents=True,exist_ok=True);manifest=json.loads((OUT/'page-provenance.json').read_text());result={'startedAtUnix':time.time(),'purpose':'One independently recorded F104 centre capture after original8s timeout; no original result overwritten','fixture':manifest,'capturePass':None};logs=[];browser=None;page=None
    def save():(DEST/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');(DEST/'console.json').write_text(json.dumps(logs,ensure_ascii=False,indent=2)+'\n')
    async def key(code):
        await page.evaluate('__publicQa.live()');await page.keyboard.press(code);await page.evaluate('__publicQa.pause()')
    async with async_playwright() as pw:
        try:
            assert sha(Path(manifest['page']))==manifest['pageSha256']
            assert sha(Path(manifest['publicApp']))==manifest['publicAppSha256']
            browser=await pw.chromium.launch(headless=True,args=ARGS);page=await browser.new_page(viewport={'width':960,'height':640},locale='zh-CN')
            page.on('console',lambda m:logs.append({'type':m.type,'text':m.text[:3000]}));page.on('pageerror',lambda e:logs.append({'type':'pageerror','text':str(e)}))
            async def block_socket(socket):await socket.close()
            await page.route_web_socket('**',block_socket)
            await page.add_init_script("localStorage.setItem('tankforge.lang','zh');localStorage.setItem('tankforge.quality.v1','low');localStorage.removeItem('tf.airKeys');")
            await page.add_init_script(RAF)
            await page.goto(Path(manifest['page']).as_uri(),wait_until='load',timeout=120000)
            await page.wait_for_function('!!window.__tf&&!!window.__tfx&&!document.getElementById("boot-splash")',timeout=120000,polling=100)
            await page.evaluate((ROOT/'handoff/tests/public-air-radar-browser.js').read_text());result['boot']=await page.evaluate('__publicQa.ready()');save()
            await page.evaluate('(()=>{__tf.G.padBots=false;__tf.startBattle();__tf.advance(.1,[],false);__publicQa.prepareAir();})()')
            await key('F8');await page.locator('#hangar .hangar-card[data-air="f104g"]').click(timeout=15000)
            await page.wait_for_function('__tf.G.air?.active&&__tf.G.air.plane.type.id==="f104g"',timeout=20000,polling=50)
            await page.evaluate('__publicQa.pause();__publicQa.airPosition()');await key('v');result['centre']=await page.evaluate('__publicQa.cockpit()');save()
            p=result['centre']['probe']['plane'];assert p['camera']==1 and p['aimHidden'] and p['noseHidden'] and p['core']==212 and p['uploaded']>0
            assert max(abs(x-y) for x,y in zip(p['eye'],[0,.520406,5.948]))<1e-5
            # Stop subsequent RAF work only after the original renderer has drawn
            # its true native pose/camera. gl.finish drains actual submitted GPU
            # commands; no mesh, camera, optical layer or physics is substituted.
            result['raf']=await page.evaluate('__qaRAF.stop()')
            result['gpuDrain']=await asyncio.wait_for(page.evaluate('(()=>{const gl=__tf.renderer.gl,t=performance.now();gl.finish();return {finishMs:performance.now()-t,error:gl.getError(),contextLost:gl.isContextLost(),camera:__publicQa.lastCamera,pose:Array.from(__tf.G.air.plane.cur)};})()'),timeout=45)
            assert not result['gpuDrain']['contextLost'] and result['gpuDrain']['error']==0
            result['centreReady']=True;save();started=time.monotonic()
            try:
                await asyncio.wait_for(page.screenshot(path=str(DEST/'f104-cockpit-centre.png'),timeout=45000),timeout=48)
                result['capturePass']=True;result['captureSha256']=sha(DEST/'f104-cockpit-centre.png')
            except Exception as e:result['capturePass']=False;result['captureError']=str(e)
            result['captureSeconds']=time.monotonic()-started
        except Exception as e:result['failure']={'type':type(e).__name__,'message':str(e),'trace':traceback.format_exc()}
        finally:
            if page:
                try:result['cleanup']=await asyncio.wait_for(page.evaluate('window.__publicQa?.cleanup()'),timeout=8)
                except Exception as e:result['cleanupError']=str(e)
            if browser:
                try:await asyncio.wait_for(browser.close(),timeout=15);result['browserClosed']=True
                except Exception as e:result['browserCloseError']=str(e)
            result['finishedAtUnix']=time.time();save()
    print(json.dumps({'centreReady':result.get('centreReady',False),'capturePass':result['capturePass'],'browserClosed':result.get('browserClosed',False),'result':str(DEST/'result.json')}))
    return 0 if result['capturePass'] else 1
if __name__=='__main__':raise SystemExit(asyncio.run(main()))

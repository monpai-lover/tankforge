"""Final-page UI regression: accepted spectator exit, solo input, armor hover.

Uses real Edge/WebGL and native room admission. No snapshots, poses, geometry,
damage, replay records, simulation time or armor-query answers are fabricated.
"""
import argparse
import asyncio
import hashlib
import json
import re
import time
import traceback
import urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

PROBE = """() => {const t=window.__tf,g=t?.G,f=g?.frontline;return {
 mode:g?.mode,id:g?.id,frameError:g?.frameError||null,frontlineError:f?.error||null,
 frontend:{active:f?.active,room:f?.room?.id,observer:f?.room?.members?.find(m=>m.player===t.net.id)?.observer,spectator:f?.spectator?.kind||null,tick:f?.lastTick},
 view:g?.view,free:g?.free,nativeAir:!!g?.air?.nativeAuthority,air:!!g?.air?.active,
 keys:g?.keys?[...g.keys]:[],position:g?.s?{x:g.s.x,z:g.s.z,u:g.s.u}:null,
 bodyMode:document.body.dataset.mode,frontlineWatch:document.body.dataset.frontlineWatch,
 protect:g?.protect,protectionText:g?.protText||'',panelText:document.getElementById('prot-info')?.textContent,
 webglLost:t?.renderer?.gl?.isContextLost(),drawCalls:t?.renderer?.drawCalls};}"""

# Read actual visible uploaded triangles solely to find a screen point for the
# ordinary mouse-hover route. The production cursor/Protection owns the result.
HOVER_POINTS = """() => {const g=__tf.G,c=g.lastCam,cv=__tf.renderer.canvas,r=cv.getBoundingClientRect(),M=c.viewProj,out=[];
 const project=p=>{const q=[0,1,2,3].map(i=>M[i]*p[0]+M[4+i]*p[1]+M[8+i]*p[2]+M[12+i]);return q[3]>0?[q[0]/q[3],q[1]/q[3]]:null;};
 for(const node of g.model.shellNodes){const d=node.mesh?._src?.data,m=node.world;if(!d||node.mesh.instanced||!/(shell|armor|hull|turret)/i.test(node.name))continue;
  const triangles=d.length/39,step=Math.max(1,Math.floor(triangles/28));
  for(let i=0;i<triangles;i+=step){const p=[0,1,2].map(k=>(d[i*39+k]+d[i*39+13+k]+d[i*39+26+k])/3),w=[0,1,2].map(k=>m[k]*p[0]+m[4+k]*p[1]+m[8+k]*p[2]+m[12+k]),q=project(w);if(!q||Math.abs(q[0])>.9||Math.abs(q[1])>.85)continue;
   const x=r.x+(q[0]*.5+.5)*r.width,y=r.y+(.5-q[1]*.5)*r.height;if(document.elementFromPoint(x,y)!==cv)continue;
   out.push({x,y,node:node.name,triangle:i,distance:Math.hypot(...w.map((v,k)=>v-c.pos[k]))});
  }
 }
 return out.sort((a,b)=>a.distance-b.distance).slice(0,120);
}"""

async def run(args):
    args.out.mkdir(parents=True,exist_ok=True)
    result={'url':args.url,'startedUnix':time.time(),'checks':{},'phases':{},'captures':{},'cleanup':[],
      'scope':'Final served page, actual Edge/WebGL, accepted native observer admission/leave, ordinary solo W input and ordinary armor-analysis cursor. Read-only uploaded-triangle projection chooses hover screen coordinates.'}
    logs=[];page=browser=None
    def save(): (args.out/'receipt.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    def check(name,value,detail=None):
        result['checks'][name]={'passed':bool(value),'detail':detail};save()
        if not value: raise AssertionError(name)
    async def capture(name):
        target=args.out/(name+'.png');await page.screenshot(path=str(target),timeout=45000)
        result['captures'][name]={'path':str(target.resolve()),'bytes':target.stat().st_size};save()
    digest=hashlib.sha256();size=0
    with urllib.request.urlopen(args.url,timeout=60) as response:
        for chunk in iter(lambda:response.read(1024*1024),b''):digest.update(chunk);size+=len(chunk)
    result['servedPage']={'sha256':digest.hexdigest(),'bytes':size};save()
    if args.sha256: check('frozen_final_page_sha256',digest.hexdigest()==args.sha256,result['servedPage'])
    async with async_playwright() as p:
        try:
            browser=await p.chromium.launch(channel='msedge',headless=True,args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding','--js-flags=--max-old-space-size=1800'])
            result['browserVersion']=browser.version
            page=await browser.new_page(viewport={'width':1100,'height':720},locale='zh-CN');page.set_default_timeout(30000)
            await page.add_init_script("localStorage.setItem('tankforge.lang','zh');localStorage.setItem('tankforge.quality.v1','low');localStorage.setItem('tankforge.map.v1','range');localStorage.setItem('tankforge.vehicle.v1','de_pz3_j')")
            page.on('pageerror',lambda e:logs.append({'kind':'pageerror','text':str(e)}))
            page.on('console',lambda m:logs.append({'kind':m.type,'text':m.text[:1600]}) if m.type in ['error','warning'] and len(logs)<160 else None)
            print('PHASE final page boot',flush=True)
            await page.goto(args.url,wait_until='load',timeout=240000)
            await page.wait_for_function("window.__tf?.G?.frontline&&!document.getElementById('boot-splash')",timeout=240000,polling=500)
            # The public garage still renders queued tank/aircraft card images
            # after splash removal. Let their real owner finish before clicks.
            await page.wait_for_function('!__tf.G.thumbs.length&&!__tf.G.airThumbQ?.length&&!__tf.G.thumbShot',timeout=180000,polling=250)
            result['phases']['boot']=await page.evaluate(PROBE);save()
            print('PHASE normal observer create and start',flush=True)
            await page.locator('#net-btn').click();await page.wait_for_selector('#lb-gameplay',timeout=60000)
            await page.select_option('#lb-gameplay','air_frontline');await page.select_option('#lb-map',args.map);await page.select_option('#lb-era','2022')
            await page.fill('#lb-room-name','R85 state armor '+str(int(time.time())))
            await page.locator('#lobby [data-shared-observe-create]').click()
            await page.wait_for_function('__tf.G.frontline.room?.map==='+json.dumps(args.map),timeout=60000)
            await page.locator('#lobby [data-act=start]').click()
            await page.wait_for_function("__tf.G.frontline.active&&__tf.G.mode==='battle'&&__tf.G.frontline.lastTick>0",timeout=180000,polling=500)
            if await page.locator('#lobby').is_visible():await page.locator('#lobby [data-act=close]').click()
            observed=await page.evaluate(PROBE);result['phases']['observer']=observed
            check('accepted_observer_owns_multiplayer_frame',observed['frontend']['active'] and observed['frontend']['observer'] and observed['frontlineWatch']=='1',observed)
            await capture('accepted-observer')
            print('PHASE normal lobby accepted leave',flush=True)
            # The garage navigation button is hidden during battle; use the
            # established lobby UI owner, then its ordinary visible Leave.
            if await page.locator('#net-btn').is_visible():await page.locator('#net-btn').click()
            else:await page.evaluate('__tf.lobby.show(true)')
            leave=page.locator('#lobby [data-act=leave]')
            if await leave.is_visible():
                await leave.click();result['leaveRoute']='ordinary_lobby_button'
            else:
                # Observer mode can suppress garage/lobby DOM. This public
                # production API sends leave intent; the real server ack owns
                # all subsequent state cleanup and is explicitly awaited.
                await page.evaluate('__tf.G.frontline.shared.leave()');result['leaveRoute']='existing_shared_leave_api'
            await page.wait_for_function("!__tf.G.frontline.room&&!__tf.G.frontline.active&&__tf.G.mode==='garage'",timeout=45000)
            if await page.locator('#lobby').is_visible():await page.locator('#lobby [data-act=close]').click()
            left=await page.evaluate(PROBE);result['phases']['acceptedLeave']=left
            check('accepted_leave_restores_local_camera_and_input',left['view']=='third' and not left['free'] and not left['nativeAir'] and not left['keys'] and left['frontlineWatch']=='0',left)
            print('PHASE normal singleplayer battle and W control',flush=True)
            ground=page.locator('#g-mode [data-g=ground]')
            if await ground.count() and await ground.is_visible():await ground.click()
            await page.locator('#veh-de_pz3_j').click();await page.locator('#battle-btn').click()
            await page.wait_for_function("__tf.G.mode==='battle'&&!__tf.G.frontline.active&&!__tf.G.online&&!__tf.G.air?.nativeAuthority",timeout=60000)
            before=await page.evaluate(PROBE);await page.keyboard.down('KeyW')
            try:await page.wait_for_function('Math.abs(__tf.G.s.u)>.1',timeout=20000,polling=100)
            finally:await page.keyboard.up('KeyW')
            solo=await page.evaluate(PROBE);result['phases']['soloBeforeInput']=before;result['phases']['soloAfterInput']=solo
            check('solo_control_accelerates_original_player',abs(solo['position']['u'])>.1 and solo['view']=='third' and not solo['free'] and not solo['frontend']['active'],solo)
            await capture('solo-player-control')
            print('PHASE normal garage armor-analysis hover',flush=True)
            await page.locator('#to-garage').click();await page.wait_for_function("__tf.G.mode==='garage'",timeout=30000)
            await page.wait_for_function('!__tf.G.thumbs.length&&!__tf.G.airThumbQ?.length&&!__tf.G.thumbShot',timeout=180000,polling=250)
            await page.locator('#prot-btn').click();await page.wait_for_function('__tf.G.protect&&__tf.G.lastCam',timeout=30000)
            await page.select_option('#prot-shell','apfsds_125_3bm22')
            await asyncio.sleep(1.5)  # Settle the original garage camera easing.
            points=await page.evaluate(HOVER_POINTS);check('actual_uploaded_armor_has_visible_hover_points',len(points)>0,{'count':len(points)})
            samples=[];found=None
            for point in points:
                await page.mouse.move(point['x'],point['y']);await asyncio.sleep(.22)
                answer=await page.evaluate("() => ({text:__tf.G.protText||'',panel:document.getElementById('prot-info').textContent,cursor:document.querySelector('.armor-inspection-cursor')?.innerText||''})")
                samples.append({'point':point,**answer})
                if re.search(r'\s[1-9]\d*(?:\.\d+)?\s*mm',answer['text']) and not re.search('未知|計算中|计算中',answer['text']):
                    await asyncio.sleep(.25)
                    stable=await page.evaluate("() => ({text:__tf.G.protText||'',panel:document.getElementById('prot-info').textContent,cursor:document.querySelector('.armor-inspection-cursor')?.innerText||''})")
                    if re.search(r'\s[1-9]\d*(?:\.\d+)?\s*mm',stable['text']) and not re.search('未知|計算中|计算中',stable['text']):
                        found={'point':point,**stable};samples.append(found);break
            result['hoverSamples']=samples
            check('normal_hover_reports_real_authored_thickness',found is not None,found or samples[-4:])
            # Different ordinary pointer rays force independent preview queries,
            # rather than passing by re-reading one unchanged cursor answer.
            repeated=[]
            for n in range(10):
                await page.mouse.move(found['point']['x']+(.5 if n%2 else -.5),found['point']['y'])
                await asyncio.sleep(.25)
                repeated.append(await page.evaluate("() => ({text:__tf.G.protText||'',ndc:__tf.G.protMouse?.ndc,panel:document.getElementById('prot-info').textContent})"))
            result['repeatHoverSamples']=repeated
            check('ten_independent_hover_rays_keep_authored_thickness',all(re.search(r'\s[1-9]\d*(?:\.\d+)?\s*mm',r['text']) and not re.search('未知|計算中|计算中',r['text']) for r in repeated) and len({tuple(r['ndc']) for r in repeated})>=2,repeated)
            result['phases']['protection']=await page.evaluate(PROBE)
            await capture('actual-armor-thickness-hover')
            check('final_renderer_and_state_have_no_runtime_error',not result['phases']['protection']['frameError'] and not result['phases']['protection']['frontlineError'] and not result['phases']['protection']['webglLost'],result['phases']['protection'])
            check('no_uncaught_page_errors',not [m for m in logs if m['kind']=='pageerror'],logs)
            result['passed']=True
        except BaseException as error:
            result['passed']=False;result['failure']={'message':str(error),'trace':traceback.format_exc()}
            if page:
                try:result['phases']['failure']=await page.evaluate(PROBE)
                except BaseException:pass
                try:await capture('failure')
                except BaseException:pass
        finally:
            if page:
                try:
                    if await page.evaluate('!!window.__tf?.G?.frontline?.room'):
                        await page.evaluate('__tf.G.frontline.shared.leave()');await page.wait_for_function('!__tf.G.frontline.room',timeout=30000)
                        result['cleanup'].append({'acceptedSharedLeave':True})
                except BaseException as error:result['cleanup'].append({'error':str(error)})
            if browser:await browser.close()
            result['logs']=logs;result['finishedUnix']=time.time();save()
    print(json.dumps({'passed':result.get('passed'),'failure':result.get('failure',{}).get('message'),'out':str(args.out)},ensure_ascii=False),flush=True)
    return result.get('passed',False)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('url');parser.add_argument('--out',type=Path,required=True);parser.add_argument('--sha256');parser.add_argument('--map',default='korea')
    raise SystemExit(0 if asyncio.run(run(parser.parse_args())) else 1)

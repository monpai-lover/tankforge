"""Normal native deployment and real pilot HUD checks, with observational canvas logging.

No snapshot, aircraft pose, native state or weapon inventory is fabricated.
Canvas wrappers forward all drawing unchanged and inspect the last cleared frame.
"""
import argparse, asyncio, hashlib, json, time, traceback, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

OBSERVE = r"""() => {
  for(const cv of document.querySelectorAll('canvas')){
    if(!cv.classList.contains('air-ov') && cv!==__tf.hud.map)continue;
    const g=cv.getContext('2d');if(!g||g.__r86Observed)continue;
    g.__r86Observed=true;cv.__r86Texts=[];cv.__r86Rects=[];
    const clear=g.clearRect,fill=g.fillText,rect=g.fillRect;
    g.clearRect=function(...args){cv.__r86Texts=[];cv.__r86Rects=[];return clear.apply(this,args);};
    g.fillText=function(text,x,y,...rest){cv.__r86Texts.push({text:String(text),x,y});return fill.call(this,text,x,y,...rest);};
    g.fillRect=function(x,y,w,h){
      const color=String(this.fillStyle).replaceAll(' ','');
      if(['rgba(16,18,13,0.82)','rgba(8,17,23,0.88)'].includes(color))cv.__r86Rects.push({x,y,w,h,color});
      return rect.call(this,x,y,w,h);
    };
  }
}"""
PROBE = r"""() => {
  const t=__tf,g=t.G,f=g.frontline,a=g.air,cv=document.querySelector('#air-hud .air-ov'),banner=document.getElementById('frontline-airwar-mission');
  const visible=n=>!!n&&!n.hidden&&getComputedStyle(n).display!=='none'&&getComputedStyle(n).visibility!=='hidden'&&n.getBoundingClientRect().width>0;
  return {mode:g.mode,airActive:!!a?.active,native:!!a?.nativeAuthority,camera:a?.plane?.state?.camera,view:a?.ctl?.view,
    control:f.control,own:f.aircrafts.find(u=>u.controller===t.net.id)?.unit,vessels:f.vessels.map(u=>({id:u.id,unit:u.unit,pos:u.pos,alive:u.alive,team:u.team})),
    airCanvasVisible:visible(cv),airCanvas:cv?{width:cv.width,height:cv.height,rect:cv.getBoundingClientRect().toJSON(),texts:cv.__r86Texts||[],labelRects:cv.__r86Rects||[]}:null,
    banner:{visible:visible(banner),hidden:banner?.hidden,text:banner?.textContent},
    minimap:{width:t.hud.map?.width,height:t.hud.map?.height,rect:t.hud.map?.getBoundingClientRect().toJSON(),texts:t.hud.map?.__r86Texts||[]},
    hiddenGroundOverlay:!visible(document.getElementById('overlay')),frameError:g.frameError||f.error||null,webglLost:t.renderer.gl.isContextLost()};
}"""

async def run(args):
    args.out.mkdir(parents=True,exist_ok=False)
    r={'schema':'TankForgeR86PilotedHudBrowserV1','url':args.url,'started':time.time(),'checks':{},'views':{},'errors':[],'cleanup':[],'passed':False}
    def save(): (args.out/'receipt.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    digest=hashlib.sha256()
    with urllib.request.urlopen(args.url,timeout=60) as reply:
        for block in iter(lambda:reply.read(1024*1024),b''):digest.update(block)
    r['pageSha256']=digest.hexdigest()
    if args.sha256:assert r['pageSha256']==args.sha256,'Unexpected page version'
    save()
    async with async_playwright() as p:
        browser=await p.chromium.launch(channel='msedge',headless=True,args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding','--js-flags=--max-old-space-size=1800'])
        page=await browser.new_page(viewport={'width':1280,'height':800},locale='zh-CN',device_scale_factor=args.dpr)
        page.on('pageerror',lambda e:r['errors'].append(str(e)))
        await page.add_init_script("localStorage.setItem('tankforge.lang','zh');localStorage.setItem('tankforge.quality.v1','low')")
        try:
            print('PHASE actual production page and shared deployment',flush=True)
            await page.goto(args.url,wait_until='load',timeout=240000)
            await page.wait_for_function("window.__tf?.G?.frontline&&!document.getElementById('boot-splash')",timeout=240000)
            await page.locator('#net-btn').click()
            await page.select_option('#lb-gameplay','air_frontline')
            await page.select_option('#lb-map','taiwan-escort')
            await page.select_option('#lb-era','2022')
            await page.fill('#lb-room-name','R86 flight HUD '+str(int(time.time())))
            await page.locator('#lobby [data-act=create]').click()
            await page.wait_for_function("__tf.G.frontline.room?.map==='taiwan-escort'",timeout=60000)
            await page.locator('#lobby [data-act=start]').click()
            await page.locator('#deploy [data-act=veh][data-id="air:su27"]').click(timeout=90000)
            await page.locator('#dp-ammo [data-act=airlo][data-i="0"]').click()
            spawn=page.locator('#dp-spawns [data-native-spawn="air"]')
            # Both nearby icons can overlap on the deployment map. The normal
            # default is already air; only use the button's keyboard action if needed.
            if await spawn.get_attribute('aria-pressed')!='true':
                await spawn.focus();await spawn.press('Enter')
            await page.locator('#dp-go').click()
            await page.wait_for_function("__tf.G.air?.active&&__tf.G.air.nativeAuthority&&__tf.G.frontline.control",timeout=60000)
            for name,camera in [('third',0),('cockpit',1)]:
                print('PHASE real pilot camera '+name,flush=True)
                if camera:
                    await page.locator('#air-hud').click(position={'x':640,'y':300},force=True)
                    await page.keyboard.press('v')
                await page.wait_for_function('!!document.querySelector("#air-hud .air-ov")',timeout=30000)
                await page.evaluate(OBSERVE)
                await asyncio.sleep(3)
                state=await page.evaluate(PROBE);r['views'][name]=state
                await page.screenshot(path=str(args.out/(name+'.png')))
                tags=[x for x in state['airCanvas']['texts'] if any(k in x['text'] for k in ['舰','艦'])]
                r['checks'][name+'_actual_native_control']=state['airActive'] and state['native'] and state['control']==state['own']
                r['checks'][name+'_correct_camera']=state['camera']==camera
                r['checks'][name+'_visible_pilot_fleet_labels']=state['airCanvasVisible'] and bool(tags)
                boxes=state['airCanvas']['labelRects'];bounds=state['airCanvas']['rect']
                r['checks'][name+'_label_boxes_in_view']=bool(boxes) and all(b['x']>=-1 and b['y']>=-1 and b['x']+b['w']<=bounds['width']+1 and b['y']+b['h']<=bounds['height']+1 for b in boxes)
                r['checks'][name+'_no_bottom_banner']=not state['banner']['visible']
                r['checks'][name+'_minimap_unchanged']=state['minimap']['width']==188 and state['minimap']['height']==188
                r['checks'][name+'_no_runtime_error']=not state['frameError'] and not state['webglLost']
                save()
            r['checks']['no_uncaught_errors']=not r['errors']
            assert all(r['checks'].values()),'Pilot HUD acceptance failed: '+','.join(k for k,v in r['checks'].items() if not v)
            r['passed']=True
        except BaseException as e:
            r['failure']={'message':str(e),'trace':traceback.format_exc()}
            try: r['failureState']=await page.evaluate(PROBE)
            except BaseException: pass
            try: await page.screenshot(path=str(args.out/'failure.png'),timeout=10000)
            except BaseException: pass
        finally:
            try:
                if await page.evaluate('!!window.__tf?.G?.frontline?.room'):
                    await page.evaluate('__tf.G.frontline.shared.leave()')
                    await page.wait_for_function('!__tf.G.frontline.room',timeout=30000)
                    r['cleanup'].append({'acceptedLeave':True})
            except BaseException as e:r['cleanup'].append({'error':str(e)})
            await browser.close()
            r['finished']=time.time();save()
    print(json.dumps({'passed':r['passed'],'checks':r['checks'],'failure':r.get('failure',{}).get('message'),'out':str(args.out)},ensure_ascii=False),flush=True)
    return r['passed']

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('url');parser.add_argument('--out',type=Path,required=True);parser.add_argument('--sha256');parser.add_argument('--dpr',type=float,default=1)
    raise SystemExit(0 if asyncio.run(run(parser.parse_args())) else 1)

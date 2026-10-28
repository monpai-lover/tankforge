#!/usr/bin/env python3
"""Full served page, real friendly peer and normal keyboard dive into terrain.
No fabricated pose, death, inventory or network frames. Public shared deployment
API uses the same validation path as the normal map deployment screen.
"""
import argparse,asyncio,hashlib,json,time,traceback
from pathlib import Path
from playwright.async_api import async_playwright

async def run(a):
    a.out.mkdir(parents=True,exist_ok=True);result={'url':a.url,'checks':{},'started':time.time()};logs=[];companion=None;browser=None
    def save(): (a.out/'receipt.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    def check(k,v,detail=None):
        result['checks'][k]={'passed':bool(v),'detail':detail};save()
        if not v:raise AssertionError(k)
    stop=a.out/'companions.stop'
    async with async_playwright() as p:
      try:
        browser=await p.chromium.launch(channel='msedge',headless=True,args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding'])
        page=await browser.new_page(viewport={'width':1100,'height':720},locale='zh-CN');page.on('pageerror',lambda e:logs.append(str(e)))
        await page.add_init_script("localStorage.setItem('tankforge.lang','zh');localStorage.setItem('tankforge.quality.v1','low')")
        await page.goto(a.url,wait_until='load',timeout=240000)
        await page.wait_for_function("window.__tf?.G&&!document.getElementById('boot-splash')",timeout=240000)
        await page.locator('#net-btn').click();await page.wait_for_function("document.querySelector('#lb-gameplay option[value=air_frontline]')",timeout=60000)
        await page.select_option('#lb-gameplay','air_frontline');await page.select_option('#lb-map','taiwan-escort');await page.select_option('#lb-era','2022')
        await page.fill('#lb-room-name','Automatic friendly spectator '+str(int(time.time())));await page.locator('#lobby [data-act=create]').click()
        await page.wait_for_function("__tf.G.frontline.room?.map==='taiwan-escort'",timeout=45000)
        await page.locator('#lobby [data-act=start]').click();await page.wait_for_function('__tf.G.frontline.room?.started',timeout=45000)
        room=await page.evaluate('__tf.G.frontline.room.id')
        companion=await asyncio.create_subprocess_exec('node',str(Path(__file__).with_name('native-escort-browser-companions.mjs')),a.url.replace('http:','ws:').rstrip('/')+'/ws',str(room),str(a.out/'companions.json'),str(stop),stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
        ready=json.loads((await asyncio.wait_for(companion.stdout.readline(),60)).decode());check('real_living_friendly_deployed',ready.get('ready'),ready)
        check('normal_in_map_deployment_screen',await page.locator('#deploy').is_visible())
        await page.screenshot(path=str(a.out/'in-map-deployment.png'))
        await page.evaluate("__tf.G.frontline.shared.deployAir({aircraft:'f16v',loadout:0,spawn:'air'})")
        await page.wait_for_function('__tf.G.air?.nativeAuthority&&__tf.G.frontline.establishedFlight.getair()?.plane',timeout=60000)
        check('original_local_flight_active',await page.evaluate('!!__tf.G.frontline.airModels.get([__tf.G.frontline.control.battle,__tf.G.frontline.control.unit,__tf.G.frontline.control.life].join(":")).localFlight?.active'))
        await page.bring_to_front();await page.locator('#view').focus()
        # The original keyboard handler deliberately ignores presses during
        # thumbnail warmup. Local-flight admission can precede its last job.
        # Wait for the real input gate before sending one held physical key.
        await page.wait_for_function('''(()=>{const g=__tf.G;return g.mode==='battle'&&g.air?.active&&!g.paused&&g.airInputFocused&&g.thumbs.length===0&&!document.hidden&&document.hasFocus()&&document.activeElement?.id==='view'&&['net-chat','hangar','air-arm','air-keys'].every(id=>document.getElementById(id)?.hidden===true)})()''',timeout=60000)
        ready_input=await page.evaluate('''({thumbs:__tf.G.thumbs.length,active:document.activeElement?.id,focused:__tf.G.airInputFocused,hidden:document.hidden,panels:['net-chat','hangar','air-arm','air-keys'].map(id=>({id,hidden:document.getElementById(id)?.hidden}))})''')
        check('original_keyboard_input_gate_ready',ready_input['thumbs']==0 and all(v['hidden'] for v in ready_input['panels']),ready_input)
        await page.evaluate(r"""(()=>{const r=__tf.renderer,old=r.render;let installed=false;window.__airFxProbe={rows:[],glows:[],maxError:0};r.render=function(nodes,cam,focus,fx){const p=__tf.G.air?.plane,d=__airFxProbe;if(!installed){installed=true;const glow=fx.glow;fx.glow=function(pos,size,color,alpha,seed){if(seed===.11&&color[0]===1&&color[1]===.86){const p=__tf.G.air?.plane,m=p?.root?._renderWorld||p?.root?.world;d.glows.push({pos:pos.slice(),root:m?Array.from(m):null,local:p?Array.from(p.root.local):null});}return glow.apply(this,arguments);};}if(p&&d.rows.length<3000){const glows=d.glows.splice(0);let error=0;for(const g of glows){const m=g.root,l=g.local;if(m&&l)error=Math.max(error,Math.hypot(m[12]-l[12],m[13]-l[13],m[14]-l[14]));}d.maxError=Math.max(d.maxError,error);d.rows.push({time:__tf.G.time,mach:p.cur[13]/340,throttle:p.cur[27],draw:p.drawPos?.slice(),world:p.root._renderWorld?Array.from(p.root._renderWorld).slice(12,15):null,glows,error,gpu:__tf.G.frontline.renderStats?.last});}return old.apply(this,arguments);};})()""")
        await page.keyboard.down('Shift')
        # Wait for actual flight progress: slow GPU/test hosts must not turn a
        # wall-clock delay into a fabricated or unobserved transonic pass.
        await page.wait_for_function('__airFxProbe.rows.some(r=>r.mach>=.99)',timeout=180000,polling=500)
        await page.screenshot(path=str(a.out/'transonic-cone.png'))
        await page.wait_for_function('__airFxProbe.rows.some(r=>r.mach>=1.02)',timeout=60000,polling=500)
        await page.keyboard.up('Shift')
        result['probe']=await page.evaluate('__airFxProbe')
        await page.screenshot(path=str(a.out/'afterburner-final.png'))
        check('real_afterburner_reached',any(row['throttle']>1.01 for row in result['probe']['rows']))
        check('attached_nozzle_uses_drawn_pose',result['probe']['maxError']<.01,{'maxErrorMeters':result['probe']['maxError']})
        check('one_single_engine_plume_per_draw',all(len(row['glows'])<=1 for row in result['probe']['rows']))
        check('real_transonic_passage_observed',any(.95<row['mach']<1.05 for row in result['probe']['rows']))
        result['passed']=True
      except BaseException as e:
        result['passed']=False;result['failure']={'message':str(e),'trace':traceback.format_exc()}
        try:
          result['failureState']=await page.evaluate('''(()=>{const f=__tf?.G?.frontline;return {error:f?.error,mode:__tf.G.mode,air:!!__tf.G.air,control:f?.control,member:f?.shared.self(),spectator:f?.spectator,aircrafts:f?.aircrafts?.map(u=>({unit:u.unit,alive:u.alive,owner:u.owner,pos:u.pos}))}})()''');await page.screenshot(path=str(a.out/'failure.png'))
        except BaseException:pass
      finally:
        stop.write_text('stop',encoding='utf8')
        if companion:
          try:await asyncio.wait_for(companion.wait(),20)
          except BaseException:companion.kill()
        if browser:
          try:
            if await page.evaluate('!!__tf?.G?.frontline?.room'):await page.evaluate('__tf.G.frontline.shared.leave()');await page.wait_for_function('!__tf.G.frontline.room',timeout=30000)
          except BaseException as e:result['cleanupError']=str(e)
          await browser.close()
        result['logs']=logs;result['finished']=time.time();save()
    print(json.dumps({'passed':result.get('passed'),'failure':result.get('failure'),'checks':result['checks']},ensure_ascii=False));return result.get('passed',False)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('url');p.add_argument('--out',type=Path,required=True);a=p.parse_args();raise SystemExit(0 if asyncio.run(run(a)) else 1)

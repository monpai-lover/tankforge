#!/usr/bin/env python3
"""Verify the actual local-flight HUD through the current production UI.

Run only after other GPU browser QA releases its slots. The served QA page keeps
the real flight WASM/catalog but omits imported aircraft meshes: this verifies
inventory presentation, not cockpit/model geometry or online aircraft authority.
No accepted inventory, fake aircraft, or DOM values are injected by this test.
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

ROOT = Path(__file__).resolve().parents[1]
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--js-flags=--max-old-space-size=1500']
SNAPSHOT = """() => {
  const a=__tf.G.air,p=a.plane;
  return JSON.stringify({time:__tf.G.time,cur:Array.from(p.cur),fuel:a.fuel,
    fuelOut:p.fuelOut,engineOff:p.engineOff,engineStart:p.engineStart,
    resourceRevision:a.resourceRevision,guns:a.guns.map(g=>({ammo:g.ammo,t:g.t})),
    stores:a.stores&&{sel:a.stores.sel,burst:a.stores.burst,
      items:a.stores.items.map(i=>({id:i.id,count:i.count,gone:i.gone,
        connected:i.connected,disconnected:i.disconnected,fuel:i.fuel}))}});
}"""
READ = """() => {
  const a=__tf.G.air,p=a.plane;
  const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height,visible:r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'};};
  const rows=[...document.querySelectorAll('#air-hud .air-main > div')].map(e=>{
    const r=e.getBoundingClientRect(),label=e.querySelector('i');return {label:label?.textContent,
      value:e.querySelector('b')?.textContent,unit:e.querySelector('u')?.textContent,
      labelHeight:label?.getBoundingClientRect().height,labelLineHeight:label?parseFloat(getComputedStyle(label).lineHeight):null,
      visible:r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'};});
  const report=window.__airHudQaReader.report(a,0,{timeSeconds:__tf.G.time,
    lifeKey:a.boardedAt,resetKey:a.resourceRevision||0});
  return {type:p.type.id,time:__tf.G.time,rows,report,
    arms:[...document.querySelectorAll('#air-hud .air-store > div')].map(e=>({
      text:e.textContent,count:e.querySelector('b')?.textContent,class:e.className})),
    actual:{guns:a.guns.map(g=>({ammo:g.ammo,sound:g.sound,owner:g.owner,
      caliber:g.def?.caliber_mm,belts:g.belt,pod:!!g.podItem})),fuel:a.fuel,
      fuelOut:p.fuelOut,engineOff:p.engineOff,engineStart:p.engineStart,
      position:Array.from(p.position),nativeState:Array.from(p.cur),
      onGround:p.onGround,groundSpeed:p.groundSpeed,crashed:p.crashed,
      fireAll:!!a.fireAll,inputFireAll:!!a.inputFireAll,fireCannon:!!a.fireCannon,
      loadout:a.stores?.index,selected:__tfx.storeGroup(a.stores)?.id,
      stores:a.stores?.items.map(i=>({id:i.id,kind:i.def.kind,name:i.def.name,
        count:i.count,gone:!!i.gone,owner:i.owner,dead:!!p.damage.dead(i.owner),
        fuel:i.fuel??null,capacity:i.def.fuel??null}))},
    hudVisible:!document.getElementById('air-hud').hidden,
    layout:{data:box(document.querySelector('#air-hud .air-data')),
      damage:box(document.querySelector('#air-hud .air-dmg')),
      arms:box(document.querySelector('#air-hud .air-arms'))},
    frameError:__tf.G.frameError||null};
}"""


async def run(url, out):
    out.mkdir(parents=True, exist_ok=True)
    result = {'purpose':'actual local-flight grouped ammo/fuel HUD browser verification',
              'url':url,'startedAtUnix':time.time(),'checks':{},'phases':{},'logs':[],
              'scope':{'render':'procedural aircraft; imported aircraftModels omitted by fixture',
                       'authority':'actual legacy local flight / real WASM; not new-mode online air',
                       'notVerified':['native cockpit geometry','model placement','full startup performance']}}
    provenance = ROOT/'tests/out/frontline-browser-20261024/page-provenance.json'
    if provenance.exists():
        result['pageProvenance'] = json.loads(provenance.read_text())
    helper = ROOT/'tools/air_hud_inventory.js'
    helper_source = helper.read_text()
    result['helperSha256'] = hashlib.sha256(helper_source.encode()).hexdigest()
    result['resourceHelperSha256'] = hashlib.sha256((ROOT/'tools/aircraft_resources.js').read_bytes()).hexdigest()
    result['appSha256'] = hashlib.sha256((ROOT/'bundle/app.js.html').read_bytes()).hexdigest()
    result['headSha256'] = hashlib.sha256((ROOT/'bundle/head.html').read_bytes()).hexdigest()
    served_hash=hashlib.sha256()
    with urllib.request.urlopen(url,timeout=20) as response:
        for block in iter(lambda:response.read(1024*1024),b''):
            served_hash.update(block)
    result['servedPageSha256']=served_hash.hexdigest()

    def save():
        (out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')

    def check(name, ok, detail=None):
        result['checks'][name]={'pass':bool(ok),'detail':detail}; save()
        if not ok:
            raise AssertionError(name)

    def row(phase, label):
        return next((r for r in phase['rows'] if r['label']==label), {})

    if 'pageProvenance' in result:
        check('served_page_matches_current_provenance',
              result['servedPageSha256']==result['pageProvenance']['pageSha256'] and
              result['appSha256']==result['pageProvenance']['currentAppSha256'])

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True,args=ARGS)
        page = await browser.new_page(viewport={'width':1280,'height':800},
                                      device_scale_factor=1,locale='zh-CN')
        page.on('console',lambda m: result['logs'].append({'type':m.type,'text':m.text[:3000]})
                if m.type in ['error','warning'] and len(result['logs'])<150 else None)
        page.on('pageerror',lambda e: result['logs'].append({'type':'pageerror','text':str(e)[:3000]}))

        async def draw(seconds=.1):
            # Each call enters the actual update/render path; four draws cover the
            # real HUD's 1-in-4 refresh cadence without touching its DOM or tick.
            await page.evaluate('(s)=>__tf.advance(s,[],true)',seconds)
            for _ in range(3):
                await page.evaluate('__tf.advance(1/60,[],true)')

        async def action_click(selector):
            # Production weapon/engine actions deliberately reject paused input.
            # Open the real input gate for the actual UI event, then resume the
            # bounded native stepping used by this test.
            # The live action bar replaces its button nodes while rendering.
            # Measure while paused, then send an ordinary trusted mouse click
            # at that visible control; locator stability waits would keep
            # chasing replacement nodes after opening the input gate.
            control=page.locator(selector)
            assert await control.is_visible(), selector+' must be visible'
            bounds=await control.bounding_box()
            await page.evaluate('__tf.pause(false)')
            await page.mouse.click(bounds['x']+bounds['width']/2,
                                   bounds['y']+bounds['height']/2)
            await page.evaluate('__tf.pause(true)')

        async def action_key(key):
            await page.evaluate('__tf.pause(false)')
            await page.keyboard.press(key)
            await page.evaluate('__tf.pause(true)')

        async def capture(name, screenshot=True):
            before=await page.evaluate(SNAPSHOT)
            value=await page.evaluate(READ)
            after=await page.evaluate(SNAPSHOT)
            value['helperReadOnly']=before==after
            result['phases'][name]=value; save()
            check(name+'_helper_read_only',before==after)
            check(name+'_actual_hud_visible',value['hudVisible'] and all(r['visible'] for r in value['rows']))
            check(name+'_labels_single_line',all(r['labelHeight']<=r['labelLineHeight']+1 for r in value['rows'] if r.get('label')),value['rows'])
            d,m=value['layout']['data'],value['layout']['damage']
            overlaps=(min(d['x']+d['width'],m['x']+m['width'])>max(d['x'],m['x']) and
                      min(d['y']+d['height'],m['y']+m['height'])>max(d['y'],m['y']))
            check(name+'_damage_does_not_cover_inventory',not(m['visible'] and overlaps),value['layout'])
            check(name+'_no_frame_error',not value['frameError'],value['frameError'])
            if screenshot:
                await page.screenshot(path=str(out/(name+'.png')),timeout=60000)
            return value

        async def fly(type_id):
            print('PHASE actual hangar UI: '+type_id,flush=True)
            if await page.locator('#air-btn').is_visible():
                await page.click('#air-btn')
                result.setdefault('entryMethods',[]).append({'type':type_id,'method':'visible hangar button'})
            else:
                # The garage header/button is intentionally hidden in battle.
                # Use its shipped F8 shortcut, including the documented first
                # press to leave an existing aircraft, rather than force-click
                # a hidden element or directly create an aircraft.
                if await page.evaluate('!!__tf.G.air?.active'):
                    await page.keyboard.press('F8')
                await page.keyboard.press('F8')
                result.setdefault('entryMethods',[]).append({'type':type_id,'method':'actual F8 shortcut then visible hangar card','reason':'garage hangar button hidden in battle'})
            await page.wait_for_selector('#hangar:not([hidden])',timeout=15000)
            card=page.locator('#hangar .hangar-card[data-air="'+type_id+'"]')
            await card.focus()
            await page.keyboard.press('Enter')
            await page.wait_for_function('(id)=>__tf.G.air?.active&&__tf.G.air.plane.type.id===id',
                                         arg=type_id,timeout=30000)
            await page.evaluate('__tf.pause(true)')
            result.setdefault('aircraftEntryState',[]).append(await page.evaluate('({type:__tf.G.air.plane.type.id,ammo:__tf.G.air.guns.map(g=>g.ammo),fireAll:!!__tf.G.air.fireAll,inputFireAll:!!__tf.G.air.inputFireAll})'))
            await page.mouse.up()
            await draw()

        try:
            await page.add_init_script("localStorage.setItem('tankforge.lang','zh');localStorage.setItem('tankforge.quality.v1','low')")
            print('PHASE boot real page',flush=True)
            response=await page.goto(url,wait_until='load',timeout=180000)
            check('served_actual_page_http_200',response is not None and response.status==200,
                  {'status':response.status if response else None})
            await page.wait_for_function("window.__tf&&window.__tfx&&!document.getElementById('boot-splash')",timeout=180000)
            await page.evaluate('__tf.pause(true);__tf.setQuality("low");__tf.finishThumbs()')
            # A fresh instance of the exact source reads the real accepted air.
            # The actual visible UI continues using its embedded private instance.
            await page.evaluate('(source)=>{const make=new Function(source+";return createAirHudInventory")();window.__airHudQaReader=make({projectiles:()=>__tfx.data.projectiles,storeDefs:()=>__tfx.AIR_STORE_DEFS});}',helper_source)
            result['coreVersion']=await page.evaluate('(async()=>{const c=await __tfx.flightCoreP;return c.core_version()})()')
            check('actual_flight_core_212',result['coreVersion']==212)
            result['entryBefore']=await page.evaluate('({mode:__tf.G.mode,map:__tf.G.mapId,thumbs:__tf.G.thumbs.length})')
            await page.click('#battle-btn')
            await page.wait_for_function('__tf.G.mode==="battle"',timeout=30000)
            await page.evaluate('__tf.pause(true)')
            check('entered_actual_battle_button',await page.evaluate('__tf.G.mode==="battle"&&!__tf.G.online'))

            await fly('mig15')
            mig=await capture('mig15-stock')
            check('mig15_actual_feed_stock_80_80_40',sorted(g['ammo'] for g in mig['actual']['guns'])==[40,80,80],mig['actual']['guns'])
            check('mig15_visible_23mm_160_37mm_40',row(mig,'機炮 23 mm').get('value')=='160' and row(mig,'機炮 37 mm').get('value')=='40',mig['rows'])
            check('mig15_guns_only_has_no_selected_bomb',mig['report']['selectedStore'] is None and mig['report']['selectedBombCount']==0 and not row(mig,'外掛'))
            await page.focus('#view')
            await page.keyboard.down('ShiftLeft')
            await draw(1.4)
            await page.keyboard.up('ShiftLeft')
            await draw(.8)
            running=await capture('mig15-current-consumption')
            check('actual_flow_positive_and_fuel_decreases',running['actual']['fuel']['flow']>0 and running['report']['fuel']['usableKg']<mig['report']['fuel']['usableKg'],{'before':mig['actual']['fuel'],'after':running['actual']['fuel']})
            check('visible_current_power_endurance',row(running,'預計續航').get('value') not in [None,'—','00:00'] and row(running,'估算狀態').get('value')=='當前功率估算',running['rows'])
            await page.evaluate('document.exitPointerLock?.()')
            await action_click('#air-hud .air-bar [data-act=engine]')
            fuel_before=await page.evaluate('__tf.G.air.fuel.kg')
            await draw(.8)
            stopped=await capture('mig15-engine-off')
            check('actual_engine_off_no_burn',stopped['actual']['engineOff'] and stopped['actual']['fuel']['flow']==0 and stopped['actual']['fuel']['kg']==fuel_before)
            check('visible_engine_off_no_numeric_endurance',row(stopped,'預計續航').get('value')=='—' and row(stopped,'估算狀態').get('value')=='引擎關閉',stopped['rows'])

            await fly('f104g')
            f104=await capture('f104-stock')
            check('f104_actual_configured_m61_stock_725',len(f104['actual']['guns'])==1 and f104['actual']['guns'][0]['ammo']==725,f104['actual']['guns'])
            check('f104_visible_single_20mm_reservoir_725',row(f104,'機炮 20 mm').get('value')=='725',f104['rows'])
            # Actual mouse input: first click may acquire pointer lock; the next
            # press sets the real fire control, consumed by actual gun stepping.
            await page.locator('#view').hover(position={'x':760,'y':350})
            await page.mouse.click(760,350)
            await page.mouse.down()
            firing=await page.evaluate('!!__tf.G.air.fireAll')
            if not firing:
                await page.mouse.up()
                await page.mouse.down()
                firing=await page.evaluate('!!__tf.G.air.fireAll')
            check('actual_mouse_sets_aircraft_fire_input',firing)
            await draw(.2)
            await page.mouse.up()
            await draw(.1)
            fired=await capture('f104-after-real-fire')
            check('real_fire_decrements_feed_and_visible_count',0<fired['actual']['guns'][0]['ammo']<725 and row(fired,'機炮 20 mm').get('value')==str(fired['actual']['guns'][0]['ammo']),fired['actual']['guns'])
            await page.evaluate('document.exitPointerLock?.()')
            # K goes from guns-only to missiles, then mixed bombs/missiles while
            # the real aircraft is stopped on the range runway.
            await page.focus('#view')
            for _ in range(2):
                await action_key('KeyK')
                await draw(.02)
            loaded=await capture('f104-real-rearm')
            check('f104_actual_mixed_bomb_missile_loadout',set(s['id'] for s in loaded['report']['stores'])=={'mk82','aim9b'},loaded['actual'])
            first=loaded['report']['selectedStore']['id']
            await action_click('#air-hud .air-bar [data-act=weaponNext]')
            await draw(.02)
            switched=await capture('f104-weapon-switch')
            check('actual_selection_and_visible_store_switch',switched['report']['selectedStore']['id']!=first and row(switched,'外掛').get('value')==switched['report']['selectedStore']['name']+' × '+str(switched['report']['selectedStore']['count']))
            await action_click('#air-hud .air-bar [data-act=jettison]')
            await draw(.02)
            await action_click('#air-hud .air-bar [data-act=jettison]')
            await draw(.02)
            empty=await capture('f104-actual-jettison-empty')
            check('actual_jettison_empty_selected_count_zero',empty['report']['selectedStore']['count']==0 and all(s['count']==0 for s in empty['report']['stores']) and row(empty,'外掛').get('value','').endswith(' × 0'),empty['actual']['stores'])

            await fly('f86f')
            await page.focus('#view')
            for _ in range(3):
                await action_key('KeyK')
                await draw(.02)
            tanks=await capture('f86-real-external-tanks')
            internal=tanks['actual']['fuel']['kg']
            external=sum((s['fuel'] if s['fuel'] is not None else s['capacity']) for s in tanks['actual']['stores'] if s['kind']=='tank' and not s['gone'] and not s['dead'])
            check('actual_external_tank_fuel_included',external>0 and abs(tanks['report']['fuel']['usableKg']-internal-external)<1e-6,{'internal':internal,'external':external,'report':tanks['report']['fuel']})
            check('visible_fuel_matches_total_internal_external',row(tanks,'燃油').get('value')==str(round(internal+external)),tanks['rows'])
            await page.keyboard.down('ShiftLeft')
            await draw(1.4)
            await page.keyboard.up('ShiftLeft')
            await draw(.8)
            tank_burn=await capture('f86-external-current-consumption')
            check('actual_external_tank_burn_and_current_estimate',tank_burn['report']['fuel']['externalKg']<external and tank_burn['report']['fuel']['usableKg']<internal+external and row(tank_burn,'估算狀態').get('value')=='當前功率估算',tank_burn['report']['fuel'])
            check('no_javascript_page_or_frame_errors',not any(l['type']=='pageerror' or 'frame update failed' in l['text'] for l in result['logs']),result['logs'])
            result['passed']=True
        except Exception:
            result['passed']=False; result['failure']=traceback.format_exc()
            try:
                result['failureState']=await page.evaluate('({mode:window.__tf?.G.mode,air:window.__tf?.G.air?.plane?.type?.id,body:document.body.dataset})')
                await page.screenshot(path=str(out/'failure.png'),timeout=60000)
            except Exception as error:
                result['failureScreenshotError']=str(error)
            raise
        finally:
            result['finishedAtUnix']=time.time(); save()
            await browser.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url',default='http://127.0.0.1:8797/')
    parser.add_argument('--out',type=Path,default=ROOT/'tests/out/air-hud-browser-20261024')
    args=parser.parse_args()
    asyncio.run(run(args.url,args.out))

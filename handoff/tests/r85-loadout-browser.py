"""Normal production deployment clicks through shared API and native acceptance.

No aircraft state, resources, or native messages are fabricated. Uses one real
Edge browser and a separately started native server; never starts/stops it.
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

PROBE = """() => {const g=__tf.G,f=g.frontline;return {tick:f.lastTick,error:g.frameError||f.error||null,room:f.room?.id,control:f.control,
 selected:g.airLoadout,custom:g.airCustom,counts:g.airCustomCounts,
 deploy:{visible:!document.getElementById('deploy').hidden,buttons:[...document.querySelectorAll('#dp-ammo [data-act=airlo]')].map(b=>({i:b.dataset.i,pressed:b.getAttribute('aria-pressed'),disabled:b.disabled,text:b.textContent}))},
 options:f.aircraftOptions.map(a=>({id:a.id,custom_counts_version:a.custom_counts_version,loadouts:a.loadouts,slots:a.slots})),aircrafts:f.aircrafts.map(a=>({unit:a.unit,aircraft:a.aircraft,owner:a.owner,controller:a.controller,loadout:a.loadout,custom:a.custom,custom_counts:a.custom_counts,stores:a.stores,service:a.service,fuel:a.fuel,guns:a.guns}))}}"""

async def run(args):
    args.out.mkdir(parents=True,exist_ok=True)
    result={'url':args.url,'started':time.time(),'phases':{},'errors':[]}
    def save(): (args.out/'receipt.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    digest=hashlib.sha256()
    with urllib.request.urlopen(args.url,timeout=60) as response:
        for block in iter(lambda:response.read(1024*1024),b''):digest.update(block)
    result['servedPageSha256']=digest.hexdigest();save()
    if args.sha256:assert result['servedPageSha256']==args.sha256,'Served page differs from final frozen SHA256'
    async with async_playwright() as p:
        browser=await p.chromium.launch(channel='msedge',headless=True,args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding','--js-flags=--max-old-space-size=1800'])
        page=await browser.new_page(viewport={'width':1100,'height':720},locale='zh-CN')
        page.set_default_timeout(20000)
        await page.add_init_script("localStorage.setItem('tankforge.lang','zh');localStorage.setItem('tankforge.quality.v1','low')")
        page.on('pageerror',lambda e:result['errors'].append(str(e)))
        try:
            print('PHASE production page boot',flush=True)
            await page.goto(args.url,wait_until='load',timeout=240000)
            await page.wait_for_function("window.__tf?.G?.frontline&&!document.getElementById('boot-splash')",timeout=240000,polling=500)
            await page.locator('#net-btn').click()
            await page.wait_for_selector('#lb-gameplay',timeout=60000)
            await page.select_option('#lb-gameplay','air_frontline')
            await page.select_option('#lb-map',args.map)
            await page.select_option('#lb-era','2022')
            await page.fill('#lb-room-name','R85 loadout UI '+str(int(time.time())))
            await page.locator('#lobby [data-act=create]').click()
            await page.wait_for_function("__tf.G.frontline.room?.map==="+json.dumps(args.map),timeout=60000)
            await page.locator('#lobby [data-act=start]').click()
            vehicle='#deploy [data-act=veh][data-id="air:'+args.aircraft+'"]'
            await page.wait_for_selector(vehicle,timeout=90000)
            await page.locator(vehicle).click()
            result['phases']['opened']=await page.evaluate(PROBE);save()
            print('PHASE select preset through actual button',flush=True)
            await page.locator('#dp-ammo [data-act=airlo][data-i="1"]').click()
            await asyncio.sleep(1)
            result['phases']['preset']=await page.evaluate(PROBE);save()
            await page.screenshot(path=str(args.out/'preset.png'))
            assert result['phases']['preset']['selected'].get(args.aircraft)==1,'Preset choice did not persist to the source aircraft preference'
            assert next(b for b in result['phases']['preset']['deploy']['buttons'] if b['i']=='1')['pressed']=='true','Actual preset button did not stay selected'
            print('PHASE custom editor through normal deployment button',flush=True)
            await page.locator('#dp-ammo [data-act=configure-air]').click()
            await page.wait_for_selector('#air-arm:not([hidden])')
            await page.locator('#air-arm .air-arm-clear').click()
            cell=page.locator('#air-arm .air-arm-cell[data-store='+args.store+']'+('[data-slot="mid:-1"]' if args.quantity else '')+':not([disabled])').first
            assert await cell.count(),'Admitted custom bomb cell is unavailable'
            await cell.click()
            if args.quantity:
                await page.locator('#air-arm .air-arm-count').first.select_option(str(args.quantity))
            result['phases']['custom']=await page.evaluate(PROBE);save()
            await page.screenshot(path=str(args.out/'custom.png'))
            await page.locator('#air-arm .air-arm-done').click()
            if args.reclaim or args.service:
                await page.locator('#dp-spawns [data-native-spawn="runway"]').click()
            await page.locator('#dp-go').click()
            await page.wait_for_function("__tf.G.frontline.aircrafts.some(a=>a.owner===__tf.net.id&&a.controller===__tf.net.id)",timeout=30000)
            result['phases']['accepted']=await page.evaluate(PROBE);save()
            accepted=next(a for a in result['phases']['accepted']['aircrafts'] if a['controller'] is not None)
            expected=result['phases']['custom']['custom'][args.aircraft]
            assert accepted['custom']==expected,'Native accepted custom differs from actual UI pick'
            assert accepted['stores'] and all(s['id']==args.store for s in accepted['stores']),'Native authority did not materialize selected weapons'
            if args.quantity:
                assert len(accepted['stores'])==len(expected)*args.quantity,'Native accepted quantity differs from actual custom quantity choice'
                assert accepted['custom_counts']=={slot:args.quantity for slot in expected},'Native accepted quantity echo differs from editor choice'
            if args.reclaim:
                print('PHASE retained aircraft return and another preset/custom choice',flush=True)
                await page.locator('#to-garage').click()
                await page.wait_for_selector('#dp-go',state='visible',timeout=20000)
                await page.locator('#dp-ammo [data-act=airlo][data-i="2"]').click()
                await asyncio.sleep(1)
                result['phases']['returnedPreset']=await page.evaluate(PROBE);save()
                assert result['phases']['returnedPreset']['selected'][args.aircraft]==2,'Preset click stopped working after returning to retained aircraft'
                await page.locator('#dp-ammo [data-act=configure-air]').click()
                await page.wait_for_selector('#air-arm:not([hidden])')
                await page.locator('#air-arm .air-arm-clear').click()
                await page.locator('#air-arm .air-arm-cell[data-store='+args.store+']:not([disabled])').first.click()
                await page.locator('#air-arm .air-arm-done').click()
                await page.locator('#dp-go').click()
                await page.wait_for_function("__tf.G.frontline.aircrafts.some(a=>a.owner===__tf.net.id&&a.controller===__tf.net.id)",timeout=30000)
                result['phases']['reclaimed']=await page.evaluate(PROBE);save()
                retained=next(a for a in result['phases']['reclaimed']['aircrafts'] if a['controller'] is not None)
                assert retained['unit']==accepted['unit'],'Returning unexpectedly replaced the original native aircraft'
                assert retained['custom']==accepted['custom'],'Return altered accepted original configuration without airport service'
            if args.service:
                print('PHASE existing airport service controls are visible in original HUD',flush=True)
                await page.locator('#frontline-air-service > summary').click()
                await page.wait_for_selector('#frontline-air-service [data-fl=air-loadout]',state='visible')
                service_preset=await page.query_selector('#frontline-air-service [data-fl=air-loadout]')
                service_fuel=await page.query_selector('#frontline-air-service [data-air-fuel]')
                assert service_fuel,'Existing airport fuel choice is unavailable'
                await asyncio.sleep(.8)
                assert await service_preset.evaluate('(node)=>node.isConnected'),'Native refresh replaced the airport preset select'
                assert await service_fuel.evaluate('(node)=>node.isConnected'),'Native refresh replaced the airport fuel select'
                result['phases']['visibleServiceControls']=await page.evaluate(PROBE);save()
                await page.locator('#frontline-air-service [data-fl=air-loadout]').select_option('0')
                await page.wait_for_function("!document.querySelector('#frontline-air-service [data-fl=service-air]').disabled",timeout=15000)
                before=await page.evaluate(PROBE)
                original=next(a for a in before['aircrafts'] if a['controller'] is not None)
                await page.locator('#frontline-air-service [data-fl=service-air]').click()
                await page.wait_for_function("__tf.G.frontline.aircrafts.some(a=>a.controller===__tf.net.id&&a.service?.status==='servicing')",timeout=15000)
                result['phases']['serviceRequested']=await page.evaluate(PROBE);save()
                pending=next(a for a in result['phases']['serviceRequested']['aircrafts'] if a['controller'] is not None)
                assert pending['unit']==original['unit'] and len(pending['stores'])==len(original['stores']),'Service granted stores before completion'
                await page.wait_for_function("__tf.G.frontline.aircrafts.some(a=>a.controller===__tf.net.id&&a.service?.status==='complete')",timeout=35000)
                result['phases']['serviceCompleted']=await page.evaluate(PROBE);save()
                completed=next(a for a in result['phases']['serviceCompleted']['aircrafts'] if a['controller'] is not None)
                assert completed['unit']==original['unit'] and not completed['stores'] and completed['custom'] is None,'Normal airport service did not apply selected guns-only preset on the same aircraft'
                assert completed['service']['elapsed_s']>=15,'Airport service committed before 15 native seconds'
            result['passed']=True
        except BaseException as error:
            result['passed']=False;result['failure']={'message':str(error),'trace':traceback.format_exc()}
            try: result['phases']['failure']=await page.evaluate(PROBE)
            except BaseException: pass
            try: await page.screenshot(path=str(args.out/'failure.png'),timeout=10000)
            except BaseException: pass
        finally:
            try:
                if await page.evaluate('!!window.__tf?.G?.frontline?.room'):
                    await page.evaluate('__tf.G.frontline.shared.leave()')
                    await page.wait_for_function('!__tf.G.frontline.room',timeout=15000)
            except BaseException as error:result['cleanupError']=str(error)
            await browser.close()
            save()
    print(json.dumps({'passed':result.get('passed'),'failure':result.get('failure'),'out':str(args.out)},ensure_ascii=False),flush=True)
    return result.get('passed',False)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('url');parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--map',default='korea');parser.add_argument('--aircraft',default='f86f');parser.add_argument('--store',default='anm64');parser.add_argument('--quantity',type=int)
    parser.add_argument('--reclaim',action='store_true');parser.add_argument('--service',action='store_true')
    parser.add_argument('--sha256')
    raise SystemExit(0 if asyncio.run(run(parser.parse_args())) else 1)

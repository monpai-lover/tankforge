#!/usr/bin/env python3
"""One actual browser: native15s service, interruption/cancel, and retained stock.

Requires a separately prepared frozen page and matching source-built server. Does
not start/build either, set aircraft state, fast-forward time, or capture pixels.

Example after the root agent's final asset/source/profile/binary freeze:
  python3 handoff/tests/frontline-air-service-browser.py http://127.0.0.1:8797/

The page-provenance default is the new service output directory, not the older
ground/air/HUD evidence. The fixture uses1986/MiG21, friendly runway spawn and the
server-admitted production loadouts0/2/3. It pauses only legacy garage thumbnails.
One real continuous15-second completion changes guns-only to twoFAB250; later
actual pilot input and the cancel button must interrupt without granting stock.
Return/rejoin must preserve the original loadout/inventory while the user's next
loadout remains selected for service. Flight/UnitRef/model identity must persist.
The browser does not forge damage: actual outer-wing detach/repair/detach and
same-loadout store restoration are covered separately with the production
Aircraft/mounter CPU regressions and native backend tests. No pixel/GPU latency,
imported-model or historical-configuration certification is implied.
"""
import argparse
import asyncio
import hashlib
import json
import math
import runpy
import time
import traceback
import urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[2]
COMMON=runpy.run_path(str(Path(__file__).with_name('frontline-air-browser.py')))
F,PROBE,ARGS=COMMON['F'],COMMON['PROBE'],COMMON['ARGS']

async def run(url,out,provenance):
    out.mkdir(parents=True,exist_ok=True)
    result={'startedAtUnix':time.time(),'checks':{},'phases':{},'cleanup':[],
      'capturePass':None,'captureStatus':'not_attempted; noGPUperformance certification',
      'scope':'One local real UI/browser, accepted native service progression and inventory only; no state injection or time manipulation.'}
    logs=[];wire=[];page=None;browser=None
    def save(): (out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    def check(name,ok,detail=None):
        result['checks'][name]={'pass':bool(ok),'detail':detail};save()
        if not ok:raise AssertionError(name)
    def socket(ws):
        def record(payload,direction):
            try:v=json.loads(payload)
            except (TypeError,ValueError):return
            if v.get('t')!='frontline':return
            m=v.get('message',v.get('command',{}))
            if m.get('op')=='frame':
                controlled=[u for u in m.get('aircrafts',[]) if u.get('controller') is not None]
                if not controlled and not m.get('events'):return
                v={'t':'frontline','version':v['version'],'rawFrameSubset':True,'message':{'op':'frame','tick':m['tick'],'battle':m['battle'],'aircrafts':controlled,'events':m.get('events',[])}}
            if len(wire)<12000:wire.append({'direction':direction,'atMonotonicMs':time.perf_counter()*1000,'value':v})
        ws.on('framesent',lambda p:record(p,'sent'));ws.on('framereceived',lambda p:record(p,'received'))
    async def probe():return await page.evaluate(PROBE)
    def own(s):return next(a for a in s['aircrafts'] if a['latest']['unit']==s['control'])
    async def live():return own(await probe())
    async def focus():await page.locator('#view').click(position={'x':300,'y':400},button='right')
    async def fire():
        before=(await live())['latest'];ammo=sum(g['ammo'] for g in before['guns'])
        await focus();await page.mouse.down(button='left');await asyncio.sleep(.6);await page.mouse.up(button='left')
        await page.wait_for_function(f'{F}.aircrafts.find(u=>u.unit.unit==={before["unit"]["unit"]}).guns.reduce((n,g)=>n+g.ammo,0)<{ammo}',timeout=8000,polling=50)
        # Mouse-up precedes the host observing its release packet. Wait on real
        # native ticks before recording stock; an earlier frame may still include
        # a final legitimately fired round. This never advances simulation time.
        released_at=(await live())['latest']['state'][23]
        await page.wait_for_function(f'!{F}.fire&&{F}.aircrafts.find(u=>u.unit.unit==={before["unit"]["unit"]}).state[23]>{released_at}+.35',timeout=8000,polling=50)
        return before,(await live())['latest']
    async def service_status(status,elapsed=None):
        condition=f"""(()=>{{const f={F},u=f.aircrafts.find(u=>u.unit.unit===f.control?.unit);return u?.service?.status==={json.dumps(status)}{'' if elapsed is None else f'&&u.service.elapsed_s>={elapsed}'};}})()"""
        await page.wait_for_function(condition,timeout=35000 if status=='complete' else 10000,polling=50)
        return await live()
    p=await async_playwright().start()
    try:
        manifest=json.loads(provenance.read_text());result['pageProvenance']=manifest
        assert hashlib.sha256((ROOT/'handoff/bundle/app.js.html').read_bytes()).hexdigest()==manifest['currentAppSha256'],'Page source changed after preparation'
        digest=hashlib.sha256()
        with urllib.request.urlopen(url,timeout=30) as r:
            for part in iter(lambda:r.read(1024*1024),b''):digest.update(part)
        check('served_frozen_page',digest.hexdigest()==manifest['pageSha256'])
        browser=await p.chromium.launch(headless=True,args=ARGS);page=await browser.new_page(viewport={'width':1080,'height':720},locale='zh-CN')
        await page.add_init_script("localStorage.setItem('tankforge.lang','zh');localStorage.setItem('tankforge.quality.v1','low')")
        page.on('websocket',socket);page.on('pageerror',lambda e:logs.append({'type':'pageerror','text':str(e)}));page.on('console',lambda m:logs.append({'type':m.type,'text':m.text[:1500]}) if m.type in ['error','warning'] and len(logs)<100 else None)
        print('PHASE native runway aircraft',flush=True)
        await page.goto(url,wait_until='load',timeout=180000);await page.wait_for_function("window.__tf?.G?.frontline&&!document.getElementById('boot-splash')",timeout=180000)
        await page.evaluate("""__tf.pause(true);__tf.setQuality('low');window.__serviceDecoded=[];__tf.net.on('frontline',v=>{const m=v.message;if(m.op==='frame'){const aircrafts=m.aircrafts.filter(u=>u.controller!==null);if((aircrafts.length||m.events.length)&&__serviceDecoded.length<5000)__serviceDecoded.push({direction:'received',decodedWire2SampleSubset:true,value:{t:'frontline',version:v.version,message:{op:'frame',tick:m.tick,battle:m.battle,aircrafts,events:m.events}}});}})""")
        result['fixture']={'oneBrowser':True,'legacyGarageOnlyPaused':True,'aircraftModels':'Actual Aircraft class and retained source model bytes from the bounded QA page','retainedAircraftModels':manifest.get('retainedAircraftModels',[]),'nativeWorldReduced':False}
        await page.click('#frontline-open');await page.fill('[data-fl=name]','Native-air-service-QA');await page.select_option('[data-fl=era]','1986');await page.click('[data-fl=create]')
        await page.wait_for_function(f'{F}.active&&{F}.aircraftOptions.length>0',timeout=60000)
        await page.select_option('[data-fl=aircraft]','mig21');await page.wait_for_function("document.querySelector('[data-fl=air-loadout]').dataset.signature.startsWith('mig21:')",timeout=10000)
        await page.select_option('[data-fl=air-loadout]','0');await page.select_option('[data-fl=air-spawn]','runway');await page.click('[data-fl=deploy-air]')
        await page.wait_for_function(f'{F}.aircrafts.some(u=>u.unit.unit==={F}.control?.unit&&u.service)',timeout=30000)
        initial=await probe();air=own(initial);reference=initial['control'];epoch=initial['epoch'];result['phases']['initial']=initial
        check('actual_runway_aircraft_with_native_service_state',air['model']['actualClass']=='Aircraft' and air['model']['stateMatches'] and air['latest']['service']['duration_s']==15 and abs(air['latest']['pos'][1]-initial['controlledHeight']-2)<.08)
        await page.evaluate(f"(()=>{{const f={F},k=`${{f.control.battle}}:${{f.control.unit}}:${{f.control.life}}`,m=f.airModels.get(k);window.__serviceQaOriginal={{plane:m.plane,root:m.root}}}})()")
        await focus();await page.keyboard.press('KeyB')
        before,spent=await fire();check('actual_gunfire_creates_finite_stock_deficit',sum(g['ammo'] for g in spent['guns'])<sum(g['ammo'] for g in before['guns']))

        print('PHASE continuous15s native repair/rearm/refuel and loadout',flush=True)
        await page.select_option('[data-fl=air-loadout]','2')
        await page.wait_for_function("!document.querySelector('[data-fl=service-air]').disabled",timeout=10000)
        await page.click('[data-fl=service-air]');started=await service_status('servicing');start=started['latest'];result['phases']['serviceStarted']=started
        check('service_request_does_not_instantly_refill_or_swap_loadout',start['loadout']==0 and sum(g['ammo'] for g in start['guns'])==sum(g['ammo'] for g in spent['guns']) and not start['stores'])
        in_progress=await service_status('servicing',3);progress=in_progress['latest'];result['phases']['inProgress']=in_progress
        check('partial_native_progress_grants_no_inventory',progress['service']['elapsed_s']<15 and progress['loadout']==0 and sum(g['ammo'] for g in progress['guns'])==sum(g['ammo'] for g in spent['guns']) and not progress['stores'],progress['service'])
        completed=await service_status('complete');done=completed['latest'];result['phases']['completed']=completed
        native_elapsed=done['state'][23]-(start['state'][23]-start['service']['elapsed_s'])
        identity=await page.evaluate(f"(()=>{{const f={F},m=f.airModels.get(`${{f.control.battle}}:${{f.control.unit}}:${{f.control.life}}`);return m.plane===__serviceQaOriginal.plane&&m.root===__serviceQaOriginal.root}})()")
        check('native15s_completion_is_atomic_on_same_aircraft_without_flight_reset',done['unit']==reference and (await probe())['epoch']==epoch and identity and done['service']['elapsed_s']==15 and native_elapsed>=14.9 and done['resource_revision']>start['resource_revision'] and done['service_revision']>start['service_revision'] and done['loadout']==2 and sum(g['ammo'] for g in done['guns'])==sum(g['ammo'] for g in before['guns']) and abs(done['fuel']['kg']-done['fuel']['max'])<.1 and len(done['stores'])==2 and all(s['visible'] and s['uploaded'] for s in completed['model']['stores']),{'nativeElapsedFlightSeconds':native_elapsed,'before':start,'after':done,'modelSameIdentity':identity})

        print('PHASE unsafe-control interruption',flush=True)
        _,spent_again=await fire();await page.select_option('[data-fl=air-loadout]','3');await page.wait_for_function("!document.querySelector('[data-fl=service-air]').disabled",timeout=10000);await page.click('[data-fl=service-air]');await service_status('servicing',1)
        await focus();await page.keyboard.down('KeyA')
        try:cancelled=await service_status('cancelled')
        finally:await page.keyboard.up('KeyA')
        interrupted=cancelled['latest'];result['phases']['interrupted']=cancelled
        check('real_control_input_interrupts_and_grants_no_rearm_or_new_loadout',interrupted['service']['reason']=='unsafe_controls' and interrupted['service']['elapsed_s']==0 and interrupted['loadout']==2 and sum(g['ammo'] for g in interrupted['guns'])==sum(g['ammo'] for g in spent_again['guns']) and interrupted['fuel']['kg']<=spent_again['fuel']['kg'],interrupted['service'])
        check('actual_ui_shows_native_interruption_reason','操纵' in await page.locator('[data-fl=air-service-status]').inner_text())

        print('PHASE explicit cancel',flush=True)
        await page.wait_for_function("!document.querySelector('[data-fl=service-air]').disabled",timeout=10000);await page.click('[data-fl=service-air]');await service_status('servicing',1);await page.click('[data-fl=cancel-air-service]');manual=await service_status('cancelled');result['phases']['manualCancel']=manual
        check('actual_cancel_button_clears_progress_without_granting_stock',manual['latest']['service']['reason']=='cancelled' and manual['latest']['service']['elapsed_s']==0 and manual['latest']['loadout']==2 and sum(g['ammo'] for g in manual['latest']['guns'])==sum(g['ammo'] for g in spent_again['guns']))

        print('PHASE return/rejoin keeps original configuration',flush=True)
        pre_return=(await live())['latest'];await page.click('[data-fl=return]');await page.wait_for_function(f'{F}.control===null',timeout=15000)
        await page.select_option('[data-fl=air-loadout]','3');await page.click('[data-fl=deploy-air]');await page.wait_for_function(f'{F}.control?.unit==={reference["unit"]}',timeout=15000)
        resumed=await live();result['phases']['resumed']=resumed
        check('return_rejoin_cannot_refill_or_switch_loadout_and_retains_service_target',resumed['latest']['unit']==reference and resumed['latest']['loadout']==2 and sum(g['ammo'] for g in resumed['latest']['guns'])==sum(g['ammo'] for g in pre_return['guns']) and resumed['latest']['fuel']['kg']<=pre_return['fuel']['kg']+.001 and await page.locator('[data-fl=air-loadout]').input_value()=='3' and '15秒整备' in await page.locator('[data-fl=air-deployment-note]').inner_text())
        commands=[w['value']['command'] for w in wire if w['direction']=='sent' and w['value'].get('command',{}).get('op') in ['air_input','service_air','cancel_air_service']]
        groups={}
        for c in commands:groups.setdefault(c['epoch'],[]).append(c['seq'])
        check('service_cancel_and_pilot_commands_share_strict_epoch_sequences',all(all(b>a for a,b in zip(v,v[1:])) for v in groups.values()) and any(c['op']=='cancel_air_service' for c in commands))
        result['wireStats']=await page.evaluate('__tf.net.frontlineWire')
        check('native_service_uses_accepted_binary_frames_without_resets',result['wireStats']['version']==2 and result['wireStats']['frames']>100 and result['wireStats']['resets']==0,result['wireStats'])
        await page.click('[data-fl=leave]');await page.wait_for_function(f'{F}.room===null&&!{F}.active',timeout=15000);result['cleanup'].append({'actualUiLeaveAcknowledged':True})
        check('no_frontline_runtime_errors',not any(x['type']=='pageerror' or 'frontline' in x['text'].lower() for x in logs),logs)
        result['functionalPass']=True
    except BaseException as e:
        result['functionalPass']=False;result['failure']={'type':type(e).__name__,'message':str(e),'traceback':traceback.format_exc()}
        if page:
            try:result['failureState']=await probe()
            except BaseException as nested:result['failureProbeError']=str(nested)
    finally:
        if page:
            try:
                wire.extend(await page.evaluate('window.__serviceDecoded||[]'))
                if await page.evaluate(f'!!{F}?.room'):
                    await page.evaluate("window.__serviceQaLeft=false;__tf.net.on('frontline',m=>{if(m.message.op==='left')window.__serviceQaLeft=true});__tf.net.send({t:'frontline',version:1,command:{op:'leave'}})")
                    await page.wait_for_function('window.__serviceQaLeft',timeout=15000);result['cleanup'].append({'actualProtocolLeaveAcknowledged':True})
            except BaseException as e:result['cleanup'].append({'error':str(e)})
        if browser:await browser.close()
        await p.stop();result['logs']=logs;result['finishedAtUnix']=time.time();save();(out/'wire.json').write_text(json.dumps(wire,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'functionalPass':result.get('functionalPass'),'checks':{k:v['pass'] for k,v in result['checks'].items()},'capturePass':None,'failure':result.get('failure',{}).get('message')},ensure_ascii=False),flush=True)
    return result.get('functionalPass',False)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('url');p.add_argument('--out',type=Path,default=ROOT/'handoff/tests/out/frontline-air-service-browser-20261025');p.add_argument('--page-provenance',type=Path,default=ROOT/'handoff/tests/out/frontline-air-service-browser-20261025/page-provenance.json');a=p.parse_args();raise SystemExit(0 if asyncio.run(run(a.url,a.out,a.page_provenance)) else 1)

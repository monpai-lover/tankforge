#!/usr/bin/env python3
"""Real production UI/WebGL + current Rust server verification, ground phase only.

The caller must start a source-matched tg-server with the freshly generated dev
page. This test never starts/builds the backend and never changes accepted state.
Only two deliberately invalid control messages are injected through the real WS.
"""
import argparse
import asyncio
import hashlib
import json
import math
import time
import traceback
import runpy
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--js-flags=--max-old-space-size=1500']
F = 'window.__tf.G.frontline'
GEOMETRY_PROBE = runpy.run_path(str(Path(__file__).with_name('frontline-browser-view.py')))['PROBE']


async def run(url, out, skip_captures=False):
    out.mkdir(parents=True, exist_ok=True)
    result = {'purpose': 'actual browser/native ground-frontline integration',
              'url': url, 'startedAtUnix': time.time(), 'checks': {}, 'errors': {},
              'fixture': {'language':'zh-CN / tankforge.lang=zh','quality':'low SwiftShader WebGL2',
                          'coldBootLimit':'Legacy garage thumbnails paused before actual entry; normal full-roster startup/performance remains unverified.'},
              'scope': {'aircraft': 'pending', 'infantry': 'pending',
                        'airportServices': 'pending', 'fullTaiwanRuntime': 'pending'}}
    result['captureStatus']='explicitly_skipped' if skip_captures else 'attempted'
    result['fixture']['inactiveClientRendering']='Inactive observer rendering is paused during player actions; native simulation, decoded frames and input heartbeat remain live. This is not dual-GPU throughput acceptance.'
    browsers, pages, frames, wire, logs = [], {}, {}, {}, {}

    def save():
        (out/'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')

    def check(name, condition, detail=None):
        result['checks'][name] = {'pass': bool(condition), 'detail': detail}
        save()
        if not condition:
            raise AssertionError(name)

    def attach(page, name):
        frames[name], wire[name], logs[name] = {}, [], []
        def console(message):
            if message.type in ['error', 'warning'] and len(logs[name]) < 100:
                logs[name].append({'type': message.type, 'text': message.text[:2000]})
        page.on('console', console)
        page.on('pageerror', lambda error: logs[name].append({'type':'pageerror','text':str(error)[:2000]}) if len(logs[name]) < 100 else None)
        def socket(ws):
            def message(payload, direction):
                try:
                    value = json.loads(payload)
                except (ValueError, TypeError):
                    return
                if value.get('t') != 'frontline':
                    return
                content = value.get('message', value.get('command', {}))
                op = content.get('op')
                if direction == 'received' and op == 'frame':
                    frames[name][content['tick']] = content
                    while len(frames[name]) > 100:
                        del frames[name][min(frames[name])]
                    events = content.get('events', [])
                    if events:
                        wire[name].append({'direction':direction,'op':'events','tick':content['tick'],'events':events})
                elif len(wire[name]) < 2000:
                    wire[name].append({'direction':direction,'atMonotonicMs':time.perf_counter()*1000,'value':value})
            ws.on('framesent', lambda payload: message(payload, 'sent'))
            ws.on('framereceived', lambda payload: message(payload, 'received'))
        page.on('websocket', socket)

    async def boot(p, name):
        browser = await p.chromium.launch(headless=True, args=ARGS)
        browsers.append(browser)
        page = await browser.new_page(viewport={'width':1080,'height':720}, device_scale_factor=1, locale='zh-CN')
        pages[name] = page; attach(page, name)
        await page.add_init_script("localStorage.setItem('tankforge.lang','zh');localStorage.setItem('tankforge.quality.v1','low')")
        await page.add_init_script("""window.__qaInputTrace=[];for(const type of ['keydown','keyup','blur','focus','visibilitychange'])window.addEventListener(type,e=>{const code=e.code,target=e.target?.tagName;setTimeout(()=>{if(window.__qaInputTrace.length<300)window.__qaInputTrace.push({type,code,target,atMs:performance.now(),focus:document.hasFocus(),hidden:document.hidden,active:document.activeElement?.tagName,keys:[...(window.__tf?.G?.frontline?.keys||[])]})},0)},true)""")
        print(f'PHASE {name}: navigate', flush=True)
        await page.goto(url, wait_until='load', timeout=180000)
        await page.wait_for_function("window.__tf && !document.getElementById('boot-splash')", timeout=180000)
        await page.wait_for_function(F, timeout=30000)
        # Stop the unrelated legacy garage/air-thumbnail loop. The production
        # frontline branch has its own real-time render path and ignores pause.
        await page.evaluate("__tf.pause(true);__tf.setQuality('low');window.__viewFrames=new Map();window.__qaFrames=new Map();window.__qaEvents=[];__tf.net.on('frontline',m=>{if(m.message.op==='frame'){const v=m.message;__viewFrames.set(v.tick,v.units);__qaFrames.set(v.tick,v);if(v.events.length)__qaEvents.push({direction:'received',op:'events',tick:v.tick,events:v.events});while(__viewFrames.size>240)__viewFrames.delete(__viewFrames.keys().next().value);while(__qaFrames.size>40)__qaFrames.delete(__qaFrames.keys().next().value)}})")
        await page.evaluate("window.__qaDrawEnabled=true;const frame=__tf.G.frontline.frame;__tf.G.frontline.frame=dt=>{if(window.__qaDrawEnabled)frame(dt);}")
        print(f'PHASE {name}: real UI entry', flush=True)
        await page.click('#frontline-open')
        await page.fill('#frontline-ui [data-fl=name]', f'Browser-{name}')
        await page.wait_for_function("document.querySelector('[data-fl=map]').options.length===2",timeout=15000)
        options=await page.locator('[data-fl=map] option').evaluate_all('(a)=>a.map(o=>o.value)')
        check(name+'_actual_registry_contains_korea_and_taiwan',sorted(options)==['korea','taiwan'],options)
        return page

    async def state(page):
        return await page.evaluate(f"""(()=>{{const f={F};return{{tick:f.lastTick,active:f.active,
          room:f.room,control:f.control,epoch:f.epoch,error:f.error,modelCount:f.models.size,
          units:f.units,companies:f.companies,events:f.events,keys:[...f.keys],staging:f.staging,objectives:f.objectives,mapId:f.map?.id,renderStats:f.renderStats,terrainStats:f.terrainStats}};}})()""")

    async def shot(page, name):
        if not skip_captures:
            await page.screenshot(path=str(out/f'{name}.png'), timeout=20000)

    p = await async_playwright().start()
    try:
        result['fixture']['pageProvenance'] = json.loads((out/'page-provenance.json').read_text())
        result['fixture']['serverProvenance'] = json.loads((out/'server-provenance.json').read_text())
        check('page_matches_frozen_current_source', hashlib.sha256((ROOT/'handoff/bundle/app.js.html').read_bytes()).hexdigest() == result['fixture']['pageProvenance']['currentAppSha256'] and hashlib.sha256(Path(result['fixture']['pageProvenance']['page']).read_bytes()).hexdigest() == result['fixture']['pageProvenance']['pageSha256'])
        observer = await boot(p, 'observer')
        await observer.click('#frontline-ui [data-fl=observe]')
        await observer.wait_for_function(f'{F}.active && {F}.room?.started && {F}.units.length===76', timeout=60000)
        await observer.wait_for_function(f'{F}.models.size==={F}.units.length && !{F}.error', timeout=60000)
        initial = await state(observer)
        check('solo_observer_started_sixty_combat_and_sixteen_support_native_units', initial['modelCount'] == 76 and sum(u['role']=='combat' for u in initial['units'])==60 and initial['control'] is None, {'tick':initial['tick'],'units':len(initial['units']),'models':initial['modelCount']})
        check('complete_three_front_scene_six_sources_fifteen_objectives',len(initial['staging'])==6 and len(initial['objectives'])==15 and len(initial['companies'])==6,{'staging':initial['staging'],'fronts':[c['front'] for c in initial['companies']]})
        await observer.locator('#view').hover(position={'x':260,'y':300})
        await observer.mouse.wheel(0, 5000)
        await asyncio.sleep(8)
        moved = await state(observer)
        positions = {u['unit']['unit']:u['pos'] for u in initial['units']}
        deltas = [math.hypot(u['pos'][0]-positions[u['unit']['unit']][0],u['pos'][2]-positions[u['unit']['unit']][2]) for u in moved['units'] if u['unit']['unit'] in positions]
        controls_sent = [m for m in wire['observer'] if m.get('direction')=='sent' and m.get('value',{}).get('command',{}).get('op')=='input']
        check('observer_ai_moves_without_human_vehicle_input', max(deltas,default=0) > 1 and not controls_sent, {'tickAdvance':moved['tick']-initial['tick'],'maxDistanceXZ_M':max(deltas,default=0),'inputCommands':len(controls_sent),'initialPositions':positions,'laterPositions':{u['unit']['unit']:u['pos'] for u in moved['units']}})
        check('observer_shared_terrain_probes', await observer.evaluate(f'{F}.map.sampling.validationProbes.every(p=>Math.abs({F}.heightAt(p.x,p.z)-p.height)<1e-6)'))
        await shot(observer, 'observer-overview')
        keys = await observer.evaluate(f'[...{F}.models.keys()]')
        await observer.select_option('[data-fl=follow]', keys[0])
        await observer.click('[data-fl=close]')
        await observer.locator('#view').hover(position={'x':450,'y':350})
        distance = await observer.evaluate(f'{F}.distance')
        await observer.mouse.wheel(0, math.log(45/distance)*1000)
        await observer.wait_for_function("(()=>{const f=__tf.G.frontline,m=f.models.get(f.follow);return m?.fullDetail&&m.model&&m.sim&&window.__viewFrames.has(m.tick)})()",timeout=30000)
        geometry = await observer.evaluate(GEOMETRY_PROBE)
        result['observerGeometry'] = geometry
        check('all_combat_and_support_models_have_uploaded_geometry_and_native_poses', len(geometry['allModels']) == 76 and all(m['visible'] and m['uploadedMeshes'] > 0 and m['vertices'] > 0 and ((m['visual']=='distant_lod' and m['renderOriginError'] is not None and m['renderOriginError'] < .02) or (m['visual']=='original_imported_model' and m['rootXZError'] is not None and m['rootXZError'] < 1e-5 and m['nativeOriginError'] < 1e-6)) for m in geometry['allModels']), {'visualKinds':{kind:sum(m['visual']==kind for m in geometry['allModels']) for kind in ['original_imported_model','distant_lod']},'distantWorldMatrixToleranceM':.01})
        visible_projection = all(math.isfinite(v) and v > 0 for v in geometry['screenSize']) and geometry['screenMax'][0] > 0 and geometry['screenMin'][0] < geometry['canvas'][0] and geometry['screenMax'][1] > 0 and geometry['screenMin'][1] < geometry['canvas'][1]
        check('close_follow_projects_actual_uploaded_vehicle_on_screen', visible_projection, {'distance':geometry['distance'],'projectedPixels':geometry['screenSize']})
        await shot(observer, 'observer-close-chase45')
        room_id = moved['room']['id']
        await observer.evaluate('window.__qaDrawEnabled=false')

        player = await boot(p, 'player')
        await player.click('#frontline-ui [data-fl=list]')
        await player.wait_for_function("document.querySelector('[data-fl=rooms]').textContent.includes('#'+"+str(room_id)+")", timeout=30000)
        row = player.locator('#frontline-ui [data-fl=rooms] > div').filter(has_text=f'#{room_id} ')
        await row.get_by_role('button', name='参战', exact=True).click()
        await player.wait_for_function(f'{F}.active && {F}.room?.id==={room_id}', timeout=30000)
        await player.select_option('#frontline-ui [data-fl=vehicle]', 'su_t72a')
        sources=await player.locator('[data-fl=ground-staging] option').evaluate_all('(a)=>a.map(o=>({id:o.value,disabled:o.disabled}))')
        check('three_actual_friendly_ground_sources',len(sources)==3 and all(not v['disabled'] for v in sources),sources)
        chosen=next(v['id'] for v in sources if 'WEST' in v['id'])
        await player.select_option('[data-fl=ground-staging]',chosen)
        await player.click('#frontline-ui [data-fl=deploy]')
        await player.wait_for_function(f'{F}.control && {F}.units.filter(u=>u.company==={F}.companies.find(c=>c.owner===__tf.net.id)?.id).length===10', timeout=30000)
        deployed = await state(player)
        owner = await player.evaluate('__tf.net.id')
        company = next(c for c in deployed['companies'] if c['owner'] == owner)
        check('player_company_has_ten_entities_three_platoons', len(company['units']) == 10 and [len(v) for v in company['platoons']] == [3,3,3], {'company':company['id'],'units':company['units']})
        check('chosen_west_source_bound_to_native_company',company['staging']==chosen,{'chosen':chosen,'company':company})
        reference = deployed['control']
        current = next(u for u in deployed['units'] if u['unit'] == reference)
        await player.bring_to_front()
        await player.locator('#view').click(position={'x':320,'y':360},button='right')
        await player.keyboard.down('KeyW')
        held_samples=[]
        for i in range(8):
            await asyncio.sleep(.5)
            held_samples.append(await player.evaluate(f"(()=>{{const f={F},u=f.units.find(u=>u.unit.unit===f.control?.unit);return{{atMs:performance.now(),focus:document.hasFocus(),hidden:document.hidden,active:document.activeElement?.tagName,keys:[...f.keys],unit:u?{{pos:u.pos,epoch:u.epoch,net:u.net}}:null}}}})()"))
        await player.keyboard.up('KeyW')
        await asyncio.sleep(.5)
        driven = await state(player)
        after = next(u for u in driven['units'] if u['unit'] == reference)
        sent_inputs = [m['value']['command'] for m in wire['player'] if m.get('direction')=='sent' and m.get('value',{}).get('command',{}).get('op')=='input']
        moved_xz = math.hypot(current['pos'][0]-after['pos'][0],current['pos'][2]-after['pos'][2])
        check('real_keyboard_moves_native_controlled_tank', moved_xz > .5 and any(m.get('throttle') == 1 for m in sent_inputs), {'distanceXZ_M':moved_xz,'nativeBefore':current['pos'],'nativeAfter':after['pos'],'inputMessages':len(sent_inputs),'heldSamples':held_samples,'inputs':sent_inputs[-30:]})
        await shot(player, 'player-driving')

        await player.select_option('#frontline-ui [data-fl=platoon]', '0')
        await player.click('#frontline-ui [data-order=move]')
        canvas = player.locator('#frontline-ui [data-fl=mapview]')
        await canvas.evaluate("e=>e.scrollIntoView({block:'center',inline:'nearest'})")
        await player.uncheck('[data-fl=map-follow]')
        map_click=await player.evaluate("""(()=>{const f=__tf.G.frontline,c=f.companies.find(c=>c.owner===__tf.net.id),source=f.map.staging.find(s=>s.id===c.staging),road=f.map.roads.find(r=>r.id===source.roadId),u=f.units.find(u=>u.unit.unit===f.control.unit),p=road.points.slice().sort((a,b)=>Math.abs(Math.hypot(a[0]-u.pos[0],a[2]-u.pos[2])-250)-Math.abs(Math.hypot(b[0]-u.pos[0],b[2]-u.pos[2])-250))[0],cv=document.querySelector('[data-fl=mapview]'),r=cv.getBoundingClientRect(),x=cv.width/2+(p[0]-f.mapCentre[0])/f.mapScale,z=cv.height/2+(p[2]-f.mapCentre[1])/f.mapScale;return {x:r.left+x/cv.width*r.width,y:r.top+z/cv.height*r.height,target:p,road:road.id}})()""")
        result['mapOrderTarget']=map_click
        await player.mouse.click(map_click['x'],map_click['y'])
        await player.wait_for_function("document.querySelector('[data-fl=status]').textContent.includes('接受')", timeout=15000)
        check('real_map_click_order_accepted', any(m.get('direction')=='received' and m.get('value',{}).get('message',{}).get('op')=='order_accepted' for m in wire['player']))

        before_invalid = await state(player)
        foreign = next(u for u in before_invalid['units'] if u['company'] != company['id'])
        valid = next(u for u in before_invalid['units'] if u['unit'] == reference)
        start_errors = sum(m.get('value',{}).get('message',{}).get('op')=='error' for m in wire['player'])
        for unit, epoch in [(foreign['unit'], foreign['epoch']), (reference, before_invalid['epoch']+1)]:
            command = {'op':'input','unit':unit,'epoch':epoch,'seq':900000,
                       'throttle':1,'steer':0,'brake':0,'turret_yaw':0,'gun_pitch':0,'fire':True}
            await player.evaluate('command=>__tf.net.ws.send(JSON.stringify({t:"frontline",version:1,command}))', command)
        await asyncio.sleep(.7)
        rejection_messages = [m['value']['message'] for m in wire['player'] if m.get('direction')=='received' and m.get('value',{}).get('message',{}).get('op')=='error']
        now_state = await state(player)
        current_now = next(u for u in now_state['units'] if u['unit'] == reference)
        check('foreign_ownership_and_stale_epoch_rejected_over_real_ws', len(rejection_messages) >= start_errors+2 and all(m['code']=='stale_control' for m in rejection_messages[-2:]), rejection_messages[-2:])
        check('rejected_fire_keeps_ammunition_and_control', current_now['ammo'] == valid['ammo'] and now_state['control'] == reference, {'beforeAmmo':valid['ammo'],'afterAmmo':current_now['ammo']})

        await player.locator('#view').hover(position={'x':350,'y':360})
        ammo_before = current_now['ammo']
        await player.mouse.down(button='left')
        await asyncio.sleep(1.5)
        await player.mouse.up(button='left')
        await player.wait_for_function(f'{F}.units.some(u=>u.unit.unit==={reference["unit"]} && u.ammo<{ammo_before})', timeout=15000)
        fired = await state(player)
        fired_unit = next(u for u in fired['units'] if u['unit'] == reference)
        decoded_events=await player.evaluate('window.__qaEvents')
        wire['player'].extend(decoded_events)
        own_shots = [{**e,'tick':m['tick']} for m in decoded_events if m.get('op')=='events' for e in m['events'] if e.get('kind')=='shot' and e.get('shooter')==reference]
        check('real_pointer_fire_spends_native_ammo_and_emits_native_shot', fired_unit['ammo'] < ammo_before and bool(own_shots), {'ammoBefore':ammo_before,'ammoAfter':fired_unit['ammo'],'ammoRevision':fired_unit['ammo_revision'],'nativeShot':own_shots[-1] if own_shots else None})
        await asyncio.sleep(.5)
        observer_ticks=await observer.evaluate('[...window.__qaFrames.keys()]')
        player_ticks=await player.evaluate('[...window.__qaFrames.keys()]')
        common = sorted(set(observer_ticks) & set(player_ticks))
        check('both_real_clients_receive_matching_authoritative_frame', bool(common))
        tick = common[-1];a=await observer.evaluate('(tick)=>window.__qaFrames.get(tick)',tick);b=await player.evaluate('(tick)=>window.__qaFrames.get(tick)',tick)
        result['wireStats']={name:await page.evaluate('__tf.net.frontlineWire') for name,page in pages.items()}
        check('both_clients_use_real_binary_full_and_deltas',all(v['version']==2 and v['full']>=1 and v['delta']>=10 and v['resets']==0 for v in result['wireStats'].values()),result['wireStats'])
        team=b['intel']['team'];fields=['battle','tick','readiness']
        own_state=all(a[k]==b[k] for k in fields) and b['units']==[u for u in a['units'] if u['team']==team] and b['companies']==[u for u in a['companies'] if u['team']==team]
        enemy_index=1 if team=='blue' else 0
        private_fields=['ammo','ammo_revision','damage','caps','company','controller','epoch','support_task','support_order_seq']
        public_clean=all(not any(k in u for k in private_fields) for u in b['intel']['visible_ground'])
        objectives_ok=all(v['presence'][enemy_index] is None and all(v[k]==truth[k] for k in v if k!='presence') for v,truth in zip(b['objectives'],a['objectives']))
        check('same_tick_authorized_native_state_matches_observer_and_enemy_private_state_is_absent',own_state and public_clean and objectives_ok,{'tick':tick,'fields':fields,'observerUnitCount':len(a['units']),'ownUnitCount':len(b['units']),'detectedEnemies':len(b['intel']['visible_ground'])})
        (out/'matching-native-frame.json').write_text(json.dumps(a,ensure_ascii=False,indent=2)+'\n')
        await shot(player, 'player-native-fire')
        await player.evaluate('window.__qaDrawEnabled=false')
        await observer.evaluate('window.__qaDrawEnabled=true')
        await observer.wait_for_function("(()=>{const f=__tf.G.frontline,m=f.models.get(f.follow);return m?.fullDetail&&m.model&&m.sim&&window.__viewFrames.has(m.tick)})()",timeout=30000)
        await shot(observer, 'observer-shared-battle')
        result['room'] = room_id
        result['final'] = {name:{k:s[k] for k in ['tick','active','modelCount','control','error','renderStats','terrainStats']} for name,s in [('observer',await state(observer)),('player',await state(player))]}
        check('no_frontline_client_runtime_errors', not any(log['type']=='pageerror' or 'frontline' in log['text'].lower() for rows in logs.values() for log in rows), logs)
        result['performanceScope'] = 'Independent raw-WS performance follows explicit QA Leave; no render clock used.'
        result['pass'] = True
    except BaseException as error:
        result['pass'] = False; result['failure'] = {'type':type(error).__name__,'message':str(error),'traceback':traceback.format_exc()}
        for name, page in pages.items():
            try:
                result.setdefault('failureState',{})[name] = await state(page)
                await shot(page, f'{name}-failure')
            except BaseException as nested:
                result.setdefault('failureCaptureErrors',{})[name] = str(nested)
    finally:
        result['cleanup'] = {}
        for name, page in reversed(list(pages.items())):
            try:
                result.setdefault('inputTraces',{})[name]=await page.evaluate('window.__qaInputTrace')
                await page.evaluate("window.__qaLeft=false;__tf.net.on('frontline',m=>{if(m.message.op==='left')window.__qaLeft=true});__tf.net.send({t:'frontline',version:1,command:{op:'leave'}})")
                await page.wait_for_function('window.__qaLeft', timeout=15000)
                result['cleanup'][name] = 'explicit_leave_acknowledged'
            except BaseException as error:
                result['cleanup'][name] = str(error)
        result['errors'] = logs
        result['finishedAtUnix'] = time.time()
        save()
        (out/'wire.json').write_text(json.dumps(wire,ensure_ascii=False,indent=2)+'\n')
        for browser in browsers:
            await browser.close()
        await p.stop()
    print(json.dumps({'pass':result.get('pass'),'checks':result['checks'],'failure':result.get('failure',{}).get('message'),'out':str(out)},ensure_ascii=False,indent=2),flush=True)
    return result.get('pass', False)


if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('url');parser.add_argument('--out',type=Path,default=ROOT/'handoff/tests/out/three-front-browser-20261025');parser.add_argument('--skip-captures',action='store_true')
    args=parser.parse_args()
    raise SystemExit(0 if asyncio.run(run(args.url,args.out,args.skip_captures)) else 1)

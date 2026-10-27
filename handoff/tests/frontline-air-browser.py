#!/usr/bin/env python3
"""One real Chromium process, actual frontline UI and accepted native aircraft.

Run only after the root agent freezes/regenerates the page and starts its matching
release server. The test never builds/starts a server or injects gameplay state.
Screenshots are optional evidence; a capture timeout cannot replace functional
results or be described as a GPU performance pass.
"""
import argparse
import asyncio
import hashlib
import json
import math
import time
import traceback
import urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[2]
F='window.__tf.G.frontline'
ARGS=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling','--disable-renderer-backgrounding',
      '--js-flags=--max-old-space-size=1500']
PROBE=r"""(()=>{
 const f=__tf.G.frontline,gl=__tf.renderer.gl,key=u=>`${u.battle}:${u.unit}:${u.life}`;
 return {atBrowserMs:performance.now(),tick:f.lastTick,room:f.room,control:f.control,epoch:f.epoch,error:f.error,
  units:f.units.map(u=>({unit:u.unit,owner:u.owner,company:u.company,pos:u.pos,ammo:u.ammo,alive:u.alive})),companies:f.companies,
  aircrafts:f.aircrafts.map(latest=>{const item=f.airModels.get(key(latest.unit)),u=item?.accepted,p=item?.plane;
   return {latest,accepted:u,tick:item?.tick,model:p?{actualClass:p.constructor.name,rootName:p.root.name,
    meshes:p.meshes.length,uploaded:p.meshes.filter(m=>gl.isBuffer(m.buf)).length,
    vertices:p.meshes.reduce((n,m)=>n+m.count,0),position:Array.from(p.cur.slice(0,3)),drawPos:p.drawPos,
    stateMatches:p.cur.every((v,i)=>v===new Float32Array(u.state)[i]),aeroMatches:p.aero.every((v,i)=>v===new Float32Array(u.aero)[i]),
    controls:p.controls.filter(c=>c.type==='roll'||c.param==='roll'||c.type==='elevon'||c.mix?.roll).map(c=>({type:c.type,param:c.param,local:Array.from(c.node.local)})),
    stores:(item.stores?.items||[]).map(s=>({id:s.id,owner:s.owner,p:s.p,count:s.count,gone:s.gone,
      visible:s.node?.visible,uploaded:!!s.node?.mesh&&gl.isBuffer(s.node.mesh.buf),
      pylonVisible:s.pylonNode?.visible,rackVisible:s.rackNode?.visible}))}:null};}),
  controlledHeight:f.control&&f.aircrafts.some(u=>key(u.unit)===key(f.control))?(()=>{const u=f.aircrafts.find(u=>key(u.unit)===key(f.control));return f.heightAt(u.pos[0],u.pos[2])})():null};
})()"""

async def run(url,out,provenance_path):
    out.mkdir(parents=True,exist_ok=True)
    result={'startedAtUnix':time.time(),'url':url,'checks':{},'captures':{},'phases':{},'cleanup':[],
      'fixture':{'browserProcesses':1,'language':'zh-CN','quality':'low SwiftShader',
        'legacyGarageOnlyPaused':True,'aircraftModels':'actual production procedural fallback; no imported aircraftModels in this bounded fixture'},
      'scope':'Local native mixed-world aircraft UI/accepted pose/input/resources only; no GPU performance, radar, guided weapons, full historical certification or240-unit claim.'}
    wire=[];logs=[];page=None;browser=None
    def save(): (out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    def check(name,ok,detail=None):
        result['checks'][name]={'pass':bool(ok),'detail':detail};save()
        if not ok:raise AssertionError(name)
    def attach_ws(ws):
        def frame(payload,direction):
            try:v=json.loads(payload)
            except (TypeError,ValueError):return
            if v.get('t')!='frontline':return
            m=v.get('message',v.get('command',{}))
            if m.get('op')=='frame':
                if not m.get('events') and m['tick']%10 and not any(a.get('controller') is not None for a in m.get('aircrafts',[])):return
                # An explicitly labelled raw protocol subset: retain aircraft
                # telemetry/events; ground has already received separate QA.
                m={k:m[k] for k in ['op','battle','tick','aircrafts','events'] if k in m}
                v={'t':'frontline','version':v['version'],'message':m,'rawFrameSubset':True}
            if len(wire)<5000:wire.append({'atMonotonicMs':time.perf_counter()*1000,'direction':direction,'value':v})
        ws.on('framesent',lambda p:frame(p,'sent'));ws.on('framereceived',lambda p:frame(p,'received'))
    async def probe():return await page.evaluate(PROBE)
    def own(s):return next(a for a in s['aircrafts'] if a['latest']['unit']==s['control'])
    async def capture(name):
        # Prior attempt2 retains the actual ReadPixels/screenshot timeout. This
        # final functional pass intentionally creates no further GPU captures.
        result['captures'][name]={'skipped':True,'reason':'No further capture after preserved attempt2 GPU timeout; this is not GPU performance validation.'}
        save()
    async def axis(key,sign):
        before=await probe();reference=before['control'];first=len(wire)
        await page.keyboard.down(key)
        try:
            condition=f"""(()=>{{const f={F},u=f.aircrafts.find(u=>u.unit.unit===f.control?.unit),k=f.control&&`${{f.control.battle}}:${{f.control.unit}}:${{f.control.life}}`,item=f.airModels.get(k);return u&&item&&f.lastTick>{before['tick']}&&item.tick===f.lastTick&&u.state[25]*{sign}>.2&&item.accepted.state[25]*{sign}>.2&&item.plane.cur[25]===Math.fround(u.state[25]);}})()"""
            await page.wait_for_function(condition,timeout=8000,polling=50)
            aligned=await probe();observed=time.perf_counter()*1000
        finally:await page.keyboard.up(key)
        sent=next((w for w in wire[first:] if w['direction']=='sent' and w['value'].get('command',{}).get('op')=='air_input' and w['value']['command']['unit']==reference and w['value']['command']['manual_roll']==sign),None)
        native=[]
        if sent:
            for w in wire[first:]:
                if w['direction']!='received' or w['atMonotonicMs']<sent['atMonotonicMs']:continue
                m=w['value'].get('message',{})
                if m.get('op')!='frame':continue
                u=next((u for u in m.get('aircrafts',[]) if u['unit']==reference),None)
                if u and u['state'][25]*sign>.2:native.append((w,m['tick'],u['state'][25]))
        timing={'actualSentInput':sent['value']['command'] if sent else None,
          'nativeStateObservedAfterSendMs':native[0][0]['atMonotonicMs']-sent['atMonotonicMs'] if native and sent else None,
          'firstObservedNativeTick':native[0][1] if native else None,
          'modelAlignedObservedAfterSendMs':observed-sent['atMonotonicMs'] if sent else None,
          'alignedNativeTick':aligned['tick'],'alignedModelTick':own(aligned)['tick'],
          'meaning':'Client observation timings on real wall clock; includes CDP/evaluation scheduling, not isolated server execution latency.'}
        return own(aligned),timing,aligned
    async def show_ui():
        if await page.locator('#frontline-ui').evaluate('(e)=>e.hidden'):await page.click('#frontline-open')
    async def create(observer,name):
        await show_ui();await page.fill('[data-fl=name]',name);await page.select_option('[data-fl=era]','1986')
        await page.click('[data-fl=observe]' if observer else '[data-fl=create]')
        await page.wait_for_function(f'{F}.active&&{F}.room?.started&&{F}.units.length===20&&{F}.aircrafts.length===2',timeout=60000)
        await page.wait_for_function(f'{F}.airModels.size==={F}.aircrafts.length&&!{F}.error',timeout=60000)
    async def leave(label):
        await show_ui();await page.click('[data-fl=leave]')
        await page.wait_for_function(f'!{F}.active&&{F}.room===null',timeout=15000)
        result['cleanup'].append({'phase':label,'actualUiLeaveAcknowledged':True});save()
    async def deploy_air(spawn,loadout):
        await page.select_option('[data-fl=aircraft]','mig21')
        await page.wait_for_function("document.querySelector('[data-fl=air-loadout]').dataset.signature.startsWith('mig21:')",timeout=15000)
        await page.select_option('[data-fl=air-loadout]',str(loadout));await page.select_option('[data-fl=air-spawn]',spawn)
        await page.click('[data-fl=deploy-air]')
        await page.wait_for_function(f'{F}.aircrafts.some(u=>u.unit.unit==={F}.control?.unit&&u.aircraft==="mig21")',timeout=30000)
        await page.wait_for_function(f'{F}.airModels.has(`${{{F}.control.battle}}:${{{F}.control.unit}}:${{{F}.control.life}}`)',timeout=30000)
    p=await async_playwright().start()
    try:
        provenance=json.loads(provenance_path.read_text());result['fixture']['pageProvenance']=provenance
        expected=provenance['pageSha256']
        assert hashlib.sha256((ROOT/'handoff/bundle/app.js.html').read_bytes()).hexdigest()==provenance['currentAppSha256'],'Source changed after page preparation'
        # The60MB bounded fixture exceeds Chrome's inspector response cache.
        # Hash a separate read-only GET of the frozen local page in1MB chunks;
        # do not retain/copy the377MB baseline or depend on CDP body retention.
        served_digest=hashlib.sha256()
        with urllib.request.urlopen(url,timeout=30) as served:
            for chunk in iter(lambda:served.read(1024*1024),b''):served_digest.update(chunk)
        check('served_page_matches_frozen_source',served_digest.hexdigest()==expected,{'method':'streamed read-only localhost GET immediately before browser navigation','sha256':served_digest.hexdigest()})
        browser=await p.chromium.launch(headless=True,args=ARGS)
        page=await browser.new_page(viewport={'width':1080,'height':720},locale='zh-CN')
        await page.add_init_script("localStorage.setItem('tankforge.lang','zh');localStorage.setItem('tankforge.quality.v1','low')")
        page.on('websocket',attach_ws)
        page.on('pageerror',lambda e:logs.append({'type':'pageerror','text':str(e)}))
        page.on('console',lambda m:logs.append({'type':m.type,'text':m.text[:1500]}) if m.type in ['error','warning'] and len(logs)<100 else None)
        print('PHASE boot',flush=True)
        await page.goto(url,wait_until='load',timeout=180000)
        await page.wait_for_function("window.__tf?.G?.frontline&&!document.getElementById('boot-splash')",timeout=180000)
        await page.evaluate("__tf.pause(true);__tf.setQuality('low')")
        await page.click('#frontline-open')
        print('PHASE solo observer',flush=True)
        await create(True,'Air-observer-QA');initial=await probe();result['phases']['observerInitial']=initial
        check('observer_twenty_ground_two_native_aircraft_with_actual_uploaded_models',len(initial['units'])==20 and len(initial['aircrafts'])==2 and all(a['model'] and a['model']['actualClass']=='Aircraft' and a['model']['uploaded']>0 and a['model']['stateMatches'] and a['model']['aeroMatches'] for a in initial['aircrafts']))
        await asyncio.sleep(3);later=await probe();positions={a['latest']['unit']['unit']:a['latest']['pos'] for a in initial['aircrafts']}
        deltas=[math.hypot(a['latest']['pos'][0]-positions[a['latest']['unit']['unit']][0],a['latest']['pos'][2]-positions[a['latest']['unit']['unit']][2]) for a in later['aircrafts']]
        inputs=[w for w in wire if w['direction']=='sent' and w['value'].get('command',{}).get('op') in ['input','air_input']]
        check('native_ai_aircraft_move_without_human_control',max(deltas)>1 and not inputs,{'distanceXZ_M':deltas,'tickAdvance':later['tick']-initial['tick']})
        ref=later['aircrafts'][0]['latest']['unit'];await page.select_option('[data-fl=follow]',f"{ref['battle']}:{ref['unit']}:{ref['life']}")
        await page.click('[data-fl=close]');await asyncio.sleep(.5);await capture('observer-native-aircraft')
        await leave('observer')

        print('PHASE company to runway aircraft',flush=True)
        await create(False,'Air-company-QA');await page.select_option('[data-fl=vehicle]','su_t72a');await page.click('[data-fl=deploy]')
        await page.wait_for_function(f'{F}.control&&{F}.units.length===30',timeout=30000)
        company_before=await probe();owner=await page.evaluate('__tf.net.id');company=next(c for c in company_before['companies'] if c['owner']==owner)
        check('real_tank_company_deployed_before_aircraft',len(company['units'])==10)
        await page.locator('#view').click(position={'x':300,'y':400},button='right');await page.keyboard.down('Space');await asyncio.sleep(1.5);await page.keyboard.up('Space')
        await page.click('[data-fl=return]');await page.wait_for_function(f'{F}.control===null',timeout=20000)
        await deploy_air('runway',0);runway=await probe();air=own(runway);result['phases']['runwayInitial']=runway
        check('runway_spawn_uses_native_terrain_height_and_actual_aircraft',abs(air['latest']['pos'][1]-runway['controlledHeight']-2)<.08 and air['model']['stateMatches'] and air['model']['aeroMatches'] and air['model']['actualClass']=='Aircraft',{'height':runway['controlledHeight'],'nativePosition':air['latest']['pos'],'agl':air['accepted']['state'][35]})
        await page.locator('#view').click(position={'x':300,'y':400},button='right')
        left,left_timing,left_state=await axis('KeyA',-1);right,right_timing,right_state=await axis('KeyD',1)
        result['phases']['runwayLeft']=left_state;result['phases']['runwayRight']=right_state
        check('actual_AD_input_reaches_native_surfaces_and_original_control_nodes',left['accepted']['state'][25]<-.2 and right['accepted']['state'][25]>.2 and left['model']['controls']!=right['model']['controls'],{'leftRollControl':left['accepted']['state'][25],'rightRollControl':right['accepted']['state'][25],'leftTiming':left_timing,'rightTiming':right_timing})
        await page.select_option('[data-fl=platoon]','0');await page.click('[data-order=move]');mapview=page.locator('[data-fl=mapview]');await mapview.scroll_into_view_if_needed();box=await mapview.bounding_box();await page.mouse.click(box['x']+box['width']/2,box['y']+box['height']/2)
        await page.wait_for_function("document.querySelector('[data-fl=status]').textContent.includes('接受')",timeout=15000)
        after_order=await probe()
        check('original_company_survives_switch_and_accepts_map_order_while_flying',any(c['id']==company['id'] and len(c['units'])==10 for c in after_order['companies']) and any(w['direction']=='received' and w['value'].get('message',{}).get('op')=='order_accepted' for w in wire))
        await capture('runway-native-aircraft-company-map');await leave('company-runway')

        print('PHASE air spawn guns fuel bombs',flush=True)
        await create(False,'Air-weapon-QA');await deploy_air('air',2);start=await probe();air=own(start);reference=start['control'];before_ammo=sum(g['ammo'] for g in air['latest']['guns']);before_fuel=air['latest']['fuel']['total_kg'];before_stores=air['model']['stores'];result['phases']['airInitial']=start
        check('air_spawn_displays_actual_accepted_bomb_models',air['latest']['pos'][1]-start['controlledHeight']>500 and len(before_stores)==2 and all(s['visible'] and s['uploaded'] for s in before_stores),{'nativePosition':air['latest']['pos'],'stores':before_stores})
        await page.locator('#view').click(position={'x':300,'y':400},button='right');await page.mouse.move(300,400);await page.mouse.down(button='left');await asyncio.sleep(.7);await page.mouse.up(button='left')
        await page.wait_for_function(f"""(()=>{{const u={F}.aircrafts.find(u=>u.unit.unit==={reference['unit']});return u&&u.guns.reduce((n,g)=>n+g.ammo,0)<{before_ammo}&&u.fuel.total_kg<{before_fuel};}})()""",timeout=8000,polling=50)
        fired=await probe();flight=own(fired);ammo=sum(g['ammo'] for g in flight['latest']['guns']);fuel=flight['latest']['fuel']['total_kg']
        shots=[e for w in wire if w['direction']=='received' for e in w['value'].get('message',{}).get('events',[]) if e.get('kind')=='shot' and e.get('shooter')==reference and not e.get('detail',{}).get('store')]
        check('real_pointer_fire_spends_native_ammo_and_fuel_with_accepted_shot',ammo<before_ammo and fuel<before_fuel and bool(shots),{'ammoBefore':before_ammo,'ammoAfter':ammo,'fuelBeforeKg':before_fuel,'fuelAfterKg':fuel,'nativeShot':shots[-1] if shots else None})
        await page.keyboard.down('Space');await asyncio.sleep(.25);await page.keyboard.up('Space')
        await page.wait_for_function(f'{F}.aircrafts.find(u=>u.unit.unit==={reference["unit"]}).stores.some(s=>s.gone)',timeout=15000)
        released=await probe();release_plane=own(released);result['phases']['afterRelease']=released
        stores=release_plane['model']['stores'];gone=[s for s in stores if s['gone']]
        check('native_release_hides_only_released_bomb_and_keeps_its_pylon',bool(gone) and all(not s['visible'] and (s['pylonVisible'] is True or s['rackVisible'] is True) for s in gone) and release_plane['model']['stateMatches'],stores)
        await capture('air-native-fire-and-release');await leave('air-weapons')
        check('no_frontline_runtime_errors',not any(v['type']=='pageerror' or 'frontline' in v['text'].lower() for v in logs),logs)
        result['functionalPass']=True
    except BaseException as e:
        result['functionalPass']=False;result['failure']={'type':type(e).__name__,'message':str(e),'traceback':traceback.format_exc()}
        if page:
            try:result['failureState']=await probe()
            except BaseException as nested:result['failureProbeError']=str(nested)
    finally:
        if page:
            try:
                if await page.evaluate(f'!!{F}?.room'):
                    await page.evaluate("window.__airQaLeft=false;__tf.net.on('frontline',m=>{if(m.message.op==='left')window.__airQaLeft=true});__tf.net.send({t:'frontline',version:1,command:{op:'leave'}})")
                    await page.wait_for_function('window.__airQaLeft',timeout=15000);result['cleanup'].append({'phase':'finally','actualProtocolLeaveAcknowledged':True})
            except BaseException as e:result['cleanup'].append({'phase':'finally','error':str(e)})
        if browser:await browser.close()
        await p.stop();result['logs']=logs;result['finishedAtUnix']=time.time();actual_captures=[v for v in result['captures'].values() if not v.get('skipped')];result['capturePass']=all(v['saved'] for v in actual_captures) if actual_captures else None
        save();(out/'wire.json').write_text(json.dumps(wire,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'functionalPass':result.get('functionalPass'),'capturePass':result.get('capturePass'),'checks':{k:v['pass'] for k,v in result['checks'].items()},'failure':result.get('failure',{}).get('message'),'out':str(out)},ensure_ascii=False),flush=True)
    return result.get('functionalPass',False)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('url');p.add_argument('--out',type=Path,default=ROOT/'handoff/tests/out/frontline-air-browser-20261025');p.add_argument('--page-provenance',type=Path,default=ROOT/'handoff/tests/out/frontline-air-browser-20261025/page-provenance.json');a=p.parse_args()
    raise SystemExit(0 if asyncio.run(run(a.url,a.out,a.page_provenance)) else 1)

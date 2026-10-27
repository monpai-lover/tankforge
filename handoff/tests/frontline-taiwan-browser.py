#!/usr/bin/env python3
"""One real Taiwan UI/accepted-world browser; never builds or starts a server.

Requires an explicitly supplied frozen page, its provenance and the private
localhost:8797 server. Only observer camera fields are authored by this fixture.
Simulation entities, terrain, inventories and decoded frames are never changed.
Two optional20s captures have independent results and cannot erase functionals.
"""
import argparse
import asyncio
import collections
import hashlib
import json
import math
import time
import traceback
import urllib.parse
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
F = 'window.__tf.G.frontline'
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--js-flags=--max-old-space-size=1500']
Q = [36505.535778880185, 4882.417758686332]

STATE = r"""(()=>{const f=__tf.G.frontline;return {
 tick:f.lastTick,room:f.room,mapId:f.map?.id,mapRevision:f.mapRevision,control:f.control,error:f.error,
 units:f.units.map(u=>({unit:u.unit,role:u.role,pos:u.pos,alive:u.alive,company:u.company})),
 aircrafts:f.aircrafts.map(u=>({unit:u.unit,pos:u.pos,alive:u.alive,stateLength:u.state.length,aeroLength:u.aero.length})),
 companies:f.companies.map(c=>({id:c.id,front:c.front,staging:c.staging,units:c.units})),
 staging:f.staging,objectives:f.objectives,mapBounds:f.map?.bounds,
 wire:__tf.net.frontlineWire,decoded:window.__taiwanDecoded,
 terrainOrigin:f.terrainOrigin,terrainNodes:(f.terrain?.children||[]).map(n=>({name:n.name,count:n.mesh?.count||0}))
};})()"""

BRIDGE = r"""(q=>{
 const f=__tf.G.frontline,gl=__tf.renderer.gl,bridge=f.map.terrain.bridges.find(b=>b.id==='deck:576');
 const names=['facility:taiwan:bridge:deck:576:top','facility:taiwan:bridge:deck:576:shell','registered-water-polygons','terrain'];
 const arrays=new Map(),buffers={},old=gl.getParameter(gl.ARRAY_BUFFER_BINDING);
 try{for(const name of names){
  const n=f.terrain.children.concat(f.facilityPresentation.root.children).find(n=>n.name===name),mesh=n?.mesh,src=mesh?._src?.data;
  if(!mesh||!gl.isBuffer(mesh.buf)){buffers[name]={present:!!mesh,uploaded:false};continue;}
  gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buf);const bytes=gl.getBufferParameter(gl.ARRAY_BUFFER,gl.BUFFER_SIZE);
  if(!Number.isInteger(bytes)||bytes<=0||bytes%52){buffers[name]={uploaded:true,bytes,validStride:false};continue;}
  const a=new Float32Array(bytes/4);gl.getBufferSubData(gl.ARRAY_BUFFER,0,a);arrays.set(name,a);
  let finite=true,sourceMatches=src?.length===a.length,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<a.length;i++){if(!Number.isFinite(a[i]))finite=false;if(sourceMatches&&a[i]!==src[i])sourceMatches=false;if(i%13<3){const k=i%13;min[k]=Math.min(min[k],a[i]);max[k]=Math.max(max[k],a[i]);}}
  buffers[name]={uploaded:true,bytes,vertices:mesh.count,validStride:a.length===mesh.count*13,finite,sourceFloat32:Object.prototype.toString.call(src)==='[object Float32Array]',sourceMatches,min,max,polygonOffset:n.polygonOffset||null};
 }}finally{gl.bindBuffer(gl.ARRAY_BUFFER,old);}
 const key=p=>p.map(Math.fround).join(','),vertices=a=>{const s=new Set();if(a)for(let i=0;i<a.length;i+=13)s.add(key([a[i],a[i+1],a[i+2]]));return s;};
 const tops=vertices(arrays.get(names[0])),shells=vertices(arrays.get(names[1]));
 const expected=bridge.jointGeometry.triangles.flatMap(t=>[[t[0],t[1]],[t[2],t[3]],[t[4],t[5]]]);
 const jointMissingTop=expected.filter(([x,z])=>!tops.has(key([x,f.heightAt(x,z),z])));
 const jointMissingBottom=expected.filter(([x,z])=>!shells.has(key([x,f.heightAt(x,z)-bridge.deckThickness,z])));
 const ringInside=(p,r)=>{let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;};
 const contains=(p,a)=>ringInside(p,a.ring)&&!(a.holes||[]).some(r=>ringInside(p,r));
 const waters=f.map.terrain.waterAreas.filter(a=>contains(q,a));
 const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const insideTri=(p,a,b,c)=>{if(Math.abs(cross(a,b,c))<=1e-8)return false;const d=[cross(a,b,p),cross(b,c,p),cross(c,a,p)];return d.every(x=>x>=-1e-8)||d.every(x=>x<=1e-8);};
 let maxTopCanonicalError=0,terrainTrianglesCoveringWetQ=0;
 const top=arrays.get(names[0]);if(top)for(let i=0;i<top.length;i+=13)maxTopCanonicalError=Math.max(maxTopCanonicalError,Math.abs(top[i+1]-f.heightAt(top[i],top[i+2])));
 const terrain=arrays.get(names[3]);if(terrain)for(let i=0;i<terrain.length;i+=39)if(insideTri(q,[terrain[i],terrain[i+2]],[terrain[i+13],terrain[i+15]],[terrain[i+26],terrain[i+28]]))terrainTrianglesCoveringWetQ++;
 return {tick:f.lastTick,terrainOrigin:f.terrainOrigin,camera:{follow:f.follow,focus:f.focus,yaw:f.yaw,pitch:f.pitch,distance:f.distance},
  bridge:{id:bridge.id,halfWidth:bridge.halfWidth,deckThickness:bridge.deckThickness,roadbedSegments:bridge.roadbedSegments,sourceStatus:bridge.sourceStatus,jointSource:bridge.jointGeometry.source,jointPolygons:bridge.jointGeometry.polygons.length,jointTriangles:bridge.jointGeometry.triangles.length},
  buffers,sourceJointVertices:expected.length,jointMissingTop,jointMissingBottom,maxTopCanonicalError,terrainTrianglesCoveringWetQ,
  failurePoint:{xz:q,canonicalHeight:f.heightAt(...q),insideExplicitJoint:bridge.jointGeometry.polygons.some(p=>contains(q,p)),registeredWaters:waters.map(w=>({id:w.id,level:w.level,source:w.source.kind}))},
  numericalTolerance:'0.025m only for re-sampling canonical Y at uploaded Float32 X/Z; explicit authored joint XYZ vertices and thickness use exact Float32 keys.'};
})"""


def digest_file(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def digest_get(url):
    h = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=30) as response:
        for chunk in iter(lambda: response.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


async def run(args):
    if (args.out / 'result.json').exists():
        raise SystemExit('Use a new output directory; previous evidence is never overwritten')
    args.out.mkdir(parents=True, exist_ok=True)
    parsed = urllib.parse.urlsplit(args.url)
    private_server = f'ws://{parsed.hostname}:8797/ws'
    query = dict(urllib.parse.parse_qsl(parsed.query))
    query['server'] = private_server
    navigation_url = urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query)))
    map_url = urllib.parse.urlunsplit(parsed._replace(path='/frontline/taiwan.json', query='', fragment=''))
    result = {'startedAtUnix': time.time(), 'url': args.url, 'navigationUrl': navigation_url,
              'checks': {}, 'captures': {}, 'cleanup': {}, 'phases': {},
              'fixture': {'browserProcesses': 1, 'privateServer': private_server,
                          'quality': 'low SwiftShader WebGL2', 'language': 'zh-CN',
                          'legacyGarageOnlyPaused': True, 'nativeStateInjected': False,
                          'qaCameraOnly': ['follow', 'focus', 'yaw', 'pitch', 'distance']},
              'limitations': ['No GPU performance, WAN/mobile or arbitrary-vehicle certification.',
                              '27 prior local native route cases do not certify traversal of all40.755km.',
                              'This browser samples the shared canonical height; prior native129-probe execution is separately hash-linked.',
                              'Strategic coast is NaturalEarth1:10,000,000 cartographic scale, not10m resolution or surveyed shoreline.',
                              'Maritime transport and the full cross-strait logistics loop remain outside this test.']}
    wire, logs = [], []
    browser = page = playwright = None

    def save():
        (args.out / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')

    def check(name, ok, detail=None):
        result['checks'][name] = {'pass': bool(ok), 'detail': detail}
        save()
        if not ok:
            raise AssertionError(name)

    def attach(ws):
        def frame(payload, direction):
            if isinstance(payload, bytes):
                if len(wire) < 1000:
                    wire.append({'direction': direction, 'binaryBytes': len(payload), 'magic': payload[:4].hex()})
                return
            try:
                value = json.loads(payload)
            except (TypeError, ValueError):
                return
            if value.get('t') == 'frontline' and len(wire) < 1000:
                wire.append({'direction': direction, 'value': value})
        ws.on('framesent', lambda p: frame(p, 'sent'))
        ws.on('framereceived', lambda p: frame(p, 'received'))

    async def capture(name, locator):
        if args.skip_captures:
            result['captures'][name] = {'skipped': True, 'reason': 'Explicit --skip-captures; no pixel validation claimed.'}
            save()
            return
        started = time.monotonic()
        try:
            path = args.out / f'{name}.png'
            await locator.screenshot(path=str(path), timeout=20000)
            result['captures'][name] = {'saved': True, 'path': str(path), 'sha256': digest_file(path), 'elapsedWallSeconds': time.monotonic() - started}
        except Exception as error:
            result['captures'][name] = {'saved': False, 'timeoutMs': 20000, 'error': str(error), 'elapsedWallSeconds': time.monotonic() - started}
        save()

    try:
        provenance = json.loads(args.page_provenance.read_text())
        result['fixture']['pageProvenance'] = provenance
        result['fixture']['pageProvenanceSha256'] = digest_file(args.page_provenance)
        if args.server_provenance:
            result['fixture']['serverProvenance'] = json.loads(args.server_provenance.read_text())
        check('page_matches_frozen_current_source_and_actual_http',
              digest_file(ROOT / 'handoff/bundle/app.js.html') == provenance['currentAppSha256']
              and digest_file(Path(provenance['page'])) == provenance['pageSha256']
              and digest_get(navigation_url) == provenance['pageSha256'])
        map_bytes = args.map.read_bytes()
        map_sha = hashlib.sha256(map_bytes).hexdigest()
        data = json.loads(map_bytes)
        proof = json.loads(args.geography_proof.read_text())
        native = json.loads(args.native_proof.read_text())
        check('served_taiwan_asset_matches_source_geography_and_prior_native_proof',
              digest_get(map_url) == map_sha and proof['pass'] is True and proof['sourceMapSha256'] == map_sha
              and native['references']['taiwanMap']['sha256'] == map_sha
              and native['nativeSurfaceTestFunctions'] == {'passed': 5, 'failed': 0}
              and native['verified']['sourceHeightProbes'] == 129,
              {'mapSha256': map_sha, 'geographyProofSha256': digest_file(args.geography_proof),
               'priorNativeProofSha256': digest_file(args.native_proof),
               'nativeProofScope': 'Prior actually executed native surface cases, not a new Cargo run by this browser.'})
        manifest_path = ROOT / 'docs/air-frontline/research/taiwan-runtime-source-manifest.json'
        manifest = json.loads(manifest_path.read_text())
        source_ref = next(s for s in data['provenance']['sources'] if Path(s['file']).name == manifest_path.name)
        counts = collections.Counter(f['kind'] for f in manifest['files'])
        check('primary_GLO30_native_patches_OSM_water_and_coast_sources_preserved',
              digest_file(manifest_path) == source_ref['sha256']
              and counts['sampled_elevation'] == 23 and counts['native_focus_elevation'] == 2
              and counts['native_airfield_elevation'] == 2 and counts['water'] == 1
              and counts['roads'] == 1 and counts['land_polygon'] == 2
              and all(f['url'].startswith('https://copernicus-dem-30m.s3.amazonaws.com/') for f in manifest['files'] if f['kind'] == 'sampled_elevation'),
              {'manifestSha256': digest_file(manifest_path), 'sourceKinds': dict(counts),
               'sourceTerrainIsNotBareEarth': data['provenance']['sourceTerrainIsNotBareEarth'],
               'authoredGrading': data['provenance']['gameGradingIsAuthored']})
        playwright = await async_playwright().start()
        browser = await playwright.chromium.launch(headless=True, args=ARGS)
        page = await browser.new_page(viewport={'width': 1080, 'height': 720}, locale='zh-CN')
        await page.add_init_script("localStorage.setItem('tankforge.lang','zh');localStorage.setItem('tankforge.quality.v1','low')")
        page.on('websocket', attach)
        page.on('pageerror', lambda e: logs.append({'type': 'pageerror', 'text': str(e)}))
        page.on('console', lambda m: logs.append({'type': m.type, 'text': m.text[:1500]}) if m.type in ['error', 'warning'] and len(logs) < 100 else None)
        print('PHASE Taiwan: actual frozen page/UI', flush=True)
        await page.goto(navigation_url, wait_until='load', timeout=180000)
        await page.wait_for_function("window.__tf?.G?.frontline&&!document.getElementById('boot-splash')", timeout=180000, polling=100)
        await page.evaluate("__tf.pause(true);__tf.setQuality('low');window.__taiwanDecoded={frames:0,firstTick:null,lastTick:null};__tf.net.on('frontline',m=>{const v=m.message;if(v.op==='frame'){const q=window.__taiwanDecoded;q.frames++;q.firstTick??=v.tick;q.lastTick=v.tick;q.ground=v.units.length;q.air=v.aircrafts.length;}})")
        check('actual_UI_targets_only_private_8797', urllib.parse.urlsplit(await page.locator('[data-fl=server]').input_value()).port == 8797)
        await page.click('#frontline-open')
        await page.wait_for_function("[...document.querySelector('[data-fl=map]').options].some(o=>o.value==='taiwan')", timeout=15000, polling=100)
        await page.select_option('[data-fl=map]', 'taiwan')
        await page.select_option('[data-fl=era]', '1986')
        await page.fill('[data-fl=name]', 'Taiwan-source-QA')
        await page.click('[data-fl=observe]')
        await page.wait_for_function(f'{F}.active&&{F}.room?.started&&{F}.room.map==="taiwan"&&{F}.units.length===76&&{F}.aircrafts.length===2', timeout=60000, polling=100)
        initial = await page.evaluate(STATE)
        result['phases']['initial'] = initial
        check('actual_taiwan_solo_observer_sixty_ground_two_air_six_sources_fifteen_objectives',
              len(initial['units']) == 76 and sum(u['role']=='combat' for u in initial['units'])==60 and len(initial['aircrafts']) == 2 and len(initial['staging']) == 6
              and len(initial['objectives']) == 15 and len(initial['companies']) == 6
              and collections.Counter(c['front'] for c in initial['companies']) == {'west': 2, 'centre': 2, 'east': 2}
              and initial['control'] is None and initial['room']['era'] == 1986)
        browser_map = await page.evaluate("""async()=>{const f=__tf.G.frontline,r=await fetch('/frontline/taiwan.json',{cache:'no-store'}),text=await r.text(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');return {httpStatus:r.status,sha256:hash,cachedParsedMapEqualsSource:JSON.stringify(JSON.parse(text))===JSON.stringify(f.map),mapRevision:f.mapRevision,roomRevision:f.room.map_revision,mapId:f.map.id,patches:f.map.terrain.patches.map(p=>({id:p.id,cellX:p.cellX,cellZ:p.cellZ,sourceStatus:p.sourceStatus})),waterAreas:f.map.terrain.waterAreas.length};}""")
        result['phases']['sourceMap'] = browser_map
        check('room_revision_browser_cache_and_served_bytes_match_exact_taiwan_asset',
              browser_map['httpStatus'] == 200 and browser_map['sha256'] == map_sha
              and browser_map['roomRevision'] == map_sha and browser_map['mapRevision'] == map_sha
              and browser_map['mapId'] == 'taiwan' and browser_map['cachedParsedMapEqualsSource']
              and len(browser_map['patches']) == 5 and browser_map['waterAreas'] == 224)
        heights = await page.evaluate("probes=>probes.map(p=>({id:p.id,source:p.pos[1],client:__tf.G.frontline.heightAt(p.pos[0],p.pos[2])}))", proof['heightProbes'])
        error = max(abs(p['client'] - p['source']) for p in heights)
        check('shared_client_sampler_matches_all129_source_and_previously_native_verified_heights',
              len(heights) == 129 and all(math.isfinite(p['client']) for p in heights) and error < 1e-6,
              {'maximumAbsoluteErrorMeters': error, 'probes': heights, 'authority': 'Client read-only canonical sampler; native run linked separately above.'})
        print('PHASE Taiwan: actual entire-theatre map and source coast', flush=True)
        await page.select_option('[data-fl=map-range]', 'theatre')
        await page.wait_for_function(f'{F}.mapBackgroundMap==={F}.map&&{F}.mapScale>1000', timeout=15000, polling=100)
        map_view = await page.evaluate("""(()=>{const f=__tf.G.frontline,c=document.querySelector('[data-fl=mapview]'),g=c.getContext('2d'),b=f.map.bounds,project=p=>[(p[0]-f.mapCentre[0])/f.mapScale+c.width/2,(p[1]-f.mapCentre[1])/f.mapScale+c.height/2],sample=p=>{const q=project(p);return {world:p,pixel:q,rgba:Array.from(g.getImageData(Math.floor(q[0]),Math.floor(q[1]),1,1).data)};};return {selection:document.querySelector('[data-fl=map-range]').value,canvas:[c.width,c.height],centre:f.mapCentre,scale:f.mapScale,bounds:b,corners:[[b.minX,b.minZ],[b.minX,b.maxZ],[b.maxX,b.minZ],[b.maxX,b.maxZ]].map(project),geography:f.map.geography,backgroundStats:f.mapBackground.stats,samples:{island:sample([63692.790417,30317.057057]),mainland:sample([-208967.809105,-137259.534867]),strait:sample([-58279.366605,-47193.972123])}};})()""")
        result['phases']['entireTheatreMap'] = map_view
        geo = map_view['geography']
        w, h = map_view['canvas']
        check('actual_entire_theatre_view_contains_full_main_island_mainland_and_source_bounds',
              map_view['selection'] == 'theatre' and geo['officialMainIslandWithinTheatre'] is True
              and geo['fullTheatreDsmSourceTilesRead'] == 23
              and all(0 <= p[0] <= w and 0 <= p[1] <= h for p in map_view['corners'])
              and map_view['backgroundStats']['areas'] == 224)
        pixels = {k: v['rgba'] for k, v in map_view['samples'].items()}
        check('actual_Canvas2D_source_coast_distinguishes_main_island_mainland_and_strait',
              pixels['island'] == pixels['mainland'] and pixels['island'] != pixels['strait']
              and all(p[3] == 255 for p in pixels.values()), pixels)
        print('PHASE Taiwan: QA observer camera at actual deck576 failure joint', flush=True)
        await page.evaluate("q=>{const f=__tf.G.frontline;f.follow=null;f.focus=[q[0],f.heightAt(...q)+1,q[1]];f.yaw=.35;f.pitch=-.55;f.distance=90;}", Q)
        origin = [math.floor(Q[0] / 750) * 750, math.floor(Q[1] / 750) * 750]
        await page.wait_for_function("origin=>{const f=__tf.G.frontline;return f.terrainOrigin?.every((v,i)=>v===origin[i])&&['facility:taiwan:bridge:deck:576:top','facility:taiwan:bridge:deck:576:shell','registered-water-polygons','terrain'].every(name=>f.terrain.children.concat(f.facilityPresentation.root.children).some(n=>n.name===name&&n.mesh?.count>0));}", arg=origin, timeout=30000, polling=100)
        bridge = await asyncio.wait_for(page.evaluate(BRIDGE, Q), timeout=45)
        result['phases']['actualBridgeBuffers'] = bridge
        check('actual_uploaded_Float32_bridge_top_shell_water_terrain_buffers_are_finite_and_source_matched',
              len(bridge['buffers']) == 4 and all(b.get('uploaded') and b.get('validStride') and b.get('finite')
              and b.get('sourceFloat32') and b.get('sourceMatches') and b.get('vertices', 0) > 0 for b in bridge['buffers'].values()), bridge['buffers'])
        check('actual_bridge_top_and_thickness_include_exact_authored_joint_without_earth_berm',
              bridge['failurePoint']['insideExplicitJoint'] and bool(bridge['failurePoint']['registeredWaters'])
              and bridge['sourceJointVertices'] == 48 and not bridge['jointMissingTop'] and not bridge['jointMissingBottom']
              and bridge['maxTopCanonicalError'] < .025 and bridge['terrainTrianglesCoveringWetQ'] == 0,
              {'sourceJointVertices': bridge['sourceJointVertices'], 'missingTop': bridge['jointMissingTop'],
               'missingBottom': bridge['jointMissingBottom'], 'maxCanonicalErrorMeters': bridge['maxTopCanonicalError'],
               'wetPoint': bridge['failurePoint'], 'terrainTrianglesCoveringWetQ': bridge['terrainTrianglesCoveringWetQ']})
        await page.wait_for_function("initial=>{const f=__tf.G.frontline;return f.lastTick>initial.tick&&f.units.some(u=>{const old=initial.units.find(a=>a.unit.unit===u.unit.unit);return old&&Math.hypot(u.pos[0]-old.pos[0],u.pos[2]-old.pos[2])>1;});}", arg=initial, timeout=15000, polling=100)
        final = await page.evaluate(STATE)
        result['phases']['final'] = final
        input_commands = [v['value'].get('command') for v in wire if v.get('direction') == 'sent' and v.get('value', {}).get('command', {}).get('op') in ['input', 'air_input']]
        check('real_native_AI_advances_in_decoded_binary_frames_without_observer_vehicle_input',
              final['tick'] > initial['tick'] and not input_commands and final['wire']['version'] == 2
              and final['wire']['delta'] > 0 and final['wire']['resets'] == 0 and final['decoded']['frames'] > 1,
              {'initialTick': initial['tick'], 'finalTick': final['tick'], 'wire': final['wire'], 'decoded': final['decoded'], 'inputCommands': input_commands})
        check('no_frontline_runtime_errors', not final['error'] and not any(v['type'] == 'pageerror' or 'frontline' in v['text'].lower() for v in logs), logs)
        result['functionalPass'] = True
        save()
        print('PHASE Taiwan: independent optional20s captures', flush=True)
        map_canvas = page.locator('#frontline-ui [data-fl=mapview]')
        await capture('taiwan-entire-theatre-source-map', map_canvas)
        try:
            if not args.skip_captures:
                await page.click('#frontline-ui [data-fl=close]', timeout=5000)
            await capture('taiwan-deck576-source-joint', page.locator('#view'))
        except Exception as preparation_error:
            result['captures']['taiwan-deck576-source-joint'] = {'saved': False, 'stage': 'capturePreparation', 'error': str(preparation_error)}
            save()
    except Exception as error:
        # Capture errors are handled inside capture(); genuine functional errors
        # remain false and are never erased by a later saved screenshot.
        result['functionalPass'] = False
        result['failure'] = {'type': type(error).__name__, 'message': str(error), 'traceback': traceback.format_exc()}
        if page:
            try:
                result['failureState'] = await asyncio.wait_for(page.evaluate(STATE), timeout=10)
            except Exception as nested:
                result['failureProbeError'] = str(nested)
    finally:
        if page:
            try:
                await page.evaluate("window.__taiwanLeft=false;__tf.net.on('frontline',m=>{if(m.message.op==='left')window.__taiwanLeft=true;})")
                if await page.evaluate(f'!!{F}.room'):
                    try:
                        if await page.locator('#frontline-ui').evaluate('e=>e.hidden'):
                            await page.click('#frontline-open', timeout=5000)
                        await page.click('[data-fl=leave]', timeout=5000)
                        await page.wait_for_function('window.__taiwanLeft', timeout=15000, polling=100)
                        result['cleanup']['actualUiLeaveAcknowledged'] = True
                    except Exception as ui_error:
                        result['cleanup']['uiLeaveError'] = str(ui_error)
                        await page.evaluate("__tf.net.send({t:'frontline',version:1,command:{op:'leave'}})")
                        await page.wait_for_function('window.__taiwanLeft', timeout=15000, polling=100)
                        result['cleanup']['actualProtocolLeaveAcknowledged'] = True
                else:
                    result['cleanup']['noRoomRemained'] = True
                result['cleanup']['roomCleared'] = await page.evaluate(f'{F}.room===null&&!{F}.active')
            except Exception as error:
                result['cleanup']['error'] = str(error)
        if browser:
            try:
                await asyncio.wait_for(browser.close(), timeout=30)
                result['cleanup']['browserClosed'] = True
            except Exception as error:
                result['cleanup']['browserCloseError'] = str(error)
        if playwright:
            try:
                await playwright.stop()
            except Exception as error:
                result['cleanup']['playwrightStopError'] = str(error)
        actual_captures = [c for c in result['captures'].values() if not c.get('skipped')]
        result['capturePass'] = all(c['saved'] for c in actual_captures) if actual_captures else None
        result['cleanupPass'] = result['cleanup'].get('roomCleared', False) and result['cleanup'].get('browserClosed', False)
        result['pass'] = result.get('functionalPass', False) and result['cleanupPass']
        result['booleanChecks'] = {'passed': sum(c['pass'] for c in result['checks'].values()), 'total': len(result['checks'])}
        result['logs'] = logs
        result['finishedAtUnix'] = time.time()
        save()
        (args.out / 'wire.json').write_text(json.dumps(wire, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: result.get(k) for k in ['functionalPass', 'capturePass', 'cleanupPass', 'pass', 'booleanChecks', 'failure']}, ensure_ascii=False), flush=True)
    return result['pass']


def arguments():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--url', required=True, help='Explicit http://127.0.0.1:8797/ private test page; production8787 is forbidden')
    p.add_argument('--page-provenance', type=Path, required=True)
    p.add_argument('--server-provenance', type=Path)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--map', type=Path, default=ROOT / 'data/frontline/taiwan.json')
    p.add_argument('--geography-proof', type=Path, default=ROOT / 'docs/air-frontline/research/taiwan-runtime-geography-proof.json')
    p.add_argument('--native-proof', type=Path, default=ROOT / 'docs/air-frontline/research/taiwan-runtime-native-verification-20261025.json')
    p.add_argument('--skip-captures', action='store_true')
    args = p.parse_args()
    u = urllib.parse.urlsplit(args.url)
    if u.scheme != 'http' or u.hostname not in ['localhost', '127.0.0.1'] or u.port != 8797 or u.username or u.password:
        p.error('--url must explicitly use private localhost:8797 over HTTP; no default/production server')
    return args


if __name__ == '__main__':
    raise SystemExit(0 if asyncio.run(run(arguments())) else 1)

#!/usr/bin/env python3
"""Bounded offline Chromium acceptance of the actual current flight upgrade.

Prepare with frontline-current-prepare.py --flight-upgrade-api --aircraft
mig17f,f4e,f15c,su27,a10a,su25,me262,f104g. Launch only after the root's GPU GO.
This checks visual/function paths and captures frames; it is not an FPS test,
an online authority test, or a migration of legacy vehicle contact geometry.
"""
import argparse
import asyncio
import hashlib
import json
import mmap
import re
import runpy
import subprocess
import time
import traceback
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
DEFAULT = ROOT / 'handoff/tests/out/flight-upgrade-20261025/browser'
IDS = ['mig17f', 'f4e', 'f15c', 'su27', 'a10a', 'su25', 'me262', 'f104g']
FITTED = set(IDS[:6])
ARGS = runpy.run_path(str(Path(__file__).with_name('public-air-radar-browser.py')))['ARGS']


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def verify_sources(out, manifest):
    """Verify exact prepared-source byte spans without loading all models as JSON."""
    page, app, head = Path(manifest['page']), ROOT / 'handoff/bundle/app.js.html', ROOT / 'handoff/bundle/head.html'
    assert page.resolve() == (out / 'dev.html').resolve(), 'Unexpected bounded page path'
    assert manifest['productionDeploymentAsset'] is False and manifest['nativeSimulationStateInjected'] is False
    assert manifest['retainedAircraftModels'] == IDS, 'The bounded source model list must match this runner'
    assert page.stat().st_size == manifest['pageBytes'] < 100 * 1024 * 1024
    assert sha(page) == manifest['pageSha256'], 'Prepared page changed'
    assert sha(app) == manifest['currentAppSha256'], 'Current app changed after preparation'
    assert sha(head) == manifest['headSha256'], 'Current head changed after preparation'
    asset = out / 'data.frontline.current.line'
    scanner = out / 'jscan'
    assert scanner.is_file() and asset.is_file(), 'Missing bounded source/index helper from preparation'
    rows = subprocess.run([str(scanner), str(asset), '2'], capture_output=True, text=True, timeout=30, check=True).stdout
    spans = []
    for line in rows.splitlines():
        match = re.match(r'^( *)(\S+) ([{\[]) (\d+)\.\.(\d+)', line)
        if match:
            spans.append((len(match[1]), match[2], int(match[4]), int(match[5]) + 1))
    parents = {key: (start, end) for depth, key, start, end in spans if depth == 0}
    checked = {}
    with asset.open('rb') as source, mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ) as content:
        for name, expected in manifest['retainedSourceBytes'].items():
            parent, child = name.split('.', 1)
            low, high = parents[parent]
            matches = [(start, end) for depth, key, start, end in spans if depth == 2 and key == child and low < start < end < high]
            assert len(matches) == 1, 'Missing/ambiguous source span ' + name
            start, end = matches[0]
            digest = hashlib.sha256(content[start:end]).hexdigest()
            assert end - start == expected['bytes'] and digest == expected['sha256'], 'Source byte identity mismatch ' + name
            checked[name] = {'bytes': end - start, 'sha256': digest}
    assert all('aircraftModels.' + model in checked for model in IDS)
    helpers = ['engine-layout-helper.js', 'mechanism-fit-runtime.js', 'mechanism-view.js']
    return {'page': str(page), 'pageSha256': sha(page), 'app': str(app), 'appSha256': sha(app),
            'headSha256': sha(head), 'retainedSourceBytes': checked,
            'helperSha256': {name: sha(ROOT / 'handoff/tools/aircraft_performance' / name) for name in helpers},
            'runnerSha256': {name: sha(Path(__file__).with_suffix(suffix)) for name, suffix in [('python', '.py'), ('javascript', '.js')]}}


async def run(out, total_timeout):
    out = out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    result = {'startedAtUnix': time.time(), 'scope': __doc__, 'checks': {}, 'phases': {}, 'captures': {},
              'gpuPerformanceCertification': False, 'onlineAuthorityCertification': False}
    logs, browser, page = [], None, None

    def save():
        (out / 'browser-result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        (out / 'browser-console.json').write_text(json.dumps(logs, ensure_ascii=False, indent=2) + '\n')

    def check(name, passed, detail=None):
        result['checks'][name] = {'pass': bool(passed), 'detail': detail}
        save()
        if not passed:
            raise AssertionError(name)

    async def evaluate(expression, argument=None, timeout=90):
        operation = page.evaluate(expression) if argument is None else page.evaluate(expression, argument)
        value = await asyncio.wait_for(operation, timeout=timeout)
        if any(line['type'] == 'pageerror' for line in logs):
            raise AssertionError('A real page error occurred; see browser-console.json')
        return value

    async def capture(name):
        started = time.monotonic()
        try:
            target = out / (name + '.png')
            await asyncio.wait_for(page.screenshot(path=str(target), timeout=8000), timeout=10)
            result['captures'][name] = {'pass': True, 'path': str(target), 'seconds': time.monotonic() - started}
        except Exception as error:
            result['captures'][name] = {'pass': False, 'error': str(error), 'seconds': time.monotonic() - started}
        save()

    def valid_geometry(probe):
        return (probe['core'] == 213 and probe['imported'] and probe['finiteState'] and not probe['crashed']
                and probe['stateLength'] == 80 and probe['meshCount'] > 0
                and probe['gpuBuffers'] == probe['meshCount']
                and not probe['contextLost'] and not probe['rendererLost']
                and all(mesh['finite'] and mesh['vertexArray'] and mesh['uploadedBytes'] == mesh['expectedBytes'] for mesh in probe['meshes'])
                and probe['sourcePreserved'] and not probe['coarseDuplicates'])

    async def phases():
        nonlocal browser, page
        manifest = json.loads((out / 'page-provenance.json').read_text())
        result['manifest'] = manifest
        result['sourceVerification'] = verify_sources(out, manifest)
        check('frozen_current_source_hashes', True, result['sourceVerification'])
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True, args=ARGS)
            page = await browser.new_page(viewport={'width': 1080, 'height': 720}, locale='zh-CN')
            page.set_default_timeout(20000)
            page.on('console', lambda message: logs.append({'type': message.type, 'text': message.text[:3000]}))
            page.on('pageerror', lambda error: logs.append({'type': 'pageerror', 'text': str(error)}))
            async def no_socket(socket):
                logs.append({'type': 'qa-network-block', 'text': 'Offline fixture blocked a WebSocket before connection'})
                await socket.close()
            await page.route_web_socket('**', no_socket)
            await page.route(re.compile(r'^https?://'), lambda route: route.abort())
            await page.add_init_script("localStorage.setItem('tankforge.lang','zh');localStorage.setItem('tankforge.quality.v1','low');localStorage.removeItem('tf.airKeys');")
            await page.goto(Path(manifest['page']).as_uri(), wait_until='load', timeout=120000)
            await page.wait_for_function('!!window.__tf&&!!window.__tfx&&!document.getElementById("boot-splash")', timeout=120000)
            await evaluate(Path(__file__).with_suffix('.js').read_text())
            boot = await evaluate('__flightUpgradeQa.ready()')
            result['phases']['boot'] = boot
            check('actual_core213_models_and_upgrade_helpers', boot['core'] == 213 and set(boot['models']) == set(IDS)
                  and bool(boot['engineRevision']) and bool(boot['mechanismRevision']) and boot['mechanismView'] and not boot['online'], boot)
            start = await evaluate('__flightUpgradeQa.start()')
            check('actual_offline_range', start['mode'] == 'battle' and not start['online'], start)
            for model in IDS:
                print('PHASE ' + model, flush=True)
                initial = await evaluate('(id)=>__flightUpgradeQa.enter(id)', model)
                phase = result['phases'][model] = {'initial': initial}
                check(model + '_actual_source_geometry_and_all_GPU_buffers', valid_geometry(initial), initial)
                engine = initial['engine']
                if model in FITTED:
                    check(model + '_actual_fitted_engine_and_mechanism_guard', engine['layout'] and engine['mechanismFit']
                          and engine['engineCount'] > 0 and engine['exactUploadedTail'] and all(row['finite'] for row in engine['engines']), engine)
                else:
                    check(model + '_authored_source_internals_preserved', engine['layoutGuarded'] and initial['sourceTriangles'] > 0
                          and bool(initial['source']) and all(row['dataIdentity'] and row['gpu'] for row in initial['source']), initial['source'])
                await page.keyboard.press('g')
                gear = await evaluate('__flightUpgradeQa.advanceGear(1)')
                phase['gearDown'] = gear
                check(model + '_actual_gear_input_actuator_and_source_pose', abs(gear['end'] - 1) < 1e-5
                      and gear['travelled'] and gear['controlsMoved'] and gear['finiteControls'] and gear['finiteState'] and not gear['crashed'], gear)
                await evaluate('__flightUpgradeQa.surfaceBefore("roll")')
                await page.keyboard.down('d')
                try:
                    roll = await evaluate('__flightUpgradeQa.surfaceAfter(0.3)')
                finally:
                    await page.keyboard.up('d')
                phase['roll'] = roll
                check(model + '_actual_roll_input_moves_source_surface', roll['count'] > 0 and roll['changed'] and roll['finite']
                      and roll['finiteState'] and not roll['crashed'] and abs(roll['acceptedAfter'][1]) > 1e-4, roll)
                await evaluate('__flightUpgradeQa.surfaceBefore("flap")')
                await page.keyboard.press('f')
                flap = await evaluate('__flightUpgradeQa.surfaceAfter(1.2)')
                phase['flap'] = flap
                check(model + '_actual_flap_input_moves_source_surface', flap['count'] > 0 and flap['changed'] and flap['finite']
                      and flap['finiteState'] and not flap['crashed'] and abs(flap['flapAfter'] - 0.25) < 1e-5, flap)
                await evaluate('__flightUpgradeQa.freezeToggle(true)')
                await page.keyboard.down('o')
                opened = await evaluate('__flightUpgradeQa.afterToggle()')
                phase['mechanismsOnly'] = opened
                probe = opened['probe']
                check(model + '_O_hides_actual_skin_without_native_mutation', opened['actual'] is True and opened['unchanged']
                      and probe['collectedSkin'] == [] and not probe['generatedStructureCollected'] and valid_geometry(probe), opened)
                retained_gears = [row for row in probe['gearRecords'] if row['keep'] or row['hasSubset']]
                check(model + '_O_retains_engine_and_actual_gear', bool(retained_gears) and any(row['collected'] for row in retained_gears)
                      and (probe['engine'].get('internalCollected', False) if model in FITTED else any(row['collected'] for row in probe['source'])),
                      {'engine': probe['engine'], 'gears': retained_gears})
                check(model + '_mechanism_subsets_are_render_only', all(row['hitboxDisabled'] and row['subsetFlag'] and row['gpu']
                      and row['collected'] and not row['originalCollected'] and 0 < row['vertices'] < row['originalVertices'] for row in probe['subsets'])
                      and (model != 'mig17f' or len(probe['subsets']) >= 2), probe['subsets'])
                await evaluate('__flightUpgradeQa.camera([11,4,12])')
                await capture(model + '-O-mechanisms')
                await evaluate('__flightUpgradeQa.freezeToggle(false)')
                await page.keyboard.up('o')
                released = await evaluate('__flightUpgradeQa.afterToggle()')
                phase['released'] = released
                check(model + '_release_restores_full_skin_and_controls', released['actual'] is False and released['unchanged']
                      and released['restoredDrawMembership'] and bool(released['probe']['collectedSkin'])
                      and released['probe']['sourcePreserved'] and valid_geometry(released['probe']), released)
                await evaluate('__flightUpgradeQa.camera([11,4,12])')
                await capture(model + '-exterior-restored')
                await evaluate('__flightUpgradeQa.restoreCamera()')
                save()
            check('no_real_page_errors', not any(row['type'] == 'pageerror' for row in logs), logs)
            final_verification = verify_sources(out, manifest)
            check('source_hashes_remain_frozen_at_completion', final_verification == result['sourceVerification'])
            result['cleanup'] = await evaluate('__flightUpgradeQa.cleanup()')
            check('offline_cleanup', not result['cleanup']['online'] and set(result['cleanup']['spawned']) == set(IDS), result['cleanup'])

    try:
        await asyncio.wait_for(phases(), timeout=total_timeout)
    except BaseException as error:
        result['failure'] = {'type': type(error).__name__, 'message': str(error), 'trace': traceback.format_exc()}
        if page and not page.is_closed():
            try:
                result['failureState'] = await asyncio.wait_for(page.evaluate('window.__flightUpgradeQa?.probe()'), timeout=5)
            except Exception as state_error:
                result['failureStateError'] = str(state_error)
    finally:
        if page and not page.is_closed() and 'cleanup' not in result:
            try:
                result['cleanup'] = await asyncio.wait_for(page.evaluate('window.__flightUpgradeQa?.cleanup()'), timeout=8)
            except Exception as cleanup_error:
                result['cleanupError'] = str(cleanup_error)
        if browser:
            try:
                await asyncio.wait_for(browser.close(), timeout=15)
                result['browserClosed'] = True
            except Exception as close_error:
                result['browserCloseError'] = str(close_error)
        result['functionalPass'] = 'failure' not in result and bool(result['checks']) and all(row['pass'] for row in result['checks'].values())
        result['capturePass'] = len(result['captures']) == len(IDS) * 2 and all(row['pass'] for row in result['captures'].values())
        result['finishedAtUnix'] = time.time()
        save()
    print(json.dumps({'functionalPass': result['functionalPass'], 'checks': len(result['checks']), 'capturePass': result['capturePass'],
                      'captures': len(result['captures']), 'result': str(out / 'browser-result.json')}, ensure_ascii=False))
    return 0 if result['functionalPass'] and result['capturePass'] else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=DEFAULT)
    parser.add_argument('--timeout', type=float, default=900, help='Bounded total wall time in seconds')
    arguments = parser.parse_args()
    if not 30 <= arguments.timeout <= 1800:
        parser.error('--timeout must be between30 and1800 seconds')
    if (arguments.out / 'browser-result.json').exists():
        parser.error('Existing browser proof is preserved; prepare a fresh output directory for another run')
    raise SystemExit(asyncio.run(run(arguments.out, arguments.timeout)))

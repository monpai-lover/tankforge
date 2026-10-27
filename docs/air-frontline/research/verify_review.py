#!/usr/bin/env python3
"""Check the actual offline review UI; this does not test live game integration."""
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = ROOT/'handoff/tests/out/air-frontline'


def verify():
    OUT.mkdir(parents=True, exist_ok=True)
    errors = []; checks = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1440, 'height': 1080})
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto((HERE.parent/'korea-review.html').as_uri())
        page.wait_for_function('window.__frontlineStudy && document.querySelector("#map").width>0')
        assert page.evaluate('window.__frontlineStudy.state.lane') == 'centre'
        assert not page.locator('[data-order=attack]').is_disabled()
        page.locator('[data-platoon="2"]').click()
        page.locator('[data-order=attack]').click()
        rectangle = page.locator('#map').bounding_box()
        page.locator('#map').click(position={'x': rectangle['width']*.5, 'y': rectangle['height']*.5})
        assert page.evaluate('window.__frontlineStudy.state.orders["blue:centre"][2].kind') == 'attack'
        assert page.evaluate('Object.keys(window.__frontlineStudy.state.orders["blue:centre"]).length') == 1
        checks.append('Actual map pointer gives one selected platoon an intent')
        page.locator('[data-role=air]').click()
        assert page.locator('#company-preview').is_visible()
        assert not page.locator('[data-order=follow]').is_visible()
        assert page.evaluate('window.__frontlineStudy.state.orders["blue:centre"][2].kind') == 'attack'
        page.locator('[data-order=defend]').click()
        page.locator('#map').click(position={'x': rectangle['width']*.5, 'y': rectangle['height']*.5})
        assert page.evaluate('window.__frontlineStudy.state.orders["blue:centre"][2].kind') == 'defend'
        checks.append('Flying role retains company intent and allows simplified new map order')
        page.locator('#team-preview').select_option('red')
        assert page.evaluate('window.__frontlineStudy.state.orders["red:centre"] || null') is None
        page.locator('[data-role=ground]').click()
        page.locator('[data-platoon=all]').click()
        page.locator('[data-order=follow]').click()
        assert page.evaluate('Object.keys(window.__frontlineStudy.state.orders["red:centre"]).length') == 3
        assert page.evaluate('window.__frontlineStudy.state.orders["blue:centre"][2].kind') == 'defend'
        checks.append('Team intents are isolated; all three AI platoons can receive ground follow intent')
        page.locator('#team-preview').select_option('blue')
        assert '1.2 km' in page.locator('#staging-note').inner_text()
        page.screenshot(path=str(OUT/'combined-r4-ground.png'))
        page.locator('[data-lane=west]').click()
        assert page.locator('[data-order=attack]').is_disabled()
        assert '未连通' in page.locator('#route-rows').inner_text()
        assert '没有已连通' in page.locator('#staging-note').inner_text()
        checks.append('Missing west source path disables candidate deployment/command preview instead of inventing a connector')
        page.locator('[data-lane=centre]').click()
        slider = page.locator('#sliders input').nth(1)
        slider.evaluate('(element)=>{element.value="0";element.dispatchEvent(new Event("input"));}')
        assert page.locator('[data-order=attack]').is_disabled()
        slider.evaluate('(element)=>{element.value="2";element.dispatchEvent(new Event("input"));}')
        assert not page.locator('[data-order=attack]').is_disabled()
        checks.append('Terminal front has no invented off-map deployment; restored interior front regains candidate')
        page.locator('[data-role=air]').click()
        page.evaluate('window.__frontlineStudy.show(window.__frontlineStudy.data.proposal.airfields.find(f=>f.id==="B-W"))')
        assert page.locator('#profile').is_visible()
        assert '蓝线' in page.locator('#profile-note').inner_text()
        assert page.locator('#taiwan-options tr').count() >= 4
        assert '完整本岛' in page.locator('#taiwan-options tr').first.inner_text()
        assert page.locator('#era-options tr').count() == 6
        page.screenshot(path=str(OUT/'combined-r4-air.png'))
        checks.append('Native field profile, source-derived era rows and Taiwan extent comparison display')
        page.set_viewport_size({'width': 390, 'height': 844})
        page.wait_for_timeout(150)
        overflow = page.evaluate('document.documentElement.scrollWidth>innerWidth')
        assert not overflow
        page.screenshot(path=str(OUT/'combined-r4-mobile.png'), full_page=True)
        checks.append('Mobile390px has no horizontal overflow')
        browser.close()
    assert not errors, errors
    report = {'scope': 'Offline combined-mode design preview; no live AI/native combat/network/role-switch implementation proof',
              'desktop': [1440, 1080], 'mobile': [390, 844], 'errors': errors,
              'mobileOverflow': overflow, 'checks': checks}
    (HERE/'combined-review-validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    (OUT/'combined-r4-verified.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    verify()

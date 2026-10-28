#!/usr/bin/env python3
"""Run the controlled actual cloud/noise/dome/sky shader fixture, not the game."""
import argparse,asyncio,json,time
from pathlib import Path
from playwright.async_api import async_playwright

async def run(args):
    args.out.mkdir(parents=True,exist_ok=False)
    result={'started':time.time(),'passed':False,'scope':'actual cloud shader fixture; not full-page flight or hardware FPS'}
    errors=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(channel='msedge',headless=True,args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        try:
            page=await browser.new_page(viewport={'width':1120,'height':1100})
            page.on('pageerror',lambda error:errors.append(str(error)))
            await page.goto(args.input.resolve().as_uri())
            await page.wait_for_function('!!window.__TF_R86_CLOUD_GATE__',timeout=120000)
            result['gate']=await page.evaluate('__TF_R86_CLOUD_GATE__')
            await page.screenshot(path=str(args.out/'cloud-comparison.png'),full_page=True)
            result['passed']=bool(result['gate']['passed'] and not errors)
        except Exception as error:result['failure']=str(error)
        finally:await browser.close()
    result['errors']=errors;result['finished']=time.time()
    (args.out/'receipt.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'passed':result['passed'],'checks':result.get('gate',{}).get('checks'),'failure':result.get('failure') or result.get('gate',{}).get('failure'),'errors':errors},ensure_ascii=False))
    return result['passed']

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--input',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    raise SystemExit(0 if asyncio.run(run(parser.parse_args())) else 1)

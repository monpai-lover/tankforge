#!/usr/bin/env python3
"""Actual exported GLSL compile/readback and synchronized water comparison.
This controlled fixture is not the final game's map test or a hardware FPS test.
"""
import argparse,asyncio,json,time,traceback
from pathlib import Path
from playwright.async_api import async_playwright

async def run(a):
    a.out.mkdir(parents=True,exist_ok=False)
    result={'started':time.time(),'passed':False,'scope':'actual shader fixtures; no hardware FPS or whole-game acceptance'}
    errors=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(channel='msedge',headless=True,args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        try:
            page=await browser.new_page(viewport={'width':1260,'height':1200})
            page.on('pageerror',lambda e:errors.append(str(e)))
            await page.goto((a.input/'shader-gate.html').resolve().as_uri())
            await page.wait_for_function('window.__TF_R8_SHADER_GATE__?.variants.length>=2',timeout=60000)
            result['gate']=await page.evaluate('__TF_R8_SHADER_GATE__')
            if not result['gate']['pass']:raise AssertionError('actual GLSL compile/readback failed')
            if any(f['pixel'][:3]==[3,3,3] for v in result['gate']['variants'] for f in v['fixtures']):raise AssertionError('shader gate sampled the old clear color, not rendered geometry')
            await page.screenshot(path=str(a.out/'shader-gate.png'))
            await page.goto((a.input/'comparison.html').resolve().as_uri())
            await page.wait_for_function('window.__TF_R8_SHADER_COMPARE__?.status.ready',timeout=60000)
            result['comparison']=await page.evaluate('__TF_R8_SHADER_COMPARE__.setTime(0)')
            await page.screenshot(path=str(a.out/'comparison-t0.png'))
            result['pixels']=await page.evaluate('''(()=>{
              const c=document.getElementById('compare'),g=c.getContext('webgl2'),w=c.width/2,h=c.height/3;
              const rows=[];for(let row=0;row<3;row++){
                const a=new Uint8Array(w*h*4),b=new Uint8Array(w*h*4);g.readPixels(0,row*h,w,h,g.RGBA,g.UNSIGNED_BYTE,a);g.readPixels(w,row*h,w,h,g.RGBA,g.UNSIGNED_BYTE,b);
                let sum=0,changed=0,beyondDither=0,nonblack=0;for(let i=0;i<a.length;i+=4){let d=0,max=0;for(let k=0;k<3;k++){const n=Math.abs(a[i+k]-b[i+k]);d+=n;max=Math.max(max,n);nonblack+=b[i+k]>2;}sum+=d;if(d>0)changed++;if(max>1)beyondDither++;}
                rows.push({row,changedPixels:changed,changedBeyondDither:beyondDither,meanChannelDifference:sum/(w*h*3),nonblackChannels:nonblack});
              }return{rows,glError:g.getError()};})()''')
            water,steep,near=result['pixels']['rows']
            if water['changedBeyondDither']<100 or water['nonblackChannels']<100:raise AssertionError('water did not visibly change')
            # The unchanged production composite dithers in framebuffer space,
            # so side-by-side columns can differ by one 8-bit channel step.
            if steep['changedBeyondDither'] or near['changedBeyondDither']:raise AssertionError('water patch changed terrain rendering beyond framebuffer dither')
            if result['pixels']['glError']:raise AssertionError('comparison WebGL error')
            await page.evaluate('__TF_R8_SHADER_COMPARE__.setTime(3)')
            await page.screenshot(path=str(a.out/'comparison-t3.png'))
            result['final']=await page.evaluate('__TF_R8_SHADER_COMPARE__.readback()')
            if errors:raise AssertionError('uncaught page errors')
            result['passed']=True
        except Exception as e:result['failure']={'message':str(e),'trace':traceback.format_exc()}
        finally:await browser.close()
    result['errors']=errors;result['finished']=time.time()
    (a.out/'receipt.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps(result,ensure_ascii=False));return result['passed']

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();raise SystemExit(0 if asyncio.run(run(a)) else 1)

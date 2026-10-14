# Usage: python3 pw.py page.html script.js out_prefix  -- boots page, runs async JS steps from script file.
import sys, asyncio, json, time
from playwright.async_api import async_playwright
page_path, script_path, prefix = sys.argv[1], sys.argv[2], sys.argv[3]
async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(headless=True, args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--js-flags=--max-old-space-size=2048"])
        pg = await br.new_page(viewport={"width":int(__import__("os").environ.get("VW","960")),"height":int(__import__("os").environ.get("VH","540"))})
        logs = []
        pg.on("console", lambda m: (logs.append(f"[{m.type}] {m.text}"), m.text.startswith("@@") and print(m.text, flush=True)))
        pg.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
        async def shot(name):
            await pg.screenshot(path=f"{prefix}{name}.png", timeout=180000)
            return name
        await pg.expose_function("pyShot", shot)
        t0=time.time()
        await pg.goto("file://"+page_path, wait_until="load", timeout=600000)
        await pg.wait_for_function("!document.getElementById('boot-splash')", timeout=600000)
        print("booted in", round(time.time()-t0,1), "s", flush=True)
        src = open(script_path).read()
        try:
            res = await asyncio.wait_for(pg.evaluate("async () => {" + src + "}"), timeout=float(__import__("os").environ.get("EVAL_TIMEOUT","600")))
            print("RESULT", json.dumps(res, indent=1)[:20000])
        except BaseException as e:
            print("EVAL ERROR", type(e).__name__, e)
        for l in logs[-80:]: print(l[:600])
        await br.close()
asyncio.run(main())

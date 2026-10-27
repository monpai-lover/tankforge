# Usage: python3 pw.py page.html script.js out_prefix  -- boots page, runs async JS steps from script file.
import sys, asyncio, json, time
from playwright.async_api import async_playwright
page_path, script_path, prefix = sys.argv[1], sys.argv[2], sys.argv[3]
async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(headless=True, args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--autoplay-policy=no-user-gesture-required","--js-flags=--max-old-space-size=" + __import__("os").environ.get("JSHEAP", "2048")])
        pg = await br.new_page(viewport={"width":int(__import__("os").environ.get("VW","960")),"height":int(__import__("os").environ.get("VH","540"))})
        logs = []
        pg.on("console", lambda m: (logs.append(f"[{m.type}] {m.text}"), m.text.startswith("@@") and print(m.text, flush=True)))
        pg.on("pageerror", lambda e: (logs.append(f"[pageerror] {e}"), print(f"[pageerror] {e}", flush=True)))
        async def shot(name):
            await pg.screenshot(path=f"{prefix}{name}.png", timeout=180000)
            return name
        await pg.expose_function("pyShot", shot)
        cdp = await pg.context.new_cdp_session(pg)
        async def profile(cmd):
            # pyProfile('start') / pyProfile('stop'): CPU profile, returns the top self-time functions.
            if cmd == "start":
                await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", {"interval": 500}); await cdp.send("Profiler.start"); return "started"
            prof = (await cdp.send("Profiler.stop"))["profile"]
            nodes = {n["id"]: n for n in prof["nodes"]}; self = {}
            dt = {}
            ts = prof.get("timeDeltas", []); smp = prof.get("samples", [])
            for i, sid in enumerate(smp):
                n = nodes[sid]; cf = n["callFrame"]; key = f'{cf["functionName"] or "(anon)"}:{cf["lineNumber"]+1}'
                self[key] = self.get(key, 0) + (ts[i] if i < len(ts) else 0)
            top = sorted(self.items(), key=lambda kv: -kv[1])[:25]
            return [f"{k} {v/1000:.0f}ms" for k, v in top]
        await pg.expose_function("pyProfile", profile)
        t0=time.time()
        boot_prof = __import__("os").environ.get("PROFILE_BOOT")
        if boot_prof: await profile("start")
        await pg.goto("file://"+page_path, wait_until="load", timeout=600000)
        try:
            await pg.wait_for_function("!document.getElementById('boot-splash')", timeout=float(__import__("os").environ.get("BOOT_TIMEOUT", "600")) * 1000)
        except BaseException as e:
            print("BOOT ERROR", type(e).__name__, e)
            for l in logs[-80:]: print(l[:600])
            raise
        print("booted in", round(time.time()-t0,1), "s", flush=True)
        if boot_prof: print("BOOT PROFILE", json.dumps(await profile("stop"), indent=1))
        src = open(script_path).read()
        pre = __import__("os").environ.get("PRE_JS")
        if pre: src = open(pre).read() + "\n" + src
        try:
            res = await asyncio.wait_for(pg.evaluate("async () => {" + src + "}"), timeout=float(__import__("os").environ.get("EVAL_TIMEOUT","600")))
            print("RESULT", json.dumps(res, indent=1)[:20000])
        except BaseException as e:
            print("EVAL ERROR", type(e).__name__, e)
        for l in logs[-80:]: print(l[:600])
        await br.close()
asyncio.run(main())

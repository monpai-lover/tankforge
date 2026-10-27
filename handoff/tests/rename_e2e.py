# Renaming in the connected lobby (user report: the nickname could not be changed in multiplayer):
# two clients in one room on a running tg-server; A types a new name in the lobby's name field and
# presses 改名; A's own name, B's view of the room and the name saved for next time all follow.
#   usage: python3 rename_e2e.py http://localhost:8791/ outprefix
import asyncio, sys, json
from playwright.async_api import async_playwright
URL, PREFIX = sys.argv[1], sys.argv[2]
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--js-flags=--max-old-space-size=1500"]
async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(headless=True, args=ARGS)
        pages, logs = [], []
        for name in ("A", "B"):
            pg = await br.new_page(viewport={"width": 960, "height": 540})
            pg.on("pageerror", lambda e, n=name: logs.append(f"{n} [pageerror] {e}"))
            await pg.goto(URL, wait_until="load", timeout=600000)
            await pg.wait_for_function("!document.getElementById('boot-splash') && window.__tf", timeout=600000)
            await pg.evaluate("localStorage.setItem('tankforge.name.v1', '" + name + "'); window.__tf.finishThumbs()")
            await pg.click("#net-btn")
            await pg.wait_for_function("window.__tf.net.open", timeout=60000)
            pages.append(pg)
        A, B = pages
        res = {"before": await A.evaluate("__tf.net.name"), "field": await A.evaluate("!!document.querySelector('#lb-rename')")}
        await A.evaluate("__tf.net.send({ t: 'create', name: 'rename', map: 'range', max: 8, deploy: true, gameplay_mode: 'casual', gameplay_rules_version: 2 })")
        await A.wait_for_function("__tf.net.room", timeout=30000)
        await B.evaluate("__tf.net.send({ t: 'list' })"); await B.wait_for_timeout(800)
        await B.click("[data-act=quick]")
        await B.wait_for_function("__tf.net.room && __tf.net.room.members.length === 2", timeout=30000)
        res["roomBefore"] = await B.evaluate("__tf.net.room.members.map(m => m.name)")
        await A.fill("#lb-rename", "  新車長 Ace  ")
        await A.click("[data-act=rename]")
        await A.wait_for_function("__tf.net.name === '新車長 Ace'", timeout=15000)
        await B.wait_for_function("__tf.net.room.members.some(m => m.name === '新車長 Ace')", timeout=15000)
        res["after"] = await A.evaluate("__tf.net.name")
        res["roomAfterB"] = await B.evaluate("__tf.net.room.members.map(m => m.name)")
        res["header"] = await A.evaluate("document.querySelector('#lobby .lb-state').innerText")
        res["saved"] = await A.evaluate("localStorage.getItem('tankforge.name.v1')")
        # Enter in the field renames too
        await A.fill("#lb-rename", "Ace2")
        await A.press("#lb-rename", "Enter")
        await B.wait_for_function("__tf.net.room.members.some(m => m.name === 'Ace2')", timeout=15000)
        res["enter"] = await B.evaluate("__tf.net.room.members.map(m => m.name)")
        res["errors"] = logs[:5]
        print("RESULT", json.dumps(res, ensure_ascii=False, indent=1), flush=True)
        try:
            await A.screenshot(path=PREFIX + "A.png", timeout=120000)
        except Exception as e:
            print("screenshot skipped:", type(e).__name__)
        await br.close()
asyncio.run(main())

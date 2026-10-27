# End-to-end online check against a running tg-server: two clients, lobby auto-connect, quick match,
# start, deploy, one shot from A at B.   usage: python3 online_e2e.py http://localhost:8790/ outprefix
import asyncio, sys, json, time
from playwright.async_api import async_playwright
URL, PREFIX = sys.argv[1], sys.argv[2]
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required", "--js-flags=--max-old-space-size=1500"]
async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(headless=True, args=ARGS)
        pages, logs = [], []
        for name in ("A", "B"):
            pg = await br.new_page(viewport={"width": 800, "height": 450})
            pg.on("console", lambda m, n=name: logs.append(f"{n} [{m.type}] {m.text[:300]}"))
            pg.on("pageerror", lambda e, n=name: logs.append(f"{n} [pageerror] {e}"))
            await pg.goto(URL, wait_until="load", timeout=600000)
            await pg.wait_for_function("!document.getElementById('boot-splash') && window.__tf", timeout=600000)
            await pg.evaluate("localStorage.setItem('tankforge.name.v1', '" + name + "'); window.__tf.finishThumbs(); window.__tf.select('su_t72a')")
            pages.append(pg)
        A, B = pages
        res = {}
        # 1. click the lobby button: it connects by itself, no server field shown
        for n, pg in (("A", A), ("B", B)):
            await pg.click("#net-btn")
            await pg.wait_for_function("window.__tf.net.open", timeout=60000)
            res[n + "_lobby"] = await pg.evaluate("({ open: __tf.net.open, url: __tf.net.url, serverField: !!document.querySelector('#lb-server'), text: document.getElementById('lobby').innerText.slice(0, 200) })")
        # 2. A creates a range room, B uses quick match
        await A.evaluate("__tf.net.send({ t: 'create', name: 'e2e', map: 'range', max: 8, deploy: true, gameplay_mode: 'casual', gameplay_rules_version: 2 })")
        await A.wait_for_function("__tf.net.room", timeout=30000)
        await B.evaluate("__tf.net.send({ t: 'list' })"); await B.wait_for_timeout(800)
        await B.click("[data-act=quick]")
        await B.wait_for_function("__tf.net.room && __tf.net.room.members.length === 2", timeout=30000)
        res["room"] = await A.evaluate("__tf.net.room.members.map(m => [m.name, m.team])")
        # 3. A starts; both deploy the T-72A
        await A.evaluate("__tf.net.send({ t: 'start' })")
        for pg in (A, B):
            await pg.wait_for_function("__tf.deploy.visible || __tf.G.mode === 'battle'", timeout=120000)
        for pg in (A, B):
            await pg.evaluate("__tf.deploy.o.deploy('su_t72a', 0)")
        for pg in (A, B):
            await pg.wait_for_function("__tf.G.mode === 'battle' && __tf.G.online && (__tf.G.enemies || []).some(e => e.remote)", timeout=180000)
        await A.wait_for_timeout(3000)
        res["A_sees"] = await A.evaluate("__tf.enemies().filter(e => e.remote)")
        res["B_sees"] = await B.evaluate("__tf.enemies().filter(e => e.remote)")
        # 4. A lays the gun on B and fires
        before = await B.evaluate("JSON.stringify(__tf.G.cstate?.modules || null)")
        shot = await A.evaluate("""(() => { const G = __tf.G, e = G.enemies.find(q => q.remote); const o = e.veh.body.origin(), aimAt = e.veh.body.worldPoint([0, 1.2, 0]);
          G.T[0].yaw = Math.atan2(aimAt[0] - G.s.x, aimAt[2] - G.s.z) - G.s.heading;
          for (let k = 0; k < 4; k++) { const l = __tf.gunLine(0), mz = l.pos || l.trunnion; const d = Math.hypot(aimAt[0] - mz[0], aimAt[2] - mz[2]); G.T[0].guns[0].pitch = Math.atan2(aimAt[1] - mz[1], d) + 0.0012; }
          G.T[0].loading.state[0] = 'ready';
          const ok = __tf.fireGun(0, 0); window.__track = { min: Infinity }; const sh = G.shots.at(-1);
          const iv = setInterval(() => { if (!sh || !G.shots.includes(sh)) return clearInterval(iv); const p = sh.s.pos; window.__track.min = Math.min(window.__track.min, Math.hypot(p[0] - aimAt[0], p[1] - aimAt[1], p[2] - aimAt[2])); }, 5);
          return { ok, dist: Math.hypot(aimAt[0] - G.s.x, aimAt[2] - G.s.z), seq: G.online.seq, gun: __tf.gunLine(0) }; })()""")
        res["fire"] = shot
        await A.wait_for_timeout(6000)
        res["A_lastHit"] = await A.evaluate("__tf.G.lastHit"); res["closest_m"] = await A.evaluate("window.__track.min")
        res["B_damaged"] = (await B.evaluate("JSON.stringify(__tf.G.cstate?.modules || null)")) != before
        res["B_caps"] = await B.evaluate("__tf.G.caps && { destroyed: __tf.G.caps.destroyed, crew: __tf.G.caps.crew_alive }")
        await A.screenshot(path=PREFIX + "A.png", timeout=120000); await B.screenshot(path=PREFIX + "B.png", timeout=120000)
        print("RESULT", json.dumps(res, indent=1, ensure_ascii=False))
        for l in logs:
            if "error" in l.lower() or "net" in l.lower(): print(l)
        await br.close()
asyncio.run(main())

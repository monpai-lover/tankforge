# Aircraft online, end to end on a running tg-server (started with --start-sp so both can afford an aircraft):
# A creates a deploy room, B joins on the other side; both take off from the deploy screen (A an F-4E, B a
# P-51D, guns only); each sees the other's aircraft as a puppet; B is put 300 m ahead of A (within the spawn
# grace) and A fires at it; the hits go to the server, whose damage both clients apply; B is shot down, A
# gets the kill and its spawn points.
#   usage: python3 air_online_e2e.py http://localhost:8793/ outprefix
import asyncio, sys, json
from playwright.async_api import async_playwright
URL, PREFIX = sys.argv[1], sys.argv[2]
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--js-flags=--max-old-space-size=2500", "--autoplay-policy=no-user-gesture-required"]
HOOK = """(() => { const n = __tf.net, s = n.send.bind(n); window.__sent = {}; window.__recv = []; n.send = (m) => { window.__sent[m.t] = (window.__sent[m.t] || 0) + 1; return s(m); }; for (const t of ['air_damage', 'damage', 'air_fired']) n.on(t, (m) => window.__recv.push({ t, from: m.from, target: m.target, kind: m.kind, down: m.down, result: m.result })); })()"""
async def main():
    async with async_playwright() as p:
        # one browser each: both pages in front (a background tab's frames are throttled, its input off)
        browsers, pages, logs = [], [], []
        for name in ("A", "B"):
            br = await p.chromium.launch(headless=True, args=ARGS)
            browsers.append(br)
            pg = await br.new_page(viewport={"width": 960, "height": 540})
            pg.on("pageerror", lambda e, n=name: logs.append(f"{n} [pageerror] {e}"))
            pg.on("console", lambda m, n=name: (m.type == "error" or "net" in m.text) and logs.append(f"{n} [console {m.type}] {m.text[:300]}"))
            await pg.goto(URL, wait_until="load", timeout=600000)
            await pg.wait_for_function("!document.getElementById('boot-splash') && window.__tf", timeout=600000)
            await pg.evaluate("localStorage.setItem('tankforge.name.v1', '" + name + "'); window.__tf.finishThumbs()")
            await pg.click("#net-btn")
            await pg.wait_for_function("window.__tf.net.open", timeout=60000)
            await pg.evaluate(HOOK)
            pages.append(pg)
        A, B = pages
        res = {}
        await A.evaluate("__tf.net.send({ t: 'create', name: 'air', map: 'range', max: 8, deploy: true, gameplay_mode: 'casual', gameplay_rules_version: 2 })")
        await A.wait_for_function("__tf.net.room", timeout=30000)
        await B.evaluate("__tf.net.send({ t: 'list' })"); await B.wait_for_timeout(800)
        await B.click("[data-act=quick]")
        await B.wait_for_function("__tf.net.room && __tf.net.room.members.length === 2", timeout=30000)
        teams = await B.evaluate("__tf.net.room.members.map(m => m.team)")
        if teams[0] == teams[1]:
            await B.evaluate("__tf.net.send({ t: 'team', team: __tf.net.room.members[0].team === 'blue' ? 'red' : 'blue' })")
            await B.wait_for_timeout(600)
        await A.evaluate("__tf.net.send({ t: 'start' })")
        for pg in pages:
            try:
                await pg.wait_for_function("__tf.G.online && document.querySelector('#deploy') && !document.querySelector('#deploy').hidden", timeout=300000)
            except Exception:
                print("RESULT", json.dumps({"stuck": [await q.evaluate("({ mode: __tf.G.mode, online: !!__tf.G.online, thumbsDone: __tf.G.airGarage.thumbsDone, room: __tf.net.room && { started: __tf.net.room.started, members: __tf.net.room.members.map(m => [m.name, m.team, m.ready]) }, sent: window.__sent })") for q in pages], "errors": logs[:8]}, ensure_ascii=False)); raise
        res["heapMB"] = [await q.evaluate("Math.round(performance.memory.usedJSHeapSize / 1e6)") for q in pages]
        res["deployCards"] = await A.evaluate("[...document.querySelectorAll('#deploy .dp-card')].filter(c => c.dataset.id.startsWith('air:')).length")
        # every aircraft card has its picture (drawn before the battle even when the hangar was never opened)
        res["airPictures"] = await A.evaluate("[...document.querySelectorAll('#deploy .dp-card')].filter(c => c.dataset.id.startsWith('air:')).filter(c => { const k = c.querySelector('canvas'), d = k.getContext('2d').getImageData(0, 0, k.width, k.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) n++; return n > 200; }).length")
        # the button when the points do not reach: the whole text fits
        await A.evaluate("document.querySelector('#deploy .dp-card[data-id=\"air:f104g\"]').click(); window.__me = __tf.G.online.members.get(__tf.net.id); window.__spSave = window.__me.sp; window.__me.sp = 0")
        await A.wait_for_timeout(400)
        res["shortButton"] = await A.evaluate("(() => { const g = document.querySelector('#dp-go'); return { text: g.textContent, fits: g.scrollWidth <= g.clientWidth && g.scrollHeight <= g.clientHeight, disabled: g.disabled }; })()")
        await A.evaluate("window.__me.sp = window.__spSave; document.querySelector('#deploy .dp-card[data-id=\"air:f4e\"]').click()")
        # take off: the aircraft's card, its first (guns) loadout, the button
        for pg, kind in ((A, "f4e"), (B, "p51d")):
            st = await pg.evaluate("({ mode: __tf.G.mode, online: !!__tf.G.online, deploy: !!document.querySelector('#deploy') && !document.querySelector('#deploy').hidden, cards: [...document.querySelectorAll('#deploy .dp-card')].map(c => c.dataset.id).slice(-25), room: !!__tf.net.room })")
            if not any(c == "air:" + kind for c in st["cards"]):
                print("RESULT", json.dumps({"takeoffState": st, "kind": kind, "errors": logs[:8], **res}, ensure_ascii=False)); return
            await pg.evaluate(f"document.querySelector('#deploy .dp-card[data-id=\"air:{kind}\"]').click()")
            await pg.wait_for_timeout(300)
            res["button_" + kind] = await pg.evaluate("document.querySelector('#dp-go').textContent")
            await pg.evaluate("document.querySelector('#dp-go').click()")
            await pg.wait_for_function("__tf.G.air && __tf.G.air.active && __tf.G.air.online", timeout=60000)
        res["sp"] = await A.evaluate("__tf.G.online.sp")
        # from here both simulations are stepped by the test (0.05 s each, in turn; the network in real time)
        for pg in pages:
            await pg.evaluate("__tf.pause(true)")
        async def step_both(n, before_a="", before_b=""):
            for _ in range(n):
                await A.evaluate("(() => { " + before_a + "; __tf.advance(0.05, [], false); })()")
                await B.evaluate("(() => { " + before_b + "; __tf.advance(0.05, [], false); })()")
                await asyncio.sleep(0.03)
        # B 150 m ahead along A's nose (5 m above: a round exactly along its centre line can pass between the hitbox's triangles), at A's speed and heading (within the spawn grace); A flies straight
        pose = await A.evaluate("(() => { const P = __tf.G.air.plane, S = P.cur; return { p: P.position, f: [S[48], S[49], S[50]], v: Math.hypot(S[7], S[8], S[9]) }; })()")
        f = pose["f"]
        await B.evaluate(f"(() => {{ const P = __tf.G.air.plane, p = {json.dumps(pose['p'])}, f = {json.dumps(f)}; P.spawn(p[0] + f[0] * 150, p[1] + f[1] * 150 + 5, p[2] + f[2] * 150, Math.atan2(f[0], f[2]), {pose['v']}, false); P.state.throttle = 0.7; P.aim = f; }})()")
        await A.evaluate(f"(() => {{ __tf.G.air.plane.aim = {json.dumps(f)}; __tf.G.air.plane.state.throttle = 0.7; }})()")
        await step_both(20)
        res["puppets"] = {"A_sees": await A.evaluate("__tf.G.airBots.list.filter(b => b.remote).map(b => b.type)"), "B_sees": await B.evaluate("__tf.G.airBots.list.filter(b => b.remote).map(b => b.type)")}
        res["gapM"] = await A.evaluate("(() => { const b = __tf.G.airBots.list.find(x => x.remote), P = __tf.G.air.plane; return b ? Math.round(Math.hypot(...b.plane.position.map((v, i) => v - P.position[i]))) : null; })()")
        res["probe"] = await A.evaluate("""(() => { const G = __tf.G, x = __tf.__x || window.__tfx, b = G.airBots.list.find(q => q.remote); if (!b) return null; const P = b.plane, D = P.damage, c = P.drawPos || P.position, A2 = G.air.plane;
          const f = [A2.cur[48], A2.cur[49], A2.cur[50]], p0 = c.map((v, i) => v - f[i] * 20), p1 = c.map((v, i) => v + f[i] * 20), a = P.localPoint(p0), e = P.localPoint(p1);
          const cs = D.hitbox ? x.airHitboxQuery(D.hitbox, a, e, D.alive()) : null;
          const q = (s, e2) => x.airHitboxQuery(D.hitbox, s, e2, D.alive()).length, alive = D.alive();
          const lines = { axis: q([0, 0, -20], [0, 0, 20]), up03: q([0, 0.3, -20], [0, 0.3, 20]), wing: q([-3, 5, 0], [-3, -5, 0]), wingR: q([3, 5, 0], [3, -5, 0]), aliveN: alive ? [...alive].reduce((s, v) => s + v, 0) : null, pieces: D.hitbox.pieces.length, tris: D.hitbox.tris ? D.hitbox.tris.length : Object.keys(D.hitbox) };
          return { lines, friend: b.friend, down: b.down, gone: b.gone, crashed: P.crashed, hasHitbox: !!D.hitbox, contacts: cs ? cs.length : null, drawPos: c.map(Math.round), pos: P.position.map(Math.round), local0: a.map(v => Math.round(v)), local1: e.map(v => Math.round(v)), rootLocal: !!P.root?.local, team: G.online.team }; })()""")
        # A fires at B's puppet: aimed at it each step, the trigger held
        aim = "const G = __tf.G, air = G.air, P = air.plane, b = G.airBots.list.find(x => x.remote); if (b && !b.down) { const d = b.plane.position.map((v, i) => v - P.position[i]), l = Math.hypot(...d); P.aim = d.map(v => v / l); air.fireAll = true; } else air.fireAll = false;"
        for k in range(12):
            await step_both(10, before_a=aim)
            if await B.evaluate("!!__tf.G.online.dead"):
                break
        await A.evaluate("__tf.G.air.fireAll = false")
        res["A_fire"] = await A.evaluate("(() => { const b = __tf.G.airBots.list.find(x => x.remote); return { sent: window.__sent, puppetDown: !!b?.down, puppetDamage: b ? b.plane.damage.summary() : null, rounds: __tf.G.air.guns.map(g => g.ammo) }; })()")
        await step_both(10)
        res["B_after"] = await B.evaluate("(() => { const G = __tf.G; return { dead: !!G.online.dead, damage: G.air?.plane.damage.summary() ?? null, sent: window.__sent, recv: window.__recv.filter(r => r.t !== 'air_fired').slice(0, 12), firedSeen: window.__recv.filter(r => r.t === 'air_fired').length, crashed: !!G.air?.plane.crashed, agl: G.air ? Math.round(G.air.plane.cur[35]) : null }; })()")
        res["board"] = await A.evaluate("__tf.net.room.members.map(m => ({ name: m.name, kills: m.kills, deaths: m.deaths, sp: m.sp, aircraft: m.aircraft }))")
        res["errors"] = logs[:8]
        print("RESULT", json.dumps(res, ensure_ascii=False, indent=1), flush=True)
        for pg, n in ((A, "A"), (B, "B")):
            try:
                await pg.screenshot(path=PREFIX + n + ".png", timeout=120000)
            except Exception as e:
                print("screenshot skipped:", type(e).__name__)
        for br in browsers:
            await br.close()
asyncio.run(main())

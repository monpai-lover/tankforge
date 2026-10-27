#!/usr/bin/env python3
"""Apply the bounded ground-radar fix to the verified production/f3 app source.

Reads/writes only the explicitly supplied app.js.html; never assembles/deploys a
page. Every old span must occur once. A patched file is rejected, not repatched.
"""
import argparse
from pathlib import Path


HELPERS = '''    // Ground radar uses the same rebindable ACM action as aircraft; Space still brakes.
    // These acquisition settings are game rules, not historical radar specifications.
    function padRadarDirection(pad) {
      return G4.aim ? dirFrom2(G4.aim.yaw, G4.aim.pitch) : pad.dir;
    }
    function padRadarContains(head, forward, point) {
      const d = sub(point, head), f = norm(forward), right = norm(cross([0, 1, 0], f)), up = cross(f, right);
      const z = dot(d, f), x = dot(d, right), y = dot(d, up);
      return z > 0 && Math.abs(Math.atan2(x, z)) <= RADAR_ACM.az * D2R && Math.abs(Math.atan2(y, Math.hypot(x, z))) <= RADAR_ACM.el * D2R;
    }
    function padRadarDogfight() {
      const pad = G4.pad;
      if (!pad?.cfg.radar || !pad.cfg.search) return pad ? padSay(pad, L10N("此車沒有雷達", "this vehicle has no radar")) : false;
      if (pad.u.radarHp <= 0 || pad.u.emconUntil > G4.time) return padSay(pad, L10N("雷達不可用", "radar unavailable"));
      pad.radarMode = pad.radarMode === "acm" ? "search" : "acm";
      pad.lock = pad.lead = pad.leadF = pad.autoAim = pad.lockEase = null;
      pad.contacts = [];
      pad.radarNext = -Infinity;
      Object.assign(pad.u, { track: null, search: null, acqAt: null, focus: null });
      return padSay(pad, pad.radarMode === "acm" ? L10N("準星快速搜索：±5°，10 km 上限，10 Hz 自動捕獲", "Boresight acquisition: ±5°, up to 10 km, 10 Hz auto-acquisition") : L10N("恢復全向搜索", "all-round search restored"), 2.5);
    }
    function padRadarKeyDown(e, code = e.code) {
      if (!G4.pad || G4.mode !== "battle" || G4.air?.active || G4.online || G4.paused || G4.caps?.destroyed || deploy.visible || !chatIn.hidden || !hangar.hidden || !armEd.hidden || !keyEd.hidden || document.hidden) return false;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target?.tagName) || e.target?.isContentEditable) return false;
      const binding = G4.airKeys.radarDogfight;
      if (!binding || comboOf(e, code, G4.keys.has("brake")) !== binding) return false;
      if (!e.repeat) padRadarDogfight();
      return true;
    }
    /** Actual search observations: focused revisits are 10 Hz, not a HUD-only cone. */
    function padRadarSense(pad, bots, head) {
      const u = pad.u, S = pad.cfg.search, focused = pad.radarMode === "acm", now = G4.time;
      u.focus = focused ? { dir: padRadarDirection(pad) } : null;
      if (focused && now + 1e-8 < (pad.radarNext ?? -Infinity)) return false;
      pad.radarNext = now + (focused ? RADAR_ACM.period : 0);
      pad.radarScanAt = now;
      const range = focused ? Math.min(S.range, RADAR_ACM.range) : S.range;
      pad.contacts = u.radarHp > 0 && !(u.emconUntil > now) ? bots.filter(b => {
        const p = b.plane.position;
        return Math.hypot(...sub(p, head)) < range && b.plane.cur[35] > S.low && airLos(head, p) && (!focused || padRadarContains(head, u.focus.dir, p));
      }).map(b => ({ b, d: Math.hypot(...sub(b.plane.position, head)) })) : [];
      if (pad.lock && (!bots.includes(pad.lock) || focused && !u.track?.radar && !pad.contacts.some(c => c.b === pad.lock))) {
        pad.lock = null;
        Object.assign(u, { track: null, search: null, acqAt: null });
      }
      if (focused && !pad.lock) {
        const look = u.focus.dir;
        const best = pad.contacts.filter(c => !c.b.friend).sort((a, b) => angleOf(look, sub(a.b.plane.position, head)) - angleOf(look, sub(b.b.plane.position, head)) || a.d - b.d)[0];
        if (best) {
          pad.lock = best.b;
          Object.assign(u, { track: null, search: null, acqAt: null });
        }
      }
      return true;
    }
'''


def patch(source):
    if 'function padRadarDogfight()' in source:
        raise ValueError('Ground radar ACM is already present; refusing to repatch')
    edits = []

    def replace(old, new):
        nonlocal source
        if source.count(old) != 1:
            raise ValueError(f'Expected exactly one source span: {old[:100]!r}')
        source = source.replace(old, new, 1)
        edits.append((old, new))

    replace('    /** R: the seeker on / off (Chaparral), the radar\'s lock on the contact nearest the launcher\'s line (Pantsir). */', HELPERS + '    /** R: the seeker on / off (Chaparral), the radar\'s lock on the contact nearest the launcher\'s line (Pantsir). */')
    replace('''        u.sweep = (u.sweep + Math.PI * 2 * dt / S.period) % (Math.PI * 2);
        const brg = Math.atan2(l[0], l[2]), d0 = wrapPi(brg - prev), d1 = wrapPi(brg - u.sweep), crossed = d0 >= 0 && d1 <= 0 && d0 - d1 < Math.PI;
        const visible = los && dist < S.range && agl > S.low;''', '''        const focus = !u.track?.radar ? u.focus : null;
        u.sweep = u.focus ? Math.atan2(u.focus.dir[0], u.focus.dir[2]) : (u.sweep + Math.PI * 2 * dt / S.period) % (Math.PI * 2);
        const brg = Math.atan2(l[0], l[2]), d0 = wrapPi(brg - prev), d1 = wrapPi(brg - u.sweep), crossed = focus || d0 >= 0 && d1 <= 0 && d0 - d1 < Math.PI;
        const visible = los && dist < S.range && agl > S.low && (!focus || dist < RADAR_ACM.range && padRadarContains(head, focus.dir, tp));
        if (focus && (!visible || u.search && now - u.search.seenAt > RADAR_ACM.period * 2.5)) { u.search = null; u.acqAt = null; }''')
    replace('''        if (u.search && now - u.search.seenAt > S.period * 2.5) u.search = null;''', '''        if (u.search && now - u.search.seenAt > (focus ? RADAR_ACM.period : S.period) * 2.5) u.search = null;''')
    replace('''        if (!u.track && want && dist < T.range && (u.acqAt ??= now) && now - u.acqAt >= T.acquire) {''', '''        if (!u.track && want && dist < T.range && now - (u.acqAt ??= now) + 1e-8 >= (focus ? RADAR_ACM.acquire * (jam ? 2 : 1) : T.acquire)) {''')
    replace('''      if (cfg.search && u.radarHp > 0 && live && !pad.lock) u.sweep = ((u.sweep || 0) + Math.PI * 2 * dt / cfg.search.period) % (Math.PI * 2);''', '''      if (cfg.search && u.radarHp > 0 && live && !pad.lock) {
        const look = padRadarDirection(pad);
        u.sweep = pad.radarMode === "acm" ? Math.atan2(look[0], look[2]) : ((u.sweep || 0) + Math.PI * 2 * dt / cfg.search.period) % (Math.PI * 2);
      }''')
    replace('''          const S = cfg.search;
          pad.contacts = u.radarHp > 0 ? bots.filter((b) => {
            const d = Math.hypot(...sub(b.plane.position, head));
            return d < S.range && b.plane.cur[35] > S.low && airLos(head, b.plane.position);
          }).map((b) => ({ b, d: Math.hypot(...sub(b.plane.position, head)) })) : [];
          if (pad.lock && !bots.includes(pad.lock)) {
            pad.lock = null;
            u.track = null;
          }
          if (pad.lock) adSense(pe, u, 1 / 30, pad.lock.plane, () => {
          }, pad.lock);''', '''          const scanned = padRadarSense(pad, bots, head);
          if (pad.lock && (pad.radarMode !== "acm" || u.track?.radar || scanned)) adSense(pe, u, 1 / 30, pad.lock.plane, () => {
          }, pad.lock);''')
    replace('''      if (e.code === "Tab" && e.shiftKey && G4.pad) {''', '''      if (padRadarKeyDown(e)) { e.preventDefault(); return; }
      if (e.code === "Tab" && e.shiftKey && G4.pad) {''')
    replace('''      const tag2 = e.target.tagName;
      if (tag2 === "INPUT" || tag2 === "SELECT" || tag2 === "TEXTAREA") return;''', '''      const tag2 = e.target.tagName;
      if (tag2 === "INPUT" || tag2 === "SELECT" || tag2 === "TEXTAREA" || e.target.isContentEditable) return;''')
    replace('''      if (e.button === 0) {
        if (!locked() && lockable()) {''', '''      if (padRadarKeyDown(e, `Mouse${e.button}`)) { e.preventDefault(); return; }
      if (e.button === 0) {
        if (!locked() && lockable()) {''')
    replace('''      const head = padHead(), cfg = pad.cfg, def = pad.def, GREEN = "#7dff8a", AMBER = "#ffcf5a", RED = "#ff5a4a";
      g.lineWidth = 1.5;''', '''      const head = padHead(), cfg = pad.cfg, def = pad.def, GREEN = "#7dff8a", AMBER = "#ffcf5a", RED = "#ff5a4a";
      g.lineWidth = 1.5;
      if (cfg.radar && pad.radarMode === "acm" && pad.u.radarHp > 0) {
        const f = norm(padRadarDirection(pad)), right = norm(cross([0, 1, 0], f)), up = cross(f, right), az = Math.tan(RADAR_ACM.az * D2R), el = Math.tan(RADAR_ACM.el * D2R);
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => proj(head.map((v, k) => v + (f[k] + right[k] * x * az + up[k] * y * el) * 2000)));
        if (corners.every(Boolean)) {
          g.strokeStyle = GREEN;
          g.beginPath();
          corners.forEach((q, i) => i ? g.lineTo(...q) : g.moveTo(...q));
          g.closePath(); g.stroke();
        }
      }''')
    replace('''        const s = padEl.scope.getContext("2d"), R = cfg.search.range, c = 100, k = 92 / R;''', '''        const s = padEl.scope.getContext("2d"), focused = pad.radarMode === "acm", R = focused ? Math.min(cfg.search.range, RADAR_ACM.range) : cfg.search.range, c = 100, k = 92 / R;''')
    replace('''        s.lineTo(c + Math.sin(sw) * 92, c - Math.cos(sw) * 92);
        s.moveTo(c, c);''', '''        s.lineTo(c + Math.sin(sw) * 92, c - Math.cos(sw) * 92);
        if (focused) for (const edge of [-1, 1]) {
          s.moveTo(c, c);
          s.lineTo(c + Math.sin(sw + edge * RADAR_ACM.az * D2R) * 92, c - Math.cos(sw + edge * RADAR_ACM.az * D2R) * 92);
        }
        s.moveTo(c, c);''')
    replace('''        s.fillText(`${(R / 1e3).toFixed(0)} km`, 8, 196);''', '''        s.fillText(`${focused ? "ACM 10 Hz · " : ""}${(R / 1e3).toFixed(0)} km`, 8, 196);''')
    replace('''        sensor,
        def ? `${def.name}：${loaded}''', '''        sensor,
        cfg.radar ? `${pad.radarMode === "acm" ? L10N("準星快速搜索 ±5°／10 Hz", "Boresight acquisition ±5° / 10 Hz") : L10N("全向搜索", "All-round search")} · ${comboLabel(G4.airKeys.radarDogfight || "—")} ${L10N("切換搜索模式", "toggle acquisition mode")}` : "",
        def ? `${def.name}：${loaded}''')
    return source, edits


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app', type=Path)
    parser.add_argument('--check', action='store_true', help='Validate applicability without writing')
    args = parser.parse_args()
    source, edits = patch(args.app.read_text())
    if not args.check:
        args.app.write_text(source)
    print(f'{len(edits)} exact edits {"validated" if args.check else "applied"}: {args.app}')


if __name__ == '__main__':
    main()

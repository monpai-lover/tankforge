#!/usr/bin/env python3
"""Stage source-bound aircraft fuze handling; never overwrite the shared app."""
import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent / 'bundle/app.js.html'
START = '  // BEGIN AIRCRAFT PROJECTILE FUZE\n'
END = '  // END AIRCRAFT PROJECTILE FUZE\n'


def once(text, old, new, name, proof):
    if text.count(new) == 1:
        proof.append({'name': name, 'alreadyPatched': True})
        return text
    count = text.count(old)
    if count != 1:
        raise ValueError(f'{name}: expected one source anchor, got {count}')
    proof.append({'name': name, 'alreadyPatched': False})
    return text.replace(old, new, 1)


def section(text, start, end, name, transform, proof):
    if text.count(start) != 1:
        raise ValueError(f'{name}: ambiguous source section')
    a = text.index(start)
    b = text.index(end, a)
    return text[:a] + transform(text[a:b], proof) + text[b:]


def patch_damage(text, proof):
    changes = [
        ('hit(a, b, energyJ, tnt, incendiary, rnd) {',
         'hit(a, b, energyJ, tnt, incendiary, rnd, hitOptions = {}) {', 'hit_options'),
        ('this._hitBoxes(a, b, energyJ, tnt, incendiary, rnd);',
         'this._hitBoxes(a, b, energyJ, tnt, incendiary, rnd, hitOptions);', 'box_options_forward'),
        ('_hitBoxes(a, b, energyJ, tnt, incendiary, rnd) {',
         '_hitBoxes(a, b, energyJ, tnt, incendiary, rnd, hitOptions = {}) {', 'box_options'),
        ('      const t = cs[0].t, path = [], seen = /* @__PURE__ */ new Set();',
         '      const t = cs[0].t, path = [], seen = /* @__PURE__ */ new Set();\n'
         '      const fuze = resolveAircraftProjectileFuze(hitOptions.shell, { ...hitOptions, a, b, contactT: t, tntKg: tnt });\n'
         '      const contactBurst = fuze ? fuze.mechanism === "immediate_he" : tnt > 0;', 'mesh_fuze'),
        ('        // a filled shell bursts at the skin: only the piece it struck takes its kinetic share\n'
         '        if (tnt > 0 && parts.length > 0 || k > 3) break;',
         '        // Immediate HE stops at its contact; APHE continues kinetically until its recorded fuze acts.\n'
         '        if (contactBurst && parts.length > 0 || k > 3) break;', 'mesh_traversal'),
        ('      const t = Math.min(skin, crossed[0]?.t ?? Infinity), killed = [], parts = [];',
         '      const t = Math.min(skin, crossed[0]?.t ?? Infinity), killed = [], parts = [];\n'
         '      const fuze = resolveAircraftProjectileFuze(hitOptions.shell, { ...hitOptions, a, b, contactT: t, tntKg: tnt });\n'
         '      const contactBurst = fuze ? fuze.mechanism === "immediate_he" : tnt > 0;', 'box_fuze'),
        ('        if (tnt > 0 && k > 0 || k > 3) break;',
         '        if (contactBurst && k > 0 || k > 3) break;', 'box_traversal'),
        ('      return { t, killed, parts, piece: hb.pieces[hb.piece[cs[0].tri]].name, tri: cs[0].tri };',
         '      return { t, killed, parts, piece: hb.pieces[hb.piece[cs[0].tri]].name, tri: cs[0].tri, ...(fuze || {}) };', 'mesh_fuze_record'),
        ('      return { t, killed, parts };',
         '      return { t, killed, parts, ...(fuze || {}) };', 'box_fuze_record'),
    ]
    for old, new, name in changes:
        text = once(text, old, new, name, proof)
    old = '      if (tnt > 0) this.blast([0, 1, 2].map((j) => a[j] + (b[j] - a[j]) * t), tnt, rnd, killed);'
    new = ('      if (fuze) {\n'
           '        for (const burst of fuze.bursts) this.blast(burst.point, burst.tnt_equivalent_kg, rnd, killed);\n'
           '      } else if (tnt > 0) this.blast([0, 1, 2].map((j) => a[j] + (b[j] - a[j]) * t), tnt, rnd, killed);')
    if text.count(new) == 2:
        proof.append({'name': 'recorded_bursts_only', 'alreadyPatched': True})
    elif text.count(old) == 2:
        text = text.replace(old, new)
        proof.append({'name': 'recorded_bursts_only', 'alreadyPatched': False})
    else:
        raise ValueError('recorded_bursts_only: expected exactly two damage paths')
    return text


def patch_player(text, proof):
    changes = [
        ('function aircraftHit(p0, p1, shell, vel, shooter = null) {',
         'function aircraftHit(p0, p1, shell, vel, shooter = null, hitOptions = {}) {', 'player_hit_options'),
        ('const incendiary = tnt > 0 || /incend|hefi|hei|_i_|brand/i.test',
         'const incendiary = aircraftProjectileMechanism(shell) === "immediate_he" || /incend|hefi|hei|_i_|brand/i.test', 'player_incendiary'),
        ('tnt, incendiary, Math.random);',
         'tnt, incendiary, Math.random, { ...hitOptions, shell, speedMS: rel });', 'player_fuze_input'),
        ('      const cue = tnt > 0 ? "air_hit_he" : "air_hit";\n'
         '      if (tnt > 0) fx.explosion(point, null, tnt, false);\n'
         '      else fx.armorImpact(point, true);',
         '      const bursts = r.bursts || [], burstTnt = bursts.reduce((sum, burst) => sum + burst.tnt_equivalent_kg, 0);\n'
         '      const cue = bursts.length ? "air_hit_he" : "air_hit";\n'
         '      for (const burst of bursts) fx.explosion(P.worldPoint(burst.point), null, burst.tnt_equivalent_kg, false);\n'
         '      if (!bursts.length) fx.armorImpact(point, true);', 'player_recorded_fx'),
        ('else if (tnt > 0) sound.blast(tnt, dist,',
         'else if (bursts.length) sound.blast(burstTnt, dist,', 'player_recorded_sound'),
        ('(tnt > 0 ? 0.35 : 0.08)', '(bursts.length ? 0.35 : 0.08)', 'player_recorded_shake'),
    ]
    for old, new, name in changes:
        text = once(text, old, new, name, proof)
    return text


def patch_bot(text, proof):
    changes = [
        ('function botHit(p0, p1, shell, vel, shot = null) {',
         'function botHit(p0, p1, shell, vel, shot = null, hitOptions = {}) {', 'bot_hit_options'),
        ('const incendiary = tnt > 0 || /incend|hefi|hei|_i_|brand/i.test',
         'const incendiary = aircraftProjectileMechanism(shell) === "immediate_he" || /incend|hefi|hei|_i_|brand/i.test', 'bot_incendiary'),
        ('tnt, incendiary, Math.random);',
         'tnt, incendiary, Math.random, { ...hitOptions, shell, speedMS: rel });', 'bot_fuze_input'),
        ('        if (tnt > 0) fx.explosion(point, null, tnt, false);\n'
         '        else fx.armorImpact(point, true);',
         '        const bursts = r.bursts || [];\n'
         '        for (const burst of bursts) fx.explosion(P.worldPoint(burst.point), null, burst.tnt_equivalent_kg, false);\n'
         '        if (!bursts.length) fx.armorImpact(point, true);', 'bot_recorded_fx'),
        ('sound.full.play(tnt > 0 ? "air_hit_he" : "air_hit",',
         'sound.full.play(bursts.length ? "air_hit_he" : "air_hit",', 'bot_recorded_sound'),
    ]
    for old, new, name in changes:
        text = once(text, old, new, name, proof)
    return text


def apply_patch(text):
    proof = []
    text = section(text, '  var AircraftDamage = class {', '  // NF-02: the same kinds of parts', 'damage', patch_damage, proof)
    text = section(text, '    function aircraftHit(', '    function airPiecesFx(', 'player', patch_player, proof)
    text = section(text, '    function botHit(', '    // ==== air combat systems', 'bot', patch_bot, proof)
    text = once(text,
                '      if (tntEquivalentKg(shell) > 0) fx.explosion(point, null, tntEquivalentKg(shell), false);',
                '      if (aircraftProjectileMechanism(shell) === "immediate_he") fx.explosion(point, null, tntEquivalentKg(shell), false);',
                'server_preview_no_aphe_contact_burst', proof)
    calls = [
        ('aircraftHit(p0, p1, G4.bulletShells.get(b.def.id), b.s.vel, b.shooter)',
         'aircraftHit(p0, p1, b.shell || G4.bulletShells.get(b.def.id), b.s.vel, b.shooter, { time_s: (b.replayDischarge?.launch_time_s || 0) + b.age - h })', 'bullet_player_clock'),
        ('botHit(p0, p1, b.shell || G4.bulletShells.get(b.def.id) || bulletShell(b.def), b.s.vel, b)',
         'botHit(p0, p1, b.shell || G4.bulletShells.get(b.def.id) || bulletShell(b.def), b.s.vel, b, { time_s: (b.replayDischarge?.launch_time_s || 0) + b.age - h })', 'bullet_bot_clock'),
        ('aircraftHit(p0, p1, sh.shell, sh.s.vel, sh.shooter)',
         'aircraftHit(p0, p1, sh.shell, sh.s.vel, sh.shooter, { time_s: (sh.replayDischarge?.launch_time_s || 0) + sh.age - h })', 'shot_player_clock'),
        ('botHit(p0, p1, sh.shell, sh.s.vel, sh)',
         'botHit(p0, p1, sh.shell, sh.s.vel, sh, { time_s: (sh.replayDischarge?.launch_time_s || 0) + sh.age - h })', 'shot_bot_clock'),
    ]
    for old, new, name in calls:
        text = once(text, old, new, name, proof)
    helper = (HERE / 'aircraft_projectile_fuze.js').read_text(encoding='utf8')
    block = START + helper + '\n' + END
    if START in text:
        a = text.index(START)
        b = text.index(END, a) + len(END)
        text = text[:a] + block + text[b:]
    else:
        anchor = '  var AircraftDamage = class {'
        if text.count(anchor) != 1:
            raise ValueError('Original AircraftDamage class anchor is ambiguous')
        text = text.replace(anchor, block + anchor, 1)
    return text, proof


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', type=Path, default=APP)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--manifest', type=Path)
    a = p.parse_args()
    if a.output.resolve() == APP.resolve():
        p.error('Stage a separate candidate; ROOT owns shared application integration')
    before = a.input.read_bytes().decode('utf8')
    after, proof = apply_patch(before)
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_bytes(after.encode('utf8'))
    result = {'inputSha256': hashlib.sha256(before.encode()).hexdigest(),
              'outputSha256': hashlib.sha256(after.encode()).hexdigest(),
              'scope': 'aircraft resolved-segment fuze semantics and actual local callers; no catalogs, assets or WASM changes',
              'hunks': proof}
    if a.manifest:
        a.manifest.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()

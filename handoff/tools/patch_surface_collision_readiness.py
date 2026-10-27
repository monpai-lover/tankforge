#!/usr/bin/env python3
"""Stage exact-surface query ordering/readiness; ROOT owns application integration."""
import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent / 'bundle/app.js.html'
START = '  // BEGIN SURFACE COLLISION READINESS\n'
END = '  // END SURFACE COLLISION READINESS\n'


def once(text, old, new, name, proof):
    if text.count(new) == 1:
        proof.append({'name': name, 'alreadyPatched': True})
        return text
    if text.count(old) != 1:
        raise ValueError(f'{name}: expected one source anchor, got {text.count(old)}')
    proof.append({'name': name, 'alreadyPatched': False})
    return text.replace(old, new, 1)


def apply_patch(text):
    proof = []
    old = '    intersect(p0, p1) {\n      const b = this.veh.body;'
    new = ('    intersect(p0, p1) {\n'
           '      const b = this.veh.body;\n'
           '      const exact = surfaceCollisionQuery(this.combat, this.combatKey, p0, p1, this.combat?.replayTime?.() ?? null);\n'
           '      if (exact.handled) {\n'
           '        this.surfaceCollisionReady = exact.ready; this.surfaceCollisionError = exact.error || null;\n'
           '        const contact = exact.contact;\n'
           '        return exact.ready && contact ? { t: contact.t, point: b.worldPoint(contact.point), local: contact.point, surface: true, contact } : null;\n'
           '      }')
    text = once(text, old, new, 'enemy_exact_before_hull_cull', proof)
    old = ('      if (this.surfaceCombat) {\n'
           '        const crossings = this.combat.surfaceOwner.trace(this.combatKey, p0, p1, this.combat.replayTime?.() ?? null), contact = crossings?.[0];\n'
           '        return contact ? { t: contact.t, point: b.worldPoint(contact.point), local: contact.point, surface: true, contact } : null;\n'
           '      }\n')
    text = once(text, old, '', 'remove_late_enemy_exact_query', proof) if old in text else text
    old = '    function hitSelf(p0, p1) {\n      const b = G4.veh.body;'
    new = ('    function hitSelf(p0, p1) {\n      const b = G4.veh.body;\n'
           '      const exact = surfaceCollisionQuery(G4.combat, G4.combatKey, p0, p1, G4.time);\n'
           '      if (exact.handled) {\n'
           '        G4.surfaceCollisionReady = exact.ready; G4.surfaceCollisionError = exact.error || null;\n'
           '        return exact.ready && exact.contact ? b.worldPoint(exact.contact.point) : null;\n'
           '      }')
    text = once(text, old, new, 'player_exact_before_hull_cull', proof)
    old = ('      if (G4.combat?.surfaceOwner?.actors.has(G4.combatKey)) {\n'
           '        const c = G4.combat.surfaceOwner.trace(G4.combatKey, p0, p1, G4.time)?.[0];\n'
           '        return c ? b.worldPoint(c.point) : null;\n'
           '      }\n')
    text = once(text, old, '', 'remove_late_player_exact_query', proof) if old in text else text
    old = 'e.surfaceCombat = !!G4.combat.registerSurfaceActor(e.combatKey, e.id, localReplay.actor(e.replayEntity), e.model, e.veh.body);'
    new = 'e.surfaceCombat = G4.combat.registerSurfaceActor(e.combatKey, e.id, localReplay.actor(e.replayEntity), e.model, e.veh.body)?.available === true;'
    text = once(text, old, new, 'registration_flag_checks_availability', proof)
    helper = (HERE / 'surface_collision_readiness.js').read_text(encoding='utf8')
    block = START + helper + '\n' + END
    if START in text:
        a = text.index(START); b = text.index(END, a) + len(END)
        text = text[:a] + block + text[b:]
    else:
        anchor = '  var LocalSurfaceCombat = class {'
        if text.count(anchor) != 1:
            raise ValueError('Ambiguous LocalSurfaceCombat class')
        text = text.replace(anchor, block + anchor, 1)
    return text, proof


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', type=Path, default=APP)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--manifest', type=Path)
    a = p.parse_args()
    if a.output.resolve() in {APP.resolve(), a.input.resolve()}:
        p.error('A separate candidate path is required; ROOT owns the active app')
    before = a.input.read_bytes().decode('utf8'); after, proof = apply_patch(before)
    a.output.parent.mkdir(parents=True, exist_ok=True); a.output.write_bytes(after.encode('utf8'))
    result = {'inputSha256': hashlib.sha256(before.encode()).hexdigest(), 'outputSha256': hashlib.sha256(after.encode()).hexdigest(),
              'scope': 'registered exact-triangle query before hull culls; per-actor readiness/errors, no fallback, damage or global stepping changes', 'hunks': proof}
    if a.manifest: a.manifest.write_text(json.dumps(result, indent=2) + '\n', encoding='utf8')
    print(json.dumps(result))


if __name__ == '__main__':
    main()

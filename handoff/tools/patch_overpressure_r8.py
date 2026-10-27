"""Apply reviewed R8 blast-route changes to an explicit candidate bundle.

This tool never selects or overwrites the canonical bundle implicitly. The
integration owner supplies input/output paths and performs the final application.
"""
from pathlib import Path
import argparse


def patch_contact_identity(source: str) -> str:
    marker = "R8 queued contact identity and accepted impact v1"
    if marker in source:
        return source

    def one(old: str, new: str) -> None:
        nonlocal source
        count = source.count(old)
        if count != 1:
            raise ValueError(f"expected one contact-identity anchor, got {count}: {old[:110]}")
        source = source.replace(old, new, 1)

    one('      if (!e.combat?.nearBurst || !e.alive || e.caps?.destroyed || !e.veh) continue;',
        '''      if (!e.combat?.nearBurst || !e.alive || e.caps?.destroyed || !e.veh) continue;
      const actor = e.combat.replayAdmission?.actorForKey(e.combatKey) ?? e.combat.surfaceOwner?.actors?.get(e.combatKey)?.actor ?? null;
      if (q.combat !== e.combat || q.key !== e.combatKey || q.vehicle !== e.veh || q.epoch !== (e.heContactEpoch || 0) || !!q.actor !== !!actor || q.actor && ["battle", "entity", "life"].some(k => q.actor[k] !== actor[k])) continue;''')
    start = source.index('  function heContactEffects(')
    end = source.index('  function mixState(', start)
    source = source[:start] + '''  // R8 queued contact identity and accepted impact v1
  function heContactEffects(e, shell, point, dir, rep, time_s) {
    if (!rep || !["he", "hesh", "heat", "heat_fs"].includes(shell?.kind) || !e.combat?.nearBurst || rep.caps?.destroyed || !rep.impact || !e.veh?.body) return rep;
    if (!(Number.isFinite(shell.explosive_mass_kg) && shell.explosive_mass_kg > 0)) return rep;
    // The collision helper can report a broadphase running-gear point. Only
    // the accepted combat contact locates this already initiated charge.
    const impact = arr3(rep.impact), incoming = e.veh.body.localDir(dir);
    if (impact.length !== 3 || !impact.every(Number.isFinite)) return rep;
    let n = rep.normal ? arr3(rep.normal) : incoming.map(q => -q);
    if (n.reduce((sum, q, i) => sum + q * incoming[i], 0) > 0) n = n.map(q => -q);
    const local = impact.map((q, i) => q + n[i] * 0.001);
    const includePressure = !(rep.bursts || []).some(b => b.inside === false && b.explosive_kg > 0);
    const registeredSurface = e.combat.surfaceOwner?.actors?.has(e.combatKey);
    const actor = e.combat.replayAdmission?.actorForKey(e.combatKey) ?? e.combat.surfaceOwner?.actors?.get(e.combatKey)?.actor ?? null;
    HE_CONTACT_QUEUE.push({ e, local, shell: { ...shell }, seed: (((rep.shot?.seed ?? 1) ^ 2654435769) + 1) >>> 0, time_s, includePressure, plates: !registeredSurface && (shell.caliber_mm || 0) <= HE_CONTACT_PLATES_MM,
      combat: e.combat, key: e.combatKey, vehicle: e.veh, epoch: e.heContactEpoch || 0, actor: actor ? { battle: actor.battle, entity: actor.entity, life: actor.life } : null });
    if (HE_CONTACT_QUEUE.length > 48) flushHeContactBursts(null, false);
    rep.he_contact = { raw_explosive_kg: shell.explosive_mass_kg, point: e.veh.body.worldPoint(impact), queued: true, include_pressure: includePressure, response: "actual_surface_external_components" };
    return rep;
  }
''' + source[end:]
    one('    if (combat && !fresh) return false;\n    e.cstate = fresh ? fresh.state : null;',
        '    if (combat && !fresh) return false;\n    e.heContactEpoch = (e.heContactEpoch || 0) + 1;\n    e.cstate = fresh ? fresh.state : null;')
    return source


def patch(source: str) -> str:
    marker = "R8 actual-point blast routing v1"
    if marker in source:
        return patch_contact_identity(source)

    def one(old: str, new: str) -> None:
        nonlocal source
        count = source.count(old)
        if count != 1:
            raise ValueError(f"expected one reviewed anchor, got {count}: {old[:110]}")
        source = source.replace(old, new, 1)

    # Remove the guessed AABB/nearest-plate/crew-station charge relocation.
    start = source.index("  // Plate an HE charge in contact can blow through")
    end = source.index("  var HE_CONTACT_QUEUE = [];", start)
    source = source[:start] + f"  // {marker}: posed geometry owns exposure; no synthetic internal charges.\n" + source[end:]
    start = source.index("  // Autocannon rounds (40 mm and under;")
    end = source.index("  var HE_CONTACT_BUDGET_MS = 6;", start)
    source = source[:start] + "  // Retain the user's small-round budget policy; native fallback now checks each station.\n  var HE_CONTACT_PLATES_MM = 40;\n" + source[end:]

    start = source.index("  function heContactEffects(")
    end = source.index("  function mixState(", start)
    source = source[:start] + '''  function heContactEffects(e, shell, point, dir, rep, time_s) {
    if (!rep || !["he", "hesh", "heat", "heat_fs"].includes(shell?.kind) || !e.combat?.nearBurst || rep.caps?.destroyed) return rep;
    if (!(Number.isFinite(shell.explosive_mass_kg) && shell.explosive_mass_kg > 0)) return rep;
    let n = rep.normal ? e.veh.body.worldDir(arr3(rep.normal)) : dir.map(q => -q);
    if (n.reduce((sum, q, i) => sum + q * dir[i], 0) > 0) n = n.map(q => -q);
    // A millimetre query offset avoids beginning exactly on the struck surface.
    // It is not a second explosion, a hull-center estimate, or a breach route.
    const local = e.veh.body.localPoint(point.map((q, i) => q + n[i] * 0.001));
    const includePressure = !(rep.bursts || []).some(b => b.inside === false && b.explosive_kg > 0);
    const registeredSurface = e.combat.surfaceOwner?.actors?.has(e.combatKey);
    HE_CONTACT_QUEUE.push({ e, local, shell: { ...shell }, seed: (((rep.shot?.seed ?? 1) ^ 2654435769) + 1) >>> 0, time_s, includePressure, plates: !registeredSurface && (shell.caliber_mm || 0) <= HE_CONTACT_PLATES_MM });
    if (HE_CONTACT_QUEUE.length > 48) flushHeContactBursts(null, false);
    rep.he_contact = { raw_explosive_kg: shell.explosive_mass_kg, point: point.slice(), queued: true, include_pressure: includePressure, response: "actual_surface_external_components" };
    return rep;
  }
''' + source[end:]
    one('r = e.combat.nearBurst(e.combatKey, e.cstate, q.local, { ...q.shell, kind: "he", explosive_mass_kg: q.kg }, e.turretYaw || 0, q.seed, null, q.time_s, q.plates);',
        'r = e.combat.nearBurst(e.combatKey, e.cstate, q.local, q.shell, e.turretYaw || 0, q.seed, null, q.time_s, q.plates, q.includePressure);')
    one('r.he_contact = { tnt_kg: q.kg, queued: true };',
        'r.he_contact = { raw_explosive_kg: q.shell.explosive_mass_kg, queued: true, include_pressure: q.includePressure };')
    one('plates = false) {\n      this._applyFold(id2);', 'plates = false, includePressure = true) {\n      this._applyFold(id2);')
    one('prepared?.context ?? null, !!surface);', 'prepared?.context ?? null, !!surface, includePressure);')
    one('response: "uncalibrated_gameplay_fragments"', 'response: "uncalibrated_gameplay_blast_and_fragments"')
    one('combatNearBurst(key4, state, at2, shell, yaw, seed2, context = null, surface = false)',
        'combatNearBurst(key4, state, at2, shell, yaw, seed2, context = null, surface = false, includePressure = true)')
    one('key: key4, state, at: at2, shell, yaw, seed: combatSeed(seed2, this.combatReplayRevision), context });',
        'key: key4, state, at: at2, shell, yaw, seed: combatSeed(seed2, this.combatReplayRevision), context, include_pressure: includePressure });')

    one('function splashNear(pt, shell, own2 = true, source = null, time_s = G4.time) {\n      shell = tntCharge(shell);',
        'function splashNear(pt, shell, own2 = true, source = null, time_s = G4.time, exclude = null) {')
    one('if (!e.combat || !e.alive || e.remote && G4.online) continue;\n        if (Math.hypot(e.x - pt[0]',
        'if (e === exclude || !e.combat || !e.alive || e.remote && G4.online) continue;\n        if (Math.hypot(e.x - pt[0]')
    start = source.index('        const breach = heStandoffBreach(e, shell, pt, time_s,')
    end = source.index('        sound.resolvedContact?.(rep, shell,', start)
    source = source[:start] + source[end:]

    # Shell impacts already own ground/building splash. Bomb aftermath delegates
    # only a missing nearby-target burst, retaining its actual contact point.
    start = source.index('    /**\n     * A bomb\'s burst beside a vehicle')
    end = source.index('    /** Is any ground vehicle within', start)
    source = source[:start] + '''    /** Store aftermath only supplies a missing exterior blast at its recorded contact. */
    function bombBlast(at, tnt, shell, reachK = 2, resolved = false, exclude = null) {
      if (G4.online || !G4.combat || !(tnt > 0) || resolved) return;
      splashNear(at, shell, true, null, G4.time, exclude);
    }
''' + source[end:]
    one('const at = b.sh.s.pos.slice(), g = surfaceAt(at[0], at[2]);',
        'const at = (b.sh.groundBlastPoint || b.sh.s.pos).slice(), g = surfaceAt(at[0], at[2]);')
    one('bombBlast(at, b.kg, b.sh.shell, 1.6);',
        'bombBlast(at, b.kg, b.sh.shell, 1.6, !!b.sh.groundBlastResolved || !b.sh.groundBlastPoint, b.sh.groundBlastTarget || null);')
    one('bombBlast(at, b.kg, b.sh.shell);',
        'bombBlast(at, b.kg, b.sh.shell, 2, !!b.sh.groundBlastResolved || !b.sh.groundBlastPoint, b.sh.groundBlastTarget || null);')
    one('if (sh.from == null) splashNear(bh.point, sh.shell);',
        'if (sh.from == null) { splashNear(bh.point, sh.shell); sh.groundBlastResolved = true; sh.groundBlastPoint = bh.point.slice(); }')
    one('              splashNear(pt, sh.shell);\n              G4.lastHit = { type: "ground",',
        '              splashNear(pt, sh.shell);\n              sh.groundBlastResolved = true; sh.groundBlastPoint = pt.slice();\n              G4.lastHit = { type: "ground",')
    one('if (!(e.remote && G4.online)) rep = heContactEffects(e, sh.shell, eh.hit.point, dir, rep, G4.time);',
        'if (!(e.remote && G4.online)) rep = heContactEffects(e, sh.shell, eh.hit.point, dir, rep, G4.time);\n              sh.groundBlastPoint = eh.hit.point.slice(); sh.groundBlastTarget = e;')

    player_helper = '''    // A player's exterior contact is an accepted followup, not a fabricated source.
    function playerExteriorContact(shell, worldDir, rep) {
      if (G4.online || !rep || rep.caps?.destroyed || !rep.impact || !G4.combat?.nearBurst || !["he", "hesh", "heat", "heat_fs"].includes(shell?.kind) || !(shell.explosive_mass_kg > 0)) return rep;
      const dir = G4.veh.body.localDir(worldDir);
      let normal = rep.normal ? arr3(rep.normal) : dir.map(q => -q);
      if (normal.reduce((sum, q, i) => sum + q * dir[i], 0) > 0) normal = normal.map(q => -q);
      const at = arr3(rep.impact).map((q, i) => q + normal[i] * 0.001);
      const includePressure = !(rep.bursts || []).some(b => b.inside === false && b.explosive_kg > 0);
      let extra;
      try {
        extra = G4.combat.nearBurst(G4.combatKey, rep.state, at, shell, G4.T?.[0]?.yaw || 0, (((rep.shot?.seed ?? 1) ^ 2654435769) + 1) >>> 0, null, G4.time, false, includePressure);
      } catch (error) { console.error("player exterior contact rejected:", error); return rep; }
      if (!extra) return rep;
      const changed = JSON.stringify(rep.state) !== JSON.stringify(extra.state);
      rep.state = extra.state; rep.caps = extra.caps;
      if (extra.caps?.destroyed) rep.title = extra.title;
      for (const key of ["crew", "modules", "events", "fragments", "bursts", "geometry_contacts", "impact_events", "cause_transitions"]) rep[key] = [...rep[key] || [], ...extra[key] || []];
      if (changed) {
        if (extra.replay) { rep.replay = extra.replay; rep.replay_phase = "contact_exterior_followup"; delete rep.replay_unavailable; }
        else { delete rep.replay; rep.replay_unavailable = "contact_exterior_followup_not_in_single_replay"; }
      }
      return rep;
    }
'''
    one('    function selfMissileHit(', player_helper + '    function selfMissileHit(')
    one('      sound.resolvedContact?.(rep, war, b, { position: pt, time: G4.time });',
        '      rep = playerExteriorContact(war, dir, rep);\n      sound.resolvedContact?.(rep, war, b, { position: pt, time: G4.time });')
    one('      sound.resolvedContact?.(rep, shell, b, { position: p1, time: G4.time });',
        '      rep = playerExteriorContact(shell, dir, rep);\n      if (rep.replay && rep.replay_phase === "contact_exterior_followup") { G4.replayEvidence = rep.replay; presentVictimReplay(rep.replay); }\n      sound.resolvedContact?.(rep, shell, b, { position: p1, time: G4.time });')
    if any(token in source for token in ['function heInternalBurst(', 'function heStandoffBreach(', 'thinnestPlateNear(']):
        raise ValueError('synthetic explosion route survived patch')
    return patch_contact_identity(source)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    content = args.input.read_text(encoding='utf-8')
    candidate = patch(content)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(candidate, encoding='utf-8', newline='\n')
    print(f'R8 blast-route candidate: {args.output} ({len(candidate)} characters)')

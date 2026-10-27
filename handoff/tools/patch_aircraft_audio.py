#!/usr/bin/env python3
"""Guarded, idempotent AUDIO-ONLY app-suffix patch for the Me262 U4.

This does not rewrite a data bundle, generate assets, deploy or restart anything.
Import apply_patch(text) when packaging a reviewed published suffix. The shared
implementation app is deliberately forbidden as a CLI output; edit it by hunks.
"""
import argparse
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ASSET_PIN = '7a35444f326a3234f7bdf6ad84ff8d2a561edc00d1824740ebc236dd6bf46bd4'
CUE_SHA = 'aa293ec0579048b834650b727890686bb58e4a93b1618861ef0f21877766f185'
OLD_REPORT = '''    const AIR_SHOT_GAIN = { mg: 0.85, cannon: 0.95, m2: 0.8, m3: 0.8, mg131: 0.85, hispano: 0.95, nr23: 0.95, n37: 1, nr30: 1, type97: 0.85, ubs: 0.8, type99: 0.95, shvak: 0.95, mk108: 1, aden: 1 };
    function airShot(kind2, n, at2, vel, time) {
      const full = sound.full, id2 = `air_${kind2}_shot_${1 + (n * 7 + Math.floor(Math.random() * 4)) % 4}`;
      if (!full?.bank?.cues?.[id2]) return false;
      full.play(id2, { position: at2, velocity: vel, gain: AIR_SHOT_GAIN[kind2] ?? 0.9, rate: 0.96 + Math.random() * 0.08, emitterId: "player:air", time });
      return true;
    }'''
WRAPPER = '''    function airShotAudioAudible() {
      return (G4.mode === "frontline" || (G4.mode === "battle" || G4.mode === "test") && !G4.paused) && !document.hidden && !G4.thumbShot;
    }
    const aircraftShotAudio = createAircraftShotAudio(sound,{audible:airShotAudioAudible});
    sound.aircraftShots = aircraftShotAudio;
    installAircraftAudioGestures(sound,window,e=>G4.mode === "frontline" || !!e.target?.closest?.('#frontline-ui,#frontline-open'));
    function airShot(kind2, n, at2, vel, time, emitterId = "player:air") {
      return aircraftShotAudio.play(kind2,n,at2,vel,time,emitterId);
    }'''


def hunks():
    helper = (HERE / 'aircraft_shot_audio.js').read_text()
    report = '    // BEGIN AIRCRAFT SHOT AUDIO\n' + helper + '    // END AIRCRAFT SHOT AUDIO\n' + WRAPPER
    ai = '          if (Math.hypot(...sub(o, G4.camPos)) < 2500) sound.mg(Math.min(20, g.def?.caliber_mm || 20), { weaponId: "bot_air_gun", emitterId: `bot/${g.id}`, eventId: g.fired, position: o, direction: fwd, velocity: vel, time: G4.time });'
    ai_fixed = '''          if (Math.hypot(...sub(o, G4.camPos)) < 2500) {
            if(g.sound === "mk214a") {
              const shell=data.projectiles[g.belt[g.fired % g.belt.length]],emitterId=`bot/${airBots.list.indexOf(b)}/${g.id}`;
              if(!airShot(g.sound,g.fired,o,vel,G4.time,emitterId)) sound.shot(shell.caliber_mm,{weaponId:"air_cannon",generic:true,emitterId,eventId:g.fired,position:o,direction:fwd,velocity:vel,time:G4.time});
            } else sound.mg(Math.min(20, g.def?.caliber_mm || 20), { weaponId: "bot_air_gun", emitterId: `bot/${g.id}`, eventId: g.fired, position: o, direction: fwd, velocity: vel, time: G4.time });
          }'''
    factory = '        for(const g of out){\n          const key=g.id.match(/^air_(.+)_\\d+$/)?.[1],ports=f.spec.gunPorts?.[key];'
    player = 'if (!airShot(g.sound, g.fired, o, vel, shotTime)) sound.shot(20, { weaponId: "air_cannon", generic: true,'
    return [
        ('50mm_source_cue_dispatch', OLD_REPORT, report),
        ('cancel_pending_audio', '    cancelFull() {\n      for (const voice of [...this.delayedReloads.values()]) voice.stop();\n      this.full?.cancel();',
         '    cancelFull() {\n      for (const voice of [...this.delayedReloads.values()]) voice.stop();\n      this.aircraftShots?.clear();\n      this.full?.cancel();'),
        ('closed_context_user_gesture_recovery', '    /** Must be called from a user gesture. */\n    start() {\n      if (this.ctx) {',
         '    /** Must be called from a user gesture. */\n    start() {\n      if (this.ctx?.state === "closed") this.ctx = null;\n      if (this.ctx) {'),
        ('native_unknown_aircraft_50mm_dispatch', '    shot(caliber, event) {\n      if (this.fullOwned) return this.full?.weapon(caliber, event, "weapon");',
         '    shot(caliber, event) {\n      if (caliber === 50 && event?.weaponId === "air_cannon" && this.aircraftShots?.play("mk214a", event.eventId, event.position, event.velocity, event.time, event.emitterId)) return;\n      if (this.fullOwned) return this.full?.weapon(caliber, event, "weapon");'),
        ('u4_preset_predecode', factory, factory.replace('        for(const g of out){', '        for(const g of out){\n          if(g.sound === "mk214a" && typeof aircraftShotAudio !== "undefined") aircraftShotAudio.prepare(g.sound);')),
        ('offline_actual_caliber_fallback', player, player.replace('sound.shot(20,', 'sound.shot(shell.caliber_mm,')),
        ('offline_ai_50mm_cannon_report', ai, ai_fixed),
        ('frontline_audibility', '      sound.setFullAudible?.((G4.mode === "battle" || G4.mode === "test") && !G4.paused && !document.hidden && !G4.thumbShot);',
         '      sound.setFullAudible?.(airShotAudioAudible());'),
    ]


def apply_patch(text):
    receipt = []
    # Validate all guards first: an exception must never leave a partial output.
    for name, old, new in hunks():
        before, after = text.count(old), text.count(new)
        if (before, after) not in [(1, 0), (0, 1)]:
            raise ValueError(f'{name}: expected exactly one old OR new hunk, got {before}/{after}')
        receipt.append({'name': name, 'alreadyPatched': after == 1,
                        'oldSha256': hashlib.sha256(old.encode()).hexdigest(),
                        'newSha256': hashlib.sha256(new.encode()).hexdigest()})
    for _, old, new in hunks():
        if old in text:
            text = text.replace(old, new, 1)
    return text, receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=ROOT / 'handoff/bundle/app.js.html')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if args.output and args.output.resolve() == (ROOT / 'handoff/bundle/app.js.html').resolve():
        parser.error('Use targeted apply_patch for the shared app, never overwrite it with this packager')
    text = args.input.read_text()
    result, receipt = apply_patch(text)
    if args.check and result != text:
        raise SystemExit('Audio hunks are not installed')
    if args.output:
        args.output.write_text(result)
    manifest = {'version': 1, 'scope': 'client audio-only app suffix; no data/models/catalog/kernel changes',
                'assetPinUnchanged': ASSET_PIN, 'cue': 'report_kwk39_50', 'cueSha256': CUE_SHA,
                'recordingIdentity': 'Existing OPEX KwK39 50 mm game cue, substitute; not authentic MK214 recording',
                'inputSha256': hashlib.sha256(text.encode()).hexdigest(),
                'outputSha256': hashlib.sha256(result.encode()).hexdigest(), 'hunks': receipt}
    if args.manifest:
        manifest['exactHunks'] = [{'name': n, 'old': o, 'new': v} for n, o, v in hunks()]
        args.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k:v for k,v in manifest.items() if k != 'exactHunks'}, indent=2))


if __name__ == '__main__':
    main()

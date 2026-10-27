#!/usr/bin/env python3
"""Sync guarded C213 aircraft helpers into the current app, retaining all other work.

This never installs a historical app, data prefix, flight binary or Rust301 module.
--check performs the entire transform in memory and refuses stale output.
"""
from pathlib import Path
import argparse
import hashlib
import re

ROOT = Path(__file__).resolve().parents[2]
HELPERS = ROOT / 'handoff/tools/aircraft_performance'
BEGIN = '/* TF_AIRCRAFT_PERFORMANCE_BEGIN */'
END = '/* TF_AIRCRAFT_PERFORMANCE_END */'


def plain(text):
    return re.sub(r'^export (?=(?:function|const|class)\s)', '', text, flags=re.M)


def prelude():
    wing = plain((HELPERS / 'mig17-wing.mjs').read_text())
    return ('var TFMig17Wing=(()=>{' + wing +
            '\nreturn {normalizeMig17Wing,MIG17_WING_REVISION};})();\n' +
            plain((HELPERS / 'aircraft-render-cull.mjs').read_text()) + '\n' +
            '\n'.join((HELPERS / name).read_text() for name in
                      ['engine-layout-helper.js', 'mechanism-view.js', 'mechanism-fit-runtime.js']))


def once(source, before, after, label):
    if source.count(after) == 1:
        return source
    if source.count(before) != 1:
        raise ValueError(f'{label}: expected exactly one reviewed source hook')
    return source.replace(before, after, 1)


def patch(source):
    if BEGIN in source or END in source:
        if source.count(BEGIN) != 1 or source.count(END) != 1:
            raise ValueError('Ambiguous aircraft performance helper block')
        start = source.index(BEGIN)
        end = source.index(END, start) + len(END)
        source = source[:start] + BEGIN + '\n' + prelude() + '\n' + END + source[end:]
    else:
        marker = '<script>(() => {'
        if source.count(marker) != 1:
            raise ValueError('Unknown app wrapper')
        source = source.replace(marker, marker + '\n' + BEGIN + '\n' + prelude() + '\n' + END, 1)
    edits = [
        ('      if (this.mesh) out.push(this);',
         '      if (this.mesh && !this.aircraftHiddenSkin) out.push(this);', 'mechanism draw membership'),
        ('      AIRCRAFT_MODELS[id2] = { ...m, blob: null, buf, img, nimg };',
         '      const correctedWing = TFMig17Wing.normalizeMig17Wing(id2, m, buf);\n      AIRCRAFT_MODELS[id2] = { ...correctedWing.model, blob: null, buf: correctedWing.buf, img, nimg };', 'source MiG17 normalization'),
        ('      const geo = this.type.geometry(), mesh = (data) => {\n        const m = renderer.mesh(data);\n        this.meshes.push(m);',
         '      const geo = this.type.geometry(), mesh = (data) => {\n        const m = renderer.mesh(data);\n        m.aircraftGeometry = true;\n        this.meshes.push(m);', 'aircraft upload marker'),
        ('      const m = renderer.mesh(v || aircraftGeometry.store(def));\n      storeMeshes.set(key4, m);',
         '      const m = renderer.mesh(v || aircraftGeometry.store(def));\n      m.aircraftGeometry = true;\n      storeMeshes.set(key4, m);', 'store upload marker'),
        ('      if(!storeMeshes.has(key))storeMeshes.set(key,renderer.mesh(piece.data));',
         '      if(!storeMeshes.has(key)){const mesh=renderer.mesh(piece.data);mesh.aircraftGeometry=true;storeMeshes.set(key,mesh);}', 'authored store upload marker'),
        ('          const m = renderer.mesh(aircraftGeometry.pylon(top, bot, Math.min(1.4, it.def.len * .55), plane.type.fighter?.spec.colors.base || "#9aa2a5"));\n          plane.meshes.push(m);',
         '          const m = renderer.mesh(aircraftGeometry.pylon(top, bot, Math.min(1.4, it.def.len * .55), plane.type.fighter?.spec.colors.base || "#9aa2a5"));\n          m.aircraftGeometry = true;\n          plane.meshes.push(m);', 'pylon upload marker'),
        ('      for (const n of nodes) {\n        if (!n.castShadow) continue;\n        this._draw(this.depth, n);',
         '      const rejectAircraftShadow = createAircraftClipReject(lightVP);\n      for (const n of nodes) {\n        if (!n.castShadow || rejectAircraftShadow(n)) continue;\n        this._draw(this.depth, n);', 'exact shadow VP'),
        ('      const forward = cam?.forward || [0, 0, 1];\n      const bounds3 = this._meshCenters',
         '      const forward = cam?.forward || [0, 0, 1];\n      const rejectAircraftColour = createAircraftClipReject(cam?.viewProj);\n      const bounds3 = this._meshCenters', 'exact camera VP'),
        ('      for (const n of nodes) {\n        if (![6, 7, 10, 17].includes(n.kind)',
         '      for (const n of nodes) {\n        if (rejectAircraftColour(n)) continue;\n        if (![6, 7, 10, 17].includes(n.kind)', 'aircraft color rejection'),
        ('      const jet = spec.jet || {};\n      if (eng) {',
         '      const jet = spec.jet || {};\n      const fittedEngine = TFEngineLayout.build(T.id,T.model || (typeof AIRCRAFT_MODELS!==\'undefined\'?AIRCRAFT_MODELS[T.id]:null),{palette:"gray"});\n      if (eng && !fittedEngine) {', 'known-source fallback engines'),
        ('      out.internal = b.finish();',
         '      const baseInternal=TFMechanismFit.fitLegacy(T.id,T.model || (typeof AIRCRAFT_MODELS!==\'undefined\'?AIRCRAFT_MODELS[T.id]:null),b.finish());\n      if(fittedEngine){const count=fittedEngine.modules.reduce((n,m)=>n+m.data.length,baseInternal.length);out.internal=new Float32Array(count);out.internal.set(baseInternal);let offset=baseInternal.length;for(const module of fittedEngine.modules){out.internal.set(module.data,offset);offset+=module.data.length;}}else out.internal=baseInternal;', 'known-source fallback mechanism fit'),
        ('      for (const n of this.partNodes) n.visible = this.xray && !n.part.detached && !this.hitbox?.surface.has(n.part.id);',
         '      for (const n of this.partNodes) n.visible = this.xray && !this.internalNode && !n.part.detached && !this.hitbox?.surface.has(n.part.id);', 'hide duplicate box proxies in mechanism view'),
        ('      if (this.internalNode) this.internalNode.visible = this.xray;\n      this._showParts();',
         '      if (this.internalNode) this.internalNode.visible = this.xray;\n      this._showParts();\n      TFMechanismView.apply(this);', 'mechanism-only draw view'),
        ('      const noz = P.type.nozzle;',
         '      const noz = TFEngineLayout.nozzleFor(P.type.id,P.type.model) || P.type.nozzle;', 'fitted visual nozzle'),
        ('    const movers=type.model?.movers||[];',
         '''    // Rebinding a visual hinge must preserve the C213 physical travel ABI.
    const wingCorrection=type.model?.sourceBinding?.mig17WingCorrection;
    const sourceTravel=wingCorrection?.revision===2?[...wingCorrection.originalFlapMovers,...wingCorrection.originalRollMovers]:[];
    const movers=(type.model?.movers||[]).map(m=>sourceTravel.find(original=>original.name===m.name)||m);''', 'preserve original physical control travel')
    ]
    for component in ['skin', 'visor']:
        edits.append((f'          n.mesh = renderer.mesh({component});\n          this.meshes.push(n.mesh);',
                      f'          n.mesh = renderer.mesh({component});\n          n.mesh.aircraftGeometry = true;\n          this.meshes.push(n.mesh);', f'pilot {component} upload'))
    for before, after, label in edits:
        source = once(source, before, after, label)
    # Remove only generated visual cage/bay proxies from fallback construction.
    # Authored imported internalModules and accepted damage/contacts remain intact.
    start = source.index('    build.rebuiltExtras = function rebuiltExtras(spec, rec, T) {')
    end = source.index('    build.imported = function importedGeometry(', start)
    scope = source[start:end]
    spar = '        b.rod([sg * x0, w.c[1], w.c[2] + w.h[2] * 0.35]'
    if spar in scope:
        a = scope.index(spar); b = scope.index('        if (!AIR_NO_WING_TANKS.has(T.id))', a)
        scope = scope[:a] + scope[b:]
    frame = "      // the airframe's frames: a ring every ~0.9 m along the loft"
    if frame in scope:
        a = scope.index(frame); b = scope.index('      // the gear bays', a)
        scope = scope[:a] + scope[b:]
    if '      // the gear bays' in scope:
        a = scope.index('      // the gear bays'); b = scope.index('      const baseInternal=', a)
        scope = scope[:a] + scope[b:]
    source = source[:start] + scope + source[end:]
    # One synchronous prediction only; integration, sampling coordinates, weapon
    # gates and final interpolation arithmetic remain the production originals.
    start = source.index('    function storeImpact(air) {')
    end = source.index('\n    function ', start + 1)
    scope = source[start:end]
    if 'let previousClearance = pos[1] - surfaceAt(pos[0], pos[2]);' not in scope:
        scope = once(scope, '      for (let t = 0; t < 40; t += h) {',
                     '      let previousClearance = pos[1] - surfaceAt(pos[0], pos[2]);\n      for (let t = 0; t < 40; t += h) {', 'CCIP endpoint cache')
        scope = once(scope, '        const hit = groundHit(previous, pos, surfaceAt);',
                     '''        const h0 = previousClearance;
        const h1 = pos[1] - surfaceAt(pos[0], pos[2]);
        previousClearance = h1;
        let hit = null;
        if (!(h1 > 0)) {
          const k = h0 / Math.max(h0 - h1, 1e-6);
          const x = previous[0] + (pos[0] - previous[0]) * k;
          const z = previous[2] + (pos[2] - previous[2]) * k;
          hit = [x, surfaceAt(x, z), z];
        }''', 'CCIP unchanged crossing interpolation')
    return source[:start] + scope + source[end:]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, default=ROOT / 'handoff/bundle/app.js.html')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    source = args.app.read_text()
    result = patch(source)
    if args.check and result != source:
        raise SystemExit('Aircraft performance helpers/hooks are stale')
    if not args.check and result != source:
        args.app.write_text(result)
    print(('Verified ' if args.check else 'Synced ') + hashlib.sha256(result.encode()).hexdigest())


if __name__ == '__main__':
    main()

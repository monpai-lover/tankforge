#!/usr/bin/env python3
"""Transparent real airframe around mechanisms. Geometry/physics stay intact."""
from pathlib import Path
import argparse
ROOT=Path(__file__).resolve().parent
def patch_shell_shader(source):
 old='uniform float uScroll, uAlpha, uDirtHeight, uWet, uReplayCutaway;'
 new=old+'\nuniform float uAircraftShell;'
 assert source.count(old)==1,'Aircraft shell shader uniform is ambiguous'
 source=source.replace(old,new,1)
 old='        gl.uniform1f(L.u.uAlpha, n.replayAlpha ?? 1);'
 new=old+'\n        gl.uniform1f(L.u.uAircraftShell, n.aircraftShell || 0);'
 assert source.count(old)==1,'Aircraft shell draw uniform is ambiguous'
 source=source.replace(old,new,1)
 old='    alpha = mix(0.06, 0.62, rim);\n    col = mix(col * 0.6, uSkyColor * 2.2 + uSunColor * 0.03, rim * 0.6);'
 new=old+'\n    if (uAircraftShell > 0.0) {\n      // Aircraft-only: filled wings/tail and a contrasting rim remain readable\n      // against both the bright runway and dark sky. Tank O uses the old path.\n      float contour = pow(1.0 - NoV, 1.3);\n      alpha = mix(uAircraftShell, 0.84, contour);\n      col = mix(vec3(0.060, 0.085, 0.110), vec3(0.015, 0.028, 0.045), contour);\n    }'
 assert source.count(old)==1,'Aircraft shell appearance branch is ambiguous'
 source=source.replace(old,new,1)
 old='        for (const n of glass) drawLit(n);'
 new='        for (const n of glass) {\n          // O aircraft need their real surface depth for atmospheric fog. With\n          // sky depth the composite treats transparent wings as 400 km away.\n          gl.depthMask(n.kind === 6 && n.aircraftShell > 0);\n          drawLit(n);\n        }'
 assert source.count(old)==1,'Aircraft shell depth routing is ambiguous'
 return source.replace(old,new,1)

def patch_labels(source):
 # The hangar shares the parked tank's HUD. Only labels belonging to the visible
 # aircraft may be submitted while that aircraft replaces the tank.
 old='        for (const l of G4.interior.labels) {\n          if (l.anchor && !l.anchor.visible) continue;\n          const w = l.node.world;\n          const pr = project(viewProj, [w[12], w[13], w[14]]);'
 new='        const shownAircraft = flying ? G4.air.plane : airShown ? airG.plane : null;\n        const aircraftLabels = shownAircraft ? TFMechanismView.labels(shownAircraft, LANG) : null;\n        for (const l of aircraftLabels || G4.interior.labels) {\n          if (l.anchor && !l.anchor.visible) continue;\n          const w = l.node?.world;\n          const pr = project(viewProj, l.point || [w[12], w[13], w[14]]);'
 assert source.count(old)==1,'Aircraft garage label routing is ambiguous'
 source=source.replace(old,new,1)
 old='      if (G4.xray) {\n        const tags = [];'
 new='      if (G4.xray || flying && G4.air?.plane.xray) {\n        const tags = [];'
 assert source.count(old)==1,'Aircraft flight label visibility is ambiguous'
 return source.replace(old,new,1)

def patch(source):
 assert 'var TFMechanismView' not in source,'Mechanism view already installed'
 marker='  var aircraftGeometry = (() => {'
 assert source.count(marker)==1
 source=source.replace(marker,(ROOT/'mechanism-view.js').read_text()+'\n'+marker,1)
 old='      if (this.mesh) out.push(this);'
 assert source.count(old)==1,'Node.collect hook ambiguous'
 source=source.replace(old,'      if (this.mesh && !this.aircraftHiddenSkin) out.push(this);',1)
 old='      // a model\'s internal modules (engines, tanks, ducts, avionics, bays, structure) inside the see-through airframe\n      if (this.internalNode) this.internalNode.visible = this.xray;\n      this._showParts();'
 new=old+'\n      TFMechanismView.apply(this);'
 assert source.count(old)==1,'setXray hook ambiguous'
 source=source.replace(old,new,1)
 old='      for (const n of this.partNodes) n.visible = this.xray && !n.part.detached && !this.hitbox?.surface.has(n.part.id) && !(fittedEngineLayout && /^engine(?:_[lr])?$/.test(n.part.id));'
 if old in source:
  source=source.replace(old,old.replace('this.xray &&','this.xray && !this.internalNode &&'),1)
 # Legacy internals combine mechanisms and framework in one mesh. Omit only the
 # cage's two spar rods and circular former generator before that batch uploads.
 start=source.index('    build.rebuiltExtras = function rebuiltExtras(spec, rec, T) {')
 end=source.index('    build.imported = function importedGeometry(',start)
 scope=source[start:end]
 spar_start=scope.index('        b.rod([sg * x0, w.c[1], w.c[2] + w.h[2] * 0.35]')
 spar_end=scope.index('        if (!AIR_NO_WING_TANKS.has(T.id))',spar_start)
 scope=scope[:spar_start]+scope[spar_end:]
 frame_start=scope.index("      // the airframe's frames: a ring every ~0.9 m along the loft")
 frame_end=scope.index('      // the gear bays',frame_start)
 scope=scope[:frame_start]+scope[frame_end:]
 bay_start=scope.index('      // the gear bays')
 bay_end=scope.index('      const baseInternal=b.finish();',bay_start)
 scope=scope[:bay_start]+scope[bay_end:]
 source=source[:start]+scope+source[end:]
 return patch_shell_shader(patch_labels(source))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
 assert a.input.resolve()!=a.output.resolve()
 a.output.write_text(patch(a.input.read_text()))

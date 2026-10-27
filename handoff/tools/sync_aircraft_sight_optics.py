#!/usr/bin/env python3
"""Transplant six bounded optical hunks; do not replace the complete donor app.

Defaults to the actual bundle for --check. Applying requires a new --out path.
The helper is loaded beside this tool; old hunks are literal reviewed f3 source,
so no temporary file or complete historical donor is needed.
"""
import argparse,hashlib,json,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[2]
HELPER=pathlib.Path(__file__).with_name('aircraft_sight_optics.js')
HUNKS=[{'old': '  /** The convex hull of 2-D points (monotone chain), counter-clockwise. */', 'helper': True}, {'old': '      const holo = (col, fn) => {\n        // A combiner out of view cannot project an unrestricted screen-space reticle.\n        if (!combiner) return;\n        g.save();\n        if (combiner) {\n          g.beginPath();\n          g.moveTo(combiner[0][0], combiner[0][1]);\n          for (const q of combiner) g.lineTo(q[0], q[1]);\n          g.closePath();\n          g.clip();\n        }\n        const optics = P.type.model?.spec?.sight, designEye = optics?.eye || P.cockpitEye || P.type.eye;\n        const actualEye = G4.camPos && P.localPoint(G4.camPos), box = optics?.eyeBox || [.13, .10, .40];\n        if (actualEye && designEye) {\n          const edge = Math.max(...actualEye.map((v, i) => Math.abs(v - designEye[i]) / box[i]));\n          g.globalAlpha = Math.max(0, Math.min(1, (1.25 - edge) / .35));\n        }\n        g.globalCompositeOperation = "lighter";\n        g.shadowColor = col;\n        // A soft emission halo under a crisp collimated core, both clipped by the real aperture.\n        const alpha=g.globalAlpha;\n        g.globalAlpha=alpha*.22;g.shadowBlur=6;fn();\n        g.globalAlpha=alpha;g.shadowBlur=0;fn();\n        g.restore();\n      };\n', 'new': '      const sightOptics=aircraftCollimatedOptics(P,G4.camPos,p=>{const r=raw(p);return r[2]>0?px(r):null;},combiner,renderer.env||{});\n      const holo=(col,paint)=>drawAircraftCollimatedSight(g,sightOptics,col,paint,dpr);\n'}, {'old': '      // Collimated rays originate at the actual camera, with direction solved at the design eye.\n      // Head translation moves the glass aperture, not the distant reticle (optical infinity).\n      const sightProject = point => {\n        const eye = G4.camPos || pos, design = P.worldPoint(P.cockpitEye || P.type.eye);\n        const dir = norm(sub(point, design));\n        return proj(eye.map((v, i) => v + dir[i] * 1e6));\n      };\n', 'new': '      // One design eye and actual-camera infinity rays serve every optical symbol and ring.\n      const sightProject=point=>sightOptics.point(point);\n      const sightRing=(direction,halfAngle)=>sightOptics.ring(direction,halfAngle);\n'}, {'old': 'const rr=ring(noseOf(P),.012),font=', 'new': 'const rr=sightRing(noseOf(P),.012),font='}, {'old': 'const hud = SIGHT.startsWith("rgba(120"), pd = norm(sub(air.pipper.at, pos)), rr = ring(pd, hud ? 0.04 : 0.05), R = rr ? Math.max(12, rr[2]) : 18;', 'new': 'const hud = SIGHT.startsWith("rgba(120"), rr = sightOptics.ringPoint(air.pipper.at, hud ? 0.04 : 0.05);\n        if(!rr)return;\n        const R=rr[2];'}, {'old': 'const nose = noseOf(P), ring50 = ring(nose, 0.05), ring100 = ring(nose, 0.1);', 'new': 'const nose = noseOf(P), ring50 = sightRing(nose, 0.05), ring100 = sightRing(nose, 0.1);'}]

def digest(value):return hashlib.sha256(value.encode('utf-8')).hexdigest()

def patch(source,helper=None):
    helper=HELPER.read_text()if helper is None else helper
    if 'function aircraftCollimatedOptics('in source:raise ValueError('Optics helper already present; use --check')
    report=[]
    for hunk in HUNKS:
        old=hunk['old'];new=helper+'\n'+old if hunk.get('helper')else hunk['new']
        if source.count(old)!=1:raise ValueError('Expected exactly one original optical hunk: '+old[:80])
        source=source.replace(old,new,1)
        report.append({'oldSha256':digest(old),'newSha256':digest(new),'oldBytes':len(old.encode()),'newBytes':len(new.encode())})
    return source,report

def check(source):
    helper=HELPER.read_text()
    if source.count(helper)!=1:raise ValueError('Actual app does not contain the exact helper source')
    for hunk in HUNKS:
        new=helper+'\n'+hunk['old']if hunk.get('helper')else hunk['new']
        if source.count(new)!=1:raise ValueError('Actual app does not match the new optical hunk')

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--app',type=pathlib.Path,default=ROOT/'handoff/bundle/app.js.html');p.add_argument('--out',type=pathlib.Path);p.add_argument('--manifest',type=pathlib.Path);p.add_argument('--check',action='store_true');a=p.parse_args()
    raw=a.app.read_bytes();source=raw.decode('utf-8')
    if a.check:
        if a.out:p.error('--check does not write output')
        check(source);print('Actual optical helper and6hunks source match');return
    if not a.out or a.out.exists()or a.out.resolve()==a.app.resolve():p.error('Applying requires a new --out file distinct from input')
    result,hunks=patch(source);check(result);out=result.encode('utf-8')
    with a.out.open('xb')as f:f.write(out)
    report={'sourceAppSha256':hashlib.sha256(raw).hexdigest(),'outputAppSha256':hashlib.sha256(out).hexdigest(),'helperSha256':digest(HELPER.read_text()),'hunks':hunks,'scope':'Optics presentation only; no equipment, historical reticle, aircraft metadata, weapons or ballistic computer change.'}
    if a.manifest:
        with a.manifest.open('x')as f:f.write(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
if __name__=='__main__':main()

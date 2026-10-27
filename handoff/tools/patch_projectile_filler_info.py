#!/usr/bin/env python3
"""Stage source-bound raw filler labels without overwriting the shared app/data."""
import argparse,hashlib,json
from pathlib import Path
HERE=Path(__file__).resolve().parent
APP=HERE.parent/'bundle/app.js.html'
START='  // BEGIN PROJECTILE FILLER INFORMATION\n'
END='  // END PROJECTILE FILLER INFORMATION\n'

def hunks():
    old=r'''        slot.title = `${a.shell.name}\u3000${a.shell.penetration_curve[0].pen_mm.toFixed(0)} mm @0 m\u3000${a.shell.muzzle_velocity_ms.toFixed(0)} m/s`;'''
    new=old.replace(' m/s`;', ' m/s　${projectileFillerLabel(a.shell,LANG)}`;')
    deploy=r'''${s.explosive_mass_kg > 0 ? `\u3000\u88DD\u85E5 ${(s.explosive_mass_kg * 1e3).toFixed(0)} g` : ""}'''
    garage='''          rows.push(["\\u3000\\u7A7F\\u6DF1", `${best.penetration_curve[0].pen_mm.toFixed(0)} mm @0 m\\u3000${penAt(best, 1e3).toFixed(0)} mm @1000 m${g.ammo.length > 1 ? `\\uFF08${shellTypeLabel(shellKind(best))}\\uFF09` : ""}`]);'''
    garage_new=garage+'\n          rows.push(["　裝藥", g.ammo.map(a=>`${a.shell.name}: ${projectileFillerLabel(a.shell,LANG)}`).join("；")]);'
    air='''+ row("武裝", i.guns) + row("全重", i.mass)'''
    air_new='''+ row("武裝", i.guns) + row("彈鏈與裝藥", aircraftBeltFillerInfo(aircraftGuns(id2),data.projectiles,g=>G4.bulletShells.get(g.def?.id)||bulletShell(g.def),LANG)) + row("全重", i.mass)'''
    return [('hud_ammo_title',old,new),('deploy_raw_filler',deploy,'${`　${projectileFillerLabel(s,LANG)}`}'),('garage_ammo_filler',garage,garage_new),('aircraft_belt_filler',air,air_new)]

def apply_patch(text):
    proof=[]
    for name,old,new in hunks():
        counts=text.count(old),text.count(new)
        # A new hunk can contain its old anchor (the added garage information).
        if counts[1]==1:proof.append({'name':name,'alreadyPatched':True});continue
        if counts!=(1,0):raise ValueError(f'{name}: expected one original hunk, got {counts}')
        proof.append({'name':name,'alreadyPatched':False})
    for _,old,new in hunks():
        if text.count(new)!=1:text=text.replace(old,new,1)
    helper=(HERE/'projectile_filler_info.js').read_text(encoding='utf8')
    block=START+helper+'\n'+END
    if START in text:
        a=text.index(START);b=text.index(END,a)+len(END);text=text[:a]+block+text[b:]
    else:
        anchor='  var Hud = class {'
        if text.count(anchor)!=1:raise ValueError('Original HUD class anchor is ambiguous')
        text=text.replace(anchor,block+anchor,1)
    return text,proof

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',type=Path,default=APP);p.add_argument('--output',type=Path,required=True);p.add_argument('--manifest',type=Path);a=p.parse_args()
    if a.output.resolve()==APP.resolve():p.error('Stage a separate candidate; ROOT owns shared application integration')
    before=a.input.read_bytes().decode('utf8');after,proof=apply_patch(before);a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_bytes(after.encode('utf8'))
    result={'inputSha256':hashlib.sha256(before.encode()).hexdigest(),'outputSha256':hashlib.sha256(after.encode()).hexdigest(),'scope':'raw filler information only; no catalogs, physics, assets or WASM changes','hunks':proof}
    if a.manifest:a.manifest.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':main()

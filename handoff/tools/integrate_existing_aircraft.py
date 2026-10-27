"""Install narrow shared-aircraft hooks; --output stages without writing the app."""
import argparse
from pathlib import Path

APP=Path(__file__).resolve().parents[1]/'bundle/app.js.html'


def apply_patch(text):
    def once(old,new):
        nonlocal text
        if new in text:return
        assert text.count(old)==1,old[:120]
        text=text.replace(old,new,1)
    if '    function stepPlayerAircraftPilot(dt) {' not in text:
        start=text.index('        // the pipper each other frame (also drawn by the HUD)')
        end=text.index('        stepAircraftGuns(dt);',start)
        body=text[start:end]
        shared='    function stepPlayerAircraftPilot(dt) {\n'+''.join(line[2:] if line.startswith('        ') else line for line in body.splitlines(keepends=True))+'    }\n'
        text=text[:start]+'        stepPlayerAircraftPilot(dt);\n'+text[end:]
        anchor='    function update(dt) {\n';assert text.count(anchor)==1
        text=text.replace(anchor,shared+anchor,1)
    once('      if (!air?.active || !airInputOpen() && name !== "keys") return false;\n      switch (name) {',
         '      if (!air?.active || !airInputOpen() && name !== "keys") return false;\n      if (air.nativeAuthority) { const handled=G4.frontline?.handleAircraftAction(name,stamp); if(handled!==undefined)return handled; }\n      switch (name) {')
    once('        if (e.repeat) return;\n        if (G4.air?.active && G4.air.online) hud.toast(',
         '        if (e.repeat) return;\n        if (G4.air?.nativeAuthority) { G4.frontline.returnToGarage(); return; }\n        if (G4.air?.active && G4.air.online) hud.toast(')
    once('    const airTargetList = () => airBots.list.filter(',
         '    const airTargetList = () => G4.air?.nativeAuthority ? G4.frontline.airTargets() : airBots.list.filter(')
    once('      const id2 = armEd.dataset.air, slots = airSlots(id2), pick = G4.airCustom[id2] || {};',
         '      const id2 = armEd.dataset.air, slots = airSlots(id2), pick = G4.airCustom[id2] || {};\n      const nativeArms=G4.frontline?.shared?.room()?G4.frontline.aircraftOptions.find(o=>o.id===id2):null;')
    once('          const n = sl.options.get(sid), why = sl.incomplete?.get(sid) || (n && AIR_STORE_DEFS[sid].incomplete);',
         '          const hostSlot=nativeArms?.slots?.find(s=>s.key===sl.key);\n          const n = sl.options.get(sid), why = sl.incomplete?.get(sid) || (n && AIR_STORE_DEFS[sid].incomplete) || (nativeArms && n && (hostSlot?.unsupported?.[sid] || (!hostSlot?.options?.[sid] ? "当前服务器未开放此挂载" : null)));')
    once('    function toGarage() {\n      removeAircraft();',
         '    function toGarage() {\n      if (G4.frontline?.active && G4.air?.nativeAuthority) return G4.frontline.returnToGarage();\n      removeAircraft();')
    once('      const los = airLoadouts(id2), cur = Math.min(los.length - 1, G4.airLoadout[id2] || 0);',
         '      // TF_NATIVE_LOADOUT_SELECTION: display the same saved choice that launch validates.\n'
         '      const los = airLoadouts(id2), native = !!G4.frontline?.shared?.room(),\n'
         '        cur = native ? frontlineLoadoutIndex(G4.airLoadout[id2] ?? 0) : Math.min(los.length - 1, G4.airLoadout[id2] || 0);')
    once('${what(los[cur])}</p></div>`;',
         '${native && !los[cur] ? "保存配置不可用，请重新选择" : what(los[cur])}</p></div>`;')
    once('      const b = e.target.closest?.(".air-lo");',
         '      const b = e.target.closest?.("button.air-lo[data-lo]");')
    if 'TF_NATIVE_GARAGE_INFO' not in text:
        start=text.index('    function renderAirInfo(id2) {');end=text.index('\n    }',start)
        text=text[:end]+'\n      // TF_NATIVE_GARAGE_INFO: the info panel owns and replaces its children.\n      G4.frontline?.refreshGarageControls?.(id2);'+text[end:]
    return text


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',type=Path,default=APP);p.add_argument('--output',type=Path);p.add_argument('--check',action='store_true');a=p.parse_args()
    original=a.input.read_bytes().decode('utf8');updated=apply_patch(original)
    if a.check:
        assert original==updated,'Run integrate_existing_aircraft.py after refreshing aircraft UI source'
        return
    output=a.output or APP
    output.write_bytes(updated.encode('utf8'))
    if a.output:return
    client_path=Path(__file__).resolve().parent/'frontline_client.js';client=client_path.read_text(encoding='utf8')
    old="if(m.op==='left'){renderGate.clear();";new="if(m.op==='left'){f.establishedFlight.release(true);renderGate.clear();"
    if old in client:
        assert client.count(old)==1;client_path.write_text(client.replace(old,new,1),encoding='utf8')


if __name__=='__main__':main()

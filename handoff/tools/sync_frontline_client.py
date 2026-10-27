#!/usr/bin/env python3
"""Keep the source-owned frontline client embedded in the shipped single-file bundle."""
import argparse
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
START='    // BEGIN NATIVE FRONTLINE CLIENT\n'
END='    // END NATIVE FRONTLINE CLIENT\n'
GLOBAL_START='  // BEGIN NATIVE FRONTLINE GLOBAL HELPERS\n'
GLOBAL_END='  // END NATIVE FRONTLINE GLOBAL HELPERS\n'


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    path=ROOT/'bundle/app.js.html';text=path.read_bytes().decode('utf-8')
    # R8.3 carries separately owned CM/guidance/precision/worker extensions.
    # Its canonical client must only be updated through reviewed narrow owners;
    # replacing the entire block would silently erase installed extensions.
    if '/* TF_AIRWAR_PRESENTATION_BEGIN */' in text:
        composed = subprocess.run(['node', '--input-type=module', '-e',
            'import fs from "node:fs"; import {applyR82AirwarFixes} from "./handoff/tools/apply_r82_airwar_fixes.mjs"; import {applyR83AirwarFixes} from "./handoff/tools/apply_r83_airwar_fixes.mjs"; process.stdout.write(applyR83AirwarFixes(applyR82AirwarFixes(fs.readFileSync(0,"utf8"))));'],
            input=text.encode('utf-8'),capture_output=True,cwd=ROOT.parent,check=True)
        expected=composed.stdout.decode('utf-8')
        if args.check:assert text==expected,'Run the reviewed R8.3 narrow client owners'
        else:path.write_bytes(expected.encode('utf-8'))
        return
    # NetClient and Renderer are outside initialise(); their helpers must share
    # that outer closure. Local-only model/UI helpers keep their existing scope.
    global_source='\n'.join((ROOT/'tools'/name).read_text() for name in
        ['frontline_wire.js','frontline_bridge_geometry.js','frontline_water_cutout.js','frontline_terrain_geometry.js',
         'frontline_map_background.js'])
    global_block=GLOBAL_START+global_source+GLOBAL_END
    if GLOBAL_START in text:
        first=text.index(GLOBAL_START);last=text.index(GLOBAL_END,first)+len(GLOBAL_END)
        text=text[:first]+global_block+text[last:]
    else:
        anchor='<script>(() => {\n';assert text.count(anchor)==1
        text=text.replace(anchor,anchor+global_block)
    source='\n'.join((ROOT/'tools'/name).read_text() for name in
        ['frontline_lod.js','frontline_contact_visual.js','frontline_local_flight.js','frontline_aircraft_visual.js','frontline_existing_aircraft.js','frontline_guided_control.js','frontline_ordnance_visual.js','frontline_gun_tracer_visual.js','frontline_airwar_presentation.js','frontline_naval_visual.js','frontline_existing_runtime.js','frontline_render_gate.js','frontline_facility_visual.js','frontline_support_visual.js','frontline_shared_lobby.js','frontline_client.js'])
    block=START+source+END
    if START in text:
        first=text.index(START);last=text.index(END,first)+len(END)
        expected=text[:first]+block+text[last:]
    else:
        anchor='    const renderScale = new RenderScale();'
        assert text.count(anchor)==1
        expected=text.replace(anchor,block+anchor)
    guided = subprocess.run(['node', '--input-type=module', '-e',
        'import fs from "node:fs"; import {patchFrontlineGuidedSourceHooks} from "./handoff/tools/sync_frontline_guided.mjs"; process.stdout.write(patchFrontlineGuidedSourceHooks(fs.readFileSync(0,"utf8")));'],
        input=expected.encode('utf-8'), capture_output=True, cwd=ROOT.parent, check=True)
    expected = guided.stdout.decode('utf-8')
    # The limit owner adds narrow accepted-state hooks inside this block. Keep
    # that installed extension when refreshing helpers, and check the composed
    # result instead of incorrectly requiring the extension to disappear.
    if '/* TF_AIRFRAME_LIMITS_BEGIN */' in text:
        composed = subprocess.run(['node', '--input-type=module', '-e',
            'import fs from "node:fs"; import {patchAirframeLimits} from "./handoff/tools/sync_airframe_limits.mjs"; process.stdout.write(patchAirframeLimits(fs.readFileSync(0,"utf8")));'],
            input=expected.encode('utf-8'), capture_output=True, cwd=ROOT.parent, check=True)
        expected = composed.stdout.decode('utf-8')
    if args.check:
        assert path.read_bytes().decode('utf-8')==expected,'Run handoff/tools/sync_frontline_client.py'
    else:path.write_bytes(expected.encode('utf-8'))


if __name__=='__main__':main()

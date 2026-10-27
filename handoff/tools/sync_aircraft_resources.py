#!/usr/bin/env python3
"""Embed source-owned resource accounting and read-only HUD helpers in the shipped bundle."""
import argparse
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
START='    // BEGIN AIRCRAFT RESOURCE HELPERS\n'
END='    // END AIRCRAFT RESOURCE HELPERS\n'


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    path=ROOT/'bundle/app.js.html';text=path.read_text()
    source='\n'.join((ROOT/'tools'/name).read_text() for name in ['aircraft_resources.js','air_hud_inventory.js'])
    source+='\n    const airHudInventory = createAirHudInventory({projectiles:()=>data.projectiles,storeDefs:()=>AIR_STORE_DEFS});\n'
    block=START+source+END
    if START in text:
        first=text.index(START);last=text.index(END,first)+len(END);expected=text[:first]+block+text[last:]
    else:
        anchor='    const airHud = document.createElement("div");'
        assert text.count(anchor)==1;expected=text.replace(anchor,block+anchor)
    if args.check:assert text==expected,'Run handoff/tools/sync_aircraft_resources.py'
    else:path.write_text(expected)


if __name__=='__main__':main()

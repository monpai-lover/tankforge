#!/usr/bin/env python3
"""Compose the reviewed pitch-ladder helper into a candidate, never implicitly live."""
import argparse
import hashlib
from pathlib import Path
from patch_guided_aircraft_variants import matching_end

HERE = Path(__file__).resolve().parent
BEGIN = '/* TF_AIRCRAFT_HUD_LADDER_BEGIN */'
END = '/* TF_AIRCRAFT_HUD_LADDER_END */'


def patch(source):
    helper = (HERE / 'aircraft_hud_ladder.js').read_text(encoding='utf8').strip()
    if BEGIN in source:
        if source.count(BEGIN) != 1 or source.count(END) != 1 or source.count('TFAircraftHudLadder.draw(g,P,pos,sightProject,font,sightOptics.pane);') != 1:
            raise ValueError('Ambiguous or partial pitch-ladder installation')
        a, b = source.index(BEGIN), source.index(END) + len(END)
        return source[:a] + helper + source[b:]
    marker = '  function drawAircraftCollimatedSight(context,optics,colour,paint,pixelRatio=1){'
    if source.count(marker) != 1:
        raise ValueError('Actual collimated-sight helper is missing or ambiguous')
    a = source.index(marker)
    b = matching_end(source, source.index('{', a)) + 1
    source = source[:b] + '\n' + helper + '\n' + source[b:]
    a = source.index('    function drawAirOverlay(')
    b = source.index('    /** Warnings over the screen centre', a)
    block = source[a:b]
    if block.count('test(P.type.id)') != 3 or block.count('      const SIGHT = ') != 1:
        raise ValueError('Actual source HUD identity checks changed; review before patching')
    block = block.replace('      const SIGHT = ', '      const hudTypeId = TFAircraftHudLadder.sourceId(P.type);\n      const SIGHT = ', 1)
    block = block.replace('test(P.type.id)', 'test(hudTypeId)')
    marker = '        for(let pitch=-20;pitch<=20;pitch+=5){'
    if block.count(marker) != 1:
        raise ValueError('Actual source pitch ladder differs; review before patching')
    start = block.index(marker)
    end = matching_end(block, block.index('{', start)) + 1
    block = block[:start] + '        TFAircraftHudLadder.draw(g,P,pos,sightProject,font,sightOptics.pane);' + block[end:]
    return source[:a] + block + source[b:]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    source = args.input.read_text(encoding='utf8')
    result = patch(source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(result, encoding='utf8', newline='\n')
    print({'inputSha256': hashlib.sha256(source.encode()).hexdigest(), 'outputSha256': hashlib.sha256(result.encode()).hexdigest()})


if __name__ == '__main__':
    main()

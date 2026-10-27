#!/usr/bin/env python3
"""Compose explicit guided aircraft variants onto the current source app."""
import argparse
import hashlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
BEGIN = '/* TF_GUIDED_AIRCRAFT_VARIANTS_BEGIN */'
END = '/* TF_GUIDED_AIRCRAFT_VARIANTS_END */'
STAMP = '// TF_GUIDED_VARIANT_CATALOG_V1'


def matching_end(source, start):
    """Find the matching literal/function brace without interpreting its code."""
    depth = 0
    quote = None
    escaped = False
    line_comment = False
    block_comment = False
    i = start
    while i < len(source):
        c = source[i]
        n = source[i + 1] if i + 1 < len(source) else ''
        if line_comment:
            if c == '\n':
                line_comment = False
        elif block_comment:
            if c == '*' and n == '/':
                block_comment = False
                i += 1
        elif quote:
            if escaped:
                escaped = False
            elif c == '\\':
                escaped = True
            elif c == quote:
                quote = None
        elif c == '/' and n == '/':
            line_comment = True
            i += 1
        elif c == '/' and n == '*':
            block_comment = True
            i += 1
        elif c in "'\"`":
            quote = c
        elif c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError('Unclosed source brace')


def patch(source):
    helper = (HERE / 'guided_aircraft_variants.js').read_text(encoding='utf8').strip()
    if STAMP in source:
        if source.count(BEGIN) != 1 or source.count(END) != 1:
            raise ValueError('Ambiguous variant helper')
        a, b = source.index(BEGIN), source.index(END) + len(END)
        return source[:a] + helper + source[b:]

    def once(old, new):
        nonlocal source
        if source.count(old) != 1:
            raise ValueError('Missing or ambiguous variant insertion: ' + old[:100])
        source = source.replace(old, new, 1)

    once('  var AIR_FIGHTERS = {', helper + '\n  var AIR_FIGHTERS = {')
    loop = '  for (const [id2, f] of Object.entries(AIR_FIGHTERS)) AIRCRAFT_TYPES[id2] = fighterType(id2, f);'
    once(loop, loop + '\n  TFGuidedAircraftVariants.installTypes(AIR_FIGHTERS, AIRCRAFT_TYPES);')
    start = source.index('  async function decodeAircraftModels(models) {')
    end = matching_end(source, source.index('{', start))
    source = source[:end] + '  TFGuidedAircraftVariants.installTypes(AIR_FIGHTERS, AIRCRAFT_TYPES);\n  ' + source[end:]
    once('    applyAircraftRebuilds(data.aircraftRebuilds);',
         '    applyAircraftRebuilds(data.aircraftRebuilds);\n    TFGuidedAircraftVariants.installTypes(AIR_FIGHTERS, AIRCRAFT_TYPES);')

    # Logical identity is retained for compatibility and saved custom choices.
    # Only physical attachment helpers receive the explicitly inherited source.
    once('    function airStations(T) {',
         '    function airStations(T) {\n      T = TFGuidedAircraftVariants.sourceType(T);')
    old = 'return TFMountedDetails.fitItems(T, TFMountedDetails.rebind(T, TFModelHardpoints.rebind(T, out, { storeMountPosition }), { storeMountPosition }));'
    once(old, 'const sourceType = TFGuidedAircraftVariants.sourceType(T);\n      return TFMountedDetails.fitItems(sourceType, TFMountedDetails.rebind(sourceType, TFModelHardpoints.rebind(sourceType, out, { storeMountPosition }), { storeMountPosition }));')
    once('TFModelHardpoints.customEntries(AIRCRAFT_TYPES[typeId], items)',
         'TFModelHardpoints.customEntries(TFGuidedAircraftVariants.sourceType(AIRCRAFT_TYPES[typeId]), items)')
    start = source.index('    function airSlots(typeId) {')
    end = matching_end(source, source.index('{', start)) + 1
    source = source[:end] + '\n    const sourceAirSlotsForGuidedVariants = airSlots;\n    airSlots = function(typeId) { return TFGuidedAircraftVariants.decorateSlots(typeId, sourceAirSlotsForGuidedVariants(TFGuidedAircraftVariants.sourceId(typeId))); };' + source[end:]

    # Append presets; all original indices stay intact. Catalog choices are not
    # gated by a UI-only sensor test. Native support remains server-owned.
    once('    RE_FACTOR.tritonal', '    ' + STAMP + '\n    TFGuidedAircraftVariants.installLoadouts(AIR_LOADOUTS);\n    TFGuidedAircraftVariants.inheritTables({compatibility: WEAPON_COMPAT});\n    RE_FACTOR.tritonal')
    for name, arg in [('AIR_FUEL', 'fuel'), ('AIR_RADARS', 'radars'), ('AIR_EQUIP', 'equipment'), ('AIR_CM', 'countermeasures')]:
        start = source.index('    const ' + name + ' = ')
        end = matching_end(source, source.index('{', start)) + 1
        semicolon = source.index(';', end) + 1
        source = source[:semicolon] + f'\n    TFGuidedAircraftVariants.inheritTables({{{arg}: {name}}});' + source[semicolon:]
    return source


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    source = args.input.read_text(encoding='utf8')
    result = patch(source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(result, encoding='utf8', newline='\n')
    print({'inputSha256': hashlib.sha256(source.encode()).hexdigest(),
           'outputSha256': hashlib.sha256(result.encode()).hexdigest(),
           'logicalVariants': ['su27skm', 'mig29smt'], 'physicalModelAliasesAdded': 0})


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Stage reviewed source-option presets and the narrow R4M physical-role fix.

The caller supplies separate input/output paths. No data bundle, aircraft JSON,
flight WASM or native code is rewritten by this tool.
"""
import argparse
import hashlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
BEGIN = '/* TF_HISTORICAL_AIRCRAFT_LOADOUTS_BEGIN */'
END = '/* TF_HISTORICAL_AIRCRAFT_LOADOUTS_END */'
CORRECT = '    TFHistoricalAircraftLoadouts.correctStoreDefinitions(AIR_STORE_DEFS);'
INSTALL = '    TFHistoricalAircraftLoadouts.installLoadouts(AIR_LOADOUTS, AIRCRAFT_TYPES);'


def patch(source):
    helper = (HERE / 'historical_aircraft_loadouts.js').read_text(encoding='utf8').strip()
    if BEGIN in source or END in source:
        if source.count(BEGIN) != 1 or source.count(END) != 1:
            raise ValueError('Ambiguous historical-loadout helper')
        if source.count(CORRECT) != 1 or source.count(INSTALL) != 1:
            raise ValueError('Historical-loadout call sites missing or ambiguous')
        a, b = source.index(BEGIN), source.index(END) + len(END)
        return source[:a] + helper + source[b:]

    def once(old, new):
        nonlocal source
        if source.count(old) != 1:
            raise ValueError('Missing or ambiguous historical-loadout insertion: ' + old)
        source = source.replace(old, new, 1)

    # Keep helper + correction in the existing storeDefinitions export section,
    # so real production layout and native profile export execute the same code.
    status_docs = "    /**\n     * Each weapon's four separate states"
    once(status_docs, helper + '\n' + CORRECT + '\n' + status_docs)
    inherited = '    TFGuidedAircraftVariants.inheritTables({compatibility: WEAPON_COMPAT});'
    once(inherited, inherited + '\n' + INSTALL)
    # Existing custom entries already support a fourth, explicit side. A named
    # preset with the right-only Sniper must not create an imaginary left chin
    # slot when the menu derives its options from presets.
    once('for (const [, items] of AIR_LOADOUTS[typeId] || []) for (const [id2, n, station] of items) {',
         'for (const [, items] of AIR_LOADOUTS[typeId] || []) for (const [id2, n, station, only] of items) {')
    once('const sides = station === "center" ? [0] : [-1, 1], per = station === "center" ? n : Math.ceil(n / 2);',
         'const sides = only == null ? station === "center" ? [0] : [-1, 1] : [only], per = only != null || station === "center" ? n : Math.ceil(n / 2);')
    return source


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        raise ValueError('Stage to a separate output path; integration belongs to ROOT')
    source = args.input.read_text(encoding='utf8')
    result = patch(source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(result, encoding='utf8', newline='\n')
    print({'inputSha256': hashlib.sha256(source.encode()).hexdigest(),
           'outputSha256': hashlib.sha256(result.encode()).hexdigest(),
           'appendedPresets': 12, 'newCompatibilityRows': 0,
           'correctedFiller': {'id': 'he_55_r4m', 'explosiveKg': .52}})


if __name__ == '__main__':
    main()

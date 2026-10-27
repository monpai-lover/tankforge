#!/usr/bin/env python3
"""Current live client hardpoint binding only; native host geometry/capacity is unchanged."""
from pathlib import Path
import argparse, subprocess
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent

def patch(source, compiled=None):
    if 'TF_MODEL_HARDPOINTS_BEGIN' in source:
        raise ValueError('Model hardpoint binding already installed')
    if compiled is None:
        compiled = subprocess.check_output([
            str(ROOT/'perf/node_modules/.bin/esbuild'), str(HERE/'helper.mjs'), '--bundle',
            '--format=iife', '--global-name=TFModelHardpoints', '--target=es2020', '--log-level=warning'
        ], text=True)
    marker = '    function layoutStores(T, loadout) {'
    assert source.count(marker) == 1, 'Store layout boundary is ambiguous'
    source = source.replace(marker, '    /* TF_MODEL_HARDPOINTS_BEGIN */\n'+compiled.replace('</script', '<\\/script')+'\n    /* TF_MODEL_HARDPOINTS_END */\n    createFrontlineAircraftVisual = TFModelHardpoints.wrapNativeFactory(createFrontlineAircraftVisual);\n'+marker, 1)
    start = source.index(marker)
    end = source.index('    /**\n     * Custom armament', start)
    scope = source[start:end]
    old = '      return out;\n    }'
    assert scope.count(old) == 1, 'Store layout return is ambiguous'
    scope = scope.replace(old, '      return TFModelHardpoints.rebind(T, out, { storeMountPosition });\n    }', 1)
    source = source[:start]+scope+source[end:]
    old = '      return [...slots.values()].sort((a, b) => rank(a) - rank(b));'
    assert source.count(old) == 1, 'Custom slot return is ambiguous'
    source = source.replace(old, '      return TFModelHardpoints.decorateSlots(AIRCRAFT_TYPES[typeId], [...slots.values()].sort((a, b) => rank(a) - rank(b)));', 1)
    old = '    const slotsClash = (a, b) => a.pylon || b.pylon ?'
    assert source.count(old) == 1, 'Custom slot conflict hook is ambiguous'
    source = source.replace(old, '    const slotsClash = (a, b, aId, bId) => TFModelHardpoints.slotsClash(a, b, aId, bId) || (a.pylon || b.pylon ?')
    start = source.index('    const slotsClash = ')
    end = source.index('\n', start)
    source = source[:end-1]+');'+source[end:]
    old = '      return ["自訂", items];'
    assert source.count(old) == 1, 'Saved custom loadout return is ambiguous'
    source = source.replace(old, '      return ["自訂", TFModelHardpoints.customEntries(AIRCRAFT_TYPES[typeId], items)];', 1)
    old = '          for (const o of slots) if (slotsClash(o, t)) delete pick[o.key];'
    assert source.count(old) == 1, 'Custom selection hook is ambiguous'
    source = source.replace(old, '          for (const o of slots) if (slotsClash(o, t, pick[o.key], sid)) delete pick[o.key];', 1)
    old = '      const items = layoutStores(plane.type, lo);'
    assert source.count(old) == 1, 'Per-plane mounted layout hook is ambiguous'
    source = source.replace(old, '      const items = TFModelHardpoints.forPlane(plane, layoutStores(plane.type, lo));', 1)
    return source

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    assert args.input.resolve() != args.output.resolve()
    args.output.write_text(patch(args.input.read_text()))

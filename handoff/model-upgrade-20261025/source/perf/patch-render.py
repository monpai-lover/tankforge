#!/usr/bin/env python3
"""Apply aircraft-only render rejection to one extracted C213/upgrade app script.

Examples:
  python perf/patch-render.py perf/current-app.html perf/render-fixed-app.html
  python perf/patch-render.py source/handoff/bundle/app.js.html --in-place
  python perf/patch-render.py perf/current-app.html --check

Every source hook must match once. An existing marker/helper is an error; repeated
execution cannot silently stack hooks. No collision, visibility or scene code is
rewritten. The utility is read verbatim from the sibling .mjs, stripping exports.
"""
from __future__ import annotations
import argparse
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile

BEGIN = 'TF_AIRCRAFT_CULL_BEGIN'
END = 'TF_AIRCRAFT_CULL_END'


def sha(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def patch(source: str, utility: str) -> tuple[str, dict]:
    if BEGIN in source or END in source or re.search(r'\bcreateAircraftClipReject\b', source):
        raise ValueError('Aircraft render culling is already present; refusing duplicate application')
    embedded = re.sub(r'^export (?=(?:function|const|class)\s)', '', utility, flags=re.M)
    if re.search(r'^\s*(?:import|export)\s', embedded, flags=re.M):
        raise ValueError('Utility has an unsupported module declaration')
    wrapper = re.match(r'\A\s*(?:<script(?:\s[^>]*?)?>\s*)?\(\(\)\s*=>\s*\{', source)
    if not wrapper:
        raise ValueError('Expected an extracted app with a leading (() => { wrapper')
    edits = []

    def once(label: str, before: str, after: str) -> None:
        nonlocal source
        count = source.count(before)
        if count != 1:
            raise ValueError(f'{label}: expected exactly one hook, found {count}')
        source = source.replace(before, after, 1)
        edits.append(label)

    once('Aircraft constructor local static mesh marker',
         '      const geo = this.type.geometry(), mesh = (data) => {\n'
         '        const m = renderer.mesh(data);\n'
         '        this.meshes.push(m);',
         '      const geo = this.type.geometry(), mesh = (data) => {\n'
         '        const m = renderer.mesh(data);\n'
         '        m.aircraftGeometry = true;\n'
         '        this.meshes.push(m);')
    for component in ('skin', 'visor'):
        once(f'Aircraft constructor pilot {component} static mesh marker',
             f'          n.mesh = renderer.mesh({component});\n'
             '          this.meshes.push(n.mesh);',
             f'          n.mesh = renderer.mesh({component});\n'
             '          n.mesh.aircraftGeometry = true;\n'
             '          this.meshes.push(n.mesh);')
    once('aircraft store/rack static upload marker, shared ordnance-safe bounds',
         '      const m = renderer.mesh(v || aircraftGeometry.store(def));\n'
         '      storeMeshes.set(key4, m);',
         '      const m = renderer.mesh(v || aircraftGeometry.store(def));\n'
         '      m.aircraftGeometry = true;\n'
         '      storeMeshes.set(key4, m);')
    # C213 has authored stores; the earlier delivered upgrade does not. Presence
    # requires exactly one known hook. Absence is an explicit supported variant.
    if 'function sourceStoreMesh(' in source:
        once('C213 authored aircraft store/mount static upload marker',
             '      if(!storeMeshes.has(key))storeMeshes.set(key,renderer.mesh(piece.data));',
             '      if(!storeMeshes.has(key)) {\n'
             '        const mesh=renderer.mesh(piece.data);mesh.aircraftGeometry=true;storeMeshes.set(key,mesh);\n'
             '      }')
    once('mountStores aircraft pylon static upload marker',
         '          const m = renderer.mesh(aircraftGeometry.pylon(top, bot, Math.min(1.4, it.def.len * .55), plane.type.fighter?.spec.colors.base || "#9aa2a5"));\n'
         '          plane.meshes.push(m);',
         '          const m = renderer.mesh(aircraftGeometry.pylon(top, bot, Math.min(1.4, it.def.len * .55), plane.type.fighter?.spec.colors.base || "#9aa2a5"));\n'
         '          m.aircraftGeometry = true;\n'
         '          plane.meshes.push(m);')
    once('shadow pass exact lightVP rejection',
         '      for (const n of nodes) {\n'
         '        if (!n.castShadow) continue;\n'
         '        this._draw(this.depth, n);',
         '      const rejectAircraftShadow = createAircraftClipReject(lightVP);\n'
         '      for (const n of nodes) {\n'
         '        if (!n.castShadow || rejectAircraftShadow(n)) continue;\n'
         '        this._draw(this.depth, n);')
    once('colour/inset pass exact current camera VP',
         '      const forward = cam?.forward || [0, 0, 1];\n'
         '      const bounds3 = this._meshCenters',
         '      const forward = cam?.forward || [0, 0, 1];\n'
         '      const rejectAircraftColour = createAircraftClipReject(cam?.viewProj);\n'
         '      const bounds3 = this._meshCenters')
    once('colour pass per-mesh rejection before transparent sorting',
         '      for (const n of nodes) {\n'
         '        if (![6, 7, 10, 17].includes(n.kind)',
         '      for (const n of nodes) {\n'
         '        if (rejectAircraftColour(n)) continue;\n'
         '        if (![6, 7, 10, 17].includes(n.kind)')
    # No earlier edit changes the opening wrapper's length.
    source = (source[:wrapper.end()] + f'\n  /* {BEGIN} */\n' + embedded.rstrip() +
              f'\n  /* {END} */' + source[wrapper.end():])
    return source, {'hooks': edits, 'utility_sha256': sha(utility)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', nargs='?', type=Path)
    parser.add_argument('--in-place', action='store_true', help='Atomically replace the input')
    parser.add_argument('--check', action='store_true', help='Validate and print hashes without writing')
    parser.add_argument('--diff', type=Path, help='Optional unified diff output')
    parser.add_argument('--utility', type=Path, default=Path(__file__).with_name('aircraft-render-cull.mjs'))
    args = parser.parse_args()
    if args.in_place and args.output:
        parser.error('Use either output or --in-place')
    if not args.check and not (args.in_place or args.output):
        parser.error('Supply output, --in-place, or --check')
    if args.output and args.output.resolve() == args.input.resolve():
        parser.error('Use --in-place to replace the input')
    original = args.input.read_text(encoding='utf-8')
    try:
        result, metadata = patch(original, args.utility.read_text(encoding='utf-8'))
    except ValueError as error:
        parser.exit(2, f'Aircraft render patch rejected: {error}\n')
    metadata.update(input=str(args.input), source_sha256=sha(original), patched_sha256=sha(result), check_only=args.check)
    if not args.check:
        destination = args.input if args.in_place else args.output
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=destination.parent, delete=False) as f:
            temp_path = Path(f.name)
            try:
                f.write(result)
            except BaseException:
                temp_path.unlink(missing_ok=True)
                raise
        mode_source = destination if destination.exists() else args.input
        os.chmod(temp_path, mode_source.stat().st_mode & 0o777)
        os.replace(temp_path, destination)
        metadata['output'] = str(destination)
    if args.diff and not args.check:
        args.diff.parent.mkdir(parents=True, exist_ok=True)
        args.diff.write_text(''.join(difflib.unified_diff(original.splitlines(True), result.splitlines(True),
                             fromfile=str(args.input), tofile=str(args.input if args.in_place else args.output))), encoding='utf-8')
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

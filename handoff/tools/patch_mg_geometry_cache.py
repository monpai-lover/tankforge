"""Write an isolated performance candidate; never modifies the input app."""
from pathlib import Path
import argparse

p = argparse.ArgumentParser()
p.add_argument('--source', type=Path, default=Path('handoff/bundle/app.js.html'))
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
source = a.source.read_text(encoding='utf-8-sig')
helper = Path(__file__).with_name('mg_armor_geometry_cache.js').read_text(encoding='utf-8-sig')
if a.output.resolve() == a.source.resolve():
    raise SystemExit('An isolated output is required')

def replace(old, new, count=1):
    global source
    if source.count(old) != count:
        raise SystemExit(f'Expected {count} occurrences of {old[:90]!r}; got {source.count(old)}')
    source = source.replace(old, new)

replace('  // client/web/src/game/combat.js', helper + '\n  var TF_COMBAT_GEOMETRY_IMMUTABLE = createCombatGeometryImmutable();\n\n  // client/web/src/game/combat.js')
replace('pose.geometry_instances = structuredClone(surface.updates);', 'pose.geometry_instances = TF_COMBAT_GEOMETRY_IMMUTABLE.capture(surface);', 4)
replace('var clone2 = (v2) => structuredClone(v2);', 'var clone2 = (v2) => TF_COMBAT_GEOMETRY_IMMUTABLE.clone(v2);')
replace('const result = structuredClone(value);', 'const result = TF_COMBAT_GEOMETRY_IMMUTABLE.clone(value);')
replace('''      if (--left < 0 || d > depth) return false;
      if (v2 === null''', '''      if (--left < 0 || d > depth) return false;
      const immutableGeometry = TF_COMBAT_GEOMETRY_IMMUTABLE.metadata(v2);
      if (immutableGeometry) {
        left -= immutableGeometry.nodes - 1;
        return left >= 0 && d + immutableGeometry.extraDepth <= depth && immutableGeometry.maxAbs <= scalarBound;
      }
      if (v2 === null''')
replace('''  function geometryPoseValid(rows) {
    if (rows === void 0)''', '''  function geometryPoseValid(rows) {
    if (TF_COMBAT_GEOMETRY_IMMUTABLE.isTrusted(rows)) return true;
    if (rows === void 0)''')
replace('''    const freeze3 = (v2) => {
      if (v2 && typeof v2 === "object") {
        for (const q of Object.values(v2)) freeze3(q);''', '''    const freeze3 = (v2) => {
      if (v2 && typeof v2 === "object") {
        if (TF_COMBAT_GEOMETRY_IMMUTABLE.isTrusted(v2)) { frozenReplayValues.add(v2); return v2; }
        for (const q of Object.values(v2)) freeze3(q);''')
a.output.parent.mkdir(parents=True, exist_ok=True)
a.output.write_text(source, encoding='utf-8', newline='\n')
print(a.output)

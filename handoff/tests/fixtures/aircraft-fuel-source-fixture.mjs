import assert from 'node:assert/strict';

// Keep isolated VMs on the delivered fuel policy and its real UI controller.
// This module only extracts source; each caller supplies its existing VM seams.
export function fuelSourceParts(source) {
  const unique = marker => {
    const at = source.indexOf(marker);
    assert.ok(at >= 0 && source.indexOf(marker, at + marker.length) < 0,
      `One actual fuel source boundary required: ${marker}`);
    return at;
  };
  const begin = '/* TF_AIRCRAFT_FUEL_LOAD_BEGIN */';
  const end = '/* TF_AIRCRAFT_FUEL_LOAD_END */';
  const helperAt = unique(begin), helperEnd = unique(end) + end.length;
  const pureAt = unique('    const AIR_FUEL = {');
  const controllerAt = unique('    // TF_AIRCRAFT_FUEL_LOAD_CONTROLLER');
  const consumerAt = unique("    /** The flight's fuel one step:");
  assert.ok(helperAt < helperEnd && helperEnd < pureAt && pureAt < controllerAt && controllerAt < consumerAt,
    'Actual fuel helper, model and complete controller must remain ordered');
  return {
    helper: source.slice(helperAt, helperEnd),
    pure: source.slice(pureAt, controllerAt),
    controller: source.slice(controllerAt, consumerAt)
  };
}

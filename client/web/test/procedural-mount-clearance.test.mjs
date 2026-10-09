import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeParts, surfaceCrossings, touches, auditVehicle } from '../tools/procedural-fleet-audit.mjs';
import { loadData } from '../tools/load-data.mjs';
import { transformPoint } from '../src/gfx/math.js';

const data = loadData(), DEG = Math.PI / 180;
const flaks = ['de_flakpz38t', 'de_hetzer_flak', 'de_rso_flak'];
const flakOffset = id => ({ de_flakpz38t: 50, de_hetzer_flak: 22, de_rso_flak: 31 })[id];
const piece = (pieces, index) => pieces.find(p => p.id === `visual#${index}`);

for (const id of flaks) test(`${id}: receiver, cradle, magazine and sight clear their fixed carriage throughout elevation`, () => {
  const rt = runtimeParts(id, data);
  for (let angle = -data.vehicles[id].weapons.main_gun.max_depression_deg; angle <= 90; angle++) {
    const pieces = rt.at({ pitch: angle * DEG });
    for (const a of pieces.filter(p => p.part.mount === 'gun' && p.part.name !== 'flak38_elevation_pins'))
      for (const b of pieces.filter(p => p.part.mount === 'turret')) {
      assert.equal(surfaceCrossings(a, b).count, 0, `${id} ${angle}deg: ${a.id} crosses ${b.id}`);
    }
  }
});

test('M901: the full hammerhead clears its fixed erection arm throughout the original -30/+35 degree travel', () => {
  const rt = runtimeParts('us_m901_itv', data);
  for (let angle = -30; angle <= 35; angle++) {
    const pieces = rt.at({ pitch: angle * DEG });
    for (const moving of pieces.filter(p => p.part.mount === 'gun')) {
      for (const fixed of pieces.filter(p => p.part.mount === 'turret' && p.part.name !== 'm901_elevation_pins')) {
        assert.equal(surfaceCrossings(moving, fixed).count, 0,
          `M901 ${angle}deg: ${moving.id} crosses ${fixed.id}`);
      }
    }
  }
});

test('the new visible elevation pins engage both gun and fixed carriage without detached supports', () => {
  for (const id of [...flaks, 'us_m901_itv']) {
    const rt = runtimeParts(id, data), pieces = rt.at({ pitch: 35 * DEG });
    const pins = pieces.find(p => /elevation_pins$/.test(p.part.name));
    assert.ok(pins, `${id}: visible elevation pins`);
    assert.ok(pieces.some(p => p !== pins && p.part.mount === 'gun' && touches(pins, p)), `${id}: pins engage gun`);
    assert.ok(pieces.some(p => p !== pins && p.part.mount === 'turret' && touches(pins, p)), `${id}: pins engage fixed frame`);
  }
});

test('FlaK sight, shield and seat backrest retain physical support after clearing their old intersections', () => {
  for (const id of flaks) {
    const result = auditVehicle(id, data, { yawSteps: 1 });
    assert.deepEqual(result.floating, [], `${id}: default physical attachments`);
  }
});

test('FlaK flash hider and both M901 tube mouths follow their original firing vectors at every pitch and yaw', () => {
  for (const id of [...flaks, 'us_m901_itv']) {
    const rt = runtimeParts(id, data), gun = rt.loadout.turrets[0].guns[0];
    const mouths = id === 'us_m901_itv' ? [26, 25] : [flakOffset(id) + 17];
    const vectors = id === 'us_m901_itv' ? gun.def.launcher.muzzle_vectors_m : [[0, 0, gun.muzzleOffset]];
    for (const angle of [-5, 0, 35, ...(id === 'us_m901_itv' ? [] : [80, 90])]) for (const yaw of [0, .7, Math.PI]) {
      const pieces = rt.at({ pitch: angle * DEG, yaw });
      for (let i = 0; i < mouths.length; i++) {
        const p = piece(pieces, mouths[i]), node = rt.model.turrets[0].guns[0].node;
        const muzzle = transformPoint(node.world, vectors[i]);
        // Source cylinders are open at their visible forward face; average its rim.
        const localMouth = [p.part.pos[0], p.part.pos[1], p.part.pos[2] + p.part.len / 2];
        const sourceVector = localMouth.map((v, k) => v - gun.trunnion[k]);
        const visible = transformPoint(node.world, sourceVector);
        assert.ok(Math.hypot(...muzzle.map((v, k) => v - visible[k])) < 1e-5, `${id}: mouth follows vector`);
      }
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { sightProjection } from '../src/game/optics.js';
import { loadData } from '../tools/load-data.mjs';
import { sightLevels } from '../src/game/loadout.js';

test('sights with the same power retain different fields and visible apertures', () => {
  const narrow = sightProjection({ magnification: 3, fov_deg: 12.3 }, 1280, 800);
  const wide = sightProjection({ magnification: 3, fov_deg: 22 }, 1280, 800);
  assert.ok(wide.radius > narrow.radius * 1.4);
  assert.ok(wide.edgeOpacity < narrow.edgeOpacity);
  assert.ok(Math.abs(wide.pxPerRad - narrow.pxPerRad) < 1e-8,
    'equal magnification preserves central image scale when the eyepiece fits');
});

test('true sight field and mil offsets match the actual perspective at every screen size', () => {
  const data = loadData();
  for (const b of Object.values(data.vehicles)) {
    const sights = [b.weapons.sight, ...(b.weapons.extra_turrets || []).map(t => t.sight)];
    for (const sight of sights) for (const level of sightLevels(sight).levels) {
      for (const [w, h] of [[1280, 800], [800, 1280], [2560, 1600]]) {
        const p = sightProjection(level, w, h);
        assert.ok(p.radius >= Math.min(w, h) * .33 && p.radius <= Math.min(w, h) * .625,
          'large eyepieces may extend past the short screen edge while retaining a readable minimum');
        assert.ok(Number.isFinite(p.fovY) && p.fovY > 0 && p.fovY < Math.PI);
        const focal = h / 2 / Math.tan(p.fovY / 2);
        assert.ok(Math.abs(focal * Math.tan(level.fov_deg * Math.PI / 360) - p.radius) < 1e-7);
        assert.ok(Math.abs(focal * Math.tan(.01) - p.pxPerRad * Math.tan(.01)) < 1e-7);
      }
    }
  }
});

test('old narrow optics and modern wide optics both have enlarged windows', () => {
  const data = loadData();
  for (const [w,h] of [[1280,800],[638,815],[2560,1600]]) {
    const old = sightProjection(data.vehicles.de_hetzer.weapons.sight.levels[0],w,h);
    const modern = sightProjection(data.vehicles.su_t10m.weapons.sight.levels[0],w,h);
    assert.ok(old.radius >= Math.min(w,h)*.35,'the old Hetzer sight fills at least 70% of the short screen edge');
    assert.ok(modern.radius >= Math.min(w,h)*.60,'modern optics continue growing beyond the old 98% circle');
    assert.ok(modern.radius > old.radius,'different optics retain their visible aperture differences');
  }
});

test('virtual doubling keeps the original eyepiece while changing its angular zoom', () => {
  const a = sightProjection({ magnification: 2.5, fov_deg: 23 }, 1280, 800);
  const b = sightProjection({ magnification: 5, fov_deg: 11.5, doubled: true }, 1280, 800);
  assert.equal(b.radius, a.radius);
  assert.ok(b.pxPerRad > a.pxPerRad * 2);
});

test('modern multi-power optics retain their wide observation and high zoom modes', () => {
  const b = loadData().vehicles.us_m901_itv;
  const [wide, high] = b.weapons.sight.levels.map(l => sightProjection(l, 1280, 800));
  assert.ok(wide.radius > 350 && high.radius > 300);
  assert.ok(high.pxPerRad > wide.pxPerRad * 4);
});

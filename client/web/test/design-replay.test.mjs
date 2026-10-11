import test from 'node:test';
import assert from 'node:assert/strict';
import { designReplayReport, replayTrack, replayState, sampleReplay } from '../src/game/projectileReplay.js';

function shot(extra = {}) {
  return { shell: { kind: 'ap', caliber_mm: 75, explosive_mass_kg: .2 }, resp: {
    hit: true, capabilities: {}, layers: [],
    event: { impact_position: [0, 1, 0], impact_normal: [0, 0, -1], muzzle_position: [0, 1, -20], penetration_result: 'penetrated',
      projectile_path: [{ t: 0, pos: [0, 1, -20] }, { t: 1, pos: [0, 1, 0] }, { t: 1.001, pos: [0, 1, .1] }],
      fragments: [{ origin: [0, 1, .1], end: [0, 1, 3], is_penetrator: true }], damaged_modules: [], damaged_crew: [], ...extra } } };
}

test('design replay preserves source IDs physical properties timing events and budgets', () => {
  const sources = ['casing_fragment', 'projectile_piece', 'jet_fragment', 'core', 'armour_spall'];
  const last = shot({ mechanism_revision: 'kinetic_work_v1', impact_events: [{ event_id: 'layer:a/traversal:0', time_s: .02, budget: { input_j: 20, core_out_j: 12 } }], impact_state: { mass_kg: .1 },
    fragments: sources.map((source, i) => ({ origin: [0, 1, 0], end: [0, 1, 1], is_penetrator: false, source, fragment_id: `fragment:${i}`, parent_event_id: 'layer:a/traversal:0', source_layer_or_module: 'a', start_s: .02,
      energy_j: 2, weight: 1, physical: { mass_kg: .001, energy_j: 2, velocity_m_s: [0, 0, 20], area_m2: null }, budget: { input_j: 2, core_out_j: 1, target_deposition_j: 1 } })) });
  const before = JSON.stringify(last);
  const rep = designReplayReport(last);
  assert.deepEqual(rep.fragments.map(f => f.source), sources);
  assert.deepEqual(rep.fragments.map(f => f.kind), ['burst', 'projectile_piece', 'jet', 'shell', 'spall']);
  assert.deepEqual(rep.impact_events, last.resp.event.impact_events);
  assert.deepEqual(rep.impact_state, last.resp.event.impact_state);
  assert.equal(rep.mechanism_revision, 'kinetic_work_v1');
  assert.equal(rep.fragments[0].fragment_id, 'fragment:0');
  assert.deepEqual(rep.fragments[0].physical, last.resp.event.fragments[0].physical);
  assert.deepEqual(rep.fragments[0].budget, last.resp.event.fragments[0].budget);
  assert.equal(JSON.stringify(last), before);
  rep.fragments[0].physical.energy_j = 1;
  assert.equal(last.resp.event.fragments[0].physical.energy_j, 2);
});

test('missing old fragment provenance is unknown rather than fabricated armour spall', () => {
  const last = shot({ fragments: [{ origin: [0, 1, 0], end: [0, 1, 1], is_penetrator: false }] });
  assert.equal(designReplayReport(last).fragments[0].source, 'unknown_legacy');
});

test('design replay retains the actual penetrator endpoint and never manufactures an explosive burst', () => {
  const last = shot();
  const before = JSON.stringify(last.resp);
  const rep = designReplayReport(last);
  assert.deepEqual(rep.path, [[0, 1, 0], [0, 1, .1], [0, 1, 3]]);
  assert.deepEqual(rep.flight_path, [[0, 1, -20], [0, 1, 0]]);
  assert.deepEqual(rep.bursts, [], 'an explosive mass is not an authoritative blast record');
  assert.equal(JSON.stringify(last.resp), before);
});

test('design replay uses the shot input direction even when flight samples are sparse', () => {
  const last = shot();
  last.resp.shot = { dir: [Math.SQRT1_2, 0, Math.SQRT1_2] };
  assert.deepEqual(designReplayReport(last).shot.dir, last.resp.shot.dir);
});

test('design stopped point terminates the replay inside the actual struck plate', () => {
  const last = shot({ penetration_result: 'stopped', fragments: [], projectile_path: [{ t: 1, pos: [0, 1, 0] }] });
  last.resp.stopped_point = [0, 1, .04];
  const rep = designReplayReport(last);
  assert.deepEqual(rep.path, [[0, 1, 0], [0, 1, .04]]);
  const state = sampleReplay(replayTrack(rep, last.shell), { name: 'hold', k: .5 }, replayState());
  assert.deepEqual(state.shellPos, [0, 1, .04]);
});

test('HEAT design penetrator is a jet while the physical shell stops at the outer impact', () => {
  const last = shot(); last.shell.kind = 'heat';
  const rep = designReplayReport(last);
  assert.equal(rep.fragments[0].kind, 'jet');
  const state = sampleReplay(replayTrack(rep, last.shell), { name: 'xray', k: .36 }, replayState());
  assert.deepEqual(state.shellPos, [0, 1, 0]);
  assert.equal(state.jet, true);
  assert.ok(Math.abs(state.pos[2] - 1.5) < 1e-6);
});

test('design replay carries reported health and previously lost crew instead of fabricating full health', () => {
  const last = shot({ damaged_modules: [{ id: 'engine', kind: 'engine', damage: 18, destroyed: false }], damaged_crew: [{ role: 'gunner', damage: 12, killed: false }] });
  last.resp.state = { module_health: { engine: 42 }, crew_health: { driver_0: 0, gunner_1: 26, loader_2: 100 } };
  const rep = designReplayReport(last, ['driver', 'gunner', 'loader']);
  assert.equal(rep.modules[0].health, 42);
  assert.equal(rep.crew[0].health, 26);
  assert.equal(rep.caps.crew_alive, 2);
  assert.equal(rep.modules[0].max_health, undefined, 'the response does not report a maximum health');
});

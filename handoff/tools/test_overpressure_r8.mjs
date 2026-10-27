import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const file = process.argv[2] || new URL('../bundle/app.js.html', import.meta.url);
const source = readFileSync(file, 'utf8');
function body(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  let depth = 0, begin = source.indexOf('{', start);
  for (let i = begin; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}
function setup() {
  const calls = [], broadcasts = [], splashes = [];
  const ctx = vm.createContext({ console, performance: { now: () => 0 }, Math,
    HE_CONTACT_QUEUE: [], HE_CONTACT_BUDGET_MS: 6, HE_CONTACT_PLATES_MM: 40,
    tntEquivalentKg: s => s.explosive_mass_kg * (s.explosive_type === 'hexogen' ? 1.6 : 1),
    tntCharge: s => ({ ...s, explosive_mass_kg: s.explosive_mass_kg * (s.explosive_type === 'hexogen' ? 1.6 : 1) }),
    arr3: v => Array.isArray(v) ? v : [v.x, v.y, v.z],
    heBreachMm: kg => 13.1 * kg ** .673,
    thinnestPlateNear: () => ({ thickness_mm: 1 }),
    heInternalBurst: () => { throw new Error('synthetic crew-position explosion'); },
    showHit: () => {}, hud: { toast() {} }, LANG: 'en',
    G4: { online: false, combat: {}, enemies: [], mode: 'range', time: 7 },
    rng2: { nextF32: () => .25 }, sound: {},
    splashNear: (...args) => splashes.push(args),
    net: { send: msg => broadcasts.push(msg) },
  });
  vm.runInContext(`${body('flushHeContactBursts')}\n${body('heContactEffects')}`, ctx);
  const e = { combatKey: 'actor', cstate: { crew: [100, 100] }, caps: { destroyed: false }, alive: true,
    veh: { body: { localPoint: p => p.slice(), worldPoint: p => p.slice(), localDir: p => p.slice(), worldDir: p => p.slice() } },
    turretYaw: 0, pose() {}, bundle: { crew: [{ pos: [0, 1, 0] }] },
    combat: { nearBurst(...args) { calls.push(args); return { state: e.cstate, caps: e.caps, crew: [], modules: [], events: [], bursts: [], fragments: [], geometry_contacts: [], impact_events: [], cause_transitions: [], title: 'blast' }; } } };
  return { ctx, e, calls, broadcasts, splashes };
}
const shell = { id: 'heat-fixture', kind: 'heat_fs', caliber_mm: 152, mass_kg: 20, explosive_mass_kg: 3, explosive_type: 'hexogen' };
const report = (external = false, mm = 500) => ({ caps: { destroyed: false }, impact: [0, 1, 0], layers: [{ thickness_mm: mm }], normal: [0, 0, -1], shot: { seed: 4 }, crew: [], modules: [], events: [], bursts: external ? [{ inside: false, explosive_kg: 3 }] : [], fragments: [], geometry_contacts: [], impact_events: [], cause_transitions: [] });

test('thick-armor HEAT contact still delegates one exterior casing burst with raw projectile mass', () => {
  const { ctx, e, calls, broadcasts } = setup();
  ctx.heContactEffects(e, shell, [0, 1, 0], [0, 0, 1], report(false), 7);
  ctx.flushHeContactBursts(null, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][3].kind, 'heat_fs');
  assert.equal(calls[0][3].explosive_mass_kg, 3, 'TNT equivalence must not consume physical casing mass');
  assert.equal(calls[0][3].mass_kg, 20);
  assert.equal(calls[0].at(-1), true, 'no recorded exterior primary means pressure is included');
  assert.equal(broadcasts.length, 0, 'local caller never sends client-authored damage');
});

test('recorded exterior primary blast is not applied again while casing is retained', () => {
  const { ctx, e, calls } = setup();
  ctx.heContactEffects(e, { ...shell, kind: 'he' }, [0, 1, 0], [0, 0, 1], report(true), 7);
  ctx.flushHeContactBursts(null, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 10, 'explicit pressure policy is a distinct argument from legacy plates');
  assert.equal(calls[0].at(-1), false, 'trusted report owns the already-recorded primary component');
});

test('near miss delegates original burst with full casing without synthetic standoff relocation', () => {
  const { ctx, e, calls } = setup();
  ctx.G4.enemies = [Object.assign(e, { x: 0, z: 0, radius: 4, name: 'fixture' })];
  ctx.G4.combat = e.combat;
  ctx.heStandoffBreach = () => { throw new Error('invented AABB standoff breach'); };
  vm.runInContext(body('splashNear'), ctx);
  ctx.splashNear([1, 0, 1], shell, true, null, 7);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][2], [1, 0, 1]);
  assert.equal(calls[0][3].explosive_mass_kg, 3);
});

test('thin-armor contact never invents extra explosions at hull or crew positions', () => {
  const { ctx, e, calls } = setup();
  ctx.heContactEffects(e, { ...shell, kind: 'he', explosive_type: 'tnt', explosive_mass_kg: 125, mass_kg: 250, caliber_mm: 420 }, [2, 1, 0], [-1, 0, 0], { ...report(false, 1), impact: [2, 1, 0] }, 7);
  ctx.flushHeContactBursts(null, true);
  assert.equal(calls.length, 1);
  assert.ok(Math.hypot(...calls[0][2].map((v, i) => v - [2, 1, 0][i])) < .002, 'query uses original impact with only a numeric exterior offset');
});

test('queued casing uses the accepted combat impact instead of a collision-helper approximation', () => {
  const { ctx, e, calls } = setup();
  ctx.heContactEffects(e, shell, [20, 1, 0], [0, 0, 1], { ...report(false), impact: [2, 1, 0] }, 7);
  ctx.flushHeContactBursts(null, true);
  assert.equal(calls.length, 1);
  assert.ok(Math.hypot(...calls[0][2].map((v, i) => v - [2, 1, 0][i])) < .002,
    'a broadphase/module approximation cannot relocate the accepted charge');
});

test('queued casing cannot cross actor life, combat binding, or revived-target boundaries', () => {
  for (const boundary of ['life', 'key', 'combat', 'vehicle', 'revival']) {
    const { ctx, e, calls } = setup();
    let actor = { battle: 1, entity: 2, life: 1 };
    e.combat.replayAdmission = { actorForKey: () => ({ ...actor }) };
    ctx.heContactEffects(e, shell, [0, 1, 0], [0, 0, 1], report(false), 7);
    if (boundary === 'life') actor = { ...actor, life: 2 };
    if (boundary === 'key') e.combatKey = 'new-actor';
    if (boundary === 'combat') e.combat = { ...e.combat };
    if (boundary === 'vehicle') e.veh = { ...e.veh };
    if (boundary === 'revival') e.heContactEpoch = 1;
    e.cstate = { crew: [100, 100], newLife: true };
    ctx.flushHeContactBursts(null, true);
    assert.equal(calls.length, 0, boundary);
  }
});

test('bomb aftermath delegates original point once when no shell splash already resolved', () => {
  const { ctx, splashes } = setup();
  ctx.G4.enemies = [{ alive: true, get box() { throw new Error('AABB cannot place an explosion'); } }];
  vm.runInContext(body('bombBlast'), ctx);
  ctx.bombBlast([7, 0, 9], 125, { ...shell, kind: 'he' }, 2, false, null);
  assert.equal(splashes.length, 1);
  assert.deepEqual(splashes[0][0], [7, 0, 9]);
  ctx.bombBlast([7, 0, 9], 125, { ...shell, kind: 'he' }, 2, true, null);
  assert.equal(splashes.length, 1, 'shell-resolved burst is not duplicated by aftermath');
});

test('online bomb aftermath remains presentation-only', () => {
  const { ctx, splashes } = setup();
  ctx.G4.online = true;
  vm.runInContext(body('bombBlast'), ctx);
  ctx.bombBlast([7, 0, 9], 125, shell, 2, false, null);
  assert.equal(splashes.length, 0);
});

test('actual store aftermath skips resolved splash and expiry, but keeps direct-contact nearby blast', () => {
  for (const mode of ['resolved', 'direct', 'expiry']) {
    const { ctx, splashes } = setup();
    const target = { id: 'direct-target' };
    const shot = { s: { pos: [30, 0, 40] }, shell, groundBlastResolved: mode === 'resolved', groundBlastTarget: target };
    if (mode !== 'expiry') shot.groundBlastPoint = [7, 1, 9];
    ctx.G4.airBursts = [{ sh: shot, kg: 3, seq: 1, kind: 'bomb' }];
    Object.assign(ctx.G4, { shots: [], camPos: [0, 0, 0], cam: {} });
    Object.assign(ctx, { surfaceAt: () => 0, impactColor: () => null, fx: { explosion() {} } });
    ctx.sound.blast = () => {};
    vm.runInContext(`${body('bombBlast')}\n${body('airBurstStep')}`, ctx);
    ctx.airBurstStep();
    assert.equal(splashes.length, mode === 'direct' ? 1 : 0, mode);
    if (mode === 'direct') {
      assert.deepEqual(splashes[0][0], [7, 1, 9], 'real contact replaces the overshot integration endpoint');
      assert.equal(splashes[0][5], target, 'direct-hit entity is excluded from its second exterior evaluation');
    }
  }
});

test('small autocannon contact retains the established declared-plane budget path', () => {
  const { ctx, e, calls } = setup();
  ctx.heContactEffects(e, { ...shell, kind: 'he', caliber_mm: 35 }, [0, 1, 0], [0, 0, 1], report(true), 7);
  ctx.flushHeContactBursts(null, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][8], true);
  assert.equal(calls[0][9], false);
});

test('registered small-autocannon geometry keeps the actual surface path', () => {
  const { ctx, e, calls } = setup();
  e.combat.surfaceOwner = { actors: new Map([[e.combatKey, {}]]) };
  ctx.heContactEffects(e, { ...shell, kind: 'he', caliber_mm: 35 }, [0, 1, 0], [0, 0, 1], report(true), 7);
  ctx.flushHeContactBursts(null, true);
  assert.equal(calls[0][8], false, 'registration never silently selects legacy planes');
});

test('actual player missile caller keeps remembered pose and presents accepted exterior fatal replay', () => {
  const { ctx, e, calls } = setup();
  const shown = [], saved = [], pose = { immutablePose: 7 }, fatalReplay = { accepted: 'fatal-exterior' };
  const direct = { ...report(false), state: { crew: [100, 100] }, impact: [0, 1, 0], replay: { initial: true } };
  e.veh.body.localDir = p => p.slice();
  e.combat.shoot = () => direct;
  e.combat.nearBurst = (...args) => { calls.push(args); return { state: { crew: [0, 0] }, caps: { destroyed: true }, replay: fatalReplay, crew: [], modules: [], events: ['destroyed'], fragments: [], bursts: [], geometry_contacts: [], impact_events: [], cause_transitions: [], title: 'fatal exterior' }; };
  Object.assign(ctx.G4, { veh: e.veh, combat: e.combat, combatKey: e.combatKey, cstate: direct.state, T: [{ yaw: 0 }], cam: {} });
  Object.assign(ctx, { capturePlayerImpactPose: () => pose, savePlayerReplayPose: (r, p) => saved.push([r, p]), presentVictimReplay: r => shown.push(r), fx: { shellArmor() {} } });
  ctx.sound.impact = () => {};
  if (source.includes('function playerExteriorContact(')) vm.runInContext(body('playerExteriorContact'), ctx);
  vm.runInContext(body('selfMissileHit'), ctx);
  ctx.selfMissileHit([0, 1, -1], [0, 0, 1], shell, 800, { name: 'fixture' }, null, 10, 7, [0, 1, 1]);
  assert.equal(calls.length, 1, 'player uses same exterior casing route as enemy target');
  assert.equal(ctx.G4.caps.destroyed, true);
  assert.equal(saved[0][1], pose, 'followup does not recapture a later pose');
  assert.equal(shown.length, 1);
  assert.equal(shown[0], fatalReplay, 'actual accepted fatal event replaces the initial nonfatal view');
});

test('actual aircraft-on-player caller applies exterior state without claiming initial replay contains followup', () => {
  const { ctx, e, calls } = setup();
  const direct = { ...report(false), state: { crew: [100, 100] }, impact: [0, 1, 0], replay: { initial: true } };
  e.veh.body.localDir = p => p.slice();
  e.combat.shoot = () => direct;
  e.combat.nearBurst = (...args) => { calls.push(args); return { state: { crew: [58, 100] }, caps: { destroyed: false }, crew: [], modules: [], events: [], fragments: [], bursts: [], geometry_contacts: [], impact_events: [], cause_transitions: [], title: 'exterior' }; };
  Object.assign(ctx.G4, { veh: e.veh, combat: e.combat, combatKey: e.combatKey, cstate: direct.state, T: [{ yaw: 0 }] });
  if (source.includes('function playerExteriorContact(')) vm.runInContext(body('playerExteriorContact'), ctx);
  vm.runInContext(body('selfAirRoundHit'), ctx);
  ctx.selfAirRoundHit([0, 1, -1], [0, 1, 1], [0, 0, 1], shell, 800, 10, { name: 'fixture' });
  assert.equal(calls.length, 1);
  assert.equal(ctx.G4.cstate.crew[0], 58);
  assert.equal(direct.replay, undefined, 'initial replay cannot claim unrecorded followup damage');
  assert.equal(direct.replay_unavailable, 'contact_exterior_followup_not_in_single_replay');
});

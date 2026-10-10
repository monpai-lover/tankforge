import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Hud, penAt } from '../src/game/hud.js';
import { combatHit, RESULT_LABEL } from '../src/game/enemies.js';
import { arr3 } from '../src/game/combat.js';
import { NetClient } from '../src/game/net.js';
import { Missiles } from '../src/game/missiles.js';
import * as ballistics from '../src/sim/ballistics.js';
import { Node } from '../src/gfx/math.js';
import { RigidBody } from '../src/sim/tank/body.js';

const feedback = await import('../src/game/hitFeedback.js').catch(() => null);
const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
// Run the production closures, substituting only the scene and services they close over.
function closure(name, end, env) {
  const start = main.indexOf(`  function ${name}(`);
  const stop = main.indexOf(end, start);
  assert.ok(start >= 0 && stop > start, `${name} must be present`);
  return new Function(...Object.keys(env), `${main.slice(start, stop)}\nreturn ${name};`)(...Object.values(env));
}
function report(outcome = 'stopped', destroyed = false) {
  return { outcome, title: RESULT_LABEL[outcome], caps: { destroyed }, state: {}, modules: [], crew: [], layers: [], events: [], pen_mm: 0 };
}
const shell = { kind: 'ap', caliber_mm: 7.92, muzzle_velocity_ms: 800, mass_kg: .01, drag_coefficient: .3,
  penetration_curve: [{ distance_m: 0, pen_mm: 5 }] };
function combatFixture({ route = 'enemy', rep = report(), online = false, friend = false, other = false, legacy = false } = {}) {
  const markers = [], xray = [], sent = [];
  const e = { id: 2, name: 'target', netId: 2, team: friend ? 'blue' : 'red', remote: online, alive: true,
    combat: legacy ? null : { shoot: () => rep }, combatKey: 'target', cstate: {},
    model: { root: new Node('target'), turrets: [] }, gunPitch: [],
    veh: { body: new RigidBody(1000, [1, 1, 1], [0, 0, 0]) }, pose() {},
    resolve: () => ({ result: 'nopen', pen: 0 }) };
  const projectile = { s: ballistics.newShot([0, 2, 0], [0, 0, 1], shell), def: { ...shell, id: 'mg34' },
    shell, origin: [0, 2, 0], age: 0, travelled: 0, seq: 1, from: other ? 3 : null };
  const board = { range: 100, x: 0, y: 2, hits: 0 };
  const point = [0, 2, 1];
  const G = { bullets: [projectile], shots: [projectile], bulletShells: new Map([['mg34', shell]]),
    online: online ? { team: 'blue' } : null, mode: 'battle', s: { x: 0, z: 0 }, camPos: [0, 2, 0],
    hits: 0, mgHits: 0, loadout: { gunCount: 1 }, enemies: [e] };
  const env = { G, ballistics, combatHit, RESULT_LABEL, arr3, penAt, showHit: feedback?.showHit,
    BULLET_DT: 1 / 240, TRACER: {}, MASONRY_DUST: [],
    hitEnemy: () => route === 'enemy' ? { e, hit: { point, t: .8 } } : null,
    hitTargets: () => route === 'board' ? { target: board, point } : null, rangeTargets: () => [board],
    hitSelf: () => route === 'self' ? point : null,
    buildingHit: () => route === 'building' ? { point, t: .1 } : null,
    groundHit: () => route === 'ground' ? point : null, surfaceAt: () => 0, impactColor: () => [],
    fx: new Proxy({}, { get: () => () => {} }), sound: { impact() {}, blast() {} }, rng: { nextF32: () => .5 },
    onCombatHit: (...args) => xray.push(args), shotSeed: () => 1, wireShot: s => s, splashNear() {},
    net: { send: m => sent.push(m) }, hud: { hitMarker: (...args) => markers.push(args), toast() {}, hideToast() {} } };
  return { env, G, e, markers, xray, sent, board, rep };
}
function bullets(options) {
  const f = combatFixture(options);
  closure('updateBullets', '  function updateShots(', f.env)(1 / 240);
  return f;
}
function shots(options) {
  const f = combatFixture(options);
  closure('updateShots', '  /**\n   * Laying the guns', f.env)(1 / 240);
  return f;
}

test('actual MG stopped hit has one cue without module damage or X-ray', () => {
  const f = bullets();
  assert.deepEqual(f.markers, [['未擊穿', 'nopen']]);
  assert.equal(f.xray.length, 0);
  assert.equal(f.G.bullets.length, 0);
});
test('actual MG empty-space miss, friendly fire, buildings and ground have no enemy cue', () => {
  for (const options of [{ rep: report('miss') }, { online: true, friend: true }, { route: 'building' }, { route: 'ground' }, { route: 'none' }]) {
    assert.equal(bullets(options).markers.length, 0, JSON.stringify(options));
  }
});
test('MG damage retains X-ray and gives the destruction cue', () => {
  const rep = report('penetrated', true);
  const f = bullets({ rep });
  assert.equal(f.xray.length, 1);
  assert.equal(f.markers.length, 1);
  assert.equal(f.markers[0][1], 'kill');
});
test('remote MG and cannon predictions keep reporting and effects without confirming Hit', () => {
  for (const run of [bullets, shots]) {
    const f = run({ online: true });
    assert.equal(f.sent.length, 1);
    assert.equal(f.markers.length, 0);
  }
});
test('actual own cannon/autocannon and legacy armor result share Hit; misses and other shooters do not', () => {
  for (const options of [{}, { legacy: true }]) assert.deepEqual(shots(options).markers, [['未擊穿', 'nopen']]);
  for (const options of [{ rep: report('miss') }, { other: true }, { online: true, friend: true }, { route: 'ground' }, { route: 'building' }, { route: 'self', other: true }]) {
    assert.equal(shots(options).markers.length, 0, JSON.stringify(options));
  }
});
test('actual board impacts from both MG and shells show one Hit and keep range statistics', () => {
  const mg = bullets({ route: 'board' }), cannon = shots({ route: 'board' });
  for (const f of [mg, cannon]) assert.deepEqual(f.markers, [['命中靶板', 'nopen']]);
  assert.equal(mg.G.mgHits, 1); assert.equal(mg.board.mgHits, 1);
  assert.equal(cannon.G.hits, 1); assert.equal(cannon.board.hits, 1);
});
test('actual own missile confirms the combat result, never an online prediction or other missile', () => {
  for (const options of [{}, { rep: report('miss') }, { online: true }, { other: true }]) {
    const f = combatFixture(options);
    f.G.missiles = { segments: () => [{ id: 1, def: 'tow', owner: options.other ? 101 : 1,
      p0: [0, 2, 0], p1: [0, 2, 1], vel: [0, 0, 800] }], end() {} };
    f.e.intersect = () => ({ t: .5, point: [0, 2, .5] });
    Object.assign(f.env, { ME: 1, enemyOwner: i => 100 + i, data: { missiles: { tow: { warhead: 'war', name: 'TOW' } }, projectiles: { war: shell } }, selfMissileHit() {} });
    closure('missileImpacts', '  /** A missile or rocket into the ground', f.env)({});
    assert.equal(f.markers.length, !options.rep && !options.online && !options.other ? 1 : 0);
  }
});

test('actual HE splash confirms only own damaging blast, never an empty nearby blast or another missile', () => {
  for (const [own, damaged] of [[true, true], [true, false], [false, true]]) {
    const f = combatFixture({ rep: report('blast') });
    if (damaged) f.rep.modules.push({ id: 'track' });
    Object.assign(f.e, { x: 0, z: 0, radius: 2 });
    f.G.combat = { splash: () => f.rep };
    closure('splashNear', '  // ------------------------------------------------------- missiles', f.env)([0, 0, 0], { explosive_mass_kg: 1 }, own);
    assert.equal(f.markers.length, own && damaged ? 1 : 0);
    assert.equal(f.e.cstate, f.rep.state, 'splash damage remains independent of who receives feedback');
  }
});
test('missile ground event carries its actual shooter into the splash feedback route', () => {
  const received = [];
  const missiles = Object.create(Missiles.prototype);
  Object.assign(missiles, { nodes: new Map([[7, { owner: 101, def: { warhead: 'war' } }]]),
    fx: {}, camPos: [0, 0, 0], onGround: (...args) => received.push(args) });
  missiles._event({ type: 'missile_ground', missile: 7, point: [0, 0, 0] });
  assert.equal(received[0][2], 101);
  for (const [owner, online, expected] of [[1, false, true], [101, false, false], [1, true, false], [5, true, true]]) {
    const f = combatFixture({ online });
    const splashes = [];
    Object.assign(f.env, { ME: 1, net: { id: 5 }, data: { projectiles: { war: shell } }, splashNear: (...args) => splashes.push(args) });
    closure('missileGround', '  function selfMissileHit(', f.env)([0, 0, 0], { warhead: 'war' }, owner);
    assert.equal(splashes[0][2], expected);
  }
});

function networkFixture() {
  const f = combatFixture({ online: true });
  const net = new NetClient(); net.id = 1;
  Object.assign(f.env, { net, remoteOf: id => id === 2 ? f.e : null, playerName: id => String(id),
    markDead() {}, feed() {}, updateNetHud() {} });
  const a = main.indexOf("  net.on('damage',");
  const b = main.indexOf("  net.on('status',", a);
  new Function(...Object.keys(f.env), main.slice(a, b))(...Object.values(f.env));
  return { ...f, net };
}
test('actual accepted server damage callback confirms own stopped/nonfatal/legacy and kill outcomes', () => {
  for (const message of [{ report: report(), result: 'stopped' }, { report: report('penetrated'), result: 'penetrated' },
    { result: 'nopen' }, { result: 'kill', killed: true }]) {
    const f = networkFixture();
    f.net._receive({ t: 'damage', from: 1, target: 2, hp: 100, ...message });
    assert.equal(f.markers.length, 1, message.result);
    assert.equal(f.markers[0][1], message.killed ? 'kill' : message.result === 'penetrated' ? 'pen' : 'nopen');
  }
});
test('server misses/rejections, another shooter, self damage, friendly and paused/inactive receipts never confirm Hit', () => {
  for (const change of [{ from: 3 }, { target: 1 }, { report: report('miss'), result: 'miss' },
    { result: 'fire', report: null, killed: true }, { result: 'scuttle', report: null, killed: true },
    { t: 'fire_rejected' }, { friend: true }, { paused: true }, { inactive: true }]) {
    const f = networkFixture();
    if (change.friend) f.e.team = 'blue';
    if (change.paused) f.G.paused = true;
    if (change.inactive) f.G.mode = 'garage';
    f.net._receive({ t: 'damage', from: 1, target: 2, hp: 100, report: report(), result: 'stopped', ...change });
    assert.equal(f.markers.length, 0, JSON.stringify(change));
  }
});

function domFixture() {
  const nodes = new Map(), reads = [], transitions = [];
  const create = () => {
    const classes = new Set();
    return { dataset: {}, children: [], textContent: '', hidden: false,
      classList: { add(c) { if (!classes.has(c)) transitions.push(['add', c]); classes.add(c); },
        remove(c) { if (classes.has(c)) transitions.push(['remove', c]); classes.delete(c); }, contains: c => classes.has(c) },
      append(e) { this.children.push(e); }, getContext: () => ({}),
      get offsetWidth() { reads.push(1); return 20; } };
  };
  globalThis.document = { body: { dataset: {} },
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, create()); return nodes.get(id); }, createElement: create };
  const hud = new Hud(() => {});
  return { hud, nodes, reads, transitions };
}
test('HUD shows Hit plus result and refreshes one short cue without layout or restarting its visible state', () => {
  const { hud, nodes, reads, transitions } = domFixture();
  for (let i = 0; i < 100; i++) { hud.hitMarker('未擊穿', 'nopen'); hud.tick(.02); }
  const marker = hud.el.hitMarker;
  assert.equal(nodes.get('hud').children.length, 1);
  assert.equal(marker.textContent, 'Hit · 未擊穿');
  assert.equal(marker.dataset.kind, 'nopen');
  assert.equal(reads.length, 0);
  assert.deepEqual(transitions, [['add', 'show']]);
  hud.tick(.5); assert.equal(marker.classList.contains('show'), true);
  hud.tick(.5); assert.equal(marker.classList.contains('show'), false);
});
test('HUD preserves a kill over continuous ordinary hits, expires it, and clears on screen change/pause', () => {
  const { hud } = domFixture();
  hud.hitMarker('擊毀', 'kill'); hud.tick(.2);
  for (let i = 0; i < 10; i++) { hud.hitMarker('未擊穿', 'nopen'); hud.tick(.1); }
  assert.equal(hud.el.hitMarker.textContent, 'Hit · 擊毀');
  hud.tick(.5);
  hud.hitMarker('未擊穿', 'nopen'); assert.equal(hud.el.hitMarker.dataset.kind, 'nopen');
  const G = { mode: 'battle' };
  closure('setMode', '  function startBattle(', { G, hud, sound: {}, document })( 'garage');
  assert.equal(hud.el.hitMarker.classList.contains('show'), false);
  hud.tick(0); assert.equal(hud.el.hitMarker.classList.contains('show'), false);
  hud.hitMarker('擊穿', 'pen');
  const start = main.indexOf('    pause(p = true) {');
  const end = main.indexOf('    /** Advances the game', start);
  const control = new Function('G', 'hud', `return {${main.slice(start, end)}};`)(G, hud);
  control.pause(true); control.pause(false);
  assert.equal(hud.el.hitMarker.classList.contains('show'), false);
});

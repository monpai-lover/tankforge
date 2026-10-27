import {mountedDetailsPrelude} from './fixture-model-upgrade.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../bundle/app.js.html', import.meta.url), 'utf8');
const cut = (a, b) => {
  const i = source.indexOf(a), j = source.indexOf(b, i);
  assert.ok(i >= 0 && j > i, a);
  return source.slice(i, j);
};
const sim = { time: 0 }, bots = { list: [] }, tones = [];
let visible = true;
const c = vm.createContext({ G4: sim, airBots: bots, AIRCRAFT_TYPES: {},
  L10N: (_, en) => en, surfaceAt: () => 0, airLos: () => visible,
  airReason: (air, text) => (air.reason = text, false), airTone: x => tones.push(x),
  targetAlive: t => !!t && !t.bot.gone && !t.bot.plane.crashed,
});
vm.runInContext(cut('/* TF_GUIDED_AIRCRAFT_VARIANTS_BEGIN */','/* TF_GUIDED_AIRCRAFT_VARIANTS_END */')+mountedDetailsPrelude(source)+`
const D2R=Math.PI/180;
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const norm=a=>{const l=Math.hypot(...a)||1;return a.map(v=>v/l);};
const noseOf=P=>norm(Array.from(P.cur.slice(48,51)));
` + cut('    const AIR_RADARS = ', '    /**\n     * Countermeasures')
  + cut('    const AIR_EQUIP = ', '    /** Targeting pods:')
  + cut('    function bodyDir(P, w) {', '    /** A segment through an upright box')
  + cut('    function airCtl(air) {', '    /** The pod the flight can use:')
  + cut('    function radarCheck(P, R, p,', '    // ---- targeting pod:')
  + 'globalThis.api={AIR_RADARS,AIR_EQUIP,airCtl,RADAR_MODES,radarDogfight,radarSetMode,radarAcmCheck,radarAcmDirection,radarElevation,stepRadarSys,radarPower,radarModeCycle,radarLockRequest};', c);
const api = c.api;
function plane(type = 'f15c') {
  const cur = new Float64Array(64); cur[50] = 1;
  const p = { type: { id: type }, position: [0, 3000, 0], cur,
    root: { local: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    damage: { dead: () => false }, crashed: false };
  return p;
}
function flight(type = 'f15c') {
  sim.time = 0; visible = true; bots.list = []; tones.length = 0;
  const air = { plane: plane(type), stores: { intact: true }, guns: [{ ammo: 120 }] };
  api.airCtl(air); return air;
}
function point(p, az, el, dist = 5000) {
  const d = api.radarAcmDirection(p, az * Math.PI / 180, el * Math.PI / 180);
  return p.position.map((v, i) => v + d[i] * dist);
}
function target(p, az = 0, el = 0, dist = 5000) {
  const b = { plane: plane('mig29') };
  b.plane.position = point(p, az, el, dist); b.target = { bot: b };
  return b;
}
const step = (air, time) => { sim.time = time; api.stepRadarSys(air, 1 / 60); };

test('the original seven radars, delivered MiG-21 and two source-inherited variants expose ACM without adding radar to other aircraft', () => {
  const originalIds=['nf02','f104g','f4e','f15c','mig29','su27','f16v'];
  assert.deepEqual(Object.keys(api.AIR_RADARS).sort(),[...originalIds,'mig21','su27skm','mig29smt'].sort());
  assert.deepEqual(api.AIR_RADARS.mig21,c.TFMountedDetails.radars({}).mig21,'The delivered mounted-details helper supplies the actual RP-22 record');
  for(const [id,base,label]of [['su27skm','su27','Su-27SKM 雷達（繼承 N001 遊戲參數）'],['mig29smt','mig29','Zhuk-ME（既有雷達遊戲參數）']]){
    assert.equal(c.TFGuidedAircraftVariants.sourceId(id),base);
    const {name,provenance,...parameters}=api.AIR_RADARS[id],{name:sourceName,...sourceParameters}=api.AIR_RADARS[base];
    assert.equal(name,label);assert.match(provenance,/gameplay parameters inherited from source aircraft/);
    assert.notEqual(api.AIR_RADARS[id],api.AIR_RADARS[base]);
    assert.ok(sourceName);assert.deepEqual(parameters,sourceParameters,id+' retains every real source radar parameter');
  }
  for (const id of Object.keys(api.AIR_RADARS)) {
    const air = flight(id);
    assert.ok(api.RADAR_MODES(air.ctl.radar.R).includes('acm'), id);
    api.radarDogfight(air); assert.equal(air.ctl.radar.mode, 'acm', id);
    const b = target(air.plane, 4, -4); bots.list = [b];
    step(air, 0); step(air, 0.1); step(air, 0.2);
    assert.equal(air.ctl.radar.stt?.state, 'track', id);
    assert.equal(air.ctl.radar.stt?.target, b.target, id);
  }
  assert.ok(api.RADAR_MODES({ pd: false }).includes('acm'));
  for (const id of ['mig15', 'mig17f', 'a10a', 'su25', 'mirage3e', 'p51d']) {
    const air = flight(id); api.radarDogfight(air);
    assert.equal(air.ctl.radar, null, id); assert.match(air.reason, /no radar/);
  }
});
test('toggle restores the previous mode, range and antenna, clears stale tracks, and never changes weapons', () => {
  const air = flight(), rd = air.ctl.radar, stores = air.stores;
  rd.mode = 'tws'; rd.scale = 40; rd.elev = 0.1; rd.stt = {}; rd.tracks.set({}, {});
  api.radarDogfight(air);
  assert.equal(rd.mode, 'acm'); assert.equal(rd.scale, 10); assert.equal(rd.elev, 0);
  assert.equal(rd.stt, null); assert.equal(rd.tracks.size, 0);
  api.radarElevation(air, 1); assert.equal(rd.elev, 0);
  api.radarDogfight(air);
  assert.equal(rd.mode, 'tws'); assert.equal(rd.scale, 40); assert.equal(rd.elev, 0.1);
  assert.equal(air.stores, stores); assert.equal(air.guns[0].ammo, 120);
  rd.on = false; api.radarDogfight(air); assert.equal(rd.on, true);
  api.radarModeCycle(air); assert.equal(rd.mode, 'search'); assert.equal(rd.scale, 40);
});
test('ACM scans at 10 Hz, acquires only on revisits, and locks after 0.2 s of continuous observations', () => {
  const air = flight(), rd = air.ctl.radar;
  api.radarDogfight(air); step(air, 0);
  const b = target(air.plane); bots.list.push(b);
  step(air, 0.016); assert.equal(rd.stt, null);
  step(air, 0.1); assert.equal(rd.stt.state, 'acq'); assert.equal(rd.stt.target, b.target);
  step(air, 0.199); assert.equal(rd.stt.seen, 0.1);
  step(air, 0.2); assert.equal(rd.stt.state, 'acq');
  step(air, 0.3); assert.equal(rd.stt.state, 'track'); assert.equal(tones.length, 1);
  const empty = flight(); api.radarDogfight(empty);
  const scans = new Set();
  for (let k = 0; k < 60; k++) { step(empty, k / 60); scans.add(empty.ctl.radar.acmScanAt); }
  assert.equal(scans.size, 10);
});
test('scan excludes every edge, rear target and excess range, even if an old selected target exists', () => {
  const air = flight(), p = air.plane, R = air.ctl.radar.R;
  for (const [az, el, dist, ok] of [[4.99, 4.99, 9900, true], [-4.99, -4.99, 5000, true],
    [5.01, 0, 1000, false], [-5.01, 0, 1000, false], [0, 5.01, 1000, false],
    [0, -5.01, 1000, false], [0, 0, 10001, false], [180, 0, 1000, false]]) {
    assert.equal(api.radarAcmCheck(p, R, point(p, az, el, dist)).ok, ok, `${az},${el},${dist}`);
  }
  api.radarDogfight(air);
  const outside = target(p, 0, 20, 1000), farther = target(p, 0, 0, 6000), near = target(p, 4, 4, 2000);
  air.ctl.selected = outside.target; bots.list = [outside, farther, near]; step(air, 0);
  assert.equal(air.ctl.radar.tracks.size, 2); assert.equal(air.ctl.radar.stt.target, near.target);
  assert.equal(air.ctl.selected, near.target);
});
test('the acquisition window follows banked and vertical accepted attitude, rather than world horizon or mouse look', () => {
  const air = flight(), p = air.plane, R = air.ctl.radar.R;
  for (const m of [
    [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1]]) {
    p.root.local = m; p.cur.set(m.slice(8, 11), 48); p.aim = [1, 0, 0];
    assert.equal(api.radarAcmCheck(p, R, point(p, 4, -4)).ok, true);
    assert.equal(api.radarAcmCheck(p, R, point(p, 0, 6)).ok, false);
  }
});
test('a target leaving during acquisition cancels; an acquired STT follows it outside the box and uses normal loss memory', () => {
  const air = flight(), rd = air.ctl.radar, b = target(air.plane);
  api.radarDogfight(air); bots.list = [b]; step(air, 0);
  b.plane.position = point(air.plane, 6, 0); step(air, 0.1); assert.equal(rd.stt, null);
  b.plane.position = point(air.plane, 0, 0); step(air, 0.2); step(air, 0.3); step(air, 0.4);
  assert.equal(rd.stt.state, 'track');
  b.plane.position = point(air.plane, 30, 0); step(air, 0.5); assert.equal(rd.stt.state, 'track');
  b.plane.position = point(air.plane, 100, 0); step(air, 0.6); assert.equal(rd.stt.state, 'memory');
  step(air, 2.61); assert.equal(rd.stt, null);
});
test('ground clutter, line of sight, power, damage, and disappearance still gate auto-acquisition', () => {
  const air = flight('f104g'), rd = air.ctl.radar, b = target(air.plane);
  api.radarDogfight(air); bots.list = [b]; visible = false; step(air, 0); assert.equal(rd.stt, null);
  visible = true; step(air, 0.1); assert.ok(rd.stt);
  api.radarPower(air); assert.equal(rd.stt, null); assert.equal(rd.tracks.size, 0);
  step(air, 0.2); assert.equal(rd.stt, null);
  air.plane.damage.dead = () => true; api.radarDogfight(air); assert.equal(rd.on, false);
  step(air, 0.3); assert.equal(rd.broken, true);
  const low = flight('f4e'); low.plane.position[1] = 100;
  assert.equal(api.radarAcmCheck(low.plane, low.ctl.radar.R, [0, 50, 5000]).ok, false);
  const remote = flight(), remoteBot = target(remote.plane); remoteBot.remote = true;
  bots.list = [remoteBot]; api.radarDogfight(remote); step(remote, 0); assert.equal(remote.ctl.radar.stt.target, remoteBot.target);
  remoteBot.gone = true; step(remote, 0.1); assert.equal(remote.ctl.radar.stt, null); assert.equal(remote.ctl.radar.tracks.size, 0);
});
test('ACM never automatically chooses a friendly remote aircraft ahead of an enemy', () => {
  const air = flight(), friendly = target(air.plane, 0, 0, 1000), enemy = target(air.plane, 1, 1, 2000);
  friendly.friend = true; friendly.remote = 'teammate'; bots.list = [friendly, enemy];
  api.radarDogfight(air); step(air, 0);
  assert.equal(air.ctl.radar.stt.target, enemy.target);
});

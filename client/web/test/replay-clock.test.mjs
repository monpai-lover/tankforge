import test from 'node:test';
import assert from 'node:assert/strict';
import { directorKnots, transfer, createReplayClock, createReplayClockForEvent, replayDirectorPhase } from '../src/game/replayClock.js';

const canonical = [[0,0],[1,1.15],[1.8,1.65],[2.35,1.83],[3.6,2.48],[5.2,3.4],[7,4.8],[9.6,7.4]];
const close = (a, b) => assert.ok(Math.abs(a-b) < 1e-10, `${a} != ${b}`);
const event = () => ({ launch_s: 10, contact_s: 10.2, mechanism_anchors: [{ time_s: 12, phase_s: 2.48 }, { time_s: 17.4, phase_s: 7.4 }] });

test('V3 canonical forward/inverse transfer preserves the complete source knots', () => {
  assert.deepEqual(directorKnots, canonical);
  assert.equal(transfer(canonical, 1.8), 1.65);
  close(transfer(canonical, 2.74, true), 4.052173913043478);
  for (let x = 0; x < 12; x += .031) close(transfer(canonical, transfer(canonical, x), true), x);
  assert.equal(transfer(canonical, -1), 0);
  close(transfer(canonical, 11), 8.8);
});

test('late/equal anchors never edit the played prefix and future anchors remain invertible', () => {
  const input = structuredClone(canonical), clock = createReplayClock(input);
  input[1][1] = 100;
  clock.markPlayed(2.35);
  const prefix = clock.knots.filter(k => k[0] <= 2.35).map(k => k.slice());
  clock.appendPhysicalAnchors([9, 8, 7.4, 1.1, 8]);
  assert.deepEqual(clock.knots.filter(k => k[0] <= 2.35), prefix);
  clock.knots.slice(-2).forEach((k,i) => {close(k[0],[10.2,11.2][i]);assert.equal(k[1],[8,9][i]);});
  assert.equal(clock.physicalAt(1.8), 1.65);
  for (let x = 0; x < 15; x += .059) close(clock.filmAt(clock.physicalAt(x)), x);
  assert.throws(() => { clock.knots[1][1] = 90; }, TypeError);
  assert.throws(() => { clock.knots.push([20,20]); }, TypeError);
});

test('a played extrapolated tail is immutable when later physical anchors arrive', () => {
  const clock = createReplayClock(canonical);
  clock.markPlayed(12);
  const before = Array.from({ length: 121 }, (_, i) => clock.physicalAt(i/10));
  clock.appendPhysicalAnchors([8,9,9.8,10.8,12]);
  assert.deepEqual(Array.from({ length: 121 }, (_, i) => clock.physicalAt(i/10)), before);
  close(clock.physicalAt(12), 9.8);
  assert.ok(clock.knots.every((k,i,a) => !i || (k[0] > a[i-1][0] && k[1] > a[i-1][1])));
});

test('invalid times, duplicate knot axes and cursor rewinds are rejected atomically', () => {
  for (const knots of [[], [[0,0],[0,1]], [[0,0],[1,0]], [[0,0],[1,NaN]], [[-1,0],[1,1]]]) assert.throws(() => createReplayClock(knots), /knots/);
  const clock = createReplayClock(canonical);
  const before = clock.knots;
  for (const times of [[8,NaN], [-1], [Infinity], [Number.MAX_SAFE_INTEGER+1]]) assert.throws(() => clock.appendPhysicalAnchors(times), /time/);
  assert.equal(clock.knots, before);
  for (const t of [NaN,Infinity]) assert.throws(() => clock.physicalAt(t), /time/);
  assert.throws(() => clock.markPlayed(-1), /time/);
  clock.markPlayed(2);
  assert.throws(() => clock.markPlayed(1), /cursor/);
});

test('PreparedEvent launch/contact/mechanism times drive physical clock without demo timing', () => {
  const prepared = event(), original = structuredClone(prepared);
  const clock = createReplayClockForEvent(prepared);
  assert.equal(clock.physicalAt(0), 10);
  assert.equal(clock.physicalAt(1.8), 10.2);
  assert.equal(clock.physicalAt(3.6), 12);
  close(replayDirectorPhase(prepared, 11.1), (1.65+2.48)/2);
  assert.equal(replayDirectorPhase(prepared, 100), 7.4, 'unrecorded future cannot invent another mechanism phase');
  assert.deepEqual(prepared, original);
  const fast = { launch_s: 1, contact_s: 1.001, mechanism_anchors: [] };
  assert.equal(createReplayClockForEvent(fast).physicalAt(1.8), 1.001);
  assert.equal(replayDirectorPhase(fast, 1.0005), .825);
  assert.equal(replayDirectorPhase(fast, 20), 1.65);
});

test('simultaneous event anchors cannot create a zero physical span', () => {
  const e = { launch_s: 2, contact_s: 2, mechanism_anchors: [{time_s:2,phase_s:2.48},{time_s:3,phase_s:3.4}] };
  const clock = createReplayClockForEvent(e);
  assert.equal(clock.physicalAt(0), 2);
  assert.equal(replayDirectorPhase(e, 2), 2.48);
  assert.ok(clock.knots.every((k,i,a) => !i || k[1] > a[i-1][1]));
  for (const bad of [{launch_s:NaN,contact_s:2}, {launch_s:2,contact_s:1}, {launch_s:1,contact_s:2,mechanism_anchors:[{time_s:1,phase_s:2.48}]}, {launch_s:1,contact_s:2,mechanism_anchors:[{time_s:3,phase_s:1}]}]) assert.throws(() => createReplayClockForEvent(bad), /anchor/);
});

test('intermediate mechanism records retain physical breakpoints outside fixed source phases', () => {
  // Independent source phase→film arithmetic; the event clock is not its own oracle.
  const cases=[
    {phase:2,end:2.48,film:2.35+(2-1.83)/(2.48-1.83)*(3.6-2.35)},
    {phase:2.2,end:2.48,film:2.35+(2.2-1.83)/(2.48-1.83)*(3.6-2.35)},
    {phase:3,end:3.4,film:3.6+(3-2.48)/(3.4-2.48)*(5.2-3.6)},
    {phase:4.1,end:4.8,film:5.2+(4.1-3.4)/(4.8-3.4)*(7-5.2)},
  ];
  for(const {phase,end,film} of cases){
    const prepared={launch_s:10,contact_s:11,mechanism_anchors:[{time_s:15,phase_s:phase},{time_s:18,phase_s:end}]};
    const original=structuredClone(prepared), clock=createReplayClockForEvent(prepared);
    close(clock.physicalAt(film),15);
    close(clock.filmAt(15),film);
    close(replayDirectorPhase(prepared,clock.physicalAt(film)),phase);
    assert.ok(clock.knots.some(k=>Math.abs(k[0]-film)<1e-10&&k[1]===15),'recorded mechanism must remain an actual knot');
    for(let physical=10;physical<=18;physical+=.037)close(clock.physicalAt(clock.filmAt(physical)),physical);
    clock.markPlayed(film);
    const prefix=clock.knots.filter(k=>k[0]<=film).map(k=>k.slice());
    clock.appendPhysicalAnchors([14,15,19,20]);
    assert.deepEqual(clock.knots.filter(k=>k[0]<=film),prefix);
    close(clock.physicalAt(film),15);
    assert.deepEqual(prepared,original);
  }
});

test('sparse knot coordinates and sparse outer entries reject before publishing a clock', () => {
  const missingPhysical=[1];missingPhysical.length=2;
  const missingFilm=new Array(2);missingFilm[1]=1;
  const missingBoth=new Array(2);
  const missingEntry=[[0,0]];missingEntry.length=2;
  for(const malformed of [[[0,0],missingPhysical],[[0,0],missingFilm],[[0,0],missingBoth],missingEntry,[missingBoth],[[,0],[1,1]],[[0,],[1,1]]]){
    assert.throws(()=>createReplayClock(malformed),/knots/);
    assert.throws(()=>transfer(malformed,.5),/knots/);
    assert.throws(()=>transfer(malformed,.5,true),/knots/);
  }
  const control=createReplayClock([[0,0],[1,1]]);
  assert.equal(control.physicalAt(.5),.5);
  assert.equal(control.filmAt(.5),.5);
});

test('sparse mixed append batches reject atomically at every index and preserve played prefix', () => {
  for(const played of [0,3]){
    const physicalCursor=10+played, mixed=played?[9,11,physicalCursor+1,physicalCursor+2]:[9,11,12,13];
    const inputs=[new Array(3)];
    for(const batch of [[physicalCursor+2,physicalCursor+3,physicalCursor+4],mixed])for(let index=0;index<batch.length;index++){
      const sparse=batch.slice();delete sparse[index];inputs.push(sparse);
      const explicit=batch.slice();explicit[index]=undefined;inputs.push(explicit);
    }
    for(const times of inputs){
      const clock=createReplayClock([[0,10],[1,11]]);clock.markPlayed(played);
      const prior=clock.knots,copy=structuredClone(prior),inputCopy=structuredClone(times);
      const filmSamples=[0,.25,.5,1,played],before=filmSamples.map(t=>clock.physicalAt(t));
      const inverseBefore=before.map(t=>clock.filmAt(t));
      assert.throws(()=>clock.appendPhysicalAnchors(times),/time/);
      assert.equal(clock.knots,prior);assert.deepEqual(clock.knots,copy);assert.deepEqual(times,inputCopy);
      assert.deepEqual(filmSamples.map(t=>clock.physicalAt(t)),before);
      assert.deepEqual(before.map(t=>clock.filmAt(t)),inverseBefore);
      clock.markPlayed(played);
      if(played)assert.throws(()=>clock.markPlayed(played-1),/cursor/);
    }
  }
  const control=createReplayClock([[0,10],[1,11]]);
  assert.equal(control.appendPhysicalAnchors([13,12,12,10,11]),2);
  assert.deepEqual(control.knots,[[0,10],[1,11],[2,12],[3,13]]);
  assert.equal(control.appendPhysicalAnchors([]),0);
});

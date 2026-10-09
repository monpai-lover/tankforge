import test from 'node:test';
import assert from 'node:assert/strict';
import * as flow from '../src/game/onlineLaunch.js';
import { makeLoadout, tickLauncher } from '../src/game/loadout.js';
import { newLoading } from '../src/sim/loading.js';
import { loadData } from '../tools/load-data.mjs';

const data = loadData();
function setup() {
  assert.equal(typeof flow.OnlineLaunches, 'function', 'online missile ammunition must wait for a matching server acknowledgement');
  const g = makeLoadout('us_m901_itv', data.vehicles.us_m901_itv, data.projectiles).turrets[0].guns[0];
  return { q: new flow.OnlineLaunches(), g, L: newLoading(1, 1), session: {} };
}
const msg = seq => ({ t: 'launch', seq, missile: 'bgm71a_tow', o: [0, 2.72, 0.325], d: [0, 0, 1] });
const begin = (s, seq, now = 0) => s.q.begin({ gun: s.g, loading: s.L, ti: 0, gi: 0, msg: msg(seq), session: s.session }, now);

test('sending and retrying a missile request reserves a tube without spending its ammunition', () => {
  const s = setup();
  assert.equal(begin(s, 1), true);
  assert.equal(s.g.ammo[0].count, 12);
  assert.equal(s.g.launcher.ready, 2);
  assert.equal(s.g.launcher.cooldown, 0);
  assert.equal(s.L.state[0], 'ready');
  assert.equal(begin(s, 2, 0.25), false, 'one unconfirmed request per gun');
  const sent = [];
  s.q.retry(0.9, m => sent.push(m));
  assert.equal(sent.length, 0);
  s.q.retry(1.1, m => sent.push(m));
  assert.deepEqual(sent, [msg(1)], 'a timeout repeats the exact sequence and payload');
  assert.equal(s.g.ammo[0].count, 12);
});

test('the first matching ACK spends one tube and starts the spacing clock; duplicate ACKs are inert', () => {
  const s = setup();
  begin(s, 1);
  assert.equal(s.q.confirm(1, 'tt250_rocket', s.g, s.session), null, 'wrong missile cannot acknowledge a request');
  assert.ok(s.q.confirm(1, 'bgm71a_tow', s.g, s.session));
  assert.equal(s.g.ammo[0].count, 11);
  assert.equal(s.g.launcher.ready, 1);
  assert.equal(s.g.launcher.cooldown, 0.25);
  assert.equal(s.L.state[0], 'ready');
  assert.equal(s.q.confirm(1, 'bgm71a_tow', s.g, s.session), null);
  assert.equal(s.g.ammo[0].count, 11);
  tickLauncher(s.g, 0.25);
  assert.equal(begin(s, 2, 0.5), true);
  assert.equal(s.g.ammo[0].count, 11);
  s.q.confirm(2, 'bgm71a_tow', s.g, s.session);
  assert.equal(s.g.ammo[0].count, 10);
  assert.equal(s.L.state[0], 'waiting');
});

test('every rejection releases the request while retaining the missile, including rate rejection', () => {
  for (const reason of ['rate_limited', 'invalid_origin', 'invalid_launch', 'no_ammo', 'not_in_room', 'not_in_battle', 'destroyed', 'launch_failed']) {
    const s = setup();
    begin(s, 1);
    assert.ok(s.q.reject(1, reason === 'rate_limited' ? 0.05 : 0, s.session));
    assert.equal(s.g.ammo[0].count, 12, reason);
    assert.equal(s.g.launcher.ready, 2, reason);
    assert.equal(s.L.state[0], 'ready', reason);
    tickLauncher(s.g, 0.05);
    assert.equal(begin(s, 2, 1), true, 'the launcher is not permanently locked');
  }
});

test('ACK-relative spacing prevents the 100 ms then 50 ms outbound delay inversion', () => {
  const s = setup();
  begin(s, 1, 0);
  const firstServerArrival = 0.1;
  const firstAckArrival = 0.15;
  s.q.confirm(1, 'bgm71a_tow', s.g, s.session);
  tickLauncher(s.g, 0.1);
  assert.equal(begin(s, 2, 0.25), false, '250 ms after send is only 100 ms after the first ACK');
  assert.ok(0.25 + 0.05 - firstServerArrival < 0.25, 'the rejected legacy timing would arrive 200 ms apart');
  tickLauncher(s.g, 0.15);
  const secondSend = firstAckArrival + 0.25;
  assert.equal(begin(s, 2, secondSend), true);
  const secondServerArrival = secondSend + 0.05;
  assert.ok(secondServerArrival - firstServerArrival >= 0.25);
  s.q.confirm(2, 'bgm71a_tow', s.g, s.session);
  assert.equal(s.g.ammo[0].count, 10);
  assert.equal(s.g.launcher.ready, 0);
});

test('a server rate rejection cannot manufacture the full-reload state', () => {
  const s = setup();
  begin(s, 1); s.q.confirm(1, 'bgm71a_tow', s.g, s.session);
  tickLauncher(s.g, 0.25);
  begin(s, 2, 0.4);
  s.q.reject(2, 0.2, s.session);
  assert.equal(s.g.ammo[0].count, 11);
  assert.equal(s.g.launcher.ready, 1);
  assert.equal(s.L.state[0], 'ready');
  tickLauncher(s.g, 0.2);
  begin(s, 3, 0.6); s.q.confirm(3, 'bgm71a_tow', s.g, s.session);
  assert.equal(s.g.ammo[0].count, 10);
  assert.equal(s.L.state[0], 'waiting');
});

test('late receipts from an old gun or session cannot consume a replacement vehicle', () => {
  const s = setup();
  begin(s, 1);
  const replacement = setup().g;
  assert.equal(s.q.confirm(1, 'bgm71a_tow', replacement, s.session), null);
  assert.equal(replacement.ammo[0].count, 12);
  assert.equal(s.g.ammo[0].count, 12);
  assert.equal(s.q.has(s.g), false);
  begin(s, 2);
  assert.equal(s.q.confirm(2, 'bgm71a_tow', s.g, {}), null);
  assert.equal(s.g.ammo[0].count, 12);
});

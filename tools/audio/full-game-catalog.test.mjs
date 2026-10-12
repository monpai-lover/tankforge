import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../client/web/tools/load-data.mjs';
import { makeLoadout } from '../../client/web/src/game/loadout.js';

const root = new URL('../../', import.meta.url);
const read = p => JSON.parse(fs.readFileSync(new URL(p, root), 'utf8'));
const bank = read('tools/audio/banks/full-game-v1.json');
const bindings = read('tools/audio/banks/full-game-bindings-v1.json');
const data = loadData();
const byBinding = binding => bindings.profiles.find(p => p.bindings.includes(binding));
const byId = id => bindings.profiles.find(p => p.id === id);
assert.equal(bank.schemaVersion, 2);
assert.equal(bank.modelId, 'eleven_text_to_sound_v2');
assert.equal(bank.provider, 'ElevenLabs');
assert.equal(bindings.adoption.statement, '同時完成所有的音效生成和替換');
assert.equal(bindings.adoption.source, 'human-direct-instruction');
const cueMap = new Map(bank.cues.map(c => [c.id, c]));
assert.equal(cueMap.size, bank.cues.length, 'cue IDs are unique');
for (const c of bank.cues) {
  assert.match(c.id, /^[a-z][a-z0-9_]{2,95}$/);
  assert.ok(c.prompt.length <= 450 && c.prompt.length > 0, c.id);
  assert.ok(c.sourceEvidence.length <= 1000 && c.sourceEvidence.length > 0, c.id);
  assert.ok(c.durationSeconds >= .5 && c.durationSeconds <= 30, c.id);
  assert.deepEqual(c.takes, [1], 'one bounded first take');
  assert.equal(c.demoOnly, false);
  assert.equal(c.subjectiveAudition, 'NOT RUN');
  for (const b of c.bindings) assert.match(b, /^(gun|mg|engine|missile):[A-Za-z0-9_]{1,96}$/);
}
let mounts = 0, mgMounts = 0;
const guns = new Set();
for (const [id, bundle] of Object.entries(data.vehicles)) {
  assert.ok(bindings.vehicleEngines[id], 'every vehicle has an engine family');
  assert.ok(bindings.vehicleRunningGear[id], 'every vehicle has a running-gear family');
  const loadout = makeLoadout(id, bundle, data.projectiles, data.machineGuns);
  for (const turret of loadout.turrets) for (const gun of turret.guns) {
    mounts++; guns.add(gun.def.id);
    const p = byBinding('gun:' + gun.def.id);
    assert.ok(p, gun.def.id);
    assert.ok(Object.values(p.cues).every(c => cueMap.has(c)), gun.def.id);
    if (gun.def.missile) assert.ok(byBinding('missile:' + gun.def.missile));
    assert.ok(bindings.reloads.weapon[gun.def.id], 'all gun/feed/launcher reload classifications are explicit');
  }
  for (const mg of loadout.machineGuns) {
    mgMounts++;
    assert.ok(byBinding('mg:' + mg.weapon));
  }
}
assert.equal(data.order.length, 44);
assert.equal(guns.size, 40);
assert.equal(mounts, 50);
assert.equal(mgMounts, 47);
for (const id of Object.keys(data.machineGuns)) {
  assert.ok(byBinding('mg:' + id), id);
  assert.ok(bindings.reloads.mg[id], id);
}
const identities = new Set(bindings.profiles.filter(p => p.group === 'firing').map(p => p.id));
assert.equal(identities.size, 48, 'approved identity sharing only');
const firing = bank.cues.filter(c => c.group === 'firing');
assert.equal(firing.length, 56);
assert.equal(bindings.profiles.filter(p => p.kind === 'engine').length, 16);
for (const p of bindings.profiles.filter(p => p.kind === 'engine')) {
  const id = p.id;
  assert.deepEqual(Object.keys(p.cues).sort(), ['high', 'idle', 'load', 'mid', 'start', 'stop']);
  for (const role of ['idle', 'mid', 'high']) {
    assert.equal(cueMap.get(p.cues[role]).durationSeconds, 4, id);
    assert.equal(cueMap.get(p.cues[role]).loop, true, id);
  }
}
assert.equal(bindings.vehicleEngines.su_t72a, 'E16');
assert.notEqual(byBinding('mg:pkt').id, byBinding('mg:sgmt').id);
assert.notEqual(byBinding('mg:nsvt').id, byBinding('mg:dshk').id);
assert.equal(byBinding('gun:kda_35').id, byBinding('gun:kda_35_gepard').id);
assert.equal(byBinding('gun:kpvt_145').id, byBinding('mg:kpvt').id);
assert.equal(byBinding('gun:tt250_rail_r').id, byBinding('gun:tt250_rail_l').id);
assert.ok(byId('engine_E16'));
const selected = new Set();
for (const batch of bank.batches) {
  assert.ok(batch.ids.length <= 11 && batch.ids.length > 0, batch.id);
  const total = batch.ids.reduce((s, id) => {
    assert.ok(!selected.has(id), 'no repeated purchases in batch plan'); selected.add(id);
    const cue = cueMap.get(id); assert.ok(cue?.generationReady, id); return s + cue.durationSeconds;
  }, 0);
  assert.ok(total <= 60, batch.id);
  assert.ok(Math.abs(total - batch.requestedSeconds) < 1e-8);
}
assert.deepEqual([...selected].sort(), bank.cues.filter(c => c.generationReady).map(c => c.id).sort());
for (const c of Object.values(bindings.cues)) {
  assert.equal(c.subjectiveAudition, 'NOT RUN', 'no invented subjective PASS');
  assert.equal(c.readyForGame, false, 'planned clips cannot be admitted before Root verifies selections');
}
for (const [id, c] of Object.entries(bindings.externalCues)) assert.ok(fs.existsSync(new URL(c.file, root)), id);
assert.equal(bindings.rejectedCandidateIds.length, 3);
assert.ok(bank.cues.every(c => !/authentic recording/i.test(c.prompt)), 'no invented recording provenance');
console.log(JSON.stringify({ result: 'PASS', cues: bank.cues.length, firingCues: firing.length, acousticIdentities: identities.size, engineFamilies: 16, vehicles: data.order.length, gunMounts: mounts, mgMounts, batches: bank.batches.length, providerCalls: 0, root: fileURLToPath(root) }));

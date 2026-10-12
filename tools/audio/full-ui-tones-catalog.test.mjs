import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = name => JSON.parse(fs.readFileSync(new URL('banks/' + name, import.meta.url), 'utf8'));
const bank = read('full-ui-tones-v1.json');
const manifest = read('full-ui-tones-bindings-v1.json');
const types = ['on', 'off', 'detect', 'lock', 'overheat', 'empty', 'fault'];
assert.equal(bank.schemaVersion, 2);
assert.equal(bank.modelId, 'eleven_text_to_sound_v2');
assert.equal(bank.cues.length, 7);
assert.deepEqual(bank.cues.map(c => c.id), types.map(t => 'ui_tone_' + t));
for (const c of bank.cues) {
  assert.equal(c.kind, 'ui');
  assert.deepEqual(c.takes, [1]);
  assert.deepEqual(c.bindings, []);
  assert.equal(c.durationSeconds, .5);
  assert.equal(c.loop, false);
  assert.equal(c.subjectiveAudition, 'NOT RUN');
  assert.ok(c.prompt.length <= 450);
  assert.ok(c.sourceEvidence.includes('Sound.tone'));
}
assert.equal(bank.batches.length, 1);
assert.equal(bank.batches[0].requestedSeconds, 3.5);
assert.deepEqual(bank.batches[0].ids, bank.cues.map(c => c.id));
for (const t of types) {
  const p = manifest.profiles.find(p => p.selector === 'tone:' + t);
  assert.equal(p.kind, 'ui');
  assert.equal(p.cues.tone, 'ui_tone_' + t);
  assert.equal(manifest.cues[p.cues.tone].readyForGame, false);
}
const full = read('full-game-bindings-v1.json');
assert.deepEqual(full.effectSelectors.blastMassKg.map(t => t.maxExclusive), [.05, .25, 1, 5, null]);
console.log('PASS: seven typed UI states, seven first takes, 3.5 seconds, approved blast thresholds; provider calls: 0');

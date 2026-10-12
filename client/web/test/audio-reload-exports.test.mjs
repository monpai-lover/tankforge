import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const exporter = await import('../tools/load-reload-audio.mjs').catch(() => null);
const hash = b => createHash('sha256').update(b).digest('hex');
function fixture() {
  assert.ok(exporter?.loadReloadAudio, 'reviewed production export loader is required');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-reload-export-'));
  const dir = path.join(root, 'client/web/assets/reload-audio'); fs.mkdirSync(dir, { recursive: true });
  const bytes = Buffer.from('reviewed audio fixture'); fs.writeFileSync(path.join(dir, 'de_manual_grab.wav'), bytes);
  const manifest = { schemaVersion: 1, bankId: 'regional-reloads-v1', reviewState: 'reviewed', approval: { source: 'human', statement: '裝填聲合適', scope: 'nine-regional-manual-stages' },
    cues: [{ id: 'de_manual_grab', file: 'client/web/assets/reload-audio/de_manual_grab.wav', sha256: hash(bytes), readyForGame: true, subjectiveAudition: 'PASS' }] };
  const save = () => fs.writeFileSync(path.join(root, 'client/web/assets/reload-audio.json'), JSON.stringify(manifest)); save();
  return { root, manifest, save, clean: () => fs.rmSync(root, { recursive: true, force: true }) };
}
test('reviewed exports embed only explicitly selected cue bytes', () => {
  const f = fixture(); try {
    const bank = exporter.loadReloadAudio(f.root);
    assert.equal(bank.reviewState, 'reviewed'); assert.deepEqual(Object.keys(bank.cues), ['de_manual_grab']);
    assert.match(bank.cues.de_manual_grab.url, /^data:audio\/wav;base64,/);
  } finally { f.clean(); }
});
test('unreviewed/demo exports and absent human selection cannot enter the production payload', () => {
  for (const mutate of [m => m.reviewState = 'candidate', m => m.cues[0].readyForGame = false, m => m.cues[0].subjectiveAudition = 'NOT RUN', m => delete m.approval]) {
    const f = fixture(); try { mutate(f.manifest); f.save(); assert.throws(() => exporter.loadReloadAudio(f.root)); } finally { f.clean(); }
  }
});
test('allowlist rejects unknown/duplicate IDs, hash mismatch, path escape and excessive payload', () => {
  for (const mutate of [m => m.cues[0].id = 'autoloader_demo_drive', m => m.cues.push({ ...m.cues[0] }), m => m.cues[0].sha256 = '0'.repeat(64), m => m.cues[0].file = '../outside.wav']) {
    const f = fixture(); try { mutate(f.manifest); f.save(); assert.throws(() => exporter.loadReloadAudio(f.root)); } finally { f.clean(); }
  }
  const f = fixture(); try { assert.throws(() => exporter.loadReloadAudio(f.root, { maxEncodedBytes: 1 })); } finally { f.clean(); }
});

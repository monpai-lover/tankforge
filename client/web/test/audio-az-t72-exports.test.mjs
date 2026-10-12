import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadReloadAudio } from '../tools/load-reload-audio.mjs';
const hash = b => createHash('sha256').update(b).digest('hex');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-az-export-'));
  const dir = path.join(root, 'client/web/assets/az-t72-audio'); fs.mkdirSync(dir, { recursive: true });
  const cues = ['drive', 'ram', 'lock'].map(stage => {
    const bytes = Buffer.from(`adopted ${stage} audio`), id = `az_t72_${stage}`;
    fs.writeFileSync(path.join(dir, id + '.wav'), bytes);
    return { id, file: `client/web/assets/az-t72-audio/${id}.wav`, sha256: hash(bytes), readyForGame: true, subjectiveAudition: 'NOT RUN', source: { id: `autoloader_demo_${stage}`, selectionProofSha256: 'a'.repeat(64) } };
  });
  const manifest = { schemaVersion: 1, bankId: 'az-t72-v1', selectionState: 'user-directed', adoption: { source: 'human-direct-instruction', statement: '自动装弹的 也用上 找个现实里用自动装弹的车', scope: 'three-fitted-az-t72-stages', mechanism: 'az_t72' }, cues };
  const save = () => fs.writeFileSync(path.join(root, 'client/web/assets/az-t72-audio.json'), JSON.stringify(manifest)); save();
  return { root, manifest, save, clean: () => fs.rmSync(root, { recursive: true, force: true }) };
}
test('separate automatic adoption exports exactly three existing textures without claiming auditory PASS', () => {
  const f = fixture(); try { const bank = loadReloadAudio(f.root); assert.deepEqual(Object.keys(bank.cues), ['az_t72_drive', 'az_t72_ram', 'az_t72_lock']); assert.equal(bank.automaticAdoption.source, 'human-direct-instruction'); assert.equal(bank.reviewState, 'user-directed'); } finally { f.clean(); }
});
test('automatic selection rejects candidate policy, fabricated audition, wrong IDs/provenance and missing direct adoption', () => {
  for (const mutate of [m => m.selectionState = 'candidate', m => delete m.adoption, m => m.adoption.source = 'audition', m => m.cues[0].subjectiveAudition = 'PASS', m => m.cues[0].readyForGame = false, m => m.cues[0].id = 'de_manual_grab', m => m.cues[0].source.id = 'other', m => m.cues[0].source.selectionProofSha256 = 'bad', m => m.cues.pop()]) {
    const f = fixture(); try { mutate(f.manifest); f.save(); assert.throws(() => loadReloadAudio(f.root)); } finally { f.clean(); }
  }
});
test('automatic exports retain local-path/hash/duplicate/payload protections', () => {
  for (const mutate of [m => m.cues[0].file = '../outside.wav', m => m.cues[0].sha256 = '0'.repeat(64), m => m.cues[1] = { ...m.cues[0] }]) {
    const f = fixture(); try { mutate(f.manifest); f.save(); assert.throws(() => loadReloadAudio(f.root)); } finally { f.clean(); }
  }
  const f = fixture(); try { assert.throws(() => loadReloadAudio(f.root, { maxEncodedBytes: 1 })); } finally { f.clean(); }
});

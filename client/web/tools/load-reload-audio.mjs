import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const IDS = new Set(['de', 'su', 'us'].flatMap(style => ['grab', 'load', 'lock'].map(stage => `${style}_manual_${stage}`)));
const AZ_IDS = new Set(['az_t72_drive', 'az_t72_ram', 'az_t72_lock']);
const MIME = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };

/** Reviewed exports are deliberately separate from raw provider/authoring folders. */
export function loadReloadAudio(repositoryRoot, { maxEncodedBytes = 24 * 1024 * 1024 } = {}) {
  const root = path.resolve(repositoryRoot);
  const file = path.join(root, 'client/web/assets/reload-audio.json');
  const cues = {}, bank = { schemaVersion: 1, reviewState: 'disabled', cues }, state = { hashes: new Set(), payload: 0 };
  if (fs.existsSync(file)) {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (manifest.schemaVersion !== 1 || manifest.bankId !== 'regional-reloads-v1' || manifest.reviewState !== 'reviewed' ||
        manifest.approval?.source !== 'human' || !manifest.approval.statement || manifest.approval.scope !== 'nine-regional-manual-stages' || !Array.isArray(manifest.cues)) throw new Error('Loading audio requires reviewed human selection');
    appendExports(root, manifest, 'reload-audio', IDS, e => e.subjectiveAudition === 'PASS', cues, state, maxEncodedBytes);
    Object.assign(bank, { bankId: manifest.bankId, reviewState: 'reviewed', approval: manifest.approval });
  }
  const automaticFile = path.join(root, 'client/web/assets/az-t72-audio.json');
  if (fs.existsSync(automaticFile)) {
    const manifest = JSON.parse(fs.readFileSync(automaticFile, 'utf8'));
    const a = manifest.adoption;
    if (manifest.schemaVersion !== 1 || manifest.bankId !== 'az-t72-v1' || manifest.selectionState !== 'user-directed' ||
        a?.source !== 'human-direct-instruction' || typeof a.statement !== 'string' || !a.statement.trim() ||
        a.scope !== 'three-fitted-az-t72-stages' || a.mechanism !== 'az_t72' || !Array.isArray(manifest.cues) || manifest.cues.length !== 3) throw new Error('AZ audio requires explicit user-directed adoption');
    appendExports(root, manifest, 'az-t72-audio', AZ_IDS, e => e.subjectiveAudition === 'NOT RUN' &&
      e.source?.id === e.id.replace('az_t72_', 'autoloader_demo_') && /^[a-f0-9]{64}$/.test(e.source.selectionProofSha256), cues, state, maxEncodedBytes);
    bank.automaticAdoption = a;
    if (bank.reviewState === 'disabled') bank.reviewState = 'user-directed';
  }
  return bank;
}

function appendExports(root, manifest, folder, ids, selected, cues, state, maxEncodedBytes) {
  const directory = path.join(root, 'client/web/assets', folder);
  for (const entry of manifest.cues) {
    if (!ids.has(entry.id) || cues[entry.id] || entry.readyForGame !== true || !selected(entry) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid or unselected loading export');
    if (typeof entry.file !== 'string' || path.isAbsolute(entry.file) || entry.file.includes('\\') || entry.file.includes('\0')) throw new Error('Unsafe loading export path');
    const resolved = path.resolve(root, entry.file);
    const relative = path.relative(directory, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Loading export escaped allowlist directory');
    const mime = MIME[path.extname(resolved).toLowerCase()];
    if (!mime) throw new Error('Unsupported loading export format');
    let component = root;
    for (const part of path.relative(root, resolved).split(path.sep)) {
      if (!part || /[:\0]/.test(part)) throw new Error('Unsafe loading export component');
      component = path.join(component, part);
      if (fs.lstatSync(component).isSymbolicLink() || fs.realpathSync.native(component).toLowerCase() !== component.toLowerCase()) throw new Error('Linked loading export rejected');
    }
    const bytes = fs.readFileSync(resolved);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== entry.sha256 || state.hashes.has(sha256)) throw new Error('Loading export hash mismatch or duplicate bytes');
    state.hashes.add(sha256);
    state.payload += 4 * Math.ceil(bytes.length / 3);
    if (!bytes.length || state.payload > maxEncodedBytes) throw new Error('Loading export payload exceeds limit');
    cues[entry.id] = { url: `data:${mime};base64,${bytes.toString('base64')}`, sha256 };
  }
}

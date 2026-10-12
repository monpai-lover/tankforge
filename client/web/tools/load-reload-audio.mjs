import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const IDS = new Set(['de', 'su', 'us'].flatMap(style => ['grab', 'load', 'lock'].map(stage => `${style}_manual_${stage}`)));
const MIME = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };

/** Reviewed exports are deliberately separate from raw provider/authoring folders. */
export function loadReloadAudio(repositoryRoot, { maxEncodedBytes = 24 * 1024 * 1024 } = {}) {
  const root = path.resolve(repositoryRoot);
  const file = path.join(root, 'client/web/assets/reload-audio.json');
  if (!fs.existsSync(file)) return { schemaVersion: 1, reviewState: 'disabled', cues: {} };
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.bankId !== 'regional-reloads-v1' || manifest.reviewState !== 'reviewed' ||
      manifest.approval?.source !== 'human' || !manifest.approval.statement || manifest.approval.scope !== 'nine-regional-manual-stages' || !Array.isArray(manifest.cues)) throw new Error('Loading audio requires reviewed human selection');
  const directory = path.join(root, 'client/web/assets/reload-audio');
  const cues = {}, hashes = new Set();
  let payload = 0;
  for (const entry of manifest.cues) {
    if (!IDS.has(entry.id) || cues[entry.id] || entry.readyForGame !== true || entry.subjectiveAudition !== 'PASS' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid or unreviewed loading export');
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
    if (sha256 !== entry.sha256 || hashes.has(sha256)) throw new Error('Loading export hash mismatch or duplicate bytes');
    hashes.add(sha256);
    payload += 4 * Math.ceil(bytes.length / 3);
    if (!bytes.length || payload > maxEncodedBytes) throw new Error('Loading export payload exceeds limit');
    cues[entry.id] = { url: `data:${mime};base64,${bytes.toString('base64')}`, sha256 };
  }
  return { schemaVersion: 1, bankId: manifest.bankId, reviewState: 'reviewed', approval: manifest.approval, cues };
}

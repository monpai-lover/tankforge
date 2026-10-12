// Local audition scaffold. It never generates audio or contacts a provider.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertArtifactPath } from './reload-recipe.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function buildListeningSet({ repositoryRoot = root, bankId = 'detailed-v1', batchId = 'detailed-pilot-20261012', outputName = 'listening.html' } = {}) {
  if ([bankId, batchId, outputName].some(value => typeof value !== 'string') || !/^[a-z0-9][a-z0-9-]{2,47}$/.test(bankId) || !/^[a-z0-9][a-z0-9-]{2,47}$/.test(batchId) || !/^[a-z][a-z0-9_-]{1,63}\.html$/.test(outputName)) throw new Error('Invalid audition selection');
  const bankPath = path.join(repositoryRoot, 'tools/audio/banks', `${bankId}.json`);
  const canonical = fs.realpathSync.native(bankPath), expected = path.resolve(bankPath);
  if (fs.lstatSync(bankPath).isSymbolicLink() || (process.platform === 'win32' ? canonical.toLowerCase() !== expected.toLowerCase() : canonical !== expected)) throw new Error('Linked bank rejected');
  const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
  if (bank.schemaVersion !== 2 || bank.bankId !== bankId || bank.modelId !== 'eleven_text_to_sound_v2' || !Array.isArray(bank.cues)) throw new Error('Invalid audition bank');
  const cues = bank.cues.filter(c => c.generationReady === true), folder = `artifacts/audio/elevenlabs/${bankId}/${batchId}`;
  let seconds = 0, available = 0;
  const rows = cues.map(cue => {
    if (typeof cue.id !== 'string' || !/^[a-z][a-z0-9_]{2,95}$/.test(cue.id) || !Number.isFinite(cue.durationSeconds) || cue.durationSeconds < .5 || cue.durationSeconds > 30 || typeof cue.kind !== 'string' || typeof cue.loop !== 'boolean') throw new Error('Invalid audition cue');
    seconds += cue.durationSeconds;
    const name = `${cue.id}-take-01.mp3`, source = assertArtifactPath(repositoryRoot, `${folder}/${name}`);
    let present = false;
    try { present = fs.lstatSync(source).isFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (present) { assertArtifactPath(repositoryRoot, source, { mustExist: true }); available++; }
    return `<section><h2>${escape(cue.id)}</h2><p>${escape(cue.kind)} · ${cue.durationSeconds} s · ${cue.loop ? 'loop' : 'one-shot'} · prototype</p>${present ? `<audio controls preload="none"${cue.loop ? ' loop' : ''} src="${escape(name)}"></audio><p>Raw take: audition and QA pending.</p>` : '<p class="pending">Pending generation — no audio file exists yet.</p>'}${cue.kind === 'autoloader_demo' ? '<p>Generic test rig; no game vehicle assignment.</p>' : ''}</section>`;
  });
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TankForge audio audition</title><style>body{max-width:900px;margin:32px auto;padding:0 20px;background:#101715;color:#e6eee9;font:16px/1.5 system-ui}h1{font-size:28px}h2{font-size:18px}section{border-top:1px solid #35443d;padding:14px 0}audio{width:100%}.pending{color:#b7c7bb}</style><body><h1>TankForge audio audition</h1><p>${escape(bankId)} / ${escape(batchId)} · Sound Effects V2</p><p>${available}/${cues.length} raw takes available. Planned ${Math.round(seconds * 1e6) / 1e6} seconds; estimated ${Math.round(seconds * 40)} credits. This page makes no generation requests and does not approve or install sounds.</p>${rows.join('\n')}</body></html>\n`;
  const outputPath = assertArtifactPath(repositoryRoot, `${folder}/${outputName}`), temp = `${outputPath}.${randomUUID()}.tmp`;
  if (fs.existsSync(outputPath)) throw new Error('Audition destination exists');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  assertArtifactPath(repositoryRoot, outputPath); assertArtifactPath(repositoryRoot, temp);
  let fd;
  try { fd = fs.openSync(temp, 'wx'); fs.writeFileSync(fd, html); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined; fs.linkSync(temp, outputPath); }
  finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temp)) { assertArtifactPath(repositoryRoot, temp); fs.unlinkSync(temp); } }
  return { outputPath, availableTakes: available, plannedTakes: cues.length, generationRequests: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = {}, args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) { const key = { '--bank': 'bankId', '--batch': 'batchId', '--output-name': 'outputName' }[args[i]]; if (!key || !args[i + 1]) throw new Error('Invalid audition arguments'); options[key] = args[i + 1]; }
    console.log(JSON.stringify(buildListeningSet(options), null, 2));
  } catch { console.error(JSON.stringify({ result: 'local-audition-error', generationRequests: 0 })); process.exitCode = 1; }
}

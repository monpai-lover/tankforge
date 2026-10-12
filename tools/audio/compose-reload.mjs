import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { planReloadRecipe, assertArtifactPath } from './reload-recipe.mjs';
import { readWav, writeWav, analyzeWav } from './audio-qa.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function resample(wav, rate) {
  const frames = Math.round(wav.frames * rate / wav.sampleRate);
  if (frames < 1) throw new Error('Source too short for output sample rate');
  const samples = new Float64Array(frames * wav.channels);
  for (let f = 0; f < frames; f++) {
    const p = Math.min(wav.frames - 1, f * wav.sampleRate / rate), a = Math.floor(p), b = Math.min(a + 1, wav.frames - 1), k = p - a;
    for (let c = 0; c < wav.channels; c++) samples[f * wav.channels + c] = wav.samples[a * wav.channels + c] * (1 - k) + wav.samples[b * wav.channels + c] * k;
  }
  return { samples, frames };
}
function place(output, source, offset, frames, channels, overlap = 0) {
  for (let f = 0; f < frames; f++) {
    const weight = f < overlap ? .5 - .5 * Math.cos(Math.PI * (f + 1) / (overlap + 1)) : 1;
    for (let c = 0; c < channels; c++) {
      const i = (offset + f) * channels + c, x = source[f * channels + c];
      output[i] = f < overlap ? output[i] * (1 - weight) + x * weight : x;
    }
  }
}
function exists(p) { try { fs.lstatSync(p); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function writeTemporary(p, data) { const fd = fs.openSync(p, 'wx'); try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }

/** Pure local WAV composition. Publication uses exclusive hard links; existing files are never replaced. */
export function composeReload({ repositoryRoot = defaultRoot, output, targetSeconds, sampleRate = 44100,
  crossfadeSeconds = .02, opening, work, closing } = {}) {
  if (!Number.isFinite(crossfadeSeconds) || crossfadeSeconds < 0 || crossfadeSeconds > 1) throw new Error('Invalid crossfade duration');
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 1 || sampleRate > 384000) throw new Error('Invalid sample rate');
  const outputPath = assertArtifactPath(repositoryRoot, output);
  if (path.extname(outputPath).toLowerCase() !== '.wav') throw new Error('Output must be WAV');
  const receiptPath = assertArtifactPath(repositoryRoot, `${outputPath}.receipt.json`);
  if (exists(outputPath) || exists(receiptPath)) throw new Error('Destination/receipt exists; overwrite rejected');
  const sources = {}, decoded = {};
  for (const [name, spec] of Object.entries({ opening, work, closing })) {
    if (!spec?.path) throw new Error(`Missing ${name} source`);
    const sourcePath = assertArtifactPath(repositoryRoot, spec.path, { mustExist: true });
    if (path.extname(sourcePath).toLowerCase() !== '.wav') throw new Error('WAV-only source; decode MP3 separately before composition');
    const bytes = fs.readFileSync(sourcePath), wav = readWav(bytes), converted = resample(wav, sampleRate);
    decoded[name] = { ...converted, channels: wav.channels };
    sources[name] = { path: sourcePath, sha256: sha(bytes), sourceBytes: bytes.length, actualFrames: wav.frames,
      actualSampleRate: wav.sampleRate, actualChannels: wav.channels, actualBitsPerSample: wav.bitsPerSample,
      actualEncoding: wav.format === 1 ? 'PCM' : 'IEEE_FLOAT', actualDurationSeconds: wav.frames / wav.sampleRate,
      resampledFrames: converted.frames, resampler: wav.sampleRate === sampleRate ? 'identity' : 'linear interpolation',
      ...(name === 'work' && { loopable: spec.loopable === true }) };
  }
  const channels = decoded.work.channels;
  if (Object.values(decoded).some(w => w.channels !== channels)) throw new Error('All source channels must match');
  const offsets = planReloadRecipe({ targetSeconds, sampleRate, openingFrames: decoded.opening.frames, workFrames: decoded.work.frames,
    closingFrames: decoded.closing.frames, crossfadeFrames: Math.round(crossfadeSeconds * sampleRate), workLoopable: work.loopable === true });
  const outputSamples = new Float64Array(offsets.targetFrames * channels);
  const workSamples = new Float64Array(offsets.workOutputFrames * channels);
  for (const segment of offsets.workSegments) place(workSamples, decoded.work.samples, segment.outputOffsetFrames, segment.frames, channels, segment.crossfadeFrames);
  place(outputSamples, decoded.opening.samples, 0, decoded.opening.frames, channels);
  place(outputSamples, workSamples, offsets.workOffsetFrames, offsets.workOutputFrames, channels, offsets.openingCrossfadeFrames);
  place(outputSamples, decoded.closing.samples, offsets.closingOffsetFrames, decoded.closing.frames, channels, offsets.closingCrossfadeFrames);
  const seamFrames = [offsets.workOffsetFrames, offsets.workOffsetFrames + offsets.openingCrossfadeFrames,
    offsets.closingOffsetFrames, offsets.closingOffsetFrames + offsets.closingCrossfadeFrames,
    ...offsets.workSegments.slice(1).flatMap(s => [offsets.workOffsetFrames + s.outputOffsetFrames, offsets.workOffsetFrames + s.outputOffsetFrames + s.crossfadeFrames])]
    .filter(f => f > 0 && f < offsets.targetFrames);
  const bytes = writeWav({ samples: outputSamples, sampleRate, channels });
  const receipt = { schemaVersion: 1, kind: 'reload-wav-composition', createdAt: new Date().toISOString(), outputPath,
    targetSeconds, roundingRule: 'round(targetSeconds * sampleRate)', sampleRate, channels, finalFrames: offsets.targetFrames,
    actualDurationSeconds: offsets.targetFrames / sampleRate, outputSha256: sha(bytes), outputBytes: bytes.length,
    sources, offsets, crossfadeCurve: 'complementary raised cosine', qa: analyzeWav(bytes, { seamFrames }),
    readinessNotice: 'WAV length does not prove a live weapon is ready. A future runtime owner must trigger the closing/ready tail from the true per-weapon completion event.' };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  assertArtifactPath(repositoryRoot, outputPath); assertArtifactPath(repositoryRoot, receiptPath);
  const token = randomUUID(), wavTemp = `${outputPath}.${token}.tmp`, receiptTemp = `${receiptPath}.${token}.tmp`;
  let publishedWav = false, publishedReceipt = false;
  try {
    writeTemporary(wavTemp, bytes); writeTemporary(receiptTemp, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`));
    assertArtifactPath(repositoryRoot, outputPath); assertArtifactPath(repositoryRoot, receiptPath);
    fs.linkSync(wavTemp, outputPath); publishedWav = true;
    fs.linkSync(receiptTemp, receiptPath); publishedReceipt = true;
  } catch (error) {
    if (publishedWav && !publishedReceipt && exists(outputPath) && sha(fs.readFileSync(outputPath)) === receipt.outputSha256) {
      assertArtifactPath(repositoryRoot, outputPath); fs.unlinkSync(outputPath);
    }
    throw error;
  } finally {
    for (const temporary of [wavTemp, receiptTemp]) if (exists(temporary)) { assertArtifactPath(repositoryRoot, temporary); fs.unlinkSync(temporary); }
  }
  return { outputPath, receiptPath, receipt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i += 2) { if (!['--recipe', '--output'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node compose-reload.mjs --recipe artifacts/audio/elevenlabs/recipe.json [--output artifacts/audio/elevenlabs/result.wav]'); options[args[i]] = args[i + 1]; }
    const recipePath = assertArtifactPath(defaultRoot, options['--recipe'], { mustExist: true });
    const config = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
    const result = composeReload({ ...config, repositoryRoot: defaultRoot, ...(options['--output'] && { output: options['--output'] }) });
    console.log(JSON.stringify({ outputPath: result.outputPath, receiptPath: result.receiptPath, finalFrames: result.receipt.finalFrames, durationSeconds: result.receipt.actualDurationSeconds }, null, 2));
  } catch { console.error(JSON.stringify({ result: 'local-composition-error', generationRequests: 0 })); process.exitCode = 1; }
}

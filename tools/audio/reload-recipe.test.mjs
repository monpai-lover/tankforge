import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const recipe = await import('./reload-recipe.mjs').catch(() => ({}));
const composer = await import('./compose-reload.mjs').catch(() => ({}));
const qa = await import('./audio-qa.mjs').catch(() => ({}));
const sha = b => createHash('sha256').update(b).digest('hex');
function wav(frames, sampleRate = 44100, channels = 1, sample = () => 0.2) {
  const b = Buffer.alloc(44 + frames * channels * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * channels * 2, 28);
  b.writeUInt16LE(channels * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(frames * channels * 2, 40);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++)
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(32767 / 32768, sample(i, c))) * 32768), 44 + (i * channels + c) * 2);
  return b;
}
function fixture(t, { sampleRate = 44100, channels = 1, workSeconds = 0.3 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tankforge-reload-test-'));
  const original = fs.realpathSync(root);
  t.after(() => {
    assert.equal(fs.realpathSync(root), original);
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('tankforge-reload-test-'));
    fs.rmSync(root, { recursive: true });
  });
  const dir = path.join(root, 'artifacts', 'audio', 'elevenlabs'); fs.mkdirSync(dir, { recursive: true });
  const sources = {};
  for (const [name, seconds] of [['opening', .1], ['work', workSeconds], ['closing', .1]]) {
    const p = path.join(dir, `${name}.wav`); fs.writeFileSync(p, wav(Math.round(seconds * sampleRate), sampleRate, channels));
    sources[name] = { path: p, ...(name === 'work' && { loopable: true }) };
  }
  return { repositoryRoot: root, output: path.join(dir, 'composed.wav'), targetSeconds: 7.5, ...sources, dir };
}
function feature(mod, name) { assert.equal(typeof mod[name], 'function', `${name} must be implemented`); }

test('recipe accounts for overlaps and exact round(T*Fs) frames', () => {
  feature(recipe, 'planReloadRecipe');
  const p = recipe.planReloadRecipe({ targetSeconds: 7.5, sampleRate: 44100,
    openingFrames: 22050, workFrames: 286650, closingFrames: 22050, crossfadeFrames: 882, workLoopable: true });
  assert.equal(p.targetFrames, 330750); assert.equal(p.workOutputFrames, 288414);
  assert.equal(p.closingOffsetFrames, 308700); assert.ok(p.workSegments.length > 1);
  assert.equal(p.workSegments.at(-1).outputOffsetFrames + p.workSegments.at(-1).frames, p.workOutputFrames);
});
test('recipe rejects nonfinite durations, missing work and insufficient unloopable work', () => {
  feature(recipe, 'planReloadRecipe');
  const base = { targetSeconds: 4, sampleRate: 44100, openingFrames: 100, workFrames: 1000, closingFrames: 100 };
  for (const targetSeconds of [NaN, Infinity, 0, -1]) assert.throws(() => recipe.planReloadRecipe({ ...base, targetSeconds }));
  assert.throws(() => recipe.planReloadRecipe({ ...base, workFrames: 0 }), /work/i);
  assert.throws(() => recipe.planReloadRecipe({ ...base, workLoopable: false }), /loop/i);
});
test('composition writes exact historical frames and immutable source-hashed receipt', t => {
  feature(composer, 'composeReload'); feature(qa, 'readWav');
  const opts = fixture(t); const result = composer.composeReload(opts);
  const out = qa.readWav(fs.readFileSync(result.outputPath)); assert.equal(out.frames, 330750); assert.equal(out.sampleRate, 44100);
  const receipt = JSON.parse(fs.readFileSync(result.receiptPath, 'utf8'));
  assert.equal(receipt.finalFrames, 330750); assert.equal(receipt.outputSha256, sha(fs.readFileSync(result.outputPath)));
  assert.equal(receipt.sources.work.sha256, sha(fs.readFileSync(opts.work.path)));
  assert.equal(receipt.sources.work.actualFrames, 13230); assert.ok(receipt.offsets.workSegments.length > 1);
  assert.match(receipt.readinessNotice, /not.*ready|does not.*ready/i);
  const old = sha(fs.readFileSync(result.outputPath)); assert.throws(() => composer.composeReload(opts), /exist|overwrite/i);
  assert.equal(sha(fs.readFileSync(result.outputPath)), old);
});
test('composition matches casual6.25 and arbitrary4 second targets', t => {
  feature(composer, 'composeReload'); feature(qa, 'readWav'); const opts = fixture(t);
  for (const targetSeconds of [6.25, 4]) {
    const r = composer.composeReload({ ...opts, targetSeconds, output: path.join(opts.dir, `${targetSeconds}.wav`) });
    assert.equal(qa.readWav(fs.readFileSync(r.outputPath)).frames, Math.round(targetSeconds * 44100));
  }
});
test('composition resamples sources and retains actual source metadata', t => {
  feature(composer, 'composeReload'); feature(qa, 'readWav'); const opts = fixture(t, { sampleRate: 8000, channels: 2 });
  const r = composer.composeReload({ ...opts, targetSeconds: .75 });
  const parsed = qa.readWav(fs.readFileSync(r.outputPath)); assert.equal(parsed.frames, 33075); assert.equal(parsed.channels, 2);
  assert.equal(r.receipt.sources.work.actualSampleRate, 8000); assert.equal(r.receipt.sources.work.resampledFrames, 13230);
});
test('composition supports targets above the30 second source cap without drift', t => {
  feature(composer, 'composeReload'); feature(qa, 'readWav'); const opts = fixture(t);
  const r = composer.composeReload({ ...opts, targetSeconds: 52.8 });
  assert.equal(qa.readWav(fs.readFileSync(r.outputPath)).frames, 2328480);
});
test('unsafe destination and source escapes are rejected without writes', t => {
  feature(composer, 'composeReload'); const opts = fixture(t); const outside = path.join(opts.repositoryRoot, 'outside.wav');
  assert.throws(() => composer.composeReload({ ...opts, output: outside }), /inside|artifact|unsafe/i); assert.equal(fs.existsSync(outside), false);
  fs.writeFileSync(outside, wav(1000));
  assert.throws(() => composer.composeReload({ ...opts, work: { path: outside, loopable: true } }), /inside|artifact|unsafe/i);
  assert.equal(fs.existsSync(opts.output), false);
});
test('reparse or symbolic directory sources and outputs are rejected', t => {
  feature(composer, 'composeReload'); const opts = fixture(t); const link = path.join(opts.dir, 'link');
  fs.symlinkSync(opts.dir, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => composer.composeReload({ ...opts, work: { path: path.join(link, 'work.wav'), loopable: true } }), /link|reparse/i);
  assert.throws(() => composer.composeReload({ ...opts, output: path.join(link, 'bad.wav') }), /link|reparse/i);
});
test('existing receipt prevents partial publication or replacement', t => {
  feature(composer, 'composeReload'); const opts = fixture(t); fs.writeFileSync(`${opts.output}.receipt.json`, 'keep');
  assert.throws(() => composer.composeReload(opts), /exist|overwrite/i);
  assert.equal(fs.existsSync(opts.output), false); assert.equal(fs.readFileSync(`${opts.output}.receipt.json`, 'utf8'), 'keep');
});
test('unloopable long target and mismatched channels fail before output creation', t => {
  feature(composer, 'composeReload'); const opts = fixture(t);
  assert.throws(() => composer.composeReload({ ...opts, work: { ...opts.work, loopable: false } }), /loop/i);
  fs.writeFileSync(opts.closing.path, wav(4410, 44100, 2));
  assert.throws(() => composer.composeReload(opts), /channel/i); assert.equal(fs.existsSync(opts.output), false);
});
test('WAV reader rejects malformed, partial-frame and nonWAV input', () => {
  feature(qa, 'readWav'); assert.throws(() => qa.readWav(Buffer.from('MP3')), /WAV|RIFF/i);
  const invalid = wav(4); invalid.writeUInt16LE(2, 32); invalid.writeUInt32LE(7, 40);
  assert.throws(() => qa.readWav(invalid), /frame|chunk|size/i);
});
test('QA reports clipping runs, onset and boundary discontinuity', () => {
  feature(qa, 'analyzeWav'); const b = wav(1000, 1000, 1, i => i >= 500 && i < 505 ? 32767 / 32768 : 0);
  const report = qa.analyzeWav(b, { seamFrames: [500], onsetWindowSeconds: .01 });
  assert.equal(report.frames, 1000); assert.equal(report.durationSeconds, 1); assert.equal(report.clippedFrames, 5);
  assert.equal(report.maxClippedRunFrames, 5); assert.ok(report.rms > 0); assert.ok(report.onsetFrames.length > 0);
  assert.ok(report.seams[0].jumpPeak > .99);
});
test('QA detects opposite stereo phase and continuous constant-source seams', t => {
  feature(qa, 'analyzeWav'); feature(composer, 'composeReload');
  const anti = qa.analyzeWav(wav(1000, 1000, 2, (i, c) => (c ? -1 : 1) * Math.sin(i * .1) * .2));
  assert.ok(anti.stereoCorrelation < -.999);
  const opts = fixture(t); const r = composer.composeReload({ ...opts, targetSeconds: 1 });
  assert.ok(r.receipt.qa.seams.every(s => s.jumpPeak < 1 / 32768)); assert.equal(r.receipt.qa.clippedFrames, 0);
});

test('four second demo preserves unloopable ram work with zero overlap', t => {
  feature(composer, 'composeReload'); const opts = fixture(t);
  fs.writeFileSync(opts.opening.path, wav(44100)); fs.writeFileSync(opts.work.path, wav(88200)); fs.writeFileSync(opts.closing.path, wav(44100));
  assert.throws(() => composer.composeReload({ ...opts, targetSeconds: 4, work: { ...opts.work, loopable: false } }), /loop/i);
  const r = composer.composeReload({ ...opts, targetSeconds: 4, crossfadeSeconds: 0, work: { ...opts.work, loopable: false } });
  assert.equal(r.receipt.finalFrames, 176400); assert.equal(r.receipt.offsets.workOutputFrames, 88200);
  assert.equal(r.receipt.offsets.workSegments.length, 1); assert.equal(r.receipt.offsets.closingOffsetFrames, 132300);
});

function encodedWav(bits, format, values) {
  const bytes = bits / 8, dataSize = values.length * bytes, b = Buffer.alloc(44 + dataSize + dataSize % 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(format, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(44100, 24); b.writeUInt32LE(44100 * bytes, 28);
  b.writeUInt16LE(bytes, 32); b.writeUInt16LE(bits, 34); b.write('data', 36); b.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < values.length; i++) {
    const p = 44 + i * bytes;
    if (format === 3) b.writeFloatLE(values[i], p);
    else if (bits === 8) b[p] = Math.round(values[i] * 128 + 128);
    else b.writeIntLE(Math.round(values[i] * 2 ** (bits - 1)), p, bytes);
  }
  return b;
}
test('WAV decoder supports8/24/32 bitPCM and float32 without MP3 assumptions', () => {
  feature(qa, 'readWav');
  for (const [bits, format] of [[8, 1], [24, 1], [32, 1], [32, 3]]) {
    const parsed = qa.readWav(encodedWav(bits, format, [-.5, 0, .5]));
    assert.equal(parsed.frames, 3); assert.deepEqual([...parsed.samples], [-.5, 0, .5]);
  }
  assert.throws(() => qa.readWav(encodedWav(32, 3, [NaN])), /nonfinite/i);
});
test('WAV decoder rejects incomplete trailing chunk headers', () => {
  feature(qa, 'readWav'); const source = wav(4), stray = Buffer.concat([source, Buffer.from([1, 2, 3])]);
  stray.writeUInt32LE(stray.length - 8, 4); assert.throws(() => qa.readWav(stray), /chunk|size/i);
});
test('PCM writer preserves complete stereo frames and rejects nonfinite output', () => {
  feature(qa, 'writeWav'); feature(qa, 'readWav');
  const parsed = qa.readWav(qa.writeWav({ samples: new Float64Array([-.5, .5, 0, .25]), sampleRate: 8000, channels: 2 }));
  assert.equal(parsed.frames, 2); assert.deepEqual([...parsed.samples], [-.5, .5, 0, .25]);
  assert.throws(() => qa.writeWav({ samples: [0, Infinity], sampleRate: 8000, channels: 1 }), /nonfinite/i);
});

test('CLI failures return coarse zero-generation results without echoing malformed recipe content', t => {
  const opts = fixture(t), copiedTools = path.join(opts.repositoryRoot, 'tools', 'audio');
  fs.mkdirSync(copiedTools, { recursive: true });
  for (const filename of ['reload-recipe.mjs', 'audio-qa.mjs', 'compose-reload.mjs'])
    fs.copyFileSync(fileURLToPath(new URL(filename, import.meta.url)), path.join(copiedTools, filename));
  const syntheticSecret = 'K9SECRET42', recipePath = path.join(opts.dir, 'malformed-recipe.json');
  fs.writeFileSync(recipePath, syntheticSecret);
  const before = sha(fs.readFileSync(recipePath));
  const composition = spawnSync(process.execPath, [path.join(copiedTools, 'compose-reload.mjs'), '--recipe', recipePath], { encoding: 'utf8' });
  assert.notEqual(composition.status, 0);
  assert.equal((composition.stdout + composition.stderr).includes(syntheticSecret), false);
  assert.deepEqual(JSON.parse(composition.stderr), { result: 'local-composition-error', generationRequests: 0 });
  assert.equal(sha(fs.readFileSync(recipePath)), before); assert.equal(fs.existsSync(opts.output), false);
  const invalidWavPath = path.join(opts.dir, 'malformed.wav'); fs.writeFileSync(invalidWavPath, syntheticSecret);
  const waveQa = spawnSync(process.execPath, [path.join(copiedTools, 'audio-qa.mjs'), invalidWavPath], { encoding: 'utf8' });
  assert.notEqual(waveQa.status, 0);
  assert.equal((waveQa.stdout + waveQa.stderr).includes(syntheticSecret), false);
  assert.deepEqual(JSON.parse(waveQa.stderr), { result: 'local-wave-qa-error', generationRequests: 0 });
  assert.equal(fs.readFileSync(invalidWavPath, 'utf8'), syntheticSecret);
});

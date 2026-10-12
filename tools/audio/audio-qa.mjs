import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertArtifactPath } from './reload-recipe.mjs';

/** WAV-only decoder: RIFF PCM8/16/24/32 and IEEE float32; no MP3 decoder. */
export function readWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected RIFF WAV');
  if (buffer.readUInt32LE(4) + 8 !== buffer.length) throw new Error('Invalid WAV RIFF size');
  let format, data, p = 12;
  for (; p + 8 <= buffer.length;) {
    const name = buffer.toString('ascii', p, p + 4), size = buffer.readUInt32LE(p + 4), start = p + 8;
    if (start + size > buffer.length) throw new Error('Invalid WAV chunk size');
    if (name === 'fmt ') {
      if (format || size < 16) throw new Error('Invalid WAV fmt chunk');
      format = { format: buffer.readUInt16LE(start), channels: buffer.readUInt16LE(start + 2), sampleRate: buffer.readUInt32LE(start + 4),
        byteRate: buffer.readUInt32LE(start + 8), blockAlign: buffer.readUInt16LE(start + 12), bitsPerSample: buffer.readUInt16LE(start + 14) };
    }
    if (name === 'data') { if (data) throw new Error('Multiple WAV data chunks unsupported'); data = buffer.subarray(start, start + size); }
    p = start + size + (size % 2);
  }
  if (p !== buffer.length) throw new Error('Incomplete WAV chunk/padding size');
  if (!format || !data) throw new Error('Missing WAV fmt/data chunk');
  const { channels, sampleRate, bitsPerSample, blockAlign } = format;
  if (![1, 2].includes(channels) || sampleRate < 1 || sampleRate > 384000 || !((format.format === 1 && [8, 16, 24, 32].includes(bitsPerSample)) || (format.format === 3 && bitsPerSample === 32))) throw new Error('Unsupported WAV encoding/channels/sample rate');
  const bytes = bitsPerSample / 8;
  if (blockAlign !== channels * bytes || format.byteRate !== sampleRate * blockAlign || !data.length || data.length % blockAlign) throw new Error('Invalid WAV frame alignment');
  const frames = data.length / blockAlign, samples = new Float64Array(frames * channels);
  for (let i = 0; i < samples.length; i++) {
    const p = i * bytes;
    const value = format.format === 3 ? data.readFloatLE(p) : bitsPerSample === 8 ? (data[p] - 128) / 128
      : bitsPerSample === 16 ? data.readInt16LE(p) / 32768 : bitsPerSample === 24 ? data.readIntLE(p, 3) / 8388608 : data.readInt32LE(p) / 2147483648;
    if (!Number.isFinite(value)) throw new Error('Nonfinite WAV sample');
    samples[i] = value;
  }
  return { ...format, frames, durationSeconds: frames / sampleRate, samples };
}

/** PCM16 output is deterministic; all durations are represented by complete frames. */
export function writeWav({ samples, sampleRate, channels }) {
  if (![1, 2].includes(channels) || !Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 384000 || !samples?.length || samples.length % channels || samples.length * 2 > 0xffffffff - 36) throw new Error('Invalid PCM output');
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8); out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); out.writeUInt16LE(channels, 22); out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * channels * 2, 28); out.writeUInt16LE(channels * 2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) throw new Error('Nonfinite PCM output sample');
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(32767 / 32768, samples[i])) * 32768), 44 + i * 2);
  }
  return out;
}

function correlation(a, b, aStart, bStart, count, strideA = 1, strideB = 1) {
  let aa = 0, bb = 0, ab = 0;
  for (let i = 0; i < count; i++) { const x = a[aStart + i * strideA], y = b[bStart + i * strideB]; aa += x * x; bb += y * y; ab += x * y; }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : null;
}

export function analyzeWav(input, { seamFrames = [], onsetWindowSeconds = .01, seamWindowSeconds = .005 } = {}) {
  const wav = readWav(input), { samples, channels, frames, sampleRate } = wav;
  if (!Number.isFinite(onsetWindowSeconds) || onsetWindowSeconds <= 0 || !Number.isFinite(seamWindowSeconds) || seamWindowSeconds <= 0 || !Array.isArray(seamFrames)) throw new Error('Invalid QA windows/seams');
  const perChannel = Array.from({ length: channels }, () => ({ peak: 0, rms: 0, dc: 0, clippedSamples: 0, clippedRuns: 0, maxClippedRunFrames: 0 }));
  const runs = new Array(channels).fill(0); let clippedFrames = 0, peak = 0, sumSquares = 0;
  for (let f = 0; f < frames; f++) {
    let clipped = false;
    for (let c = 0; c < channels; c++) {
      const x = samples[f * channels + c], ch = perChannel[c], ax = Math.abs(x);
      peak = Math.max(peak, ax); ch.peak = Math.max(ch.peak, ax); ch.rms += x * x; ch.dc += x; sumSquares += x * x;
      if (ax >= .999) { clipped = true; ch.clippedSamples++; if (!runs[c]) ch.clippedRuns++; runs[c]++; ch.maxClippedRunFrames = Math.max(ch.maxClippedRunFrames, runs[c]); } else runs[c] = 0;
    }
    if (clipped) clippedFrames++;
  }
  for (const ch of perChannel) { ch.rms = Math.sqrt(ch.rms / frames); ch.dc /= frames; }
  const onsetFrames = [], window = Math.max(1, Math.round(onsetWindowSeconds * sampleRate)); let previous = 0;
  for (let f = 0; f < frames; f += window) {
    const end = Math.min(frames, f + window); let energy = 0;
    for (let i = f * channels; i < end * channels; i++) energy += samples[i] * samples[i];
    const rms = Math.sqrt(energy / ((end - f) * channels));
    if (rms >= .01 && rms >= previous * 2 && rms - previous >= .03) onsetFrames.push(f);
    previous = rms;
  }
  const seams = [...new Set(seamFrames)].sort((a, b) => a - b).map(frame => {
    if (!Number.isInteger(frame) || frame < 1 || frame >= frames) throw new Error('Invalid QA seam frame');
    let jumpPeak = 0, beforeEnergy = 0, afterEnergy = 0;
    const count = Math.min(Math.max(1, Math.round(seamWindowSeconds * sampleRate)), frame, frames - frame);
    for (let c = 0; c < channels; c++) jumpPeak = Math.max(jumpPeak, Math.abs(samples[frame * channels + c] - samples[(frame - 1) * channels + c]));
    for (let f = 0; f < count; f++) for (let c = 0; c < channels; c++) {
      beforeEnergy += samples[(frame - count + f) * channels + c] ** 2; afterEnergy += samples[(frame + f) * channels + c] ** 2;
    }
    return { frame, timeSeconds: frame / sampleRate, jumpPeak, beforeRms: Math.sqrt(beforeEnergy / (count * channels)), afterRms: Math.sqrt(afterEnergy / (count * channels)),
      adjacentWindowCorrelation: correlation(samples, samples, (frame - count) * channels, frame * channels, count * channels) };
  });
  return { encoding: wav.format === 1 ? 'PCM' : 'IEEE_FLOAT', bitsPerSample: wav.bitsPerSample, sampleRate, channels, frames,
    durationSeconds: frames / sampleRate, peak, peakDbFS: peak ? 20 * Math.log10(peak) : null, rms: Math.sqrt(sumSquares / samples.length), clippedFrames,
    clippedRuns: perChannel.reduce((n, c) => n + c.clippedRuns, 0), maxClippedRunFrames: Math.max(...perChannel.map(c => c.maxClippedRunFrames)),
    perChannel, onsetFrames, onsetMethod: 'RMS window increase; approximate, not semantic event detection', seams,
    stereoCorrelation: channels === 2 ? correlation(samples, samples, 0, 1, frames, 2, 2) : null,
    continuityNotice: 'Sample jumps and correlations are diagnostic measurements, not a perceptual loop or phase-compatibility approval.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const source = assertArtifactPath(repositoryRoot, process.argv[2], { mustExist: true });
    console.log(JSON.stringify(analyzeWav(fs.readFileSync(source)), null, 2));
  } catch { console.error(JSON.stringify({ result: 'local-wave-qa-error', generationRequests: 0 })); process.exitCode = 1; }
}

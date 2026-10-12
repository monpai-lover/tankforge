// Presentation-only PCM mixing. The caller owns caching, accounting and playback.
export function createRunningGearComposite(ctx, gearBuffer, surfaceBuffer, options = {}) {
  try {
    const {gearLevel, surfaceLevel, maxBytes} = options;
    if (typeof ctx?.createBuffer !== 'function' || !gearBuffer || !surfaceBuffer ||
        !Number.isFinite(gearLevel) || gearLevel < 0 || gearLevel > 1 ||
        !Number.isFinite(surfaceLevel) || surfaceLevel < 0 || surfaceLevel > 1 ||
        !Number.isFinite(maxBytes) || maxBytes <= 0) return null;
    const length = gearBuffer.length, sampleRate = gearBuffer.sampleRate, bytes = length * 4;
    if (!Number.isSafeInteger(length) || length <= 0 || !Number.isSafeInteger(bytes) || bytes > maxBytes ||
        gearBuffer.numberOfChannels !== 1 || surfaceBuffer.numberOfChannels !== 1 ||
        surfaceBuffer.length !== length || !Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 384000 ||
        surfaceBuffer.sampleRate !== sampleRate) return null;
    const gear = gearBuffer.getChannelData(0), surface = surfaceBuffer.getChannelData(0);
    if (!(gear instanceof Float32Array) || !(surface instanceof Float32Array) || gear.length !== length || surface.length !== length) return null;
    // Validate before output allocation, including overflow on Float32 storage.
    for (let i = 0; i < length; i++) {
      if (!Number.isFinite(gear[i]) || !Number.isFinite(surface[i]) ||
          !Number.isFinite(Math.fround(gear[i] * gearLevel + surface[i] * surfaceLevel * 0.5))) return null;
    }
    const buffer = ctx.createBuffer(1, length, sampleRate);
    if (!buffer || buffer.length !== length || buffer.numberOfChannels !== 1 || buffer.sampleRate !== sampleRate) return null;
    const output = buffer.getChannelData(0);
    if (!(output instanceof Float32Array) || output.length !== length) return null;
    for (let i = 0; i < length; i++) output[i] = gear[i] * gearLevel + surface[i] * surfaceLevel * 0.5;
    return {buffer, bytes};
  } catch {
    return null;
  }
}

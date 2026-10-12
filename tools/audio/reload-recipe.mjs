import fs from 'node:fs';
import path from 'node:path';

const integer = (n, name, minimum = 0) => {
  if (!Number.isSafeInteger(n) || n < minimum) throw new Error(`Invalid ${name}`);
  return n;
};

/** Plan PCM frame positions, including every overlap; never represents live readiness. */
export function planReloadRecipe({ targetSeconds, sampleRate = 44100, openingFrames = 0,
  workFrames, closingFrames = 0, crossfadeFrames = Math.round(sampleRate * .02), workLoopable = false }) {
  integer(sampleRate, 'sample rate', 1);
  if (sampleRate > 384000 || !Number.isFinite(targetSeconds) || targetSeconds <= 0) throw new Error('Invalid target duration/sample rate');
  const targetFrames = integer(Math.round(targetSeconds * sampleRate), 'target frames', 1);
  if (targetFrames > 100000000) throw new Error('Target exceeds 100 million frame memory limit');
  integer(openingFrames, 'opening frames'); integer(workFrames, 'work frames', 1);
  integer(closingFrames, 'closing frames'); integer(crossfadeFrames, 'crossfade frames');
  if (typeof workLoopable !== 'boolean') throw new Error('workLoopable must be boolean');
  const loopCrossfadeFrames = Math.min(crossfadeFrames, Math.floor(workFrames / 2));
  const openingCrossfadeFrames = Math.min(loopCrossfadeFrames, openingFrames);
  const closingCrossfadeFrames = Math.min(loopCrossfadeFrames, closingFrames);
  const workOutputFrames = targetFrames - openingFrames - closingFrames + openingCrossfadeFrames + closingCrossfadeFrames;
  if (workOutputFrames < Math.max(1, openingCrossfadeFrames + closingCrossfadeFrames)) throw new Error('Target too short for opening/work/closing stages');
  if (workOutputFrames > workFrames && !workLoopable) throw new Error('Long target requires explicitly loopable work');
  const workSegments = [{ sourceInFrame: 0, frames: Math.min(workFrames, workOutputFrames), outputOffsetFrames: 0, crossfadeFrames: 0 }];
  let end = workSegments[0].frames;
  while (end < workOutputFrames) {
    const outputOffsetFrames = end - loopCrossfadeFrames;
    const frames = Math.min(workFrames, workOutputFrames - outputOffsetFrames);
    workSegments.push({ sourceInFrame: 0, frames, outputOffsetFrames, crossfadeFrames: loopCrossfadeFrames });
    end = outputOffsetFrames + frames;
  }
  return { sampleRate, targetSeconds, targetFrames, finalFrames: targetFrames, openingFrames, workFrames, closingFrames,
    openingCrossfadeFrames, closingCrossfadeFrames, loopCrossfadeFrames, workOutputFrames, workSegments,
    openingOffsetFrames: 0, workOffsetFrames: openingFrames - openingCrossfadeFrames, closingOffsetFrames: targetFrames - closingFrames };
}

/** Both source and output files must remain in the local artifact tree, without links. */
export function assertArtifactPath(repositoryRoot, input, { mustExist = false } = {}) {
  if (typeof repositoryRoot !== 'string' || !path.isAbsolute(repositoryRoot) || typeof input !== 'string' || !input || input.includes('\0')) throw new Error('Unsafe artifact path');
  const root = path.resolve(repositoryRoot);
  const allowed = path.join(root, 'artifacts', 'audio', 'elevenlabs');
  const resolved = path.resolve(root, input);
  const relative = path.relative(allowed, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Path must be inside artifacts/audio/elevenlabs');
  const volume = path.parse(resolved).root;
  const components = resolved.slice(volume.length).split(path.sep);
  for (const part of components) if (!part || /[:\0]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) throw new Error('Unsafe artifact path component');
  let current = volume;
  for (const part of components) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (stat.isSymbolicLink()) throw new Error(`Symbolic/reparse link rejected: ${current}`);
    const canonical = fs.realpathSync.native(current);
    const equal = process.platform === 'win32' ? canonical.toLowerCase() === current.toLowerCase() : canonical === current;
    if (!equal) throw new Error(`Reparse path rejected: ${current}`);
  }
  if (mustExist && !fs.statSync(resolved).isFile()) throw new Error('Artifact source must be a regular file');
  return resolved;
}

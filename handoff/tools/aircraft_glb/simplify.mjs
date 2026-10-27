// Mesh simplification for the aircraft tools (meshoptimizer's simplifier, its vertex subset kept so the
// texture coordinates and normals stay valid).
//   node simplify.mjs JOB_DIR      JOB_DIR/*.json: {positions: "<file of float32 xyz>", indices: "<uint32>",
//                                  target: triangle count, error: relative error, out: "<uint32 file>"}
// Needs the meshoptimizer package (npm install meshoptimizer@0.22.0) reachable from NODE_PATH.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const mo = await import(require.resolve('meshoptimizer', { paths: (process.env.NODE_PATH || '').split(':').filter(Boolean) }));
const S = mo.MeshoptSimplifier;
await S.ready;
const dir = process.argv[2];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const job = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  // (a file's Buffer may sit inside a larger pooled ArrayBuffer: copy just its bytes)
  const bytes = (f) => { const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const P = new Float32Array(bytes(job.positions));
  const I = new Uint32Array(bytes(job.indices));
  const [out, err] = S.simplify(I, P, 3, Math.max(3, Math.floor(job.target) * 3), job.error ?? 0.01, job.flags ?? ['LockBorder']);
  fs.writeFileSync(job.out, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
  console.log(f, I.length / 3, '->', out.length / 3, 'err', err.toFixed(5));
}

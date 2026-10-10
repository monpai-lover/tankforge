// Re-measure the shared MG damage metadata from the actual renderer and its assets.
// Default CLI checks only; --write updates damage_geometry while preserving tuning text.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pintleGun, setMgModels } from '../src/gfx/mgmodel.js';

export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const mat = { color: [0, 0, 0], rough: 1, metal: 0 };
const mats = { black: mat, steel: mat, paint_dark: mat };

function clip(poly, axis, boundary, greater) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ai = greater ? a[axis] >= boundary : a[axis] <= boundary;
    const bi = greater ? b[axis] >= boundary : b[axis] <= boundary;
    if (ai) out.push(a);
    if (ai !== bi) {
      const t = (boundary - a[axis]) / (b[axis] - a[axis]);
      out.push(a.map((v, k) => v + (b[k] - v) * t));
    }
  }
  return out;
}

export function boxOfTriangles(tris, planes) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const tri of tris) {
    let poly = tri;
    for (const [axis, boundary, greater] of planes) {
      poly = clip(poly, axis, boundary, greater);
      if (!poly.length) break;
    }
    for (const p of poly) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]);
    }
  }
  if (!lo.every(Number.isFinite)) throw new Error('MG measurement has an empty ROI');
  return {
    center: lo.map((v, k) => Number(((v + hi[k]) / 2).toFixed(6))),
    half_extents: lo.map((v, k) => Number(((hi[k] - v) / 2).toFixed(6))),
  };
}

function geometry(mg, variant = null) {
  const { geo, muzzleVector } = pintleGun(mg.id, mg.caliber_mm, mats, variant);
  const tris = [];
  for (let i = 0; i < geo.data.length; i += 39) tris.push([0, 13, 26].map(k => geo.data.slice(i + k, i + k + 3)));
  // Clip crossing triangles. The bore-centred barrel ROI excludes remote sights and
  // ammunition boxes, while the receiver includes its feed assembly and cradle.
  const split = .15, radius = mg.caliber_mm > 10 ? .065 : .035;
  const receiver = boxOfTriangles(tris, [[2, split, false], [1, muzzleVector[1] + .13, false]]);
  const barrel = boxOfTriangles(tris, [[2, split, true],
    [0, muzzleVector[0] - radius, true], [0, muzzleVector[0] + radius, false],
    [1, muzzleVector[1] - radius, true], [1, muzzleVector[1] + radius, false]]);
  return {
    source: ['dshk', 'm2hb', 'kpvt', 'mg34'].includes(mg.id)
      ? 'client/web/assets/mg_models.json; clipped receiver and bore ROI'
      : 'client/web/src/gfx/mgmodel.js generic geometry; clipped receiver and bore ROI',
    muzzle: muzzleVector, receiver, barrel,
  };
}

export function measureCatalog(catalog, models) {
  setMgModels(models);
  return catalog.map(mg => {
    const damage_geometry = geometry(mg);
    if (mg.id === 'mg34') damage_geometry.variants = { mg34_remote: geometry(mg, 'mg34_remote') };
    return { ...mg, damage_geometry };
  });
}

function objectEnd(text, start) {
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  throw new Error('Unclosed MG catalog object');
}

export function catalogWithGeometry(text, measured) {
  let out = '', last = 0;
  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', last)) {
    const end = objectEnd(text, start), original = text.slice(start, end);
    const entry = JSON.parse(original), match = measured.filter(m => m.id === entry.id);
    if (match.length !== 1) throw new Error(`Missing/ambiguous MG measurement: ${entry.id}`);
    const geometry = match[0].damage_geometry;
    let replacement = original;
    if (JSON.stringify(entry.damage_geometry) !== JSON.stringify(geometry)) {
      const formatted = JSON.stringify(geometry, null, 1).split('\n').map((line, k) => k ? '  ' + line : line).join('\n');
      const key = original.indexOf('"damage_geometry"');
      if (key >= 0) {
        const valueStart = original.indexOf('{', original.indexOf(':', key));
        replacement = original.slice(0, valueStart) + formatted + original.slice(objectEnd(original, valueStart));
      } else replacement = original.slice(0, -1).trimEnd() + ',\n  "damage_geometry": ' + formatted + '\n }';
    }
    out += text.slice(last, start) + replacement;
    last = end;
  }
  return out + text.slice(last);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalogPath = path.join(REPO_ROOT, 'data/machine_guns.json');
  const text = fs.readFileSync(catalogPath, 'utf8'), catalog = JSON.parse(text);
  const models = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'client/web/assets/mg_models.json'), 'utf8'));
  const measured = measureCatalog(catalog, models);
  const mismatches = catalog.filter((m, i) => JSON.stringify(m.damage_geometry) !== JSON.stringify(measured[i].damage_geometry)).map(m => m.id);
  if (process.argv.includes('--write')) {
    fs.writeFileSync(catalogPath, catalogWithGeometry(text, measured));
    console.log(`Updated ${catalog.length} MG measurements and mg34_remote.`);
  } else if (mismatches.length) {
    console.error('MG damage geometry differs: ' + mismatches.join(', ')); process.exitCode = 1;
  } else console.log(`Checked ${catalog.length} MG measurements and mg34_remote.`);
}

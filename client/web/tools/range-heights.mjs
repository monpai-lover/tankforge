// Writes data/maps/range/heights.json: the test range's ground (src/game/world.js groundHeight,
// relief and humps) as a height grid for the server's missile world (crates/missile HeightGrid),
// as tools/map-heights.py does for the battle maps.
//   node tools/range-heights.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { groundHeight } from '../src/game/world.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const size = 3000;
const res = 500;
const x0 = -size / 2;
const z0 = -size / 2;
const heights = new Array(res * res);
// each texel holds the height at its centre, sampled bilinearly between centres
for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) heights[j * res + i] = Math.round(groundHeight(x0 + ((i + 0.5) * size) / res, z0 + ((j + 0.5) * size) / res) * 100) / 100;
const dir = path.join(here, '../../../data/maps/range');
fs.mkdirSync(dir, { recursive: true });
const f = path.join(dir, 'heights.json');
fs.writeFileSync(f, JSON.stringify({ x0, z0, size, res, heights }));
console.log('range', res, 'x', res, Math.round(fs.statSync(f).size / 1024), 'KB');

// Writes a workshop preset into data/ as an ordinary vehicle folder (plus its shells), using the
// same exporter the in-page workshop uses.
//   node tools/export-preset.mjs hexa fun_hexa "六炮怪 (workshop example)"
import fs from 'node:fs';
import path from 'node:path';
import { loadData, DATA_DIR } from './load-data.mjs';
import { PRESETS, exportFolder, checkFolder } from '../src/game/loadout.js';

const [preset = 'hexa', id = 'fun_hexa', name = '六炮怪 (workshop example)'] = process.argv.slice(2);
const data = loadData();
const build = PRESETS[preset].build;
const out = exportFolder(build, data, data.vehicles[build.base], id, name);
const problems = checkFolder(out.files);
if (problems.length) {
  console.error('export does not pass the geometric checks:', problems);
  process.exit(1);
}
const dir = path.join(DATA_DIR, 'vehicles', id);
fs.mkdirSync(dir, { recursive: true });
for (const [file, content] of Object.entries(out.files)) fs.writeFileSync(path.join(dir, file), JSON.stringify(content, null, 1) + '\n');
for (const shell of Object.values(out.projectiles)) fs.writeFileSync(path.join(DATA_DIR, 'projectiles', shell.id + '.json'), JSON.stringify(shell, null, 1) + '\n');
console.log(`wrote ${dir} (${Object.keys(out.files).length} files) and ${Object.keys(out.projectiles).length} shells`);

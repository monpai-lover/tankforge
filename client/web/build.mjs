// Bundles the client into a single self-contained HTML page.
//   node build.mjs            -> dist/tankforge-range.html (open directly) + dist/artifact.html (fragment)
// Vehicle, shell and terrain data are read from ../../data and embedded, so the page always shows
// exactly what the data files say. Needs esbuild (npm i, or set ESBUILD_BIN).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadData } from './tools/load-data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { order: ORDER, vehicles, projectiles, terrains, machineGuns, missiles, materials, designCatalog, maps } = loadData();

// The designer core (crates/design via crates/design-wasm). Rebuilt from the Rust sources when a
// toolchain with the wasm32 target is available; otherwise the committed assets/tg_design.wasm
// is used, so the page can be built without Rust.
const wasmOut = path.join(here, 'assets/tg_design.wasm');
try {
  execFileSync('cargo', ['build', '-q', '-p', 'tg-design-wasm', '--release', '--target', 'wasm32-unknown-unknown'], { cwd: path.join(here, '../..'), stdio: 'inherit' });
  fs.copyFileSync(path.join(here, '../../target/wasm32-unknown-unknown/release/tg_design_wasm.wasm'), wasmOut);
} catch {
  console.log('cargo / wasm32 target not available: using the committed assets/tg_design.wasm');
}
const designCore = fs.readFileSync(wasmOut).toString('base64');

// optional recorded sounds: assets/sfx/<slot>.(ogg|mp3|wav) are embedded as data URLs
const sfx = {};
const sfxDir = path.join(here, 'assets/sfx');
const MIME = { '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };
if (fs.existsSync(sfxDir)) {
  for (const f of fs.readdirSync(sfxDir)) {
    const ext = path.extname(f).toLowerCase();
    if (!MIME[ext]) continue;
    sfx[path.basename(f, ext)] = `data:${MIME[ext]};base64,${fs.readFileSync(path.join(sfxDir, f)).toString('base64')}`;
  }
}
// UI pictures: assets/ui/<name>.png as data URLs (shell_icons: one 44x150 cell per round type)
const images = {};
const uiDir = path.join(here, 'assets/ui');
if (fs.existsSync(uiDir)) {
  for (const f of fs.readdirSync(uiDir)) {
    if (path.extname(f).toLowerCase() === '.png') images[path.basename(f, '.png')] = `data:image/png;base64,${fs.readFileSync(path.join(uiDir, f)).toString('base64')}`;
  }
}
// crew figures for the interior view (tools/crew-prep.py)
const crewPath = path.join(here, 'assets/crew_model.json');
const crewModel = fs.existsSync(crewPath) ? JSON.parse(fs.readFileSync(crewPath, 'utf8')) : null;
// the roof machine guns, reduced from the reference models (tools/mg_asset.py)
const mgPath = path.join(here, 'assets/mg_models.json');
const mgModels = fs.existsSync(mgPath) ? JSON.parse(fs.readFileSync(mgPath, 'utf8')) : null;
const data = JSON.stringify({ order: ORDER, vehicles, projectiles, terrains, machineGuns, missiles, materials, designCatalog, designCore, sfx, images, crewModel, mgModels, maps }).replace(/<\//g, '<\\/');

const candidates = [process.env.ESBUILD_BIN, path.join(here, 'node_modules/.bin/esbuild'), '/opt/npm-tools/node_modules/.bin/esbuild', 'esbuild'].filter(Boolean);
const esbuild = candidates.find((c) => c === 'esbuild' || fs.existsSync(c));
const bundle = execFileSync(esbuild, [path.join(here, 'src/boot.js'), '--bundle', '--format=iife', '--target=es2020', '--log-level=warning'], { maxBuffer: 64 << 20 })
  .toString()
  .replace(/<\/script/g, '<\\/script');

const template = fs.readFileSync(path.join(here, 'template.html'), 'utf8');
const fragment = template.replace('/*__DATA__*/', () => data).replace('/*__BUNDLE__*/', () => bundle);
const titleEnd = fragment.indexOf('<div id="app">');
const page = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${fragment.slice(0, titleEnd)}</head>
<body>
${fragment.slice(titleEnd)}
</body>
</html>
`;
fs.mkdirSync(path.join(here, 'dist'), { recursive: true });
fs.writeFileSync(path.join(here, 'dist/artifact.html'), fragment);
fs.writeFileSync(path.join(here, 'dist/tankforge-range.html'), page);
console.log(`built: ${(page.length / 1024).toFixed(0)} KB (data ${(data.length / 1024).toFixed(0)} KB, code ${(bundle.length / 1024).toFixed(0)} KB)`);

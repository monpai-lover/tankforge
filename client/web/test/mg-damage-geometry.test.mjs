import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const tool = await import('../tools/measure-mg-damage.mjs').catch(() => null);
const repo = new URL('../../../', import.meta.url);
const catalogPath = new URL('data/machine_guns.json', repo);
const modelsPath = new URL('../assets/mg_models.json', import.meta.url);
const catalogText = fs.readFileSync(catalogPath, 'utf8');
const catalog = JSON.parse(catalogText);
const models = JSON.parse(fs.readFileSync(modelsPath, 'utf8'));
const tuning = c => c.map(({damage_geometry, ...entry}) => entry);

test('all ten MG measurements and stockless MG34 match actual rendered assets', () => {
  assert.ok(tool, 'the reproducible MG measurement tool must be committed');
  const measured = tool.measureCatalog(catalog, models);
  assert.equal(measured.length, 10);
  assert.deepEqual(measured.map(m => m.damage_geometry), catalog.map(m => m.damage_geometry));
  assert.deepEqual(tuning(measured), tuning(catalog), 'measurement preserves every original tuning value');
  const remote = measured.find(m => m.id === 'mg34').damage_geometry.variants.mg34_remote;
  assert.ok(remote.receiver.center[2] - remote.receiver.half_extents[2] >= -.332 - 1e-6);
});

test('ROI clipping includes triangles crossing the barrel boundary', () => {
  assert.ok(tool);
  const box = tool.boxOfTriangles([[[0, 0, .144], [0, 1, .598], [1, 0, .598]]], [[2, .15, true]]);
  assert.ok(Math.abs(box.center[2] - box.half_extents[2] - .15) < 1e-6);
});

test('asset changes are detected by remeasurement instead of returning stored metadata', () => {
  assert.ok(tool);
  const changed = structuredClone(models);
  for (let i = 0; i < changed.mg34.pos.length; i += 3) changed.mg34.pos[i] += 50;
  const measured = tool.measureCatalog(catalog, changed);
  assert.notDeepEqual(measured.find(m => m.id === 'mg34').damage_geometry, catalog.find(m => m.id === 'mg34').damage_geometry);
});

test('measurement CLI checks from an unrelated working directory without writes', () => {
  assert.ok(tool);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tankforge-mg-check-'));
  const output = execFileSync(process.execPath, [fileURLToPath(new URL('../tools/measure-mg-damage.mjs', import.meta.url))], {cwd: tmp, encoding: 'utf8'});
  assert.match(output, /10 MG/);
  assert.equal(fs.readFileSync(catalogPath, 'utf8'), catalogText);
});

test('explicit geometry updates preserve tuning text and regenerate changed measurements', () => {
  assert.ok(tool);
  const measured = tool.measureCatalog(catalog, models);
  const changed = structuredClone(measured); changed[0].damage_geometry.receiver.center[0] += .01;
  const updated = tool.catalogWithGeometry(catalogText, changed);
  assert.deepEqual(tuning(JSON.parse(updated)), tuning(catalog));
  assert.equal(JSON.parse(updated)[0].damage_geometry.receiver.center[0], changed[0].damage_geometry.receiver.center[0]);
  assert.equal(tool.catalogWithGeometry(catalogText, measured), catalogText, 'already measured metadata retains every byte');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadData } from '../tools/load-data.mjs';
import { rendererSink, captureNodes, hetzerWitness, bytesOf, sha, bruteForce } from '../tools/hit-mesh-capture.mjs';
import * as exporter from '../tools/export-hit-mesh.mjs';
import { buildTank } from '../src/gfx/tankmodel.js';
import { buildInterior, setCrewModel } from '../src/gfx/interior.js';
import { setMgModels } from '../src/gfx/mgmodel.js';
import { makeLoadout, generatedTurretParts } from '../src/game/loadout.js';
import { decodeAllImported } from '../src/gfx/imported.js';
import { loadCoreSync } from '../src/design/core.js';
import { Combat } from '../src/game/combat.js';

const assets = () => {
  setCrewModel(JSON.parse(fs.readFileSync(new URL('../assets/crew_model.json', import.meta.url))));
  setMgModels(JSON.parse(fs.readFileSync(new URL('../assets/mg_models.json', import.meta.url))));
};
function build(data, id, interior = false) {
  assets(); const b = data.vehicles[id], renderer = rendererSink();
  const loadout = makeLoadout(id, b, data.projectiles, data.machineGuns);
  const model = buildTank(renderer, loadout, generatedTurretParts);
  const inside = interior ? buildInterior(renderer, model, loadout, b.modules, b.crew) : null;
  model.root.update();
  return { model, inside, capture: captureNodes(model.root), dispose() { inside?.dispose(); model.dispose(); } };
}

test('actual merged Hetzer mesh preserves each authored part range without changing the hollow muzzle', () => {
  const f = hetzerWitness();
  try {
    const barrel = f.capture.find(c => c.node === f.model.turrets[0].guns[0].barrel);
    assert.ok(Array.isArray(barrel.ranges), 'capture must retain per-part triangle ownership');
    assert.equal(barrel.ranges.length, 2);
    assert.equal(barrel.ranges.reduce((n, r) => n + r.count, 0), barrel.positions.length / 9);
    assert.deepEqual(barrel.ranges.map(r => r.part.authoredOrdinal), [14, 15]);
    assert.equal(sha(bytesOf(f.tube.positions)), 'd514cca1fd4a062ecdc172eddcf665960e11490a8a52d31574d98988094536f5');
  } finally { f.dispose(); }
});

test('source IDs survive procedural filter and reorder, including duplicate descriptions', () => {
  assert.equal(typeof exporter.mintVisualSources, 'function', 'mint identities before donor/filter operations');
  const d = loadData(); exporter.mintVisualSources(d);
  const originals = d.vehicles.de_tiger_e.visual.parts;
  const kept = originals.filter(p => p.mount === 'hull').reverse();
  assert.ok(kept.every(p => p.hitSource.key === originals[p.hitSource.authoredPartOrdinal].hitSource.key));
  assert.equal(new Set(originals.map(p => p.hitSource.key)).size, originals.length);
});

test('T72 declarations distinguish armor walls, nonarmor materials and real interior ownership', () => {
  assert.equal(typeof exporter.bindingCatalogFromCapture, 'function', 'trusted bindings need a separate verified catalog');
  const d = loadData(); exporter.mintVisualSources(d); const f = build(d, 'su_t72a', true);
  try {
    const anatomy = { armor: d.vehicles.su_t72a.armor, modules: d.vehicles.su_t72a.modules, crew: d.vehicles.su_t72a.crew };
    exporter.bindInteriorCapture(f.capture, f.inside, anatomy);
    const result = exporter.fixtureManifest(f.capture, 'su_t72a');
    const c = exporter.bindingCatalogFromCapture(result, f.capture, anatomy);
    assert.equal(c.catalog.schema, 'HitBindingCatalogV1');
    const armor = c.catalog.declarations.filter(r => r.role === 'armor');
    assert.ok(armor.some(r => r.partId === 't72a_cast_turret' && r.armorBinding.boundarySide === 'inner'));
    assert.ok(armor.some(r => r.partId === 't72a_cast_turret' && r.armorBinding.boundarySide === 'outer'));
    const skirt = c.catalog.declarations.find(r => r.partId === 't72a_rubber_skirt_l_0');
    assert.equal(skirt.material.physicalClass, 'rubber'); assert.equal(skirt.armorBinding.status, 'none');
    assert.deepEqual(skirt.armorBinding.armorRefs, []); assert.equal(skirt.armorBinding.layerKey, null);
    const glass = c.catalog.declarations.find(r => r.partId === 't72a_tpd_k1_glass');
    assert.equal(glass.material.physicalClass, 'glass'); assert.equal(glass.armorBinding.status, 'none');
    const crew = c.catalog.declarations.filter(r => r.role === 'crew');
    assert.equal(new Set(crew.map(r => r.crewSlot.index)).size, anatomy.crew.length);
    assert.ok(crew.every(r => r.crewSlot.anatomyHash === c.catalog.anatomyHash && r.moduleRef === null));
    assert.ok(c.catalog.declarations.some(r => r.role === 'module' && r.moduleRef === anatomy.modules[0].id));
    assert.ok(c.catalog.layers.every(layer => new Set(layer.declarationKeys).size === layer.declarationKeys.length));
    const castLayer = c.catalog.layers.find(layer => layer.declarationKeys.some(key => armor.find(r => r.key === key && r.partId === 't72a_cast_turret' && r.armorBinding.boundarySide === 'outer')));
    assert.equal(castLayer.chargePolicy, 'once_per_material_region');
    assert.equal(castLayer.thicknessSource, 'authored_engineering');
    assert.equal(c.catalog.geometryBytesChanged, 0);
  } finally { f.dispose(); }
});

test('packed Panther source materials and articulation remain evidence without invented armor', async () => {
  assert.equal(typeof exporter.bindingCatalogFromCapture, 'function');
  const d = loadData(); exporter.mintPackedSources(d); exporter.mintVisualSources(d); await decodeAllImported(d.vehicles);
  const f = build(d, 'de_aufkl_panther');
  try {
    const imported = f.capture.filter(c => c.hitSource);
    assert.ok(imported.length > 0);
    assert.ok(imported.every(c => c.ranges?.[0].part.packedMaterial));
    const result = exporter.fixtureManifest(f.capture, 'de_aufkl_panther');
    const c = exporter.bindingCatalogFromCapture(result, f.capture, d.vehicles.de_aufkl_panther, exporter.assembliesOf(f.model.root));
    assert.ok(c.catalog.declarations.filter(r => r.sourceKey.startsWith('packed:')).every(r => r.armorBinding.status === 'unknown'));
    assert.ok(c.catalog.articulations.some(a => a.joint.kind === 'turret' && a.joint.turret === 0));
    assert.ok(c.catalog.articulations.some(a => a.joint.kind === 'gun' && a.joint.gun === 0));
  } finally { f.dispose(); }
});

test('catalog rejects forged declarations, unknown anatomy refs and partial triangle ownership', () => {
  assert.equal(typeof exporter.validateBindingCatalog, 'function', 'catalog intake must validate semantic and content identity');
  const d = loadData(); exporter.mintVisualSources(d); const f = build(d, 'su_t72a', true);
  try {
    const a = d.vehicles.su_t72a; exporter.bindInteriorCapture(f.capture, f.inside, a);
    const result = exporter.fixtureManifest(f.capture, 'su_t72a'), c = exporter.bindingCatalogFromCapture(result, f.capture, a);
    assert.equal(exporter.validateBindingCatalog(c.text, c.expectedHash, result, a), true);
    const bad = structuredClone(c.catalog); bad.declarations[0].moduleRef = 'made-up-module';
    assert.throws(() => exporter.validateBindingCatalog(exporter.canonical(bad), exporter.hashValue(bad), result, a), /hash|module|declaration/);
    assert.throws(() => exporter.validateBindingCatalog(c.text, '0'.repeat(64), result, a), /hash/);
    const barrel = f.capture.find(c => c.node === f.model.turrets[0].guns[0].barrel);
    barrel.ranges[0].count--;
    assert.throws(() => exporter.fixtureManifest(f.capture, 'su_t72a'), /ownership partition/);
  } finally { f.dispose(); }
});

test('catalog retains the complete accepted anatomy subtree and rejects forged or omitted anatomy data', () => {
  const d = loadData(); exporter.mintVisualSources(d); const f = build(d, 'su_t72a', true);
  try {
    const a = d.vehicles.su_t72a; exporter.bindInteriorCapture(f.capture, f.inside, a);
    const result = exporter.fixtureManifest(f.capture, 'su_t72a'), c = exporter.bindingCatalogFromCapture(result, f.capture, a);
    const accepted = { armor: a.armor, modules: a.modules, crew: a.crew, weapons: a.weapons || null };
    assert.deepEqual(c.catalog.acceptedAnatomy, accepted, 'every original normalized field and number must remain intact');
    assert.equal(exporter.hashValue(c.catalog.acceptedAnatomy), c.catalog.anatomyHash);
    const encoded = catalog => { delete catalog.catalogHash; catalog.catalogHash = exporter.hashValue(catalog); const text = exporter.canonical(catalog); return [text, sha(Buffer.from(text)), result, a]; };
    const changed = structuredClone(c.catalog); changed.acceptedAnatomy.modules[0].max_health += 1;
    assert.throws(() => exporter.validateBindingCatalog(...encoded(changed)), /accepted anatomy|anatomy hash/);
    const missing = structuredClone(c.catalog); delete missing.acceptedAnatomy.weapons;
    assert.throws(() => exporter.validateBindingCatalog(...encoded(missing)), /accepted anatomy|anatomy hash/);
    const extra = structuredClone(c.catalog); extra.acceptedAnatomy.trustedByClient = true;
    assert.throws(() => exporter.validateBindingCatalog(...encoded(extra)), /accepted anatomy|anatomy hash/);
    const omitted = structuredClone(c.catalog); delete omitted.acceptedAnatomy;
    assert.throws(() => exporter.validateBindingCatalog(...encoded(omitted)), /accepted anatomy|anatomy hash/);
    const sameIdWrongWeapon = structuredClone(a); sameIdWrongWeapon.weapons.main_gun.reload_s += 0.125;
    assert.throws(() => exporter.validateBindingCatalog(c.text, c.expectedHash, result, sameIdWrongWeapon), /accepted anatomy|anatomy hash/);
  } finally { f.dispose(); }
});

test('Puma wheels have explicit side and axle identity independent of identical shared buffers', () => {
  const d = loadData(), f = build(d, 'de_sdkfz234_2');
  try {
    const wheels = f.capture.filter(c => c.node.name === 'road_wheel');
    assert.equal(wheels.length, 8);
    assert.ok(wheels.every(c => c.joint?.kind === 'wheel'), 'wheel pose ownership must be captured');
    assert.equal(new Set(wheels.map(c => `${c.joint.side}:${c.joint.index}`)).size, 8);
  } finally { f.dispose(); }
});

test('NSVT mixed gun preserves actual barrel-only primitive ownership and normalized weapon module IDs', () => {
  const d = loadData(), core = loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm', import.meta.url)), { materials: d.materials, catalog: d.designCatalog, terrains: Object.values(d.terrains) });
  d.vehicles.su_t72a = new Combat(core, d.machineGuns).prepare('nsvt-test', d.vehicles.su_t72a);
  exporter.mintVisualSources(d); const f = build(d, 'su_t72a', true);
  try {
    const gun = f.capture.find(c => c.node === f.model.mgs[0].node);
    assert.ok(gun.ranges?.length > 0, 'mixed NSVT mesh needs primitive ownership');
    assert.equal(gun.ranges.filter(r => r.part.name.startsWith('t72a_nsvt_barrel_')).length, 4);
    assert.equal(gun.ranges.reduce((n, r) => n + r.count, 0), gun.positions.length / 9);
    exporter.bindInteriorCapture(f.capture, f.inside, d.vehicles.su_t72a);
    const result = exporter.fixtureManifest(f.capture, 'su_t72a');
    const c = exporter.bindingCatalogFromCapture(result, f.capture, d.vehicles.su_t72a);
    const barrels = c.catalog.declarations.filter(d => d.partId.startsWith('t72a_nsvt_barrel_'));
    assert.ok(barrels.length >= 4);
    assert.ok(barrels.every(d => d.moduleRef === 'mg:aa_nsvt:barrel' && d.armorBinding.status === 'none'));
    assert.ok(c.catalog.declarations.some(d => d.partId.startsWith('t72a_nsvt_receiver_') && d.moduleRef === 'mg:aa_nsvt:receiver'));
    assert.ok(c.catalog.declarations.filter(d => d.partId === 't72a_pkt_barrel').every(d => d.moduleRef === 'mg:coax_pkt:barrel'));
  } finally { f.dispose(); }
});

test('one real casting wall retains one material region when inner and outer resistance-sector labels differ', () => {
  const d = loadData(); exporter.mintVisualSources(d); const f = build(d, 'su_t72a');
  try {
    const result = exporter.fixtureManifest(f.capture, 'su_t72a'), catalog = exporter.bindingCatalogFromCapture(result, f.capture, d.vehicles.su_t72a).catalog;
    const c = f.capture.find(c => c.ranges.some(r => r.part.name === 't72a_cast_turret'));
    const r = c.ranges.find(r => r.part.name === 't72a_cast_turret');
    const onlyCasting = { ...c, positions: c.positions.slice(r.first * 9, (r.first + r.count) * 9) };
    // The axial fixture lands on shared edges. Preserve actual triangle identities
    // and select the independently witnessed faces, without expanding the edge.
    const hits = bruteForce([onlyCasting], [0, 1.54, .18], [0, 1.54, -2.82]).filter(h => [678, 49].includes(h.triangle));
    assert.equal(hits.length, 2);
    const records = hits.map(h => catalog.declarations.find(d => d.meshKey === `mesh:${c.key}` && h.triangle + r.first >= d.first && h.triangle + r.first < d.first + d.count));
    assert.notEqual(records[0].armorBinding.armorRefs[0], records[1].armorBinding.armorRefs[0], 'fixture exposes differing legacy sector labels');
    assert.equal(typeof records[0].armorBinding.materialRegionKey, 'string', 'pairing must have a geometry-owned material region');
    assert.equal(records[0].armorBinding.materialRegionKey, records[1].armorBinding.materialRegionKey);
    assert.deepEqual(new Set(records.map(d => d.armorBinding.boundarySide)), new Set(['inner', 'outer']));
  } finally { f.dispose(); }
});

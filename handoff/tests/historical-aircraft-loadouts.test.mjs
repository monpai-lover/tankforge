import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {exportProfiles} from '../tools/export_frontline_aircraft.mjs';
import {assertCountermeasureExportContract,normalizeReviewedSpawnSource} from './fixtures/r8-aircraft-contract.mjs';

// Without TF_HISTORICAL_APP this exercises the unchanged delivered baseline.
// RED therefore proves a missing real preset/filler correction, not a missing import.
const root = new URL('../../', import.meta.url);
const baselinePath = new URL('data/aircraft/frontline.json', root);
const baselineBytes = fs.readFileSync(baselinePath);
const baseline = JSON.parse(fs.readFileSync(new URL('historical-aircraft-r7-baseline.json', import.meta.url)));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ?
  Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => sha(JSON.stringify(canonical(value)));
const expected = {
  mig21: [
    [['r3s', 2, 'inner'], ['r3s', 2, 'outer']],
    [['ub16', 2, 'inner'], ['ub16', 2, 'outer']],
    [['fab250', 2, 'inner'], ['fab250', 2, 'outer']],
  ],
  f15c: [[['gbu10', 2, 'inner']], [['gbu12', 2, 'inner']], [['cbu87', 2, 'inner']]],
  f16v: [
    [['mk84', 2, 'inner']],
    [['gbu10', 2, 'mid'], ['sniper', 1, 'chin', 1]],
    [['gbu12', 2, 'inner'], ['sniper', 1, 'chin', 1]],
  ],
  a10a: [
    [['gbu12', 1, 'p5'], ['gbu12', 1, 'p7'], ['sniper', 1, 'p10']],
    [['gbu12', 1, 'p5'], ['gbu12', 1, 'p7'], ['litening', 1, 'p10']],
    [['gbu10', 1, 'p4'], ['gbu10', 1, 'p8'], ['litening', 1, 'p10']],
  ],
};
let pending;
const profile = () => pending ||= exportProfiles({appPath: process.env.TF_HISTORICAL_APP}).then(value => JSON.parse(JSON.stringify(value)));
const sameEntries = (a, b) => JSON.stringify(a) === JSON.stringify(b);

test('confirmed existing-option configurations become real selectable source presets', async () => {
  const next = await profile();
  let count = 0;
  for (const [id, configurations] of Object.entries(expected)) for (const entries of configurations) {
    const a = next.aircraft[id];
    const lo = a.stores.loadouts.find(l => sameEntries(l.entries, entries));
    assert.ok(lo, `${id}: missing actual source preset ${JSON.stringify(entries)}`);
    assert.ok(lo.index >= baseline.aircraft[id].loadouts.length, `${id}: append only`);
    for (const [store, quantity, station, side] of entries) {
      const items = lo.items.filter(it => it.id === store && it.station === station && (side == null || it.side === side));
      assert.equal(items.length, quantity, `${id}/${store}: no silent missing source attachment`);
      for (const item of items) {
        assert.equal(item.p.length, 3);
        assert.ok(item.p.every(Number.isFinite));
        assert.ok(item.owner);
        const slot = a.stores.slots.find(s => s.station === station && s.side === item.side);
        assert.ok(slot?.options[store], `${id}/${store}: actual source slot allowed`);
        const sourceItem = a.stores.slotItems[slot.key][store].find(it => it.id === store && sameEntries(it.p, item.p));
        assert.ok(sourceItem, `${id}/${store}: exact custom-path mount and authoritative release position`);
        const def = next.storeDefinitions[store];
        assert.ok(def.mass > 0);
        if (!['sensorpod', 'ecm'].includes(def.kind)) assert.ok(item.count > 0, `${id}/${store}: actual ammunition`);
      }
    }
    if (entries.some(([w]) => /^gbu/.test(w))) {
      const carried = lo.items.filter(it => ['sniper', 'litening'].includes(it.id));
      assert.ok(id === 'f15c' ? a.sensors.equipment.pod === 'lantirn' && a.sensors.pods.lantirn.laser : carried.length === 1,
        `${id}: laser presets retain real designator equipment`);
    }
    count++;
  }
  assert.equal(count, 12);
});

test('R4M physical filler is 520g and derived shell keeps the existing total rocket mass estimate', async () => {
  const next = await profile(), d = next.storeDefinitions.r4m, shell = next.shells[d.projectile_id];
  assert.equal(d.mass, baseline.r4mStoreMass, 'total carried mass unchanged');
  assert.equal(d.warhead.explosive_mass_kg, .52, 'Smithsonian 520g Hexogen, not the legacy doubled game charge');
  assert.equal(d.warhead.mass_kg, d.mass, 'projectile mass role follows existing rocket total estimate');
  assert.equal(shell.explosive_mass_kg, .52);
  assert.equal(shell.mass_kg, d.mass);
  assert.ok(shell.mass_kg >= shell.explosive_mass_kg);
});

test('all 28 source identities, 17 imported models, original physics guns fuel and preset indices survive', async () => {
  const next = await profile();
  const legacySensors=assertCountermeasureExportContract(next,process.env.TF_HISTORICAL_APP||new URL('../bundle/app.js.html',import.meta.url));
  assert.equal(Object.keys(next.aircraft).length, 28);
  assert.equal(next.source.physicalImportedModelCount, 17);
  for (const [id, original] of Object.entries(baseline.aircraft)) {
    const candidate = next.aircraft[id];
    // Only the separately source-verified CM member is additive; all original
    // radar, equipment and pod values still satisfy the immutable old hash.
    for (const key of ['metadata', 'physics', 'guns', 'fuel', 'sensors']) assert.equal(hash(key==='sensors'?legacySensors[id]:candidate[key]), original.hashes[key], `${id}/${key}`);
    for (const lo of original.loadouts) assert.equal(hash(candidate.stores.loadouts[lo.index]), lo.sha256, `${id}/original preset ${lo.index}`);
    assert.equal(hash(candidate.stores.slots.map(s => [s.key, s.options])), original.slotsSha256, `${id}: no expanded compatibility`);
    assert.equal(hash(candidate.stores.slotItems), original.slotItemsSha256, `${id}: every exact source mount and custom ammunition count`);
  }
  for (const [id, digest] of Object.entries(baseline.storeHashes)) if (id !== 'r4m') assert.equal(hash(next.storeDefinitions[id]), digest, `${id}: unrelated ammunition immutable`);
  for (const [id, digest] of Object.entries(baseline.shellHashes)) if (id !== 'he_55_r4m') assert.equal(hash(next.shells[id]), digest, `${id}: unrelated shell immutable`);
  assert.equal(sha(fs.readFileSync(baselinePath)), sha(baselineBytes), 'no canonical profile writes');
});

test('country and variant guards do not borrow Polish MF or upgraded Soviet guided attack presets', async () => {
  const next = await profile();
  for (const id of ['p51d', 'f4u1d', 'f86f', 'su27', 'mig29', 'su27skm', 'mig29smt', 'yak9u', 'me262u4']) {
    assert.deepEqual(next.aircraft[id].stores.loadouts.map(hash), baseline.aircraft[id].loadouts.map(l => l.sha256), `${id}: no unsourced new preset`);
  }
  const added = next.aircraft.mig21.stores.loadouts.slice(baseline.aircraft.mig21.loadouts.length);
  assert.ok(!added.some(lo => lo.entries.some(([id]) => ['r3r', 'r60', 'r60m', 'rvvae'].includes(id))), 'NVA MF is not certified from Polish MF evidence');
});

test('spawn compatibility admits only the exact visual hook and rejects missing, changed, duplicate or unrelated edits',()=>{
  const app=fs.readFileSync(process.env.TF_HISTORICAL_APP||new URL('../bundle/app.js.html',import.meta.url),'utf8');
  const start=app.indexOf('    spawn(x, y, z, heading, airspeed = 0, onGround = true) {');
  const end=app.indexOf('      this.api.spawn(x, y, z, heading, airspeed, onGround ? 1 : 0);',start);
  assert.ok(start>=0&&end>start);
  const body=app.slice(start,end),hook='      this._airVortexLife=(this._airVortexLife||0)+1;if(typeof TFAirVortex!=="undefined")TFAirVortex.remove(this);\n';
  assert.equal(sha(normalizeReviewedSpawnSource(body)),baseline.baselineSource.sections['Aircraft.spawn'].sha256);
  for(const changed of [body.replace(hook,''),body.replace('TFAirVortex.remove(this);','TFAirVortex.removeAll(this);'),body.replace(hook,hook+hook),body+'      this.unreviewed=1;\n',body.replace('this.api.configure(0, 45, 1,','this.api.configure(0, 46, 1,')])assert.throws(()=>normalizeReviewedSpawnSource(changed),/exact allowed edit|Physical spawn configuration/);
});

test('helper validates exact carrier identity, rejects conflicting preset names and is idempotent', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(new URL('../tools/historical_aircraft_loadouts.js', import.meta.url), 'utf8'), context);
  const helper = context.TFHistoricalAircraftLoadouts;
  const types = {}, loadouts = {};
  for (const [id, a] of Object.entries(baseline.aircraft)) {
    types[id] = {name: a.metadata.name, fighter: {nation: a.metadata.nation}};
    loadouts[id] = a.loadouts.slice(1).map(l => [l.name, structuredClone(l.entries)]);
  }
  helper.installLoadouts(loadouts, types);
  const once = JSON.stringify(loadouts);
  helper.installLoadouts(loadouts, types);
  assert.equal(JSON.stringify(loadouts), once);
  types.mig21.fighter.nation = '波蘭';
  assert.throws(() => helper.installLoadouts(loadouts, types), /identity changed/);
  types.mig21.fighter.nation = '東德';
  loadouts.mig21.find(([name]) => name === 'NVA：4 × R-3S')[1][0][1] = 3;
  assert.throws(() => helper.installLoadouts(loadouts, types), /name collision/);
  assert.throws(() => helper.correctStoreDefinitions({r4m: {mass: 4, warhead: {id: 'he_55_r4m'}}}), /source record changed/);
});

test('staged patch is idempotent and actual shipped JavaScript parses', () => {
  const appPath = process.env.TF_HISTORICAL_APP || fileURLToPath(new URL('../bundle/app.js.html', import.meta.url)), app = fs.readFileSync(appPath, 'utf8');
  new Function(app.slice(app.indexOf('>') + 1, app.lastIndexOf('</script>')));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-r8-loadout-idempotence-'));
  const output = path.join(temporary, 'candidate-idempotent.html');
  const patcher = fileURLToPath(new URL('../tools/patch_historical_aircraft_loadouts.py', import.meta.url));
  try {
    const result = spawnSync(process.env.TF_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), [patcher, '--input', appPath, '--output', output], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(output, 'utf8'), app);
    assert.equal(fs.readFileSync(appPath, 'utf8'), app, 'canonical input remains byte-identical');
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
});

test('canonical export is synchronized to the actual source app', {skip: !!process.env.TF_HISTORICAL_APP}, async () => {
  const current = JSON.parse(baselineBytes), exported = await profile();
  assert.equal(exported.source.appSha256, sha(fs.readFileSync(new URL('handoff/bundle/app.js.html', root))));
  assert.deepEqual(current, exported, 'source-path profile must be regenerated after integration');
});

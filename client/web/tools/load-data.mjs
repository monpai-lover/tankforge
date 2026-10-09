// Loads the project's data/ tree the same way build.mjs embeds it (Node only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
// Garage order: by nation, then by year of service.
export const ORDER = [
  'de_pz3_j', 'de_pz4_h', 'de_tiger_e', 'de_panther_g', 'de_panther_f', 'de_sdkfz234_2',
  'su_t34_1940', 'su_t34_85', 'su_is2', 'su_t10m', 'su_bmpt34', 'su_t54',
  'us_m8', 'us_m10', 'us_m4a2', 'us_m4a3_75w', 'us_m4a1_76w', 'us_m4a3_76w_hvss', 'us_m56', 'us_m901_itv',
  'uk_cromwell_iv',
  'xp_kda35',
  'xp_w78',
  'de_pzjg1',
  'de_flakpz38t',
  'de_hetzer',
  'de_hetzer_flak',
  'de_rso_flak',
  'de_rso_pak40',
  'de_gepard',
  'uk_cmp_portee',
  'de_aufkl_panther',
  'de_vk1602',
  'de_hetzer_mk103',
  'de_hetzer_mk103_camo',
  'de_sdkfz140_1',
  'de_hetzer_sdkfz1401',
  'xp_bmp_k64',
  'xp_bmp_k64_atgm',
  'xp_bmp_k64_kornet',
  'su_att_m46',
  'proto_a',
];
const json = (p) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, p), 'utf8'));

export function loadData() {
  const vehicles = {};
  for (const id of ORDER) {
    const vehicle = json(`vehicles/${id}/vehicle.json`);
    vehicles[id] = {
      vehicle,
      weapons: json(`vehicles/${id}/${vehicle.files.weapons}`),
      engine: json(`vehicles/${id}/${vehicle.files.engine}`),
      visual: json(`vehicles/${id}/${vehicle.files.visual}`),
      // needed by the workshop to export a complete vehicle folder
      armor: json(`vehicles/${id}/${vehicle.files.armor}`),
      modules: json(`vehicles/${id}/${vehicle.files.modules}`),
      crew: json(`vehicles/${id}/${vehicle.files.crew}`),
    };
    // an imported model (tools/glb-vehicle.py), decoded in the page
    if (vehicle.model && vehicle.model.endsWith('.json') && fs.existsSync(path.join(DATA_DIR, `vehicles/${id}/${vehicle.model}`))) vehicles[id].model = json(`vehicles/${id}/${vehicle.model}`);
  }
  const projectiles = {};
  for (const f of fs.readdirSync(path.join(DATA_DIR, 'projectiles'))) {
    const p = json(`projectiles/${f}`);
    projectiles[p.id] = p;
  }
  const terrains = Object.fromEntries(json('terrains.json').map((t) => [t.id, t]));
  const machineGuns = Object.fromEntries(json('machine_guns.json').map((m) => [m.id, m]));
  // missiles and rockets (crates/missile flies them)
  const missiles = Object.fromEntries(json('missiles.json').map((m) => [m.id, m]));
  // vehicle designer: armour materials, coefficient catalog
  const materials = json('materials.json');
  const designCatalog = json('design_catalog.json');
  // battle maps made from drawings by tools/map-prep.py
  const maps = {};
  const mapDir = path.join(DATA_DIR, 'maps');
  if (fs.existsSync(mapDir)) {
    for (const id of fs.readdirSync(mapDir).sort()) {
      const f = path.join(mapDir, id, 'map.json');
      if (fs.existsSync(f)) maps[id] = JSON.parse(fs.readFileSync(f, 'utf8'));
    }
  }
  return { order: ORDER, vehicles, projectiles, terrains, machineGuns, missiles, materials, designCatalog, maps };
}

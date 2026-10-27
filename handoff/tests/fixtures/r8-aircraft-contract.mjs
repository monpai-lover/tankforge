// Strict append-only R8 extension; frozen R7 receipts remain unchanged.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {normalizeConventionalProfile,normalizeConventionalSourceSection} from './r83-conventional-contract.mjs';
import {createHash} from 'node:crypto';
const bytes=fs.readFileSync(new URL('../historical-aircraft-r7-baseline.json',import.meta.url));
const digest=x=>createHash('sha256').update(x).digest('hex');
assert.equal(digest(bytes),'0145684d8a5e0a9b7576c746d4aab78abf11c2d03e0236f804991ba42949df98','Frozen 106-entry R7 continuity receipt is immutable');
const baseline=JSON.parse(bytes),root=new URL('../../../',import.meta.url);
assert.equal(baseline.baselineProfileSha256,'6337fcf3ad2fd99c775dd34fff77aaada770af0dac26d2a32d03478e671b6247','Full R7 store pins derive from the immutable R7 profile cohort');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const hash=x=>digest(JSON.stringify(canonical(x))),oldHash=x=>digest(JSON.stringify(x));
const HELPER_SHA256='4eb645a9d8cc395c44f060499384206d93672259a71a09ed17fe04d8682065dc';
export const R8_PRESETS = {
  "mig21": [
    {
      "index": 4,
      "name": "NVA：4 × R-3S",
      "entries": [
        [
          "r3s",
          2,
          "inner"
        ],
        [
          "r3s",
          2,
          "outer"
        ]
      ],
      "sha256": "7cbba4992c20145bb93f95972f1f374ac9ca9227ac2808db58e9b877da4010c6"
    },
    {
      "index": 5,
      "name": "NVA：4 × UB-16",
      "entries": [
        [
          "ub16",
          2,
          "inner"
        ],
        [
          "ub16",
          2,
          "outer"
        ]
      ],
      "sha256": "60ed44d697e54f1bbf6cfb36e1cd8b1490f515e9fbb0fd0b76e12e7b731ba156"
    },
    {
      "index": 6,
      "name": "NVA：4 × FAB-250",
      "entries": [
        [
          "fab250",
          2,
          "inner"
        ],
        [
          "fab250",
          2,
          "outer"
        ]
      ],
      "sha256": "2b771726ef4f1852ea146faa6022c7bee635ed7bac715f788b5b2cf33318e665"
    }
  ],
  "f15c": [
    {
      "index": 9,
      "name": "GBU-10 / LANTIRN",
      "entries": [
        [
          "gbu10",
          2,
          "inner"
        ]
      ],
      "sha256": "f9533742b82ec1ec21fbc6ab72f9b6e4cd6de3576d5ddd87a7445ddd247cb4bc"
    },
    {
      "index": 10,
      "name": "GBU-12 / LANTIRN",
      "entries": [
        [
          "gbu12",
          2,
          "inner"
        ]
      ],
      "sha256": "d6eaf31775d553c282daea3abddc78163bc81ee8655e322a7819f86e362bc1c3"
    },
    {
      "index": 11,
      "name": "CBU-87 雙掛",
      "entries": [
        [
          "cbu87",
          2,
          "inner"
        ]
      ],
      "sha256": "0d71f62f28f033ba48b7e0e8701f903c834f79fc47ecab81016b63d79c49dadc"
    }
  ],
  "f16v": [
    {
      "index": 5,
      "name": "ROCAF：Mk 84 雙掛",
      "entries": [
        [
          "mk84",
          2,
          "inner"
        ]
      ],
      "sha256": "a91dcb46a18f125418e9d7fe5b18f79e7dc1a2e660ec9a0b868452ffaa0e3bbc"
    },
    {
      "index": 6,
      "name": "ROCAF：GBU-10 / Sniper",
      "entries": [
        [
          "gbu10",
          2,
          "mid"
        ],
        [
          "sniper",
          1,
          "chin",
          1
        ]
      ],
      "sha256": "baffefaaf76da2ee21872aa70c1ca9b72c60b43f91fa25d5dcc4f9b6dc8f67ec"
    },
    {
      "index": 7,
      "name": "ROCAF：GBU-12 / Sniper",
      "entries": [
        [
          "gbu12",
          2,
          "inner"
        ],
        [
          "sniper",
          1,
          "chin",
          1
        ]
      ],
      "sha256": "bc5664dd746e53e8af4a6c1ba2f63141991137d539e0cef9dfe312ff971d3f02"
    }
  ],
  "a10a": [
    {
      "index": 7,
      "name": "GBU-12 / Sniper",
      "entries": [
        [
          "gbu12",
          1,
          "p5"
        ],
        [
          "gbu12",
          1,
          "p7"
        ],
        [
          "sniper",
          1,
          "p10"
        ]
      ],
      "sha256": "c9c5ba70905c1bb2cfdc2cf1050e3b3c0e6eca51a3c2a6de1d2bb020659cc165"
    },
    {
      "index": 8,
      "name": "GBU-12 / LITENING",
      "entries": [
        [
          "gbu12",
          1,
          "p5"
        ],
        [
          "gbu12",
          1,
          "p7"
        ],
        [
          "litening",
          1,
          "p10"
        ]
      ],
      "sha256": "be38a1811451f2c1796cc94fd386dbc47da1654855291baa200f41bc2a0e7386"
    },
    {
      "index": 9,
      "name": "GBU-10 / LITENING",
      "entries": [
        [
          "gbu10",
          1,
          "p4"
        ],
        [
          "gbu10",
          1,
          "p8"
        ],
        [
          "litening",
          1,
          "p10"
        ]
      ],
      "sha256": "0febb90f86a352d2c0536a9f4832dab104f8f0f653f15834e93d70673b3d9c6b"
    }
  ]
};
export const R7_R4M_STORE = {
  "name": "R4M 火箭",
  "kind": "rocket",
  "mass": 3.85,
  "len": 0.81,
  "d": 0.055,
  "tailFins": 0.24,
  "color": "#59604c",
  "dv": 525,
  "burn": 0.8,
  "life": 10,
  "spread": 6,
  "warhead": {
    "id": "he_55_r4m",
    "name": "55 mm R4M (HE)",
    "kind": "he",
    "caliber_mm": 55,
    "mass_kg": 0.52,
    "explosive_mass_kg": 1,
    "explosive_type": "hexogen"
  },
  "projectile_id": "he_55_r4m"
};
export const R7_R4M_SHELL = {
  "id": "he_55_r4m",
  "name": "55 mm R4M (HE)",
  "kind": "he",
  "caliber_mm": 55,
  "mass_kg": 0.52,
  "muzzle_velocity_ms": 525,
  "explosive_mass_kg": 1,
  "explosive_type": "hexogen",
  "penetrator_material": "steel",
  "length_mm": 810,
  "drag_coefficient": 0.4,
  "penetration_curve": [
    {
      "distance_m": 0,
      "pen_mm": 15.809542001748326
    },
    {
      "distance_m": 100,
      "pen_mm": 15.809542001748326
    },
    {
      "distance_m": 500,
      "pen_mm": 15.809542001748326
    },
    {
      "distance_m": 1000,
      "pen_mm": 15.809542001748326
    },
    {
      "distance_m": 1500,
      "pen_mm": 15.809542001748326
    },
    {
      "distance_m": 2000,
      "pen_mm": 15.809542001748326
    },
    {
      "distance_m": 2500,
      "pen_mm": 15.809542001748326
    }
  ],
  "ricochet_angle_deg": 79,
  "normalization_deg": 0,
  "fuse_delay_s": 0,
  "fuse_sensitivity_mm": 0.1
};
export const R8_R4M_HASHES = {
  "store": "ffc37ade002b30d64e7850598673c0fc1580177daa7315f75665acee752e1c99",
  "shell": "1a67ca6effc0946b8379396a0eef560bf03ae02803d5b1248cb29de899ea1891"
};

const sectionAnchors={
 primaryProjectileFillers:['  // BEGIN PRIMARY PROJECTILE FILLER CORRECTIONS','  // END PRIMARY PROJECTILE FILLER CORRECTIONS'],
 me262Sight:['/* TF_ME262_SIGHT_BEGIN */','/* TF_ME262_SIGHT_END */'],
 mig17Wing:['/* TF_MIG17_WING_BEGIN */','/* TF_MIG17_WING_END */'],
 aircraftCull:['/* TF_AIRCRAFT_CULL_BEGIN */','/* TF_AIRCRAFT_CULL_END */'],
 guidedAircraftVariants:['/* TF_GUIDED_AIRCRAFT_VARIANTS_BEGIN */','/* TF_GUIDED_AIRCRAFT_VARIANTS_END */'],
 modelUpgradePrelude:['  var FLIGHT_FIXED = ','  var aircraftGeometry = '],
 aircraftGeometry:['  var aircraftGeometry = (() => {','  // NF-01 gear'],
 AIRCRAFT_TYPES:['  var AIRCRAFT_TYPES = {','  // ---- hangar fighters'],
 fightersAndTypeConstruction:['  var AIR_FIGHTERS = {','  // Optional flight diagnostics'],
 registerAndDecodeModels:['  function registerAircraftFrame(','  function aircraftInstrumentMeta('],
 aircraftInstrumentMeta:['  function aircraftInstrumentMeta(','  /**\n   * A model\'s cockpit'],
 applyAircraftRebuilds:['  function applyAircraftRebuilds(','  async function decodePilotModel('],
 configureAircraftSurfaces:['  function configureAircraftSurfaces(','  /** Instruments read accepted flight/resource state'],
 bulletShell:['  function bulletShell(mg,','  function shellDef('],
 guns:['    const M61_DEF = ','    /**\n     * Gunnery aim'],
 syncPodGuns:['    function syncPodGuns(air)','    function stepAircraftGuns(dt)'],
 storeDefinitions:['    const AIR_STORE_DEFS = ','    /**\n     * Each weapon\'s four separate states'],
 registerMountedStoreModels:['    TFMountedDetails.register(AIR_STORE_DEFS, data.storeModels);','    const WEAPON_STATUS = '],
 tntEquivalentKg:['  var RE_FACTOR = ','  function tntCharge('],
 weaponStatusCompatibilityLoadouts:['    const WEAPON_STATUS = ','    /**\n     * Fire-control radars'],
 airStationsAndMountPosition:['    function airStations(T)','/* TF_MODEL_HARDPOINTS_BEGIN */'],
 modelHardpoints:['/* TF_MODEL_HARDPOINTS_BEGIN */','/* TF_MODEL_HARDPOINTS_END */'],
 layoutStores:['    function layoutStores(','    /**\n     * Custom armament'],
 slotsAndCustomLoadout:['    const SLOT_ORDER = ','    const storeMeshes = '],
 storeSocket:['  const storeSocket = ','  function partVertices('],
 airWingSplit:['  function airWingSplit(T)','  /** The planes that separate'],
 fuel:['    const AIR_FUEL = {','    // TF_AIRCRAFT_FUEL_LOAD_CONTROLLER'],
 aircraftRadarDefinitions:['    const AIR_RADARS = ','    const RADAR_SCALES = '],
 aircraftSensorDefinitions:['    const AIR_EQUIP = ','    const SEEKER_DEFAULTS = '],
 storeWarhead:['    function storeWarhead(def)','    /**\n     * Station points of a type'],
 'Aircraft.spawn':['    spawn(x, y, z, heading, airspeed = 0, onGround = true) {','      this.api.spawn(x, y, z, heading, airspeed, onGround ? 1 : 0);'],
};
function once(source,oldText,newText,label){assert.equal(source.split(oldText).length,2,label+' exact allowed edit appears once');return source.replace(oldText,newText);}
/** Reverse only the source-pinned R8.2 100% fuel reference/presentation migration.
 * The R8.1 helper and its R7 non-HTML controller pins below remain authoritative;
 * aircraft fuel capacities, flow laws, physics, guns and loadouts are untouched.
 */
export function normalizeReviewedFullThrottleFuelSource(text){
 assert.equal(digest(text),'41469e40501e58992631f7a7a57d94a8ffd9628526e0182d15c50a8f5c00deb4','Exact reviewed R8.2 full-throttle fuel helper');
 const edits=[
  ['// Internal fuel choices use 100% dry throttle (1.0, without afterburner).','// Internal fuel choices reuse the existing native AI cruise reference (0.65).'],
  ["const nominalFlowKgS=typeof flow==='function'?flow(1):NaN;","const nominalFlowKgS=typeof flow==='function'?flow(.65):NaN;"],
  ['return Object.freeze({capacityKg,nominalFlowKgS,referenceThrottle:1});','return Object.freeze({capacityKg,nominalFlowKgS,referenceThrottle:.65});'],
  ['  const compatible=capability=>capability?.version===1&&capability.reference_throttle===1;\n  function intent(game,id,capability){return compatible(capability)?{fuel_minutes:selected(game,id)}:{};}',
   '  function intent(game,id,capability){return capability?.version===1?{fuel_minutes:selected(game,id)}:{};}'],
  ["function html(game,id,source,enabled=true,language='zh',unavailableReason=null){","function html(game,id,source,enabled=true,language='zh'){"],
  ["const label=en?'Internal endurance at 100% throttle':'内油可飞行时长（100%节流阀）',full=en?`Full (${fullMinutes} minutes at 100% throttle)`:`满油（约${fullMinutes}分钟，100%节流阀）`;",
   "const label=en?'Internal cruise endurance':'内油可飞行时长',full=en?`Full (${fullMinutes} minutes)`:`满油（约${fullMinutes}分钟）`;"],
  ["const note=en?'At 100% throttle, without afterburner; actual consumption follows throttle. External tanks unchanged.':'按100%节流阀、不加力估算；实际消耗随油门变化。外挂副油箱不变。';",
   "const note=en?'Nominal cruise at 65% throttle; actual consumption follows throttle. External tanks unchanged.':'按65%巡航油门估算；实际消耗随油门变化。外挂副油箱不变。';"],
  ["const unavailable=!enabled?(unavailableReason||(en?' Server supports full fuel only.':' 当前服务器只支持满油。')):'';",
   "const unavailable=!enabled?(en?' Server supports full fuel only.':' 当前服务器只支持满油。'):'';"],
  ['const endurance=en?`Endurance at 100% throttle: ${carriedMinutes} minutes`:`100%节流阀预计可飞行 ${carriedMinutes} 分钟`;',
   'const endurance=en?`Estimated endurance: ${carriedMinutes} minutes`:`预计可飞行 ${carriedMinutes} 分钟`;'],
  ['const shownSpec=id=>{const host=capability(id);return native()&&compatible(host)?spec(host.capacity_kg,()=>host.nominal_flow_kg_s):sourceSpec(id);};',
   'const shownSpec=id=>{const host=capability(id);return native()&&host?.version===1?spec(host.capacity_kg,()=>host.nominal_flow_kg_s):sourceSpec(id);};'],
  ["    const unavailableReason=id=>{\n      const host=capability(id);if(!native()||host?.version!==1||compatible(host))return null;\n      const known=Number.isFinite(host.reference_throttle),percent=known?Number((host.reference_throttle*100).toFixed(1)):null;\n      return language()==='en'?` Server fuel reference is ${known?percent+'% throttle':'unknown'}; update the server to use 100% fuel choices. Endurance shown uses the local source at 100% throttle.`:` 当前服务器燃油基准为${known?percent+'%节流阀':'未知'}；请更新服务器以使用100%燃油选择。所示时长按本地来源的100%节流阀计算。`;\n    };\n",''],
  ['if(native()&&!compatible(capability(id)))return;','if(native()&&capability(id)?.version!==1)return;'],
  ['htmlFor:id=>html(game,id,shownSpec(id),!native()||compatible(capability(id)),language(),unavailableReason(id)),',
   'htmlFor:id=>html(game,id,shownSpec(id),!native()||capability(id)?.version===1,language()),']
 ];
 for(const [current,previous]of edits)text=once(text,current,previous,'Reviewed R8.2 fuel migration');
 assert.equal(digest(text),'3ca46ffe6a6c202d831f382859b6a40c5433705075cc19e1e309e41a2ea2f5a5','R8.2 inverse migration reproduces the exact frozen R8.1 fuel helper');
 return text;
}
/** Remove only the reviewed visual lifecycle hook, then retain the old physical hash. */
export function normalizeReviewedSpawnSource(text){
 const normalized=once(text,'      this._airVortexLife=(this._airVortexLife||0)+1;if(typeof TFAirVortex!=="undefined")TFAirVortex.remove(this);\n','','Reviewed vortex visual lifecycle reset');
 assert.equal(digest(normalized),baseline.baselineSource.sections['Aircraft.spawn'].sha256,'Physical spawn configuration stays byte-identical after only the approved visual hook');
 return normalized;
}
function countermeasureContract(fresh,app){
 const startMarker='    const AIR_CM = {',endMarker='    /**\n     * Where the radar';
 assert.equal(app.split(startMarker).length,2,'One actual countermeasure capacity table');
 const start=app.indexOf(startMarker),end=app.indexOf(endMarker,start);assert.ok(end>start,'Countermeasure source bounds');
 const text=app.slice(start,end),section={startLine:app.slice(0,start).split('\n').length,sha256:digest(text)};
 assert.equal(section.sha256,'7083921e22671983f5ae50fed815001b2f9abbe70315809a7793be63bac51297','Exact reviewed capacity table and variant-inheritance call');
 assert.deepEqual(fresh.source.sections.aircraftCountermeasureDefinitions,section,'Countermeasure export binds the actual source span');
 const variantStart=app.indexOf('/* TF_GUIDED_AIRCRAFT_VARIANTS_BEGIN */'),variantEnd=app.indexOf('/* TF_GUIDED_AIRCRAFT_VARIANTS_END */',variantStart);
 assert.ok(variantStart>=0&&variantEnd>variantStart,'Actual variant inheritance source bounds');
 const context=vm.createContext({});vm.runInContext(app.slice(variantStart,variantEnd)+text+'\nglobalThis.capacities=AIR_CM;',context);
 const capacities=JSON.parse(JSON.stringify(context.capacities));
 assert.deepEqual(capacities,{f16v:{flares:30,chaff:60},a10a:{flares:120,chaff:240},su25:{flares:192,chaff:64},nf02:{flares:30,chaff:30},f4e:{flares:30,chaff:30},f15c:{flares:60,chaff:60},mig29:{flares:30,chaff:30},su27:{flares:48,chaff:48},su27skm:{flares:48,chaff:48},mig29smt:{flares:30,chaff:30}},'Only reviewed source capacities and exact variant inheritance');
 const legacySensors={};
 for(const[id,a]of Object.entries(fresh.aircraft)){
  assert.ok(Object.hasOwn(a.sensors,'countermeasures'),id+' explicit additive sensor member');
  assert.deepEqual(a.sensors.countermeasures,capacities[id]||{flares:0,chaff:0},id+' source countermeasure capacity');
  const sensors=structuredClone(a.sensors);delete sensors.countermeasures;legacySensors[id]=sensors;
 }
 return {section,legacySensors};
}
/** Validate the one additive R8.1 sensor field before checking frozen R7 hashes. */
export function assertCountermeasureExportContract(fresh,appPath=new URL('handoff/bundle/app.js.html',root)){
 return countermeasureContract(fresh,fs.readFileSync(appPath,'utf8')).legacySensors;
}
function sourceContract(fresh){
 const app=fs.readFileSync(new URL('handoff/bundle/app.js.html',root),'utf8'),helperBytes=fs.readFileSync(new URL('handoff/tools/historical_aircraft_loadouts.js',root)),helper=helperBytes.toString('utf8').trim();
 assert.equal(digest(helperBytes),HELPER_SHA256,'Reviewed R8 historical helper body is exact');
 assert.equal(app.split(helper).length,2,'Actual app embeds the reviewed helper exactly once');
 const fuelBytes=fs.readFileSync(new URL('handoff/tools/aircraft_fuel_load.js',root)),fuelHelper=fuelBytes.toString('utf8');
 const historicalFuelHelper=normalizeReviewedFullThrottleFuelSource(fuelHelper);
 assert.equal(app.split(fuelHelper.trim()).length,2,'Actual app embeds the exact source fuel UI helper');
 const htmlAt=historicalFuelHelper.indexOf('  function html('),createAt=historicalFuelHelper.indexOf('  function create(');assert.ok(htmlAt>=0&&createAt>htmlAt,'Fuel UI extraction boundaries');
 assert.equal(digest(historicalFuelHelper.slice(0,htmlAt)+historicalFuelHelper.slice(createAt)),'bf11fb5bcc0c2602d411a59fb41fe6e0979ce5f20d378656089ee70c7a2cecf5','Fuel normalize/spec/load/selection/intent/initialization/controller methods retain the R7 bytes after only the exact R8.2 migration');
 const context=vm.createContext({});vm.runInContext(helper,context);
 assert.deepEqual(JSON.parse(JSON.stringify(context.TFHistoricalAircraftLoadouts.presets)),Object.fromEntries(Object.entries(R8_PRESETS).map(([id,rows])=>[id,rows.map(r=>[r.name,r.entries])])),'Exactly the 12 reviewed source configurations');
 const cm=countermeasureContract(fresh,app);
 assert.deepEqual(Object.keys(fresh.source.sections).sort(),[...Object.keys(baseline.baselineSource.sections),'aircraftCountermeasureDefinitions'].sort(),'Every original source section plus only the reviewed countermeasure table');
 const actualSections={aircraftCountermeasureDefinitions:cm.section};
 for(const [name,old]of Object.entries(baseline.baselineSource.sections)){
  let text,start;
  if(name==='aircraftResources'){
   text=fs.readFileSync(new URL(old.path,root),'utf8');actualSections[name]={path:old.path,sha256:digest(text)};
  }else{
   if(['AIR_PARTS','AIR_SKIN','AIR_PARTS_JET','AIR_SKIN_JET'].includes(name)){
    start=app.indexOf(`  var ${name} = [`);const end=app.indexOf('\n  ];',start)+5;assert.ok(start>=0&&end>start,name+' source bounds');text=app.slice(start,end);
   }else if(name==='loadFlightCore'){
    const control=app.match(/api\.configure_control\(([^)]+)\);/);assert.ok(control);text=control[0];start=app.indexOf(text);
   }else{
    const anchors=sectionAnchors[name];assert.ok(anchors,name+' has an explicit actual-source binding');start=app.indexOf(anchors[0]);const end=app.indexOf(anchors[1],start);assert.ok(start>=0&&end>start,name+' actual source section');text=app.slice(start,end);
   }
   actualSections[name]={startLine:app.slice(0,start).split('\n').length,sha256:digest(text)};
  }
  let normalized=normalizeConventionalSourceSection(name,text,app);
  if(name==='storeDefinitions')normalized=once(normalized,helper+'\n    TFHistoricalAircraftLoadouts.correctStoreDefinitions(AIR_STORE_DEFS);\n','','R4M correction helper/call');
  if(name==='weaponStatusCompatibilityLoadouts')normalized=once(normalized,'\n    TFHistoricalAircraftLoadouts.installLoadouts(AIR_LOADOUTS, AIRCRAFT_TYPES);','','Historical append call');
  if(name==='Aircraft.spawn')normalized=normalizeReviewedSpawnSource(normalized);
  if(name==='slotsAndCustomLoadout'){
   normalized=once(normalized,'for (const [, items] of AIR_LOADOUTS[typeId] || []) for (const [id2, n, station, only] of items) {','for (const [, items] of AIR_LOADOUTS[typeId] || []) for (const [id2, n, station] of items) {','Explicit side tuple');
   normalized=once(normalized,'const sides = only == null ? station === "center" ? [0] : [-1, 1] : [only], per = only != null || station === "center" ? n : Math.ceil(n / 2);','const sides = station === "center" ? [0] : [-1, 1], per = station === "center" ? n : Math.ceil(n / 2);','Explicit right-only carrier');
  }
  assert.equal(digest(normalized),old.sha256,name+' unchanged R7 body after only declared R8 edits');
 }
 assert.deepEqual(fresh.source,{...baseline.baselineSource,appSha256:digest(app),sections:actualSections},'Actual current source app, kernel, helpers and exact export provenance');
 return cm.legacySensors;
}

/** Strict validation returns a separately cloned R7 weapon view for legacy aggregate gates. */
export function assertR8HistoricalExportContract(fresh,migration,originalIds,allIds){
 fresh=normalizeConventionalProfile(fresh);
 const legacySensors=sourceContract(fresh);
 assert.deepEqual(Object.keys(fresh.aircraft).sort(),allIds);
 assert.equal(hash(R7_R4M_STORE),baseline.storeHashes.r4m,'Frozen old rocket definition authenticity');
 assert.equal(hash(R7_R4M_SHELL),baseline.shellHashes.he_55_r4m,'Frozen old derived shell authenticity');
 const r4m=fresh.storeDefinitions.r4m,shell=fresh.shells.he_55_r4m;
 assert.equal(hash(r4m),R8_R4M_HASHES.store,'Only approved R4M definition correction');assert.equal(hash(shell),R8_R4M_HASHES.shell,'Only approved R4M derived shell correction');
 assert.equal(r4m.mass,3.85);assert.equal(r4m.warhead.mass_kg,3.85);assert.equal(r4m.warhead.explosive_mass_kg,0.52);assert.equal(shell.mass_kg,3.85);assert.equal(shell.explosive_mass_kg,0.52);
 const weaponView={storeDefinitions:structuredClone(fresh.storeDefinitions),shells:structuredClone(fresh.shells)};
 weaponView.storeDefinitions.r4m=structuredClone(R7_R4M_STORE);weaponView.shells.he_55_r4m=structuredClone(R7_R4M_SHELL);
 for(const [name,values,pins]of [['storeDefinitions',weaponView.storeDefinitions,baseline.storeHashes],['shells',weaponView.shells,baseline.shellHashes]]){
  assert.deepEqual(Object.keys(values).sort(),Object.keys(pins).sort(),name+' no new weapon definitions');for(const [id,pin]of Object.entries(pins))assert.equal(hash(values[id]),pin,name+'/'+id+' original R7 value except approved R4M role correction');
 }
 let prefixCount=0,addedCount=0,originalCount=0;
 for(const [id,old]of Object.entries(baseline.aircraft)){
  const a=fresh.aircraft[id],added=R8_PRESETS[id]||[];
  for(const [field,pin]of Object.entries(old.hashes))assert.equal(hash(field==='sensors'?legacySensors[id]:a[field]),pin,id+'/'+field+' immutable R7 contract');
  assert.equal(hash(a.stores.slots.map(s=>[s.key,s.options])),old.slotsSha256,id+' no new compatibility');assert.equal(hash(a.stores.slotItems),old.slotItemsSha256,id+' every exact existing custom mount');
  assert.equal(a.stores.loadouts.length,old.loadouts.length+added.length,id+' only explicitly reviewed appended presets');
  const oldSlots=structuredClone(a.stores.slots);
  for(const [key,transition]of Object.entries(SLOT_DEFAULT_TRANSITIONS[id]||{})){
   const slot=oldSlots.find(s=>s.key===key);assert.ok(slot,id+'/'+key+' is an existing slot');assert.deepEqual(slot.defaultCounts,transition.after,id+'/'+key+' only exact appended-preset default counts');
   if(transition.beforePresent)slot.defaultCounts=structuredClone(transition.before);else delete slot.defaultCounts;
  }
  assert.equal(hash({...a.stores,slots:oldSlots,loadouts:a.stores.loadouts.slice(0,old.loadouts.length)}),R7_STORES_HASHES[id],id+' entire immutable R7 stores before exactly the append and its inferred count defaults');
  for(const lo of old.loadouts){assert.equal(hash(a.stores.loadouts[lo.index]),lo.sha256,id+'/'+lo.index+' original R7 prefix');prefixCount++;}
  for(let i=0;i<added.length;i++){const lo=a.stores.loadouts[old.loadouts.length+i],expected=added[i];assert.equal(lo.index,expected.index);assert.equal(lo.name,expected.name);assert.deepEqual(lo.entries,expected.entries);assert.equal(hash(lo),expected.sha256,id+'/'+lo.index+' exact approved new preset');addedCount++;}
 }
 const projectPreset=l=>JSON.parse(JSON.stringify({index:l.index,name:l.name,entries:l.entries,items:l.items.map(i=>Object.fromEntries(['id','count','station','side'].filter(k=>Object.hasOwn(i,k)).map(k=>[k,i[k]]))),gunPodsSha256:oldHash(l.gunPods)}));
 for(const id of originalIds){const a=fresh.aircraft[id],old=migration.originals[id],r7Count=baseline.aircraft[id].loadouts.length;
  for(const field of ['physics','guns','fuel','metadata'])assert.equal(oldHash(a[field]),old.fields[field],id+'/'+field+' original26 contract');
  for(let i=0;i<old.presets.length;i++)assert.deepEqual(projectPreset(a.stores.loadouts[i]),old.presets[i],id+'/'+i+' original93 preset');
  assert.deepEqual(a.stores.loadouts.slice(old.presets.length,r7Count).map(projectPreset),migration.appendedPresets[id]||[],id+' only declared R7 additions before R8');
  assert.equal(oldHash(legacySensors[id]),old.newSensorsSha256,id+' source-bound V4 sensors before the independently verified additive CM member');
  originalCount+=old.presets.length;
 }
 assert.equal(originalCount,93);assert.equal(prefixCount,106);assert.equal(addedCount,12);
 for(const [key,pin]of Object.entries(migration.newTopLevel))assert.equal(oldHash(fresh[key]),pin.sha256,key+' unrelated native rule metadata');
 return weaponView;
}

const R7_STORES_HASHES = {
  "nf01": "7cfd8d120ea0cc55e0a53a294473d99fb9be2a6ecca78a09dac5e07c527818ca",
  "nf02": "a7459d9bcc17f63c49c5e0dbab70ae3052aa2d9addfb5a32292c320307c6e646",
  "p51d": "402eef17306b16121daaef093304e53c1ba2e3f020dc532e8ce24b9b986bb33d",
  "bf109g": "038569a76ed35257f5c374ab051be2dc6649d65037386d0fbe8ab5102a289cf6",
  "spitfire9": "a29397ac8a6d96a6f3342f95ee28339a7b939c5546b7113e6c5f4e44542fc237",
  "mig15": "90c63407ee01404c49702bf6e34bdeedc81a3757a366129d4126ab83f7ffc2ff",
  "f86f": "a9077f4a1144e6da87f107bddc6aafa690a722cc1566a07a37003b591a1ed808",
  "f104g": "e1e63423b0ba90cb52feab52f13baf67fd748e0d78dc83ec9de5898ec0ae2c9a",
  "mig21": "0cd8290fa84377bd3d38de3bef74c61fc1be6161901f06ce65875409f7a1d0f5",
  "fw190a8": "a518ea11130c159f1fe89162b52a4b96e9a40cd776757f285d20d1c47d4e0f46",
  "yak9u": "2404550acda0c5b262bd117442c2c647c98d481673bd7dcfb78a2c3a4728a205",
  "a6m2": "7b9822c8efc51766a66d25f6c46a0842c46f78ba03b5dccc548fde601fa0694a",
  "f4u1d": "20213239e3ad9686e596836d6ff2b95428f820fe08879865f9a07a95c5a3116a",
  "me262": "c1eaa9b15cc38e33ea88aff3695ef09edbf5facc469d0f6c9d361601fdc77d52",
  "hunter6": "a8467ff5abe0430b326e14d76574f60386f864594eaa82d45b22d781946dfde3",
  "mig17f": "585c036e0a04bb7a77b1135413beac96c489309becb35d1a033ab7511e44bd74",
  "mirage3e": "661ea2ddd0ae181490ed2b9e51204543015742b8efd113fcab03714a6a585d4d",
  "f4e": "4635d3fe975e97aac3bb128a44cbe7478ff4c084b8daf6df95c2ce1fd6617cb2",
  "f15c": "bd37b4b75a549e624afd3d3e15cc992064ea43afdb9b7f9561f45efd61611c5c",
  "mig29": "f87ecdbb5d6d2d25007ffc76824a6ecab6a62679f3dbc1967803b8b4ba21e2c7",
  "f16v": "35bf3e1e395382494eb4fdb8be8b4bba6ed016512f70dc8106cf0e9666948464",
  "su27": "35d17cd1779851ee173a5984dfee70fe200fdc8a67081fc3d013bd0fc1f01404",
  "a10a": "ca494be2e60e51ad884a6aaf72e38577e90f1941f8c3ba9e8849162e49e8982c",
  "su25": "c04a45b426c93c66ea8e6c9ac39b2bb8e030dcca6ec5c7a120e825faa5a13b77",
  "me262a2a": "ffc4f8d60bc463cf52b7bf78c5128498d58057c4467466fda8e9ae088e4360aa",
  "me262u4": "3addac23f78da0505b75b201778ff9f1b3a7e2f3c3ad664f14af1e4c553b5cd6",
  "su27skm": "aa95a99adcfb5b7850b521c8385406021b2899e98682653c2484199b7bef8ea8",
  "mig29smt": "6c96bb62575708ef260a36f1c9c2ba3515525480492e4abebec38f80c41d968b"
};

// Only defaults inferred from the exact appended existing-option presets may differ.
const SLOT_DEFAULT_TRANSITIONS = {
  "mig21": {
    "outer:-1": {
      "beforePresent": false,
      "before": null,
      "after": {
        "r3s": 1,
        "ub16": 1,
        "fab250": 1
      }
    },
    "outer:1": {
      "beforePresent": false,
      "before": null,
      "after": {
        "r3s": 1,
        "ub16": 1,
        "fab250": 1
      }
    }
  },
  "f15c": {
    "inner:-1": {
      "beforePresent": true,
      "before": {
        "mk82": 2,
        "agm65b": 1,
        "agm65d": 1,
        "agm65g": 1
      },
      "after": {
        "mk82": 2,
        "agm65b": 1,
        "agm65d": 1,
        "agm65g": 1,
        "gbu10": 1,
        "gbu12": 1,
        "cbu87": 1
      }
    },
    "inner:1": {
      "beforePresent": true,
      "before": {
        "mk82": 2,
        "agm65b": 1,
        "agm65d": 1,
        "agm65g": 1
      },
      "after": {
        "mk82": 2,
        "agm65b": 1,
        "agm65d": 1,
        "agm65g": 1,
        "gbu10": 1,
        "gbu12": 1,
        "cbu87": 1
      }
    }
  },
  "f16v": {
    "mid:-1": {
      "beforePresent": true,
      "before": {
        "aim9x": 1,
        "agm65g": 1
      },
      "after": {
        "aim9x": 1,
        "agm65g": 1,
        "gbu10": 1
      }
    },
    "inner:-1": {
      "beforePresent": true,
      "before": {
        "mk82": 1,
        "gbu12": 1
      },
      "after": {
        "mk82": 1,
        "gbu12": 1,
        "mk84": 1
      }
    },
    "chin:1": {
      "beforePresent": false,
      "before": null,
      "after": {
        "sniper": 1
      }
    },
    "inner:1": {
      "beforePresent": true,
      "before": {
        "mk82": 1,
        "gbu12": 1
      },
      "after": {
        "mk82": 1,
        "gbu12": 1,
        "mk84": 1
      }
    },
    "mid:1": {
      "beforePresent": true,
      "before": {
        "aim9x": 1,
        "agm65g": 1
      },
      "after": {
        "aim9x": 1,
        "agm65g": 1,
        "gbu10": 1
      }
    }
  }
};

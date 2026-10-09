// TankForge: pick a data-defined tank in the garage, then drive it on the range, look around it,
// and shoot through its sight.
// Display layer only. The simulation under ./sim mirrors the Rust crates until the WASM build
// replaces it. Online (game/net.js), the server (crates/server) keeps the hit points, kills and
// respawns; this side only says which plate its own shells struck.
import { Renderer, QUALITY, QUALITY_ORDER, TIMES } from './gfx/renderer.js';
import { hexToLinear } from './gfx/geo.js';
import { Node, mul, translation, rotX, rotZ, perspective, lookAtLH, project } from './gfx/math.js';
import { buildTank } from './gfx/tankmodel.js';
import { buildInterior, setCrewModel } from './gfx/interior.js';
import { animateCrew } from './game/crewanim.js';
import { setMgModels } from './gfx/mgmodel.js';
import { buildWorld, terrainAt, humpLift, groundHit, groundRay, hitTargets, DUST_COLOR, GARAGE, ZONES, HUMP_LANES, COURSE } from './game/world.js';
import { setActiveMap } from './game/relief.js';
import { loadBattleMap, FORD_DEPTH } from './game/battlemap.js';
import { buildMapWorld } from './game/mapworld.js';
import { Enemy, RESULT_LABEL, useCombat, combatHit } from './game/enemies.js';
import { Combat, bulletShell, EVENT_NAME, CREW_NAME, arr3, emptyRacks } from './game/combat.js';
import { HitCam } from './game/hitcam.js';
import { designReplayReport } from './game/projectileReplay.js';
import { Missiles } from './game/missiles.js';
import { OnlineLaunches } from './game/onlineLaunch.js';
import { Mods } from './game/mods.js';
import { Exhaust, exhaustOf } from './game/exhaust.js';
import { LANG, LANG_INDEX, setLang } from './i18n.js';
import { Protection } from './game/protection.js';
import { NetClient, SEND_HZ } from './game/net.js';
import { LobbyUi } from './game/lobbyui.js';
import { DeployScreen, applyAmmo, loadAmmoConfig } from './game/deploy.js';
import { Conquest, captureMessage } from './game/conquest.js';
import { Terrain, CHUNK, N as DEFORM_N } from './game/terrain.js';
import { VehicleSim } from './game/vehicle.js';
import { hullTilt } from './sim/tank/tank.js';
import { PhysDebug } from './game/physdebug.js';
import { RenderScale } from './gfx/renderscale.js';
import { Effects, advanceGunRecoil } from './game/fx.js';
import { Sound } from './game/audio.js';
import { Hud, penAt } from './game/hud.js';
import { statusViewDistance } from './game/statusview.js';
import { nextSightWeapon, machineGunTrigger, ammoKeyIndex } from './game/weaponselection.js';
import { smoothFold, foldDepression, foldYawLimit, foldedPlate } from './game/folding.js';
import { sightProjection } from './game/optics.js';
import { Workshop } from './game/workshop.js';
import { makeLoadout, buildToBundle, exportFolder, checkFolder, generatedTurretParts, reloadTime, depressionAt, PRESETS, syncGunShell, nextAmmo, refillBelt, roundsLeft, refillLauncher, launcherMount, fireLauncherRound, tickLauncher } from './game/loadout.js';
import { Bureau, storage as designStore } from './design/bureau.js';
import { newDesign, arrange } from './design/templates.js';
import { ringHeight } from './design/gen.js';
import { loadCore } from './design/core.js';
import { TestRange } from './game/testrange.js';
import { setShellSheet } from './game/shellicons.js';
import * as phys from './sim/physics.js';
import * as gunnery from './sim/gunnery.js';
import * as ballistics from './sim/ballistics.js';
import * as loading from './sim/loading.js';
import * as mgSim from './sim/mg.js';
import { Rng } from './sim/rng.js';

const DEG = Math.PI / 180;
const SIM_DT = 1 / 120;
const THIRD_FOV = 50 * DEG;
const THIRD_ZOOM_FOV = 22 * DEG;
const GARAGE_FOV = 34 * DEG;
const GARAGE_MAX_DIST = 22; // the shed stands further back than this, so the view never ends up inside it
// how hard firing rocks the hull on its springs (1 = the recoil impulse as it is); the hull's
// rocking carries an unstabilized gun with it, so this is not exaggerated
const RECOIL_ROCK = 1.0;
const DUSTINESS = { road: 0.15, grass: 0.45, dirt: 1.0, mud: 0.5, sand: 1.0, snow: 0.8 };
// what the running gear picks up from each surface, and how much of it sticks
const MUD_HEX = { road: '#5a5448', grass: '#4d4630', dirt: '#5e4a33', mud: '#3d3023', sand: '#a08a5e', snow: '#c9ccd0' };
const MUD_AMOUNT = { road: 0.25, grass: 0.5, dirt: 0.7, mud: 1.0, sand: 0.6, snow: 0.7 };
// Pixel-art look is an option on top of the realistic renderer: block size in CSS pixels and
// the number of brightness bands for each setting.
const PIXEL_MODES = [0, 2, 3, 4];
const PIXEL_LEVELS = [0, 28, 18, 12];
const PIXEL_LABEL = ['關', '細', '中', '粗'];
const MAX_ZERO = 3000;
const STORE_BUILD = 'tankforge.build.v1';
const STORE_PIXEL = 'tankforge.pixel.v2';
const STORE_QUALITY = 'tankforge.quality.v1';
const STORE_TIME = 'tankforge.time.v1';
const STORE_VEHICLE = 'tankforge.vehicle.v1';
const STORE_MODS = 'tankforge.mods.v1';
const STORE_MAP = 'tankforge.map.v1';
// picture cards: the camera's horizontal half-angle, and how hard a machine-gun bullet is stepped
const THUMB_TAN = Math.tan(13 * DEG);
const BULLET_DT = 1 / 120;
// tracer colour and width by kind of round: the sub-calibre cores burn thinner and whiter
const TRACER = {
  ap: [[1.0, 0.5, 0.18], 1],
  apc: [[1.0, 0.5, 0.18], 1],
  apcbc: [[1.0, 0.45, 0.16], 1],
  aphe: [[1.0, 0.4, 0.14], 1],
  apcr: [[1.0, 0.85, 0.6], 0.7],
  apds: [[1.0, 0.9, 0.7], 0.6],
  apfsds: [[1.0, 0.9, 0.75], 0.55],
  he: [[1.0, 0.62, 0.22], 1.2],
  heat: [[1.0, 0.72, 0.3], 1.1],
  heat_fs: [[1.0, 0.72, 0.3], 1.1],
  hesh: [[1.0, 0.62, 0.22], 1.2],
};

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const hashText = (t) => {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
};
const dirFrom = (yaw, pitch) => [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
const NATION_NAME = { germany: '德國', ussr: '蘇聯', usa: '美國', uk: '英國', fictional: '原創' };
const CLASS_NAME = { spg: '自走炮', light: '輕型', medium: '中型', heavy: '重型', td: '殲擊車', tank_destroyer: '殲擊車', armored_car: '裝甲車', armoured_car: '裝甲車', prototype: '原型', spaa: '防空' };
/** The rounds each vehicle carries, as chosen on the deploy screen (vehicle id -> per gun). */
const AMMO_CFG = loadAmmoConfig();
const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage is a convenience only */
    }
  },
};

export function start(data, saved = {}) {
  setShellSheet(data.images?.shell_icons);
  setCrewModel(data.crewModel);
  setMgModels(data.mgModels);
  const canvas = document.getElementById('view');
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const storedQuality = store.get(STORE_QUALITY);
  const renderer = new Renderer(canvas, { quality: QUALITY[storedQuality] ? storedQuality : coarse ? 'medium' : 'high', noiseSize: coarse ? 64 : 128 });
  renderer.setTime(Number(store.get(STORE_TIME)) || 0);
  // the GPU can drop the context (driver reset, a phone reclaiming memory): the game keeps running,
  // a notice covers the picture, the renderer rebuilds everything when the context comes back, and
  // only if that fails (or takes too long) is reloading offered -- never done without asking
  const gpuNotice = document.createElement('div');
  gpuNotice.id = 'gpu-notice';
  gpuNotice.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;gap:12px;background:rgba(10,12,14,0.82);color:#e9e6da;font:15px system-ui,sans-serif;z-index:9999;text-align:center;padding:16px';
  const gpuText = document.createElement('div');
  const gpuReload = document.createElement('button');
  gpuReload.textContent = '重新載入';
  gpuReload.style.cssText = 'display:none;padding:8px 18px;font:inherit;background:#3d4a3a;color:#e9e6da;border:1px solid #6d7a5f;border-radius:4px;cursor:pointer';
  gpuReload.onclick = () => location.reload();
  gpuNotice.append(gpuText, gpuReload);
  document.body.appendChild(gpuNotice);
  let gpuTimer = 0;
  const gpuShow = (text, reload) => {
    gpuText.textContent = text;
    gpuReload.style.display = reload ? '' : 'none';
    gpuNotice.style.display = 'flex';
  };
  renderer.onContextLost = () => {
    gpuShow('圖形裝置已重設，正在恢復畫面……', false);
    clearTimeout(gpuTimer);
    gpuTimer = setTimeout(() => renderer.lost && gpuShow('畫面恢復時間較長。可繼續等待，或重新載入。', true), 10000);
  };
  renderer.onContextRestored = (ok) => {
    clearTimeout(gpuTimer);
    deformSlots.clear(); // the rut window is streamed: send it all again
    if (ok) gpuNotice.style.display = 'none';
    else gpuShow('畫面無法恢復，請重新載入。', true);
  };
  const fx = new Effects();
  const sound = new Sound();
  sound.loadSamples(data.sfx);
  const world = buildWorld(renderer);
  const terrain = new Terrain(data.terrains, humpLift);
  const groundAt = (x, z) => terrain.height(x, z);
  /** The range's paper targets (none on a battle map). */
  const rangeTargets = () => (G.map ? [] : world.targets);
  /** Dust thrown up where something lands: soil of the ground there, or spray off water. */
  const impactColor = (pt) => (G.map && G.map.waterDepth(pt[0], pt[2]) > 0.05 ? [0.8, 0.86, 0.9] : DUST_COLOR[terrainAt(pt[0], pt[2])]);
  /** What a ray or a shell meets: the ground, or the water over it on a battle map. */
  const surfaceAt = (x, z) => (G.map ? Math.max(terrain.height(x, z), G.map.waterLevel) : terrain.height(x, z));
  // the deformation window around the player: 8 x 8 chunks in a texture that wraps round
  const DEFORM_SLOTS = 8;
  const deformSlots = new Map(); // slot index -> chunk key shown there
  const deformBuf = new Float32Array(DEFORM_N * DEFORM_N * 2);
  function streamDeformation(x, z) {
    const c0x = Math.floor(x / CHUNK) - DEFORM_SLOTS / 2;
    const c0z = Math.floor(z / CHUNK) - DEFORM_SLOTS / 2;
    renderer.setDeformWindow(c0x * CHUNK, c0z * CHUNK, DEFORM_SLOTS * CHUNK);
    let uploads = 0;
    for (let j = 0; j < DEFORM_SLOTS; j++) {
      for (let i = 0; i < DEFORM_SLOTS; i++) {
        const cx = c0x + i;
        const cz = c0z + j;
        const si = ((cx % DEFORM_SLOTS) + DEFORM_SLOTS) % DEFORM_SLOTS;
        const sj = ((cz % DEFORM_SLOTS) + DEFORM_SLOTS) % DEFORM_SLOTS;
        const slot = sj * DEFORM_SLOTS + si;
        const c = terrain._chunk(cx, cz, false);
        const owner = c ? cx + ',' + cz : 'empty:' + cx + ',' + cz;
        const shown = deformSlots.get(slot);
        if (shown === owner && !(c && c.dirty)) continue;
        if (!c && (!shown || shown.startsWith('empty'))) {
          deformSlots.set(slot, owner);
          continue;
        }
        if (uploads > 6) continue; // a few per frame; the rest next frame
        if (c) {
          for (let k = 0; k < c.h.length; k++) {
            deformBuf[k * 2] = c.h[k];
            deformBuf[k * 2 + 1] = c.m[k];
          }
          c.dirty = false;
        } else deformBuf.fill(0);
        renderer.uploadDeform(si, sj, DEFORM_N, deformBuf);
        deformSlots.set(slot, owner);
        uploads++;
      }
    }
  }
  const scene = new Node('scene');
  scene.add(world.root);

  // ---- battle maps (drawings turned into terrain by tools/map-prep.py); the test range is the
  // world the garage stands in and the default battlefield
  const MAPS = data.maps || {};
  const MAP_IDS = ['range', ...Object.keys(MAPS)];
  const mapLoads = {};
  function loadMap(id) {
    if (!mapLoads[id]) {
      mapLoads[id] = loadBattleMap(MAPS[id]).then((m) => {
        const w = buildMapWorld(renderer, m);
        w.root.visible = false;
        scene.add(w.root);
        const ct = m.colorTexture();
        const entry = { id, map: m, world: w, minimap: m.minimapCanvas(512), gpu: { rect: [m.x0, m.z0, m.size], hres: m.hres, heights: m.heights, cres: ct.res, colors: ct.data } };
        G.maps.set(id, entry);
        return entry;
      });
    }
    return mapLoads[id];
  }
  const RANGE_ZONES = () => ZONES.map((z) => ({ rect: z.rect, color: hexToLinear(z.color), soft: z.soft }));
  /** Puts the game in a world: 'range', or a loaded battle map. */
  function useWorld(id) {
    const e = id !== 'range' ? G.maps.get(id) || null : null;
    if ((G.mapEntry || null) === e) return;
    clearEnemies();
    G.mapEntry = e;
    G.map = e ? e.map : null;
    setActiveMap(G.map);
    renderer.setMap(e ? e.gpu : null);
    // the range's own things (targets, signs, sheds, humps) are not on a map
    for (const c of world.root.children) if (c !== world.terrain && c !== world.ground) c.visible = !e;
    world.ground.pos = [0, e ? -9.5 : 0, 0];
    for (const x of G.maps.values()) x.world.root.visible = x === e;
    renderer.zones = e ? [] : RANGE_ZONES();
    renderer.road = e ? [0, 0, 0, 0] : ZONES[0].rect;
    terrain.extra = e ? null : humpLift;
    terrain.clear();
    deformSlots.clear();
    world.setGrid(world.grid.fine, e ? 2600 : 700);
  }
  const rng = new Rng(20261005);
  // the designer core (crates/design as WebAssembly): compiles player designs, resolves test shots
  const coreP = data.designCore ? loadCore(data.designCore, { materials: data.materials, catalog: data.designCatalog, terrains: Object.values(data.terrains) }) : Promise.reject(new Error('no design core'));
  coreP.catch((e) => console.warn('design core unavailable:', e.message));

  let storedBuild = null;
  try {
    const b = JSON.parse(store.get(STORE_BUILD) || 'null');
    if (b && data.vehicles[b.base] && Array.isArray(b.turrets)) storedBuild = b;
  } catch {
    storedBuild = null;
  }

  const G = {
    id: null,
    loadout: null,
    params: null,
    s: phys.newState(),
    T: [], // per turret: {yaw, bearing, yawErr, guns: [{pitch, pitchErr, recoil}], loading}
    sightT: 0,
    sightG: 0,
    sightM: -1,
    model: null,
    build: storedBuild || JSON.parse(JSON.stringify(PRESETS.hexa.build)),
    customStats: null,
    workshop: false,
    info: { speedKmh: 0, gear: 0, rpm: 0, trackSlip: 0, reversing: false, trackSpeedL: 0, trackSpeedR: 0, throttleLoad: 0, slipL: 0, slipR: 0, sinkage: 0, forceL: 0, forceR: 0 },
    susp: null, // suspension parameters and state (ss), per-station ground heights
    ss: null,
    ground: [],
    travel: { 1: 0, [-1]: 0 }, // metres each track has run (right = 1, left = -1)
    sag: { 1: { x: 1, v: 0 }, [-1]: { x: 1, v: 0 } }, // upper-run droop relative to its rest value
    sink: 0,
    rutAcc: 0,
    acc: 0,
    cam: { yaw: 0, pitch: -0.14, dist: 13, distTarget: 13, pivot: null, fov: THIRD_FOV, shake: 0, kick: 0 },
    aim: { yaw: 0, pitch: 0, dist: 800, blocked: false },
    aimPoint: [0, 2, 800],
    zero: 0,
    autoZero: true,
    ranging: null,
    rangeResult: null,
    view: 'third',
    zoomIdx: 0,
    free: false,
    savedCam: null,
    ret: null,
    keys: new Set(),
    touch: { throttle: 0, steer: 0 },
    maps: new Map(),
    map: null,
    mapEntry: null,
    mapId: 'range',
    spawnIdx: 0,
    flooded: false,
    mdx: 0,
    mdy: 0,
    rmb: false,
    fireHeld: false,
    pending: [],
    mode: 'garage', // 'garage' (choose a vehicle) | 'battle' (on the range)
    thumbs: [], // vehicle ids whose card picture still has to be rendered
    thumbTotal: 0,
    thumbRestore: null,
    thumbShot: false,
    spinHold: 0,
    gzoom: 1, // garage zoom, relative to the distance that fits the vehicle on screen
    inset: { right: 0, top: 0, bottom: 0 },
    MG: [], // per machine gun: {m, st, aim: {yaw, pitch}, bearing}
    mgHeld: false,
    bullets: [],
    bulletShells: new Map(),
    combatAcc: 0,
    mgHits: 0,
    lastMgHit: null,
    sightOffset: [0, 0],
    mapTick: 0,
    paused: false,
    shots: [],
    uPrev: 0,
    aLong: 0,
    rpmShown: 0,
    dustAcc: 0,
    lastHit: null,
    hits: 0,
    time: 0,
    fps: 0,
    pixelIdx: clamp(Number(store.get(STORE_PIXEL)) || 0, 0, PIXEL_MODES.length - 1),
    xray: false,
    interior: null,
    qualityChosen: !!QUALITY[storedQuality],
    slowFor: 0,
    core: null,
    designs: new Map(), // 'design:<id>' -> VehicleDesign (saved ones and the test / drive copies)
    compiled: new Map(), // design hash -> compiled bundle
  };
  const isDesign = (id) => typeof id === 'string' && id.startsWith('design:');

  // modifications: one garage card per chassis family, fitted with the variant chosen
  const mods = new Mods(store, STORE_MODS, (id) => !!data.vehicles[id]);
  const hud = new Hud((cid) => select(mods.variantOf(cid)));
  // the War Thunder-style hit camera (game/hitcam.js)
  const hitcam = new HitCam({ renderer, root: document.getElementById('hitcam') });
  // ---- protection analysis (garage): the armour coloured for a round, a click fires it
  const protection = new Protection({ renderer, materials: Object.fromEntries((data.materials || []).map((m) => [m.id, m])), hitcam, combat: () => G.combat });
  const protSelect = document.getElementById('prot-shell');
  const protDist = document.getElementById('prot-dist');
  const protInfo = document.getElementById('prot-info');
  {
    // every round of every vehicle in the garage, by calibre
    const seen = new Map();
    for (const vid of data.order) {
      const b = data.vehicles[vid];
      const guns = [b.weapons.main_gun, ...(b.weapons.extra_guns || []).map((g) => g.gun)];
      for (const g of guns) for (const sid of g.ammo || []) if (data.projectiles[sid] && !seen.has(sid)) seen.set(sid, b.vehicle.name);
    }
    const list = [...seen.entries()].map(([sid, who]) => ({ sid, who, sh: data.projectiles[sid] })).sort((a, b) => a.sh.caliber_mm - b.sh.caliber_mm || a.sh.name.localeCompare(b.sh.name));
    protSelect.innerHTML = list.map((x) => `<option value="${x.sid}">${x.sh.name}（${x.who}）</option>`).join('');
  }
  const protUpdateDist = () => {
    protection.dist = Number(protDist.value);
    document.getElementById('prot-dist-v').textContent = `${protection.dist} m`;
  };
  protSelect.addEventListener('change', () => {
    protection.shell = data.projectiles[protSelect.value];
    protSelect.blur();
  });
  protDist.addEventListener('input', protUpdateDist);
  protUpdateDist();
  // in the analysis the replay sits under its panel (the garage's own panel is on the right)
  hitcam.place = (frame, w, h) => {
    if (G.mode === 'test') {
      // the test range's result card fills the top right: the replay goes beside it, or under it
      const card = document.getElementById('tr-card');
      if (!card || card.hidden) return null;
      const k = frame.cw / (canvas.getBoundingClientRect().width || frame.cw);
      const r = card.getBoundingClientRect();
      const left = 330 * k;
      const x = r.left * k - w - 12 * k;
      if (x >= left) return [x, r.top * k, w, h];
      const y = (r.bottom + 10) * k;
      return y + h < frame.ch ? [frame.cw - w - 16 * k, y, w, h] : [left, frame.ch - h - 16 * k, w, h];
    }
    if (!G.protect) return null;
    const r = document.getElementById('prot').getBoundingClientRect();
    const k = frame.cw / (canvas.getBoundingClientRect().width || frame.cw);
    // as wide as the panel, between it and the vehicle cards
    const list = document.getElementById('vehicle-list').getBoundingClientRect();
    const top = (r.bottom + 10) * k;
    const room = ((list.top || frame.ch / k) - 34) * k - top;
    const pw = Math.max(200 * frame.scale, Math.min(r.width * k, room / 0.56));
    return [r.left * k, top, pw, pw * 0.56];
  };
  /** The bundle the analysis uses: the vehicle's armour, modules and crew. */
  const protBundle = () => {
    const b = data.vehicles[G.id];
    if (b) return b;
    if (G.id === 'custom') {
      const base = data.vehicles[G.build.base];
      const f = exportFolder(G.build, data, { armor: base.armor, modules: base.modules, crew: base.crew }, 'custom', 'custom').files;
      return { vehicle: G.loadout.vehicle, armor: f['armor.json'], modules: f['modules.json'], crew: f['crew.json'] };
    }
    return null;
  };
  function setProtect(on) {
    if (on && (G.mode !== 'garage' || G.workshop)) return;
    if (on && G.xray) setXray(false);
    G.protect = on;
    document.body.dataset.protect = on ? '1' : '0';
    document.getElementById('prot').hidden = !on;
    document.getElementById('prot-btn').textContent = `防護分析：${on ? '開' : '關'}`;
    if (on) {
      if (!protection.shell) {
        const own = G.loadout.turrets[0]?.guns[0]?.def?.ammo?.[0];
        if (own && data.projectiles[own]) protSelect.value = own;
        protection.shell = data.projectiles[protSelect.value];
      }
      protection.attach(G.model, G.loadout, protBundle());
      protInfo.textContent = '把滑鼠移到裝甲上看數據，點一下以這發彈試射（擊中回放在右上）';
    } else hitcam.hide();
    protection.setActive(on);
  }
  document.getElementById('prot-btn').addEventListener('click', (e) => {
    setProtect(!G.protect);
    e.currentTarget.blur();
  });
  /** Pointer ray in the vehicle's frame (ndc: -1..1), from the last frame's camera. */
  function protRay(ndc) {
    const c = G.lastCam;
    if (!c || !G.veh) return null;
    const d = [0, 1, 2].map((k) => c.forward[k] + c.right[k] * ndc[0] * c.tanX + c.up[k] * ndc[1] * c.tanY);
    const l = Math.hypot(d[0], d[1], d[2]);
    const b = G.veh.body;
    return { o: b.localPoint(c.pos), d: b.localDir([d[0] / l, d[1] / l, d[2] / l]) };
  }
  function protFire(ndc) {
    const r = protRay(ndc);
    if (!r) return;
    const yaw = G.T[0] ? G.T[0].yaw : 0;
    const h = protection.pick(r.o, r.d, yaw);
    if (!h) {
      protInfo.textContent = '沒有打中裝甲';
      return;
    }
    const rep = protection.shoot(G.id, r.o, r.d, yaw);
    if (!rep) {
      protInfo.textContent = '傷害模型尚未就緒';
      return;
    }
    const t0 = G.loadout.turrets[0];
    const first = rep.layers && rep.layers[0];
    const detail = first ? `${first.plate} ${first.thickness_mm} mm　入射 ${first.angle_deg.toFixed(0)}°　需 ${first.required_mm.toFixed(0)}／穿深 ${rep.pen_mm.toFixed(0)} mm` : '';
    hitcam.show({ model: G.model, body: G.veh.body, armor: protBundle()?.armor || [], pivot: t0 && t0.pivot, name: G.loadout.name, crewRoles: (G.innerCrew || []).map((c) => c.role), length: G.dims.front - G.dims.rear, interior: () => G.interior }, rep, protection.shell, protection.dist, false, detail);
    protInfo.textContent = `試射：${rep.title}　${protection.describe(h)}`;
  }
  /** What the hit camera needs of a vehicle that was hit. */
  const camTarget = (e) => ({
    model: e.model,
    body: e.veh.body,
    armor: e.bundle.armor.map(p => foldedPlate(p, e.fold || 0)),
    pivot: e.turret && e.turret.position_m,
    name: e.remote ? `${e.player}（${e.name}）` : e.name,
    crewRoles: (e.bundle.crew || []).map((c) => c.role),
    length: e.bundle.vehicle.hull.size_m[2],
    interior: () => {
      if (!e.interior && e.loadout) e.interior = buildInterior(renderer, e.model, e.loadout, e.bundle.modules || [], e.bundle.crew || []);
      return e.interior || null;
    },
  });

  // the online lobby (a garage panel) and the connection to the server
  const net = new NetClient();
  const mapName = (id) => (id === 'range' ? '靶場' : MAPS[id]?.name || id);
  const vehicleName = (id) => data.vehicles[id]?.vehicle.name || (id === 'custom' ? '自訂戰車' : isDesign(id) ? '設計局戰車' : id || '—');
  const lobby = new LobbyUi(document.getElementById('lobby'), net, {
    mapName,
    vehicleName,
    currentVehicle: () => G.id,
    usable: (id) => !!data.vehicles[id],
    onChange: () => {
      document.getElementById('net-btn').dataset.on = net.inRoom ? '2' : net.open ? '1' : '0';
      const go = document.getElementById('battle-btn');
      const label = !net.inRoom ? '開始戰鬥' : net.isHost ? '開始聯機戰鬥' : '等待房主開戰';
      if (go.textContent !== label) go.textContent = label;
    },
  });
  // the deploy screen of an online battle: vehicle, rounds and spawn point, before every life
  const deploy = new DeployScreen(document.getElementById('deploy'), {
    cfg: AMMO_CFG,
    lineup: () =>
      mods.cards(data.order).map(([cid, id]) => {
        const v = data.vehicles[id].vehicle;
        // a room limited to an era takes only the vehicles of those years
        const era = net.room?.era;
        const year = v.meta?.year;
        const inEra = !era || (year >= era[0] && year <= era[1]);
        return { id, name: v.name, nation: NATION_NAME[v.meta?.nation] || '', kind: CLASS_NAME[v.meta?.class] || '', thumb: hud.cards.get(cid)?.pic || null, usable: inEra, year, why: inEra ? '' : `這個房間只能用 ${era[0]}–${era[1]} 年的車輛（${year}）` };
      }),
    loadoutOf: (id) => makeLoadout(id, data.vehicles[id], data.projectiles, data.machineGuns),
    map: deployMap,
    members: () => (G.online ? [...G.online.members.values()].map((m) => ({ ...m, me: m.id === net.id })) : []),
    vehicleName,
    deploy(id, spawn) {
      const o = G.online;
      if (!o) return;
      o.spawn = spawn;
      // the rounds chosen: the server fills the racks from the bottom up with them
      const lo = makeLoadout(id, data.vehicles[id], data.projectiles, data.machineGuns);
      applyAmmo(lo, AMMO_CFG);
      net.send({ t: 'deploy', vehicle: id, spawn, rounds: carriedRounds(lo) });
      sound.start();
      requestLock();
    },
    chat: (text) => net.send({ t: 'chat', text }),
    leave: () => toGarage(),
  });
  /** What the deploy screen shows of the battle: the map, our spawn points, the points, our side. */
  function deployMap() {
    const o = G.online;
    const team = o ? o.team : 'blue';
    const cq = G.conquest;
    if (G.map) {
      const m = G.map;
      return {
        name: m.name,
        mode: m.points?.length ? '佔領模式' : '殲滅模式',
        picture: G.maps.get(G.mapId)?.minimap || null,
        x0: m.x0,
        z0: m.z0,
        size: m.size,
        grid: m.grid?.cols || 0,
        spawns: m.spawns[team] || m.spawns.blue,
        team,
        points: cq ? cq.points : m.points || [],
        tickets: cq ? cq.tickets : null,
        others: (G.enemies || []).filter((e) => e.remote).map((e) => ({ x: e.x, z: e.z, alive: e.alive, friend: o && e.team === o.team })),
      };
    }
    return { name: '靶場', mode: '殲滅模式', picture: null, x0: -300, z0: -150, size: 700, grid: 7, spawns: [RANGE_SPAWNS[team] || RANGE_SPAWNS.blue], team, points: [], tickets: null, others: [] };
  }
  /** Opens the deploy screen (online, a deploy room, not on the field). */
  function openDeploy(title) {
    const o = G.online;
    if (!o || !net.room?.deploy) return;
    const wait = Math.max(0, RESPAWN_DELAY - (performance.now() - o.diedAt) / 1000);
    if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
    G.keys.clear();
    G.fireHeld = G.mgHeld = false;
    hitcam.hide();
    deploy.open({ title, wait, vehicle: G.id, spawn: o.spawn ?? 0 });
  }
  document.getElementById('net-btn').addEventListener('click', (e) => {
    lobby.show();
    e.currentTarget.blur();
  });
  const entries = () => [
    ...mods.cards(data.order).map(([cid, id]) => {
      const v = data.vehicles[id].vehicle;
      return { id: cid, name: v.name, nation: v.meta?.nation, class: v.meta?.class, year: v.meta?.year };
    }),
    { id: 'custom', name: '自訂戰車', nation: 'fictional', class: 'custom', tag: '自訂' },
    ...designEntries(),
  ];
  /** Saved designs that are battle-ready and wanted in the garage. */
  function designEntries() {
    if (!G.core) return [];
    const out = [];
    for (const e of designStore.list()) {
      if (e.garage === false || !e.battle_ready) continue;
      const id = 'design:' + e.id;
      G.designs.set(id, e.design);
      out.push({ id, name: e.name, nation: 'design', class: 'design', tag: '設計局' });
    }
    return out;
  }
  const MAP_ZONES = ZONES.map((z) => ({ rect: z.rect, color: z.color }));
  const MAP_HUMPS = HUMP_LANES.map((l) => ({ x0: l.x0, x1: l.x1, z0: l.z0 - l.r, z1: l.z0 + (l.count - 1) * l.pitch + l.r }));

  // ------------------------------------------------------------------ vehicle

  /** A player design compiled by the core into an ordinary vehicle bundle (cached by content). */
  function compileDesign(design) {
    const key = JSON.stringify(design).length + ':' + design.id + ':' + hashText(JSON.stringify(design));
    if (!G.compiled.has(key)) {
      const r = G.core.evaluate(design, { mobility: false, files: true });
      if (!r.files) throw new Error('設計無法編譯');
      const f = r.files;
      const shells = Object.fromEntries((r.design_extra.shells || []).map((x) => [x.id, x]));
      G.compiled.set(key, {
        bundle: { vehicle: { ...f['vehicle.json'], name: design.name }, weapons: f['weapons.json'], engine: f['engine.json'], visual: f['visual.json'], modules: f['modules.json'], crew: f['crew.json'], design: r.design_extra },
        projectiles: { ...data.projectiles, ...shells },
        shells: Object.values(shells),
      });
    }
    return G.compiled.get(key);
  }

  function bundleFor(id) {
    if (isDesign(id)) return compileDesign(G.designs.get(id));
    if (id === 'custom') {
      const r = buildToBundle(G.build, data);
      G.customStats = r.stats;
      return { bundle: r.bundle, projectiles: { ...data.projectiles, ...r.projectiles } };
    }
    return { bundle: data.vehicles[id], projectiles: data.projectiles };
  }

  /** Reload seconds shown to the player for gun gi of turret ti (first loader). */
  function reloadShown(ti, gi) {
    const t = G.loadout.turrets[ti];
    const layout = t.guns.some((g) => g.rack);
    return reloadTime(t, gi, 0) * (layout && t.loaders.length === 0 ? 1.6 : 1);
  }

  function select(id, keepPose = false) {
    if (id !== 'custom' && !data.vehicles[id] && !(isDesign(id) && G.core && G.designs.has(id))) return;
    const keptPose = keepPose && G.veh ? { x: G.s.x, z: G.s.z, heading: G.s.heading } : null;
    const { bundle, projectiles } = bundleFor(id);
    if (G.model) {
      scene.children = scene.children.filter((c) => c !== G.model.root);
      G.model.dispose();
      if (G.interior) G.interior.dispose();
    }
    G.id = id;
    store.set(STORE_VEHICLE, id);
    G.loadout = makeLoadout(id, bundle, projectiles, data.machineGuns);
    // the rounds chosen on the deploy screen (the racks' default mix until one is chosen)
    if (data.vehicles[id]) applyAmmo(G.loadout, AMMO_CFG);
    G.params = phys.makeParams(bundle.vehicle, bundle.engine);
    G.firedAt = [];
    G.T = G.loadout.turrets.map((t) => {
      const layout = t.guns.some((g) => g.rack);
      return {
        yaw: t.facing,
        bearing: true,
        yawErr: 0,
        guns: t.guns.map(() => ({ pitch: 0, pitchErr: 0, recoil: 0, recoilT: -1, smoke: 0 })),
        loading: loading.newLoading(t.guns.length, layout ? t.loaders.length : t.guns.length),
      };
    });
    G.loadout.turrets.forEach((t, ti) => t.guns.forEach((g, gi) => g.loaded < 0 && (G.T[ti].loading.state[gi] = 'empty')));
    G.MG = G.loadout.machineGuns.map((m) => ({ m, st: mgSim.newMg(m.def), aim: { yaw: 0, pitch: 0 }, bearing: true }));
    G.sightT = 0;
    G.sightG = 0;
    G.sightM = -1;
    G.pending.length = 0;
    // overall length with the gun forward, for framing the garage pictures
    const hullL = bundle.vehicle.hull.size_m[2];
    let front = hullL / 2;
    for (const t of G.loadout.turrets) if (Math.abs(t.facing) < 0.5) for (const g of t.guns) front = Math.max(front, g.trunnion[2] + g.muzzleOffset);
    G.dims = { front, rear: -hullL / 2, width: bundle.vehicle.hull.size_m[0] };
    G.model = buildTank(renderer, G.loadout, generatedTurretParts);
    scene.add(G.model.root);
    // hinged armour flaps start raised
    G.fold = { cur: 0, target: 0, pose: 0 };
    // what is inside: the same modules and crew the damage model uses
    let inner = bundle;
    if (id === 'custom') {
      const base = data.vehicles[G.build.base];
      const f = exportFolder(G.build, data, { armor: base.armor, modules: base.modules, crew: base.crew }, 'custom', 'custom').files;
      inner = { modules: f['modules.json'], crew: f['crew.json'] };
    }
    const mounts = bundle.design ? { modules: bundle.design.turret_modules || [], crew: bundle.design.turret_crew || [] } : null;
    G.interior = buildInterior(renderer, G.model, G.loadout, inner.modules || [], inner.crew || [], mounts);
    G.innerCrew = inner.crew || [];
    // the engine's exhaust outlets and its smoke
    G.exhaust = new Exhaust(fx, exhaustOf({ ...bundle, modules: inner.modules || bundle.modules || [] }));
    applyXray();
    if (G.protect) protection.attach(G.model, G.loadout, protBundle());
    // the vehicle's physics: hull rigid body on its road-wheel stations and tracks (sim/tank)
    G.veh = new VehicleSim(bundle, G.model, terrain);
    G.ss = G.veh.attitude();
    G.sag = { 1: { x: 1, v: 0 }, [-1]: { x: 1, v: 0 } };
    if (keptPose) {
      G.veh.place(keptPose.x, keptPose.z, keptPose.heading);
      G.veh.compat(G.s);
      G.ss = G.veh.attitude();
    } else {
      const yaw = G.cam.yaw;
      resetPose();
      // changing vehicle in the garage keeps the angle you were looking from
      if (G.mode === 'garage' && G.posed) G.cam.yaw = yaw;
      G.posed = true;
    }
    if (data.vehicles[id]) mods.choose(id);
    hud.markSelected(mods.cardOf(id));
    hud.renameCard(mods.cardOf(id), G.loadout.name, bundle.vehicle.meta?.class, bundle.vehicle.meta?.year);
    hud.showSpec(G.loadout, G.params, reloadShown);
    hud.showMods(mods.slots(id, LANG_INDEX), (vid) => {
      select(vid, true);
      // the card's picture follows the variant fitted
      if (G.mode === 'garage') queueThumbs([mods.cardOf(vid)]);
    });
    hud.buildGunList(G.loadout);
    hud.buildAmmo(sightGun(), selectAmmo);
    G.statusShape = statusShape(bundle, inner);
    G.cruise = null;
    // the rockets on the rails are the rounds loaded
    G.loadout.turrets.forEach((t, ti) => t.guns.forEach((g, gi) => g.def.missile && G.model.payload(ti, gi, roundsLeft(g))));
    // a new vehicle in battle (deploy screen, respawn): its own protection system, if any
    if (G.mode === 'battle') {
      G.apsOn = true;
      G.apsState = null;
      G.apsFault = false;
      missileVehicle();
    }
    document.getElementById('ws-open').textContent = id === 'custom' ? '改裝工坊' : '改裝工坊（自訂戰車）';
    measureInsets();
    if (net.inRoom && !G.online) lobby.sendVehicle();
    lobby.render();
  }

  // vectors in the data files are {x, y, z}; some generated ones are [x, y, z]
  const v3x = (v) => (Array.isArray(v) ? v[0] : v.x);
  const v3z = (v) => (Array.isArray(v) ? v[2] : v.z);
  /** The vehicle seen from above for the status picture: hull, tracks, turret, modules, crew. */
  function statusShape(bundle, inner) {
    const v = bundle.vehicle;
    const rg = bundle.visual?.running_gear;
    const t0 = G.loadout.turrets[0];
    const skip = new Set(['track', 'gun_barrel', 'gun_breech', 'horizontal_drive', 'vertical_drive', 'turret_drive']);
    return {
      width: v.hull.size_m[0],
      length: v.hull.size_m[2],
      tracks: rg?.kind === 'wheels' ? { x: Math.max(...rg.axles.map((a) => a.x)), w: rg.axles[0].w } : { x: rg?.track_x ?? v.hull.size_m[0] / 2 - 0.3, w: rg?.track_width ?? 0.5 },
      wheels: rg?.kind === 'wheels' ? rg.axles.map((a) => ({ z: a.z, r: a.r })) : null,
      turret: v.turret.ring_diameter_m > 0 ? { x: t0.pivot[0], z: t0.pivot[2], w: Math.max(v.turret.size_m[0], 0.6), l: Math.max(v.turret.size_m[2], 0.6), gun: t0.guns[0].muzzleOffset } : null,
      modules: (inner.modules || []).filter((m) => !skip.has(m.kind)).map((m) => ({ id: m.id, kind: m.kind, x: v3x(m.center), z: v3z(m.center), hx: v3x(m.half_extents), hz: v3z(m.half_extents), health: m.max_health > 0 ? m.health / m.max_health : 1 })),
      crew: (inner.crew || []).map((c) => ({ x: v3x(c.pos), z: v3z(c.pos), health: (c.health ?? 100) / 100 })),
    };
  }

  /** Driver's cruise control (= / −): a held throttle setting until W or S is pressed. */
  const CRUISE = [['倒車', -1], ['停止', 0], ['一段', 0.25], ['二段', 0.5], ['三段', 0.75], ['極速', 1]];
  function stepCruise(dir) {
    G.cruise = clamp((G.cruise ?? 1) + dir, 0, CRUISE.length - 1);
    hud.toast(`巡航：${CRUISE[G.cruise][0]}`, 1.2);
  }

  /**
   * The player's own vehicle in the combat model (data vehicles only; designs and the workshop
   * build are not modelled there yet): fresh modules and crew.
   */
  function combatInit() {
    G.cstate = null;
    G.caps = null;
    const bundle = data.vehicles[G.id];
    if (!G.combat || !bundle || G.mode !== 'battle') return;
    G.combat.setFold(G.id, G.fold?.pose || 0);
    const r = G.combat.fresh(G.id, bundle);
    G.cstate = r.state;
    G.caps = r.caps;
    G.modIndex = new Map(bundle.modules.map((m, i) => [m.id, i]));
    G.carried = -1;
    syncRacks();
  }

  /** Main-gun rounds on board now (every gun's racks together). */
  function carriedRounds(lo = G.loadout) {
    return lo ? lo.turrets.reduce((s, t) => s + t.guns.reduce((n, g) => n + roundsLeft(g), 0), 0) : 0;
  }

  /**
   * Which ammo racks still hold rounds: a short load leaves the upper racks empty and every shot
   * fired empties more; an empty rack is not drawn in x-ray and cannot be set off (the server
   * keeps the same count online and its word overrides this).
   */
  function syncRacks() {
    if (!G.cstate || !G.combat || !data.vehicles[G.id]) return;
    const n = carriedRounds();
    if (n === G.carried) return;
    G.carried = n;
    G.cstate = G.combat.ammo(G.id, G.cstate, n).state;
    const empty = emptyRacks(data.vehicles[G.id], G.cstate);
    const key = [...empty].join();
    if (key !== G.emptyKey) {
      G.emptyKey = key;
      applyXray();
    }
  }

  /** Puts the vehicle where the current screen wants it: on its bay in the garage, or at the start of the range. */
  function resetPose() {
    G.s = phys.newState();
    G.uPrev = 0;
    G.aLong = 0;
    G.sink = 0;
    G.zoomIdx = 0;
    G.zoom3 = false;
    G.zero = 0;
    G.ranging = null;
    G.shots.length = 0;
    G.bullets.length = 0;
    G.pending.length = 0;
    G.cam.pivot = null;
    if (G.mode === 'garage') {
      G.s.x = GARAGE.x;
      G.s.z = GARAGE.z;
      G.s.heading = GARAGE.heading;
      G.cam.yaw = GARAGE.camYaw;
      G.cam.pitch = GARAGE.camPitch;
      G.cam.distTarget = 16;
      G.aimPoint = [GARAGE.x + Math.sin(GARAGE.heading) * 800, 2, GARAGE.z + Math.cos(GARAGE.heading) * 800];
    } else if (G.map || G.online) {
      // a battle map: the blue team's start points, facing the other side (online: the player's
      // own team and place in it)
      const sp = spawnPoint();
      G.s.x = sp.x;
      G.s.z = sp.z;
      G.s.heading = sp.heading;
      G.aim.yaw = G.cam.yaw = sp.heading;
      G.cam.pitch = -0.14;
      G.cam.distTarget = clamp(G.model.length * 2.0, 10, 16);
      G.aimPoint = [sp.x + Math.sin(sp.heading) * 800, surfaceAt(sp.x, sp.z) + 2, sp.z + Math.cos(sp.heading) * 800];
      G.flooded = false;
    } else {
      G.aim.yaw = G.cam.yaw = 0;
      G.cam.pitch = -0.14;
      G.cam.distTarget = clamp(G.model.length * 2.0, 10, 16);
      G.aimPoint = [0, 2, 800];
    }
    G.cam.dist = G.cam.distTarget;
    combatInit();
    if (G.veh) {
      G.veh.place(G.s.x, G.s.z, G.s.heading);
      G.veh.compat(G.s);
      G.ss = G.veh.attitude();
      G.travel = { 1: 0, [-1]: 0 };
    }
    for (const t of G.T) {
      const lt = G.loadout.turrets[G.T.indexOf(t)];
      // a turret riding on another rests at its facing from that turret's own
      t.yaw = lt.facing + (lt.parent != null ? G.loadout.turrets[lt.parent].facing : 0);
      t.carried = null;
      t.seen = null;
      t.lay = null;
      for (const g of t.guns) g.lay = null;
    }
  }

  // the hull's heave on its springs (and the ground it stands on) lifts everything mounted on it
  const pose = () => ({ pos: [G.s.x, G.s.y || 0, G.s.z], heading: G.s.heading });
  const sightTurret = () => G.loadout.turrets[G.sightT];
  const sightGun = () => sightTurret().guns[G.sightG];
  const sightLevels = () => sightTurret().sight.levels;
  /**
   * Where a turret's ring is now (hull frame): a turret riding on another is carried round with
   * it. Its yaw in G.T is kept in the hull frame too, so the gun formulas need nothing else.
   */
  function pivotOf(t) {
    if (t.parent == null) return t.pivot;
    const p = G.loadout.turrets[t.parent];
    const r = gunnery.muzzleLocal({ pivot: p.pivot, trunnion: t.pivot, muzzleOffset: 0 }, { yaw: G.T[t.parent].yaw, pitch: 0 }).trunnion;
    return r;
  }
  const mountOf = (t, g) => {
    if (t.parent == null) return { pivot: t.pivot, trunnion: g.trunnion, muzzleOffset: g.muzzleOffset, muzzleVector: g.muzzleVector };
    const pv = pivotOf(t);
    return { pivot: pv, trunnion: [g.trunnion[0] + pv[0] - t.pivot[0], g.trunnion[1] + pv[1] - t.pivot[1], g.trunnion[2] + pv[2] - t.pivot[2]], muzzleOffset: g.muzzleOffset, muzzleVector: g.muzzleVector };
  };
  const zeroElev = (g) => {
    const selected = G.MG[G.sightM];
    const table = selected?.m.mount === 'coax' && g === G.loadout.turrets[0].guns[0] ? selected.m.table : g.table;
    return ballistics.elevationAt(table, G.zero);
  };

  // ----------------------------------------------------------------- workshop

  const workshopEl = document.getElementById('workshop');
  const workshop = new Workshop(workshopEl, {
    data,
    getBuild: () => G.build,
    apply(build) {
      G.build = build;
      store.set(STORE_BUILD, JSON.stringify(build));
      select('custom', G.id === 'custom');
      const off = build.keepStock ? 1 : 0;
      const st = G.customStats;
      return {
        mass: st.mass,
        hpPerTon: st.hpPerTon,
        guns: st.guns,
        salvoMomentum: st.salvoMomentum,
        reloads: build.turrets.map((t, i) => t.guns.map((_, gi) => (G.loadout.turrets[i + off] ? reloadShown(i + off, gi) : null))),
        traverse: st.turrets.map((t) => t.traverse_deg_s),
        turretMass: st.turrets.map((t) => t.mass),
      };
    },
    exportText() {
      const base = data.vehicles[G.build.base];
      const out = exportFolder(G.build, data, { armor: base.armor, modules: base.modules, crew: base.crew }, 'my_tank', '自訂戰車');
      return JSON.stringify({ build: G.build, files: out.files, projectiles: out.projectiles }, null, 1);
    },
  });

  function setWorkshop(on) {
    if (on && G.mode !== 'garage') toGarage();
    if (on && G.protect) setProtect(false);
    if (on === G.workshop) return;
    G.workshop = on;
    document.body.dataset.workshop = on ? '1' : '0';
    if (on) {
      if (G.xray) setXray(false);
      if (G.id !== 'custom') select('custom');
      G.cam.yaw = GARAGE.heading + Math.PI + 0.7;
      G.cam.pitch = -0.28;
      workshop.open();
    } else {
      workshop.close();
      // the card picture shows the vehicle as it was built
      queueThumbs(['custom']);
    }
    measureInsets();
  }
  // the page's language: the browser's, or the one chosen here (kept in the browser)
  const langBtn = document.getElementById('lang-btn');
  if (langBtn) {
    langBtn.textContent = LANG === 'en' ? '中文' : 'English';
    langBtn.lang = LANG === 'en' ? 'zh' : 'en';
    langBtn.addEventListener('click', () => setLang(LANG === 'en' ? 'zh' : 'en'));
  }
  document.getElementById('ws-open').addEventListener('click', (e) => {
    setWorkshop(!G.workshop);
    e.currentTarget.blur();
  });
  document.getElementById('ws-close').addEventListener('click', () => setWorkshop(false));

  // ---------------------------------------------------------- design bureau

  /** Garage cards follow the saved designs (new ones get their picture taken). */
  function refreshDesigns() {
    if (!G.core) return;
    const added = hud.syncVehicleList(entries(), G.id);
    for (const id of [...G.designs.keys()]) if (!id.startsWith('design:__') && !entries().some((e) => e.id === id)) G.designs.delete(id);
    if (added.length && G.mode === 'garage') queueThumbs(added);
  }
  coreP.then((c) => {
    G.core = c;
    // the same core runs the combat model of data vehicles (crates/combat)
    G.combat = new Combat(c);
    // ... and flies missiles and rockets and the active protection that shoots at them (crates/missile)
    G.missiles = new Missiles({ core: c, defs: data.missiles, projectiles: data.projectiles, renderer, scene, fx, sound });
    G.missiles.onGround = (pt, def) => missileGround(pt, def);
    refreshDesigns();
  });

  const bureau = new Bureau(document.getElementById('bureau'), {
    data,
    core: coreP,
    newDesign: (k) => newDesign(k, data.designCatalog),
    arrange: (d) => arrange(G.core, d),
    ringHeight,
    onClose: () => {
      setMode('garage');
      resetPose();
      measureInsets();
      refreshDesigns();
    },
    onTestFire: (d) => enterTest(d),
    onDrive: (d) => driveDesign(d),
    onGarage: () => refreshDesigns(),
  });

  function openBureau(design) {
    if (G.workshop) setWorkshop(false);
    if (G.protect) setProtect(false);
    if (G.xray) setXray(false);
    if (G.mode === 'test') testRange.exit();
    if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
    setMode('bureau');
    hud.hideToast();
    bureau.open(design).catch((e) => hud.toast('設計局無法啟動：' + e.message, 6));
  }
  document.getElementById('bu-open').addEventListener('click', (e) => {
    e.currentTarget.blur();
    if (net.inRoom) return hud.toast('在聯機房間裡不能進設計局（先離開房間）', 3);
    openBureau();
  });

  /**
   * A design test shot (crates/design `shoot`) in the shape of a combat report, for the hit camera:
   * the design's own model stands as the target.
   */
  function designReport(last) {
    return designReplayReport(last, (G.innerCrew || []).map(c => c.role), G.T[0] ? G.T[0].yaw : 0);
  }

  const testRange = new TestRange({
    hitcam: (last) => {
      const t0 = G.loadout.turrets[0];
      hitcam.show(
        { model: G.model, body: G.veh.body, armor: [], pivot: t0 && t0.pivot, name: G.loadout.name, crewRoles: (G.innerCrew || []).map((c) => c.role), length: G.dims.front - G.dims.rear, interior: () => G.interior },
        designReport(last),
        last.shell,
        last.distance,
      );
    },
    G,
    data,
    fx,
    sound,
    hud,
    core: () => G.core,
    root: document.getElementById('testrange'),
    pose: () => pose(),
    applyXray: () => applyXray(),
    onBack: (where) => {
      testRange.exit();
      if (where === 'bureau') openBureau();
      else {
        setMode('battle');
        toGarage();
      }
    },
  });

  const physDebug = new PhysDebug(document.getElementById('phys-debug'), {
    lanes: COURSE.lanes,
    goLane: (i) => {
      if (G.mode !== 'battle') return;
      const l = COURSE.lanes[i];
      G.veh.place(l.x0 + 5, 300, 0);
      G.veh.compat(G.s);
      G.cam.yaw = 0;
      G.aimPoint = [l.x0 + 5, 2, 1100];
      hud.toast(`懸吊測試場：${l.label}`, 2);
    },
    clearRuts: () => terrain.clear(),
  });

  /** Puts a design on the range as a target and hands the player a gun with any round. */
  function enterTest(design) {
    if (!G.core) return;
    const id = 'design:__test';
    G.designs.set(id, design);
    let compiled;
    try {
      compiled = compileDesign(design);
    } catch (e) {
      hud.toast(e.message, 4);
      return;
    }
    setMode('test');
    G.view = 'third';
    G.free = false;
    select(id);
    testRange.enter(design, [...compiled.shells, ...Object.values(data.projectiles)]);
    canvas.focus();
  }

  /** Drives the design on the range like any other vehicle. */
  function driveDesign(design) {
    if (!G.core) return;
    const id = 'design:__drive';
    G.designs.set(id, design);
    setMode('garage');
    select(id);
    startBattle();
    canvas.focus();
  }

  // -------------------------------------------------------------------- input

  const KEYMAP = { KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'brake' };

  /** Interior view: the shell turns to glass and the modules and crew inside are shown and named. */
  function applyXray() {
    if (!G.model) return;
    for (const n of G.model.shellNodes) {
      n.kind = G.xray ? 6 : n.baseKind ?? 0;
      n.castShadow = !G.xray;
    }
    for (const n of G.interior.nodes) n.visible = G.xray || !!n.always;
    // racks emptied by a short load or by firing are bare frames: not drawn
    if (G.mode === 'battle' && G.cstate && data.vehicles[G.id]) for (const id of emptyRacks(data.vehicles[G.id], G.cstate)) for (const n of G.interior.byModule.get(id) || []) n.visible = false;
    document.body.dataset.xray = G.xray ? '1' : '0';
    document.getElementById('xray-btn').textContent = `內構透視：${G.xray ? '開' : '關'}`;
  }
  function setXray(on) {
    if (G.workshop) return;
    if (on && G.protect) setProtect(false);
    if (!on) G.xrayLatched = false;
    G.xray = on;
    applyXray();
    if (G.mode === 'garage') {
      hud.freeLook(on, G.xrayLatched ? '內構透視　拖曳環視，再按一次按鈕關閉' : '內構透視　拖曳環視，放開 O 關閉');
      return;
    }
    if (on) {
      if (G.view === 'sight') toggleSight();
      G.free = false;
      setFreeLook(true);
      hud.freeLook(true, G.xrayLatched ? '內構透視　拖曳環視，再按一次按鈕關閉' : '內構透視　拖曳環視，放開 O 關閉');
    } else setFreeLook(false);
  }
  document.getElementById('xray-btn').addEventListener('click', (e) => {
    G.xrayLatched = !G.xray;
    setXray(!G.xray);
    e.currentTarget.blur();
  });

  function setFreeLook(on) {
    if (on === G.free) return;
    G.free = on;
    if (on) {
      G.ret = null;
      G.savedCam = { yaw: G.cam.yaw, pitch: G.cam.pitch };
    } else if (G.savedCam) {
      if (G.view === 'third') G.ret = { t: 0, yaw0: G.cam.yaw, pitch0: G.cam.pitch, yaw1: G.savedCam.yaw, pitch1: G.savedCam.pitch };
      else {
        // back to the eyepiece, looking where the sight was pointed
        G.cam.yaw = G.savedCam.yaw;
        G.cam.pitch = G.savedCam.pitch;
      }
    }
    hud.freeLook(on);
  }

  function toggleSight() {
    if (G.workshop || G.mode !== 'battle') return;
    if (G.view === 'third') {
      // the sight opens on the point the third-person mark was on
      G.view = 'sight';
      G.zoomIdx = 0;
      G.ret = null;
      G.cam.yaw = G.aim.yaw;
      G.cam.pitch = G.aim.pitch;
    } else {
      G.view = 'third';
      G.cam.yaw = G.aim.yaw;
      G.cam.pitch = clamp(G.aim.pitch - 0.1, -0.6, 0.35);
    }
  }

  function resetVehicle() {
    if (G.mode !== 'battle') return;
    if (G.online) return onlineRespawn();
    if (G.view === 'sight') toggleSight();
    resetPose();
  }

  // ----------------------------------------------------------- garage / battle

  /** How much of the view the garage panels cover, so the vehicle can sit in the middle of what is left. */
  function measureInsets() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    const box = (id) => {
      const e = document.getElementById(id);
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? r : null;
    };
    const info = box('g-info');
    const ws = G.workshop ? box('workshop') : null;
    const bottom = box('g-bottom');
    const top = box('g-top');
    // the info panel starts under the header, however many rows its buttons take
    if (top) document.body.style.setProperty('--hdr', `${Math.round(top.bottom - 14)}px`);
    const side = ws || info;
    const beside = side && side.height > h * 0.3 && side.left > w * 0.35;
    let low = bottom ? h - bottom.top - 20 : 0;
    if (side && !beside) low = Math.max(low, h - side.top);
    G.inset = { right: beside ? (w - side.left) / w : 0, top: top ? (top.bottom - 14) / h : 0, bottom: Math.max(0, low) / h };
  }
  window.addEventListener('resize', measureInsets);

  /** Queues card pictures; they are rendered one per frame with the real renderer. */
  function queueThumbs(ids) {
    if (!G.thumbs.length) {
      G.thumbRestore = G.id;
      G.thumbTotal = 0;
    }
    for (const id of ids) if (!G.thumbs.includes(id)) G.thumbs.push(id);
    G.thumbTotal += ids.length;
  }

  function thumbStep() {
    const id = G.thumbs.shift();
    select(mods.variantOf(id));
    G.thumbShot = true;
    update(1 / 60);
    G.thumbShot = false;
    hud.setThumb(id, canvas);
    if (G.thumbs.length) hud.loading(`整備車輛中 ${G.thumbTotal - G.thumbs.length}／${G.thumbTotal}`);
    else {
      hud.loading(null);
      select(G.thumbRestore && (G.thumbRestore === 'custom' || data.vehicles[G.thumbRestore] || G.designs.has(G.thumbRestore)) ? G.thumbRestore : data.order[0]);
    }
  }

  function setMode(mode) {
    G.mode = mode;
    document.body.dataset.mode = mode;
    sound.engineOn = mode === 'battle';
  }

  function startBattle() {
    if (G.mode === 'battle' || G.thumbs.length) return;
    if (G.protect) setProtect(false);
    if (G.mode === 'test') testRange.exit();
    if (G.workshop) setWorkshop(false);
    while (G.thumbs.length) thumbStep();
    if (G.xray) setXray(false);
    // a battle map is decoded the first time it is used
    if (G.mapId !== 'range' && !G.maps.has(G.mapId)) {
      hud.toast('地圖載入中…', 3);
      loadMap(G.mapId).then(() => startBattle()).catch((e) => hud.toast('地圖載入失敗：' + e.message, 5));
      return;
    }
    useWorld(G.mapId);
    G.flooded = false;
    setMode('battle');
    // conquest on a map with capture points (online the server keeps it and tells us)
    G.cqEndAt = 0;
    G.cqDead = false;
    if (!G.online) G.conquest = G.map && G.map.points?.length ? Object.assign(new Conquest(G.map.points), { local: true }) : null;
    if (G.online) spawnRemotes();
    else if (G.map) spawnEnemies();
    G.view = 'third';
    G.free = false;
    G.mgHeld = G.fireHeld = false;
    hud.freeLook(false);
    resetPose();
    missileBattleStart();
    if (G.online) hud.toast(`聯機戰鬥：${mapName(G.mapId)}　你在${G.online.team === 'blue' ? '藍方' : '紅方'}　Enter 聊天，R 重生／棄車，Tab 離開房間`, 6);
    else if (G.conquest) hud.toast(`${G.loadout.name} 出擊：${G.map.name}・佔領模式　佔領 ${G.conquest.points.map((p) => p.id).join('／')} 點讓敵方兵力歸零，Tab 回車庫`, 6);
    else hud.toast(G.map ? `${G.loadout.name} 出擊：${G.map.name}　藍方出發點 ${spawnLabel()}，Tab 回車庫` : `${G.loadout.name} 出擊　靶在道路前方，Tab 回車庫`, 5);
    updateNetHud(true);
  }

  /** The garage's battle button and Enter: in an online room the host starts it for everyone. */
  function goBattle() {
    if (net.inRoom) {
      if (net.isHost && !net.room.playing) net.send({ t: 'start' });
      else hud.toast(net.room.playing ? '戰鬥進行中' : '等房主開始戰鬥', 2);
      return;
    }
    startBattle();
  }

  function toGarage() {
    if (G.mode === 'garage') return;
    if (G.mode === 'test') testRange.exit();
    if (isDesign(G.id) && G.id.startsWith('design:__')) select(data.order[0]);
    if (G.xray) setXray(false);
    if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
    if (G.online) {
      // leaving an online battle leaves its room
      G.online = null;
      net.send({ t: 'leave' });
    }
    deploy.close();
    G.conquest = null;
    G.cqEndAt = 0;
    cqBar.hidden = true;
    cqMsg.textContent = '';
    setMode('garage');
    useWorld('range');
    clearEnemies();
    if (G.missiles) G.missiles.reset(null);
    G.apsState = null;
    hud.aps(null);
    hitcam.hide();
    updateNetHud(true);
    document.getElementById('net-feed').textContent = '';
    G.view = 'third';
    G.free = false;
    G.mgHeld = G.fireHeld = G.rmb = false;
    G.keys.clear();
    hud.freeLook(false);
    hud.hideToast();
    resetPose();
    measureInsets();
  }

  /** Arrow keys in the garage: the next card that the nation filter is showing. */
  function stepVehicle(dir) {
    const ids = hud.shownIds();
    if (!ids.length) return;
    const i = ids.indexOf(mods.cardOf(G.id));
    select(mods.variantOf(ids[(i + dir + ids.length) % ids.length]));
  }

  function setZero(v) {
    const z = clamp(Math.round(v / 10) * 10, 0, MAX_ZERO);
    if (z !== G.zero) G.zeroFlash = 1.4;
    G.zero = z;
  }

  function cycleSightGun() {
    const next = nextSightWeapon(G.loadout, { ti: G.sightT, gi: G.sightG, mi: G.sightM });
    G.sightT = next.ti;
    G.sightG = next.gi;
    G.sightM = next.mi;
    G.pending.length = 0;
    G.zoomIdx = 0;
    hud.buildAmmo(G.sightM >= 0 ? null : sightGun(), selectAmmo);
    const mg = G.MG[G.sightM];
    hud.toast(mg ? `切到機槍 ${mg.m.def.name || mg.m.weapon}（左鍵單獨開火）` : `瞄準鏡切到炮塔 ${G.sightT + 1} · 火炮 ${G.sightG + 1}`, 1.5);
  }

  /**
   * Ammunition selector of the gun in the sight (keys 1-9): the loader takes the selected type
   * next. Pressing the same key twice quickly unloads a round of another type and loads this one.
   */
  function selectAmmo(i) {
    if (G.sightM >= 0) return;
    const g = sightGun();
    const rt = G.T[G.sightT];
    const a = g.ammo[i];
    if (!a) return;
    if (a.count <= 0) {
      hud.toast(`${a.shell.name} 已經打完`, 1.5);
      return;
    }
    const now = performance.now();
    const again = G.ammoKey && G.ammoKey.i === i && now - G.ammoKey.t < 450;
    G.ammoKey = { i, t: now };
    g.selected = i;
    if (again && g.loaded >= 0 && g.loaded !== i && rt.loading.state[G.sightG] === 'ready') {
      // the round in the breech goes back into the rack and the loader starts on the new one
      g.ammo[g.loaded].count++;
      g.loaded = -1;
      loading.fired(rt.loading, G.sightG);
      hud.toast(`退彈，改裝 ${a.shell.name}`, 1.5);
    } else if (g.loaded >= 0 && g.loaded !== i) hud.toast(`下一發：${a.shell.name}（連按兩下立即換彈）`, 1.8);
    else hud.toast(`彈種：${a.shell.name}`, 1.2);
    if (g.loaded < 0) syncGunShell(g);
  }

  function setPixel(idx) {
    G.pixelIdx = ((idx % PIXEL_MODES.length) + PIXEL_MODES.length) % PIXEL_MODES.length;
    store.set(STORE_PIXEL, String(G.pixelIdx));
    document.getElementById('pixel-btn').textContent = `像素風格：${PIXEL_LABEL[G.pixelIdx]}`;
  }
  document.getElementById('pixel-btn').addEventListener('click', (e) => {
    setPixel(G.pixelIdx + 1);
    e.currentTarget.blur();
  });
  setPixel(G.pixelIdx);

  function setQuality(name, byUser = true) {
    renderer.setQuality(name);
    // the terrain grid's finest spacing near the vehicle
    world.setGrid({ low: 0.3, medium: 0.16, high: 0.12 }[renderer.quality] || 0.16, G.map ? 2600 : 700);
    if (byUser) {
      G.qualityChosen = true;
      store.set(STORE_QUALITY, renderer.quality);
    }
    document.getElementById('quality-btn').textContent = `畫質：${QUALITY[renderer.quality].label}`;
  }
  document.getElementById('quality-btn').addEventListener('click', (e) => {
    setQuality(QUALITY_ORDER[(QUALITY_ORDER.indexOf(renderer.quality) + 1) % QUALITY_ORDER.length]);
    e.currentTarget.blur();
  });
  setQuality(renderer.quality, false);

  function setTime(idx) {
    renderer.setTime(idx);
    store.set(STORE_TIME, String(renderer.timeIndex));
    document.getElementById('time-btn').textContent = `時間：${TIMES[renderer.timeIndex].label}`;
  }
  document.getElementById('time-btn').addEventListener('click', (e) => {
    setTime(renderer.timeIndex + 1);
    e.currentTarget.blur();
  });

  /**
   * Water on a battle map: it holds the hull back the deeper it goes, and past the fording depth
   * it gets into the engine, which stops (R puts the vehicle back at its start point).
   */
  function wade(dt) {
    const b = G.veh.body;
    const depth = G.map.waterDepth(G.s.x, G.s.z);
    G.waterDepth = depth;
    if (depth <= 0.05) return;
    // the water pushes back harder the faster the hull ploughs through it
    const sp = Math.hypot(b.v[0], b.v[2]);
    const k = Math.min(1, (0.25 + 0.09 * sp) * depth * dt);
    b.v = [b.v[0] * (1 - k), b.v[1], b.v[2] * (1 - k)];
    b.w = [b.w[0] * (1 - k * 0.5), b.w[1] * (1 - k), b.w[2] * (1 - k * 0.5)];
    if (!G.flooded && depth > FORD_DEPTH) {
      G.flooded = true;
      hud.toast(`水深 ${depth.toFixed(1)} m 超過涉水深度 ${FORD_DEPTH} m：引擎進水熄火。按 R 回到出發點`, 6);
    }
  }

  // ---- enemy vehicles at the red start points (targets with real armour)
  const ENEMY_POOL = ['su_t34_85', 'us_m901_itv', 'de_pz4_h', 'su_t10m', 'us_m4a3_75w', 'de_panther_g', 'su_is2', 'uk_cromwell_iv'];
  function clearEnemies() {
    hitcam.hide();
    for (const e of G.enemies || []) {
      scene.children = scene.children.filter((c) => c !== e.model.root);
      if (e.interior) e.interior.dispose();
      e.model.dispose();
    }
    G.enemies = [];
  }
  function spawnEnemies() {
    clearEnemies();
    const blue = G.map.spawns.blue;
    const aim = [blue.reduce((a, s) => a + s.x, 0) / blue.length, blue.reduce((a, s) => a + s.z, 0) / blue.length];
    const pool = ENEMY_POOL.filter((id) => id !== G.id && data.vehicles[id]);
    G.map.spawns.red.forEach((sp, i) => {
      const id = pool[i % pool.length];
      const bundle = data.vehicles[id];
      const lo = makeLoadout(id, bundle, data.projectiles, data.machineGuns);
      const model = buildTank(renderer, lo, generatedTurretParts);
      scene.add(model.root);
      const e = new Enemy(id, bundle, model, terrain, sp, aim);
      e.loadout = lo;
      if (G.combat) useCombat(e, G.combat, id);
      G.enemies.push(e);
    });
  }
  /** The enemy a shell segment strikes first, with where. */
  function hitEnemy(p0, p1, skip = null) {
    let best = null;
    for (const e of G.enemies || []) {
      if (skip != null && e.remote && e.netId === skip) continue;
      const h = e.intersect(p0, p1);
      if (h && (!best || h.t < best.hit.t)) best = { e, hit: h };
    }
    return best;
  }
  /**
   * What the tracks and the hull collide with (sim/tank/obstacles.js): on the range the walls and
   * doors of the motor pool shed, on a battle map the other vehicles and the buildings, bunkers,
   * walls and hedgehogs near the vehicle.
   */
  const SHED = { x: GARAGE.x - 24, z: GARAGE.z };
  const RANGE_BOXES = [
    { x: SHED.x - 11, z: SHED.z - 12, yaw: 0, hx: 11, hz: 0.4, y0: -1, y1: 4 },
    { x: SHED.x - 11, z: SHED.z + 12, yaw: 0, hx: 11, hz: 0.4, y0: -1, y1: 4 },
    { x: SHED.x - 22, z: SHED.z, yaw: 0, hx: 0.3, hz: 12, y0: -1, y1: 8 },
    { x: SHED.x + 0.28, z: SHED.z - 9.6, yaw: 0, hx: 0.12, hz: 2.0, y0: -1, y1: 7.2 },
    { x: SHED.x + 0.28, z: SHED.z + 9.6, yaw: 0, hx: 0.12, hz: 2.0, y0: -1, y1: 7.2 },
  ];
  function obstacleBoxes() {
    const vehicles = (G.enemies || []).map((e) => {
      const y = e.veh.body.origin()[1];
      return { x: e.x, z: e.z, yaw: e.heading, hx: e.box.hw, hz: e.box.hl, y0: y - 1, y1: y + e.box.top };
    });
    if (G.map) return G.map.boxes.length ? [...vehicles, ...G.map.obstaclesNear(G.s.x, G.s.z, 14)] : vehicles;
    return vehicles.length ? [...RANGE_BOXES, ...vehicles] : RANGE_BOXES;
  }

  // ------------------------------------------------------------------ online
  // An online battle: the other players' vehicles are Enemy objects flagged `remote` in
  // G.enemies (so they block shells, sight lines and tracks like any vehicle), drawn where their
  // snapshots put them. The server keeps hit points, kills and respawns; this side sends its own
  // vehicle 20 times a second, its shots, and which plate each of its shells struck.
  const RESPAWN_DELAY = 5; // as crates/server/src/lobby.rs
  const RANGE_SPAWNS = { blue: { x: -4, z: 0, heading: 0 }, red: { x: -4, z: 430, heading: Math.PI } };
  const lateral = (k) => (k === 0 ? 0 : (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 9);
  /** Where a team's player in place `slot` starts: the team's start points, then side by side. */
  function onlineSpawn(team, slot, spawn = null) {
    let b;
    let row;
    if (!G.map) {
      b = RANGE_SPAWNS[team] || RANGE_SPAWNS.blue;
      row = slot;
    } else if (spawn != null) {
      // chosen on the deploy screen: that point, team mates side by side by their place
      const list = G.map.spawns[team] || G.map.spawns.blue;
      b = list[spawn % list.length];
      row = slot;
    } else {
      const list = G.map.spawns[team] || G.map.spawns.blue;
      b = list[slot % list.length];
      row = Math.floor(slot / list.length);
    }
    const off = lateral(row);
    return { x: b.x + off * Math.cos(b.heading), z: b.z - off * Math.sin(b.heading), heading: b.heading };
  }
  function spawnPoint() {
    if (G.online) return onlineSpawn(G.online.team, G.online.slot, G.online.spawn ?? null);
    return G.map.spawns.blue[G.spawnIdx % G.map.spawns.blue.length];
  }
  const playerName = (id) => (id === net.id ? net.name : G.online?.members.get(id)?.name || `#${id}`);
  const remoteOf = (id) => (G.enemies || []).find((e) => e.remote && e.netId === id);

  function addRemote(m) {
    const bundle = data.vehicles[m.vehicle];
    if (!bundle) return null;
    const lo = makeLoadout(m.vehicle, bundle, data.projectiles, data.machineGuns);
    const model = buildTank(renderer, lo, generatedTurretParts);
    scene.add(model.root);
    const e = new Enemy(m.vehicle, bundle, model, terrain, onlineSpawn(m.team, m.slot), null);
    e.loadout = lo;
    e.remote = true;
    e.netId = m.id;
    e.team = m.team;
    e.player = m.name;
    e.alive = m.alive !== false;
    e.hp = m.hp ?? 100;
    if (G.combat) useCombat(e, G.combat, m.vehicle);
    e.pose();
    G.enemies.push(e);
    return e;
  }
  function removeRemote(e) {
    scene.children = scene.children.filter((c) => c !== e.model.root);
    if (e.interior) e.interior.dispose();
    e.model.dispose();
    G.enemies = G.enemies.filter((x) => x !== e);
  }
  /** A player still on the deploy screen of a deploy room: nothing of theirs on the field yet. */
  const benchedMember = (m) => !!net.room?.deploy && m.alive === false;
  function spawnRemotes() {
    clearEnemies();
    for (const m of G.online.members.values()) if (m.id !== net.id && !benchedMember(m)) addRemote(m);
  }

  function feed(text, kind = 'info') {
    const el = document.getElementById('net-feed');
    const li = document.createElement('li');
    li.textContent = text;
    li.dataset.kind = kind;
    el.append(li);
    deploy.addChat(text);
    while (el.children.length > 7) el.firstChild.remove();
    setTimeout(() => li.remove(), 12000);
  }

  /** The score line at the top and the host's end button. */
  function updateNetHud(force = false) {
    const box = document.getElementById('net-score');
    const end = document.getElementById('net-end');
    const o = G.online;
    box.hidden = !o;
    end.hidden = !(o && net.isHost);
    if (!o) return;
    G.netHudT = (G.netHudT || 0) + 1;
    if (!force && G.netHudT % 8) return;
    const ms = [...o.members.values()];
    const kills = (t) => ms.filter((m) => m.team === t).reduce((a, m) => a + m.kills, 0);
    const me = o.members.get(net.id);
    let text = `藍方 ${kills('blue')} : ${kills('red')} 紅方　｜　${o.team === 'blue' ? '藍' : '紅'}方 ${playerName(net.id)}　擊毀 ${me ? me.kills : 0}　陣亡 ${me ? me.deaths : 0}　耐久 ${Math.max(0, o.hp).toFixed(0)}　${net.rtt.toFixed(0)} ms`;
    if (o.dead) {
      const wait = RESPAWN_DELAY - (performance.now() - o.diedAt) / 1000;
      text += wait > 0 ? `　｜　已被擊毀，${Math.ceil(wait)} 秒後可重生` : '　｜　按 R 重生';
    }
    if (box.textContent !== text) box.textContent = text;
    box.dataset.dead = o.dead ? '1' : '0';
  }

  // ---- conquest: the capture points and the tickets (online the server's, offline our own)
  const cqBar = document.getElementById('cq-bar');
  const cqMsg = document.getElementById('cq-msg');
  /** A point changing hands, told from our side. */
  function announcePoint(ev, mine) {
    if (ev.owner) feed(ev.owner === mine ? `我方佔領了 ${ev.id} 點` : `敵方佔領了 ${ev.id} 點`, ev.owner === mine ? 'info' : 'kill');
    else if (ev.lost) feed(ev.lost === mine ? `我方失去了 ${ev.id} 點` : `${ev.id} 點已中和`, ev.lost === mine ? 'kill' : 'info');
  }
  function conquestStep(dt) {
    const c = G.conquest;
    if (!c) {
      if (!cqBar.hidden) cqBar.hidden = true;
      if (cqMsg.textContent) cqMsg.textContent = '';
      return;
    }
    const mine = G.online ? G.online.team : 'blue';
    if (c.local && !c.winner) {
      // against the computer: we are blue, the computer's vehicles red
      const dead = !!(G.caps && G.caps.destroyed);
      if (dead && !G.cqDead) c.death('blue');
      G.cqDead = dead;
      for (const e of G.enemies || []) {
        if (e.cqAlive && !e.alive) c.death('red');
        e.cqAlive = e.alive;
      }
      const vs = [{ team: 'blue', x: G.s.x, z: G.s.z, alive: !dead }, ...(G.enemies || []).map((e) => ({ team: 'red', x: e.x, z: e.z, alive: e.alive }))];
      for (const ev of c.step(dt, vs)) announcePoint(ev, mine);
      if (c.winner) {
        hud.toast(c.winner === mine ? '勝利！敵方兵力耗盡' : '戰敗：我方兵力耗盡', 8);
        G.cqEndAt = performance.now() + 8000;
      }
    }
    if (G.cqEndAt && performance.now() > G.cqEndAt) {
      G.cqEndAt = 0;
      toGarage();
      return;
    }
    cqBar.hidden = false;
    const tk = c.tickets;
    const bar = (team, n) => `<div class="cq-tk" data-team="${team}"><i style="width:${Math.max(0, Math.min(100, (n / 1000) * 100)).toFixed(1)}%"></i><span>${Math.ceil(n)}</span></div>`;
    const here = (p) => Math.hypot(p.x - G.s.x, p.z - G.s.z) <= p.r;
    const pts = c.points
      .map((p) => {
        const fill = p.owner === 'blue' ? '#4f8cff' : p.owner === 'red' ? '#e8463a' : 'rgba(60,62,56,0.85)';
        const k = Math.min(1, Math.abs(p.progress || 0));
        const turning = p.progress > 0 ? '#4f8cff' : '#e8463a';
        const inner = k > 0 && !(p.owner && k >= 1) ? `<path d="M16 ${16 - 13 * k} L${16 + 13 * k} 16 L16 ${16 + 13 * k} L${16 - 13 * k} 16Z" fill="${turning}" opacity="0.9"/>` : '';
        return `<div class="cq-pt" data-here="${here(p) ? 1 : 0}"><svg viewBox="0 0 32 32"><path d="M16 2 L30 16 L16 30 L2 16Z" fill="${fill}" stroke="rgba(255,255,255,0.8)" stroke-width="1.5"/>${inner}</svg><b>${p.id}</b></div>`;
      })
      .join('');
    const html = bar('blue', tk[0]) + pts + bar('red', tk[1]);
    if (cqBar.innerHTML !== html) cqBar.innerHTML = html;
    const dead = G.online ? G.online.dead : !!(G.caps && G.caps.destroyed);
    const msg = dead ? '' : captureMessage(c.points, mine, G.s.x, G.s.z);
    if (cqMsg.textContent !== msg) cqMsg.textContent = msg;
  }
  net.on('capture', (m) => {
    if (!G.online) return;
    const before = G.conquest && !G.conquest.local ? G.conquest.points : null;
    if (before) {
      m.points.forEach((p, i) => {
        const b = before[i];
        if (!b || b.owner === p.owner) return;
        announcePoint(p.owner ? { id: p.id, owner: p.owner } : { id: p.id, owner: null, lost: b.owner }, G.online.team);
      });
    }
    G.conquest = { points: m.points, tickets: m.tickets, local: false };
  });

  function markDead(m) {
    const o = G.online;
    if (!o || o.dead) return;
    o.dead = true;
    o.diedAt = performance.now();
    G.fireHeld = false;
    G.pending.length = 0;
    G.cruise = null;
    if (G.view === 'sight') toggleSight();
    // a deploy room: the deploy screen comes up after a moment (the hit camera first)
    o.deployAt = net.room?.deploy ? performance.now() + 3000 : Infinity;
    const how = net.room?.deploy ? '稍後選擇下一台車（R 立即開啟）' : `${RESPAWN_DELAY} 秒後按 R 重生`;
    hud.toast(m && m.result !== 'scuttle' ? `被 ${playerName(m.from)} 擊毀　${how}` : `已棄車　${how}`, 6);
    updateNetHud(true);
  }

  /** R online: back in after the wait when knocked out; while alive, twice to abandon the vehicle. */
  function onlineRespawn() {
    const o = G.online;
    if (o.dead && net.room?.deploy) return openDeploy(o.benched ? '選擇出戰載具' : '重新出擊');
    if (o.dead) {
      const wait = RESPAWN_DELAY - (performance.now() - o.diedAt) / 1000;
      if (wait > 0) return hud.toast(`${Math.ceil(wait)} 秒後才能重生`, 1.5);
      net.send({ t: 'respawn' });
      return;
    }
    const now = performance.now();
    if (now - (o.scuttleAsk || 0) < 3000) {
      o.scuttleAsk = 0;
      net.send({ t: 'respawn' });
    } else {
      o.scuttleAsk = now;
      hud.toast('聯機時不能直接回出發點：3 秒內再按一次 R 棄車（算一次陣亡，5 秒後重生）', 3);
    }
  }

  /** Every frame of an online battle: the others where their snapshots say, ours out at 20 Hz. */
  function netStep(dt) {
    const o = G.online;
    const now = performance.now() / 1000;
    for (const e of G.enemies) if (e.remote) e.follow(now, dt);
    if (o.dead && !deploy.visible && performance.now() > (o.deployAt ?? Infinity)) {
      o.deployAt = Infinity;
      openDeploy('重新出擊');
    }
    deploy.update();
    // waiting on the deploy screen: nothing of ours is on the field
    if (o.benched) return;
    o.sendAcc += dt;
    if (o.sendAcc < 1 / SEND_HZ) return;
    o.sendAcc = Math.min(o.sendAcc - 1 / SEND_HZ, 1 / SEND_HZ);
    const ns = G.veh.netState();
    const r = (k) => (v) => Math.round(v * k) / k;
    net.send({
      t: 'state',
      s: {
        pos: ns.pos.map(r(1000)),
        ex: ns.ex.map(r(1e4)),
        ez: ns.ez.map(r(1e4)),
        v: ns.v.map(r(100)),
        w: ns.w.map(r(1000)),
        track: ns.track.map(r(100)),
        rpm: Math.round(ns.rpm || 0),
        gear: ns.gear,
        tur: G.T.map((t) => [r(1e4)(t.yaw), r(1e4)(t.guns[0] ? t.guns[0].pitch : 0)]),
        fold: r(1e4)(G.fold?.pose || 0),
        t: r(1000)(performance.now() / 1000),
        steer: ns.steer != null ? r(1000)(ns.steer) : undefined,
      },
    });
  }

  /** The first building, bunker, wall or hedgehog the segment p0 -> p1 meets on a battle map. */
  const buildingHit = (p0, p1) => (G.map ? G.map.segmentHit(p0, p1) : null);
  const MASONRY_DUST = [0.62, 0.58, 0.5];

  /** Where a segment strikes the player's own vehicle (the box round it), for the look of a hit. */
  function hitSelf(p0, p1) {
    const b = G.veh.body;
    const a = b.localPoint(p0);
    const e = b.localPoint(p1);
    const d = [e[0] - a[0], e[1] - a[1], e[2] - a[2]];
    const lo = [-G.dims.width / 2, 0, G.dims.rear];
    const hi = [G.dims.width / 2, G.model.height, -G.dims.rear];
    let t0 = 0;
    let t1 = 1;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-9) {
        if (a[k] < lo[k] || a[k] > hi[k]) return null;
        continue;
      }
      let u = (lo[k] - a[k]) / d[k];
      let v = (hi[k] - a[k]) / d[k];
      if (u > v) [u, v] = [v, u];
      t0 = Math.max(t0, u);
      t1 = Math.min(t1, v);
      if (t0 > t1) return null;
    }
    return [p0[0] + (p1[0] - p0[0]) * t0, p0[1] + (p1[1] - p0[1]) * t0, p0[2] + (p1[2] - p0[2]) * t0];
  }

  net.on('start', (m) => {
    const me = m.members.find((x) => x.id === net.id);
    if (!me || (G.online && G.mode === 'battle')) return;
    if (G.mode === 'battle') toGarage();
    if (G.mode === 'test') {
      testRange.exit();
      setMode('garage');
    }
    while (G.thumbs.length) thumbStep();
    // a deploy room: into the battle with nothing on the field, choosing on the deploy screen
    const benched = !!net.room?.deploy && me.alive === false;
    G.online = { team: me.team, slot: me.slot, members: new Map(m.members.map((x) => [x.id, x])), seq: 0, sendAcc: 0, dead: me.alive === false, benched, spawn: benched ? 0 : null, hp: me.hp ?? 100, diedAt: performance.now() - (benched ? RESPAWN_DELAY * 1000 : 0), deployAt: Infinity, scuttleAsk: 0 };
    G.conquest = null;
    if (!benched && me.vehicle && me.vehicle !== G.id && data.vehicles[me.vehicle]) select(me.vehicle);
    if (benched && !data.vehicles[G.id]) select(data.order[0]);
    if (!MAP_IDS.includes(m.map)) hud.toast(`這個版本沒有地圖「${m.map}」，改在靶場`, 4);
    setMapChoice(m.map);
    lobby.show(false);
    feed(`戰鬥開始：${mapName(m.map)}，${m.members.length} 人`);
    startBattle();
    if (benched) {
      // our vehicle is not there until it deploys
      scene.children = scene.children.filter((c) => c !== G.model.root);
      openDeploy('選擇出戰載具');
    }
  });
  net.on('room', (m) => {
    const o = G.online;
    if (!o) return;
    o.members = new Map(m.room.members.map((x) => [x.id, x]));
    for (const e of [...(G.enemies || [])]) {
      if (e.remote && !o.members.has(e.netId)) {
        feed(`${e.player} 離開了戰鬥`);
        removeRemote(e);
      }
    }
    for (const x of m.room.members) {
      if (x.id === net.id || G.mode !== 'battle' || remoteOf(x.id) || benchedMember(x)) continue;
      if (addRemote(x)) feed(`${x.name} 加入戰鬥（${vehicleName(x.vehicle)}）`);
    }
    updateNetHud(true);
  });
  net.on('snap', (m) => {
    const o = G.online;
    if (!o || G.mode !== 'battle') return;
    onlineSky(m);
    const now = performance.now() / 1000;
    for (const p of m.players) {
      if (p.id === net.id) {
        o.hp = p.hp;
        if (!p.alive && !o.dead) markDead(null);
        continue;
      }
      let e = remoteOf(p.id);
      if (!e) {
        const mem = o.members.get(p.id);
        if (!mem || !(e = addRemote(mem))) continue;
      }
      e.pushState(p.s, now);
      e.hp = p.hp;
      if (e.alive !== p.alive) {
        e.alive = p.alive;
        e.pose();
      }
    }
  });
  // a missile or rocket left a launcher: ours gets its id in the battle (to guide it); others' launch is seen
  const onlineLaunches = new OnlineLaunches();
  G.pendingLaunch = onlineLaunches.pending;
  const sendOnlineLaunch = msg => net.send(msg);
  const currentOnlineLaunch = p => p.session === G.online && G.loadout.turrets[p.ti]?.guns[p.gi] === p.gun;
  net.on('launched', (m) => {
    if (!G.online || G.mode !== 'battle' || !G.missiles) return;
    if (m.from === net.id) {
      const waiting = onlineLaunches.pending.find(p => p.msg.seq === m.seq);
      const gun = waiting && G.loadout.turrets[waiting.ti]?.guns[waiting.gi];
      const p = onlineLaunches.confirm(m.seq, m.missile, gun, G.online);
      if (!p) return; // duplicate or obsolete acknowledgement: never spend a second round
      const def = data.missiles[m.missile];
      if (def && def.guidance !== 'none') G.guided.push({ id: m.id, ti: p.ti, gi: p.gi, fresh: true });
      G.missiles._launchLook(m.missile, m.o || p.msg.o, m.d || p.msg.d);
      G.cam.shake = Math.min(1.2, G.cam.shake + (def?.guidance === 'none' ? 0.9 : 0.35));
      if (G.model.payload) G.model.payload(p.ti, p.gi, roundsLeft(p.gun));
    } else G.missiles._launchLook(m.missile, m.o, m.d);
  });
  net.on('launch_rejected', (m) => {
    if (!G.online || G.mode !== 'battle') return;
    onlineLaunches.reject(m.seq, m.retry_after_s, G.online);
  });
  net.on('fire', (m) => {
    if (!G.online || G.mode !== 'battle') return;
    const shell = data.projectiles[m.shell];
    if (!shell || !m.o.every(Number.isFinite) || !m.d.every(Number.isFinite)) return;
    G.shots.push({ s: ballistics.newShot(m.o, m.d, shell), shell, age: 0, origin: m.o.slice(), travelled: 0, from: m.from });
    const gy = surfaceAt(m.o[0], m.o[2]);
    const firingLoadout = m.from === net.id ? G.loadout : remoteOf(m.from)?.loadout;
    const automatic = firingLoadout?.turrets.some(t => t.guns.some(g => g.def.autocannon && g.def.ammo.includes(m.shell)));
    const dust = m.o[1] - gy < 3.2 ? impactColor([m.o[0], gy, m.o[2]]) : null;
    if (automatic && shell.caliber_mm >= 20) fx.autocannonBlast(m.o, m.d, shell.caliber_mm, dust, gy);
    else fx.muzzleBlast(m.o, m.d, shell.caliber_mm, dust, gy);
    if (Math.hypot(m.o[0] - G.s.x, m.o[2] - G.s.z) < 1500) sound.shot(shell.caliber_mm * 0.8);
  });
  net.on('damage', (m) => {
    const o = G.online;
    if (!o) return;
    const e = remoteOf(m.target);
    const rep = m.report || null;
    if (e) {
      e.hp = m.hp;
      // the server's word on what is left of it
      if (rep) {
        e.cstate = rep.state;
        e.caps = rep.caps;
      }
      if (m.killed) {
        e.alive = false;
        e.pose();
      }
    }
    if (m.target === net.id) {
      o.hp = m.hp;
      if (rep) {
        G.cstate = rep.state;
        G.caps = rep.caps;
      }
      if (m.killed) markDead(m);
      else if (rep && (rep.modules.length || rep.crew.length)) {
        hud.toast(`被 ${playerName(m.from)} 擊中：${rep.title}`, 3);
        G.cam.shake = 1.4;
        sound.impact(3, true);
      } else if (m.result === 'pen') {
        hud.toast(`被 ${playerName(m.from)} 擊穿！`, 3);
        G.cam.shake = 1.4;
        sound.impact(3, true);
      } else hud.toast(`${playerName(m.from)} 的炮彈：${(rep && rep.title) || RESULT_LABEL[m.result] || m.result}`, 2);
    } else if (m.from === net.id && m.killed) hud.hitMarker(RESULT_LABEL.kill, 'kill');
    if (m.killed) feed(m.result === 'scuttle' ? `${playerName(m.target)} 棄車` : `${playerName(m.from)} 擊毀了 ${playerName(m.target)}`, 'kill');
    updateNetHud(true);
  });
  net.on('status', (m) => {
    if (!G.online) return;
    if (m.id === net.id) {
      G.cstate = m.state;
      G.caps = m.caps;
      for (const ev of m.events) {
        if (ev.startsWith('seat:')) hud.toast(`${CREW_NAME[ev.slice(5)] || ev.slice(5)}的位置已有人接替`, 2.5);
        else if (ev === 'repair_started') hud.toast(`開始修理：約 ${Math.ceil(m.caps.repair_s)} 秒，修理時不能開動`, 3);
        else if (ev === 'extinguished') hud.toast('滅火中', 2);
        else if (EVENT_NAME[ev]) hud.toast(EVENT_NAME[ev], 2.5);
      }
    } else {
      const e = remoteOf(m.id);
      if (e) {
        e.cstate = m.state;
        e.caps = m.caps;
      }
    }
  });
  net.on('respawned', (m) => {
    const o = G.online;
    if (!o) return;
    if (m.id === net.id) {
      const first = o.benched;
      o.dead = false;
      o.benched = false;
      o.hp = 100;
      if (m.spawn != null && net.room?.deploy) o.spawn = m.spawn;
      deploy.close();
      // a fresh vehicle (the one chosen, with the rounds chosen) at the chosen start
      const id = m.vehicle && data.vehicles[m.vehicle] ? m.vehicle : G.id;
      select(id);
      if (G.view === 'sight') toggleSight();
      G.view = 'third';
      hud.toast(first ? `${G.loadout.name} 出擊！` : `重新出擊：${G.loadout.name}`, 2.5);
      const mem = o.members.get(net.id);
      if (mem) {
        mem.vehicle = id;
        mem.alive = true;
      }
    } else {
      // a new vehicle (perhaps another type): the wreck, its blown-off turret and its fires go
      const e = remoteOf(m.id);
      const mem = o.members.get(m.id);
      if (mem) {
        if (m.vehicle) mem.vehicle = m.vehicle;
        mem.alive = true;
        mem.hp = 100;
      }
      if (e) removeRemote(e);
      if (mem && G.mode === 'battle') addRemote(mem);
    }
    updateNetHud(true);
  });
  net.on('ended', (m) => {
    if (!G.online) return;
    const board = m.members.slice().sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const mine = G.online.team;
    G.online = null;
    G.conquest = null;
    deploy.close();
    toGarage();
    lobby.show(true);
    const result = m.winner ? (m.winner === mine ? '勝利！' : '戰敗') + '　' : '';
    hud.toast(`戰鬥結束　${result}最多擊毀：${board[0] ? `${board[0].name}（${board[0].kills}）` : '—'}`, 6);
  });
  net.on('chat', (m) => {
    if (G.online) feed(`${m.name}：${m.text}`, 'chat');
  });
  net.on('error', (m) => {
    if (G.mode === 'battle' || !lobby.visible) hud.toast(m.msg, 3);
  });
  // the connection dropped in a battle: the game goes on while the client takes the seat back
  net.on('reconnecting', () => {
    if (G.online) hud.toast('與伺服器的連線中斷，重新連線中…', 18);
  });
  net.on('resumed', () => {
    if (G.online) {
      retryPendingLaunches(true);
      hud.toast('已重新連線', 2.5);
    }
  });
  for (const t of ['closed', 'left_room']) {
    net.on(t, () => {
      if (!G.online) return;
      G.online = null;
      deploy.close();
      toGarage();
      hud.toast(t === 'closed' ? '與伺服器的連線中斷' : '已離開房間', 4);
    });
  }
  const chatIn = document.getElementById('net-chat');
  function openChat() {
    chatIn.hidden = false;
    chatIn.focus();
  }
  chatIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (chatIn.value.trim()) net.send({ t: 'chat', text: chatIn.value });
      chatIn.value = '';
    }
    if (e.key === 'Enter' || e.key === 'Escape') {
      chatIn.hidden = true;
      canvas.focus();
    }
    e.stopPropagation();
  });
  document.getElementById('net-end').addEventListener('click', (e) => {
    e.currentTarget.blur();
    net.send({ t: 'end' });
  });

  // ------------------------------------------------------------------ damage
  // Shots on data vehicles go through the combat model (crates/combat): modules and crew, no hit
  // points. What it leaves of the player's own vehicle drives the controls (update()).

  /** A seed every client and the server derive the same way for the same shot. */
  function shotSeed(sh) {
    if (G.online && sh.seq) return ((net.id * 1000003 + sh.seq * 7919) >>> 0) || 1;
    return ((rng.nextF32() * 4294967295) >>> 0) || 1;
  }
  const rnd = (k) => (v) => Math.round(v * k) / k;
  /** The hull-space shot as it goes over the wire to the server. */
  function wireShot(shot) {
    return { o: shot.origin.map(rnd(1e4)), d: shot.dir.map(rnd(1e5)), yaw: rnd(1e4)(shot.turret_yaw), speed: Math.round(shot.speed_ms), dist: Math.round(shot.distance_m), seed: shot.seed };
  }

  /** After a hit on another vehicle: effects of what went off inside, and the hit camera. */
  function onCombatHit(e, rep, shell, dist, mg = false, detail = '') {
    const o = e.veh.body.origin();
    const top = [o[0], o[1] + (e.box ? e.box.top : 2), o[2]];
    if (rep.events.includes('ammo_detonation')) {
      fx.ammoExplosion(top);
      // the turret goes up with it
      if (e.model.turrets[0] && !e.toss) e.toss = { t: 0, y: 0, vy: 9 + Math.random() * 5, spin: (Math.random() - 0.5) * 3, tilt: (Math.random() - 0.5) * 2 };
      sound.impact(1, true);
    }
    hitcam.show(camTarget(e), rep, shell, dist, mg, detail);
    G.lastCombat = { id: e.id, title: rep.title, outcome: rep.outcome, events: rep.events.slice(), crew: rep.crew.length, modules: rep.modules.length, destroyed: rep.caps.destroyed, mg };
  }

  /** A shell bursting on the ground near other vehicles: their running gear and open crews. */
  function splashNear(pt, shell) {
    const kg = shell.explosive_mass_kg || 0;
    if (kg < 0.1 || !G.combat) return;
    const r = 1.6 * Math.cbrt(kg) + 0.5 + 4;
    for (const e of G.enemies || []) {
      if (!e.combat || !e.alive || (e.remote && G.online)) continue;
      if (Math.hypot(e.x - pt[0], e.z - pt[2]) > r + e.radius) continue;
      const local = e.veh.body.localPoint(pt);
      const rep = G.combat.splash(e.combatKey, e.cstate, local, kg, e.turretYaw || 0, (rng.nextF32() * 4294967295) >>> 0);
      e.cstate = rep.state;
      e.caps = rep.caps;
      if (rep.modules.length || rep.crew.length) {
        if (rep.caps.destroyed && e.alive) {
          e.alive = false;
          e.pose();
        }
        hud.hitMarker(rep.title, 'pen');
        hud.toast(`${e.name}：近彈 ${rep.title}`, 3);
      }
    }
  }

  // ------------------------------------------------------- missiles and active protection
  // crates/missile flies missiles and rockets and runs the active protection systems (the
  // Oplot-MO); here: who is where for it, the gunner's line for wire-guided missiles, what a
  // missile strikes, the protection gun driving its turret, the panel, and enemy launchers.
  const ME = 1; // the player's id in the missile world; enemies are 100 + their index
  const enemyOwner = (i) => 100 + i;

  /** The battle's ground for the missile world: the map's height grid, or the range sampled. */
  function missileTerrain() {
    if (G.map) return { x0: G.map.x0, z0: G.map.z0, size: G.map.size, res: G.map.hres, heights: Array.from(G.map.heights, (v) => Math.round(v * 100) / 100) };
    const n = 256;
    const size = 2048;
    const x0 = G.s.x - size / 2;
    const z0 = G.s.z - size / 2;
    const heights = new Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = Math.round(groundAt(x0 + ((i + 0.5) * size) / n, z0 + ((j + 0.5) * size) / n) * 100) / 100;
    return { x0, z0, size, res: n, heights };
  }

  function missileBattleStart() {
    if (!G.missiles) return;
    G.missiles.reset(missileTerrain());
    onlineLaunches.clear();
    G.guided = [];
    G.apsOn = true;
    G.apsState = null;
    G.apsFault = false;
    missileVehicle();
    (G.enemies || []).forEach((e, i) => {
      const aps = e.bundle.weapons?.aps;
      if (aps && !e.remote) G.missiles.addAps(enemyOwner(i), 1, aps, 11 + i);
      e.mslT = 6 + i * 4;
      e.mslIds = [];
      e.mslLoading = null;
    });
  }

  /** The player's vehicle in the missile world: its active protection, if it carries one. */
  function missileVehicle() {
    if (!G.missiles) return;
    G.missiles.removeAps(ME);
    G.aps = data.vehicles[G.id]?.weapons?.aps || null;
    if (G.aps) G.missiles.addAps(ME, 0, G.aps, 3);
    hud.aps(null);
  }

  /** I: fold the upper flaps of an open compartment down (wider arc for the guns) or raise them. */
  function toggleFlaps() {
    if (!G.model || !G.model.hasFlaps) return hud.toast('這輛車沒有可收放的護板', 1.5);
    G.fold.target = G.fold.target > 0.5 ? 0 : 1;
    G.fold.waiting = false;
    sound.tone(G.fold.target ? 'on' : 'off');
    hud.toast(G.fold.target ? '護板放下：完成後擴大射界（I 收起）' : '護板升起（I 放下）', 2);
  }

  function advanceFold(dt) {
    if (!G.fold || !G.model?.hasFlaps || G.fold.cur === G.fold.target) return;
    const delta = G.fold.target - G.fold.cur;
    const next = Math.abs(delta) < dt / 1.5 ? G.fold.target : G.fold.cur + Math.sign(delta) * dt / 1.5;
    const pose = smoothFold(next), t = G.loadout.turrets[0], rt = G.T[0];
    const limit = foldYawLimit(t, pose);
    const bearing = gunnery.wrapPi(rt.yaw - t.facing);
    const safeYaw = !limit || (bearing >= limit[0] - 1e-6 && bearing <= limit[1] + 1e-6);
    const safePitch = t.guns.every((g, gi) => rt.guns[gi].pitch >= -foldDepression(t, rt.yaw, g.def.max_depression_deg, pose) * DEG - 1e-6);
    if (!safeYaw || !safePitch) {
      if (G.mode === 'garage') {
        // Garage input only orbits the camera; move the display gun gradually
        // into clearance so the same I control can complete there too.
        if (!safeYaw && limit) gunnery.traverseLimited(rt, t.facing + clamp(bearing, limit[0], limit[1]), t.facing, null, t.traverse * DEG, dt);
        t.guns.forEach((g, gi) => {
          const clearance = -foldDepression(t, rt.yaw, g.def.max_depression_deg, pose) * DEG;
          if (rt.guns[gi].pitch < clearance) gunnery.elevate(g.def, rt.guns[gi], clearance + .002, 1, dt);
        });
      }
      if (!G.fold.waiting) hud.toast(G.mode === 'garage' ? '正在調整炮位，避讓護板' : '護板暫停：先抬炮或轉回安全射界，再繼續收放', 3);
      G.fold.waiting = true;
      return;
    }
    G.fold.waiting = false;
    G.fold.cur = next;
    G.fold.pose = pose;
    G.model.setFold(pose);
    G.combat?.setFold(G.id, pose);
  }

  function toggleAps() {
    if (!G.aps || !G.missiles) return hud.toast('這輛車沒有主動防禦系統', 1.5);
    G.apsOn = !G.apsOn;
    const g = G.loadout.turrets[G.aps.turret ?? 1].guns[0];
    G.missiles.setAps(ME, G.apsOn, null, roundsLeft(g));
    if (G.online) net.send({ t: 'aps', enabled: G.apsOn });
    sound.tone(G.apsOn ? 'on' : 'off');
    hud.toast(G.apsOn ? `${G.aps.name}：自動攔截已開啟（U 關閉，Y 換射速）` : `${G.aps.name}：已關閉，可用 N 手動射擊`, 2.5);
  }

  function cycleApsRate() {
    if (!G.aps || !G.missiles) return;
    const [lo, hi] = G.aps.rate_range_rpm || [G.aps.rate_rpm, G.aps.rate_rpm];
    const cur = G.apsState ? G.apsState.rate_rpm : G.aps.rate_rpm;
    const next = cur >= hi - 1 ? lo : Math.min(hi, cur + 1000);
    G.missiles.setAps(ME, G.apsOn, next);
    if (G.online) net.send({ t: 'aps', enabled: G.apsOn, rate: next });
    hud.toast(`${G.aps.name} 射速 ${next} 發/分`, 1.5);
  }

  /** A turret's gun mount (hull frame) for given turret yaws (a turret on another is carried round). */
  function mountFor(lo, yaws, ti) {
    const t = lo.turrets[ti];
    const g = t.guns[0];
    let pv = t.pivot;
    if (t.parent != null) {
      const p = lo.turrets[t.parent];
      pv = gunnery.muzzleLocal({ pivot: p.pivot, trunnion: t.pivot, muzzleOffset: 0 }, { yaw: yaws[t.parent] || 0, pitch: 0 }).trunnion;
    }
    return { pivot: pv, trunnion: [g.trunnion[0] + pv[0] - t.pivot[0], g.trunnion[1] + pv[1] - t.pivot[1], g.trunnion[2] + pv[2] - t.pivot[2]], muzzleOffset: g.muzzleOffset, muzzleVector: g.muzzleVector };
  }

  const moduleOk = (bundle, cstate, id) => {
    if (!id || !cstate || !bundle) return true;
    const i = bundle.modules.findIndex((m) => m.id === id);
    return i < 0 || cstate.modules[i] > 0;
  };

  /** Where the protection gun of a vehicle stands, and the bearing of the turret it rides on. */
  function apsOf(actor, aps, lo, yaws, ps, bundle, cstate) {
    if (!aps) return;
    const ti = aps.turret ?? 1;
    actor.aps_pivot = gunnery.muzzleWorld(ps, mountFor(lo, yaws, ti), { yaw: yaws[ti] || 0, pitch: 0 }).trunnion;
    actor.aps_base_yaw = ps.heading + (yaws[lo.turrets[ti].parent ?? 0] || 0);
    actor.aps_gun_ok = moduleOk(bundle, cstate, aps.gun_module);
    actor.aps_radar_ok = moduleOk(bundle, cstate, aps.radar_module);
  }

  const enemyPose = (e) => ({ pos: [e.x, e.veh.body.origin()[1], e.z], heading: e.heading });
  const enemyYaws = (e) => e.turretYaws || e.loadout.turrets.map((t, k) => (k === 0 ? e.turretYaw || 0 : 0));
  const playerMiddle = () => gunnery.toWorldPoint(pose(), [0, G.model.height * 0.45, (G.dims.front + G.dims.rear) / 2]);

  function missileStep(dt) {
    if (!G.missiles) return;
    if (G.online) return onlineMissiles(dt);
    const actors = [];
    const mine = { id: ME, team: 0, alive: !(G.caps && G.caps.destroyed), center: playerMiddle(), vel: G.veh.body.v.slice() };
    apsOf(mine, G.aps, G.loadout, G.T.map((t) => t.yaw), pose(), data.vehicles[G.id], G.cstate);
    actors.push(mine);
    (G.enemies || []).forEach((e, i) => {
      const o = e.veh.body.origin();
      const a = { id: enemyOwner(i), team: 1, alive: e.alive, center: [o[0], o[1] + e.box.top * 0.5, o[2]], vel: [0, 0, 0] };
      apsOf(a, e.bundle.weapons?.aps, e.loadout, enemyYaws(e), enemyPose(e), e.bundle, e.cstate);
      actors.push(a);
    });
    // the gunner holds the sight on the target: each of our wire-guided missiles follows the line
    G.guided = (G.guided || []).filter((m) => G.missiles.nodes.has(m.id) || m.fresh);
    for (const m of G.guided) {
      m.fresh = false;
      const t = G.loadout.turrets[m.ti];
      const sight = gunnery.muzzleWorld(pose(), mountOf(t, t.guns[m.gi]), { yaw: G.T[m.ti].yaw, pitch: 0 }).trunnion;
      if (G.aimPoint) G.missiles.guide(m.id, ME, sight, G.aimPoint);
    }
    const res = G.missiles.step(dt, actors);
    applyAps(res, mine);
    missileImpacts(res);
  }

  /** Online: the server flies the missiles; we send our gunner's line and our missiles' building strikes. */
  function onlineMissiles(dt) {
    G.missiles.local = false;
    retryPendingLaunches();
    G.guideAcc = (G.guideAcc || 0) + dt;
    G.guided = (G.guided || []).filter((m) => G.missiles.nodes.has(m.id) || m.fresh);
    if (G.guideAcc >= 1 / SEND_HZ) {
      G.guideAcc = 0;
      for (const m of G.guided) {
        const t = G.loadout.turrets[m.ti];
        const sight = gunnery.muzzleWorld(pose(), mountOf(t, t.guns[m.gi]), { yaw: G.T[m.ti].yaw, pitch: 0 }).trunnion;
        if (G.aimPoint) net.send({ t: 'guide', id: m.id, sight: sight.map((v) => Math.round(v * 100) / 100), aim: G.aimPoint.map((v) => Math.round(v * 100) / 100) });
      }
    }
    for (const sg of G.missiles.segments()) {
      if (sg.owner !== net.id) continue;
      const bh = buildingHit(sg.p0, sg.p1);
      if (bh) {
        net.send({ t: 'missile_end', id: sg.id });
        const def = data.missiles[sg.def];
        if (def) fx.shellGround(bh.point, MASONRY_DUST, data.projectiles[def.warhead]);
        G.missiles.end(sg.id);
      }
    }
  }

  /** Online: a server snapshot's missiles, protection systems, tracers and what happened. */
  function onlineSky(m) {
    if (!G.missiles) return;
    G.missiles.local = false;
    const res = { missiles: m.ms || [], aps: m.aps || [], events: m.ev || [], fired: m.fired || [] };
    G.missiles.present(res, 1 / 20);
    if (!G.aps) return;
    const b = data.vehicles[G.id];
    const mine = { aps_gun_ok: moduleOk(b, G.cstate, G.aps.gun_module), aps_radar_ok: moduleOk(b, G.cstate, G.aps.radar_module) };
    // our own system, as the server runs it
    const own = res.aps.filter((a) => a.owner === net.id).map((a) => ({ ...a, owner: ME }));
    const evs = res.events.filter((e) => e.aps === net.id).map((e) => ({ ...e, aps: ME }));
    applyAps({ aps: own, events: evs }, mine);
  }

  function applyAps(res, mine) {
    let loud = null;
    for (const a of res.aps) {
      if (a.owner === ME && G.aps) {
        const ti = G.aps.turret ?? 1;
        const g = G.loadout.turrets[ti].guns[0];
        if (a.enabled && a.mode !== 'dead') {
          // the system lays its own turret (its yaw is kept in the hull frame, as every turret's)
          G.T[ti].yaw = gunnery.wrapPi(a.yaw - G.s.heading);
          G.T[ti].guns[0].pitch = a.pitch;
          // the rounds it fires come out of the gun's own belt
          let over = roundsLeft(g) - a.rounds;
          for (const am of g.ammo) {
            const k = Math.min(am.count, Math.max(0, over));
            am.count -= k;
            over -= k;
          }
          if (a.firing && Math.random() < 0.5) G.cam.shake = Math.min(0.5, G.cam.shake + 0.05);
        }
        const fault = !mine.aps_gun_ok || !mine.aps_radar_ok;
        if (fault && !G.apsFault) {
          sound.tone('fault');
          hud.toast(`${G.aps.name}：${!mine.aps_gun_ok ? '機槍' : '雷達'}被擊毀，系統故障`, 3);
        }
        G.apsFault = fault;
        G.apsState = a;
        const blips = (a.track_pos || []).map((p) => ({ bearing: gunnery.wrapPi(Math.atan2(p[0] - G.s.x, p[2] - G.s.z) - G.s.heading), range: Math.hypot(p[0] - G.s.x, p[2] - G.s.z) }));
        hud.aps({ ...a, name: G.aps.name, gunOk: mine.aps_gun_ok, radarOk: mine.aps_radar_ok, blips });
      } else if (a.owner >= 100) {
        const e = (G.enemies || [])[a.owner - 100];
        const aps = e?.bundle.weapons?.aps;
        if (!e || !aps || !e.alive) continue;
        const ti = aps.turret ?? 1;
        if (!e.turretYaws) e.turretYaws = enemyYaws(e).slice();
        e.turretYaws[0] = e.turretYaw || 0;
        e.turretYaws[ti] = gunnery.wrapPi(a.yaw - e.heading);
        e.gunPitch[ti] = a.pitch;
        e.pose();
      }
      // the gun nearest the camera is the one we hear
      if (a.spin > 0.01 || a.firing) {
        const owner = a.owner === ME ? [G.s.x, 2, G.s.z] : (() => {
          const e = (G.enemies || [])[a.owner - 100];
          return e ? [e.x, 2, e.z] : null;
        })();
        if (owner) {
          const d = Math.hypot(owner[0] - G.camPos[0], owner[2] - G.camPos[2]);
          if (!loud || d < loud.d) loud = { a, d };
        }
      }
    }
    if (loud) sound.apsGun(loud.a.spin, loud.a.firing, loud.a.rate_rpm, loud.d);
    else sound.apsGun(0, false, 0, 1000);
    for (const e of res.events) {
      if (e.aps !== ME) continue;
      if (e.type === 'detect') sound.tone('detect');
      else if (e.type === 'lock') sound.tone('lock');
      else if (e.type === 'overheat') {
        sound.tone('overheat');
        hud.toast(`${G.aps.name}：槍管過熱，暫停射擊`, 2);
      } else if (e.type === 'empty') {
        sound.tone('empty');
        hud.toast(`${G.aps.name}：彈藥耗盡`, 2.5);
      } else if (e.type === 'intercept') hud.toast(`${G.aps.name}：攔截成功（${e.kind === 'airburst' ? '戰鬥部空中引爆' : '彈體解體'}）`, 2);
    }
  }

  /** A missile's warhead striking: a vehicle (through the combat model), a building or the ground. */
  function missileImpacts(res) {
    const seed = () => (rng.nextF32() * 4294967295) >>> 0;
    for (const sg of G.missiles.segments()) {
      const def = data.missiles[sg.def];
      const war = def && data.projectiles[def.warhead];
      if (!war) continue;
      const { p0, p1 } = sg;
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      if (len < 1e-6) continue;
      const speed = Math.hypot(sg.vel[0], sg.vel[1], sg.vel[2]) || 1;
      const dir = [sg.vel[0] / speed, sg.vel[1] / speed, sg.vel[2] / speed];
      let best = null;
      const bh = buildingHit(p0, p1);
      if (bh) best = { t: bh.t, kind: 'building', point: bh.point };
      (G.enemies || []).forEach((e, i) => {
        if (enemyOwner(i) === sg.owner) return;
        const h = e.intersect(p0, p1);
        if (h && (!best || h.t < best.t)) best = { t: h.t, kind: 'enemy', e, hit: h, point: h.point || [p0[0] + (p1[0] - p0[0]) * h.t, p0[1] + (p1[1] - p0[1]) * h.t, p0[2] + (p1[2] - p0[2]) * h.t] };
      });
      if (sg.owner !== ME && G.mode === 'battle') {
        const pt = hitSelf(p0, p1);
        if (pt) {
          const t = Math.hypot(pt[0] - p0[0], pt[1] - p0[1], pt[2] - p0[2]) / len;
          if (!best || t < best.t) best = { t, kind: 'self', point: pt };
        }
      }
      if (!best) continue;
      G.missiles.end(sg.id);
      const dist = sg.owner === ME ? Math.hypot(best.point[0] - G.s.x, best.point[2] - G.s.z) : 500;
      if (best.kind === 'building') {
        fx.shellGround(best.point, MASONRY_DUST, war);
        sound.blast(war.explosive_mass_kg || 1, Math.hypot(best.point[0] - G.camPos[0], best.point[2] - G.camPos[2]));
        splashNear(best.point, war);
      } else if (best.kind === 'enemy') {
        const e = best.e;
        if (!e.combat || !e.alive) {
          fx.shellArmor(best.point, dir, null, war, 'stopped');
          continue;
        }
        const rep = combatHit(e, p0, dir, war, speed, dist, seed());
        const nrm = rep.normal ? e.veh.body.worldDir(arr3(rep.normal)) : null;
        fx.shellArmor(best.point, dir, nrm, war, rep.outcome);
        sound.impact(Math.hypot(best.point[0] - G.camPos[0], best.point[2] - G.camPos[2]), true);
        if (sg.owner === ME) {
          onCombatHit(e, rep, war, dist, false, `${def.name}`);
          hud.hitMarker(rep.title, rep.caps.destroyed ? 'kill' : rep.outcome === 'penetrated' ? 'pen' : 'nopen');
        }
      } else {
        selfMissileHit(p0, dir, war, speed, def);
      }
    }
  }

  /** A missile or rocket into the ground: its warhead's burst, and the blast on what stands near. */
  function missileGround(pt, def) {
    const war = def && data.projectiles[def.warhead];
    if (!war) return;
    fx.shellGround(pt, impactColor(pt), war);
    sound.blast(war.explosive_mass_kg || 1, Math.hypot(pt[0] - G.camPos[0], pt[2] - G.camPos[2]));
    splashNear(pt, war);
  }

  /** An enemy missile striking our own vehicle (offline): the same combat model, from its side. */
  function selfMissileHit(p0, dir, war, speed, def) {
    const pt = p0;
    fx.shellArmor(pt, dir, null, war, 'penetrated');
    G.cam.shake = 1.6;
    sound.impact(2, true);
    if (!G.combat || !G.cstate) return;
    const b = G.veh.body;
    const shot = { shell: war, origin: b.localPoint([p0[0] - dir[0] * 2, p0[1] - dir[1] * 2, p0[2] - dir[2] * 2]), dir: b.localDir(dir), speed_ms: speed, distance_m: 500, seed: (rng.nextF32() * 4294967295) >>> 0, turret_yaw: G.T[0].yaw };
    const rep = G.combat.shoot(G.id, G.cstate, shot);
    G.cstate = rep.state;
    G.caps = rep.caps;
    hud.toast(`被${def.name}擊中：${rep.title}`, 3.5);
  }

  /** Enemy missile launchers (offline): turn on the player, launch when they see them, guide. */
  function aiMissiles(dt) {
    if (!G.missiles?.ready || G.online || G.mode !== 'battle' || (G.caps && G.caps.destroyed)) return;
    const target = playerMiddle();
    (G.enemies || []).forEach((e, i) => {
      if (!e.alive || e.remote || !e.loadout) return;
      let ti = -1;
      let gi = -1;
      e.loadout.turrets.forEach((t, a) => t.guns.forEach((g, b) => {
        if (g.def.missile && ti < 0) [ti, gi] = [a, b];
      }));
      if (ti < 0) return;
      const owner = enemyOwner(i);
      const t = e.loadout.turrets[ti];
      const g = t.guns[gi];
      const mdef = data.missiles[g.def.missile];
      if (!mdef) return;
      if (!e.mslLoading) e.mslLoading = loading.newLoading(1, 1);
      tickLauncher(g, dt);
      const done = loading.tick(e.mslLoading, dt, () => g.def.reload_s);
      if (done.length) {
        g.loaded = nextAmmo(g);
        syncGunShell(g);
        refillLauncher(g);
        if (g.loaded < 0) e.mslLoading.state[0] = 'empty';
      }
      // the launcher turns onto the player
      const yaw = gunnery.wrapPi(Math.atan2(target[0] - e.x, target[2] - e.z) - e.heading);
      if (ti === 0) e.turretYaw = yaw;
      if (!e.turretYaws && ti > 0) e.turretYaws = enemyYaws(e);
      if (e.turretYaws) e.turretYaws[ti] = yaw;
      e.pose();
      const ps = enemyPose(e);
      const firstMount = mountFor(e.loadout, enemyYaws(e), ti);
      const mount = { ...firstMount, trunnion: firstMount.trunnion.map((v, k) => v + g.trunnion[k] - t.guns[0].trunnion[k]), muzzleOffset: g.muzzleOffset, muzzleVector: g.muzzleVector };
      const sight = gunnery.muzzleWorld(ps, mount, { yaw: enemyYaws(e)[ti] || 0, pitch: 0 }).trunnion;
      // Every live missile keeps guidance while another loaded tube is prepared.
      e.mslIds = (e.mslIds || []).filter((id) => G.missiles.nodes.has(id));
      for (const id of e.mslIds) {
        const w = (k) => Math.sin(G.time * (1.3 + k) + i * 2.1) * 0.35;
        G.missiles.guide(id, owner, sight, [target[0] + w(0), target[1] + w(1) * 0.5, target[2] + w(2)]);
      }
      e.mslT = Math.max(0, (e.mslT ?? 6) - dt);
      if (e.mslT > 1e-9 || e.mslLoading.state[0] !== 'ready' || !g.launcher?.ready || g.launcher.cooldown > 1e-9) return;
      const d = Math.hypot(target[0] - sight[0], target[1] - sight[1], target[2] - sight[2]);
      if (d > mdef.max_range_m || d < mdef.min_range_m * 1.5 || roundsLeft(g) <= 0) {
        e.mslT = 2;
        return;
      }
      // it needs to see the target
      const dirT = [(target[0] - sight[0]) / d, (target[1] - sight[1]) / d, (target[2] - sight[2]) / d];
      // (from clear of its own hull)
      const from = [sight[0] + dirT[0] * 5, sight[1] + dirT[1] * 5, sight[2] + dirT[2] * 5];
      const seen = losHit(from, dirT, d - 9);
      if (seen && seen.t < d - 11) {
        e.mslT = 2;
        return;
      }
      const pitch = Math.atan2(target[1] - sight[1], Math.hypot(target[0] - sight[0], target[2] - sight[2])) + 0.02;
      const mz = gunnery.muzzleWorld(ps, launcherMount(g, mount), { yaw: enemyYaws(e)[ti] || 0, pitch });
      const id = G.missiles.launch(mdef.id, owner, 1, mz.pos, mz.dir, ((i + 1) * 7919 + Math.floor(G.time * 1000)) >>> 0);
      if (id == null) return;
      e.mslIds.push(id);
      fireLauncherRound(g, e.mslLoading, 0);
      e.gunPitch[ti] = pitch;
      e.pose();
      e.mslT = g.launcher.ready > 0 ? 0.25 : g.def.reload_s;
      hud.toast(`${e.name} 發射 ${mdef.name}！`, 2.5);
    });
  }

  /** A timeout or resumed connection repeats the same request, never a new unconfirmed shot. */
  function retryPendingLaunches(force = false) {
    if (!G.online || !net.open || !onlineLaunches.pending.length) return;
    // Network timeouts keep real seconds even when the render loop clamps a slow frame's game dt.
    onlineLaunches.retry(performance.now() / 1000, sendOnlineLaunch, currentOnlineLaunch, force);
  }

  /** A gun that fires missiles or rockets: launched into the missile world, guided from the sight. */
  function launchFromGun(ti, gi, mz) {
    const t = G.loadout.turrets[ti];
    const g = t.guns[gi];
    const rt = G.T[ti];
    const mdef = data.missiles[g.def.missile];
    if (!G.missiles?.ready || !mdef || !g.launcher?.ready || g.launcher.cooldown > 1e-9 || g.loaded < 0 || !(g.ammo[g.loaded]?.count > 0)) return false;
    if (G.online) {
      // Reserve one tube until the server confirms it; jitter must never spend a rejected round.
      if (!net.open || onlineLaunches.has(g)) return false;
      const seq = ++G.online.seq;
      const msg = { t: 'launch', seq, missile: mdef.id, o: mz.pos.map((v) => Math.round(v * 1000) / 1000), d: mz.dir.map((v) => Math.round(v * 1e5) / 1e5) };
      if (!onlineLaunches.begin({ gun: g, loading: rt.loading, ti, gi, msg, session: G.online }, performance.now() / 1000)) return false;
      net.send(msg);
      return true;
    } else {
      const id = G.missiles.launch(mdef.id, ME, 0, mz.pos, mz.dir, (rng.nextF32() * 4294967295) >>> 0);
      if (id == null) return false;
      if (mdef.guidance !== 'none') G.guided.push({ id, ti, gi, fresh: true });
    }
    G.cam.shake = Math.min(1.2, G.cam.shake + (mdef.guidance === 'none' ? 0.9 : 0.35));
    fireLauncherRound(g, rt.loading, gi);
    // the round is gone from its rail
    if (G.model.payload) G.model.payload(ti, gi, roundsLeft(g));
    return true;
  }

  /** Time passing for every vehicle's damage: fire, crew changing seats, repairs (offline). */
  function advanceCombat(dt) {
    G.combatAcc += dt;
    if (G.combatAcc < 0.25 || !G.combat) return;
    const step = G.combatAcc;
    G.combatAcc = 0;
    const busy = (st) => st && (st.fire_s > 0 || st.repair_s > 0 || (st.swaps && st.swaps.length));
    syncRacks();
    if (!G.online && busy(G.cstate)) {
      const r = G.combat.advance(G.id, G.cstate, step, (rng.nextF32() * 4294967295) >>> 0);
      G.cstate = r.state;
      G.caps = r.caps;
      for (const ev of r.events) {
        if (ev.startsWith('seat:')) hud.toast(`${CREW_NAME[ev.slice(5)] || ev.slice(5)}的位置已有人接替`, 2.5);
        else if (EVENT_NAME[ev]) hud.toast(EVENT_NAME[ev], 2.5);
      }
    }
    for (const e of G.enemies || []) {
      if (!e.combat || (e.remote && G.online) || !busy(e.cstate)) continue;
      const r = G.combat.advance(e.combatKey, e.cstate, step, (rng.nextF32() * 4294967295) >>> 0);
      e.cstate = r.state;
      e.caps = r.caps;
      if (r.caps.destroyed && e.alive) {
        e.alive = false;
        e.pose();
      }
    }
  }

  /** J: field repair of what is broken (standing still). K: the fire extinguisher. */
  function repairVehicle() {
    if (!G.cstate || G.mode !== 'battle') return;
    if (G.caps.repair_s > 0) return hud.toast(`修理中，還要 ${Math.ceil(G.caps.repair_s)} 秒`, 2);
    if (Math.abs(G.s.u) > 1) return hud.toast('要停車才能修理', 2);
    if (G.online) return net.send({ t: 'repair' });
    const r = G.combat.repair(G.id, G.cstate);
    if (!r.ok) return hud.toast(r.caps.destroyed ? '車已被擊毀' : '沒有需要修理的模組', 2);
    G.cstate = r.state;
    G.caps = r.caps;
    hud.toast(`開始修理：約 ${Math.ceil(r.caps.repair_s)} 秒，修理時不能開動`, 3);
  }
  function extinguishFire() {
    if (!G.cstate || G.mode !== 'battle') return;
    if (G.online) return net.send({ t: 'extinguish' });
    const r = G.combat.extinguish(G.id, G.cstate);
    if (!r.ok) return hud.toast(G.caps.on_fire ? '滅火器已用完' : '沒有起火', 2);
    G.cstate = r.state;
    G.caps = r.caps;
    hud.toast('滅火中', 2);
  }

  /**
   * The status panel's window: the vehicle seen from straight above with a long lens, nose up,
   * its hull a dark smoked shell with the parts inside lit by their state (grey, yellow when
   * damaged, red when knocked out) and the crew, the turrets tinted blue -- as War Thunder's
   * status picture, but a live camera: the turret turns, the hull rocks, the wheels move.
   * win = {cx, cy, r} in CSS px; k = device pixels per CSS px.
   */
  function renderStatusView(win, k) {
    const M = G.model;
    if (!M || !G.veh) return;
    const rect = [(win.cx - win.r) * k, (win.cy - win.r) * k, win.r * 2 * k, win.r * 2 * k];
    const b = G.veh.body;
    const up = b.worldDir([0, 0, 1]);
    const fwd = [up[0], 0, up[2]];
    const fl = Math.hypot(fwd[0], fwd[2]) || 1;
    const nose = [fwd[0] / fl, 0, fwd[2] / fl];
    const list = M.root.collect([]);
    const inner = G.interior;
    const listSet = new Set(list);
    const statusNodes = inner ? list.concat(inner.nodes.filter((n) => !listSet.has(n))) : list;
    // Keep the hull centred and fit the live geometry inside the HUD's measured circular window.
    const mid = b.worldPoint([0, M.height * 0.5, 0]);
    const fovY = 9 * DEG;
    const dist = statusViewDistance(statusNodes, mid, Math.tan(fovY / 2));
    const pos = [mid[0], mid[1] + dist, mid[2]];
    const la = lookAtLH(pos, [0, -1, 0], nose);
    const viewProj = mul(perspective(fovY, 1, dist * 0.5, dist * 2), la.view);
    const scam = { pos, viewProj, forward: la.forward, right: la.right, up: la.up, tanX: Math.tan(fovY / 2), tanY: Math.tan(fovY / 2), near: dist * 0.5, far: dist * 2 };
    const saved = [];
    const turretSet = new Set();
    for (const t of M.turrets) for (const n of t.node.collect([])) turretSet.add(n);
    const innerSet = new Set(inner ? inner.nodes : []);
    for (const n of list) {
      if (innerSet.has(n)) continue;
      saved.push([n, n.kind, n.highlight]);
      n.kind = 10;
      n.highlight = turretSet.has(n) ? [0.25, 0.42, 0.95, 0.35] : null;
    }
    // the parts inside: their state as in the hit camera
    if (inner) {
      const st = G.cstate;
      const bundle = data.vehicles[G.id];
      for (const n of inner.nodes) saved.push([n, n.kind, n.highlight, n.visible]);
      for (const n of inner.nodes) {
        n.visible = true;
        n.highlight = [0.78, 0.82, 0.88, 0.55];
      }
      if (st && bundle) {
        for (const [id, nodes] of inner.byModule) {
          const i = G.modIndex.get(id);
          if (i == null) continue;
          const h = bundle.modules[i].max_health > 0 ? st.modules[i] / bundle.modules[i].max_health : 1;
          const col = h <= 0 ? [0.95, 0.2, 0.12, 0.9] : h < 0.5 ? [0.95, 0.62, 0.15, 0.85] : null;
          if (col) for (const n of nodes) n.highlight = col;
        }
        inner.byCrew.forEach((n, i) => {
          if (!n) return;
          const h = st.crew[i] ?? 100;
          n.highlight = h <= 0 ? [0.95, 0.2, 0.12, 0.9] : h < 50 ? [0.95, 0.62, 0.15, 0.85] : [0.95, 0.95, 0.9, 0.6];
        });
      }
    }
    renderer.renderInset(statusNodes, scam, rect, { sky: false, backdrop: [0.05, 0.07, 0.11], disc: 0.9 });
    for (const [n, kd, hl, vis] of saved) {
      n.kind = kd;
      n.highlight = hl;
      if (vis !== undefined) n.visible = vis;
    }
  }

  /** The player's damage, for the status picture and the line under the drive readouts. */
  function damageView() {
    const st = G.cstate;
    const bundle = data.vehicles[G.id];
    if (!st || !bundle) return { items: [], shape: G.statusShape };
    const ratio = (i) => (bundle.modules[i].max_health > 0 ? st.modules[i] / bundle.modules[i].max_health : 1);
    const worst = (pred) => {
      let w = 1;
      bundle.modules.forEach((m, i) => {
        if (pred(m)) w = Math.min(w, ratio(i));
      });
      return w;
    };
    const shape = G.statusShape && {
      ...G.statusShape,
      modules: G.statusShape.modules.map((m) => (G.modIndex.has(m.id) ? { ...m, health: ratio(G.modIndex.get(m.id)) } : m)),
      crew: G.statusShape.crew.map((c, i) => ({ ...c, health: (st.crew[i] ?? 100) / 100 })),
      trackHealth: { 1: worst((m) => m.kind === 'track' && m.center.x > 0), [-1]: worst((m) => m.kind === 'track' && m.center.x < 0) },
      gunHealth: worst((m) => m.kind === 'gun_breech' || m.kind === 'gun_barrel'),
    };
    const c = G.caps;
    const items = [];
    if (c.on_fire) items.push({ kind: 'fire', text: `起火${st.extinguishers > 0 ? '（K 滅火）' : ''}` });
    if (c.engine_power === 0) items.push({ kind: 'bad', text: '引擎損毀' });
    else if (c.engine_power < 1) items.push({ kind: 'warn', text: '引擎受損' });
    if (worst((m) => m.kind === 'transmission') <= 0) items.push({ kind: 'bad', text: '傳動損毀' });
    if (!c.track_left) items.push({ kind: 'bad', text: '左履帶斷' });
    if (!c.track_right) items.push({ kind: 'bad', text: '右履帶斷' });
    if (worst((m) => m.kind === 'gun_breech') <= 0) items.push({ kind: 'bad', text: '炮閂損毀' });
    if (worst((m) => m.kind === 'gun_barrel') <= 0) items.push({ kind: 'bad', text: '炮管損毀' });
    if (c.traverse_mult < 1) items.push({ kind: 'warn', text: '炮塔改手搖' });
    if (c.elevate_mult < 1) items.push({ kind: 'warn', text: '高低機損毀' });
    for (const [role, ok] of [['driver', c.driver], ['gunner', c.gunner], ['loader', c.loader], ['commander', c.commander]]) {
      if (ok) continue;
      const sw = (st.swaps || []).find((x) => x.role === role);
      items.push({ kind: 'warn', text: `${CREW_NAME[role]}陣亡${sw ? `（換人 ${Math.ceil(sw.left_s)} 秒）` : ''}` });
    }
    if (c.repair_s > 0) items.push({ kind: 'info', text: `修理中 ${Math.ceil(c.repair_s)} 秒` });
    else if (items.some((i) => i.kind === 'bad') && !c.destroyed) items.push({ kind: 'info', text: 'J 修理' });
    if (c.destroyed) items.unshift({ kind: 'bad', text: '已被擊毀' });
    return { items, shape };
  }

  /** Where the next battle is fought: the test range or a battle map. */
  function setMapChoice(id) {
    G.mapId = MAP_IDS.includes(id) ? id : 'range';
    store.set(STORE_MAP, G.mapId);
    document.getElementById('map-btn').textContent = `地圖：${G.mapId === 'range' ? '靶場' : MAPS[G.mapId].name}`;
    if (G.mapId !== 'range') loadMap(G.mapId).catch(() => {});
  }
  const spawnLabel = () => {
    const sp = G.map.spawns.blue[G.spawnIdx % G.map.spawns.blue.length];
    const col = Math.floor((sp.x - G.map.x0) / (G.map.size / G.map.grid.cols));
    const row = Math.floor((G.map.z0 + G.map.size - sp.z) / (G.map.size / G.map.grid.rows));
    return `${G.map.grid.row_labels[row] || ''}${G.map.grid.col_labels[col] || ''}`;
  };
  document.getElementById('map-btn').addEventListener('click', (e) => {
    setMapChoice(MAP_IDS[(MAP_IDS.indexOf(G.mapId) + 1) % MAP_IDS.length]);
    e.currentTarget.blur();
  });
  setMapChoice(store.get(STORE_MAP) || 'range');
  setTime(renderer.timeIndex);

  /** First thing along a ray: range target, vehicle, building or ground. Returns {t, point} or null. */
  function losHit(origin, dir, max) {
    let t = groundRay(origin, dir, max, surfaceAt);
    const far = [origin[0] + dir[0] * max, origin[1] + dir[1] * max, origin[2] + dir[2] * max];
    const bh = buildingHit(origin, far);
    if (bh) t = Math.min(t, bh.t * max);
    const th = hitTargets(rangeTargets(), origin, far);
    if (th) t = Math.min(t, th.t * max);
    const he = hitEnemy(origin, far);
    if (he) t = Math.min(t, he.hit.t * max);
    if (!(t <= max)) return null;
    return { t, point: [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t] };
  }

  function startRanging() {
    if (G.ranging || G.workshop || G.mode !== 'battle') return;
    G.ranging = { t: 0, total: sightTurret().rangefinder.time_s };
  }

  /** Line of sight used for ranging: the sight line in the gunner view, the camera ray otherwise. */
  function currentLos() {
    const t = sightTurret();
    const tr = gunnery.muzzleWorld(pose(), mountOf(t, sightGun()), { yaw: G.T[G.sightT].yaw, pitch: 0 }).trunnion;
    // both views range along the middle of the picture
    return { origin: G.camPos, dir: G.free ? G.camFwd : dirFrom(G.cam.yaw, G.cam.pitch), from: tr };
  }

  function finishRanging() {
    G.ranging = null;
    const rf = sightTurret().rangefinder;
    const los = currentLos();
    const hit = losHit(los.origin, los.dir, 6000);
    const truth = hit ? Math.hypot(hit.point[0] - los.from[0], hit.point[1] - los.from[1], hit.point[2] - los.from[2]) : Infinity;
    if (!(truth <= rf.max_range_m)) {
      G.rangeResult = { ok: false };
      hud.toast(`測距失敗：超出 ${rf.max_range_m} m 或沒有目標`, 2.5);
      return;
    }
    const err = (rng.nextF32() * 2 - 1) * (rf.error_pct / 100);
    const measured = Math.round((truth * (1 + err)) / 5) * 5;
    G.rangeResult = { ok: true, measured, truth };
    sound.ping();
    if (G.autoZero) {
      setZero(measured);
      hud.toast(`測距 ${measured} m，表尺已自動裝定`, 3);
    } else hud.toast(`測距 ${measured} m（自動裝表關閉，按 E / Q 調表尺）`, 3);
  }

  window.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.target instanceof HTMLButtonElement && (e.code === 'Space' || e.code === 'Enter')) return;
    if (G.thumbs.length || G.mode === 'bureau') return;
    if (deploy.visible) {
      // the deploy screen: Enter joins the battle; Tab leaves it
      if (e.code === 'Tab') {
        e.preventDefault();
        toGarage();
      }
      return;
    }
    if (G.mode === 'test') {
      if (e.code === 'Tab') {
        e.preventDefault();
        return toGarage();
      }
      if (e.repeat) return;
      if (e.code === 'KeyR') testRange.startReplay();
      else if (e.code === 'KeyZ') testRange.cycleZoom(testRange.zoom >= 3 ? -3 : 1);
      else if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        testRange.fire();
      } else if (e.code === 'KeyO') {
        // the interior is shown while O is held
        G.xray = true;
        applyXray();
      }
      return;
    }
    if (G.mode === 'garage') {
      // the garage: choose, look, go
      if (e.code === 'Tab') return e.preventDefault();
      if (G.workshop) return;
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        stepVehicle(e.code === 'ArrowLeft' ? -1 : 1);
        return e.preventDefault();
      }
      if (e.repeat) return;
      if (e.code === 'Enter') {
        sound.start();
        goBattle();
        lockSoon();
      } else if (e.code === 'KeyO') setXray(true);
      else if (e.code === 'KeyI') toggleFlaps();
      else if (e.code === 'KeyP') setPixel(G.pixelIdx + 1);
      else if (e.code === 'KeyT') setTime(renderer.timeIndex + 1);
      else if (e.code === 'KeyL') setQuality(QUALITY_ORDER[(QUALITY_ORDER.indexOf(renderer.quality) + 1) % QUALITY_ORDER.length]);
      return;
    }
    if (e.code === 'Tab') {
      e.preventDefault();
      return toGarage();
    }
    if (e.code === 'Enter' && G.online) {
      e.preventDefault();
      return openChat();
    }
    if (KEYMAP[e.code]) {
      G.keys.add(KEYMAP[e.code]);
      e.preventDefault();
      return;
    }
    if (e.code === 'KeyN') {
      G.mgHeld = true;
      return;
    }
    if (e.code === 'F3') {
      e.preventDefault();
      physDebug.toggle();
      return;
    }
    if (e.code === 'KeyE') return setZero(G.zero + 50);
    if (e.code === 'KeyQ') return setZero(G.zero - 50);
    if (e.repeat) return;
    if (e.code === 'KeyC') setFreeLook(true);
    else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyV') toggleSight();
    else if (e.code === 'KeyZ') toggleZoom();
    else if (e.code === 'KeyF') startRanging();
    else if (e.code === 'KeyX') setZero(0);
    else if (e.code === 'KeyB') {
      G.autoZero = !G.autoZero;
      hud.toast(`自動裝表：${G.autoZero ? '開' : '關'}`, 1.5);
    } else if (e.code === 'KeyG') cycleSightGun();
    else if (ammoKeyIndex(e.code) >= 0) selectAmmo(ammoKeyIndex(e.code));
    else if (e.code === 'Equal' || e.code === 'NumpadAdd') stepCruise(1);
    else if (e.code === 'Minus' || e.code === 'NumpadSubtract') stepCruise(-1);
    else if (e.code === 'KeyP') setPixel(G.pixelIdx + 1);
    else if (e.code === 'KeyT') setTime(renderer.timeIndex + 1);
    else if (e.code === 'KeyO') setXray(true);
    else if (e.code === 'KeyL') setQuality(QUALITY_ORDER[(QUALITY_ORDER.indexOf(renderer.quality) + 1) % QUALITY_ORDER.length]);
    else if (e.code === 'KeyR') {
      // R: the rockets, on a vehicle that carries them; otherwise back to the start
      if (G.mode === 'battle' && G.loadout.turrets.some((t) => t.guns.some((g) => g.def.trigger === 'rocket'))) trigger(false, true);
      else resetVehicle();
    } else if (e.code === 'Backspace') resetVehicle();
    else if (e.code === 'KeyU') toggleAps();
    else if (e.code === 'KeyI') toggleFlaps();
    else if (e.code === 'KeyY') cycleApsRate();
    else if (e.code === 'KeyJ') repairVehicle();
    else if (e.code === 'KeyK') extinguishFire();
    else if (e.code === 'KeyM') hud.toast(sound.toggleMute() ? '音效已關閉' : '音效已開啟', 1.5);
    else if (e.code === 'KeyH') document.getElementById('help').toggleAttribute('data-collapsed');
  });
  window.addEventListener('keyup', (e) => {
    if (KEYMAP[e.code]) G.keys.delete(KEYMAP[e.code]);
    if (e.code === 'KeyN') G.mgHeld = false;
    if (e.code === 'KeyC' && !G.xray && G.mode === 'battle') setFreeLook(false);
    // the interior view lasts as long as O is held
    if (e.code === 'KeyO' && G.xray && !G.xrayLatched) {
      if (G.mode === 'test') {
        G.xray = false;
        applyXray();
      } else setXray(false);
    }
  });
  window.addEventListener('blur', () => {
    G.keys.clear();
    G.fireHeld = false;
    G.mgHeld = false;
    G.rmb = false;
    if (G.xray && !G.xrayLatched && G.mode !== 'test') setXray(false);
    if (G.mode === 'battle' && !G.xray) setFreeLook(false);
  });
  document.getElementById('help-toggle').addEventListener('click', () => document.getElementById('help').toggleAttribute('data-collapsed'));
  document.getElementById('to-garage').addEventListener('click', (e) => {
    toGarage();
    e.currentTarget.blur();
  });
  document.getElementById('battle-btn').addEventListener('click', (e) => {
    sound.start();
    goBattle();
    e.currentTarget.blur();
    requestLock();
    canvas.focus();
  });

  // ---- the mouse: in battle the cursor is locked to the view (raw, unaccelerated movement when
  // the browser offers it); without the lock the view does not follow the cursor at all, so a
  // cursor leaving the window or coming back cannot throw the aim
  const locked = () => document.pointerLockElement === canvas;
  const lockable = () => !!canvas.requestPointerLock && document.body.dataset.touch !== '1';
  function requestLock() {
    if (!lockable() || locked()) return;
    const plain = () => {
      try {
        const q = canvas.requestPointerLock();
        if (q && q.catch) q.catch(() => {});
      } catch {
        /* pointer lock is optional */
      }
    };
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      // browsers without raw input refuse the option: lock without it
      if (p && p.catch) p.catch((err) => (err && err.name === 'NotSupportedError' ? plain() : null));
    } catch {
      plain();
    }
  }
  /** After a key that starts the battle (a user gesture), once the battle screen is up. */
  function lockSoon() {
    requestLock();
  }
  G.lockAt = 0;

  const ndcOf = (e) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2];
  };
  canvas.addEventListener('mousemove', (e) => {
    if (G.protect) G.protMouse = { ndc: ndcOf(e), down: e.buttons !== 0, at: G.protMouse?.at };
  });
  canvas.addEventListener('mousedown', (e) => {
    if (G.protect && e.button === 0) G.protDown = [e.clientX, e.clientY];
  });
  canvas.addEventListener('mouseup', (e) => {
    // a click (not a drag to turn the view) fires the round where it points
    if (G.protect && e.button === 0 && G.protDown && Math.hypot(e.clientX - G.protDown[0], e.clientY - G.protDown[1]) < 5) protFire(ndcOf(e));
    G.protDown = null;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 1) e.preventDefault(); // no auto-scroll cursor on the middle button
    if (G.mode === 'test' && e.button === 0) {
      if (!locked() && canvas.requestPointerLock && document.body.dataset.touch !== '1') {
        requestLock();
        return;
      }
      testRange.fire();
      return;
    }
    if (G.mode !== 'battle') return;
    if (e.button === 0) {
      // the first click of an unlocked view only takes the cursor
      if (!locked() && lockable()) {
        requestLock();
        return;
      }
      G.fireHeld = true;
    } else if (e.button === 1) G.mgHeld = true;
    else if (e.button === 2) G.rmb = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) G.fireHeld = false;
    else if (e.button === 1) G.mgHeld = false;
    else if (e.button === 2) G.rmb = false;
  });
  document.addEventListener('pointerlockchange', () => {
    // the first moves after the lock changes can carry the whole jump of the cursor: skip them
    G.lockAt = performance.now();
    document.body.dataset.locked = locked() ? '1' : '0';
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const SPIKE = 300; // px in one event: no hand moves a mouse that far in a few milliseconds
  canvas.addEventListener('mousemove', (e) => {
    if (G.lookPointer != null) return;
    // in the garage the view only turns while a button is held
    if (G.mode === 'garage') {
      if (e.buttons === 0) return;
      G.spinHold = 6;
    } else if ((G.mode === 'battle' || G.mode === 'test') && lockable() && !locked()) return;
    const dx = e.movementX || 0;
    const dy = e.movementY || 0;
    if (performance.now() - G.lockAt < 80 || Math.abs(dx) > SPIKE || Math.abs(dy) > SPIKE) return;
    G.mdx += dx;
    G.mdy += dy;
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (G.mode === 'test') testRange.cycleZoom(e.deltaY < 0 ? 1 : -1);
      else if (G.mode === 'garage') G.gzoom = clamp(G.gzoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.55, 1.6);
      else if (G.mode === 'battle' && !G.free && !e.ctrlKey && !e.altKey) {
        // the wheel turns the range drum of the sight: up = farther, 50 m a notch
        const notches = Math.max(1, Math.round(Math.abs(e.deltaY) / (e.deltaMode === 1 ? 3 : 100)));
        setZero(G.zero + (e.deltaY < 0 ? 50 : -50) * Math.min(notches, 4));
      } else G.cam.distTarget = clamp(G.cam.distTarget * (e.deltaY > 0 ? 1.12 : 0.89), 5.5, 26);
    },
    { passive: false },
  );

  function cycleZoom(dir) {
    const n = sightLevels().length;
    G.zoomIdx = clamp(G.zoomIdx + dir, 0, n - 1);
  }

  /** Z: next magnification; from the highest, back to the lowest (two levels = on / off). */
  function toggleZoom() {
    if (G.view === 'sight' && !G.free) {
      const n = sightLevels().length;
      if (n > 1) G.zoomIdx = G.zoomIdx >= n - 1 ? 0 : G.zoomIdx + 1;
      else hud.toast('這具瞄準鏡只有一種倍率', 1.5);
      G.zoomFlash = 1.2;
    } else G.zoom3 = !G.zoom3;
  }

  // ---- touch layout: left stick drives, dragging the view aims, buttons on the right
  const touchEl = document.getElementById('touch');
  const enableTouch = () => {
    document.body.dataset.touch = '1';
  };
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) enableTouch();
  window.addEventListener('touchstart', enableTouch, { once: true, passive: true });

  G.lookPointer = null;
  let lookLast = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    G.lookPointer = e.pointerId;
    lookLast = [e.clientX, e.clientY];
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== G.lookPointer || !lookLast) return;
    G.mdx += (e.clientX - lookLast[0]) * 1.5;
    G.mdy += (e.clientY - lookLast[1]) * 1.5;
    if (G.mode === 'garage') G.spinHold = 6;
    lookLast = [e.clientX, e.clientY];
  });
  const endLook = (e) => {
    if (e.pointerId === G.lookPointer) {
      G.lookPointer = null;
      lookLast = null;
    }
  };
  canvas.addEventListener('pointerup', endLook);
  canvas.addEventListener('pointercancel', endLook);

  const joy = document.getElementById('joy');
  const knob = document.getElementById('joy-knob');
  let joyPointer = null;
  const joyMove = (e) => {
    const r = joy.getBoundingClientRect();
    const half = r.width / 2;
    let dx = (e.clientX - (r.left + half)) / half;
    let dy = (e.clientY - (r.top + half)) / half;
    const l = Math.hypot(dx, dy);
    if (l > 1) {
      dx /= l;
      dy /= l;
    }
    knob.style.transform = `translate(${(dx * half * 0.55).toFixed(1)}px, ${(dy * half * 0.55).toFixed(1)}px)`;
    const dead = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    G.touch.throttle = -dead(dy);
    G.touch.steer = dead(dx);
  };
  const capture = (node, id) => {
    try {
      node.setPointerCapture(id);
    } catch {
      /* capture is a nicety; the control still works without it */
    }
  };
  joy.addEventListener('pointerdown', (e) => {
    joyPointer = e.pointerId;
    capture(joy, e.pointerId);
    joyMove(e);
  });
  joy.addEventListener('pointermove', (e) => {
    if (e.pointerId === joyPointer) joyMove(e);
  });
  const joyEnd = (e) => {
    if (e.pointerId !== joyPointer) return;
    joyPointer = null;
    knob.style.transform = '';
    G.touch.throttle = G.touch.steer = 0;
  };
  joy.addEventListener('pointerup', joyEnd);
  joy.addEventListener('pointercancel', joyEnd);

  const hold = (id, down, up) => {
    const b = document.getElementById(id);
    b.addEventListener('pointerdown', (e) => {
      capture(b, e.pointerId);
      down();
    });
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  hold('tb-fire', () => (G.fireHeld = true), () => (G.fireHeld = false));
  hold('tb-mg', () => (G.mgHeld = true), () => (G.mgHeld = false));
  hold('tb-xray', () => setXray(true), () => setXray(false));
  hold('tb-free', () => setFreeLook(true), () => setFreeLook(false));
  document.getElementById('tb-sight').addEventListener('click', toggleSight);
  document.getElementById('tb-range').addEventListener('click', startRanging);
  document.getElementById('tb-zero-up').addEventListener('click', () => setZero(G.zero + 100));
  document.getElementById('tb-zero-down').addEventListener('click', () => setZero(G.zero - 100));
  touchEl.addEventListener('contextmenu', (e) => e.preventDefault());

  // --------------------------------------------------------------------- fire

  /**
   * Queues every loaded gun that bears on the aim point; they fire as a ripple. mgTrigger: the
   * machine-gun key, which also fires automatic guns on the turrets not in the sight.
   */
  function trigger(mgTrigger = false, rocket = false) {
    if (G.sightM >= 0 && !rocket) return;
    if (G.online && G.online.dead) return;
    if (G.caps && !G.caps.can_fire) return;
    let n = G.pending.length;
    // rockets go one to a press (the next one still on its rail)
    let rocketGone = rocket && G.pending.some((p) => G.loadout.turrets[p.ti].guns[p.gi].def.trigger === 'rocket');
    G.loadout.turrets.forEach((t, ti) => {
      const rt = G.T[ti];
      t.guns.forEach((g, gi) => {
        if (rt.loading.state[gi] !== 'ready') return;
        if (rocket && rocketGone) return;
        if (G.pending.some((p) => p.ti === ti && p.gi === gi)) return;
        const own = ti === G.sightT;
        const onTarget = rt.bearing && Math.abs(rt.yawErr) < 0.02 && Math.abs(rt.guns[gi].pitchErr) < 0.02;
        if (!own && !onTarget) return;
        // the secondary trigger (N, with the machine guns): an automatic gun on another turret, and
        // a weapon of the secondary group (rockets); the main trigger fires everything else
        // rockets have their own key (R)
        if ((g.def.trigger === 'rocket') !== rocket) return;
        // the active protection gun lays and fires itself while it is switched on
        if (G.aps && G.apsOn && ti === (G.aps.turret ?? 1)) return;
        const secondary = !rocket && (g.def.trigger === 'secondary' || (!!g.def.autocannon && !own));
        if (secondary !== mgTrigger) return;
        G.pending.push({ ti, gi, t: g.def.autocannon ? 0 : n * 0.07 });
        if (rocket) rocketGone = true;
        if (!g.def.autocannon) n++;
      });
    });
  }

  function fireGun(ti, gi) {
    const t = G.loadout.turrets[ti];
    const g = t.guns[gi];
    const rt = G.T[ti];
    if (rt.loading.state[gi] !== 'ready') return false;
    const mount = g.def.missile ? launcherMount(g, mountOf(t, g)) : mountOf(t, g);
    const mz = gunnery.muzzleWorld(pose(), mount, { yaw: rt.yaw, pitch: rt.guns[gi].pitch + hullTilt(G.ss, rt.yaw) });
    if (g.def.missile) return launchFromGun(ti, gi, mz);
    loading.fired(rt.loading, gi);
    const dir = gunnery.disperse(mz.dir, g.def.dispersion_mrad, rng);
    const shot = { s: ballistics.newShot(mz.pos, dir, g.shell), shell: g.shell, age: 0, origin: mz.pos.slice(), travelled: 0 };
    G.shots.push(shot);
    if (G.online) {
      // the others see the shot; a hit only counts on the server if it names this one
      shot.seq = ++G.online.seq;
      net.send({ t: 'fire', seq: shot.seq, o: mz.pos.map((v) => Math.round(v * 1000) / 1000), d: dir.map((v) => Math.round(v * 1e5) / 1e5), shell: g.shell.id });
    }
    const gy = surfaceAt(mz.pos[0], mz.pos[2]);
    const auto = g.def.autocannon;
    if (auto) {
      // an automatic gun: a flash and a crack per round, the belt one shorter, a light shove
      if (g.def.caliber_mm >= 20) fx.autocannonBlast(mz.pos, mz.dir, g.def.caliber_mm, impactColor([mz.pos[0], gy, mz.pos[2]]), gy);
      else fx.mgFlash(mz.pos, mz.dir, g.def.caliber_mm);
      sound.mg(g.def.caliber_mm);
      g.belt = Math.max(0, g.belt - 1);
      rt.guns[gi].recoilT = 0;
      rt.guns[gi].smoke = Math.min(0.12, rt.guns[gi].smoke + 0.025);
      G.cam.shake = Math.min(0.5, G.cam.shake + 0.04);
      g.ammo[g.loaded].count = Math.max(0, g.ammo[g.loaded].count - 1);
      g.loaded = -1;
      syncGunShell(g);
      if (nextAmmo(g) < 0) rt.loading.state[gi] = 'empty';
      return true;
    }
    fx.muzzleBlast(mz.pos, mz.dir, g.def.caliber_mm, mz.pos[1] - gy < 3.2 ? impactColor([mz.pos[0], gy, mz.pos[2]]) : null, gy);
    sound.shot(g.def.caliber_mm);
    rt.guns[gi].recoilT = 0; // the barrel runs back, then the recuperator brings it home
    (G.firedAt || (G.firedAt = []))[ti] = performance.now() / 1000;
    rt.guns[gi].smoke = 1.6; // seconds the muzzle keeps smoking

    // Recoil acts on the hull: it shoves the vehicle, twists it if the gun is off-centre, and
    // rocks the body on its suspension.
    const p = g.shell.mass_kg * g.shell.muzzle_velocity_ms * 1.3;
    const ml = gunnery.muzzleLocal(mountOf(t, g), { yaw: rt.yaw, pitch: rt.guns[gi].pitch });
    const back = G.veh.body.worldDir(ml.dir);
    // the recoil is an impulse at the trunnions: it shoves the hull back and, being above the
    // centre of mass, rocks it on its springs (and twists it when the gun is off the centre line)
    G.veh.impulse([-back[0] * p * RECOIL_ROCK, -back[1] * p * RECOIL_ROCK, -back[2] * p * RECOIL_ROCK], G.veh.worldPoint(ml.trunnion));
    G.cam.shake = Math.min(1.6, G.cam.shake + 0.8);
    if (ti === G.sightT) G.cam.kick = 0.016;
    // the round is gone from the rack; the loader takes the selected type next
    g.ammo[g.loaded].count = Math.max(0, g.ammo[g.loaded].count - 1);
    g.loaded = -1;
    syncGunShell(g);
    if (nextAmmo(g) < 0) rt.loading.state[gi] = 'empty';
    return true;
  }

  /**
   * Where machine gun i is and where it points (world), after moving its mount towards the aim
   * point. Coaxial guns are rigid with the main gun; hull and roof guns are laid by hand inside
   * their arcs and add the elevation their own bullet needs for the range.
   */
  function layMg(i, dt) {
    const e = G.MG[i];
    const m = e.m;
    const ps = pose();
    const t0 = G.loadout.turrets[0];
    const rt0 = G.T[0];
    if (m.mount === 'coax') {
      const g = t0.guns[0];
      const mount = { pivot: t0.pivot, trunnion: [m.pos[0], m.pos[1], g.trunnion[2]], muzzleOffset: Math.max(0.15, m.pos[2] - g.trunnion[2]) };
      if (m.elevationPivot) {
        mount.trunnion = m.elevationPivot;
        mount.muzzleVector = m.pos.map((v, k) => v - m.elevationPivot[k]);
      }
      const mz = gunnery.muzzleWorld(ps, mount, { yaw: rt0.yaw, pitch: rt0.guns[0].pitch + hullTilt(G.ss, rt0.yaw) });
      e.bearing = true;
      return mz;
    }
    const lp = gunnery.toLocalPoint(ps, G.aimPoint);
    // the pivot of a roof gun rides round with the turret
    const base = m.mount === 'pintle' ? gunnery.muzzleLocal({ pivot: t0.pivot, trunnion: m.pos, muzzleOffset: 0 }, { yaw: rt0.yaw, pitch: 0 }).trunnion : m.pos;
    const d = [lp[0] - base[0], lp[1] - base[1], lp[2] - base[2]];
    const range = Math.hypot(d[0], d[1], d[2]);
    const want = { yaw: Math.atan2(d[0], d[2]), pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])) + ballistics.elevationAt(m.table, range) };
    e.bearing = mgSim.slewMount(e.aim, want, m.arc, m.slew, dt);
    const dl = dirFrom(e.aim.yaw, e.aim.pitch + hullTilt(G.ss, e.aim.yaw));
    const len = m.mount === 'pintle' ? 1.0 : 0.3;
    return { pos: gunnery.toWorldPoint(ps, [base[0] + dl[0] * len, base[1] + dl[1] * len, base[2] + dl[2] * len]), dir: gunnery.toWorldDir(ps, dl), trunnion: gunnery.toWorldPoint(ps, base) };
  }

  function sightMuzzle(tilt = 0) {
    if (G.sightM >= 0) return layMg(G.sightM, 0);
    const t = sightTurret(), g = sightGun(), rt = G.T[G.sightT];
    return gunnery.muzzleWorld(pose(), mountOf(t, g), { yaw: rt.yaw, pitch: rt.guns[G.sightG].pitch + tilt });
  }

  function stepMachineGuns(dt) {
    const enabled = G.mode === 'battle' && !G.workshop && !(G.online && G.online.dead) && !G.caps?.destroyed;
    for (let i = 0; i < G.MG.length; i++) {
      const e = G.MG[i];
      const mz = layMg(i, dt);
      const firing = enabled && machineGunTrigger(G.sightM, i, G.fireHeld, G.mgHeld);
      const n = mgSim.stepMg(e.m.def, e.st, firing && e.bearing, dt);
      for (let k = 0; k < n; k++) {
        const dir = gunnery.disperse(mz.dir, e.m.def.dispersion_mrad, rng);
        G.bullets.push({ s: ballistics.newShot(mz.pos, dir, e.m.bullet), def: e.m.def, age: 0, travelled: 0, tracer: mgSim.isTracer(e.m.def, e.st) });
        fx.mgFlash(mz.pos, mz.dir, e.m.def.caliber_mm);
        sound.mg(e.m.def.caliber_mm);
        G.cam.shake = Math.min(0.35, G.cam.shake + (e.m.def.caliber_mm > 10 ? 0.06 : 0.025));
      }
    }
  }

  function updateBullets(dt) {
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      let remaining = dt;
      let done = false;
      while (remaining > 1e-6 && !done) {
        const h = Math.min(BULLET_DT, remaining);
        remaining -= h;
        const p0 = b.s.pos.slice();
        ballistics.stepShot(b.s, h);
        b.age += h;
        const p1 = b.s.pos;
        b.travelled += Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
        const heavy = b.def.caliber_mm > 10;
        const hit = hitTargets(rangeTargets(), p0, p1);
        let eb = hitEnemy(p0, p1);
        const bb = buildingHit(p0, p1);
        if (bb && eb && bb.t < eb.hit.t) eb = null;
        if (bb && !eb) {
          fx.bulletGround(bb.point, MASONRY_DUST, heavy);
          done = true;
        } else if (eb) {
          fx.bulletBoard(eb.hit.point, heavy);
          const e = eb.e;
          const friend = e.remote && G.online && e.team === G.online.team;
          // bullets go through the same armour, module and crew model as shells
          if (e.combat && e.alive && !friend) {
            const sp = Math.hypot(b.s.vel[0], b.s.vel[1], b.s.vel[2]) || 1;
            const dir = [b.s.vel[0] / sp, b.s.vel[1] / sp, b.s.vel[2] / sp];
            if (!G.bulletShells.has(b.def.id)) G.bulletShells.set(b.def.id, bulletShell(b.def));
            const rep = combatHit(e, p0, dir, G.bulletShells.get(b.def.id), sp, b.travelled, (rng.nextF32() * 4294967295) >>> 0);
            if (e.remote && G.online) net.send({ t: 'mg_hit', target: e.netId, gun: b.def.id, shot: wireShot(rep.shot) });
            if (rep.modules.length || rep.crew.length || rep.caps.destroyed) {
              onCombatHit(e, rep, G.bulletShells.get(b.def.id), b.travelled, true);
              hud.hitMarker(rep.title, rep.caps.destroyed ? 'kill' : 'pen');
            }
          }
          done = true;
        } else if (hit) {
          hit.target.mgHits = (hit.target.mgHits || 0) + 1;
          G.mgHits++;
          G.lastMgHit = { range: hit.target.range, dx: hit.point[0] - hit.target.x, dy: hit.point[1] - hit.target.y, tof: b.age };
          fx.bulletBoard(hit.point, heavy);
          done = true;
        } else if (groundHit(p0, p1, surfaceAt)) {
          const pt = groundHit(p0, p1, surfaceAt);
          fx.bulletGround(pt, impactColor(pt), heavy);
          done = true;
        }
      }
      if (done || b.age > 3.2) {
        G.bullets.splice(i, 1);
        continue;
      }
      if (!b.tracer) continue;
      const v = b.s.vel;
      const sp = Math.hypot(v[0], v[1], v[2]) || 1;
      const tail = Math.min(sp * 0.022, b.travelled);
      const a = [b.s.pos[0] - (v[0] / sp) * tail, b.s.pos[1] - (v[1] / sp) * tail, b.s.pos[2] - (v[2] / sp) * tail];
      const dc = Math.hypot(b.s.pos[0] - G.camPos[0], b.s.pos[1] - G.camPos[1], b.s.pos[2] - G.camPos[2]);
      fx.beam(a, b.s.pos.slice(), 0.02 + dc * 0.0011, b.def.tracer_rgb, 0.9);
    }
  }

  function updateShots(dt) {
    const sub = 1 / 240;
    for (let i = G.shots.length - 1; i >= 0; i--) {
      const sh = G.shots[i];
      let remaining = dt;
      let done = false;
      while (remaining > 1e-6 && !done) {
        const h = Math.min(sub, remaining);
        remaining -= h;
        const p0 = sh.s.pos.slice();
        ballistics.stepShot(sh.s, h);
        sh.age += h;
        const p1 = sh.s.pos;
        sh.travelled += Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
        const hit = sh.from == null ? hitTargets(rangeTargets(), p0, p1) : null;
        const speed = Math.hypot(sh.s.vel[0], sh.s.vel[1], sh.s.vel[2]);
        let eh = hitEnemy(p0, p1, sh.from);
        let me = sh.from != null && G.mode === 'battle' ? hitSelf(p0, p1) : null;
        const bh = buildingHit(p0, p1);
        if (bh && eh && bh.t < eh.hit.t) eh = null;
        if (bh && me) me = null;
        if (bh && !eh && !me) {
          // a house, bunker or wall takes it: masonry dust (and the burst of a high-explosive round)
          fx.shellGround(bh.point, MASONRY_DUST, sh.shell);
          sound.impact(Math.hypot(bh.point[0] - G.s.x, bh.point[2] - G.s.z));
          if (sh.from == null) splashNear(bh.point, sh.shell);
          done = true;
        } else if (sh.from != null && (eh || me)) {
          // another player's shell: only its look here (its shooter reports the hit to the server)
          const pt = eh ? eh.hit.point : me;
          fx.shellArmor(pt, [sh.s.vel[0] / speed, sh.s.vel[1] / speed, sh.s.vel[2] / speed], null, sh.shell, 'stopped');
          sound.impact(Math.hypot(pt[0] - G.s.x, pt[2] - G.s.z), true);
          done = true;
        } else if (eh) {
          const e = eh.e;
          const dir = [sh.s.vel[0] / speed, sh.s.vel[1] / speed, sh.s.vel[2] / speed];
          const dist = Math.hypot(eh.hit.point[0] - sh.origin[0], eh.hit.point[2] - sh.origin[2]);
          const wasAlive = e.alive;
          const friend = e.remote && G.online && e.team === G.online.team;
          const who = e.remote ? `${e.player}（${e.name}）` : e.name;
          sound.impact(Math.hypot(eh.hit.point[0] - G.s.x, eh.hit.point[2] - G.s.z), true);
          if (friend) {
            fx.armorImpact(eh.hit.point, false);
            hud.toast(`友軍 ${who}：不計傷害`, 2);
          } else if (e.combat && wasAlive) {
            // armour, modules and crew: the combat model (the server resolves it again online)
            const seed = shotSeed(sh);
            const rep = combatHit(e, p0, dir, sh.shell, speed, dist, seed);
            if (e.remote && sh.seq && G.online) net.send({ t: 'hit', seq: sh.seq, target: e.netId, result: rep.outcome, plate: rep.plate ?? null, shot: wireShot(rep.shot) });
            const through = rep.outcome === 'penetrated' || rep.outcome === 'overpressure';
            // what the eye sees depends on the round and what it did
            const nrm = rep.normal ? e.veh.body.worldDir(arr3(rep.normal)) : null;
            fx.shellArmor(eh.hit.point, dir, nrm, sh.shell, rep.outcome);
            if (rep.ricochet_dir) fx.ricochet(eh.hit.point, e.veh.body.worldDir(arr3(rep.ricochet_dir)));
            const first = rep.layers[0];
            const detail = first ? `${first.plate} ${first.thickness_mm} mm　入射 ${first.angle_deg.toFixed(0)}°　需 ${first.required_mm.toFixed(0)}／穿深 ${rep.pen_mm.toFixed(0)} mm` : '';
            onCombatHit(e, rep, sh.shell, dist, false, detail);
            G.lastHit = { type: 'enemy', id: e.id, result: rep.outcome, plate: rep.plate, angle: rep.angle_deg, pen: rep.pen_mm, dist, title: rep.title, destroyed: rep.caps.destroyed, player: e.remote ? e.netId : null };
            // the hit camera tells the rest
            hud.hitMarker(rep.title, rep.caps.destroyed ? 'kill' : through ? 'pen' : rep.outcome === 'ricochet' ? 'ricochet' : 'nopen');
            hud.hideToast();
          } else {
            const r = e.resolve(eh.hit, dir, sh.shell, dist);
            if (e.remote && wasAlive && sh.seq && G.online) net.send({ t: 'hit', seq: sh.seq, target: e.netId, result: r.result, plate: r.plate ?? null });
            const through = r.result === 'pen' || r.result === 'kill';
            fx.armorImpact(eh.hit.point, through);
            G.lastHit = { type: 'enemy', id: e.id, result: r.result, plate: r.plate, angle: r.angle, effective: r.effective, pen: r.pen, dist, player: e.remote ? e.netId : null };
            const detail = r.plate ? `　${r.plate} ${r.thickness} mm，入射 ${r.angle.toFixed(0)}°，等效 ${Number.isFinite(r.effective) ? r.effective.toFixed(0) : '—'} mm，穿深 ${r.pen.toFixed(0)} mm` : '';
            hud.hitMarker(RESULT_LABEL[r.result], r.result);
            hud.toast(`${who}：${RESULT_LABEL[r.result]}${wasAlive ? '' : '（已擊毀）'}　${dist.toFixed(0)} m${detail}`, 5);
          }
          done = true;
        } else if (hit) {
          const tg = hit.target;
          tg.hits++;
          G.hits++;
          const dx = hit.point[0] - tg.x;
          const dy = hit.point[1] - tg.y;
          fx.boardImpact(hit.point);
          sound.impact(Math.hypot(hit.point[0] - G.s.x, hit.point[2] - G.s.z), true);
          const dist = Math.hypot(hit.point[0] - sh.origin[0], hit.point[2] - sh.origin[2]);
          G.lastHit = { type: 'target', range: tg.range, dx, dy, tof: sh.age, speed, dist, pen: penAt(sh.shell, dist), caliber: sh.shell.caliber_mm };
          const side = Math.abs(dx) < 0.05 ? '左右正中' : `偏${dx > 0 ? '右' : '左'} ${Math.abs(dx).toFixed(2)} m`;
          const vert = Math.abs(dy) < 0.05 ? '高低正中' : `偏${dy > 0 ? '高' : '低'} ${Math.abs(dy).toFixed(2)} m`;
          hud.toast(`${sh.shell.caliber_mm} mm 命中 ${tg.range} m 靶：${side}，${vert}。飛行 ${sh.age.toFixed(2)} s，著速 ${speed.toFixed(0)} m/s，此距離穿深約 ${G.lastHit.pen.toFixed(0)} mm`, 6);
          done = true;
        } else if (groundHit(p0, p1, surfaceAt)) {
          const pt = groundHit(p0, p1, surfaceAt);
          fx.shellGround(pt, impactColor(pt), sh.shell);
          const dist = Math.hypot(pt[0] - sh.origin[0], pt[2] - sh.origin[2]);
          sound.impact(Math.hypot(pt[0] - G.s.x, pt[2] - G.s.z));
          if (sh.from == null) {
            splashNear(pt, sh.shell);
            G.lastHit = { type: 'ground', dist, tof: sh.age, speed, point: pt };
            if (G.loadout.gunCount <= 2) hud.toast(`落地：距離 ${dist.toFixed(0)} m，飛行 ${sh.age.toFixed(2)} s`, 3);
          }
          done = true;
        }
      }
      if (done || sh.age > 15) {
        G.shots.splice(i, 1);
        continue;
      }
      const v = sh.s.vel;
      const sp = Math.hypot(v[0], v[1], v[2]) || 1;
      const tail = Math.min(sp * 0.03, sh.travelled);
      const a = [sh.s.pos[0] - (v[0] / sp) * tail, sh.s.pos[1] - (v[1] / sp) * tail, sh.s.pos[2] - (v[2] / sp) * tail];
      const dc = Math.hypot(sh.s.pos[0] - G.camPos[0], sh.s.pos[1] - G.camPos[1], sh.s.pos[2] - G.camPos[2]);
      fx.beam(a, sh.s.pos.slice(), (0.05 + dc * 0.0016) * (TRACER[sh.shell.kind] ? TRACER[sh.shell.kind][1] : 1), TRACER[sh.shell.kind] ? TRACER[sh.shell.kind][0] : [1.0, 0.55, 0.2], 0.95);
    }
  }

  /**
   * Laying the guns on a moving hull.
   *
   * Without a stabilizer the gun is geared to the hull in both planes: every pitch, roll and turn
   * of the hull carries the gun and the sight on it. The gunner winds it back by hand, but only
   * after his reaction time (GUNNER.delay) and then smoothly (GUNNER.tau), at no more than the
   * handwheel's or the power traverse's rate -- so slow motions are taken out while a bouncing
   * hull still shakes the gun and the picture.
   *
   * A vertical gyro stabilizer (the Westinghouse gear of the M4A3 Shermans) drives the elevation
   * itself: the gyro feels the hull's pitch and roll at once and its hydraulic servo answers with
   * its own small lag and only up to its own rate, so hard pitching over rough ground still gets
   * through; the traverse stays geared to the hull as above. A two-plane stabilizer (the T-10M's
   * PUOT-2 "Liven", the test vehicles') holds the bearing as well.
   *
   * The gyros measure the hull's angular rate, and the servos drive the gun against it at once
   * (feed-forward, scaled by how well the gyro and servo are matched), while a slower correction
   * takes out what is left of the error; each drive answers through its own short lag and only up
   * to its own rate. A smooth sway leaves a fraction of a milliradian; a sharp jolt over a bump
   * still shows for a moment, and a hull pitching faster than the drive can follow drags the gun.
   */
  const GUNNER = { delay: 0.28, tau: 0.22 };
  const STABILIZER = {
    none: {},
    // M4A3 Westinghouse gyro: elevation only, a coarse match and a slow hydraulic drive
    vertical: { ff: 0.85, tiltTau: 0.10, servo: 0.05, elev: 9 * DEG },
    // post-war two-plane: well matched gyros, electro-hydraulic drives in both planes
    two_plane: { ff: 0.98, tiltTau: 0.04, servo: 0.02, elev: 50 * DEG, yawFf: 0.98, yawTau: 0.05, trav: 50 * DEG },
  };

  /**
   * The hull's attitude as the laying has caught up with it: the gunner's hands see it as it was
   * a reaction time ago; a stabilizer's gyros see its rate now and drive the gun against it.
   */
  function trackHull(rt, stab, dt) {
    const st = STABILIZER[stab] || STABILIZER.none;
    const att = { pitch: G.ss.pitch, roll: G.ss.roll, heading: G.s.heading };
    if (!rt.seen) {
      rt.seen = { ...att };
      rt.hand = { ...att };
      rt.prev = { ...att };
      rt.drive = { pitch: 0, roll: 0, heading: 0 };
      rt.hist = [];
      rt.clock = 0;
    }
    rt.clock += dt;
    rt.hist.push({ t: rt.clock, ...att });
    while (rt.hist.length > 2 && rt.hist[1].t <= rt.clock - GUNNER.delay) rt.hist.shift();
    const late = rt.hist[0];
    const kh = 1 - Math.exp(-dt / GUNNER.tau);
    rt.hand.pitch += (late.pitch - rt.hand.pitch) * kh;
    rt.hand.roll += (late.roll - rt.hand.roll) * kh;
    rt.hand.heading = gunnery.wrapPi(rt.hand.heading + gunnery.wrapPi(late.heading - rt.hand.heading) * kh);
    // the gyros: the hull's rate in each plane this step
    const rate = {
      pitch: (att.pitch - rt.prev.pitch) / dt,
      roll: (att.roll - rt.prev.roll) / dt,
      heading: gunnery.wrapPi(att.heading - rt.prev.heading) / dt,
    };
    rt.prev = { ...att };
    // one plane of a stabilizer: rate feed-forward plus a correction, through the servo's lag,
    // no faster than its drive
    const servo = (key, ff, tau, max, angular) => {
      const err = angular ? gunnery.wrapPi(att[key] - rt.seen[key]) : att[key] - rt.seen[key];
      const want = clamp(rate[key] * ff + err / tau, -max, max);
      rt.drive[key] += (want - rt.drive[key]) * (1 - Math.exp(-dt / st.servo));
      const v = rt.seen[key] + rt.drive[key] * dt;
      rt.seen[key] = angular ? gunnery.wrapPi(v) : v;
    };
    if (st.tiltTau) {
      servo('pitch', st.ff, st.tiltTau, st.elev, false);
      servo('roll', st.ff, st.tiltTau, st.elev, false);
    } else {
      rt.seen.pitch = rt.hand.pitch;
      rt.seen.roll = rt.hand.roll;
    }
    if (st.yawTau) servo('heading', st.yawFf, st.yawTau, st.trav, true);
    else rt.seen.heading = rt.hand.heading;
  }

  /** What the hull's motion has thrown the gun (and the sight on it) off by, not yet laid back. */
  function layError(rt) {
    if (!rt.seen) return { yaw: 0, pitch: 0 };
    const seenTilt = rt.seen.pitch * Math.cos(rt.yaw) + rt.seen.roll * Math.sin(rt.yaw);
    return { yaw: gunnery.wrapPi(G.s.heading - rt.seen.heading), pitch: hullTilt(G.ss, rt.yaw) - seenTilt };
  }

  function aimTurrets(dt) {
    const ps = pose();
    // a wrecked turret drive leaves the hand traverse; a wrecked elevating gear, the slow handwheel
    const travMult = G.caps ? G.caps.traverse_mult : 1;
    const elevMult = G.caps ? G.caps.elevate_mult : 1;
    G.loadout.turrets.forEach((t0, ti) => {
      let t = travMult < 1 ? { ...t0, traverse: t0.traverse * travMult } : t0;
      if (ti === 0 && G.model?.hasFlaps) t = { ...t, limit: foldYawLimit(t0, G.fold.pose) };
      const rt = G.T[ti];
      let base = 0;
      if (t0.parent != null) {
        // a turret on another is carried round by it; its arc is measured from that turret's bearing
        base = G.T[t0.parent].yaw;
        if (rt.carried != null) rt.yaw = gunnery.wrapPi(rt.yaw + gunnery.wrapPi(base - rt.carried));
        rt.carried = base;
        t = { ...t, facing: t.facing + base };
      }
      trackHull(rt, t.stabilizer, dt);
      // the bearing is laid against the hull as the gunner last saw it pointing
      const lp = gunnery.toLocalPoint({ pos: ps.pos, heading: rt.seen.heading }, G.aimPoint);
      const pv = pivotOf(t0);
      const targetYaw = Math.atan2(lp[0] - pv[0], lp[2] - pv[2]);
      const stab = STABILIZER[t.stabilizer] || STABILIZER.none;
      let reach;
      if (stab.trav) {
        // the gunner lays a bearing on the ground at the traverse rate; the stabilizer holds it
        // there while the hull turns underneath
        if (rt.lay == null) rt.lay = rt.yaw + rt.seen.heading;
        const step = t.traverse * DEG * dt;
        rt.lay = gunnery.wrapPi(rt.lay + clamp(gunnery.wrapPi(targetYaw + rt.seen.heading - rt.lay), -step, step));
        gunnery.traverseLimited(rt, gunnery.wrapPi(rt.lay - rt.seen.heading), t.facing, t.limit, Math.max(t.traverse * DEG, stab.trav), dt);
        reach = gunnery.traverseLimited({ yaw: rt.yaw }, targetYaw, t.facing, t.limit, 0, dt);
      } else reach = gunnery.traverseLimited(rt, targetYaw, t.facing, t.limit, t.traverse * DEG, dt);
      rt.bearing = Math.abs(gunnery.wrapPi(reach - targetYaw)) < 0.01;
      rt.yawErr = gunnery.wrapPi(targetYaw - rt.yaw);
      const seenTilt = rt.seen.pitch * Math.cos(rt.yaw) + rt.seen.roll * Math.sin(rt.yaw);
      t.guns.forEach((g, gi) => {
        const gs = rt.guns[gi];
        const tr = gunnery.muzzleLocal(mountOf(t, g), { yaw: rt.yaw, pitch: 0 }).trunnion;
        const los = Math.atan2(lp[1] - tr[1], Math.hypot(lp[0] - tr[0], lp[2] - tr[2]));
        // the elevation is laid against the hull's attitude as the gunner (or the gyro) sees it,
        // as fast as the elevating gear allows
        const want = los + zeroElev(g) - seenTilt;
        // a designed vehicle's gun cannot dip as far over the hull as over the front
        // (an open mount's table holds while its armour flaps stand raised; folded down, the gun
        // dips its full amount all round)
        const depression = ti === 0 && G.model?.hasFlaps ? foldDepression(t0, rt.yaw - base, g.def.max_depression_deg, G.fold.pose) : depressionAt(t, rt.yaw - base, g.def.max_depression_deg);
        let def = depression !== g.def.max_depression_deg ? { ...g.def, max_depression_deg: depression } : g.def;
        if (elevMult < 1) def = { ...def, elevate_deg_s: def.elevate_deg_s * elevMult };
        if (stab.elev) {
          // the gunner lays the line of sight at the elevating rate; the gyro holds it against
          // the hull's pitch with its own, faster drive
          if (gs.lay == null) gs.lay = gs.pitch + seenTilt;
          const step = g.def.elevate_deg_s * DEG * dt;
          gs.lay += clamp(los + zeroElev(g) - gs.lay, -step, step);
          gunnery.elevate({ ...def, elevate_deg_s: Math.max(def.elevate_deg_s, stab.elev / DEG) }, gs, gs.lay - seenTilt, 1, dt);
        } else gunnery.elevate(def, gs, want, 1, dt);
        gs.pitchErr = clamp(want, -def.max_depression_deg * DEG, def.max_elevation_deg * DEG) - gs.pitch;
        gs.limited = want < -def.max_depression_deg * DEG - 0.003 || want > def.max_elevation_deg * DEG + 0.003;
      });
    });
  }

  // ------------------------------------------------------------------- update

  function update(dt) {
    advanceFold(dt);
    G.time += dt;
    const k = G.keys;
    const input = {
      throttle: clamp((k.has('fwd') ? 1 : 0) - (k.has('back') ? 1 : 0) + G.touch.throttle, -1, 1),
      steer: clamp((k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0) + G.touch.steer, -1, 1),
      brake: k.has('brake') ? 1 : 0,
    };
    const garage = G.mode === 'garage';
    const testing = G.mode === 'test';
    // the debug panel's cruise control holds a test speed (steering stays with the driver)
    const cruise = G.mode === 'battle' ? physDebug.cruiseThrottle(G.s.u, G.params.vTop) : null;
    if (cruise != null && !k.has('back') && !k.has('brake')) input.throttle = cruise;
    else if (G.cruise != null) {
      if (k.has('fwd') || k.has('back')) G.cruise = null; // the driver takes over
      else input.throttle = CRUISE[G.cruise][1];
    }
    if (garage || testing) input.throttle = input.steer = input.brake = 0;
    if (G.online && G.online.dead) {
      input.throttle = input.steer = 0;
      input.brake = 1;
    }
    // what the damage leaves of the drive: a dead engine or driver, a broken track, the crew out repairing
    const caps = G.mode === 'battle' ? G.caps : null;
    if (caps) {
      if (!caps.driver) input.steer = 0;
      if (!caps.can_move) input.throttle = 0;
      else if (caps.engine_power < 1) input.throttle *= caps.engine_power;
      if (caps.repair_s > 0) {
        input.throttle = input.steer = 0;
        input.brake = 1;
      }
    }
    if (G.veh) G.veh.t.broken = caps && (!caps.track_left || !caps.track_right) ? { 1: !caps.track_right, [-1]: !caps.track_left } : null;
    const orbit = G.free || garage;
    // free look (C) from the sight looks round from the sight; only the x-ray leaves it
    const inSight = G.view === 'sight' && !garage && !G.xray;
    const st = sightTurret();
    const sg = sightGun();
    const srt = G.T[G.sightT];
    const sgs = srt.guns[G.sightG];
    const selectedMg = G.MG[G.sightM];
    const sightTable = selectedMg ? selectedMg.m.table : sg.table;

    // ---- mouse -> camera / aim
    const dx = G.mdx;
    const dy = G.mdy;
    G.mdx = G.mdy = 0;
    const levels = sightLevels();
    const level = levels[clamp(G.zoomIdx, 0, levels.length - 1)];
    const ze = ballistics.elevationAt(sightTable, G.zero);
    if (G.thumbShot || testing) {
      /* the card picture is taken from a fixed angle; the test range aims with its own camera */
    } else if (G.ret) {
      G.ret.t += dt / 0.2;
      const e = 1 - Math.pow(1 - Math.min(G.ret.t, 1), 3);
      G.cam.yaw = G.ret.yaw0 + gunnery.wrapPi(G.ret.yaw1 - G.ret.yaw0) * e;
      G.cam.pitch = lerp(G.ret.pitch0, G.ret.pitch1, e);
      if (G.ret.t >= 1) G.ret = null;
    } else {
      // One rule for both views: the mouse turns the view at once, by the same angle on screen
      // per millimetre of mouse at any magnification, and the guns chase the middle of the picture.
      const sens = 0.0023 * (G.cam.fov / THIRD_FOV);
      G.cam.yaw = gunnery.wrapPi(G.cam.yaw + dx * sens);
      let lo = -0.6;
      let hi = 0.38;
      if (garage) [lo, hi] = [-0.95, 0.04];
      else if (orbit) [lo, hi] = [-1.25, 1.1];
      else if (inSight) {
        const arc = selectedMg && selectedMg.m.mount !== 'coax' ? selectedMg.m.arc : null;
        [lo, hi] = [-(arc ? arc[1] : sg.def.max_depression_deg * DEG) - ze - .06,
          (arc ? arc[2] : sg.def.max_elevation_deg * DEG) - ze + .06];
      }
      G.cam.pitch = clamp(G.cam.pitch - dy * sens, lo, hi);
      // the garage turntable: the view drifts round the vehicle until you take hold of it
      G.spinHold = Math.max(0, G.spinHold - dt);
      if (garage && !G.workshop && !G.xray && !G.protect && G.spinHold <= 0) G.cam.yaw = gunnery.wrapPi(G.cam.yaw + dt * 0.1);
    }

    // ---- simulation at a fixed step
    if (G.fireHeld && G.mode === 'battle') trigger();
    if (G.mgHeld && G.mode === 'battle') trigger(true);
    for (let i = G.pending.length - 1; i >= 0; i--) {
      const p = G.pending[i];
      p.t -= dt;
      if (p.t <= 0) {
        fireGun(p.ti, p.gi);
        G.pending.splice(i, 1);
      }
    }
    G.acc += dt;
    let steps = 0;
    while (G.acc >= SIM_DT && steps < 12) {
      const uBefore = G.s.u;
      // terrain -> track contacts -> road wheels -> suspension -> hull; engine -> tracks -> ground
      if (G.flooded) input.throttle = 0;
      G.veh.t.obstacles = G.mode === 'garage' ? [] : obstacleBoxes();
      G.info = { ...G.veh.step(input, SIM_DT, G.mode !== 'garage' && !G.thumbShot), sinkage: G.veh.sinkage };
      G.veh.compat(G.s);
      if (G.map && G.mode === 'battle') wade(SIM_DT);
      G.ss = G.veh.attitude();
      G.aLong = lerp(G.aLong, clamp((G.s.u - uBefore) / SIM_DT, -12, 12), 0.12);
      G.sink = G.veh.sinkage;
      G.travel = { 1: G.veh.t.travel[1], [-1]: G.veh.t.travel[-1] };
      // upper run of each track: taut on the side the sprocket pulls from, slack on the other,
      // and it swings a little before it settles
      for (const side of [1, -1]) {
        const f = (side > 0 ? G.info.forceR : G.info.forceL) / (0.5 * G.params.mass * 9.81);
        const want = clamp(1 - 2.2 * f * (G.model.sprocketFront ? 1 : -1), 0.3, 2.4);
        const sg = G.sag[side];
        sg.v += (190 * (want - sg.x) - 7 * sg.v) * SIM_DT;
        sg.x = clamp(sg.x + sg.v * SIM_DT, 0.2, 3);
      }
      if (G.mode === 'battle') aimTurrets(SIM_DT);
      stepMachineGuns(SIM_DT);
      G.loadout.turrets.forEach((t, ti) => {
        t.guns.forEach((g) => tickLauncher(g, SIM_DT));
        const done = loading.tick(G.T[ti].loading, SIM_DT / (G.caps ? G.caps.reload_mult : 1), (gi, li) => reloadTime(t, gi, li));
        for (const gi of done) {
          const g = t.guns[gi];
          refillBelt(g);
          g.loaded = nextAmmo(g);
          if (g.loaded < 0) G.T[ti].loading.state[gi] = 'empty';
          else g.selected = g.ammo[g.selected].count > 0 ? g.selected : g.loaded;
          syncGunShell(g);
          refillLauncher(g);
        }
        if (done.length && !t.guns[done[0]].def.autocannon) sound.click();
        // a rotary gun's barrels spin up while its trigger is held and run down after
        t.guns.forEach((g) => {
          const a = g.def.autocannon;
          if (!a || !(a.spin_up_s > 0)) return;
          const held = G.sightM < 0 && (ti === G.sightT ? G.fireHeld || G.mgHeld : G.mgHeld);
          g.spin = clamp(g.spin + (held ? SIM_DT : -2 * SIM_DT) / a.spin_up_s, 0, 1);
        });
      });
      G.acc -= SIM_DT;
      steps++;
    }
    if (steps === 12) G.acc = 0;
    if (G.online && G.mode === 'battle') netStep(dt);
    if (G.mode === 'battle') conquestStep(dt);
    if (G.mode === 'battle') advanceCombat(dt);
    if (G.mode === 'battle') {
      aiMissiles(dt);
      missileStep(dt);
    }
    const terrainId = terrainAt(G.s.x, G.s.z);
    if (G.ranging) {
      G.ranging.t += dt;
      if (G.ranging.t >= G.ranging.total) finishRanging();
    }

    // ---- model: hull on its springs, wheels on the ground, tracks round them
    const M = G.model;
    const ss = G.ss;
    M.root.pos = [G.s.x, 0, G.s.z];
    M.root.yaw = G.s.heading;
    // the hull exactly as the rigid body stands (the root carries position and heading)
    M.body.local = G.veh.hullLocal(G.s.heading);
    M.turrets.forEach((mt, ti) => {
      const rt = G.T[ti];
      const par = G.loadout.turrets[ti].parent;
      mt.node.yaw = par != null ? gunnery.wrapPi(rt.yaw - G.T[par].yaw) : rt.yaw;
      // through the sight you do not see your own turret, wherever the view is turned
      mt.node.visible = !(inSight && ti === G.sightT);
      mt.guns.forEach((mg, gi) => {
        const gs = rt.guns[gi];
        // Automatic guns complete this travel within their cycle; large guns keep their slower run-out.
        advanceGunRecoil(gs, G.loadout.turrets[ti].guns[gi].def, dt);
        if (gs.smoke > 0) {
          gs.smoke -= dt;
          if (Math.random() < dt * 28 * Math.min(1, gs.smoke)) {
            const t = G.loadout.turrets[ti];
            const mzl = gunnery.muzzleWorld(pose(), mountOf(t, t.guns[gi]), { yaw: rt.yaw, pitch: gs.pitch + hullTilt(G.ss, rt.yaw) });
            fx.muzzleSmoke(mzl.pos, mzl.dir, t.guns[gi].def.caliber_mm);
          }
        }
        mg.node.pitch = -gs.pitch;
        mg.barrel.pos = [0, 0, -gs.recoil];
        // a rotary gun's barrel cluster turns while it spins up and fires (the active protection
        // gun as its own system drives it), shown at a rate the eye can follow
        const gdef = G.loadout.turrets[ti].guns[gi];
        if (gdef.def.autocannon && gdef.def.autocannon.spin_up_s > 0) {
          const apsSpin = G.apsState && (G.aps?.turret ?? 1) === ti ? G.apsState.spin || 0 : 0;
          gs.roll = ((gs.roll || 0) + dt * Math.max(gdef.spin || 0, apsSpin) * Math.PI * 2 * 9) % (Math.PI * 2);
          mg.barrel.roll = gs.roll;
        }
      });
    });
    for (const pm of M.mgs) {
      const e = G.MG[pm.index];
      pm.node.yaw = e.aim.yaw - G.T[0].yaw;
      pm.node.pitch = -e.aim.pitch;
    }
    // the running gear is drawn in the hull's frame: road wheels where the springs hold them
    // against the hull, the track over the ground as the hull sees it
    const lifts = G.veh.wheelLifts();
    const groundUnder = (side) => G.veh.groundUnder(side);
    // detail by distance: wheels and ground contact close up, a simple loop further, scrolling links far
    const camDist = G.camPos ? Math.hypot(G.camPos[0] - G.s.x, G.camPos[2] - G.s.z) : 0;
    M.updateRunningGear({
      lod: camDist < 70 ? 0 : camDist < 220 ? 1 : 2,
      lifts,
      travel: G.travel,
      slack: { 1: 1 + 0.3 * (G.sag[1].x - 1), [-1]: 1 + 0.3 * (G.sag[-1].x - 1) },
      ground: { 1: groundUnder(1), [-1]: groundUnder(-1) },
      wheels: G.veh.wheelPose(),
    });

    // ---- camera
    // free look and the garage orbit the middle of the vehicle so it stays centred
    // free look and the x-ray turn the view about the same point as the third-person camera:
    // pressing C or O never moves the camera, it only lets it look round
    const target = [G.s.x, (garage ? M.height * 0.5 : M.height + 0.9) + (G.s.y || 0), G.s.z];
    if (garage) {
      // ... the middle of the whole vehicle, gun included
      const mid = (G.dims.front + G.dims.rear) * 0.5 * 0.6;
      target[0] += Math.sin(G.s.heading) * mid;
      target[2] += Math.cos(G.s.heading) * mid;
    }
    if (!G.cam.pivot) G.cam.pivot = target.slice();
    const follow = 1 - Math.exp(-dt * 14);
    for (let i = 0; i < 3; i++) G.cam.pivot[i] += (target[i] - G.cam.pivot[i]) * follow;
    if (G.camOverride && G.camOverride.pivot) G.cam.pivot = G.camOverride.pivot.slice();
    G.cam.dist = lerp(G.cam.dist, G.cam.distTarget, 1 - Math.exp(-dt * 10));
    G.cam.shake *= Math.exp(-dt * 7);
    G.cam.kick *= Math.exp(-dt * 6);

    const [cw, ch] = renderer.resize();
    hud.resize(cw, ch);
    const tilt = hullTilt(G.ss, srt.yaw);
    renderer.pixelSize = PIXEL_MODES[G.pixelIdx] && !G.thumbShot ? Math.round(PIXEL_MODES[G.pixelIdx] * (cw / Math.max(1, canvas.clientWidth))) : 0;
    renderer.pixelLevels = PIXEL_LEVELS[G.pixelIdx] || 20;
    renderer.advance(dt);
    renderer.mud = hexToLinear(MUD_HEX[terrainId] || MUD_HEX.dirt);
    renderer.wet = MUD_AMOUNT[terrainId] ?? 0.5;
    const aspect = cw / ch;
    let camPos;
    let fwd;
    let fovY;
    let scope = null;
    const jitter = () => (Math.random() - 0.5) * Math.min(1, G.cam.shake);
    if (testing && !G.thumbShot) {
      const c = testRange.camera(dt, G);
      camPos = c.camPos;
      fwd = c.fwd;
      fovY = c.fovY;
    } else if (G.thumbShot) {
      // card picture: three-quarter view from the garage's default side, framed to the vehicle
      const tanY = aspect >= 16 / 9 ? (THUMB_TAN * 9) / 16 : THUMB_TAN / aspect;
      fovY = 2 * Math.atan(tanY);
      fwd = dirFrom(GARAGE.camYaw, -0.15);
      const rel = gunnery.wrapPi(GARAGE.camYaw + Math.PI - G.s.heading);
      const seen = (G.dims.front - G.dims.rear) * Math.abs(Math.sin(rel)) + G.dims.width * Math.abs(Math.cos(rel));
      const dist = Math.max((seen * 0.5 * 1.12) / THUMB_TAN, (M.height * 0.62) / ((THUMB_TAN * 9) / 16));
      const mid = (G.dims.front + G.dims.rear) * 0.5;
      const c = [G.s.x + Math.sin(G.s.heading) * mid, M.height * 0.46, G.s.z + Math.cos(G.s.heading) * mid];
      camPos = [c[0] - fwd[0] * dist, c[1] - fwd[1] * dist, c[2] - fwd[2] * dist];
    } else if (inSight) {
      const mz = sightMuzzle(tilt);
      // The eyepiece sits on the gun, but the picture turns with the mouse straight away; the
      // graticule shows where the gun really points and closes on the middle as the turret arrives.
      // ... and is carried off with the gun by the hull's motion until the laying catches up
      const off = selectedMg ? { yaw: 0, pitch: 0 } : layError(srt);
      fwd = dirFrom(G.cam.yaw + off.yaw + jitter() * 0.004, G.cam.pitch + off.pitch + G.cam.kick + jitter() * 0.004);
      camPos = [mz.trunnion[0] + mz.dir[0] * 0.6, mz.trunnion[1] + mz.dir[1] * 0.6, mz.trunnion[2] + mz.dir[2] * 0.6];
      scope = { ...sightProjection(level, cw, ch), level };
      fovY = scope.fovY;
      G.cam.fov = fovY;
    } else {
      const speedFov = Math.min(Math.abs(G.s.u) / 16, 1) * 4 * DEG;
      let wantFov = ((G.rmb || G.zoom3) && !orbit ? THIRD_ZOOM_FOV : THIRD_FOV) + speedFov;
      if (garage) {
        // The garage looks through a longer lens, so the vehicle is not stretched by perspective
        // (an upright phone screen needs a wider one), and stands back far enough for the whole
        // vehicle to fit in the part of the screen the panels leave free.
        const tanY = Math.max(Math.tan(GARAGE_FOV / 2), 0.26 / aspect);
        wantFov = 2 * Math.atan(tanY);
        const free = Math.max(0.35, 1 - G.inset.right);
        const fit = ((G.dims.front - G.dims.rear) * 0.6) / (tanY * aspect * free);
        G.cam.distTarget = clamp(fit * G.gzoom, 8, GARAGE_MAX_DIST);
      }
      G.cam.fov = lerp(G.cam.fov > 1.2 ? THIRD_FOV : G.cam.fov, wantFov, 1 - Math.exp(-dt * 11));
      // a long lens from far off (__tf.camOverride: comparing a model with its drawings)
      if (G.camOverride) {
        G.cam.fov = G.camOverride.fov;
        G.cam.dist = G.cam.distTarget = G.camOverride.dist;
      }
      fovY = G.cam.fov;
      fwd = dirFrom(G.cam.yaw + jitter() * 0.012, G.cam.pitch + jitter() * 0.012);
      camPos = [G.cam.pivot[0] - fwd[0] * G.cam.dist, G.cam.pivot[1] - fwd[1] * G.cam.dist, G.cam.pivot[2] - fwd[2] * G.cam.dist];
      if (garage && !G.camOverride) {
        // slide the view so the vehicle sits in the part of the screen the panels leave free
        const b = lookAtLH(camPos, fwd);
        const tanY = Math.tan(fovY / 2);
        const sx = G.inset.right * tanY * aspect * G.cam.dist;
        const sy = (G.inset.bottom - G.inset.top) * tanY * G.cam.dist;
        for (let i = 0; i < 3; i++) camPos[i] += b.right[i] * sx - b.up[i] * sy;
      }
      else if (document.body.dataset.touch !== '1') {
        // the weapons bar sits bottom-centre: drop the camera a little so the vehicle rides above it
        const b = lookAtLH(camPos, fwd);
        const sy = 0.13 * Math.tan(fovY / 2) * G.cam.dist;
        for (let i = 0; i < 3; i++) camPos[i] -= b.up[i] * sy;
      }
      if (G.map && !garage) {
        // the camera stays out of the buildings: pulled in to the first wall behind the vehicle
        const wall = G.map.segmentHit(G.cam.pivot, camPos);
        if (wall) {
          const d = Math.hypot(camPos[0] - G.cam.pivot[0], camPos[1] - G.cam.pivot[1], camPos[2] - G.cam.pivot[2]);
          const k = Math.max(0.05, wall.t - 0.5 / Math.max(d, 1));
          for (let i = 0; i < 3; i++) camPos[i] = G.cam.pivot[i] + (camPos[i] - G.cam.pivot[i]) * k;
        }
      }
      camPos[1] = Math.max(camPos[1], groundAt(camPos[0], camPos[2]) + 0.45);
    }
    G.camPos = camPos;
    G.camFwd = fwd;
    const la = lookAtLH(camPos, fwd);
    const proj = perspective(fovY, aspect, 0.3, 9000);
    const viewProj = mul(proj, la.view);
    const tanY = Math.tan(fovY / 2);
    const cam = { pos: camPos, viewProj, forward: la.forward, right: la.right, up: la.up, tanX: tanY * aspect, tanY, near: 0.3, far: 9000 };
    G.lastCam = cam;
    if (G.protect && G.veh) {
      const yaw0 = G.T[0] ? G.T[0].yaw : 0;
      protection.update(G.veh.body, yaw0);
      if (G.protMouse && !G.protMouse.down) {
        const r = protRay(G.protMouse.ndc);
        const h = r ? protection.pick(r.o, r.d, yaw0) : null;
        const text = h ? protection.describe(h) : '';
        if (text !== G.protText) {
          G.protText = text;
          if (text) protInfo.textContent = text;
        }
      }
    }

    // ---- aim, the same in third person and through the sight: the guns chase the point under
    // the middle of the picture
    let gunPx = null;
    let aligned = false;
    if (!orbit && !G.ret && !testing) {
      const ad = dirFrom(G.cam.yaw, G.cam.pitch);
      const hit = losHit(camPos, ad, 2500);
      const t = Math.max(hit ? hit.t : 2500, inSight ? 25 : G.cam.dist + 12);
      G.aimPoint = [camPos[0] + ad[0] * t, camPos[1] + ad[1] * t, camPos[2] + ad[2] * t];
      const tr = selectedMg ? sightMuzzle().trunnion : gunnery.muzzleWorld(pose(), mountOf(st, sg), { yaw: srt.yaw, pitch: 0 }).trunnion;
      const d = [G.aimPoint[0] - tr[0], G.aimPoint[1] - tr[1], G.aimPoint[2] - tr[2]];
      G.aim.yaw = Math.atan2(d[0], d[2]);
      G.aim.pitch = Math.atan2(d[1], Math.hypot(d[0], d[2]));
      G.aim.dist = Math.hypot(d[0], d[1], d[2]);
      G.aim.blocked = selectedMg ? !selectedMg.bearing : !!sgs.limited || !srt.bearing;
    }
    if (!inSight && !orbit && !testing) {
      // the ring shows the sight line of the sighting gun: bore direction minus the set elevation
      const mz = sightMuzzle(tilt);
      const sl = selectedMg ? dirFrom(Math.atan2(mz.dir[0], mz.dir[2]), Math.asin(clamp(mz.dir[1], -1, 1)) - ze) : dirFrom(G.s.heading + srt.yaw, sgs.pitch + tilt - ze);
      let reach = Math.max(G.aim.dist - sg.muzzleOffset, 5);
      if (sl[1] < -1e-4) reach = Math.min(reach, mz.pos[1] / -sl[1]);
      const gp = [mz.pos[0] + sl[0] * reach, mz.pos[1] + sl[1] * reach, mz.pos[2] + sl[2] * reach];
      const pr = project(viewProj, gp);
      if (pr[2] > 0) gunPx = [(pr[0] * 0.5 + 0.5) * cw, (1 - (pr[1] * 0.5 + 0.5)) * ch];
      aligned = selectedMg ? selectedMg.bearing && Math.abs(gunnery.wrapPi(Math.atan2(sl[0], sl[2]) - G.aim.yaw)) < .01 && Math.abs(Math.asin(clamp(sl[1], -1, 1)) - G.aim.pitch) < .01 : Math.abs(srt.yawErr) < 0.004 && Math.abs(sgs.pitchErr) < 0.004;
    }
    if (inSight) {
      // where the gun's sight line falls in the picture
      const mz = selectedMg ? sightMuzzle(tilt) : null;
      const sl = mz ? dirFrom(Math.atan2(mz.dir[0], mz.dir[2]), Math.asin(clamp(mz.dir[1], -1, 1)) - ze) : dirFrom(G.s.heading + srt.yaw, sgs.pitch + tilt - ze);
      const pr = project(viewProj, [camPos[0] + sl[0] * 2000, camPos[1] + sl[1] * 2000, camPos[2] + sl[2] * 2000]);
      G.sightOffset = pr[2] > 0 ? [pr[0] * 0.5 * cw, -pr[1] * 0.5 * ch] : [fwd[0] * sl[2] - fwd[2] * sl[0] > 0 ? -cw : cw, 0];
    }

    // ---- projectiles and effects
    updateShots(dt);
    updateBullets(dt);
    if (G.missiles) G.missiles.draw(dt, camPos);
    if (testing) testRange.step(dt);
    const speed = Math.abs(G.s.u);
    // a slipping track throws far more than a rolling one, and throws it the way the track runs
    const slipMax = Math.max(G.info.slipL, G.info.slipR);
    G.dustAcc += dt * (speed * 1.6 + slipMax * 22) * (DUSTINESS[terrainId] ?? 0.5);
    while (G.dustAcc > 1) {
      G.dustAcc -= 1;
      const side = Math.random() < G.info.slipR / (G.info.slipL + G.info.slipR + 1e-3) ? 1 : -1;
      const run = side > 0 ? G.info.trackSpeedR : G.info.trackSpeedL;
      const sl = side > 0 ? G.info.slipR : G.info.slipL;
      const back = run >= 0 ? -1 : 1;
      const lp = [side * M.trackX, 0.25, back * M.length * 0.48];
      const wp = gunnery.toWorldPoint(pose(), lp);
      const wv = gunnery.toWorldDir(pose(), [(Math.random() - 0.5) * 1.5, 0.8 + Math.random() * (1 + sl * 3), back * (1 + Math.abs(run) * 0.25 + sl * 4)]);
      fx.trackDust(wp, wv, DUST_COLOR[terrainId], Math.min(1, speed / 10 + sl * 1.5));
    }
    // the exhaust: thin at idle, thick under load, a dark puff as the throttle opens
    // the crew at their work: the loader's reload cycle, the gunner rocked by the shot
    if (G.interior && G.loadout && G.T && !G.thumbShot) animateCrew(G.interior, G.innerCrew || [], G.loadout, G.T, performance.now() / 1000, G.firedAt || []);
    if (G.exhaust && !G.thumbShot && !(G.caps && G.caps.destroyed) && !(G.online && G.online.dead)) {
      const idleR = G.params.engine.idle_rpm;
      const r01 = clamp(((G.rpmShown || idleR) - idleR) / Math.max(1, G.params.engine.max_rpm - idleR), 0, 1);
      G.exhaust.updateHull(dt, G.veh.body, G.info.throttleLoad || 0, r01);
    }
    // ruts: where the tracks pressed into soft ground
    G.rutAcc += (Math.abs(G.info.groundSpeedL || 0) + Math.abs(G.info.groundSpeedR || 0)) * 0.5 * dt;
    fx.update(dt);
    fx.build(cam);

    // ---- draw
    hitcam.tick(dt);
    if (G.skipDraw) return;
    scene.update(null);
    const nodes = scene.collect([]);
    // the terrain grid and the ruts follow the vehicle
    world.placeGrid(G.s.x, G.s.z);
    streamDeformation(G.s.x, G.s.z);
    renderer.clock = G.time;
    for (const e of G.enemies || []) {
      if (!e.alive || (e.caps && e.caps.on_fire)) fx.burning([e.x, e.veh.body.origin()[1] + 1.6, e.z], dt, e.alive ? 0.7 : 1);
      if (e.toss && e.toss.t < 4) {
        // the turret blown off by the ammunition: up, over, and down onto the hull or the ground
        const k = e.toss;
        k.t += dt;
        k.vy -= 9.8 * dt;
        k.y = Math.max(-0.4, k.y + k.vy * dt);
        const mt = e.model.turrets[0];
        const pv = e.turret.position_m;
        mt.node.pos = [pv[0] + k.tilt * k.t * 0.8, pv[1] + k.y, pv[2] + k.spin * k.t * 0.3];
        mt.node.roll = k.tilt * Math.min(k.t, 1.2);
        mt.node.pitch = k.spin * 0.3 * Math.min(k.t, 1.2);
      }
    }
    if ((G.online && G.online.dead) || (G.caps && (G.caps.on_fire || G.caps.destroyed))) fx.burning([G.s.x, (G.s.y || 0) + 1.6, G.s.z], dt, G.caps && G.caps.on_fire ? 1 : 0.6);
    if (G.mapEntry) {
      const w = G.mapEntry.world;
      // trees go over when the hull runs into them (each costs a little momentum)
      if (G.mode === 'battle' && G.veh) {
        const b = G.veh.body;
        const fell = w.collide({ x: G.s.x, z: G.s.z, heading: G.s.heading, halfW: G.dims.width / 2, halfL: (G.dims.front - G.dims.rear) / 2, vx: b.v[0], vz: b.v[2] });
        if (fell) {
          const k = Math.max(0, 1 - 0.12 * fell);
          b.v = [b.v[0] * k, b.v[1], b.v[2] * k];
          sound.impact(4, false);
          G.treesDown = (G.treesDown || 0) + fell;
        }
      }
      w.update(G.camPos ? G.camPos[0] : G.s.x, G.camPos ? G.camPos[2] : G.s.z, dt);
    }
    renderer.render(nodes, cam, [G.s.x, 1, G.s.z], fx);
    // the status panel's window: the vehicle from above, as it is now
    if ((G.mode === 'battle' || G.mode === 'test') && !G.thumbShot && G.statusWin && !(G.online && G.online.dead)) renderStatusView(G.statusWin, cw / Math.max(1, canvas.clientWidth));
    // the hit camera's picture in the top right corner, over the finished frame
    const insetFrame = { nodes, cw, ch, scale: cw / Math.max(1, canvas.clientWidth) };
    if (hitcam.active && (G.mode === 'battle' || G.mode === 'test' || G.protect) && !G.thumbShot) hitcam.render3d(insetFrame);

    // ---- HUD
    const idle = G.params.engine.idle_rpm;
    const load = G.info.throttleLoad || 0;
    const moving = Math.abs(G.s.u) > 0.3 || load > 0.2;
    G.rpmShown = lerp(G.rpmShown || idle, moving ? G.info.rpm : idle, 1 - Math.exp(-dt * 6));
    hud.drive({ ...G.info, rpmShown: G.rpmShown, sink: G.sink, pressure: G.params.groundPressure }, G.map && (G.waterDepth || 0) > 0.1 ? 'water' : terrainId, G.params.engine.max_rpm, idle, physDebug.cruise != null ? `測試 ${physDebug.cruise}` : G.cruise != null ? CRUISE[G.cruise][0] : null);
    const states = [];
    G.loadout.turrets.forEach((t, ti) => {
      t.guns.forEach((g, gi) => {
        const pr = loading.progress(G.T[ti].loading, gi);
        states.push({ ...pr, bearing: G.T[ti].bearing, sighting: G.sightM < 0 && ti === G.sightT && gi === G.sightG });
      });
    });
    if (G.thumbShot) return;
    hud.guns(states);
    hud.ammo(sg, loading.progress(srt.loading, G.sightG));
    const dv = G.mode === 'battle' && G.cstate ? damageView() : { items: [], shape: G.statusShape };
    hud.damageLine(dv.items);
    if (dv.shape) {
      const sel = sg && sg.ammo[sg.loaded >= 0 ? sg.loaded : sg.selected];
      G.statusWin = hud.drawStatus({
        ...dv.shape,
        stab: (G.loadout.turrets[0].stabilizer || 'none') !== 'none',
        ready: selectedMg ? selectedMg.st.belt : sel ? sel.count : null,
        fire: !!(G.caps && G.caps.on_fire),
      });
    }
    hud.mgs(G.MG.map((e, i) => ({ belt: e.st.belt, heat: e.st.heat, hot: e.st.hot, reload: e.st.reload, bearing: e.bearing, sighting: i === G.sightM })));
    hud.viewLabel(G.xray ? '內構透視' : G.free ? '自由視角' : inSight ? `炮手瞄準鏡 ${level.magnification}×` : '第三人稱');
    hud.zero(`${G.zero > 0 ? `表尺 ${G.zero} m` : '表尺 直瞄'}　自動裝表 ${G.autoZero ? '開' : '關'}`);
    hud.tick(dt);
    hud.clear();
    hud.overlay.style.visibility = garage && !G.xray && !(G.protect && hitcam.active) ? 'hidden' : 'visible';
    if (G.xray) {
      const tags = [];
      for (const l of G.interior.labels) {
        const w = l.node.world;
        const pr = project(viewProj, [w[12], w[13], w[14]]);
        if (pr[2] > 0) tags.push({ x: (pr[0] * 0.5 + 0.5) * cw, y: (1 - (pr[1] * 0.5 + 0.5)) * ch, text: l.text, crew: l.crew });
      }
      if (testing) {
        for (const t of testRange.labels((p) => {
          const pr = project(viewProj, p);
          return { ok: pr[2] > 0, x: (pr[0] * 0.5 + 0.5) * cw, y: (1 - (pr[1] * 0.5 + 0.5)) * ch };
        }))
          tags.push({ ...t, text: '✖ ' + t.text });
      }
      hud.drawLabels(tags);
    }
    if (G.map && G.map.points.length && G.mode === 'battle') {
      // the capture points, over the battlefield: their circle on the ground, a marker over them
      const pts = [];
      const live = G.conquest ? G.conquest.points : null;
      const scr = (q) => {
        const pr = project(viewProj, q);
        return pr[2] > 0 && Math.abs(pr[0]) < 3 && Math.abs(pr[1]) < 3 ? [(pr[0] * 0.5 + 0.5) * cw, (1 - (pr[1] * 0.5 + 0.5)) * ch] : null;
      };
      G.map.points.forEach((p, i) => {
        const st = live ? live[i] : null;
        const dist = Math.hypot(p.x - G.s.x, p.z - G.s.z);
        if (dist < 700 && G.view !== 'sight') {
          const ring = [];
          for (let k = 0; k <= 64; k++) {
            const a = (k / 64) * Math.PI * 2;
            const x = p.x + Math.sin(a) * p.r;
            const z = p.z + Math.cos(a) * p.r;
            ring.push(scr([x, surfaceAt(x, z) + 0.25, z]));
          }
          hud.drawRing(ring, st?.owner);
        }
        const pr = project(viewProj, [p.x, p.y + 11, p.z]);
        if (!(pr[2] > 0) || Math.abs(pr[0]) > 1.05 || Math.abs(pr[1]) > 1.05) return;
        pts.push({ x: (pr[0] * 0.5 + 0.5) * cw, y: (1 - (pr[1] * 0.5 + 0.5)) * ch, id: p.id, dist, inside: dist <= p.r, owner: st?.owner, progress: st?.progress || 0 });
      });
      hud.drawPoints(pts);
    }
    if (G.online && G.mode === 'battle') {
      // the other players' names over their vehicles; enemies only while in sight
      const tags = [];
      const check = G.mapTick % 6 === 0;
      for (const e of G.enemies) {
        if (!e.remote) continue;
        const p = [e.x, e.veh.body.origin()[1] + e.box.top + 1.0, e.z];
        const dist = Math.hypot(e.x - G.s.x, e.z - G.s.z);
        const friend = e.team === G.online.team;
        if (check || e.seen == null) {
          const d = [p[0] - camPos[0], p[1] - camPos[1], p[2] - camPos[2]];
          const l = Math.hypot(d[0], d[1], d[2]) || 1;
          e.seen = friend || (groundRay(camPos, [d[0] / l, d[1] / l, d[2] / l], l, surfaceAt) >= l - 2 && !buildingHit(camPos, p));
        }
        if (!e.seen || (!friend && dist > 1500)) continue;
        const pr = project(viewProj, p);
        if (!(pr[2] > 0) || Math.abs(pr[0]) > 1.05 || Math.abs(pr[1]) > 1.05) continue;
        tags.push({ x: (pr[0] * 0.5 + 0.5) * cw, y: (1 - (pr[1] * 0.5 + 0.5)) * ch, name: e.player, vehicle: e.name, friend, alive: e.alive, dist });
      }
      hud.drawNameTags(tags);
      updateNetHud();
    }
    if (physDebug.on && G.mode === 'battle') {
      physDebug.draw(hud.ctx, (p) => {
        const pr = project(viewProj, p);
        return { ok: pr[2] > 0, x: (pr[0] * 0.5 + 0.5) * cw, y: (1 - (pr[1] * 0.5 + 0.5)) * ch };
      }, G.veh, ch / 900);
    }
    const sp = selectedMg ? { remaining: selectedMg.st.reload, waiting: false, empty: false } : loading.progress(srt.loading, G.sightG);
    if (scope) {
      hud.drawSight(scope.radius, scope.pxPerRad, {
        name: selectedMg ? selectedMg.m.def.name || selectedMg.m.weapon : st.sight.name,
        magnification: level.magnification,
        edgeOpacity: scope.edgeOpacity,
        statusWindow: G.online && G.online.dead ? null : G.statusWin,
        pixelScale: insetFrame.scale,
        hitcamRect: hitcam.active ? hitcam.cur.rectPx : null,
        ammo: selectedMg ? `${selectedMg.m.def.caliber_mm} mm · ${selectedMg.st.belt} 發` : sg.shell.name,
        status: sp.empty ? '彈藥耗盡' : sp.waiting ? '等裝填手' : sp.remaining > 0 ? `裝填中 ${sp.remaining.toFixed(1)} s` : '可射擊',
        ready: sp.remaining <= 0 && !sp.waiting && !(selectedMg && selectedMg.st.hot),
        table: sightTable,
        zeroElev: ze,
        zero: G.zero,
        offset: G.sightOffset,
        blocked: G.aim.blocked,
      });
    } else if (!orbit && !testing) hud.drawAim(gunPx, aligned, G.aim.blocked);
    if (hitcam.active && (G.mode === 'battle' || G.mode === 'test' || G.protect)) hitcam.draw2d(hud.ctx, insetFrame);
    // the main gun's reload: a ring round the aim mark (round the middle of the sight)
    if (G.mode === 'battle' && !orbit && !testing && !G.thumbShot && G.sightM < 0) {
      const pr = loading.progress(G.T[0].loading, 0);
      const g0 = G.loadout.turrets[0].guns[0];
      if (!g0.def.autocannon && !g0.def.missile) {
        if (inSight) hud.drawReloadRing(cw / 2, ch / 2, { ...pr, empty: pr.empty }, 34);
        else hud.drawReloadRing(gunPx ? gunPx[0] : cw / 2, gunPx ? gunPx[1] : ch / 2, pr, 24);
      }
    }
    if (G.mode === 'battle' && !orbit) {
      // what the range drum is set to, beside the aim mark; bright for a moment after a change
      G.zeroFlash = Math.max(0, (G.zeroFlash || 0) - dt);
      G.zoomFlash = Math.max(0, (G.zoomFlash || 0) - dt);
      // shown in the sight, and elsewhere only for a moment after the wheel sets it
      if (scope || G.zeroFlash > 0) hud.drawZeroTag(G.zero, G.zeroFlash, scope ? { radius: scope.radius, magnification: level.magnification, zoomFlash: G.zoomFlash } : null);
    }
    if (G.ranging && !orbit) hud.drawRanging(G.ranging.t / G.ranging.total, 30 * (ch / 900));
    if (G.mode === 'battle') {
      const touch = document.body.dataset.touch === '1';
      hud.drawCompass(orbit ? G.s.heading + srt.yaw : G.cam.yaw, G.s.heading, G.s.heading + srt.yaw, touch || canvas.clientWidth < 760);
      // the map changes slowly: every third frame is plenty
      if (G.mapTick++ % 3 === 0) {
        const others = (G.enemies || []).map((e) => ({ x: e.x, z: e.z, alive: e.alive, friend: !!(G.online && e.remote && e.team === G.online.team) }));
        if (G.mapEntry) hud.drawBattleMap({ image: G.mapEntry.minimap, map: G.map, x: G.s.x, z: G.s.z, hull: G.s.heading, gun: G.s.heading + srt.yaw, view: G.cam.yaw, spawns: G.map.spawns, points: G.conquest ? G.conquest.points : G.map.points, enemies: others });
        else hud.drawMinimap({ x: G.s.x, z: G.s.z, hull: G.s.heading, gun: G.s.heading + srt.yaw, view: G.cam.yaw, zones: MAP_ZONES, humps: MAP_HUMPS, targets: world.targets, others });
      }
    }
    document.body.dataset.view = inSight ? 'sight' : 'third';
    sound.drive(clamp((G.rpmShown - idle) / (G.params.engine.max_rpm - idle), 0, 1), load, G.s.u);
  }

  // --------------------------------------------------------------------- boot

  setMode('garage');
  document.body.dataset.workshop = '0';
  const all = entries();
  const wanted = saved.id || store.get(STORE_VEHICLE);
  hud.buildVehicleList(all, mods.cardOf(wanted));
  select(wanted === 'custom' || data.vehicles[wanted] ? wanted : data.order[0]);
  measureInsets();
  queueThumbs(all.map((e) => e.id));
  hud.loading(`整備車輛中 0／${G.thumbTotal}`);

  const renderScale = new RenderScale();
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (G.mode === 'bureau') {
      /* the design bureau has its own view; the range waits */
    } else if (!G.paused && G.thumbs.length) thumbStep();
    else if (!G.paused) {
      if (dt > 0) G.fps = lerp(G.fps || 60, 1 / dt, 0.05);
      update(dt);
      // slow frames: first the scene's resolution goes down (and comes back when there is room)
      const scaled = G.mode === 'battle' || G.mode === 'test' ? renderScale.sample(dt) : null;
      if (scaled != null) renderer.renderScale = scaled;
      // nobody picked a quality and the frame rate stays low even at the lowest resolution: step
      // down a tier once per few seconds
      if (!G.qualityChosen && renderer.quality !== 'low' && renderScale.atFloor) {
        G.slowFor = G.fps < 33 ? G.slowFor + dt : 0;
        if (G.slowFor > 3) {
          G.slowFor = 0;
          setQuality(QUALITY_ORDER[QUALITY_ORDER.indexOf(renderer.quality) - 1], false);
          hud.toast(`畫面更新偏慢，畫質已調為「${QUALITY[renderer.quality].label}」（按 L 可改）`, 4);
        }
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Test / automation hooks (also handy in the console).
  window.__tf = {
    G,
    /** Sets the hinged flaps at once (0 raised, 1 folded down). */
    fold(t) {
      G.fold.cur = G.fold.target = t;
      G.fold.pose = t;
      if (G.model && G.model.setFold) G.model.setFold(t);
      if (G.combat) G.combat.setFold(G.id, t);
    },
    /** Puts the vehicle standing still at (x, z) facing `heading`. */
    place(x, z, heading = 0) {
      G.veh.place(x, z, heading);
      G.veh.compat(G.s);
      G.ss = G.veh.attitude();
    },
    physDebug,
    /** Where turret ti's first gun points (world), for checking the laying and the stabilizers. */
    gunLine(ti = 0) {
      const t = G.loadout.turrets[ti];
      const rt = G.T[ti];
      return gunnery.muzzleWorld(pose(), mountOf(t, t.guns[0]), { yaw: rt.yaw, pitch: rt.guns[0].pitch + hullTilt(G.ss, rt.yaw) });
    },
    terrain,
    world,
    fx,
    targets: world.targets,
    sound,
    renderer,
    select,
    startBattle,
    toGarage,
    stepVehicle,
    /** Renders every card picture that is still queued, without waiting for animation frames. */
    finishThumbs() {
      while (G.thumbs.length) thumbStep();
    },
    hud,
    trigger,
    fireGun,
    toggleSight,
    setMapChoice,
    loadMap,
    missiles: () => G.missiles,
    aps: () => G.apsState,
    enemies: () => (G.enemies || []).map((e) => ({ id: e.id, x: e.x, z: e.z, alive: e.alive, hp: e.hp, remote: !!e.remote, player: e.netId ?? null, team: e.team ?? null, heading: e.heading, turretYaw: e.turretYaw })),
    net,
    lobby,
    deploy,
    combat: () => ({ state: G.cstate, caps: G.caps, last: G.lastCombat || null }),
    hitcam: () => (hitcam.active ? { t: hitcam.cur.t, total: hitcam.cur.total, stage: hitcam.stage().name, title: hitcam.cur.rep.title, mg: hitcam.cur.mg } : null),
    hitcamController: hitcam,
    enemyCombat: (i) => {
      const e = (G.enemies || [])[i];
      return e ? { state: e.cstate, caps: e.caps, alive: e.alive } : null;
    },
    repairVehicle,
    extinguishFire,
    online: () => (G.online ? { team: G.online.team, slot: G.online.slot, dead: G.online.dead, hp: G.online.hp, seq: G.online.seq, members: [...G.online.members.values()] } : null),
    mapState: () => ({ id: G.mapId, active: G.map ? G.map.id : 'range', water: G.waterDepth || 0, flooded: G.flooded, treesDown: G.treesDown || 0, standing: G.mapEntry ? G.mapEntry.world.standing() : 0 }),
    setFreeLook,
    setWorkshop,
    setZero,
    setPixel,
    setXray,
    setQuality,
    renderScale: () => renderScale,
    setTime,
    startRanging,
    cycleSightGun,
    exportBuild: () => exportFolder(G.build, data, data.vehicles[G.build.base], 'my_tank', '自訂戰車'),
    bureau,
    openBureau,
    testRange,
    enterTest,
    driveDesign,
    coreReady: () => coreP,
    refreshDesigns,
    checkFolder,
    pause(p = true) {
      G.paused = p;
    },
    /** Advances the game in fixed 1/60 s frames with the given held keys, then leaves it paused. */
    advance(seconds, keys = [], draw = true) {
      G.paused = true;
      G.keys = new Set(keys);
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n; i++) {
        G.skipDraw = !draw || i < n - 1; // only the last frame is drawn
        update(1 / 60);
      }
      G.skipDraw = false;
      G.keys = new Set();
    },
    state() {
      return {
        id: G.id,
        mode: G.mode,
        thumbs: G.thumbs.length,
        mg: G.MG.map((e) => ({ id: e.m.id, mount: e.m.mount, belt: e.st.belt, heat: e.st.heat, hot: e.st.hot, reload: e.st.reload, fired: e.st.fired, bearing: e.bearing })),
        mgHits: G.mgHits,
        lastMgHit: G.lastMgHit,
        bullets: G.bullets.length,
        sightOffset: G.sightOffset.slice(),
        x: G.s.x,
        z: G.s.z,
        heading: G.s.heading,
        speedKmh: G.s.u * 3.6,
        u: G.s.u,
        w: G.s.w,
        gear: G.s.gear,
        turrets: G.T.map((t) => ({ yaw: t.yaw, bearing: t.bearing, guns: t.guns.map((g) => g.pitch), loading: t.loading.state.slice() })),
        turretYaw: G.T[G.sightT].yaw,
        gunPitch: G.T[G.sightT].guns[G.sightG].pitch,
        aimYaw: G.aim.yaw,
        aimPitch: G.aim.pitch,
        camYaw: G.cam.yaw,
        camPitch: G.cam.pitch,
        view: G.view,
        free: G.free,
        zero: G.zero,
        rangeResult: G.rangeResult,
        shots: G.shots.length,
        hits: G.hits,
        lastHit: G.lastHit,
        drawCalls: renderer.drawCalls,
        triangles: G.model.triangles,
        gunCount: G.loadout.gunCount,
        mass: G.params.mass,
        fps: G.fps,
        ammo: { counts: sightGun().ammo.map((a) => a.count), kinds: sightGun().ammo.map((a) => a.shell.kind), loaded: sightGun().loaded, selected: sightGun().selected, shell: sightGun().shell.id },
        cruise: G.cruise,
        slipL: G.info.slipL,
        slipR: G.info.slipR,
        sink: G.sink,
        trackSpeedL: G.info.trackSpeedL,
        trackSpeedR: G.info.trackSpeedR,
        body: { y: G.ss.y, pitch: G.ss.pitch, roll: G.ss.roll },
        wheelLift: G.veh.t.ss.comp.slice(),
        wheelLoad: G.veh.t.ss.load.slice(),
        grounded: G.veh.t.ss.grounded.slice(),
        load: { left: G.veh.t.ss.load.slice(G.veh.t.ss.load.length / 2).reduce((a, b) => a + b, 0), right: G.veh.t.ss.load.slice(0, G.veh.t.ss.load.length / 2).reduce((a, b) => a + b, 0) },
        y: G.s.y,
        trackSpeed: { left: G.info.trackSpeedL, right: G.info.trackSpeedR },
        links: G.model.linkCount,
        pixelSize: renderer.pixelSize,
        quality: renderer.quality,
        xray: G.xray,
        interiorParts: G.interior.nodes.length,
        time: TIMES[renderer.timeIndex].id,
      };
    },
  };
  return { snapshot: () => ({ id: G.id }) };
}

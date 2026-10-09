// HUD: DOM readouts plus a 2D overlay canvas for the third-person aiming marks and the
// gunner sight (scope mask + reticle). The reticle's distance scale is drawn from the range
// table computed by the ballistics module for the loaded shell, so it is correct by construction.
import { shellIcon, shellKind, shellTypeLabel } from './shellicons.js';
import { TERRAIN_LABEL } from './world.js';

const NATION = { germany: '德', ussr: '蘇', usa: '美', uk: '英', fictional: '原創', design: '設計' };
const NATION_FULL = { germany: '德國', ussr: '蘇聯', usa: '美國', uk: '英國', fictional: '原創', design: '設計局' };
const CLASS = { spg: '自走炮', tank_destroyer: '驅逐戰車', armored_car: '裝甲車', light: '輕型戰車', medium: '中型戰車', heavy: '重型戰車', td: '驅逐戰車', spaa: '防空戰車', prototype: '原型車', custom: '自訂戰車', design: '自行設計' };
const OUTLINE = { traced: '外形：照圖面描繪', dimensions: '外形：依公開尺寸建模', original: '外形：原創設計', design: '外形：設計局自由建模' };
export const FILTERS = [['all', '全部'], ['germany', '德國'], ['ussr', '蘇聯'], ['usa', '美國'], ['uk', '英國'], ['fictional', '原創'], ['design', '設計局']];
const MG_MOUNT = { coax: '同軸', hull: '車體', pintle: '車頂' };
const THUMB_W = 344;
const THUMB_H = 194;

const $ = (id) => document.getElementById(id);

const OWNER_RGB = { blue: '79, 140, 255', red: '232, 70, 58' };

/** The status panel's window: radius as a share of the panel's width. */
export const STATUS_WINDOW = 0.33;
/** Where each kind of module sits round the status ring (degrees clockwise from the top). */
const PICTO_AT = { engine: 292, transmission: 310, fuel_tank: 328, radio: 346, gun_barrel: 18, gun_breech: 36, turret_drive: 54, vertical_drive: 112, ammo_rack: 130, track_r: 150, track_l: 208, aps_gun: 72, aps_radar: 90 };

/** A small line pictogram of a module (or the crew, a round, fire) centred on x, y, size s. */
function pictogram(g, kind, x, y, s, color) {
  g.save();
  g.translate(x, y);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = Math.max(1.2, s * 0.16);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const L = (pts, close = false) => {
    g.beginPath();
    pts.forEach(([a, b], i) => (i ? g.lineTo(a * s, b * s) : g.moveTo(a * s, b * s)));
    if (close) g.closePath();
    g.stroke();
  };
  const circle = (cx, cy, r, fill = false) => {
    g.beginPath();
    g.arc(cx * s, cy * s, r * s, 0, Math.PI * 2);
    fill ? g.fill() : g.stroke();
  };
  switch (kind) {
    case 'engine':
      L([[-0.9, -0.2], [0.9, -0.2], [0.9, 0.7], [-0.9, 0.7]], true);
      for (const cx of [-0.5, 0, 0.5]) L([[cx, -0.2], [cx, -0.7]]);
      break;
    case 'transmission':
      circle(0, 0, 0.5);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        L([[Math.cos(a) * 0.55, Math.sin(a) * 0.55], [Math.cos(a) * 0.85, Math.sin(a) * 0.85]]);
      }
      break;
    case 'fuel_tank':
      L([[-0.6, -0.5], [0.3, -0.5], [0.6, -0.2], [0.6, 0.8], [-0.6, 0.8]], true);
      L([[-0.3, -0.5], [-0.3, -0.8], [0.1, -0.8]]);
      break;
    case 'radio':
      L([[0, 0.8], [0, -0.4]]);
      for (const r of [0.35, 0.7]) {
        g.beginPath();
        g.arc(0, -0.4 * s, r * s, -Math.PI * 0.8, -Math.PI * 0.2);
        g.stroke();
      }
      break;
    case 'gun_barrel':
      L([[-0.9, 0.5], [0.9, -0.5]]);
      L([[-0.9, 0.2], [-0.6, 0.8]]);
      break;
    case 'gun_breech':
      L([[-0.7, -0.5], [0.7, -0.5], [0.7, 0.5], [-0.7, 0.5]], true);
      circle(0, 0, 0.25);
      break;
    case 'turret_drive':
      g.beginPath();
      g.arc(0, 0, 0.6 * s, -Math.PI * 0.2, Math.PI * 1.4);
      g.stroke();
      L([[0.48, -0.36], [0.62, 0.05], [0.25, -0.05]]);
      break;
    case 'vertical_drive':
      L([[0, -0.8], [0, 0.8]]);
      L([[-0.35, -0.45], [0, -0.8], [0.35, -0.45]]);
      L([[-0.35, 0.45], [0, 0.8], [0.35, 0.45]]);
      break;
    case 'ammo_rack':
    case 'ammo':
      L([[-0.25, 0.8], [-0.25, -0.3], [0, -0.8], [0.25, -0.3], [0.25, 0.8]], true);
      if (kind === 'ammo') {
        for (const [cx, cy] of [[0.75, -0.1], [1.15, -0.1], [0.75, 0.35], [1.15, 0.35], [0.95, 0.8]]) circle(cx, cy, 0.14);
      }
      break;
    case 'track_l':
    case 'track_r':
      L([[-0.4, -0.85], [0.4, -0.85], [0.4, 0.85], [-0.4, 0.85]], true);
      for (const cy of [-0.4, 0, 0.4]) L([[-0.4, cy], [0.4, cy]]);
      break;
    case 'aps_gun':
      for (const cy of [-0.35, 0, 0.35]) L([[-0.8, cy], [0.8, cy]]);
      break;
    case 'aps_radar':
      g.beginPath();
      g.arc(0, 0.6 * s, 0.9 * s, -Math.PI * 0.85, -Math.PI * 0.15);
      g.stroke();
      L([[0, 0.6], [0, -0.1]]);
      break;
    case 'crew':
      for (const cx of [-0.45, 0.45]) {
        g.beginPath();
        g.arc(cx * s, -0.1 * s, 0.42 * s, Math.PI, 0);
        g.stroke();
        L([[cx - 0.55, -0.1], [cx + 0.55, -0.1]]);
        L([[cx - 0.4, 0.75], [cx - 0.3, 0.25], [cx + 0.3, 0.25], [cx + 0.4, 0.75]]);
      }
      break;
    case 'fire':
      g.beginPath();
      g.moveTo(0, 0.8 * s);
      g.bezierCurveTo(-0.8 * s, 0.6 * s, -0.5 * s, -0.2 * s, 0, -0.8 * s);
      g.bezierCurveTo(0.1 * s, -0.2 * s, 0.8 * s, 0.1 * s, 0, 0.8 * s);
      g.fill();
      break;
    default:
      circle(0, 0, 0.5);
  }
  g.restore();
}

export class Hud {
  constructor(onSelect) {
    this.overlay = $('overlay');
    this.ctx = this.overlay.getContext('2d');
    this.map = $('minimap');
    this.mapCtx = this.map.getContext('2d');
    this.el = {
      list: $('vehicle-list'),
      filter: $('g-filter'),
      spec: $('spec'),
      kind: $('g-kind'),
      name: $('g-name'),
      based: $('g-based'),
      outline: $('g-outline'),
      vehName: $('veh-name'),
      speed: $('speed'),
      gear: $('gear'),
      rpm: $('rpm-val'),
      cruise: $('cruise'),
      terrain: $('terrain'),
      statusPic: $('status-pic'),
      crewCount: $('crew-count'),
      vsAmmo: $('vs-ammo'),
      vsStab: $('vs-stab'),
      hint: $('hint'),
      ammo: $('ammo-bar'),
      guns: $('gun-list'),
      mgs: $('mg-list'),
      view: $('view-mode'),
      zero: $('zero'),
      toast: $('toast'),
      free: $('freelook-tag'),
      slip: $('slip'),
      loading: $('g-loading'),
    };
    this.onSelect = onSelect;
    this.toastTimer = 0;
    this.hintTimer = 0;
    this.gunRows = [];
    this.mgRows = [];
    this.cards = new Map();
    this.nation = 'all';
  }

  /** Garage cards: one per vehicle, each with a picture slot the game renders into. */
  buildVehicleList(entries, current) {
    this.el.list.textContent = '';
    this.cards.clear();
    for (const e of entries) {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = 'veh-' + e.id;
      b.className = 'card';
      b.dataset.nation = e.nation || 'fictional';
      b.setAttribute('aria-pressed', e.id === current ? 'true' : 'false');
      const pic = document.createElement('canvas');
      pic.width = THUMB_W;
      pic.height = THUMB_H;
      const tag = document.createElement('span');
      tag.className = 'nation';
      tag.textContent = e.tag || NATION[e.nation] || '?';
      const cap = document.createElement('span');
      cap.className = 'cap';
      const name = document.createElement('span');
      name.className = 'vname';
      name.textContent = e.name;
      const sub = document.createElement('span');
      sub.className = 'vsub';
      sub.textContent = [CLASS[e.class] || '', e.year ? String(e.year) : ''].filter(Boolean).join('　');
      cap.append(name, sub);
      b.append(pic, tag, cap);
      b.addEventListener('click', () => {
        this.onSelect(e.id);
        b.blur();
      });
      this.el.list.append(b);
      this.cards.set(e.id, { button: b, pic });
    }
    this.el.filter.textContent = '';
    for (const [id, label] of FILTERS) {
      if (id !== 'all' && !entries.some((e) => (e.nation || 'fictional') === id)) continue;
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'tab';
      t.id = 'filter-' + id;
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', id === this.nation ? 'true' : 'false');
      t.textContent = label;
      t.addEventListener('click', () => {
        this.filter(id);
        t.blur();
      });
      this.el.filter.append(t);
    }
  }

  /**
   * Brings the card row in line with `entries` without throwing away pictures already taken:
   * cards that are gone are removed, new ones are added at the end. Returns the ids added.
   */
  syncVehicleList(entries, current) {
    const want = new Set(entries.map((e) => e.id));
    for (const [id, c] of [...this.cards]) {
      if (!want.has(id)) {
        c.button.remove();
        this.cards.delete(id);
      }
    }
    const added = entries.filter((e) => !this.cards.has(e.id));
    if (added.length) {
      const keep = new Map(this.cards);
      this.buildVehicleList(entries, current);
      // put the old pictures back into the rebuilt cards
      for (const [id, c] of keep) {
        const n = this.cards.get(id);
        if (n) n.pic.getContext('2d').drawImage(c.pic, 0, 0);
      }
      this.filter(this.nation);
    }
    return added.map((e) => e.id);
  }

  filter(nation) {
    this.nation = nation;
    for (const t of this.el.filter.children) t.setAttribute('aria-selected', t.id === 'filter-' + nation ? 'true' : 'false');
    for (const { button } of this.cards.values()) button.hidden = nation !== 'all' && button.dataset.nation !== nation;
  }

  /** Ids of the cards currently on show, in order (for the arrow keys). */
  shownIds() {
    return [...this.cards.entries()].filter(([, c]) => !c.button.hidden).map(([id]) => id);
  }

  /** Copies the middle of the freshly rendered 3D frame into a card's picture. */
  setThumb(id, source) {
    const c = this.cards.get(id);
    if (!c) return;
    const g = c.pic.getContext('2d');
    const aspect = THUMB_W / THUMB_H;
    let sw = source.width;
    let sh = sw / aspect;
    if (sh > source.height) {
      sh = source.height;
      sw = sh * aspect;
    }
    g.drawImage(source, (source.width - sw) / 2, (source.height - sh) / 2, sw, sh, 0, 0, THUMB_W, THUMB_H);
  }

  loading(text) {
    this.el.loading.hidden = !text;
    if (text) this.el.loading.textContent = text;
  }

  /** A card's caption follows the variant its family is fitted with. */
  renameCard(id, name, cls, year) {
    const c = this.cards.get(id);
    if (!c) return;
    const n = c.button.querySelector('.vname');
    if (n && n.textContent !== name) n.textContent = name;
    const sub = c.button.querySelector('.vsub');
    const text = [CLASS[cls] || '', year ? String(year) : ''].filter(Boolean).join('　');
    if (sub && cls && sub.textContent !== text) sub.textContent = text;
  }

  /**
   * The modifications of the vehicle's family: its weapon fits and, for the fit, its camouflages,
   * as buttons; `pick(vehicle id)` fits one. Hidden for a vehicle of no family.
   */
  showMods(slots, pick) {
    const box = document.getElementById('g-mods');
    if (!box) return;
    box.textContent = '';
    box.hidden = !slots;
    if (!slots) return;
    const h = document.createElement('h3');
    h.textContent = '改裝';
    box.append(h);
    for (const [title, list] of [['武裝', slots.weapons], ['塗裝', slots.paints]]) {
      if (list.length < 2 && title === '塗裝') continue;
      const row = document.createElement('div');
      row.className = 'mod-row';
      const label = document.createElement('span');
      label.className = 'mod-slot';
      label.textContent = title;
      row.append(label);
      for (const m of list) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mod';
        b.textContent = m.label;
        b.setAttribute('aria-pressed', m.on ? 'true' : 'false');
        if (!m.on) b.addEventListener('click', () => pick(m.id));
        row.append(b);
      }
      box.append(row);
    }
  }

  markSelected(id) {
    for (const [cid, c] of this.cards) c.button.setAttribute('aria-pressed', cid === id ? 'true' : 'false');
    const c = this.cards.get(id);
    if (c && typeof c.button.scrollIntoView === 'function') c.button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  showSpec(loadout, params, reloadOf) {
    const v = loadout.vehicle;
    const meta = v.meta || {};
    const mass = v.hull.mass_kg / 1000;
    const hp = loadout.engine.engine.horsepower;
    const custom = loadout.id === 'custom';
    const designed = String(loadout.id).startsWith('design:');
    this.el.kind.textContent = [NATION_FULL[meta.nation] || '', CLASS[custom ? 'custom' : meta.class] || '', meta.year ? String(meta.year) : ''].filter(Boolean).join('　·　');
    this.el.name.textContent = loadout.name;
    this.el.vehName.textContent = loadout.name;
    this.el.based.textContent = custom ? '在改裝工坊裡自己配的炮塔與火炮。' : designed ? '在設計局從底盤開始設計：重量、機動、裝甲全部由伺服器核心計算。' : meta.based_on || '';
    const kind = custom ? 'original' : meta.outline;
    this.el.outline.hidden = !OUTLINE[kind];
    this.el.outline.textContent = OUTLINE[kind] || '';
    this.el.outline.dataset.kind = kind || '';
    const rows = [
      ['戰鬥全重', mass.toFixed(1) + ' t'],
      ['動力', `${hp} hp（${(hp / mass).toFixed(1)} hp/t）`],
      ['極速', `${(params.vTop * 3.6).toFixed(0)} km/h　倒車 ${(params.maxReverseSpeed * 3.6).toFixed(0)} km/h`],
      ['接地壓力', `${(params.groundPressure / 1000).toFixed(0)} kPa`],
      ['轉向', params.minTurnRadius > 0 ? `需行進轉向（最小半徑 ${params.minTurnRadius} m）` : '可原地轉向'],
    ];
    loadout.turrets.forEach((t, ti) => {
      const arc = t.limit ? `射界 ${Math.round(((t.limit[1] - t.limit[0]) * 180) / Math.PI)}°` : '360°';
      rows.push([loadout.turrets.length > 1 ? `炮塔 ${ti + 1}` : '炮塔', `${t.openTop ? '開放式　' : ''}${t.traverse}°/s　${arc}　裝填手 ${t.loaders.length || (t.guns.some((g) => g.rack) ? 0 : 1)}`]);
      const seen = new Map();
      t.guns.forEach((g, gi) => {
        const key = g.def.id;
        if (!seen.has(key)) seen.set(key, { g, gi, n: 0 });
        seen.get(key).n++;
      });
      for (const { g, gi, n } of seen.values()) {
        const s = g.shell;
        const ac = g.def.autocannon;
        const rate = ac ? `${ac.rate_rpm} 發/分　彈鏈 ${ac.belt_rounds} 發（換 ${ac.belt_reload_s} s）` : `裝填 ${reloadOf(ti, gi).toFixed(1)} s`;
        rows.push(['　火炮', `${n > 1 ? n + '× ' : ''}${g.def.caliber_mm} mm　${s.muzzle_velocity_ms} m/s　${rate}`]);
        // every type it carries; the best armour-piercing figure of them
        const kinds = [...new Set(g.ammo.map((a) => shellKind(a.shell)))];
        rows.push(['　彈種', kinds.flatMap((k, i) => [i ? ' ' : '', shellIcon(k, 30), ` ${shellTypeLabel(k)}`])]);
        const best = g.ammo.map((a) => a.shell).reduce((x, y) => (y.penetration_curve[0].pen_mm > x.penetration_curve[0].pen_mm ? y : x), s);
        rows.push(['　穿深', `${best.penetration_curve[0].pen_mm.toFixed(0)} mm @0 m　${penAt(best, 1000).toFixed(0)} mm @1000 m${g.ammo.length > 1 ? `（${shellTypeLabel(shellKind(best))}）` : ''}`]);
      }
    });
    const sight = loadout.turrets[0].sight;
    rows.push(['瞄準鏡', `${sight.name}　${sight.levels.map((l) => l.magnification + '×' + (l.doubled ? '（放大）' : '')).join(' / ')}`]);
    const stab = { vertical: '垂直穩定器（俯仰）', two_plane: '雙向穩定器' }[loadout.turrets[0].stabilizer];
    rows.push(['穩定器', stab || '無（行進間火炮隨車身晃動）']);
    if (loadout.machineGuns.length) {
      rows.push(['機槍', loadout.machineGuns.map((m) => `${MG_MOUNT[m.mount]} ${m.def.name.replace(/\s*\(.*\)/, '')}`).join('、')]);
    }
    this.el.spec.textContent = '';
    for (const [k, val] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      if (Array.isArray(val)) dd.append(...val.map((v) => (typeof v === 'string' ? document.createTextNode(v) : v)));
      else dd.textContent = val;
      this.el.spec.append(dt, dd);
    }
  }

  /** One row per gun: label, reload bar, status. */
  buildGunList(loadout) {
    this.el.guns.textContent = '';
    this.gunRows = [];
    let k = -1;
    loadout.turrets.forEach((t, ti) => {
      t.guns.forEach((g, gi) => {
        k++;
        // the main gun's reload is the ring round the aim mark
        if (ti === 0 && gi === 0) return;
        const row = document.createElement('div');
        row.className = 'gun-row';
        const label = document.createElement('span');
        label.className = 'gun-label';
        label.append(shellIcon(shellKind(g.shell), 22), document.createTextNode(` ${g.def.caliber_mm}`));
        label.title = `${g.def.caliber_mm} mm　${shellTypeLabel(shellKind(g.shell))}　${g.shell.name}`;
        const bar = document.createElement('span');
        bar.className = 'bar';
        const fill = document.createElement('i');
        bar.append(fill);
        const st = document.createElement('span');
        st.className = 'gun-state';
        row.append(label, bar, st);
        this.el.guns.append(row);
        this.gunRows.push({ ti, gi, k, row, fill, st });
      });
    });
    this.el.guns.dataset.many = this.gunRows.length > 4 ? '1' : '0';
    this.el.guns.hidden = !this.gunRows.length;
    this.el.mgs.textContent = '';
    this.mgRows = [];
    for (const m of loadout.machineGuns) {
      const row = document.createElement('div');
      row.className = 'gun-row mg-row';
      const label = document.createElement('span');
      label.className = 'gun-label';
      label.textContent = `${MG_MOUNT[m.mount]} ${m.def.caliber_mm >= 10 ? m.def.caliber_mm.toFixed(1) : m.def.caliber_mm}`;
      const bar = document.createElement('span');
      bar.className = 'bar';
      const fill = document.createElement('i');
      bar.append(fill);
      const st = document.createElement('span');
      st.className = 'gun-state';
      row.append(label, bar, st);
      this.el.mgs.append(row);
      this.mgRows.push({ row, fill, st });
    }
  }

  /** states: [{belt, heat, hot, reload, bearing}] in loadout.machineGuns order. The bar is barrel heat. */
  mgs(states) {
    states.forEach((s, i) => {
      const r = this.mgRows[i];
      if (!r) return;
      r.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, s.heat)).toFixed(3)})`;
      const text = s.reload > 0 ? `換彈 ${s.reload.toFixed(1)}` : s.hot ? '過熱' : !s.bearing ? '射界外' : `${s.belt} 發`;
      if (r.st.textContent !== text) r.st.textContent = text;
      const state = s.hot ? 'hot' : s.heat > 0.6 ? 'warm' : 'cool';
      if (r.row.dataset.state !== state) r.row.dataset.state = state;
    });
  }

  /** states: [{remaining, total, waiting, bearing, sighting}] in the same order as buildGunList. */
  guns(states) {
    this.gunRows.forEach((r) => {
      const s = states[r.k];
      if (!s) return;
      const k = s.waiting ? 0 : s.total > 0 ? 1 - s.remaining / s.total : 1;
      r.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, k)).toFixed(3)})`;
      const text = s.empty ? '彈藥耗盡' : s.waiting ? '等裝填手' : s.remaining > 0 ? s.remaining.toFixed(1) + ' s' : s.bearing ? '可射擊' : '射界外';
      if (r.st.textContent !== text) r.st.textContent = text;
      const state = s.waiting ? 'wait' : s.remaining > 0 ? 'load' : s.bearing ? 'ready' : 'blocked';
      if (r.row.dataset.state !== state) r.row.dataset.state = state;
      r.row.dataset.sighting = s.sighting ? '1' : '0';
    });
  }

  drive(info, terrainId, maxRpm, idleRpm, cruise = null) {
    const set = (e, t) => {
      if (e.textContent !== t) e.textContent = t;
    };
    set(this.el.speed, Math.abs(info.speedKmh).toFixed(0));
    set(this.el.gear, Math.abs(info.speedKmh) < 0.5 && !(info.throttleLoad > 0.05) ? 'N' : info.reversing ? 'R' : String(info.gear + 1));
    set(this.el.rpm, String(Math.round((info.rpmShown || 0) / 50) * 50));
    set(this.el.cruise, cruise || '關');
    this.el.cruise.dataset.on = cruise ? '1' : '0';
    const lines = this.el.cruise.parentElement;
    if (lines && lines.dataset.cruise !== (cruise ? '1' : '0')) lines.dataset.cruise = cruise ? '1' : '0';
    set(this.el.terrain, TERRAIN_LABEL[terrainId] || terrainId);
    const slip = Math.max(info.slipL || 0, info.slipR || 0);
    const sinkCm = (info.sink || 0) * 100;
    const show = slip > 0.03 || sinkCm > 1.5;
    this.el.slip.hidden = !show;
    if (show) {
      const text = `滑轉 ${(slip * 100).toFixed(0)}%　下陷 ${sinkCm.toFixed(0)} cm`;
      if (this.el.slip.textContent !== text) this.el.slip.textContent = text;
      this.el.slip.dataset.hard = slip > 0.3 ? '1' : '0';
    }
  }

  /**
   * Ammunition slots of the gun in the sight: key, picture and rounds left of each type.
   * onPick(i) is called when a slot is clicked (same as pressing its key).
   */
  buildAmmo(gun, onPick) {
    const bar = this.el.ammo;
    bar.textContent = '';
    this.ammoSlots = [];
    this.ammoGun = gun;
    if (!gun) return;
    gun.ammo.forEach((a, i) => {
      const k = shellKind(a.shell);
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'ammo-slot';
      slot.setAttribute('role', 'radio');
      slot.title = `${a.shell.name}　${a.shell.penetration_curve[0].pen_mm.toFixed(0)} mm @0 m　${a.shell.muzzle_velocity_ms.toFixed(0)} m/s`;
      const key = document.createElement('kbd');
      key.textContent = String(i + 1);
      const count = document.createElement('b');
      const label = document.createElement('small');
      label.textContent = shellTypeLabel(k).split(' ')[0];
      const reload = document.createElement('i');
      reload.className = 'reload';
      slot.append(key, shellIcon(k, 40), count, label, reload);
      slot.addEventListener('click', (e) => {
        e.currentTarget.blur();
        onPick(i);
      });
      bar.append(slot);
      this.ammoSlots.push({ slot, count, reload });
    });
  }

  /** Per frame: rounds left, which type is in the breech and which comes next, reload progress. */
  ammo(gun, progress) {
    if (!gun || gun !== this.ammoGun) return;
    const next = gun.ammo[gun.selected]?.count > 0 ? gun.selected : gun.ammo.findIndex((a) => a.count > 0);
    gun.ammo.forEach((a, i) => {
      const s = this.ammoSlots[i];
      if (!s) return;
      const t = String(a.count);
      if (s.count.textContent !== t) s.count.textContent = t;
      const loaded = gun.loaded === i ? '1' : '0';
      if (s.slot.dataset.loaded !== loaded) s.slot.dataset.loaded = loaded;
      const nx = i === next && (gun.loaded !== i || gun.selected === i) ? '1' : '0';
      if (s.slot.dataset.next !== nx) s.slot.dataset.next = nx;
      const empty = a.count <= 0 && gun.loaded !== i ? '1' : '0';
      if (s.slot.dataset.empty !== empty) s.slot.dataset.empty = empty;
      s.slot.setAttribute('aria-checked', String(gun.selected === i));
      // the loader's progress shows under the round being loaded
      const loading = gun.loaded < 0 && i === next && progress && Number.isFinite(progress.remaining) && progress.total > 0;
      s.reload.style.width = loading ? `${((1 - progress.remaining / progress.total) * 100).toFixed(1)}%` : '0';
    });
  }

  /**
   * The status panel (bottom left), after War Thunder's: a round window in which the renderer
   * draws the vehicle from above as it is now (renderStatusView in main.js), the ring round it
   * with a pictogram per kind of module (grey, yellow when damaged, red when knocked out), the
   * crew and the rounds ready at its sides, STAB on top when the gun is stabilised, the drive
   * readouts in the square corner. o = {modules: [{kind, health, x}], crew: [{health}], stab,
   * ready, fire}. Returns the window: {cx, cy, r} in CSS px of the page.
   */
  drawStatus(o) {
    const c = this.el.statusPic;
    if (!c) return null;
    const css = 260;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(css * dpr);
    if (c.width !== size) c.width = c.height = size;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, css, css);
    const C = css / 2;
    const R = C - 3;
    const IN = STATUS_WINDOW * css;
    // the panel: the ring and the square bottom-left corner, the window left clear
    g.fillStyle = 'rgba(26, 40, 66, 0.52)';
    g.beginPath();
    g.moveTo(C, C - R);
    g.arc(C, C, R, -Math.PI / 2, Math.PI / 2, false);
    g.lineTo(C - R, C + R);
    g.lineTo(C - R, C);
    g.arc(C, C, R, Math.PI, -Math.PI / 2, false);
    g.closePath();
    g.moveTo(C + IN, C);
    g.arc(C, C, IN, 0, Math.PI * 2, true);
    g.fill('evenodd');
    g.strokeStyle = 'rgba(190, 205, 225, 0.35)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(C, C, IN, 0, Math.PI * 2);
    g.stroke();
    // pictograms round the ring
    const col = (h) => (h <= 0 ? '#e2412f' : h < 0.5 ? '#e8a23a' : 'rgba(205, 218, 235, 0.42)');
    const worst = new Map();
    for (const m of o.modules || []) {
      const key = m.kind === 'track' ? (m.x > 0 ? 'track_r' : 'track_l') : m.kind;
      worst.set(key, Math.min(worst.get(key) ?? 1, m.health ?? 1));
    }
    const mid = (IN + R) / 2;
    for (const [key, deg] of Object.entries(PICTO_AT)) {
      if (!worst.has(key)) continue;
      const a = (deg * Math.PI) / 180;
      const x = C + Math.sin(a) * mid;
      const y = C - Math.cos(a) * mid;
      pictogram(g, key, x, y, 9, col(worst.get(key)));
    }
    if (o.fire) pictogram(g, 'fire', C + Math.sin(-0.35) * mid, C - Math.cos(-0.35) * mid, 9, '#ff7a2a');
    // crew (bottom of the left side) and the ready rounds (right side)
    pictogram(g, 'crew', 26, 146, 10, 'rgba(238, 243, 248, 0.95)');
    pictogram(g, 'ammo', css - 30, 104, 10, 'rgba(238, 243, 248, 0.95)');
    const alive = (o.crew || []).filter((cm) => cm.health > 0).length;
    const t = String(alive);
    if (this.el.crewCount && this.el.crewCount.textContent !== t) this.el.crewCount.textContent = t;
    const r = o.ready == null ? '' : String(o.ready);
    if (this.el.vsAmmo && this.el.vsAmmo.textContent !== r) this.el.vsAmmo.textContent = r;
    if (this.el.vsStab) this.el.vsStab.hidden = !o.stab;
    const b = c.getBoundingClientRect();
    const k = b.width / css;
    return { cx: b.left + C * k, cy: b.top + C * k, r: IN * k };
  }

  /** A word in the middle of the screen for a moment: the view, the sight's range, a mode. */
  hint(text, seconds = 1.8) {
    const e = this.el.hint;
    if (!e) return;
    e.textContent = text;
    e.dataset.show = '1';
    this.hintTimer = seconds;
  }

  /**
   * The main gun's reload as a green ring round the aim mark: filling while the loader works,
   * a full ring flashing once when the round is in, amber while waiting for a loader, red when
   * the racks are empty. progress = loading.progress() of the gun in the sight.
   */
  drawReloadRing(x, y, progress, radius = 24) {
    if (!progress) return;
    const g = this.ctx;
    const s = this.overlay.height / 900;
    const r = radius * s;
    const total = progress.total || 0;
    const k = progress.empty ? 0 : progress.waiting ? 0 : total > 0 ? 1 - progress.remaining / total : 1;
    const ready = !progress.empty && !progress.waiting && !(progress.remaining > 0);
    this.readyFlash = ready ? Math.max(0, (this.readyFlash ?? 1) - 1 / 40) : 1;
    if (ready && this.readyFlash <= 0) return;
    g.lineCap = 'butt';
    g.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    g.lineWidth = 4.5 * s;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = progress.empty ? 'rgba(226, 65, 47, 0.95)' : progress.waiting ? 'rgba(232, 162, 58, 0.95)' : ready ? `rgba(120, 230, 110, ${this.readyFlash.toFixed(2)})` : 'rgba(110, 220, 100, 0.95)';
    g.lineWidth = 2.6 * s;
    g.beginPath();
    g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (progress.empty || progress.waiting ? 1 : k));
    g.stroke();
    if (progress.remaining > 0 && !progress.waiting) {
      g.font = `600 ${Math.round(11.5 * s)}px ${getComputedStyle(document.body).getPropertyValue('--display') || 'sans-serif'}`;
      g.fillStyle = 'rgba(200, 240, 190, 0.95)';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(progress.remaining.toFixed(1), x + r + 6 * s, y + r * 0.7);
    }
  }

  /** A hit result in the middle of the screen for a moment (擊穿 / 未擊穿 / 跳彈 / 擊毀). */
  /** What is broken, burning or being repaired, under the drive readouts (empty: hidden). */
  /**
   * The active protection panel: what the system is doing, the threat it is on (range, seconds to
   * impact), rounds, rate, barrel heat, the state of its gun and radar, kills, and a small
   * scope with the radar's sweep and the tracks it holds. s = null hides it.
   */
  aps(s) {
    const el = document.getElementById('aps');
    if (!el) return;
    if (!s) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const MODE = { search: '搜索', track: '追蹤', engage: '攔截射擊', overheat: '槍管過熱', empty: '彈藥耗盡', fault: '系統故障', off: '已關閉', dead: '失效' };
    el.dataset.mode = s.mode;
    if (!el.firstChild) {
      el.innerHTML = '<header><span></span><b></b></header><dl></dl><div class="aps-bar"><i></i></div><div class="aps-scope"><i></i></div>';
    }
    el.querySelector('header span').textContent = s.name;
    el.querySelector('header b').textContent = MODE[s.mode] || s.mode;
    const rows = [
      ['目標', s.target != null ? `${s.range.toFixed(0)} m　${s.tca.toFixed(1)} s` : s.tracks ? `追蹤 ${s.tracks} 個` : '—'],
      ['彈藥', `${s.rounds} 發`],
      ['射速', `${Math.round(s.rate_rpm)} 發/分`],
      ['槍／雷達', `${s.gunOk ? '正常' : '損壞'}／${s.radarOk ? '正常' : '損壞'}`],
      ['攔截', `${s.kills}`],
    ];
    el.querySelector('dl').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    el.querySelector('.aps-bar i').style.width = `${Math.round(Math.min(1, s.heat) * 100)}%`;
    const scope = el.querySelector('.aps-scope');
    scope.querySelector('i').style.transform = `rotate(${(((s.scan % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * 57.3 - 180}deg)`;
    // tracks: bearing relative to the hull, range on a 2 km scale (half dome)
    const dots = (s.blips || []).map((b) => {
      const k = Math.min(1, b.range / 2000);
      const x = 50 + Math.sin(b.bearing) * 50 * k;
      const y = 100 - Math.max(0, Math.cos(b.bearing)) * 100 * k;
      return `<u style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%"></u>`;
    });
    scope.querySelectorAll('u').forEach((u) => u.remove());
    scope.insertAdjacentHTML('beforeend', dots.join(''));
  }

  damageLine(items) {
    let e = this.el.dmg;
    if (!e) {
      e = this.el.dmg = document.getElementById('dmg-list');
      if (!e) return;
    }
    const html = items.map((i) => `<span data-kind="${i.kind}">${i.text}</span>`).join('');
    if (e.innerHTML !== html) e.innerHTML = html;
    e.hidden = !items.length;
  }

  hitMarker(text, kind) {
    let e = this.el.hitMarker;
    if (!e) {
      e = this.el.hitMarker = document.createElement('div');
      e.id = 'hit-marker';
      document.getElementById('hud').append(e);
    }
    e.textContent = text;
    e.dataset.kind = kind;
    e.classList.remove('show');
    void e.offsetWidth;
    e.classList.add('show');
  }

  /** The view in use: shown for a moment when it changes, not all the time. */
  viewLabel(text) {
    if (this.el.view.textContent !== text) {
      const first = !this.el.view.dataset.set;
      this.el.view.textContent = text;
      this.el.view.dataset.set = '1';
      if (!first) this.hint(text);
    }
  }

  /** The sight's range and the automatic setting: shown for a moment when either changes. */
  zero(text) {
    if (this.el.zero.textContent !== text) {
      const first = !this.el.zero.dataset.set;
      this.el.zero.textContent = text;
      this.el.zero.dataset.set = '1';
      if (!first) this.hint(text);
    }
  }

  freeLook(on, text = '自由視角　放開 C 回到瞄準方向') {
    this.el.free.hidden = !on;
    if (on && this.el.free.textContent !== text) this.el.free.textContent = text;
  }

  toast(text, seconds = 4) {
    this.el.toast.textContent = text;
    this.el.toast.hidden = false;
    this.el.toast.dataset.show = '1';
    this.toastTimer = seconds;
  }

  /** Takes the message away at once (no fade), for a change of screen. */
  hideToast() {
    this.toastTimer = 0;
    this.el.toast.dataset.show = '0';
    this.el.toast.hidden = true;
  }

  tick(dt) {
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0 && this.el.hint) this.el.hint.dataset.show = '0';
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.dataset.show = '0';
    }
  }

  resize(w, h) {
    if (this.overlay.width !== w || this.overlay.height !== h) {
      this.overlay.width = w;
      this.overlay.height = h;
    }
  }

  clear() {
    this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  /** Interior view: a dot on every part with its name beside it. labels = [{x, y, text, crew}] in canvas px. */
  /**
   * Names over the other players' vehicles: [{x, y (screen px), name, vehicle, friend, alive, dist}].
   * Friends blue, enemies red, wrecks grey; smaller with distance.
   */
  drawNameTags(tags) {
    const g = this.ctx;
    const s = this.overlay.height / 900;
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    for (const t of tags) {
      const k = Math.max(0.7, 1 - t.dist / 1500);
      const size = Math.max(10, Math.round(14 * s * k));
      g.font = `600 ${size}px "Chakra Petch", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif`;
      const col = !t.alive ? '#9a968a' : t.friend ? '#6fa8ff' : '#ff6a5a';
      g.lineWidth = 3 * s;
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      const line1 = t.name;
      const line2 = `${t.vehicle}${t.alive ? '' : '（擊毀）'} · ${t.dist.toFixed(0)} m`;
      g.strokeText(line1, t.x, t.y - size * 1.1);
      g.fillStyle = col;
      g.fillText(line1, t.x, t.y - size * 1.1);
      g.font = `400 ${Math.round(size * 0.8)}px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif`;
      g.strokeText(line2, t.x, t.y);
      g.fillText(line2, t.x, t.y);
      // a marker over the hull
      g.beginPath();
      g.moveTo(t.x - 5 * s, t.y + 4 * s);
      g.lineTo(t.x + 5 * s, t.y + 4 * s);
      g.lineTo(t.x, t.y + 10 * s);
      g.closePath();
      g.fill();
    }
    g.textAlign = 'left';
  }

  /**
   * The capture points over the battlefield: a diamond with the point's letter and the distance
   * to it, brighter while the vehicle stands inside. points: [{x, y, id, dist, inside}] (screen px).
   */
  drawPoints(points) {
    const g = this.ctx;
    const s = this.overlay.height / 900;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of points) {
      const r = (p.inside ? 13 : 10) * s;
      g.save();
      g.translate(p.x, p.y);
      g.beginPath();
      g.moveTo(0, -r);
      g.lineTo(r, 0);
      g.lineTo(0, r);
      g.lineTo(-r, 0);
      g.closePath();
      const own = OWNER_RGB[p.owner] || null;
      g.fillStyle = own ? `rgba(${own}, 0.92)` : p.inside ? 'rgba(255, 255, 255, 0.95)' : 'rgba(236, 232, 217, 0.78)';
      g.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      g.lineWidth = 2 * s;
      g.stroke();
      g.fill();
      // how far it is turned, as a ring in the colour of the side turning it
      if (p.progress) {
        g.strokeStyle = `rgba(${p.progress > 0 ? OWNER_RGB.blue : OWNER_RGB.red}, 1)`;
        g.lineWidth = 3 * s;
        g.beginPath();
        g.arc(0, 0, r * 1.45, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, Math.abs(p.progress)));
        g.stroke();
      }
      g.fillStyle = own ? '#fff' : '#16181a';
      g.font = `700 ${Math.round(r * 1.15)}px "Chakra Petch", sans-serif`;
      g.fillText(p.id, 0, 0.5 * s);
      g.font = `600 ${Math.round(11 * s)}px "Chakra Petch", sans-serif`;
      g.lineWidth = 3 * s;
      g.strokeText(`${p.dist.toFixed(0)} m`, 0, r + 9 * s);
      g.fillStyle = 'rgba(236, 232, 217, 0.9)';
      g.fillText(`${p.dist.toFixed(0)} m`, 0, r + 9 * s);
      g.restore();
    }
    g.textAlign = 'left';
  }

  /** A capture circle on the ground: its outline as seen (screen points), in its holder's colour. */
  drawRing(pts, owner) {
    if (pts.length < 2) return;
    const g = this.ctx;
    const s = this.overlay.height / 900;
    const own = OWNER_RGB[owner] || '240, 236, 220';
    g.save();
    g.lineJoin = 'round';
    g.setLineDash([10 * s, 7 * s]);
    g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    g.lineWidth = 4 * s;
    const path = () => {
      g.beginPath();
      let pen = false;
      for (const p of pts) {
        if (!p) {
          pen = false;
          continue;
        }
        if (pen) g.lineTo(p[0], p[1]);
        else g.moveTo(p[0], p[1]);
        pen = true;
      }
    };
    path();
    g.stroke();
    g.strokeStyle = `rgba(${own}, 0.85)`;
    g.lineWidth = 2 * s;
    path();
    g.stroke();
    g.restore();
  }

  drawLabels(labels) {
    const g = this.ctx;
    const s = this.overlay.height / 900;
    const size = Math.max(11, Math.round(15 * s));
    g.font = `600 ${size}px "Chakra Petch", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif`;
    g.textBaseline = 'middle';
    const placed = [];
    for (const l of labels.slice().sort((a, b) => a.y - b.y)) {
      const tw = g.measureText(l.text).width + 12 * s;
      const right = l.x < this.overlay.width * 0.5 ? -1 : 1;
      let ty = l.y;
      const tx = l.x + right * 46 * s;
      const x0 = right > 0 ? tx : tx - tw;
      // keep name tags from stacking on top of each other
      for (let guard = 0; guard < 12; guard++) {
        const hit = placed.find((p) => Math.abs(p.y - ty) < size * 1.35 && x0 < p.x1 && x0 + tw > p.x0);
        if (!hit) break;
        ty = hit.y + size * 1.4;
      }
      placed.push({ x0, x1: x0 + tw, y: ty });
      const col = l.crew ? '#9fd3c7' : '#e2b34a';
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 3 * s;
      g.beginPath();
      g.moveTo(l.x, l.y);
      g.lineTo(tx, ty);
      g.stroke();
      g.strokeStyle = col;
      g.lineWidth = 1.2 * s;
      g.stroke();
      g.fillStyle = col;
      g.beginPath();
      g.arc(l.x, l.y, 3.2 * s, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(16,18,13,0.82)';
      g.fillRect(x0, ty - size * 0.68, tw, size * 1.36);
      g.fillStyle = col;
      g.fillText(l.text, x0 + 6 * s, ty + 1);
    }
  }

  /**
   * Bearing tape along the top edge. 0 deg = down the range road (+Z), clockwise.
   * view = where the camera looks, hull and gun = where those point (radians).
   */
  drawCompass(view, hull, gun, narrow) {
    const g = this.ctx;
    const w = this.overlay.width;
    const s = this.overlay.height / 900;
    const k = Math.max(s, 0.75);
    const half = Math.min(narrow ? 78 * k : 230 * k, w * 0.5 - (narrow ? 130 : 20) * k);
    if (half < 40) return;
    const cx = w / 2;
    const y = 30 * k;
    const span = narrow ? 50 : 70; // degrees either side of the middle
    const pxPerDeg = half / span;
    const deg = (r) => (((r * 180) / Math.PI) % 360 + 360) % 360;
    const rel = (d, c) => ((d - c + 540) % 360) - 180;
    const c = deg(view);
    g.fillStyle = 'rgba(16,18,13,0.55)';
    g.fillRect(cx - half, y - 14 * k, half * 2, 30 * k);
    g.save();
    g.beginPath();
    g.rect(cx - half, y - 16 * k, half * 2, 36 * k);
    g.clip();
    g.strokeStyle = 'rgba(236,232,217,0.85)';
    g.fillStyle = 'rgba(236,232,217,0.92)';
    g.lineWidth = 1.3 * k;
    g.font = `600 ${Math.round(12 * k)}px "Chakra Petch", "Noto Sans TC", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const NAMES = { 0: '北', 90: '東', 180: '南', 270: '西' };
    g.beginPath();
    for (let d = 0; d < 360; d += 5) {
      const x = cx + rel(d, c) * pxPerDeg;
      if (x < cx - half - 4 || x > cx + half + 4) continue;
      const major = d % 15 === 0;
      g.moveTo(x, y + 14 * k);
      g.lineTo(x, y + (major ? 6 : 10) * k);
      if (d % 30 === 0) g.fillText(NAMES[d] || String(d), x, y + 2 * k);
    }
    g.stroke();
    const mark = (r, color, up) => {
      const x = cx + rel(deg(r), c) * pxPerDeg;
      if (x < cx - half || x > cx + half) return;
      g.fillStyle = color;
      g.beginPath();
      if (up) {
        g.moveTo(x, y + 8 * k);
        g.lineTo(x - 5 * k, y + 16 * k);
        g.lineTo(x + 5 * k, y + 16 * k);
      } else {
        g.moveTo(x - 3.5 * k, y + 16 * k);
        g.lineTo(x + 3.5 * k, y + 16 * k);
        g.lineTo(x + 3.5 * k, y + 9 * k);
        g.lineTo(x - 3.5 * k, y + 9 * k);
      }
      g.closePath();
      g.fill();
    };
    mark(hull, '#aaa692', false);
    mark(gun, '#8fd18a', true);
    g.restore();
    // middle index and the bearing in figures
    g.fillStyle = '#e2b34a';
    g.beginPath();
    g.moveTo(cx, y - 8 * k);
    g.lineTo(cx - 5 * k, y - 15 * k);
    g.lineTo(cx + 5 * k, y - 15 * k);
    g.closePath();
    g.fill();
  }

  /**
   * Map of the range, north (down-range) up, centred on the vehicle.
   * m = {x, z, hull, gun, view (radians), zones: [{rect, color}], targets: [{x, z, hits}], humps: [{x0, x1, z0, z1}], shots: [[x, z]]}
   */
  drawMinimap(m) {
    const c = this.map;
    const css = c.clientWidth || 188;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(css * dpr);
    if (c.width !== size) c.width = c.height = size;
    const g = this.mapCtx;
    const R = size / 2;
    const scale = R / 190; // px per metre: 190 m from the middle to the edge
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#3b4226';
    g.fillRect(0, 0, size, size);
    g.save();
    g.translate(R, R);
    g.scale(scale, -scale);
    g.translate(-m.x, -m.z);
    for (const z of m.zones.slice().reverse()) {
      g.fillStyle = z.color;
      g.fillRect(z.rect[0], z.rect[1], z.rect[2] - z.rect[0], z.rect[3] - z.rect[1]);
    }
    g.fillStyle = '#8b897f';
    for (const h of m.humps) g.fillRect(h.x0, h.z0, h.x1 - h.x0, h.z1 - h.z0);
    // range rings every 100 m
    g.strokeStyle = 'rgba(236,232,217,0.16)';
    g.lineWidth = 1 / scale;
    for (const r of [100, 200]) {
      g.beginPath();
      g.arc(m.x, m.z, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
    const P = (x, z) => [R + (x - m.x) * scale, R - (z - m.z) * scale];
    // targets: on the map when near, pinned to the edge when far
    g.font = `600 ${Math.round(10 * dpr)}px "Chakra Petch", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const t of m.targets) {
      let [x, y] = P(t.x, t.z);
      const dx = x - R;
      const dy = y - R;
      const lim = R - 9 * dpr;
      const k = Math.max(Math.abs(dx), Math.abs(dy)) / lim;
      const far = k > 1;
      if (far) {
        x = R + dx / k;
        y = R + dy / k;
      }
      g.fillStyle = t.hits ? '#8fd18a' : '#e2664a';
      g.beginPath();
      if (far) {
        g.moveTo(x, y - 4 * dpr);
        g.lineTo(x + 4 * dpr, y + 3 * dpr);
        g.lineTo(x - 4 * dpr, y + 3 * dpr);
      } else g.rect(x - 4 * dpr, y - 1.5 * dpr, 8 * dpr, 3 * dpr);
      g.fill();
    }
    // other players (online)
    for (const e of m.others || []) {
      let [x, y] = P(e.x, e.z);
      const k = Math.max(Math.abs(x - R), Math.abs(y - R)) / (R - 6 * dpr);
      if (k > 1) {
        x = R + (x - R) / k;
        y = R + (y - R) / k;
      }
      g.fillStyle = !e.alive ? '#555' : e.friend ? '#4f8cff' : '#e8463a';
      g.beginPath();
      g.arc(x, y, 4 * dpr, 0, Math.PI * 2);
      g.fill();
    }
    // view cone, gun line, hull
    const dir = (a, len) => [R + Math.sin(a) * len, R - Math.cos(a) * len];
    g.fillStyle = 'rgba(236,232,217,0.14)';
    g.beginPath();
    g.moveTo(R, R);
    g.lineTo(...dir(m.view - 0.35, R * 0.9));
    g.lineTo(...dir(m.view + 0.35, R * 0.9));
    g.closePath();
    g.fill();
    g.strokeStyle = '#8fd18a';
    g.lineWidth = 1.6 * dpr;
    g.beginPath();
    g.moveTo(R, R);
    g.lineTo(...dir(m.gun, 22 * dpr));
    g.stroke();
    g.save();
    g.translate(R, R);
    g.rotate(m.hull);
    g.fillStyle = '#e2b34a';
    g.beginPath();
    g.moveTo(0, -8 * dpr);
    g.lineTo(5 * dpr, 6 * dpr);
    g.lineTo(-5 * dpr, 6 * dpr);
    g.closePath();
    g.fill();
    g.restore();
    g.strokeStyle = 'rgba(236,232,217,0.3)';
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, size - 1, size - 1);
  }

  /**
   * Battle map minimap, War Thunder style: the whole map north up with its grid, row letters and
   * column numbers, the start points, the vehicle with its view cone and gun line, and a scale.
   * m = {image (canvas), map (BattleMap), x, z, hull, gun, view, spawns, enemies: [{x, z, alive}]}
   */
  drawBattleMap(m) {
    const c = this.map;
    const css = c.clientWidth || 188;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(css * dpr);
    if (c.width !== size) c.width = c.height = size;
    const g = this.mapCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const pad = Math.round(13 * dpr);
    const inner = size - pad;
    g.fillStyle = '#20251a';
    g.fillRect(0, 0, size, size);
    g.drawImage(m.image, pad, pad, inner, inner);
    const mp = m.map;
    const P = (x, z) => [pad + ((x - mp.x0) / mp.size) * inner, pad + (1 - (z - mp.z0) / mp.size) * inner];
    // labels along the top and down the left
    g.fillStyle = 'rgba(236, 232, 217, 0.9)';
    g.font = `600 ${Math.round(8.5 * dpr)}px "Chakra Petch", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const cw = inner / mp.grid.cols;
    const rh = inner / mp.grid.rows;
    mp.grid.col_labels.forEach((t, i) => g.fillText(t, pad + (i + 0.5) * cw, pad / 2));
    mp.grid.row_labels.forEach((t, j) => g.fillText(t, pad / 2, pad + (j + 0.5) * rh));
    // start points
    const flag = (sp, color) => {
      const [x, y] = P(sp.x, sp.z);
      g.fillStyle = color;
      g.fillRect(x - 3 * dpr, y - 3 * dpr, 6 * dpr, 6 * dpr);
    };
    for (const sp of m.spawns.blue) flag(sp, 'rgba(70, 130, 240, 0.85)');
    for (const sp of m.spawns.red) flag(sp, 'rgba(230, 70, 60, 0.85)');
    // capture points: their circle and a lettered diamond, as on the drawing
    for (const p of m.points || []) {
      const [x, y] = P(p.x, p.z);
      const rr = Math.max(4 * dpr, (p.r / mp.size) * inner);
      const own = OWNER_RGB[p.owner] || null;
      if (own) {
        g.fillStyle = `rgba(${own}, 0.3)`;
        g.beginPath();
        g.arc(x, y, rr, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = own ? `rgba(${own}, 0.95)` : 'rgba(240, 236, 220, 0.55)';
      g.lineWidth = 1 * dpr;
      g.beginPath();
      g.arc(x, y, rr, 0, Math.PI * 2);
      g.stroke();
      const d = 5.5 * dpr;
      g.beginPath();
      g.moveTo(x, y - d);
      g.lineTo(x + d, y);
      g.lineTo(x, y + d);
      g.lineTo(x - d, y);
      g.closePath();
      g.fillStyle = own ? `rgb(${own})` : 'rgba(245, 242, 232, 0.95)';
      g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      g.stroke();
      g.fill();
      g.fillStyle = '#16181a';
      g.font = `700 ${Math.round(6.5 * dpr)}px "Chakra Petch", sans-serif`;
      g.fillText(p.id, x, y + 0.4 * dpr);
    }
    for (const e of m.enemies || []) {
      const [x, y] = P(e.x, e.z);
      g.fillStyle = !e.alive ? '#555' : e.friend ? '#4f8cff' : '#e8463a';
      g.beginPath();
      g.arc(x, y, 3.5 * dpr, 0, Math.PI * 2);
      g.fill();
    }
    // the vehicle: view cone, gun line, arrow
    const [px, py] = P(m.x, m.z);
    const dir = (a, len) => [px + Math.sin(a) * len, py - Math.cos(a) * len];
    g.fillStyle = 'rgba(236, 232, 217, 0.2)';
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(...dir(m.view - 0.4, 34 * dpr));
    g.lineTo(...dir(m.view + 0.4, 34 * dpr));
    g.closePath();
    g.fill();
    g.strokeStyle = '#8fd18a';
    g.lineWidth = 1.4 * dpr;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(...dir(m.gun, 14 * dpr));
    g.stroke();
    g.save();
    g.translate(px, py);
    g.rotate(m.hull);
    g.fillStyle = '#ffd34a';
    g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    g.lineWidth = 1 * dpr;
    g.beginPath();
    g.moveTo(0, -6 * dpr);
    g.lineTo(4 * dpr, 5 * dpr);
    g.lineTo(-4 * dpr, 5 * dpr);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    // scale bar: one grid square
    const sq = Math.round(mp.size / mp.grid.cols);
    g.fillStyle = 'rgba(236, 232, 217, 0.85)';
    g.font = `600 ${Math.round(8 * dpr)}px "Chakra Petch", sans-serif`;
    g.textAlign = 'right';
    g.fillText(`${sq} m`, size - 4 * dpr, size - 6 * dpr);
    g.strokeStyle = 'rgba(236, 232, 217, 0.3)';
    g.lineWidth = 1;
    g.strokeRect(pad + 0.5, pad + 0.5, inner - 1, inner - 1);
  }

  /** Rangefinder progress bar under the centre mark (both views). */
  drawRanging(progress, yOffset) {
    const g = this.ctx;
    const w = this.overlay.width;
    const h = this.overlay.height;
    const s = h / 900;
    const bw = 120 * s;
    const x = w / 2 - bw / 2;
    const y = h / 2 + yOffset;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(x - 2 * s, y - 2 * s, bw + 4 * s, 9 * s);
    g.fillStyle = '#8fd18a';
    g.fillRect(x, y, bw * Math.max(0, Math.min(1, progress)), 5 * s);
  }

  /**
   * The range the sight is set to (表尺), beside the aim mark: in the sight under the centre,
   * in third person to the lower right of the cross. `flash` (s) makes it stand out after a change.
   * sight = {radius, magnification, zoomFlash} when looking through the sight.
   */
  drawZeroTag(zero, flash, sight) {
    const g = this.ctx;
    const w = this.overlay.width;
    const h = this.overlay.height;
    const s = h / 900;
    const k = Math.min(1, flash / 0.4);
    const text = zero > 0 ? `表尺 ${zero} m` : '表尺 直瞄';
    const size = (sight ? 15 : 13) * s * (1 + 0.25 * k);
    // in the sight: upper right inside the scope (the weapons bar covers the bottom of it)
    const x = sight ? w / 2 + sight.radius * 0.3 : w / 2 + 24 * s;
    const y = sight ? h / 2 - sight.radius * 0.6 : h / 2 + 34 * s;
    g.save();
    // outside the sight it fades out once the wheel stops
    if (!sight) g.globalAlpha = Math.min(1, flash / 0.35);
    g.font = `600 ${size}px "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const tw = g.measureText(text).width;
    g.fillStyle = `rgba(0,0,0,${0.35 + 0.3 * k})`;
    g.fillRect(x - 6 * s, y - size * 0.75, tw + 12 * s, size * 1.5);
    g.fillStyle = k > 0 ? `rgba(242,${200 + 30 * (1 - k)},${120 + 100 * (1 - k)},1)` : 'rgba(236,232,214,0.85)';
    g.fillText(text, x, y);
    if (sight) {
      const z = `${sight.magnification}×`;
      const kz = Math.min(1, (sight.zoomFlash || 0) / 0.4);
      g.font = `600 ${15 * s * (1 + 0.25 * kz)}px "Noto Sans TC", sans-serif`;
      g.textAlign = 'right';
      const zx = w / 2 - sight.radius * 0.3;
      const zw = g.measureText(z).width;
      g.fillStyle = `rgba(0,0,0,${0.35 + 0.3 * kz})`;
      g.fillRect(zx - zw - 6 * s, y - size * 0.75, zw + 12 * s, size * 1.5);
      g.fillStyle = kz > 0 ? 'rgba(242,215,150,1)' : 'rgba(236,232,214,0.85)';
      g.fillText(z, zx, y);
    }
    g.restore();
  }

  /** Third person: fixed centre mark = where you ask the gun to point; ring = where it points now. */
  drawAim(gunPx, aligned, blocked) {
    const g = this.ctx;
    const w = this.overlay.width;
    const h = this.overlay.height;
    const s = h / 900;
    const cx = w / 2;
    const cy = h / 2;
    g.lineCap = 'round';
    const mark = (color, width) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        g.moveTo(cx + dx * 7 * s, cy + dy * 7 * s);
        g.lineTo(cx + dx * 17 * s, cy + dy * 17 * s);
      }
      g.stroke();
      g.beginPath();
      g.arc(cx, cy, 1.4 * s, 0, Math.PI * 2);
      g.stroke();
    };
    mark('rgba(0,0,0,0.55)', 3.4 * s);
    mark('rgba(240,238,228,0.95)', 1.5 * s);
    if (gunPx) {
      const col = blocked ? '#e2664a' : aligned ? '#8fd18a' : '#e2b34a';
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.lineWidth = 3.6 * s;
      g.beginPath();
      g.arc(gunPx[0], gunPx[1], 11 * s, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = col;
      g.lineWidth = 1.8 * s;
      g.beginPath();
      g.arc(gunPx[0], gunPx[1], 11 * s, 0, Math.PI * 2);
      g.stroke();
    }
  }

  /**
   * Gunner sight. radius = scope radius in px, pxPerRad = image scale at the centre.
   * o = {name, magnification, ammo, status, ready, table, zeroElev, zero, offset}
   * table = [{range, elevation}] for the loaded shell; the scale is shifted so that the range the
   * sight is set to (zero) sits on the centre mark.
   * offset = [dx, dy] px from the middle of the picture to where the gun points right now. The
   * view follows the mouse at once, as in third person; the graticule rides with the gun and
   * runs back to the middle as the turret catches up. A small mark in the middle shows the request.
   */
  drawSight(radius, pxPerRad, o) {
    const g = this.ctx;
    const w = this.overlay.width;
    const h = this.overlay.height;
    const cx = w / 2;
    const cy = h / 2;
    const s = h / 900;

    // scope tube: black outside the circle, soft falloff near the rim
    g.fillStyle = '#000';
    g.beginPath();
    g.rect(0, 0, w, h);
    g.arc(cx, cy, radius, 0, Math.PI * 2, true);
    g.fill('evenodd');
    const vg = g.createRadialGradient(cx, cy, radius * 0.78, cx, cy, radius);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.85)');
    g.fillStyle = vg;
    g.beginPath();
    g.arc(cx, cy, radius, 0, Math.PI * 2);
    g.fill();

    g.save();
    g.beginPath();
    g.arc(cx, cy, radius * 0.985, 0, Math.PI * 2);
    g.clip();

    const mil = (m) => Math.tan(m * 0.001) * pxPerRad;
    const lines = [];
    const labels = [];
    const ox = o.offset ? o.offset[0] : 0;
    const oy = o.offset ? o.offset[1] : 0;
    const off = Math.hypot(ox, oy);
    const L = (x0, y0, x1, y1) => lines.push([cx + ox + x0, cy + oy + y0, cx + ox + x1, cy + oy + y1]);
    const T = (text, x, y, align) => labels.push([text, cx + ox + x, cy + oy + y, align]);

    // horizontal lead scale in thousandths. Tick and label spacing adapt to the magnification so a
    // low-power sight stays readable: ticks every 4 (or 8 / 16), numbers every 8 (or 16 / 32).
    const gap = mil(2.5);
    const tickStep = [4, 8, 16].find((m) => mil(m) >= 8 * s) || 16;
    const labelStep = [8, 16, 32].find((m) => m > tickStep && mil(m) >= 30 * s) || 32;
    let span = gap;
    for (let m = tickStep; m <= 48; m += tickStep) {
      const x = mil(m);
      if (x > radius * 0.62) break;
      const major = m % labelStep === 0;
      // ticks and numbers sit above the line; the distance scale owns the space below it
      const th = (major ? 11 : 6) * s;
      L(x, 0, x, -th);
      L(-x, 0, -x, -th);
      if (major) {
        T(String(m), x, -th - 5 * s, 'center');
        T(String(m), -x, -th - 5 * s, 'center');
      }
      span = x;
    }
    L(-span, 0, -gap, 0);
    L(gap, 0, span, 0);
    // centre mark
    L(0, -gap, 0, -gap - 12 * s);

    // distance scale: ticks at the angle the loaded shell actually needs for each range, shifted by
    // the range the sight is set to. Numbers are in hundreds of metres and alternate sides.
    const zeroTan = Math.tan(o.zeroElev || 0);
    let minY = 0;
    let maxY = 0;
    let lastTickY = -1e9;
    const lastLabelY = [-1e9, -1e9];
    let side = 0;
    for (const row of o.table || []) {
      if (row.range % 200 !== 0) continue;
      const y = (Math.tan(row.elevation) - zeroTan) * pxPerRad;
      if (y > radius * 0.9) break;
      if (y < -radius * 0.5) continue;
      const major = row.range % 400 === 0;
      if (!major && y - lastTickY < 5 * s) continue;
      const half = (major ? 12 : 6) * s;
      if (Math.abs(y) > gap * 0.6) L(-half, y, half, y);
      lastTickY = y;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      if (major && y - lastLabelY[side] >= 12 * s && Math.abs(y) > 9 * s) {
        if (side === 0) T(String(row.range / 100), half + 4 * s, y + 4 * s, 'left');
        else T(String(row.range / 100), -half - 4 * s, y + 4 * s, 'right');
        lastLabelY[side] = y;
        side = 1 - side;
      }
    }
    if (maxY > gap) L(0, gap, 0, maxY);
    if (minY < -gap - 12 * s) L(0, -gap - 12 * s, 0, minY);

    g.lineCap = 'butt';
    for (const [color, width] of [['rgba(236,232,214,0.45)', 2.8 * s], ['rgba(12,12,10,0.95)', 1.2 * s]]) {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      for (const l of lines) {
        g.moveTo(l[0], l[1]);
        g.lineTo(l[2], l[3]);
      }
      g.stroke();
    }
    g.font = `600 ${Math.max(10, Math.round(12 * s))}px "Chakra Petch", "Noto Sans TC", sans-serif`;
    for (const [text, x, y, align] of labels) {
      g.textAlign = align;
      g.lineWidth = 3 * s;
      g.strokeStyle = 'rgba(236,232,214,0.6)';
      g.strokeText(text, x, y);
      g.fillStyle = 'rgba(12,12,10,0.95)';
      g.fillText(text, x, y);
    }
    if (off > 2.5 * s) {
      // where the gunner is asking the gun to go: an open ring in the middle of the picture
      const col = o.blocked ? '#e2664a' : '#e2b34a';
      for (const [color, width] of [['rgba(0,0,0,0.55)', 3.4 * s], [col, 1.6 * s]]) {
        g.strokeStyle = color;
        g.lineWidth = width;
        g.beginPath();
        g.arc(cx, cy, 9 * s, 0, Math.PI * 2);
        g.stroke();
      }
      if (off > radius * 0.93) {
        // the gun is still outside the picture: an arrow on the rim shows which way it is coming from
        const ux = ox / off;
        const uy = oy / off;
        const ax = cx + ux * radius * 0.9;
        const ay = cy + uy * radius * 0.9;
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(ax + ux * 14 * s, ay + uy * 14 * s);
        g.lineTo(ax - uy * 9 * s, ay + ux * 9 * s);
        g.lineTo(ax + uy * 9 * s, ay - ux * 9 * s);
        g.closePath();
        g.fill();
      }
    }
    g.restore();

    // one line of small print inside the dark rim at the top of the picture (the weapons bar owns the bottom)
    g.font = `600 ${Math.max(10, Math.round(13 * s))}px "Chakra Petch", "Noto Sans TC", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = o.ready ? 'rgba(143,209,138,0.92)' : 'rgba(226,179,74,0.92)';
    g.fillText(`${o.name} ${o.magnification}×　${o.ammo}　${o.status}`, cx, Math.max(58 * s, cy - radius * 0.86));
  }
}

export function penAt(shell, distance) {
  const c = shell.penetration_curve;
  if (distance <= c[0].distance_m) return c[0].pen_mm;
  for (let i = 1; i < c.length; i++) {
    if (distance <= c[i].distance_m) {
      const k = (distance - c[i - 1].distance_m) / (c[i].distance_m - c[i - 1].distance_m);
      return c[i - 1].pen_mm + (c[i].pen_mm - c[i - 1].pen_mm) * k;
    }
  }
  return c[c.length - 1].pen_mm;
}

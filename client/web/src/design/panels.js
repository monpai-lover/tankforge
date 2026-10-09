// Step panels of the design bureau and the live readout column. Every control edits the
// design document; every number shown comes from the core's report.
import { shellIcon, shellTypeLabel } from '../game/shellicons.js';
import { el, storage } from './bureau.js';
import * as M from './mesh.js';
import { HULL_TYPES, ROOF_SHAPES, FLOOR_SHAPES, TURRET_TYPES, TURRET_PRESETS, HULL_PRESETS, genTurret } from './gen.js';
import { TEMPLATES, fitGunMount, placeRing, fitRunningGear, breechSize } from './templates.js';
import { reconcileArmor } from './doc.js';
import { heat, PROTECT_COLORS, MATERIAL_COLORS } from './scene.js';
import { CASES as SUSP_CASES } from './suspdebug.js';

export const STEPS = [
  { key: 'start', label: '底盤' },
  { key: 'hull', label: '車體' },
  { key: 'turret', label: '炮塔' },
  { key: 'armor', label: '裝甲' },
  { key: 'interior', label: '內部與乘員' },
  { key: 'power', label: '引擎與傳動' },
  { key: 'suspension', label: '懸掛與履帶' },
  { key: 'gun', label: '火炮與彈藥' },
  { key: 'analysis', label: '裝甲分析' },
  { key: 'test', label: '測試' },
  { key: 'save', label: '保存' },
];

const f1 = (x) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(1));
const f0 = (x) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(0));
const f2 = (x) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(2));
const r3 = (x) => Math.round(x * 1000) / 1000;

const MAT_LABEL = { rha: 'RHA 軋製均質鋼', cha: 'CHA 鑄造鋼', high_hardness_steel: '高硬度鋼', aluminium: '鋁合金', spaced: '間隙用鋼板', composite: '複合裝甲', applied: '附加鋼板', skirt: '裙板鋼', era: '反應裝甲' };
const ZONE_LABEL = {
  upper_front: '首上', lower_front: '首下', nose: '鼻部', side: '側面', lower_side: '下車體側面', sponson_floor: '側裙底板', deck: '甲板', roof: '車頂', floor: '車底', chine: '底部倒角', shoulder: '肩部', upper_rear: '車尾上', lower_rear: '車尾下',
  front: '正面', cheek: '頰部', rear_cheek: '後頰', rear: '後面', roof_edge: '頂緣', bevel: '倒角',
};
export function zoneLabel(tag) {
  if (!tag) return '面';
  const m = tag.match(/^(.*?)(?:_(ext|rim))*(?:_(r|l))?(?:_(ext|rim))*$/);
  const base = (m && m[1]) || tag;
  const side = /_r(_|$)/.test(tag) ? '（右）' : /_l(_|$)/.test(tag) ? '（左）' : '';
  return (ZONE_LABEL[base] || base.replace(/_/g, ' ')) + side + (/_(ext|rim)/.test(tag) ? '・延伸' : '');
}

// ------------------------------------------------------------------ widgets

function section(title, ...children) {
  return el('section', { class: 'bu-sec' }, el('h3', { text: title }), ...children);
}

function note(text) {
  return el('p', { class: 'bu-note', text });
}

/**
 * Slider row. While dragging, the first change takes an undo snapshot and the rest apply
 * without one; `apply(v)` mutates the design; the document is notified with `kind`.
 */
function slider(b, { id, label, min, max, step = 0.01, value, unit = '', digits = 2, apply, kind = 'shape', snap = true }) {
  const out = el('output', { for: id, text: Number(value).toFixed(digits) + unit });
  let snapped = false;
  const input = el('input', {
    type: 'range',
    id,
    min,
    max,
    step,
    value,
    oninput: (e) => {
      const v = Number(e.target.value);
      out.textContent = v.toFixed(digits) + unit;
      if (!snapped && snap) {
        b.doc.snapshot();
        snapped = true;
      }
      apply(v);
      b.doc.emit(kind);
    },
    onchange: () => {
      snapped = false;
      b.evaluate(true);
    },
  });
  return el('div', { class: 'bu-field' }, el('label', { for: id, text: label }), input, out);
}

function select(b, { id, label, options, value, apply, kind = 'panel' }) {
  const s = el('select', {
    id,
    onchange: (e) => b.doc.change((d) => apply(e.target.value, d), kind),
  });
  for (const [v, text] of options) {
    const o = el('option', { value: v, text });
    if (String(v) === String(value)) o.selected = true;
    s.append(o);
  }
  return el('div', { class: 'bu-field bu-sel' }, el('label', { for: id, text: label }), s);
}

function num(id, value, { step = 0.01, min, max, width } = {}) {
  return el('input', { type: 'number', id, value, step, min, max, class: 'bu-num', style: width ? `width:${width}` : null });
}

function btn(id, text, onclick, cls = '') {
  return el('button', { type: 'button', id, class: 'bu-btn ' + cls, text, onclick });
}

function readout(b, fn) {
  const e = el('div', { class: 'bu-read' });
  b.readouts.push((r) => {
    e.textContent = '';
    const v = r ? fn(r) : null;
    if (v == null) return;
    if (Array.isArray(v)) {
      for (const [k, val, state] of v) e.append(el('span', { class: 'bu-kv', 'data-state': state || '' }, el('i', { text: k }), el('b', { text: val })));
    } else e.textContent = v;
  });
  return e;
}

function barRow(label, ratio, text) {
  const pct = Math.max(0, Math.min(1.4, ratio || 0));
  return el('div', { class: 'bu-bar', 'data-state': ratio > 1 ? 'bad' : ratio > 0.85 ? 'warn' : 'ok' }, el('span', { text: label }), el('i', {}, el('u', { style: `width:${(pct / 1.4) * 100}%` }), el('em', { style: `left:${(1 / 1.4) * 100}%` })), el('b', { text }));
}

// ------------------------------------------------------------------ panels

export function renderPanel(b, root) {
  const fn = { start, hull, turret, armor, interior, power, suspension, gun, analysis, test, save }[b.state.step];
  root.append(el('h2', { class: 'bu-title', text: STEPS.find((s) => s.key === b.state.step).label }));
  fn(b, root);
}

function start(b, root) {
  const d = b.design;
  const cards = el('div', { class: 'bu-cards' });
  for (const [k, t] of Object.entries(TEMPLATES)) {
    cards.append(
      el(
        'button',
        {
          type: 'button',
          class: 'bu-card',
          id: 'bu-tpl-' + k,
          onclick: () => {
            const nd = b.opts.newDesign(k);
            nd.name = k === 'blank' ? '新戰車' : t.label.replace('範本', '戰車');
            b.load(nd);
            b.toast(`${t.label}：已載入。${k === 'blank' ? '依序完成炮塔、火炮、乘員與彈藥。' : ''}`);
            b.setStep(k === 'blank' ? 'hull' : 'start');
          },
        },
        el('b', { text: t.label }),
        el('span', { text: t.note }),
      ),
    );
  }
  root.append(section('從哪裡開始', note('選一個起點。空白底盤只有車體、行走機構、引擎與駕駛，其餘都由你設計。目前的設計會被取代（已保存的不受影響）。'), cards));
  root.append(
    section(
      '名稱與塗裝',
      el('div', { class: 'bu-field bu-sel' }, el('label', { for: 'bu-id', text: '識別碼' }), el('input', { id: 'bu-id', value: d.id, pattern: '[a-z0-9_]+', onchange: (e) => b.doc.change((x) => (x.id = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'my_tank'), 'panel') })),
      el('div', { class: 'bu-field bu-sel' }, el('label', { for: 'bu-paint', text: '塗裝' }), el('input', { id: 'bu-paint', type: 'color', value: d.visual?.paint || '#5d6872', onchange: (e) => b.doc.change((x) => (x.visual = { ...(x.visual || {}), paint: e.target.value }), 'meta') })),
    ),
  );
  root.append(section('目前設計', readout(b, (r) => [['全重', `${f1(r.mass.total_kg / 1000)} t`], ['車體長', `${f2(r.dimensions.hull.length_m)} m`], ['全寬', `${f2(r.dimensions.overall_width_m)} m`], ['全高', `${f2(r.dimensions.overall_height_m)} m`], ['狀態', r.battle_ready ? '可參戰' : `${r.errors} 個錯誤`, r.battle_ready ? 'ok' : 'bad']])));
}

// ---- free editing tools shared by hull and turret

function editTools(b, root, body) {
  const st = b.state;
  const sel = st.sel;
  const mesh = b.doc.mesh(body);
  const n = sel.body === body ? sel.items.length : 0;
  const modeName = { object: '整個' + (body === 'hull' ? '車體' : '炮塔'), vertex: '頂點', edge: '邊', face: '面' }[sel.mode];
  const info = sel.mode === 'object' ? (body === 'turret' ? '物件模式下移動＝移動炮塔環位置；縮放／旋轉＝整個炮塔變形' : '物件模式：整個車體一起縮放、旋轉') : n ? `已選取 ${n} 個${modeName}${st.symmetry ? '（含鏡像）' : ''}` : `點選${modeName}（Shift 加選、A 全選、Esc 取消）`;
  const v3 = (prefix, vals) => vals.map((v, k) => num(`${prefix}-${'xyz'[k]}`, v, { step: prefix.includes('rot') ? 1 : prefix.includes('scale') ? 0.05 : 0.01, width: '4.6em' }));
  const mv = v3('bu-mv', [0, 0, 0]);
  const rt = v3('bu-rot', [0, 0, 0]);
  const sc = v3('bu-scale', [1, 1, 1]);
  const read = (inputs) => inputs.map((i) => Number(i.value) || 0);
  const ext = num('bu-ext-d', 0.2, { step: 0.05, width: '5em' });
  const ins = num('bu-inset-d', 0.12, { step: 0.02, width: '5em' });
  const bev = num('bu-bevel-w', 0.12, { step: 0.02, width: '5em' });
  root.append(
    section(
      '自由編輯（頂點／邊／面）',
      el('p', { class: 'bu-note', id: 'bu-sel-info', text: info }),
      el('div', { class: 'bu-row' }, el('span', { class: 'bu-k', text: '移動 m' }), ...mv, btn('bu-apply-move', '移動', () => b.numericTransform('move', read(mv)))),
      el('div', { class: 'bu-row' }, el('span', { class: 'bu-k', text: '旋轉 °' }), ...rt, btn('bu-apply-rot', '旋轉', () => b.numericTransform('rotate', read(rt)))),
      el('div', { class: 'bu-row' }, el('span', { class: 'bu-k', text: '縮放 ×' }), ...sc, btn('bu-apply-scale', '縮放', () => b.numericTransform('scale', read(sc).map((v) => v || 1)))),
      el('div', { class: 'bu-row' }, el('span', { class: 'bu-k', text: '擠出 m' }), ext, btn('bu-extrude', '擠出面', () => b.topoOp('extrude', Number(ext.value)))),
      el('div', { class: 'bu-row' }, el('span', { class: 'bu-k', text: '內插 m' }), ins, btn('bu-inset', '內插面', () => b.topoOp('inset', Number(ins.value)))),
      el('div', { class: 'bu-row' }, el('span', { class: 'bu-k', text: '倒角 m' }), bev, btn('bu-bevel', '倒角邊', () => b.topoOp('bevel', Number(bev.value)))),
      el(
        'div',
        { class: 'bu-row' },
        el('span', { class: 'bu-k', text: '分割面' }),
        btn('bu-split-u2', '左右 ½', () => b.topoOp('split', 0, { axis: 'u', cuts: [0.5] })),
        btn('bu-split-u3', '左右 ⅓', () => b.topoOp('split', 0, { axis: 'u', cuts: [1 / 3, 2 / 3] })),
        btn('bu-split-v2', '上下 ½', () => b.topoOp('split', 0, { axis: 'v', cuts: [0.5] })),
      ),
      note('把手：紅＝左右 X、綠＝上下 Y、藍＝前後 Z。拖曳把手即時變形；所有幾何變更都會重新計算裝甲、重量、內部空間與碰撞。'),
    ),
  );
  const entry = b.doc.entry(body);
  const ops = entry?.ops || [];
  const skipped = b.doc.skipped[body] || 0;
  root.append(
    section(
      '編輯紀錄',
      note(`${ops.length} 個自由編輯疊在基礎外形上；改基礎參數時會重新套用${skipped ? `（${skipped} 個已失效）` : ''}。`),
      el(
        'div',
        { class: 'bu-row' },
        btn('bu-clear-ops', '清除自由編輯', () => {
          if (!ops.length) return;
          b.doc.snapshot();
          entry.ops = [];
          b.doc.rebuild(body);
          b.doc.emit('topology');
        }),
      ),
      mesh ? note(`${mesh.faces.length} 面、${M.usedVertices(mesh).size} 頂點`) : null,
    ),
  );
}

function hull(b, root) {
  const d = b.design;
  const entry = d.editor.hull;
  const p = entry.params;
  const custom = entry.ops.length > 0;
  const types = el('div', { class: 'bu-chips' });
  for (const [k, t] of Object.entries(HULL_TYPES)) {
    types.append(
      el('button', {
        type: 'button',
        id: 'bu-hull-' + k,
        class: 'bu-chip',
        'aria-pressed': p.type === k && !custom ? 'true' : 'false',
        title: t.note,
        text: t.label,
        onclick: () => {
          if (custom && !confirm('換基礎車體會清除所有自由編輯，繼續？')) return;
          b.doc.setParams('hull', { ...HULL_PRESETS[k] });
          b.renderPanel();
        },
      }),
    );
  }
  types.append(el('span', { class: 'bu-chip', 'aria-pressed': custom ? 'true' : 'false', text: custom ? `自訂車體（${HULL_TYPES[p.type]?.label} ＋ ${entry.ops.length} 個編輯）` : '自訂車體＝基礎外形＋自由編輯' }));
  root.append(section('基礎車體', types));
  const S = (key, label, min, max, step, unit = ' m', digits = 2) => slider(b, { id: 'bu-h-' + key, label, min, max, step, value: p[key], unit, digits, apply: (v) => b.doc.setParams('hull', { [key]: v }, { record: false }) });
  root.append(
    section(
      '尺寸',
      S('length', '車長', 3, 10, 0.05),
      S('width_top', '上車體寬', 1.6, 4.4, 0.02),
      S('width_low', '下車體寬', 1.0, 4.0, 0.02),
      S('deck_y', '車高', 1.0, 3.2, 0.02),
      S('floor_y', '離地高', 0.2, 0.9, 0.01),
      S('sponson_y', '側裙板底', 0.5, 2.4, 0.01),
    ),
    section(
      '角度與外形',
      S('upper_glacis_deg', '首上傾角', 0, 80, 1, '°', 0),
      S('lower_glacis_deg', '首下傾角', 0, 75, 1, '°', 0),
      S('nose_y', '鼻部高度', 0.3, 2.0, 0.01),
      p.type === 'rounded' ? S('nose2_y', '鼻部上緣', 0.3, 2.2, 0.01) : null,
      S('side_deg', '側面傾角', -10, 50, 1, '°', 0),
      S('rear_upper_deg', '車尾上傾角', -20, 70, 1, '°', 0),
      S('rear_lower_deg', '車尾下傾角', 0, 70, 1, '°', 0),
      S('rear_break_y', '車尾折線高', 0.3, 2.0, 0.01),
      select(b, { id: 'bu-h-roof', label: '車頂', options: Object.entries(ROOF_SHAPES), value: p.roof, apply: (v) => b.doc.setParams('hull', { roof: v }, { record: false }), kind: 'topology' }),
      select(b, { id: 'bu-h-floor', label: '車底', options: Object.entries(FLOOR_SHAPES), value: p.floor, apply: (v) => b.doc.setParams('hull', { floor: v }, { record: false }), kind: 'topology' }),
      note('傾角從垂直量起：首上 60° 的鋼板，水平射來的炮彈要穿過 2 倍厚度。'),
    ),
  );
  root.append(
    section(
      '量測',
      readout(b, (r) => [
        ['車體長 × 寬 × 高', `${f2(r.dimensions.hull.length_m)} × ${f2(r.dimensions.hull.width_m)} × ${f2(r.dimensions.hull.height_m)} m`],
        ['車體體積', `${f1(r.volumes.hull_m3)} m³`],
        ['裝甲內空間', `${f1(r.volumes.hull_interior_m3)} m³`],
        ['離地間隙', `${f2(r.dimensions.ground_clearance_m)} m`, r.dimensions.ground_clearance_m < 0.2 ? 'bad' : ''],
      ]),
    ),
  );
  editTools(b, root, 'hull');
}

function addTurret(b, type) {
  const d = b.design;
  const t = genTurret(TURRET_PRESETS[type]);
  b.doc.change((x) => {
    x.turret_geometry = t.mesh;
    x.editor.turret = { params: t.params, ops: [] };
    reconcileArmor(x, 'turret', t.mesh, [], new Map());
    const hp = x.editor.hull.params;
    placeRing(x, 0, -0.1 * hp.length / 6, Math.min(t.params.width - 0.15, 1.7));
    if (!x.weapons) x.weapons = { caliber_mm: 75, length_cal: 40, stabilizer: 'none' };
    fitGunMount(x, b.cat);
    if (!x.ammunition.length) x.ammunition = [{ kind: 'ap', count: 30 }, { kind: 'he', count: 20 }];
    if (type !== 'unmanned' && !x.crew_positions.some((c) => c.role === 'gunner')) {
      const [, ty, tz] = x.gun_mount.position_m;
      const side = breechSize(b.cat, x.weapons.caliber_mm).width / 2 + 0.28;
      x.crew_positions.push({ role: 'gunner', mount: 'turret', position_m: [-side, Math.min(0.1, t.params.height - 0.55), r3(Math.min(tz - 0.45, 0.25))] });
      x.crew_positions.push({ role: 'commander', mount: 'turret', position_m: [-side, t.params.height - 0.52, r3(Math.min(tz - 1.05, -0.35))] });
    }
    if (!x.internal_modules.some((m) => m.kind === 'ammo_rack')) x.internal_modules.push({ id: 'rack_1', kind: 'ammo_rack', mount: 'hull', center_m: [0, x.turret_ring.position_m[1] - 0.95, x.turret_ring.position_m[2]], size_m: [0.8, 0.3, 0.6] });
  }, 'all');
  b.setBody('turret');
  b.renderPanel();
  b.toast('已裝上炮塔與炮塔環。下一步可在「內部與乘員」按「自動排列」。');
  void d;
}

function turret(b, root) {
  const d = b.design;
  if (!d.turret_geometry) {
    const chips = el('div', { class: 'bu-cards' });
    for (const [k, t] of Object.entries(TURRET_TYPES)) chips.append(el('button', { type: 'button', class: 'bu-card', id: 'bu-add-turret-' + k, onclick: () => addTurret(b, k) }, el('b', { text: t.label }), el('span', { text: t.note })));
    root.append(section('安裝炮塔', note('選擇一種炮塔外形。之後可以自由修改每個頂點、邊與面。'), chips));
    return;
  }
  const entry = d.editor.turret;
  const p = entry.params;
  const custom = entry.ops.length > 0;
  const types = el('div', { class: 'bu-chips' });
  for (const [k, t] of Object.entries(TURRET_TYPES)) {
    types.append(
      el('button', {
        type: 'button',
        id: 'bu-turret-' + k,
        class: 'bu-chip',
        'aria-pressed': 'false',
        title: t.note,
        text: t.label,
        onclick: () => {
          if (custom && !confirm('換炮塔外形會清除炮塔的自由編輯，繼續？')) return;
          b.doc.setParams('turret', { ...TURRET_PRESETS[k] });
          b.doc.change((x) => fitGunMount(x, b.cat), 'panel');
          b.renderPanel();
        },
      }),
    );
  }
  root.append(section('炮塔外形', types, custom ? note(`自訂炮塔：${entry.ops.length} 個自由編輯`) : null));
  const S = (key, label, min, max, step, unit = ' m', digits = 2) => slider(b, { id: 'bu-t-' + key, label, min, max, step, value: p[key] ?? 0, unit, digits, apply: (v) => b.doc.setParams('turret', { [key]: v }, { record: false }) });
  const walled = p.type !== 'cast' && p.type !== 'round';
  root.append(
    section(
      '炮塔尺寸與角度',
      S('length', '炮塔長', 0.9, 4.5, 0.02),
      S('width', '炮塔寬', 0.8, 3.8, 0.02),
      S('height', '炮塔高', 0.35, 1.5, 0.01),
      S('front_z', '前伸', 0.3, 4.0, 0.02),
      S('front_deg', '前部角度', -10, 65, 1, '°', 0),
      S('side_deg', '側面角度', -10, 60, 1, '°', 0),
      S('rear_deg', '尾部角度', -35, 60, 1, '°', 0),
      walled ? S('chamfer', '切角', 0.03, 1.2, 0.01) : null,
      p.type === 'wedge' ? S('wedge', '楔形長度', 0.05, 1.2, 0.01) : null,
      walled ? S('roof_deg', '炮塔頂傾角', -10, 15, 1, '°', 0) : null,
      note('尾部角度為負值＝尾艙外伸（上寬下窄）。'),
    ),
  );
  const ring = d.turret_ring;
  const RS = (key, label, min, max, step, idx) =>
    slider(b, {
      id: 'bu-ring-' + key,
      label,
      min,
      max,
      step,
      value: idx == null ? ring.diameter_m : ring.position_m[idx],
      unit: ' m',
      apply: (v) => {
        const r = b.design.turret_ring;
        if (idx == null) r.diameter_m = v;
        else r.position_m[idx] = v;
        r.position_m[1] = b.opts.ringHeight(b.design.hull_geometry, r.position_m[0], r.position_m[2], r.diameter_m);
      },
    });
  const hp = d.editor.hull.params;
  root.append(
    section(
      '炮塔環',
      RS('d', '直徑', 0.6, 3.5, 0.01),
      RS('z', '前後位置', -hp.length / 2, hp.length / 2, 0.01, 2),
      RS('x', '左右位置', -hp.width_top / 2, hp.width_top / 2, 0.01, 0),
      select(b, { id: 'bu-ring-drive', label: '迴轉驅動', options: [['manual', '手搖'], ['electric', '電動'], ['hydraulic', '液壓']], value: ring.drive, apply: (v, x) => (x.turret_ring.drive = v) }),
      readout(b, (r) => {
        const t = r.turret;
        if (!t) return null;
        return [
          ['放在車頂上', t.ring_on_hull ? '是' : t.ring_outside_points ? '超出車體' : '陷入車體', t.ring_on_hull ? 'ok' : 'bad'],
          ['炮塔蓋住座圈', t.ring_covered ? '是' : '否', t.ring_covered ? 'ok' : 'bad'],
          ['炮塔重 / 座圈額定', `${f1(t.mass_kg / 1000)} / ${f1(t.ring_capacity_kg / 1000)} t`, t.mass_kg > t.ring_capacity_kg ? 'warn' : ''],
          ['長度 / 座圈', f2(t.overhang_ratio), t.overhang_ratio > 2.3 ? 'warn' : ''],
          ['迴轉半徑', `${f2(t.sweep.swept_radius_m)} m`],
          ['迴轉速度', `${f1(t.traverse_deg_s)}°/s`],
          ['轉動受阻方向', t.sweep.blocked_yaws.length ? `${t.sweep.blocked_yaws.length} 個` : '無', t.sweep.blocked_yaws.length ? 'bad' : 'ok'],
        ];
      }),
      el(
        'div',
        { class: 'bu-row' },
        btn('bu-refit-gun', '重新配置炮架', () => b.doc.change((x) => fitGunMount(x, b.cat), 'panel')),
        btn('bu-remove-turret', '移除炮塔', () => {
          if (!confirm('移除炮塔、炮塔環與火炮？')) return;
          b.doc.change((x) => {
            x.turret_geometry = null;
            x.editor.turret = null;
            x.turret_ring = null;
            x.gun_mount = null;
            x.armor_faces = x.armor_faces.filter((a) => a.body !== 'turret');
            x.armor_layers = (x.armor_layers || []).filter((s) => s.body !== 'turret');
            x.addons = x.addons.filter((a) => a.body !== 'turret');
            x.internal_modules = x.internal_modules.filter((m) => m.mount !== 'turret');
            x.crew_positions = x.crew_positions.filter((c) => c.mount !== 'turret');
          }, 'all');
          b.setBody('hull');
          b.renderPanel();
        }),
      ),
    ),
  );
  editTools(b, root, 'turret');
}

// ---- armour

function armorTargets(b) {
  const st = b.state;
  let ids = st.sel.mode === 'face' ? st.sel.items.slice() : [];
  if (st.symmetry) ids = b.doc.mirrorSelection(st.sel.body, 'face', ids);
  return { body: st.sel.body, ids };
}

function setArmor(b, fn, kind = 'data') {
  const { body, ids } = armorTargets(b);
  if (!ids.length) return b.toast('先在畫面上點選要設定的面', true);
  b.doc.change((d) => {
    for (const id of ids) {
      let a = d.armor_faces.find((x) => x.body === body && x.face === id);
      if (!a) {
        a = { body, face: id, material: 'rha', thickness_mm: 30 };
        d.armor_faces.push(a);
      }
      fn(a, d, id);
    }
  }, kind);
}

function armor(b, root) {
  const d = b.design;
  const st = b.state;
  const { body, ids } = armorTargets(b);
  const mesh = b.doc.mesh(body);
  // zone quick-select
  const zones = new Map();
  for (const bd of ['hull', 'turret']) {
    const m = b.doc.mesh(bd);
    if (!m) continue;
    for (const f of m.faces) {
      const base = (f.tag || 'face').replace(/_(r|l)$/, '');
      const key = bd + ':' + base;
      if (!zones.has(key)) zones.set(key, { body: bd, base, ids: [] });
      zones.get(key).ids.push(f.id);
    }
  }
  const zbox = el('div', { class: 'bu-chips' });
  for (const z of zones.values()) {
    zbox.append(
      el('button', {
        type: 'button',
        class: 'bu-chip',
        text: (z.body === 'turret' ? '炮塔・' : '') + zoneLabel(z.base),
        onclick: () => {
          b.setBody(z.body);
          b.state.sel = { body: z.body, mode: 'face', items: z.ids.slice() };
          b.renderPanel();
          b.redraw();
        },
      }),
    );
  }
  root.append(section('選擇裝甲面', note('在畫面上點選面（Shift 加選），或按區域一次選取。左右對稱開啟時，設定會同時套用到鏡像的面。'), zbox));
  root.append(viewModes(b));
  if (!ids.length) {
    root.append(section('附加裝甲', ...addonTools(b)));
    root.append(globalArmor(b));
    return;
  }
  const first = d.armor_faces.find((a) => a.body === body && a.face === ids[0]) || { material: 'rha', thickness_mm: 30 };
  const rep = (b.report?.armor_faces || []).filter((f) => f.body === body && ids.includes(f.id));
  const area = rep.reduce((s, f) => s + f.area_m2, 0);
  const mass = rep.reduce((s, f) => s + f.mass_kg, 0);
  const f0 = mesh && M.findFace(mesh, ids[0]);
  root.append(
    section(
      `已選 ${ids.length} 面：${zoneLabel(f0?.tag)}${ids.length > 1 ? ' 等' : ''}`,
      readout(b, (r) => {
        const fs = r.armor_faces.filter((f) => f.body === body && ids.includes(f.id));
        if (!fs.length) return null;
        return [
          ['面積', `${f2(fs.reduce((s, f) => s + f.area_m2, 0))} m²`],
          ['裝甲質量', `${f0n(fs.reduce((s, f) => s + f.mass_kg, 0))} kg`],
          ['傾角', `${f0n(fs[0].slope_deg)}°`],
          ['水平視線厚度', `${f0n(fs[0].thickness_mm / Math.max(0.05, Math.cos((fs[0].slope_deg * Math.PI) / 180)))} mm`],
          ['牆深（含疊層）', `${f0n(fs[0].wall_mm)} mm`],
        ];
      }),
      select(b, { id: 'bu-a-mat', label: '材料', options: b.data.materials.filter((m) => m.kind !== 'era' && m.kind !== 'skirt').map((m) => [m.id, MAT_LABEL[m.id] || m.id]), value: first.material, apply: (v) => setArmorNow(b, (a) => (a.material = v)), kind: 'data' }),
      slider(b, {
        id: 'bu-a-thick',
        label: '厚度',
        min: 5,
        max: 500,
        step: 1,
        value: Math.min(500, first.thickness_mm),
        unit: ' mm',
        digits: 0,
        snap: false,
        apply: (v) => {
          for (const id of ids) {
            const a = b.design.armor_faces.find((x) => x.body === body && x.face === id);
            if (a) {
              const k = a.thickness_mm > 0 ? v / a.thickness_mm : 1;
              a.thickness_mm = v;
              if (a.vertex_mm) a.vertex_mm = a.vertex_mm.map((t) => Math.round(t * k));
              if (a.map) a.map.values_mm = a.map.values_mm.map((t) => Math.round(t * k));
            }
          }
        },
        kind: 'data',
      }),
      el('div', { class: 'bu-row' }, el('span', { class: 'bu-k', text: '精確值' }), num('bu-a-exact', first.thickness_mm, { step: 1, min: 1, max: 1000, width: '6em' }), btn('bu-a-set', '設定', (e) => setArmor(b, (a) => (a.thickness_mm = Math.max(1, Number(e.target.parentElement.querySelector('input').value) || 1))))),
    ),
  );
  // variable thickness
  const single = ids.length === 1 || (st.symmetry && ids.length === 2);
  const mode = first.vertex_mm ? 'vertex' : first.map ? 'map' : 'uniform';
  const vbox = el('div', { class: 'bu-varbox' });
  if (mode === 'vertex' && f0 && first.vertex_mm) {
    first.vertex_mm.forEach((t, k) => {
      const p = mesh.vertices[f0.v[k]];
      vbox.append(el('label', { class: 'bu-corner' }, el('span', { text: `角 ${k + 1}（${p.map((x) => x.toFixed(1)).join(', ')}）` }), el('input', { type: 'number', value: t, step: 1, min: 1, id: `bu-corner-${k}`, onchange: (e) => setArmor(b, (a, dd, id) => { if (id === ids[0] && a.vertex_mm) a.vertex_mm[k] = Math.max(1, Number(e.target.value) || 1); else if (a.vertex_mm && a.vertex_mm.length > k) a.vertex_mm[mirrorCorner(b, body, ids[0], id, k)] = Math.max(1, Number(e.target.value) || 1); }) })));
    });
  }
  if (mode === 'map' && first.map) {
    const { nu, nv, values_mm } = first.map;
    const grid = el('div', { class: 'bu-mapgrid', style: `grid-template-columns: repeat(${nu}, 1fr)` });
    for (let j = nv - 1; j >= 0; j--)
      for (let i = 0; i < nu; i++) {
        grid.append(el('input', { type: 'number', value: values_mm[j * nu + i], step: 1, min: 1, id: `bu-map-${i}-${j}`, title: `橫 ${i + 1}／縱 ${j + 1}`, onchange: (e) => setArmor(b, (a) => { if (a.map && a.map.nu === nu && a.map.nv === nv) a.map.values_mm[j * nu + i] = Math.max(1, Number(e.target.value) || 1); }) }));
      }
    vbox.append(note('上排＝面的上緣、左右對應面的左右；中間的格子決定中央厚度。'), grid);
  }
  root.append(
    section(
      '可變厚度',
      el(
        'div',
        { class: 'bu-chips' },
        el('button', { type: 'button', class: 'bu-chip', id: 'bu-var-uniform', 'aria-pressed': mode === 'uniform' ? 'true' : 'false', text: '均勻', onclick: () => setArmor(b, (a) => { delete a.vertex_mm; delete a.map; }, 'panel') }),
        el('button', {
          type: 'button',
          class: 'bu-chip',
          id: 'bu-var-vertex',
          'aria-pressed': mode === 'vertex' ? 'true' : 'false',
          text: '頂點厚度',
          onclick: () =>
            setArmor(b, (a, dd, id) => {
              const f = M.findFace(b.doc.mesh(body), id);
              delete a.map;
              a.vertex_mm = f.v.map(() => a.thickness_mm);
            }, 'panel'),
        }),
        el('button', {
          type: 'button',
          class: 'bu-chip',
          id: 'bu-var-map',
          'aria-pressed': mode === 'map' ? 'true' : 'false',
          text: '厚度圖 3×3',
          onclick: () =>
            setArmor(b, (a) => {
              delete a.vertex_mm;
              const t = a.thickness_mm;
              a.map = { nu: 3, nv: 3, values_mm: [t * 0.6, t * 0.8, t * 0.6, t * 0.8, t, t * 0.8, t * 0.6, t * 0.8, t * 0.6].map(Math.round) };
            }, 'panel'),
        }),
      ),
      single ? vbox : note('可變厚度一次設定一個面（含其鏡像）。'),
      note('鑄造炮塔常見：中央最厚、邊緣變薄。命中點的厚度依該點位置插值。'),
    ),
  );
  // stack
  const stack = d.armor_layers?.find((s) => s.body === body && s.face === ids[0]);
  const lbox = el('div', { class: 'bu-layers' });
  (stack?.layers || []).forEach((l, k) => {
    const upd = (fn) =>
      b.doc.change((dd) => {
        for (const id of ids) {
          const s = dd.armor_layers.find((x) => x.body === body && x.face === id);
          if (s && s.layers[k]) fn(s.layers[k]);
        }
      }, 'data');
    const mat = el('select', { id: `bu-l${k}-mat`, onchange: (e) => upd((x) => (x.material = e.target.value)) });
    for (const m of b.data.materials) mat.append(el('option', { value: m.id, text: MAT_LABEL[m.id] || m.id, selected: m.id === l.material }));
    lbox.append(
      el(
        'div',
        { class: 'bu-layer' },
        el('b', { text: `外層 ${k + 1}` }),
        mat,
        el('label', {}, '厚', el('input', { type: 'number', id: `bu-l${k}-t`, value: l.thickness_mm, step: 1, min: 1, onchange: (e) => upd((x) => (x.thickness_mm = Math.max(1, Number(e.target.value) || 1))) }), 'mm'),
        el('label', {}, '後方空隙', el('input', { type: 'number', id: `bu-l${k}-g`, value: l.spacing_mm || 0, step: 5, min: 0, onchange: (e) => upd((x) => (x.spacing_mm = Math.max(0, Number(e.target.value) || 0))) }), 'mm'),
        el('label', {}, '傾角', el('input', { type: 'number', id: `bu-l${k}-a`, value: l.angle_deg || 0, step: 1, min: -75, max: 75, onchange: (e) => upd((x) => (x.angle_deg = Number(e.target.value) || 0)) }), '°'),
        el('button', {
          type: 'button',
          class: 'ws-x',
          text: '刪除',
          onclick: () =>
            b.doc.change((dd) => {
              for (const id of ids) {
                const s = dd.armor_layers.find((x) => x.body === body && x.face === id);
                if (s) s.layers.splice(k, 1);
              }
              dd.armor_layers = dd.armor_layers.filter((s) => s.layers.length);
            }, 'panel'),
        }),
      ),
    );
  });
  const addLayers = (layers, mainT) =>
    b.doc.change((dd) => {
      dd.armor_layers = dd.armor_layers || [];
      for (const id of ids) {
        let s = dd.armor_layers.find((x) => x.body === body && x.face === id);
        if (!s) {
          s = { body, face: id, layers: [] };
          dd.armor_layers.push(s);
        }
        s.layers.push(...layers.map((l) => ({ ...l })));
        if (mainT) {
          const a = dd.armor_faces.find((x) => x.body === body && x.face === id);
          if (a) a.thickness_mm = mainT;
        }
      }
    }, 'panel');
  root.append(
    section(
      '多層裝甲（由外而內，最後一層是主裝甲）',
      lbox,
      el(
        'div',
        { class: 'bu-row' },
        btn('bu-layer-add', '＋ 外層', () => addLayers([{ material: 'rha', thickness_mm: 20, spacing_mm: 0, angle_deg: 0 }])),
        btn('bu-layer-spaced', '間隙：20＋100 空隙＋主裝甲', () => addLayers([{ material: 'spaced', thickness_mm: 20, spacing_mm: 100, angle_deg: 0 }])),
        btn('bu-layer-comp', '夾層：30 RHA＋複合', () => addLayers([{ material: 'rha', thickness_mm: 30, spacing_mm: 0, angle_deg: 0 }, { material: 'composite', thickness_mm: 60, spacing_mm: 0, angle_deg: 0 }])),
      ),
      note('裝甲由面向內長：疊得越厚，車內空間越少。炮彈逐層計算剩餘穿深；空隙會削弱成形裝藥的金屬噴流。'),
    ),
  );
  root.append(
    section(
      '分割裝甲區域',
      el(
        'div',
        { class: 'bu-row' },
        btn('bu-asplit-u3', '左／中／右', () => b.topoOp('split', 0, { axis: 'u', cuts: [1 / 3, 2 / 3] })),
        btn('bu-asplit-u2', '左右兩半', () => b.topoOp('split', 0, { axis: 'u', cuts: [0.5] })),
        btn('bu-asplit-v2', '上下兩半', () => b.topoOp('split', 0, { axis: 'v', cuts: [0.5] })),
      ),
      note('分割後每一塊各自有厚度與材料，例如首上：兩側 80 mm、中央 120 mm。'),
    ),
  );
  void area;
  void mass;
}

function f0n(x) {
  return f0(x);
}

/** Corner k of face a mapped to the corresponding corner of its mirror face b. */
function mirrorCorner(b, body, a, bId, k) {
  const mesh = b.doc.mesh(body);
  const fa = M.findFace(mesh, a);
  const fb = M.findFace(mesh, bId);
  const mm = M.mirrorMap(mesh);
  const target = mm[fa.v[k]];
  const idx = fb.v.indexOf(target);
  return idx >= 0 ? idx : k;
}

function setArmorNow(b, fn) {
  const { body, ids } = armorTargets(b);
  for (const id of ids) {
    const a = b.design.armor_faces.find((x) => x.body === body && x.face === id);
    if (a) fn(a);
  }
  void body;
}

function globalArmor(b) {
  const scale = (k) =>
    b.doc.change((d) => {
      for (const a of d.armor_faces) {
        a.thickness_mm = Math.max(1, Math.round(a.thickness_mm * k));
        if (a.vertex_mm) a.vertex_mm = a.vertex_mm.map((t) => Math.max(1, Math.round(t * k)));
        if (a.map) a.map.values_mm = a.map.values_mm.map((t) => Math.max(1, Math.round(t * k)));
      }
    }, 'data');
  return section('整車', el('div', { class: 'bu-row' }, btn('bu-all-down', '全部裝甲 ×0.9', () => scale(0.9)), btn('bu-all-up', '全部裝甲 ×1.1', () => scale(1.1)), el('label', { class: 'bu-check' }, el('input', { type: 'checkbox', id: 'bu-inner', checked: b.state.showInner, onchange: (e) => { b.state.showInner = e.target.checked; b.redraw(); } }), '顯示裝甲內壁')), readout(b, (r) => [['裝甲總重', `${f1(r.mass.armor_kg / 1000)} t`], ['佔全重', `${f0((r.mass.armor_kg / r.mass.total_kg) * 100)} %`]]));
}

function addonTools(b) {
  const st = b.state;
  const chips = el('div', { class: 'bu-chips' });
  const defs = b.constructor.ADDON_DEFAULTS;
  for (const [k, def] of Object.entries(defs)) {
    chips.append(
      el('button', {
        type: 'button',
        class: 'bu-chip',
        id: 'bu-addon-' + k,
        'aria-pressed': st.placing === k ? 'true' : 'false',
        text: def.label,
        onclick: () => {
          st.placing = st.placing === k ? null : k;
          st.sel.items = [];
          b.toast(st.placing ? `點在車體或炮塔表面放置${def.label}` : '取消放置');
          b.renderPanel();
        },
      }),
    );
  }
  const out = [chips, note('附加裝甲裝在表面外側：先打到它，再經過空隙才到主裝甲。側裙掛在履帶外側。')];
  const a = b.design.addons.find((x) => x.id === st.selectedAddon);
  if (a) {
    const upd = (fn) => b.doc.change((d) => fn(d.addons.find((x) => x.id === a.id)), 'data');
    const mat = el('select', { id: 'bu-ad-mat', onchange: (e) => upd((x) => (x.material = e.target.value)) });
    for (const m of b.data.materials) mat.append(el('option', { value: m.id, text: MAT_LABEL[m.id] || m.id, selected: m.id === a.material }));
    const N = (id, label, value, step, set) => el('label', { class: 'bu-corner' }, el('span', { text: label }), el('input', { type: 'number', id, value, step, onchange: (e) => upd((x) => set(x, Number(e.target.value))) }));
    out.push(
      el(
        'div',
        { class: 'bu-addon' },
        el('b', { text: `${defs[a.kind]?.label || a.kind}（${a.id}）` }),
        N('bu-ad-w', '寬 m', a.size_m[0], 0.05, (x, v) => (x.size_m[0] = Math.max(0.05, v))),
        N('bu-ad-h', '高 m', a.size_m[1], 0.05, (x, v) => (x.size_m[1] = Math.max(0.05, v))),
        N('bu-ad-t', '厚 mm', a.thickness_mm, 1, (x, v) => (x.thickness_mm = Math.max(1, v))),
        N('bu-ad-s', '間距 mm', a.standoff_mm, 5, (x, v) => (x.standoff_mm = Math.max(0, v))),
        el('label', { class: 'bu-corner' }, el('span', { text: '材料' }), mat),
        el('div', { class: 'bu-row' }, btn('bu-ad-del', '刪除', () => { b.doc.change((d) => (d.addons = d.addons.filter((x) => x.id !== a.id)), 'panel'); st.selectedAddon = null; b.renderPanel(); }), btn('bu-ad-mirror', '鏡像複製', () => b.doc.change((d) => d.addons.push({ ...JSON.parse(JSON.stringify(a)), id: a.id + 'm', anchor_m: [-a.anchor_m[0], a.anchor_m[1], a.anchor_m[2]], normal: [-a.normal[0], a.normal[1], a.normal[2]], u_axis: [-a.u_axis[0], a.u_axis[1], a.u_axis[2]], face: undefined }), 'panel'))),
        readout(b, (r) => {
          const x = r.addons.find((y) => y.id === a.id);
          return x ? [['質量', `${f0(x.mass_kg)} kg`]] : null;
        }),
      ),
    );
  }
  if (b.design.addons.length) out.push(note(`共 ${b.design.addons.length} 件附加裝甲。點選畫面上的附加裝甲可編輯，拖曳可沿表面移動。`));
  return out;
}

function viewModes(b) {
  const st = b.state;
  const modes = [
    ['normal', '一般'],
    ['thickness', '厚度'],
    ['effective', '等效裝甲（視線）'],
    ['material', '材質'],
    ['weight', '重量分布'],
  ];
  const chips = el('div', { class: 'bu-chips' });
  for (const [k, label] of modes) {
    chips.append(
      el('button', {
        type: 'button',
        class: 'bu-chip',
        id: 'bu-vm-' + k,
        'aria-pressed': st.viewMode === k ? 'true' : 'false',
        text: label,
        onclick: () => {
          st.viewMode = k;
          b.view.mode = k === 'effective' ? 1 : 0;
          b.renderPanel();
          b.redraw();
          legend(b);
        },
      }),
    );
  }
  legend(b);
  return section(
    '檢視',
    chips,
    slider(b, { id: 'bu-range', label: '色階上限', min: 40, max: 600, step: 10, value: st.range[1], unit: ' mm', digits: 0, snap: false, apply: (v) => { st.range = [Math.min(20, v / 4), v]; b.view.range = st.range; b.redraw(); legend(b); }, kind: 'view' }),
  );
}

function legend(b) {
  const lg = b.legend;
  const st = b.state;
  lg.textContent = '';
  if (st.viewMode === 'normal' && !(st.protect && st.step === 'analysis')) {
    lg.hidden = true;
    return;
  }
  lg.hidden = false;
  if (st.protect && st.step === 'analysis') {
    lg.append(el('b', { text: '擊穿機率' }));
    for (const [k, t] of [[4, '容易擊穿 ≥85%'], [3, '可能擊穿'], [2, '難以擊穿'], [1, '無法擊穿／跳彈'], [5, '外部件']]) {
      const c = PROTECT_COLORS[k];
      lg.append(el('span', {}, el('i', { style: `background:rgb(${c.slice(0, 3).map((v) => Math.round(v * 255)).join(',')})` }), t));
    }
    return;
  }
  if (st.viewMode === 'material') {
    lg.append(el('b', { text: '材料' }));
    for (const [k, c] of Object.entries(MATERIAL_COLORS)) lg.append(el('span', {}, el('i', { style: `background:rgb(${c.map((v) => Math.round(v * 255)).join(',')})` }), MAT_LABEL[k] || k));
    return;
  }
  const label = st.viewMode === 'weight' ? '面密度（每平方米重量）' : st.viewMode === 'effective' ? '此視角的等效 RHA 厚度' : '等效 RHA 厚度';
  lg.append(el('b', { text: label }));
  const bar = el('div', { class: 'bu-ramp' });
  for (let i = 0; i <= 10; i++) {
    const c = heat(i / 10);
    bar.append(el('i', { style: `background:rgb(${c.slice(0, 3).map((v) => Math.round(v * 255)).join(',')})` }));
  }
  lg.append(bar, el('div', { class: 'bu-ramp-l' }, el('span', { text: st.viewMode === 'weight' ? '重' : `${st.range[0].toFixed(0)} mm 薄` }), el('span', { text: st.viewMode === 'weight' ? '輕' : `${st.range[1].toFixed(0)} mm 厚` })));
  if (st.viewMode === 'weight') lg.lastChild.reverse?.();
}

// ---- interior

function interior(b, root) {
  const d = b.design;
  const st = b.state;
  const addModule = (kind, mount) => {
    const ring = d.turret_ring?.position_m || [0, 1.5, 0];
    const size = kind === 'fuel_tank' ? [0.4, 0.5, 0.8] : kind === 'ammo_rack' ? [0.6, 0.35, 0.4] : null;
    let n = 1;
    while (d.internal_modules.some((m) => m.id === `${kind}_${n}`)) n++;
    const id = `${kind}_${n}`;
    const c = mount === 'turret' ? [0, 0.45, -0.6] : [0, ring[1] - 0.6, ring[2] - 1.2];
    b.doc.change((x) => x.internal_modules.push({ id, kind, mount, center_m: c, ...(size ? { size_m: size } : {}) }), 'panel');
    b.selectBox(id);
  };
  const addCrew = (role, mount) => {
    const c = mount === 'turret' ? [0.4, 0.3, -0.3] : [0.4, 1.0, 1.0];
    b.doc.change((x) => x.crew_positions.push({ role, mount, position_m: c }), 'panel');
    b.selectBox(`crew_${role}_${d.crew_positions.length - 1}`);
  };
  const hasT = !!d.turret_geometry;
  root.append(
    section(
      '加入設備',
      el('div', { class: 'bu-chips' }, btn('bu-add-fuel', '＋ 油箱', () => addModule('fuel_tank', 'hull')), btn('bu-add-rack', '＋ 彈藥架（車體）', () => addModule('ammo_rack', 'hull')), hasT ? btn('bu-add-rack-t', '＋ 彈藥架（炮塔）', () => addModule('ammo_rack', 'turret')) : null, btn('bu-add-radio', '＋ 無線電', () => addModule('radio', 'hull'))),
      note('引擎、傳動的大小由馬力決定（引擎與傳動頁）；油箱與彈藥架的大小決定容量。'),
    ),
    section(
      '安裝乘員',
      el(
        'div',
        { class: 'bu-chips' },
        btn('bu-add-driver', '＋ 駕駛', () => addCrew('driver', 'hull')),
        btn('bu-add-radio_operator', '＋ 無線電手', () => addCrew('radio_operator', 'hull')),
        btn('bu-add-commander', '＋ 車長', () => addCrew('commander', hasT ? 'turret' : 'hull')),
        btn('bu-add-gunner', '＋ 炮手', () => addCrew('gunner', hasT ? 'turret' : 'hull')),
        btn('bu-add-loader', '＋ 裝填手', () => addCrew('loader', hasT ? 'turret' : 'hull')),
      ),
      note('乘員佔一個坐姿（裝填手為站姿）的空間；炮塔裡的乘員腳在炮塔籃裡，轉動炮塔時不能掃到車體內的設備。'),
    ),
  );
  const id = st.selectedBox;
  const ref = id ? b._boxRef(id) : null;
  if (ref) {
    const isCrew = id.startsWith('crew_');
    const m = isCrew ? d.crew_positions[Number(id.split('_').pop())] : d.internal_modules.find((x) => x.id === id);
    const pos = isCrew ? m.position_m : m.center_m;
    const upd = (fn) => b.doc.change((x) => fn(isCrew ? x.crew_positions[Number(id.split('_').pop())] : x.internal_modules.find((y) => y.id === id)), 'data');
    const P = (k, label) => el('label', { class: 'bu-corner' }, el('span', { text: label }), el('input', { type: 'number', id: `bu-box-${'xyz'[k]}`, value: pos[k], step: 0.02, onchange: (e) => upd((x) => ((isCrew ? x.position_m : x.center_m)[k] = Number(e.target.value) || 0)) }));
    const sized = !isCrew && (m.kind === 'fuel_tank' || m.kind === 'ammo_rack');
    const Sz = (k, label) => el('label', { class: 'bu-corner' }, el('span', { text: label }), el('input', { type: 'number', id: `bu-size-${'xyz'[k]}`, value: m.size_m[k], step: 0.02, min: 0.1, onchange: (e) => upd((x) => (x.size_m[k] = Math.max(0.1, Number(e.target.value) || 0.1))) }));
    const names = { engine: '引擎', transmission: '傳動', fuel_tank: '油箱', ammo_rack: '彈藥架', radio: '無線電', turret_drive: '炮塔驅動', commander: '車長', gunner: '炮手', loader: '裝填手', driver: '駕駛', radio_operator: '無線電手' };
    root.append(
      section(
        `選取：${names[isCrew ? m.role : m.kind] || id}`,
        select(b, { id: 'bu-box-mount', label: '安裝在', options: hasT ? [['hull', '車體'], ['turret', '炮塔']] : [['hull', '車體']], value: m.mount, apply: (v, x) => { const t = isCrew ? x.crew_positions[Number(id.split('_').pop())] : x.internal_modules.find((y) => y.id === id); t.mount = v; const p = isCrew ? t.position_m : t.center_m; const r = x.turret_ring.position_m; if (v === 'turret') for (let k = 0; k < 3; k++) p[k] -= r[k]; else for (let k = 0; k < 3; k++) p[k] += r[k]; } }),
        el('div', { class: 'bu-grid3' }, P(0, 'X 左右'), P(1, 'Y 高度'), P(2, 'Z 前後')),
        sized ? el('div', { class: 'bu-grid3' }, Sz(0, '寬'), Sz(1, '高'), Sz(2, '長')) : null,
        readout(b, (r) => {
          const bx = r.interior.boxes.find((x) => x.id === id);
          if (!bx) return null;
          const out = [
            ['在裝甲內', bx.inside ? '是' : `否（${bx.outside_points} 點在外）`, bx.inside ? 'ok' : 'bad'],
            ['碰撞', bx.collisions.length ? bx.collisions.join('、') : '無', bx.collisions.length ? 'bad' : 'ok'],
            ['質量', `${f0(bx.mass_kg)} kg`],
            ['尺寸', bx.size.map((v) => v.toFixed(2)).join(' × ') + ' m'],
          ];
          if (bx.capacity != null) out.push([bx.kind === 'ammo_rack' ? '容量' : '燃油', bx.kind === 'ammo_rack' ? `${f0(bx.capacity)} 發` : `${f0(bx.capacity)} L`]);
          return out;
        }),
        btn('bu-box-del', '移除', () => {
          b.doc.change((x) => {
            if (isCrew) x.crew_positions.splice(Number(id.split('_').pop()), 1);
            else x.internal_modules = x.internal_modules.filter((y) => y.id !== id);
          }, 'panel');
          b.selectBox(null);
        }),
      ),
    );
  }
  root.append(
    section(
      '空間',
      readout(b, (r) => [
        ['裝甲內空間', `${f2(r.volumes.interior_m3)} m³`],
        ['設備', `${f2(r.volumes.modules_m3)} m³`],
        ['乘員', `${f2(r.volumes.crew_m3)} m³`],
        ['剩餘', `${f2(r.volumes.free_m3)} m³`, r.volumes.free_m3 < 0 ? 'bad' : ''],
        ['碰撞', `${r.interior.collisions.length + r.interior.sweep_hits.length + r.interior.breech_hits.length} 處`, r.interior.collisions.length + r.interior.sweep_hits.length + r.interior.breech_hits.length ? 'bad' : 'ok'],
      ]),
      el(
        'div',
        { class: 'bu-row' },
        btn('bu-arrange', '自動排列（只移動有問題的）', () => {
          b.doc.snapshot();
          const failed = b.opts.arrange(b.design);
          b.doc.emit('panel');
          b.evaluate(true);
          b.toast(failed ? `還有 ${failed} 件放不下：加大車體、縮小設備或移除部分設備` : '排列完成');
        }),
      ),
    ),
  );
  const list = el('div', { class: 'bu-list' });
  const items = b.report?.interior?.boxes?.filter((x) => x.kind !== 'gun_breech') || [];
  for (const x of items) {
    const bad = !x.inside || x.collisions.length;
    list.append(el('button', { type: 'button', class: 'bu-li', 'data-state': bad ? 'bad' : 'ok', 'aria-pressed': x.id === id ? 'true' : 'false', text: `${bad ? '✖' : '✔'} ${x.id.replace(/^crew_/, '').replace(/_\d+$/, '')}`, onclick: () => b.selectBox(x.id) }));
  }
  root.append(section('清單', list));
}

// ---- power

function power(b, root) {
  const d = b.design;
  const cat = b.cat;
  const ec = cat.engines[d.engine.kind];
  root.append(
    section(
      '引擎',
      select(b, { id: 'bu-eng-kind', label: '種類', options: Object.entries(cat.engines).map(([k, v]) => [k, v.label]), value: d.engine.kind, apply: (v, x) => (x.engine.kind = v) }),
      slider(b, { id: 'bu-eng-hp', label: '馬力', min: ec.min_hp, max: ec.max_hp, step: 10, value: d.engine.power_hp, unit: ' hp', digits: 0, apply: (v) => (b.design.engine.power_hp = v), kind: 'data' }),
      readout(b, (r) => [
        ['引擎重量', `${f0(r.engine.mass_kg)} kg`],
        ['引擎尺寸', r.engine.size_m.map((v) => v.toFixed(2)).join(' × ') + ' m'],
        ['最高轉速', `${f0(r.engine.max_rpm)} rpm`],
        ['峰值扭矩', `${f0(Math.max(...r.engine.torque_curve.map((p) => p[1])))} N·m`],
        ['功重比', `${f1(r.mobility.power_to_weight_hp_t)} hp/t`, r.mobility.power_to_weight_hp_t < 8 ? 'warn' : ''],
      ]),
      note('馬力越大，引擎越重越大（要放得進車尾），柴油重但省油。'),
    ),
  );
  root.append(
    section(
      '傳動',
      select(b, { id: 'bu-tr-kind', label: '變速箱', options: Object.entries(cat.transmissions).map(([k, v]) => [k, v.label]), value: d.transmission.kind, apply: (v, x) => (x.transmission.kind = v) }),
      slider(b, { id: 'bu-tr-gears', label: '前進檔', min: 2, max: 12, step: 1, value: d.transmission.forward_gears, unit: '', digits: 0, apply: (v) => (b.design.transmission.forward_gears = v), kind: 'data' }),
      slider(b, { id: 'bu-tr-gearing', label: '齒比極速', min: 15, max: 100, step: 1, value: d.transmission.gearing_kmh, unit: ' km/h', digits: 0, apply: (v) => (b.design.transmission.gearing_kmh = v), kind: 'data' }),
      select(b, { id: 'bu-tr-steer', label: '轉向機構', options: Object.entries(cat.steering).map(([k, v]) => [k, v.label]), value: d.transmission.steering, apply: (v, x) => (x.transmission.steering = v) }),
      readout(b, (r) => [
        ['齒比', r.engine.gear_ratios.map((g) => g.toFixed(2)).join(' / ')],
        ['末端減速', f2(r.engine.final_drive)],
        ['原地轉向', r.mobility.neutral_steer ? '可以' : `不行（最小半徑 ${f1(r.mobility.min_turn_radius_m)} m）`],
      ]),
      note('齒比極速是頂檔在 95% 轉速的速度：設太高，引擎可能拉不到；設太低，極速受限。實際極速見「測試」。'),
    ),
  );
  root.append(mobilitySection(b));
}

function mobilitySection(b) {
  return section(
    '機動（伺服器同一套物理）',
    readout(b, (r) => {
      const m = r.mobility;
      return [
        ['全重', `${f1(r.mass.total_kg / 1000)} t`],
        ['公路極速', `${f1(m.top_speed_road_kmh)} km/h${m.stale ? '…' : ''}`],
        ['土路極速', `${f1(m.top_speed_dirt_kmh)} km/h`],
        ['泥地極速', `${f1(m.top_speed_mud_kmh)} km/h`],
        ['0–32 km/h', m.accel_0_32_s != null ? `${f1(m.accel_0_32_s)} s` : '到不了', m.accel_0_32_s == null ? 'bad' : ''],
        ['最大爬坡', `${f0(m.max_climb_deg)}°`],
        ['轉向', `${f0(m.max_turn_rate_deg_s)}°/s`],
        ['煞車', `${f1(m.brake_decel_ms2)} m/s²（40 km/h 停距 ${f1(m.stopping_distance_40_m)} m）`],
        ['接地壓力', `${f0(m.ground_pressure_kpa)} kPa`, m.ground_pressure_kpa > 140 ? 'warn' : ''],
        ['油耗', `公路 ${f0(m.fuel_l_per_100km_road)} / 越野 ${f0(m.fuel_l_per_100km_offroad)} L/100km`],
        ['續航', `公路 ${f0(m.range_road_km)} km / 越野 ${f0(m.range_offroad_km)} km（${f0(m.fuel_l)} L）`],
      ];
    }),
  );
}

// ---- suspension

function suspension(b, root) {
  const d = b.design;
  const cat = b.cat;
  const s = d.suspension;
  const hp = d.editor.hull.params;
  root.append(
    section(
      '懸掛',
      select(b, { id: 'bu-su-kind', label: '形式', options: Object.entries(cat.suspensions).map(([k, v]) => [k, v.label]), value: s.kind, apply: (v, x) => (x.suspension.kind = v) }),
      slider(b, { id: 'bu-su-n', label: '負重輪組／側', min: 2, max: 12, step: 1, value: s.stations, unit: '', digits: 0, apply: (v) => (b.design.suspension.stations = v), kind: 'data' }),
      slider(b, { id: 'bu-su-d', label: '輪徑', min: 0.3, max: 1.2, step: 0.01, value: s.wheel_diameter_m, unit: ' m', apply: (v) => (b.design.suspension.wheel_diameter_m = v), kind: 'data' }),
      slider(b, { id: 'bu-su-f', label: '第一組位置', min: 0, max: hp.length / 2, step: 0.01, value: s.front_z_m, unit: ' m', apply: (v) => (b.design.suspension.front_z_m = v), kind: 'data' }),
      slider(b, { id: 'bu-su-r', label: '最後一組位置', min: -hp.length / 2, max: 0, step: 0.01, value: s.rear_z_m, unit: ' m', apply: (v) => (b.design.suspension.rear_z_m = v), kind: 'data' }),
      select(b, { id: 'bu-su-spr', label: '主動輪', options: [['front', '前置'], ['rear', '後置']], value: s.sprocket, apply: (v, x) => (x.suspension.sprocket = v) }),
      btn('bu-su-fit', '依車長重新分布', () => b.doc.change((x) => fitRunningGear(x), 'panel')),
    ),
    section(
      '履帶',
      slider(b, { id: 'bu-tk-w', label: '履帶寬', min: cat.tracks.min_width_m, max: cat.tracks.max_width_m, step: 0.01, value: d.tracks.width_m, unit: ' m', apply: (v) => (b.design.tracks.width_m = v), kind: 'data' }),
      slider(b, { id: 'bu-tk-x', label: '履帶中心距一半', min: 0.6, max: 2.4, step: 0.01, value: d.tracks.center_x_m, unit: ' m', apply: (v) => (b.design.tracks.center_x_m = v), kind: 'data' }),
      note('履帶必須在車體外側或側裙板下方，不能穿過車體。'),
    ),
  );
  if (b.state.suspDebug) {
    root.append(
      section(
        '懸掛除錯（實戰物理）',
        readout(b, () => {
          const sd = b.suspDbg;
          if (!sd) return '計算中…';
          if (sd.error) return sd.error;
          const rows = [['情境', SUSP_CASES.find((c) => c.key === sd.case)?.label || ''], ['俯仰 / 側傾', `${f1((sd.pitch * 180) / Math.PI)}° / ${f1((sd.roll * 180) / Math.PI)}°`], ['懸掛頻率 / 阻尼比', `${f2(sd.freq)} Hz / ${f2(sd.zeta)}`]];
          for (const w of sd.wheels) {
            const state = !w.grounded ? 'bad' : w.compPct > 100 ? 'bad' : w.compPct > 85 ? 'warn' : '';
            rows.push([`${w.side > 0 ? '右' : '左'}${w.n}`, `${f1(w.loadT)} t　${f0(w.compPct)}%　彈簧 ${f0(w.springKN)} kN　阻尼 ${f1(w.damperKN)} kN${w.grounded ? '' : '　懸空'}`, state]);
          }
          return rows;
        }),
        note('負載＝輪子傳到地面的重量；壓縮＝從回彈限位到行程頂（100% 以上撞到限位）；阻尼力正值＝壓縮中、負值＝回彈中。'),
      ),
    );
  }
  const chart = el('canvas', { class: 'bu-chart', id: 'bu-load-chart', width: 300, height: 120 });
  b.readouts.push((r) => drawLoads(chart, r));
  root.append(
    section(
      '負重輪負載',
      chart,
      readout(b, (r) => {
        const sp = r.suspension;
        return [
          ['前段', `${f0(sp.front.load_kn)} kN（${f0(sp.front.ratio * 100)}%）`, sp.front.ratio > 1 ? 'bad' : ''],
          ['中段', `${f0(sp.middle.load_kn)} kN（${f0(sp.middle.ratio * 100)}%）`, sp.middle.ratio > 1 ? 'bad' : ''],
          ['後段', `${f0(sp.rear.load_kn)} kN（${f0(sp.rear.ratio * 100)}%）`, sp.rear.ratio > 1 ? 'bad' : ''],
          ['重心前後偏移', `${f2(sp.com_offset_m)} m`],
          ['實際行程', `${f2(sp.travel_m)} m`],
          ['接地長度', `${f2(r.running_gear.contact_length_m)} m`],
          ['接地壓力', `${f0(r.mobility.ground_pressure_kpa)} kPa`],
          ['接地長 / 履帶距', f2(r.mobility.length_to_gauge), r.mobility.length_to_gauge > 2.2 || r.mobility.length_to_gauge < 0.9 ? 'warn' : ''],
          ['履帶重', `${f0(r.running_gear.track_kg)} kg`],
        ];
      }),
      note('前方裝甲過重 → 前段負重輪超載：懸掛行程縮短、轉向與越野變差。'),
    ),
  );
}

function drawLoads(c, r) {
  const g = c.getContext('2d');
  const w = c.width;
  const h = c.height;
  g.clearRect(0, 0, w, h);
  const st = r.suspension.stations.filter((s) => s.side === 1);
  const stl = r.suspension.stations.filter((s) => s.side === -1);
  if (!st.length) return;
  const max = Math.max(1.3, ...r.suspension.stations.map((s) => s.ratio));
  const bw = (w - 20) / st.length;
  g.font = '11px sans-serif';
  const yOf = (v) => h - 18 - (v / max) * (h - 30);
  g.strokeStyle = 'rgba(236,232,217,0.5)';
  g.setLineDash([4, 3]);
  g.beginPath();
  g.moveTo(10, yOf(1));
  g.lineTo(w - 10, yOf(1));
  g.stroke();
  g.setLineDash([]);
  st.forEach((s, i) => {
    const l = stl[i];
    for (const [k, v] of [[0, s.ratio], [1, l?.ratio ?? 0]]) {
      g.fillStyle = v > 1 ? '#e2664a' : v > 0.85 ? '#e2b34a' : '#8fd18a';
      const x = 10 + i * bw + 4 + k * (bw - 8) / 2;
      g.fillRect(x, yOf(v), (bw - 10) / 2, yOf(0) - yOf(v));
    }
    g.fillStyle = '#aaa692';
    g.fillText(String(i + 1), 10 + i * bw + bw / 2 - 3, h - 4);
  });
  g.fillStyle = '#aaa692';
  g.fillText('額定 100%', w - 70, yOf(1) - 3);
  g.fillText('前', 2, h - 4);
}

// ---- gun

function gun(b, root) {
  const d = b.design;
  if (!d.turret_geometry || !d.gun_mount) {
    root.append(section('火炮', note('先在「炮塔」頁裝上炮塔。'), btn('bu-goto-turret', '前往炮塔', () => b.setStep('turret'))));
    return;
  }
  const w = d.weapons;
  const gm = d.gun_mount;
  root.append(
    section(
      '火炮',
      slider(b, { id: 'bu-g-cal', label: '口徑', min: 20, max: 203, step: 1, value: w.caliber_mm, unit: ' mm', digits: 0, apply: (v) => (b.design.weapons.caliber_mm = v), kind: 'data' }),
      slider(b, { id: 'bu-g-len', label: '倍徑', min: 12, max: 80, step: 1, value: w.length_cal, unit: '', digits: 0, apply: (v) => (b.design.weapons.length_cal = v), kind: 'data' }),
      select(b, {
        id: 'bu-g-stab',
        label: '穩定器',
        options: Object.entries(b.cat.stabilizers || { none: { label: '無穩定器' } }).map(([k, v]) => [k, v.label + (v.kg_base ? `（約 ${f0(v.kg_base + v.kg_per_mm * w.caliber_mm)} kg${v.powered_traverse ? '，需動力炮塔' : ''}）` : '')]),
        value: w.stabilizer || 'none',
        apply: (v, x) => (x.weapons.stabilizer = v),
        kind: 'data',
      }),
      note('沒有穩定器：行進間火炮與瞄準鏡隨車身俯仰、轉向晃動，炮手只能慢慢手動修正。垂直穩定器穩住俯仰；雙向穩定器連方向也穩住。'),
      readout(b, (r) => {
        const g = r.gun;
        if (!g) return null;
        return [
          ['炮重＋炮架', `${f0(g.gun_kg)} + ${f0(g.mount_kg)} kg`],
          ['炮管', `${f2(g.barrel_m)} m`],
          ['炮閂 寬×高×長', g.breech_m.map((v) => v.toFixed(2)).join(' × ') + ' m'],
          ['初速', `${f0(g.muzzle_velocity_ms)} m/s`],
          ['裝填', `${f1(g.reload_s)} s（${g.loaders ? g.loaders + ' 名裝填手' : '炮手兼任'}，搬運 ${f2(g.reload_distance_m)} m）`],
          ['迴轉', `${f1(r.turret?.traverse_deg_s)}°/s`],
        ];
      }),
    ),
  );
  const S = (label, id, min, max, step, value, set, unit = ' m', digits = 2) => slider(b, { id, label, min, max, step, value, unit, digits, apply: (v) => set(b.design.gun_mount, v), kind: 'data' });
  root.append(
    section(
      '火炮安裝位置（炮塔座標）',
      S('炮耳高度', 'bu-gm-y', 0.05, 1.5, 0.01, gm.position_m[1], (m, v) => (m.position_m[1] = v)),
      S('炮耳前後', 'bu-gm-z', -1.5, 3.0, 0.01, gm.position_m[2], (m, v) => (m.position_m[2] = v)),
      S('炮耳左右', 'bu-gm-x', -1.2, 1.2, 0.01, gm.position_m[0], (m, v) => (m.position_m[0] = v)),
      S('要求俯角', 'bu-gm-min', -25, 0, 0.5, gm.min_elevation_deg, (m, v) => (m.min_elevation_deg = v), '°', 1),
      S('要求仰角', 'bu-gm-max', 0, 85, 0.5, gm.max_elevation_deg, (m, v) => (m.max_elevation_deg = v), '°', 1),
      S('後座行程', 'bu-gm-rec', 0.05, 1.4, 0.01, gm.recoil_distance_m, (m, v) => (m.recoil_distance_m = v)),
      S('炮盾寬', 'bu-mt-w', 0.15, 2.5, 0.01, gm.mantlet.width_m, (m, v) => (m.mantlet.width_m = v)),
      S('炮盾高', 'bu-mt-h', 0.15, 1.5, 0.01, gm.mantlet.height_m, (m, v) => (m.mantlet.height_m = v)),
      S('炮盾厚', 'bu-mt-t', 5, 400, 1, gm.mantlet.thickness_mm, (m, v) => (m.mantlet.thickness_mm = v), ' mm', 0),
      S('炮盾前移', 'bu-mt-o', 0, 1.2, 0.01, gm.mantlet.offset_m, (m, v) => (m.mantlet.offset_m = v)),
      readout(b, (r) => {
        const c = r.gun?.clearance;
        if (!c) return null;
        const why = { breech_floor: '炮閂撞車底／炮塔籃', breech_ring: '炮閂撞炮塔環', breech_roof: '炮閂撞炮塔頂', recoil_rear_wall: '後座撞後壁', breech_wall: '炮閂撞側壁', barrel_hull: '炮管撞車體' };
        return [
          ['後座空間', c.recoil_fits ? '足夠' : c.breech_fits ? '不足：火炮不能安裝' : '炮閂放不進去', c.recoil_fits ? 'ok' : 'bad'],
          ['實際仰角', `+${f1(c.max_elevation_deg)}°${c.elevation_limited_by ? '（' + (why[c.elevation_limited_by] || c.elevation_limited_by) + '）' : ''}`, c.max_elevation_deg + 0.01 < c.requested_max_elevation_deg ? 'warn' : 'ok'],
          ['實際俯角', `−${f1(c.max_depression_deg)}°${c.depression_limited_by ? '（' + (why[c.depression_limited_by] || c.depression_limited_by) + '）' : ''}`, c.max_depression_deg + 0.01 < c.requested_max_depression_deg ? 'warn' : 'ok'],
          ['正面俯角', `−${f1(c.frontal_depression_deg)}°`],
          ['炮管撞車體方向', c.barrel_blocked_yaws.length ? `${c.barrel_blocked_yaws.length} 個` : '無', c.barrel_blocked_yaws.length ? 'warn' : 'ok'],
        ];
      }),
      el('canvas', { class: 'bu-chart', id: 'bu-dep-chart', width: 220, height: 220 }),
      btn('bu-gm-fit', '依炮塔重新配置', () => b.doc.change((x) => fitGunMount(x, b.cat), 'panel')),
      note('炮閂在炮耳後方，仰起時往下、俯下時往上擺；後座時再往後退。炮塔太小就會限制俯仰，甚至裝不下。圓圖：各方向可用的俯角（外圈 = 要求值）。'),
    ),
  );
  const chartEl = root.querySelector('#bu-dep-chart');
  b.readouts.push((r) => drawDepression(chartEl, r));
  // ammunition
  const shells = b.report?.gun?.shells || [];
  const box = el('div', { class: 'bu-ammo' });
  for (const s of shells) {
    const kind = s.def.id.split('_design')[0];
    const cur = d.ammunition.find((a) => a.kind === kind)?.count ?? 0;
    box.append(
      el(
        'div',
        { class: 'bu-ammo-row' },
        shellIcon(kind, 46),
        el('b', { text: shellTypeLabel(kind) }),
        el('span', { text: `穿深 ${s.pen_mm.map((p) => p.toFixed(0)).join(' / ')} mm（0/500/1000/2000 m）　${s.round_kg.toFixed(1)} kg/發` }),
        el('input', {
          type: 'number',
          id: 'bu-ammo-' + kind,
          value: cur,
          min: 0,
          max: 400,
          step: 1,
          onchange: (e) =>
            b.doc.change((x) => {
              const n = Math.max(0, Math.round(Number(e.target.value) || 0));
              const a = x.ammunition.find((y) => y.kind === kind);
              if (a) a.count = n;
              else x.ammunition.push({ kind, count: n });
              x.ammunition = x.ammunition.filter((y) => y.count > 0);
            }, 'data'),
        }),
      ),
    );
  }
  root.append(
    section(
      '配置炮彈',
      box,
      readout(b, (r) => [
        ['總數 / 彈架容量', `${r.ammunition.rounds} / ${r.ammunition.capacity} 發`, r.ammunition.rounds > r.ammunition.capacity ? 'bad' : 'ok'],
        ['彈藥重量', `${f0(r.ammunition.mass_kg)} kg`],
      ]),
      note('彈種與穿深由口徑與倍徑決定（De Marre）：APCR 近距離穿深高、遠距離掉得快；HEAT 穿深不隨距離變；APHE 有裝藥但穿深較低。'),
    ),
  );
}

function drawDepression(c, r) {
  if (!c) return;
  const g = c.getContext('2d');
  const w = c.width;
  const h = c.height;
  g.clearRect(0, 0, w, h);
  const cl = r.gun?.clearance;
  if (!cl) return;
  const cx = w / 2;
  const cy = h / 2;
  const R = w / 2 - 18;
  const req = Math.max(1, cl.requested_max_depression_deg);
  g.strokeStyle = 'rgba(236,232,217,0.35)';
  g.beginPath();
  g.arc(cx, cy, R, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(143,209,138,0.35)';
  g.strokeStyle = '#8fd18a';
  g.beginPath();
  cl.depression_by_yaw.forEach((v, k) => {
    const a = (k / cl.depression_by_yaw.length) * Math.PI * 2;
    const rr = (Math.min(v, req) / req) * R;
    const x = cx + Math.sin(a) * rr;
    const y = cy - Math.cos(a) * rr;
    if (k === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.closePath();
  g.fill();
  g.stroke();
  g.fillStyle = '#aaa692';
  g.font = '11px sans-serif';
  g.fillText('前', cx - 6, 12);
  g.fillText('後', cx - 6, h - 3);
  g.fillText(`−${req.toFixed(0)}°`, cx + R - 26, cy - 4);
}

// ---- analysis

function analysis(b, root) {
  const st = b.state;
  root.append(viewModes(b));
  root.append(section('游標讀數', note('把滑鼠移到戰車上：顯示該點的厚度、材料、傾角、此視角的入射角、視線厚度（含所有疊層與附加裝甲）和該面的重量。')));
  const shells = [...(b.report?.gun?.shells || []).map((s) => s.def), ...Object.values(b.data.projectiles)];
  const pa = (st.pa = st.pa || { shell: shells[0]?.id, distance: 1000, az: 0, el: 0, yaw: 0, res: 'mid' });
  if (!shells.some((s) => s.id === pa.shell)) pa.shell = shells[0]?.id;
  const sel = el('select', { id: 'bu-pa-shell', onchange: (e) => (pa.shell = e.target.value) });
  for (const s of shells) sel.append(el('option', { value: s.id, text: `${s.name}${s.id.includes('_design_') ? '（本車）' : ''}`, selected: s.id === pa.shell }));
  const dirs = el('div', { class: 'bu-chips' });
  for (const [k, label, az, elv] of [['front', '正面', 0, 0], ['f30', '左前 30°', -30, 0], ['side', '右側', 90, 0], ['rear', '後面', 180, 0], ['top', '上方', 0, 60]]) {
    dirs.append(btn('bu-pa-' + k, label, () => { pa.az = az; pa.el = elv; run(); }));
  }
  const run = () => {
    const shell = shells.find((s) => s.id === pa.shell);
    if (!shell) return;
    const res = { low: [48, 32], mid: [96, 64], high: [160, 104] }[pa.res];
    try {
      const t0 = performance.now();
      st.protect = b.core.protect({ shell, distance_m: pa.distance, azimuth_deg: pa.az, elevation_deg: pa.el, turret_yaw_deg: pa.yaw, cols: res[0], rows: res[1] }, b.design);
      st.protect.ms = performance.now() - t0;
      // look from where the round comes from
      const dd = st.protect.dir;
      b.view.cam.yaw = Math.atan2(-dd[0], -dd[2]);
      b.view.cam.pitch = Math.asin(Math.min(0.99, -dd[1])) + 0.02;
      b.redraw();
      legend(b);
      summary();
    } catch (e) {
      b.toast(e.message, true);
    }
  };
  const sumBox = el('div', { class: 'bu-read', id: 'bu-pa-sum' });
  const summary = () => {
    sumBox.textContent = '';
    const p = st.protect;
    if (!p) return;
    const total = p.area_by_class.slice(0, 4).reduce((s, a) => s + a, 0) || 1;
    const names = ['無法擊穿', '難以擊穿', '可能擊穿', '容易擊穿'];
    for (let k = 3; k >= 0; k--) sumBox.append(barRow(names[k], p.area_by_class[k] / total, `${((p.area_by_class[k] / total) * 100).toFixed(0)}%`));
    sumBox.append(el('span', { class: 'bu-kv' }, el('i', { text: '平均擊穿機率' }), el('b', { text: `${(p.mean_probability * 100).toFixed(0)}%` })));
    sumBox.append(el('span', { class: 'bu-kv' }, el('i', { text: '此距離穿深' }), el('b', { text: `${p.pen_mm.toFixed(0)} mm（落角 ${p.descent_deg.toFixed(1)}°，著速 ${p.impact_speed_ms.toFixed(0)} m/s）` })));
    sumBox.append(el('span', { class: 'bu-kv' }, el('i', { text: '射線數' }), el('b', { text: `${p.cells.length}（${(p.ms || 0).toFixed(0)} ms）` })));
  };
  const S = (id, label, min, max, step, key, unit, digits = 0) => {
    const out = el('output', { text: pa[key] + unit });
    return el('div', { class: 'bu-field' }, el('label', { for: id, text: label }), el('input', { type: 'range', id, min, max, step, value: pa[key], oninput: (e) => { pa[key] = Number(e.target.value); out.textContent = Number(e.target.value).toFixed(digits) + unit; }, onchange: run }), out);
  };
  root.append(
    section(
      '擊穿機率分析',
      el('div', { class: 'bu-field bu-sel' }, el('label', { for: 'bu-pa-shell', text: '炮彈' }), sel),
      S('bu-pa-dist', '距離', 100, 2500, 50, 'distance', ' m'),
      dirs,
      S('bu-pa-az', '射擊方位', -180, 180, 5, 'az', '°'),
      S('bu-pa-el', '俯射角', 0, 70, 1, 'el', '°'),
      S('bu-pa-yaw', '炮塔轉向', -180, 180, 5, 'yaw', '°'),
      el('div', { class: 'bu-row' }, select2('bu-pa-res', [['low', '粗'], ['mid', '中'], ['high', '細']], pa.res, (v) => (pa.res = v)), btn('bu-pa-run', '計算擊穿機率圖', run, 'bu-primary'), btn('bu-pa-clear', '清除', () => { st.protect = null; b.redraw(); legend(b); summary(); })),
      sumBox,
      note('對整個投影面發出射線，每條射線都完整穿過裝甲體積（疊層、附加裝甲、炮盾）。穿深有 ±6% 的標準差，所以邊界上的機率不是 0 就是 1。'),
    ),
  );
  summary();
}

function select2(id, options, value, set) {
  const s = el('select', { id, onchange: (e) => set(e.target.value) });
  for (const [v, t] of options) s.append(el('option', { value: v, text: t, selected: v === value }));
  return s;
}

// ---- test

function test(b, root) {
  root.append(
    section(
      '測試射擊',
      note('進入靶場，用任何炮彈從任意距離和角度朝自己的設計開火。命中後播放 X 光命中回放：彈道 → 裝甲各層 → 擊穿 → 破片 → 乘員與模組受損。'),
      btn('bu-go-testfire', '進入試射靶場', () => b.testFire(), 'bu-primary'),
    ),
    section('試駕', note('用這台設計在靶場駕駛：重量、重心、引擎、齒比、轉向、懸掛全部來自伺服器計算的結果。'), btn('bu-go-drive', '開到靶場試駕', () => b.drive())),
    mobilitySection(b),
  );
}

// ---- save

function save(b, root) {
  const d = b.design;
  const list = storage.list();
  const saveNow = (garage) => {
    const all = storage.list();
    const i = all.findIndex((x) => x.id === d.id);
    const entry = { id: d.id, name: d.name, updated: new Date().toISOString(), battle_ready: !!b.report?.battle_ready, garage: garage ?? (i >= 0 ? all[i].garage : true), design: d };
    if (i >= 0) all[i] = entry;
    else all.push(entry);
    if (!storage.save(all)) return b.toast('瀏覽器無法儲存（儲存空間已滿或被封鎖）', true);
    b.toast(`已保存「${d.name}」${entry.garage ? '，車庫裡會出現這台車' : ''}`);
    b.opts.onGarage?.(all);
    b.renderPanel();
  };
  root.append(
    section(
      '保存',
      el('div', { class: 'bu-row' }, btn('bu-save', '保存到瀏覽器（加入車庫）', () => saveNow(true), 'bu-primary'), btn('bu-save-nogarage', '只保存', () => saveNow(false))),
      note('識別碼相同會覆蓋。可參戰的設計會出現在車庫的卡片裡。'),
    ),
  );
  const lb = el('div', { class: 'bu-list' });
  for (const e of list) {
    lb.append(
      el(
        'div',
        { class: 'bu-saved' },
        el('b', { text: e.name }),
        el('span', { text: `${e.id}　${new Date(e.updated).toLocaleString()}　${e.battle_ready ? '可參戰' : '有錯誤'}` }),
        btn('bu-load-' + e.id, '載入', () => { b.load(JSON.parse(JSON.stringify(e.design))); b.toast(`已載入「${e.name}」`); }),
        btn('bu-del-' + e.id, '刪除', () => { if (!confirm(`刪除「${e.name}」？`)) return; storage.save(storage.list().filter((x) => x.id !== e.id)); b.opts.onGarage?.(storage.list()); b.renderPanel(); }),
        el('label', { class: 'bu-check' }, el('input', { type: 'checkbox', checked: e.garage !== false, onchange: (ev) => { const all = storage.list(); const x = all.find((y) => y.id === e.id); if (x) x.garage = ev.target.checked; storage.save(all); b.opts.onGarage?.(all); } }), '車庫'),
      ),
    );
  }
  root.append(section(`已保存的設計（${list.length}）`, lb));
  const out = el('textarea', { id: 'bu-export', rows: '5', readonly: true, 'aria-label': '匯出的設計' });
  const imp = el('textarea', { id: 'bu-import', rows: '4', 'aria-label': '要匯入的設計' });
  const serverOut = el('div', { class: 'bu-read', id: 'bu-server' });
  const urlIn = el('input', { id: 'bu-server-url', value: 'http://127.0.0.1:8787/api/designs/validate', class: 'bu-url' });
  const showAccept = (res, where) => {
    serverOut.textContent = '';
    if (!res.accepted) {
      serverOut.append(el('span', { class: 'bu-kv', 'data-state': 'bad' }, el('i', { text: where }), el('b', { text: `拒絕 ${res.rejection.code}：${res.rejection.message}` })));
      return;
    }
    const r = res.result.report;
    serverOut.append(
      el('span', { class: 'bu-kv', 'data-state': res.result.battle_ready ? 'ok' : 'bad' }, el('i', { text: where }), el('b', { text: res.result.battle_ready ? '通過：可進入正式對戰' : `未通過：${r.errors} 個錯誤` })),
      el('span', { class: 'bu-kv' }, el('i', { text: '設計雜湊' }), el('b', { text: res.result.design_hash })),
      el('span', { class: 'bu-kv' }, el('i', { text: '伺服器算出的全重' }), el('b', { text: `${(r.mass.total_kg / 1000).toFixed(2)} t` })),
      el('span', { class: 'bu-kv' }, el('i', { text: '功重比 / 極速' }), el('b', { text: `${r.mobility.power_to_weight_hp_t.toFixed(1)} hp/t / ${r.mobility.top_speed_road_kmh.toFixed(1)} km/h` })),
    );
  };
  root.append(
    section(
      '匯出 / 匯入',
      el(
        'div',
        { class: 'bu-row' },
        btn('bu-export-btn', '產生 JSON', () => (out.value = JSON.stringify(d, null, 1))),
        btn('bu-download', '下載 .json', () => {
          const blob = new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' });
          const a = el('a', { href: URL.createObjectURL(blob), download: `${d.id}.design.json` });
          document.body.append(a);
          a.click();
          a.remove();
        }),
      ),
      out,
      note('貼上 VehicleDesign JSON 後按匯入：'),
      imp,
      btn('bu-import-btn', '匯入', () => {
        try {
          const x = JSON.parse(imp.value);
          if (x.schema !== 'tankforge.design/1') throw new Error('schema 不是 tankforge.design/1');
          b.load(x);
          b.toast('已匯入');
        } catch (e) {
          b.toast('匯入失敗：' + e.message, true);
        }
      }),
    ),
    section(
      '伺服器驗證',
      note('伺服器不相信客戶端的重量、裝甲效能、穿深或馬力：它只收原始設計，自己重算、自己驗證。這裡用同一份程式（WebAssembly）先跑一次；也可以送到本機的 design serve。'),
      el(
        'div',
        { class: 'bu-row' },
        btn('bu-accept-local', '本機驗證（同一份伺服器程式）', () => {
          try {
            showAccept(b.core.accept(JSON.stringify(d)), '本機');
          } catch (e) {
            b.toast(e.message, true);
          }
        }),
        btn('bu-accept-tamper', '示範：竄改重量', () => {
          const t = { ...JSON.parse(JSON.stringify(d)), mass_kg: 1000 };
          showAccept(b.core.accept(JSON.stringify(t)), '竄改');
        }),
      ),
      el(
        'div',
        { class: 'bu-row' },
        urlIn,
        btn('bu-accept-remote', '送到伺服器', async () => {
          try {
            const res = await fetch(urlIn.value, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
            showAccept(await res.json(), '伺服器');
          } catch (e) {
            serverOut.textContent = `連不到伺服器（${e.message}）。啟動：cargo run -p tg-tools --bin design -- serve`;
          }
        }),
      ),
      serverOut,
    ),
  );
}

// ------------------------------------------------------------------ stats column

const STEP_OF_CODE = (code, path) => {
  const n = Number(code.slice(1));
  if (n < 10) return path.startsWith('turret') ? 'turret' : 'hull';
  if (n < 20) return 'armor';
  if (n < 30) return 'turret';
  if (n < 40) return 'gun';
  if (n < 50) return 'interior';
  if (n < 70) return 'suspension';
  if (n < 80) return 'power';
  if (n < 90) return 'gun';
  return 'start';
};

export function statsPanel(b, root) {
  root.textContent = '';
  const r = b.report;
  if (b.evalError) root.append(el('p', { class: 'bu-note bu-bad', text: '計算錯誤：' + b.evalError }));
  if (!r) return;
  const t = r.mass.total_kg / 1000;
  const m = r.mobility;
  root.append(
    el(
      'div',
      { class: 'bu-kpis' },
      kpi('全重', `${t.toFixed(1)} t`, `裝甲 ${(r.mass.armor_kg / 1000).toFixed(1)} t`),
      kpi('功重比', `${m.power_to_weight_hp_t.toFixed(1)}`, 'hp/t', m.power_to_weight_hp_t < 8 ? 'warn' : ''),
      kpi('公路極速', `${m.top_speed_road_kmh.toFixed(0)}`, `km/h${m.stale ? '…' : ''}`),
      kpi('接地壓力', `${m.ground_pressure_kpa.toFixed(0)}`, 'kPa', m.ground_pressure_kpa > 140 ? 'warn' : ''),
    ),
  );
  const s = r.suspension;
  root.append(el('div', { class: 'bu-bars' }, barRow('前段負重', s.front.ratio, `${(s.front.ratio * 100).toFixed(0)}%`), barRow('中段負重', s.middle.ratio, `${(s.middle.ratio * 100).toFixed(0)}%`), barRow('後段負重', s.rear.ratio, `${(s.rear.ratio * 100).toFixed(0)}%`)));
  const c = r.center_of_mass;
  root.append(el('div', { class: 'bu-kv-line' }, `重心 (${c[0].toFixed(2)}, ${c[1].toFixed(2)}, ${c[2].toFixed(2)}) m　內部剩餘 ${r.volumes.free_m3.toFixed(1)} m³${r.gun ? `　俯仰 −${r.gun.clearance.frontal_depression_deg.toFixed(0)}/+${r.gun.clearance.max_elevation_deg.toFixed(0)}°` : ''}`));
  const list = el('div', { class: 'bu-issues', id: 'bu-issues' });
  const issues = r.issues.slice().sort((a, b2) => (a.severity === b2.severity ? 0 : a.severity === 'error' ? -1 : 1));
  if (!issues.length) list.append(el('p', { class: 'bu-good', text: '✔ 沒有問題：這台車可以進入正式對戰。' }));
  for (const i of issues) {
    list.append(
      el(
        'button',
        {
          type: 'button',
          class: 'bu-issue',
          'data-sev': i.severity,
          onclick: () => {
            const step = STEP_OF_CODE(i.code, i.path);
            b.setStep(step);
            const faces = i.refs.filter((x) => /:face:/.test(x));
            if (faces.length) {
              const body = faces[0].split(':')[0];
              b.setBody(body);
              b.state.sel = { body, mode: 'face', items: faces.filter((x) => x.startsWith(body)).map((x) => Number(x.split(':')[2])) };
              b.renderPanel();
            }
            const box = i.refs.find((x) => x.startsWith('module:') || x.startsWith('crew:'));
            if (box) b.selectBox(box.split(':')[1]);
            b.redraw();
          },
        },
        el('b', { text: i.code }),
        el('span', { text: i.message }),
      ),
    );
  }
  root.append(el('h3', { class: 'bu-ih', text: `驗證（${r.errors} 錯誤、${r.warnings} 警告）` }), list);
}

function kpi(label, value, unit, state = '') {
  return el('div', { class: 'bu-kpi', 'data-state': state }, el('i', { text: label }), el('b', { text: value }), el('span', { text: unit }));
}

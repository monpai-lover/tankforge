// Design bureau (設計局): design a vehicle from an empty chassis -- hull and turret as free
// polygon meshes, armour per face, interior, power train, running gear, gun -- with every
// derived number (mass, centre of mass, loads, mobility, gun limits, legality, protection)
// coming live from the authoritative core (crates/design, as WebAssembly).
import { EditView, DrawList } from './view.js';
import { buildScene, pickFace, pickVertex, pickEdge, pickBox, pickAddon, bodyOffset, COLORS, thicknessAt } from './scene.js';
import { DesignDoc, vertsOfSelection } from './doc.js';
import * as M from './mesh.js';
import { STEPS, renderPanel, statsPanel } from './panels.js';
import { CASES as SUSP_CASES, suspensionDebug } from './suspdebug.js';

const { sub, add, mul, dot, cross, len, norm } = M.V;
const DEG = Math.PI / 180;
const STORE = 'tankforge.designs.v1';
const STORE_CURRENT = 'tankforge.design.current.v1';

export const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) e.append(c);
  return e;
};

export const storage = {
  list() {
    try {
      return JSON.parse(localStorage.getItem(STORE) || '[]');
    } catch {
      return [];
    }
  },
  save(list) {
    try {
      localStorage.setItem(STORE, JSON.stringify(list));
      return true;
    } catch {
      return false;
    }
  },
  current() {
    try {
      return JSON.parse(localStorage.getItem(STORE_CURRENT) || 'null');
    } catch {
      return null;
    }
  },
  setCurrent(d) {
    try {
      localStorage.setItem(STORE_CURRENT, JSON.stringify(d));
    } catch {
      /* convenience only */
    }
  },
};

export class Bureau {
  /**
   * opts: {data, core: Promise<DesignCore>, newDesign(key) -> design, arrange(design) -> failed,
   *        onClose(), onTestFire(design), onDrive(design), onGarage(list)}
   */
  constructor(root, opts) {
    this.root = root;
    this.opts = opts;
    this.data = opts.data;
    this.cat = opts.data.designCatalog;
    this.mats = Object.fromEntries(opts.data.materials.map((m) => [m.id, m]));
    this.core = null;
    this.doc = null;
    this.report = null;
    this.mobility = null;
    this.state = {
      step: 'start',
      body: 'hull',
      sel: { body: 'hull', mode: 'face', items: [] },
      tool: 'move',
      hover: null,
      viewMode: 'normal',
      xray: false,
      showInner: false,
      symmetry: true,
      issueRefs: new Set(),
      selectedBox: null,
      selectedAddon: null,
      placing: null,
      protect: null,
      range: [20, 260],
      // Suspension Debug Mode: null (off) or the test situation shown (suspdebug.CASES)
      suspDebug: null,
    };
    this.readouts = [];
    this.needRender = true;
    this.timers = {};
    this.built = false;
  }

  // ---------------------------------------------------------------- lifecycle

  _build() {
    const r = this.root;
    r.textContent = '';
    this.nameInput = el('input', { id: 'bu-name', class: 'bu-name', 'aria-label': '戰車名稱', maxlength: '60', oninput: (e) => this.doc && this.doc.change((d) => (d.name = e.target.value), 'meta') });
    this.statusEl = el('button', { type: 'button', id: 'bu-status', class: 'bu-status', onclick: () => this.setStep('save') });
    const top = el(
      'header',
      { class: 'bu-top' },
      el('h1', { text: '設計局' }),
      this.nameInput,
      el('div', { class: 'bu-tools' }, el('button', { type: 'button', class: 'tool', id: 'bu-undo', title: '復原 (Ctrl+Z)', text: '↶ 復原', onclick: () => this.undo() }), el('button', { type: 'button', class: 'tool', id: 'bu-redo', title: '重做 (Ctrl+Y)', text: '↷ 重做', onclick: () => this.redo() })),
      this.statusEl,
      el('div', { class: 'bu-tools bu-right' }, el('button', { type: 'button', class: 'tool', id: 'bu-testfire', text: '試射靶場', onclick: () => this.testFire() }), el('button', { type: 'button', class: 'tool', id: 'bu-drive', text: '試駕', onclick: () => this.drive() }), el('button', { type: 'button', class: 'tool bu-close', id: 'bu-close', text: '離開設計局', onclick: () => this.close() })),
    );
    this.stepsEl = el('nav', { class: 'bu-steps', 'aria-label': '設計步驟' });
    STEPS.forEach((s, i) => this.stepsEl.append(el('button', { type: 'button', class: 'bu-step', id: 'bu-step-' + s.key, 'data-step': s.key, onclick: () => this.setStep(s.key) }, el('b', { text: String(i + 1) }), el('span', { text: s.label }))));
    this.canvas = el('canvas', { class: 'bu-view', id: 'bu-view', tabindex: '0', 'aria-label': '設計視窗' });
    this.labels = el('canvas', { class: 'bu-labels', 'aria-hidden': 'true' });
    this.toolbar = el('div', { class: 'bu-toolbar' });
    this.tip = el('div', { class: 'bu-tip', hidden: true });
    this.legend = el('div', { class: 'bu-legend', hidden: true });
    this.hint = el('div', { class: 'bu-hint' });
    const main = el('div', { class: 'bu-main' }, this.canvas, this.labels, this.toolbar, this.legend, this.hint, this.tip);
    this.panel = el('div', { class: 'bu-panel', id: 'bu-panel' });
    this.stats = el('div', { class: 'bu-stats', id: 'bu-stats' });
    const side = el('aside', { class: 'bu-side' }, this.panel, this.stats);
    r.append(top, this.stepsEl, main, side);
    this.view = new EditView(this.canvas);
    this._input();
    this.built = true;
  }

  async open(design) {
    if (!this.built) this._build();
    this.root.hidden = false;
    document.body.dataset.bureau = '1';
    if (!this.core) {
      this.hint.textContent = '載入設計核心…';
      this.core = await this.opts.core;
      this.hint.textContent = '';
    }
    // coming back from the range keeps the open document and its undo history
    if (design || !this.doc) this.load(design || storage.current() || this.opts.newDesign('medium'));
    else {
      this.core.setDesign(this.design);
      this.needRender = true;
    }
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      if (this.needRender) this._render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  close() {
    this.suspend();
    this.opts.onClose?.();
  }

  /** Hides the bureau and stops its drawing without leaving it (test range, test drive). */
  suspend() {
    this.running = false;
    this.root.hidden = true;
    document.body.dataset.bureau = '0';
    if (this.doc) storage.setCurrent(this.doc.design);
  }

  load(design) {
    if (!design.editor) design.editor = { version: 1, hull: null, turret: null, symmetry: true };
    this.doc = new DesignDoc(design);
    this.doc.onChange((kind) => this.dirty(kind));
    this.state.sel = { body: 'hull', mode: 'face', items: [] };
    this.state.protect = null;
    this.state.selectedBox = null;
    this.state.selectedAddon = null;
    this.report = null;
    this.frame();
    this.evaluate(true);
    this.setStep(this.state.step);
  }

  get design() {
    return this.doc.design;
  }

  /** Points the camera at the whole vehicle. */
  frame() {
    const b = M.bounds(this.design.hull_geometry);
    const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2 + 0.3, (b.min[2] + b.max[2]) / 2];
    this.view.cam.target = c;
    this.view.cam.dist = Math.max(8, (b.max[2] - b.min[2]) * 1.9);
    this.needRender = true;
  }

  setView(name) {
    const c = this.view.cam;
    const v = { front: [0, 0.12], side: [Math.PI / 2, 0.08], rear: [Math.PI, 0.12], top: [0, 1.45], iso: [2.4, 0.38], left: [-Math.PI / 2, 0.08] }[name];
    if (v) [c.yaw, c.pitch] = v;
    this.needRender = true;
  }

  // ---------------------------------------------------------------- evaluation

  dirty(kind = 'data') {
    this.nameInput.value = this.design.name;
    if (kind === 'all' || kind === 'topology') this.state.sel.items = this.state.sel.items.filter((it) => this._exists(this.state.sel, it));
    this.state.protect = kind === 'view' ? this.state.protect : null;
    this.redraw();
    clearTimeout(this.timers.quick);
    clearTimeout(this.timers.full);
    this.timers.quick = setTimeout(() => this.evaluate(false), 40);
    this.timers.full = setTimeout(() => this.evaluate(true), 450);
    if (kind === 'all' || kind === 'topology' || kind === 'panel') this.renderPanel();
    storage.setCurrent(this.design);
  }

  _exists(sel, it) {
    const mesh = this.doc.mesh(sel.body);
    if (!mesh) return false;
    if (sel.mode === 'face') return !!M.findFace(mesh, it);
    if (sel.mode === 'vertex') return M.usedVertices(mesh).has(it);
    if (sel.mode === 'edge') return M.edges(mesh).some(([a, b]) => (a === it[0] && b === it[1]) || (a === it[1] && b === it[0]));
    return true;
  }

  evaluate(full) {
    if (!this.core || !this.doc) return;
    try {
      const debug = full && this.state.suspDebug && this.state.step === 'suspension';
      const r = this.core.evaluate(this.design, { mobility: full, files: !!debug });
      if (debug) this._suspDebug(r);
      delete r.files; // only the debug settle needs the compiled files
      if (full) this.mobility = r.mobility;
      else if (this.mobility) r.mobility = { ...r.mobility, top_speed_road_kmh: this.mobility.top_speed_road_kmh, top_speed_dirt_kmh: this.mobility.top_speed_dirt_kmh, top_speed_mud_kmh: this.mobility.top_speed_mud_kmh, accel_0_32_s: this.mobility.accel_0_32_s, max_climb_deg: this.mobility.max_climb_deg, stale: true };
      this.report = r;
      this.evalError = null;
    } catch (e) {
      this.evalError = e.message;
    }
    this.state.issueRefs = new Set((this.report?.issues || []).filter((i) => i.severity === 'error').flatMap((i) => i.refs));
    this.updateStats();
    this.redraw();
  }

  /** Settles the compiled design with the game's tank model for the Suspension Debug Mode. */
  _suspDebug(r) {
    const key = this.state.suspDebug + ':' + JSON.stringify(this.design).length + ':' + (r.design_hash || '');
    if (this.suspDbg && this.suspDbg.key === key) return;
    if (!r.files) {
      this.suspDbg = { key, error: '設計尚未能編譯（先修正錯誤）' };
      return;
    }
    try {
      const res = suspensionDebug(r.files, this.data.terrains, this.state.suspDebug, r.dimensions?.hull?.min?.[1] ?? 0.4);
      this.suspDbg = res ? { key, ...res } : { key, error: '沒有負重輪' };
    } catch (e) {
      this.suspDbg = { key, error: e.message };
    }
  }

  /** Turns the Suspension Debug Mode on (with a test situation) or off (null). */
  setSuspDebug(caseKey) {
    this.state.suspDebug = caseKey;
    if (!caseKey) this.suspDbg = null;
    else this.evaluate(true);
    this.renderToolbar();
    this.renderPanel();
    this.redraw();
  }

  updateStats() {
    const r = this.report;
    statsPanel(this, this.stats);
    if (r) {
      this.statusEl.dataset.state = r.errors ? 'error' : r.warnings ? 'warn' : 'ok';
      this.statusEl.textContent = r.errors ? `✖ ${r.errors} 個錯誤　${r.warnings} 個警告` : r.warnings ? `▲ ${r.warnings} 個警告` : '✔ 可參戰';
    }
    for (const f of this.readouts) {
      try {
        f(r);
      } catch {
        /* a readout for a part that is gone */
      }
    }
  }

  // ---------------------------------------------------------------- steps and panels

  setStep(key) {
    this.state.step = key;
    for (const b of this.stepsEl.children) b.setAttribute('aria-current', b.dataset.step === key ? 'step' : 'false');
    if (key === 'turret' && this.design.turret_geometry) this.setBody('turret');
    if (key === 'hull') this.setBody('hull');
    if (key === 'armor' && this.state.sel.mode !== 'face') this.state.sel = { body: this.state.body, mode: 'face', items: [] };
    this.state.xray = key === 'interior';
    this.state.placing = null;
    if (key !== 'analysis') this.state.viewMode = key === 'armor' && this.state.viewMode === 'normal' ? 'thickness' : key === 'armor' ? this.state.viewMode : 'normal';
    this.view.mode = this.state.viewMode === 'effective' ? 1 : 0;
    if (key === 'suspension' && this.state.suspDebug) this.evaluate(true);
    this.renderPanel();
    this.renderToolbar();
    this.redraw();
  }

  setBody(body) {
    if (body === 'turret' && !this.design.turret_geometry) return;
    this.state.body = body;
    this.state.sel = { body, mode: this.state.sel.mode, items: [] };
    this.renderToolbar();
    this.redraw();
  }

  renderPanel() {
    this.readouts = [];
    this.panel.textContent = '';
    renderPanel(this, this.panel);
    this.updateStats();
  }

  /** Viewport toolbar: selection mode, tools, symmetry, views. Content depends on the step. */
  renderToolbar() {
    const tb = this.toolbar;
    tb.textContent = '';
    const st = this.state;
    const group = (...items) => el('div', { class: 'bu-group' }, ...items);
    const tbtn = (id, label, on, title, fn) => el('button', { type: 'button', id, class: 'bu-tb', 'aria-pressed': on ? 'true' : 'false', title, text: label, onclick: () => fn() });
    const geom = st.step === 'hull' || st.step === 'turret';
    if (geom || st.step === 'armor') {
      tb.append(
        group(
          ...(this.design.turret_geometry ? [tbtn('bu-body-hull', '車體', st.body === 'hull', '編輯車體', () => this.setBody('hull')), tbtn('bu-body-turret', '炮塔', st.body === 'turret', '編輯炮塔', () => this.setBody('turret'))] : []),
        ),
      );
    }
    if (geom) {
      tb.append(
        group(
          tbtn('bu-mode-object', '物件', st.sel.mode === 'object', '整個車體 / 炮塔 (1)', () => this.setMode('object')),
          tbtn('bu-mode-vertex', '頂點', st.sel.mode === 'vertex', '頂點 (2)', () => this.setMode('vertex')),
          tbtn('bu-mode-edge', '邊', st.sel.mode === 'edge', '邊 (3)', () => this.setMode('edge')),
          tbtn('bu-mode-face', '面', st.sel.mode === 'face', '面 (4)', () => this.setMode('face')),
        ),
        group(
          tbtn('bu-tool-move', '移動', st.tool === 'move', '移動 (G)', () => this.setTool('move')),
          tbtn('bu-tool-rotate', '旋轉', st.tool === 'rotate', '旋轉 (R)', () => this.setTool('rotate')),
          tbtn('bu-tool-scale', '縮放', st.tool === 'scale', '縮放 (S)', () => this.setTool('scale')),
          tbtn('bu-tool-extrude', '擠出', st.tool === 'extrude', '擠出 (E)', () => this.setTool('extrude')),
        ),
        group(tbtn('bu-sym', st.symmetry ? '左右對稱：開' : '左右對稱：關', st.symmetry, '同時編輯鏡像的另一側 (X)', () => {
          st.symmetry = !st.symmetry;
          this.renderToolbar();
        })),
      );
    }
    if (st.step === 'suspension') {
      tb.append(
        group(
          tbtn('bu-susp-debug', st.suspDebug ? '懸掛除錯：開' : '懸掛除錯：關', !!st.suspDebug, 'Suspension Debug Mode：用實戰的戰車物理算出每個負重輪的負載、壓縮量、彈簧力與阻尼力', () => this.setSuspDebug(st.suspDebug ? null : 'rest')),
          ...(st.suspDebug ? SUSP_CASES.map((c) => tbtn('bu-sd-' + c.key, c.label, st.suspDebug === c.key, '', () => this.setSuspDebug(c.key))) : []),
        ),
      );
    }
    tb.append(
      group(
        tbtn('bu-view-iso', '斜視', false, '', () => this.setView('iso')),
        tbtn('bu-view-front', '正面', false, '', () => this.setView('front')),
        tbtn('bu-view-side', '側面', false, '', () => this.setView('side')),
        tbtn('bu-view-top', '上方', false, '', () => this.setView('top')),
        tbtn('bu-view-rear', '後面', false, '', () => this.setView('rear')),
        tbtn('bu-xray', '透視', st.xray, '半透明外殼，看內部', () => {
          st.xray = !st.xray;
          this.renderToolbar();
          this.redraw();
        }),
      ),
    );
    const hints = {
      start: '選一個範本開始，或從空白底盤一步一步裝起。',
      hull: '點選頂點／邊／面後拖曳控制把手編輯；空白處拖曳旋轉視角，右鍵平移，滾輪縮放。',
      turret: '炮塔可以自由變形；炮塔環要落在車頂上、炮塔底部要蓋住炮塔環。',
      armor: '點選面設定裝甲；Shift 加選。熱力圖：紅＝薄，藍＝厚。',
      interior: '拖曳模組或乘員移動位置（Shift 上下）；紅色＝穿出裝甲或互相重疊。',
      power: '引擎與傳動的大小、重量直接放進車內並影響機動。',
      suspension: st.suspDebug ? '懸掛除錯：綠箭頭＝地面支撐力，黃箭頭＝懸掛彈簧推車體的力；標籤＝負載 t · 壓縮 %。' : '柱狀圖是每組負重輪的負載；紫點是重心。開「懸掛除錯」用實戰物理看每個輪子。',
      gun: '炮閂（含後座行程）在俯仰範圍內不能撞到炮塔，炮管俯下時不能撞到車體。',
      analysis: '移動滑鼠看任一點的厚度、傾角與視線厚度；跑擊穿機率圖看整台車的弱點。',
      test: '機動數據由伺服器同一套物理計算；可進靶場朝自己的設計開火。',
      save: '保存在瀏覽器；也可以匯出交給伺服器驗證。',
    };
    this.hint.textContent = hints[st.step] || '';
  }

  setMode(mode) {
    this.state.sel = { body: this.state.body, mode, items: mode === 'object' ? ['all'] : [] };
    this.renderToolbar();
    this.renderPanel();
    this.redraw();
  }

  setTool(tool) {
    this.state.tool = tool;
    if (tool === 'extrude' && this.state.sel.mode !== 'face') this.state.sel = { body: this.state.body, mode: 'face', items: [] };
    this.renderToolbar();
    this.redraw();
  }

  // ---------------------------------------------------------------- drawing

  redraw() {
    if (!this.doc) return;
    const dl = buildScene({ design: this.design, report: this.report, mats: this.mats, state: this.state, suspDbg: this.state.suspDebug && this.state.step === 'suspension' ? this.suspDbg : null });
    this._gizmo(dl);
    this.view.set(dl);
    this.needRender = true;
  }

  _render() {
    this.needRender = false;
    this.view.render();
    this._labels();
  }

  /** 2D overlay: module names in the interior view, dimensions, ring label. */
  _labels() {
    const c = this.labels;
    const dpr = this.view.dpr || 1;
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, c.clientWidth, c.clientHeight);
    const r = this.report;
    if (!r) return;
    const cam = this.view.lastCam || this.view.camera();
    g.font = '600 12px "Noto Sans TC", system-ui, sans-serif';
    g.textAlign = 'center';
    const tag = (p, text, color = '#ece8d9', bg = 'rgba(12,14,9,0.72)') => {
      const [x, y, wv] = this.view.toScreen(p, cam);
      if (wv <= 0) return;
      const tw = g.measureText(text).width + 10;
      g.fillStyle = bg;
      g.fillRect(x - tw / 2, y - 9, tw, 18);
      g.fillStyle = color;
      g.fillText(text, x, y + 4);
    };
    if (this.state.xray || this.state.step === 'interior') {
      const names = { engine: '引擎', transmission: '傳動', fuel_tank: '油箱', ammo_rack: '彈藥架', radio: '無線電', turret_drive: '炮塔驅動' };
      const crew = { commander: '車長', gunner: '炮手', loader: '裝填手', driver: '駕駛', radio_operator: '無線電手' };
      for (const b of r.interior.boxes) {
        if (b.kind === 'gun_breech') continue;
        const p = [(b.hull_min[0] + b.hull_max[0]) / 2, b.hull_max[1] + 0.08, (b.hull_min[2] + b.hull_max[2]) / 2];
        const bad = !b.inside || b.collisions.length;
        tag(p, (b.crew ? crew[b.kind] : names[b.kind]) || b.kind, bad ? '#ffb4a8' : '#ece8d9', bad ? 'rgba(120,30,20,0.85)' : 'rgba(12,14,9,0.72)');
      }
    }
    if (this.state.step === 'hull' || this.state.step === 'start') {
      const d = r.dimensions;
      tag([0, d.hull.max[1] + 0.35, d.hull.max[2]], `長 ${d.hull.length_m.toFixed(2)} m　寬 ${d.overall_width_m.toFixed(2)} m　高 ${d.overall_height_m.toFixed(2)} m`, '#e2b34a');
    }
    if ((this.state.step === 'suspension' || this.state.step === 'power') && r.center_of_mass) tag(add(r.center_of_mass, [0, 0.3, 0]), '重心', '#f0a8f0');
    const sd = this.state.step === 'suspension' && this.state.suspDebug ? this.suspDbg : null;
    if (sd?.wheels) {
      // one tag per axle, on the side facing the camera
      const per = sd.wheels.length / 2;
      for (let i = 0; i < per; i++) {
        const pair = [sd.wheels[i], sd.wheels[i + per]];
        const near = pair.map((w) => this.view.toScreen(w.contact, cam)[2]);
        const w = near[0] <= near[1] ? pair[0] : pair[1];
        const over = w.compPct > 100 || !w.grounded;
        tag(add(w.contact, [0, -0.22, 0]), `${w.side > 0 ? '右' : '左'}${w.n} ${w.loadT.toFixed(1)} t · ${w.compPct.toFixed(0)}%`, over ? '#ffb4a8' : '#cfe8c8', over ? 'rgba(120,30,20,0.85)' : 'rgba(12,14,9,0.78)');
      }
      const label = SUSP_CASES.find((c) => c.key === sd.case)?.label || '';
      tag([0, (r.dimensions?.hull?.max?.[1] ?? 2) + 0.6, 0], `${label}　俯仰 ${((sd.pitch * 180) / Math.PI).toFixed(1)}°　側傾 ${((sd.roll * 180) / Math.PI).toFixed(1)}°`, '#e2b34a');
    } else if (sd?.error) tag([0, (r.dimensions?.hull?.max?.[1] ?? 2) + 0.6, 0], sd.error, '#ffb4a8');
    if (this.state.step === 'turret' && this.design.turret_ring) tag(add(this.design.turret_ring.position_m, [0, 0.05, this.design.turret_ring.diameter_m / 2 + 0.15]), `炮塔環 ⌀${this.design.turret_ring.diameter_m.toFixed(2)} m`, '#e2b34a');
  }

  // ---------------------------------------------------------------- selection helpers

  selectionVerts() {
    const sel = this.state.sel;
    const mesh = this.doc.mesh(sel.body);
    if (!mesh) return [];
    return vertsOfSelection(mesh, sel.mode, sel.items);
  }

  selectionCenter() {
    const sel = this.state.sel;
    if (sel.mode === 'object' && sel.body === 'turret' && this.design.turret_ring) return this.design.turret_ring.position_m.slice();
    const verts = this.selectionVerts();
    if (!verts.length) return null;
    const mesh = this.doc.mesh(sel.body);
    return add(M.centroidOf(mesh, verts), bodyOffset(this.design, sel.body));
  }

  /** Average outward normal of the selected faces (world). */
  selectionNormal() {
    const mesh = this.doc.mesh(this.state.sel.body);
    let n = [0, 0, 0];
    for (const id of this.state.sel.mode === 'face' ? this.state.sel.items : []) {
      const f = M.findFace(mesh, id);
      if (f) n = add(n, mul(M.faceNormal(mesh, f), M.faceArea(mesh, f)));
    }
    return len(n) > 1e-9 ? norm(n) : null;
  }

  // ---------------------------------------------------------------- gizmo

  _gizmoFrame() {
    const st = this.state;
    if (!(st.step === 'hull' || st.step === 'turret')) return null;
    if (!st.sel.items.length) return null;
    const c = this.selectionCenter();
    if (!c) return null;
    const cam = this.view.camera();
    const size = len(sub(c, cam.eye)) * 0.11;
    if (st.tool === 'extrude') {
      const n = this.selectionNormal();
      return n ? { c, size, axes: [{ dir: n, color: [0.95, 0.75, 0.25, 1], kind: 'extrude' }] } : null;
    }
    const axes = [
      { dir: [1, 0, 0], color: [0.92, 0.32, 0.26, 1] },
      { dir: [0, 1, 0], color: [0.45, 0.82, 0.35, 1] },
      { dir: [0, 0, 1], color: [0.32, 0.55, 0.95, 1] },
    ];
    return { c, size, axes: axes.map((a) => ({ ...a, kind: st.tool })) };
  }

  _gizmo(dl) {
    const g = this._gizmoFrame();
    this.gizmo = g;
    if (!g) return;
    const hot = this.drag?.kind === 'gizmo' ? this.drag.axis : this.hotAxis;
    g.axes.forEach((a, i) => {
      const col = hot === i ? [1, 0.95, 0.6, 1] : a.color;
      if (a.kind === 'rotate') {
        dl.circle(g.c, g.size * 0.8, a.dir, col, hot === i ? 3.5 : 2.4, true, 56);
      } else {
        const tip = add(g.c, mul(a.dir, g.size));
        dl.line(g.c, tip, col, hot === i ? 4 : 3, true);
        if (a.kind === 'scale') {
          const s = g.size * 0.07;
          dl.boxEdges(sub(tip, [s, s, s]), add(tip, [s, s, s]), col, 3, true);
        } else {
          // arrow head
          const side = norm(cross(a.dir, Math.abs(a.dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
          const back = add(g.c, mul(a.dir, g.size * 0.82));
          dl.line(tip, add(back, mul(side, g.size * 0.07)), col, 3, true);
          dl.line(tip, sub(back, mul(side, g.size * 0.07)), col, 3, true);
        }
      }
    });
    dl.point(g.c, [1, 1, 1, 1], 9);
  }

  /** Which gizmo handle (index) is under the cursor. */
  _hitGizmo(px, py) {
    const g = this.gizmo;
    if (!g) return -1;
    const cam = this.view.camera();
    const C = this.view.toScreen(g.c, cam);
    let best = -1;
    let bd = 10;
    g.axes.forEach((a, i) => {
      if (a.kind === 'rotate') {
        // distance to the projected ring
        let dmin = Infinity;
        const t = Math.abs(a.dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const x = norm(cross(a.dir, t));
        const y = cross(a.dir, x);
        for (let k = 0; k < 48; k++) {
          const ang = (k / 48) * Math.PI * 2;
          const p = add(g.c, mul(add(mul(x, Math.cos(ang)), mul(y, Math.sin(ang))), g.size * 0.8));
          const s = this.view.toScreen(p, cam);
          dmin = Math.min(dmin, Math.hypot(s[0] - px, s[1] - py));
        }
        if (dmin < bd) {
          bd = dmin;
          best = i;
        }
        return;
      }
      const T = this.view.toScreen(add(g.c, mul(a.dir, g.size)), cam);
      const ab = [T[0] - C[0], T[1] - C[1]];
      const l2 = ab[0] * ab[0] + ab[1] * ab[1] || 1;
      const t = Math.max(0.15, Math.min(1, ((px - C[0]) * ab[0] + (py - C[1]) * ab[1]) / l2));
      const d = Math.hypot(C[0] + ab[0] * t - px, C[1] + ab[1] * t - py);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  /** Builds the edit ops for a gizmo drag amount, mirrored for symmetric editing. */
  _opsFor(kind, axis, amount) {
    const st = this.state;
    const sel = st.sel;
    const mesh = this.doc.mesh(sel.body);
    let verts = this.selectionVerts();
    const a = this.gizmo.axes[axis].dir;
    if (sel.mode === 'object') verts = [...M.usedVertices(mesh)];
    const sym = st.symmetry && sel.mode !== 'object';
    const right = verts.filter((i) => mesh.vertices[i][0] > 1e-4);
    const left = verts.filter((i) => mesh.vertices[i][0] < -1e-4);
    const center = verts.filter((i) => Math.abs(mesh.vertices[i][0]) <= 1e-4);
    const ops = [];
    if (kind === 'move') {
      const d = mul(a, amount);
      if (!sym) ops.push({ t: 'move', v: verts, d });
      else {
        if (right.length) ops.push({ t: 'move', v: right, d });
        if (left.length) ops.push({ t: 'move', v: left, d: [-d[0], d[1], d[2]] });
        if (center.length && (d[1] || d[2])) ops.push({ t: 'move', v: center, d: [0, d[1], d[2]] });
      }
    } else if (kind === 'rotate') {
      if (!sym) ops.push({ t: 'rot', v: verts, axis: a, a: amount });
      else {
        if (right.length) ops.push({ t: 'rot', v: right, axis: a, a: amount });
        if (left.length) ops.push({ t: 'rot', v: left, axis: [-a[0], a[1], a[2]], a: -amount });
        if (center.length && a[0] === 1) ops.push({ t: 'rot', v: center, axis: a, a: amount });
      }
    } else if (kind === 'scale') {
      const s = [1, 1, 1].map((v, k) => (a[k] ? Math.max(0.05, 1 + amount) : 1));
      if (!sym) ops.push({ t: 'scale', v: verts, s });
      else {
        // the pair scales about its common centre so the two halves stay mirror images
        const all = [...right, ...left, ...center];
        ops.push({ t: 'scale', v: all, s, pivot: [0, ...M.centroidOf(mesh, all).slice(1)] });
      }
    }
    return ops;
  }

  // ---------------------------------------------------------------- edits

  /** Applies a list of ops as one undoable step (or replaces the live preview). */
  applyOps(ops, live = false) {
    const body = this.state.sel.body;
    if (this.state.sel.mode === 'object' && body === 'turret' && ops[0]?.t === 'move') return this._moveRing(ops[0].d, live);
    try {
      if (!live || !this.liveOps) {
        this.doc.snapshot();
        for (const op of ops) this.doc.edit(body, op, { record: false });
        this.liveOps = live ? ops.length : 0;
      } else {
        const entry = this.doc.entry(body);
        entry.ops.splice(entry.ops.length - this.liveOps, this.liveOps, ...ops);
        this.liveOps = ops.length;
        this.doc.rebuild(body);
        this.doc.emit('shape');
      }
      return true;
    } catch (e) {
      this.toast(e.message, true);
      return false;
    }
  }

  _moveRing(d, live) {
    const r = this.design.turret_ring;
    if (!this.ringStart || !live) this.ringStart = r.position_m.slice();
    if (!live || !this.liveOps) this.doc.snapshot();
    this.liveOps = live ? 1 : 0;
    const x = this.ringStart[0] + d[0];
    const z = this.ringStart[2] + d[2];
    r.position_m = [x, this.opts.ringHeight(this.design.hull_geometry, x, z, r.diameter_m), z];
    this.doc.emit('shape');
    return true;
  }

  /** Extrude / inset / bevel / split from the panel or keyboard. */
  topoOp(kind, amount, extra) {
    const st = this.state;
    const body = st.sel.body;
    let items = st.sel.items;
    if (st.symmetry) items = this.doc.mirrorSelection(body, st.sel.mode, items);
    let op;
    if (kind === 'extrude' || kind === 'inset') {
      if (st.sel.mode !== 'face' || !items.length) return this.toast('先選取面', true);
      op = { t: kind, f: items, d: amount };
    } else if (kind === 'bevel') {
      if (st.sel.mode !== 'edge' || !items.length) return this.toast('先選取邊', true);
      op = { t: 'bevel', e: items, w: amount };
    } else if (kind === 'split') {
      if (st.sel.mode !== 'face' || !items.length) return this.toast('先選取面', true);
      const mesh = this.doc.mesh(body);
      const ops = [];
      const mf = M.mirrorFaces(mesh);
      const base = st.sel.items[0];
      for (const id of items) {
        let cuts = extra.cuts;
        // the mirror face's horizontal axis runs the other way
        if (id !== base && mf.get(base) === id && extra.axis === 'u') {
          const fa = M.findFace(mesh, base);
          const fb = M.findFace(mesh, id);
          const ua = M.faceFrame(M.faceNormal(mesh, fa)).u;
          const ub = M.faceFrame(M.faceNormal(mesh, fb)).u;
          if (dot([-ua[0], ua[1], ua[2]], ub) < 0) cuts = cuts.map((c) => 1 - c);
        }
        ops.push({ t: 'split', f: id, axis: extra.axis, cuts });
      }
      try {
        this.doc.snapshot();
        for (const o of ops) this.doc.edit(body, o, { record: false });
      } catch (e) {
        this.toast(e.message, true);
      }
      return;
    }
    try {
      const created = this.doc.edit(body, op);
      if (kind === 'extrude' || kind === 'inset') this.state.sel.items = items;
      this.toast(`${{ extrude: '擠出', inset: '內插', bevel: '倒角' }[kind]}完成，新增 ${created.length} 個面`);
    } catch (e) {
      this.toast(e.message, true);
    }
  }

  numericTransform(kind, vec) {
    if (!this.state.sel.items.length) return this.toast('先選取要編輯的元素', true);
    this.gizmo = this.gizmo || this._gizmoFrame();
    if (!this.gizmo) return;
    const ops = [];
    for (let k = 0; k < 3; k++) {
      if (!vec[k]) continue;
      const amount = kind === 'rotate' ? vec[k] * DEG : kind === 'scale' ? vec[k] - 1 : vec[k];
      if (kind === 'scale' && Math.abs(amount) < 1e-9) continue;
      const g = this.gizmo;
      const saved = g.axes;
      g.axes = [0, 1, 2].map((i) => ({ dir: [i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0], kind }));
      ops.push(...this._opsFor(kind, k, amount));
      g.axes = saved;
    }
    if (ops.length) this.applyOps(ops);
  }

  undo() {
    if (this.doc?.undo()) this.renderPanel();
  }
  redo() {
    if (this.doc?.redo()) this.renderPanel();
  }

  toast(text, bad = false) {
    let t = this.root.querySelector('.bu-toast');
    if (!t) {
      t = el('div', { class: 'bu-toast', role: 'status' });
      this.root.append(t);
    }
    t.textContent = text;
    t.dataset.bad = bad ? '1' : '0';
    t.dataset.show = '1';
    clearTimeout(this.timers.toast);
    this.timers.toast = setTimeout(() => (t.dataset.show = '0'), 2600);
  }

  // ---------------------------------------------------------------- input

  _input() {
    const cv = this.canvas;
    const pointers = new Map();
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      cv.focus();
      cv.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        this.drag = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), dist0: this.view.cam.dist };
        return;
      }
      const px = e.offsetX;
      const py = e.offsetY;
      const axis = e.button === 0 ? this._hitGizmo(px, py) : -1;
      if (axis >= 0) {
        this.drag = { kind: 'gizmo', axis, x0: px, y0: py, moved: false };
        this.liveOps = 0;
        this.ringStart = null;
        return;
      }
      if (e.button === 0 && this.state.step === 'interior') {
        const ray = this.view.ray(px, py);
        const hit = pickBox(this.report, ray.o, ray.d);
        if (hit) {
          this.selectBox(hit.id);
          this.drag = { kind: 'box', id: hit.id, x0: px, y0: py, start: this._boxCenter(hit.id), moved: false, vertical: e.shiftKey };
          return;
        }
      }
      if (e.button === 0 && this.state.step === 'armor' && this.state.selectedAddon && !this.state.placing) {
        const ray = this.view.ray(px, py);
        const hit = pickAddon(this.design, this.report, ray.o, ray.d);
        if (hit && hit.id === this.state.selectedAddon) {
          this.drag = { kind: 'addon', id: hit.id, x0: px, y0: py, moved: false };
          return;
        }
      }
      this.drag = { kind: e.button === 0 && !e.altKey ? 'orbit' : 'pan', x0: px, y0: py, lx: px, ly: py, moved: false, shift: e.shiftKey };
    });
    cv.addEventListener('pointermove', (e) => {
      const px = e.offsetX;
      const py = e.offsetY;
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: px, y: py });
      const d = this.drag;
      if (!d) {
        this._hover(px, py);
        return;
      }
      if (d.kind === 'pinch' && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        this.view.cam.dist = Math.max(2, Math.min(60, (d.dist0 * d.d0) / Math.max(10, Math.hypot(a.x - b.x, a.y - b.y))));
        this.needRender = true;
        this.redraw();
        return;
      }
      if (Math.hypot(px - d.x0, py - d.y0) > 3) d.moved = true;
      if (d.kind === 'orbit' && d.moved) {
        const c = this.view.cam;
        c.yaw -= (px - d.lx) * 0.008;
        c.pitch = Math.max(-1.45, Math.min(1.5, c.pitch + (py - d.ly) * 0.006));
        d.lx = px;
        d.ly = py;
        this.redraw();
      } else if (d.kind === 'pan' && d.moved) {
        const cam = this.view.camera();
        const k = (this.view.cam.dist * cam.tanY * 2) / this.canvas.clientHeight;
        this.view.cam.target = add(this.view.cam.target, add(mul(cam.right, -(px - d.lx) * k), mul(cam.up, (py - d.ly) * k)));
        d.lx = px;
        d.ly = py;
        this.redraw();
      } else if (d.kind === 'gizmo' && d.moved) {
        this._dragGizmo(d, px, py);
      } else if (d.kind === 'box' && d.moved) {
        this._dragBox(d, px, py, e.shiftKey);
      } else if (d.kind === 'addon' && d.moved) {
        this._dragAddon(d, px, py);
      }
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.kind === 'gizmo' || d.kind === 'box' || d.kind === 'addon') {
        this.liveOps = 0;
        this.ringStart = null;
        if (d.moved) {
          this.evaluate(true);
          this.renderPanel();
        }
        return;
      }
      if (!d.moved && (d.kind === 'orbit' || d.kind === 'pan') && e.button === 0) this._click(d.x0, d.y0, e.shiftKey || d.shift);
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('dblclick', (e) => {
      const ray = this.view.ray(e.offsetX, e.offsetY);
      const hit = pickFace(this.design, ray.o, ray.d);
      if (hit) {
        this.view.cam.target = hit.point;
        this.redraw();
      }
    });
    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.view.cam.dist = Math.max(2, Math.min(60, this.view.cam.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
        this.redraw();
      },
      { passive: false },
    );
    cv.addEventListener('pointerleave', () => {
      this.tip.hidden = true;
      if (this.state.hover) {
        this.state.hover = null;
        this.redraw();
      }
    });
    this.root.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'y') {
        e.preventDefault();
        this.redo();
        return;
      }
      const geom = this.state.step === 'hull' || this.state.step === 'turret';
      if (geom && ['1', '2', '3', '4'].includes(k)) this.setMode(['object', 'vertex', 'edge', 'face'][Number(k) - 1]);
      else if (geom && k === 'g') this.setTool('move');
      else if (geom && k === 'r') this.setTool('rotate');
      else if (geom && k === 's') this.setTool('scale');
      else if (geom && k === 'e') this.setTool('extrude');
      else if (geom && k === 'x') {
        this.state.symmetry = !this.state.symmetry;
        this.renderToolbar();
      } else if (k === 'escape') {
        this.state.sel.items = [];
        this.state.placing = null;
        this.renderPanel();
        this.redraw();
      } else if (k === 'a' && geom) {
        this.selectAll();
      } else if (k === 'f') this.frame();
    });
  }

  selectAll() {
    const sel = this.state.sel;
    const mesh = this.doc.mesh(sel.body);
    if (!mesh) return;
    sel.items = sel.mode === 'face' ? mesh.faces.map((f) => f.id) : sel.mode === 'vertex' ? [...M.usedVertices(mesh)] : sel.mode === 'edge' ? M.edges(mesh) : ['all'];
    this.renderPanel();
    this.redraw();
  }

  _dragGizmo(d, px, py) {
    const g = this.gizmo;
    if (!g) return;
    const a = g.axes[d.axis];
    const cam = this.view.camera();
    const C = this.view.toScreen(g.c, cam);
    const T = this.view.toScreen(add(g.c, mul(a.dir, g.size)), cam);
    const ax = [T[0] - C[0], T[1] - C[1]];
    const al = Math.hypot(ax[0], ax[1]) || 1;
    const mdx = px - d.x0;
    const mdy = py - d.y0;
    let amount;
    if (a.kind === 'rotate') {
      const a0 = Math.atan2(d.y0 - C[1], d.x0 - C[0]);
      const a1 = Math.atan2(py - C[1], px - C[0]);
      amount = -(a1 - a0);
      // seen from behind the axis the screen turns the other way
      if (dot(a.dir, cam.forward) > 0) amount = -amount;
      amount = Math.round(amount / DEG) * DEG;
    } else {
      const along = (mdx * ax[0] + mdy * ax[1]) / al;
      amount = (along / al) * g.size;
      if (a.kind === 'scale') amount = (along / al) * 0.5;
      amount = Math.round(amount * 100) / 100;
    }
    if (a.kind === 'extrude') {
      const body = this.state.sel.body;
      let items = this.state.sel.items;
      if (this.state.symmetry) items = this.doc.mirrorSelection(body, 'face', items);
      if (Math.abs(amount) < 0.01) return;
      this.applyOps([{ t: 'extrude', f: items, d: amount }], true);
      return;
    }
    // freeze the gizmo frame during the drag (selection centre moves with it)
    const saved = this.gizmo;
    this.applyOps(this._opsFor(a.kind, d.axis, amount), true);
    this.gizmo = saved;
  }

  _click(px, py, additive) {
    const st = this.state;
    const ray = this.view.ray(px, py);
    if (st.placing) return this.placeAddon(st.placing, ray);
    if (st.step === 'interior') {
      const hit = pickBox(this.report, ray.o, ray.d);
      this.selectBox(hit ? hit.id : null);
      return;
    }
    if (st.step === 'armor') {
      const ad = pickAddon(this.design, this.report, ray.o, ray.d);
      const f = pickFace(this.design, ray.o, ray.d);
      if (ad && (!f || ad.t < f.t)) {
        st.selectedAddon = ad.id;
        st.sel.items = [];
        this.renderPanel();
        this.redraw();
        return;
      }
      st.selectedAddon = null;
      if (f) {
        if (f.body !== st.body) this.setBody(f.body);
        this._toggle(f.id, additive);
      } else if (!additive) st.sel.items = [];
      this.renderPanel();
      this.redraw();
      return;
    }
    if (st.step !== 'hull' && st.step !== 'turret') return;
    const body = st.body;
    let item = null;
    if (st.sel.mode === 'face' || st.sel.mode === 'object') {
      const f = pickFace(this.design, ray.o, ray.d, body);
      item = f ? (st.sel.mode === 'object' ? 'all' : f.id) : null;
    } else if (st.sel.mode === 'vertex') item = pickVertex(this.design, body, this.view, px, py);
    else if (st.sel.mode === 'edge') item = pickEdge(this.design, body, this.view, px, py);
    if (item == null) {
      if (!additive) st.sel.items = [];
    } else this._toggle(item, additive);
    this.renderPanel();
    this.redraw();
  }

  _toggle(item, additive) {
    const sel = this.state.sel;
    const key = (x) => (Array.isArray(x) ? (x[0] < x[1] ? x[0] + ',' + x[1] : x[1] + ',' + x[0]) : String(x));
    const has = sel.items.findIndex((x) => key(x) === key(item));
    if (additive) {
      if (has >= 0) sel.items.splice(has, 1);
      else sel.items.push(item);
    } else sel.items = [item];
    if (this.state.symmetry && this.state.step !== 'armor') sel.items = this.doc.mirrorSelection(sel.body, sel.mode, sel.items);
  }

  _hover(px, py) {
    const st = this.state;
    const now = performance.now();
    if (now - (this._lastHover || 0) < 30) return;
    this._lastHover = now;
    let hover = null;
    const ray = this.view.ray(px, py);
    const hit = this._hitGizmo(px, py);
    if (hit !== this.hotAxis) {
      this.hotAxis = hit;
      this.redraw();
    }
    if (st.step === 'hull' || st.step === 'turret' || st.step === 'armor') {
      const mode = st.step === 'armor' ? 'face' : st.sel.mode;
      if (mode === 'face') {
        const f = pickFace(this.design, ray.o, ray.d, st.step === 'armor' ? null : st.body);
        if (f) hover = { kind: 'face', body: f.body, id: f.id };
      } else if (mode === 'vertex') {
        const v = pickVertex(this.design, st.body, this.view, px, py);
        if (v != null) hover = { kind: 'vertex', body: st.body, id: v };
      } else if (mode === 'edge') {
        const e = pickEdge(this.design, st.body, this.view, px, py);
        if (e) hover = { kind: 'edge', body: st.body, key: e[0] < e[1] ? e[0] + ',' + e[1] : e[1] + ',' + e[0] };
      }
    }
    if (JSON.stringify(hover) !== JSON.stringify(st.hover)) {
      st.hover = hover;
      this.redraw();
    }
    if (st.step === 'analysis' || st.step === 'armor') this._probe(px, py, ray);
    else this.tip.hidden = true;
  }

  /** Hover readout: thickness, material, plate angle, LOS thickness along this view, face mass. */
  _probe(px, py, ray) {
    const f = pickFace(this.design, ray.o, ray.d);
    const tip = this.tip;
    if (!f || !this.report) {
      tip.hidden = true;
      return;
    }
    const mesh = this.doc.mesh(f.body);
    const face = M.findFace(mesh, f.id);
    const armor = this.doc.armor(f.body, f.id);
    const stack = this.doc.stack(f.body, f.id);
    const rep = this.report.armor_faces.find((a) => a.body === f.body && a.id === f.id);
    const t = thicknessAt(mesh, face, armor, f.local);
    const n = M.faceNormal(mesh, face);
    const inc = Math.acos(Math.min(1, Math.abs(dot(ray.d, n)))) / DEG;
    let los = null;
    try {
      const pr = this.core.probe(ray.o, ray.d, 0);
      los = pr;
    } catch {
      los = null;
    }
    const mname = (id) => this.data.materials.find((m) => m.id === id)?.id.toUpperCase() || id;
    const zone = (rep?.tag || face.tag || '').replace(/_/g, ' ');
    const rows = [
      ['部位', `${f.body === 'hull' ? '車體' : '炮塔'} ${zone}`],
      ['厚度', `${t.toFixed(0)} mm${armor?.vertex_mm || armor?.map ? '（變厚度）' : ''}`],
      ['材質', `${mname(armor?.material)}${stack ? ` ＋ ${stack.layers.length} 層` : ''}`],
      ['傾角', `${(rep?.slope_deg ?? 0).toFixed(0)}°（自垂直）`],
      ['入射角', `${inc.toFixed(0)}°（此視角）`],
      ['視線厚度', los ? `${los.los_mm.toFixed(0)} mm（等效 RHA ${los.rha_mm.toFixed(0)} mm）` : '—'],
      ['質量', `${(rep?.mass_kg ?? 0).toFixed(0)} kg`],
    ];
    tip.textContent = '';
    for (const [k, v] of rows) tip.append(el('div', {}, el('span', { text: k }), el('b', { text: v })));
    const W = this.canvas.clientWidth;
    tip.style.left = Math.min(W - 230, px + 16) + 'px';
    tip.style.top = Math.max(8, py - 12) + 'px';
    tip.hidden = false;
  }

  // ---------------------------------------------------------------- interior dragging

  _boxRef(id) {
    if (id.startsWith('crew_')) {
      const idx = Number(id.split('_').pop());
      const c = this.design.crew_positions[idx];
      return c ? { get: () => c.position_m, set: (p) => (c.position_m = p), mount: c.mount } : null;
    }
    const m = this.design.internal_modules.find((x) => x.id === id);
    return m ? { get: () => m.center_m, set: (p) => (m.center_m = p), mount: m.mount } : null;
  }

  _boxCenter(id) {
    return this._boxRef(id)?.get().slice();
  }

  selectBox(id) {
    this.state.selectedBox = id;
    this.renderPanel();
    this.redraw();
  }

  _dragBox(d, px, py, vertical) {
    const ref = this._boxRef(d.id);
    if (!ref) return;
    const cam = this.view.camera();
    const off = bodyOffset(this.design, ref.mount);
    const start = add(d.start, off);
    const r0 = this.view.ray(d.x0, d.y0);
    const r1 = this.view.ray(px, py);
    let delta;
    if (vertical) {
      const k = (this.view.cam.dist * cam.tanY * 2) / this.canvas.clientHeight;
      delta = [0, -(py - d.y0) * k, 0];
    } else {
      // move on the horizontal plane through the box centre
      const hitPlane = (r) => {
        if (Math.abs(r.d[1]) < 1e-4) return null;
        const t = (start[1] - r.o[1]) / r.d[1];
        return t > 0 ? add(r.o, mul(r.d, t)) : null;
      };
      const a = hitPlane(r0);
      const b = hitPlane(r1);
      if (!a || !b) return;
      delta = sub(b, a);
    }
    if (!d.snap) {
      this.doc.snapshot();
      d.snap = true;
    }
    const p = add(d.start, delta).map((v) => Math.round(v * 100) / 100);
    ref.set(p);
    this.doc.emit('shape');
  }

  // ---------------------------------------------------------------- add-ons

  static ADDON_DEFAULTS = {
    plate: { label: '附加裝甲板', size: [1.0, 0.6], thickness: 30, standoff: 0, material: 'applied' },
    skirt: { label: '側裙', size: [2.6, 0.7], thickness: 8, standoff: 350, material: 'skirt' },
    spaced: { label: '間隙裝甲', size: [1.0, 0.6], thickness: 20, standoff: 150, material: 'spaced' },
    composite: { label: '複合裝甲模組', size: [0.8, 0.5], thickness: 80, standoff: 20, material: 'composite' },
    era: { label: '反應裝甲', size: [0.45, 0.28], thickness: 60, standoff: 10, material: 'era' },
  };

  /** Drops an add-on where the ray meets the vehicle, flat on that face. */
  placeAddon(kind, ray) {
    const f = pickFace(this.design, ray.o, ray.d);
    if (!f) return this.toast('點在戰車表面上放置', true);
    const mesh = this.doc.mesh(f.body);
    const face = M.findFace(mesh, f.id);
    const n = M.faceNormal(mesh, face);
    const { u } = M.faceFrame(n);
    const def = Bureau.ADDON_DEFAULTS[kind];
    const id = `${kind}_${Date.now().toString(36).slice(-4)}${Math.floor(Math.random() * 36).toString(36)}`;
    // skirts hang vertically beside the running gear, whatever the face
    const normal = kind === 'skirt' ? [Math.sign(n[0]) || 1, 0, 0] : n;
    const uAxis = kind === 'skirt' ? [0, 0, 1] : u;
    const anchor = kind === 'skirt' ? [Math.sign(n[0]) * (this.report?.running_gear?.envelope_max?.[0] ?? f.local[0]) - Math.sign(n[0]) * def.standoff / 1000, Math.max(0.55, f.local[1] - 0.15), f.local[2]] : f.local;
    const ad = { id, kind, body: f.body, face: f.id, anchor_m: anchor.map((v) => Math.round(v * 1000) / 1000), normal: normal.map((v) => Math.round(v * 10000) / 10000), u_axis: uAxis.map((v) => Math.round(v * 10000) / 10000), size_m: def.size.slice(), material: def.material, thickness_mm: def.thickness, standoff_mm: def.standoff };
    this.doc.change((d) => d.addons.push(ad), 'panel');
    this.state.selectedAddon = id;
    if (!this.placeMany) this.state.placing = null;
    this.renderPanel();
  }

  _dragAddon(d, px, py) {
    const a = this.design.addons.find((x) => x.id === d.id);
    if (!a) return;
    const ray = this.view.ray(px, py);
    const f = pickFace(this.design, ray.o, ray.d, a.body);
    if (!f) return;
    if (!d.snap) {
      this.doc.snapshot();
      d.snap = true;
    }
    if (a.kind === 'skirt') a.anchor_m = [a.anchor_m[0], Math.round(f.local[1] * 100) / 100, Math.round(f.local[2] * 100) / 100];
    else {
      const mesh = this.doc.mesh(a.body);
      const n = M.faceNormal(mesh, M.findFace(mesh, f.id));
      a.anchor_m = f.local.map((v) => Math.round(v * 1000) / 1000);
      a.normal = n.map((v) => Math.round(v * 10000) / 10000);
      a.u_axis = M.faceFrame(n).u.map((v) => Math.round(v * 10000) / 10000);
      a.face = f.id;
    }
    this.doc.emit('shape');
  }

  // ---------------------------------------------------------------- outward

  testFire() {
    if (!this.report?.battle_ready) {
      this.toast('設計還有錯誤：先修正（右下列表）才能進靶場', true);
      return;
    }
    this.suspend();
    this.opts.onTestFire?.(JSON.parse(JSON.stringify(this.design)));
  }

  drive() {
    if (!this.report?.battle_ready) {
      this.toast('設計還有錯誤：先修正才能試駕', true);
      return;
    }
    this.suspend();
    this.opts.onDrive?.(JSON.parse(JSON.stringify(this.design)));
  }
}

export { DrawList, COLORS };

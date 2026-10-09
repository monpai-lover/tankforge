// Workshop: the in-page vehicle builder. Edits a compact "build" (base hull + turret specs);
// every change is converted to ordinary vehicle data by loadout.js and rebuilt live in the 3D view.
import { MAX_TURRETS, MAX_GUNS_PER_TURRET, newTurretSpec } from './loadout.js';
import { workshopWeapons, workshopSights, workshopPresets } from './workshopCatalog.js';
import { normalizeWorkshopBuild } from './workshopBuild.js';

const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
};

export class Workshop {
  /**
   * opts: {data, getBuild(), apply(build) -> stats, exportText() -> string, close()}
   * stats = {mass, hpPerTon, guns, salvoMomentum, reloads: [[seconds per gun] per turret], traverse: [deg/s per turret]}
   */
  constructor(root, opts) {
    this.root = root;
    this.opts = opts;
    this.readouts = [];
    this.weapons = workshopWeapons(opts.data);
    this.sights = workshopSights(opts.data);
    this.presets = workshopPresets(opts.data);
    this.message = '';
  }

  open() {
    this.root.hidden = false;
    this.render();
  }

  close() {
    this.root.hidden = true;
  }

  _changed(structural) {
    const focus = document.activeElement?.id;
    const stats = this.opts.apply(this.opts.getBuild());
    this._message('');
    if (structural) this.render(stats);
    else this._refresh(stats);
    if (structural && focus) this.root.querySelector(`#${focus}`)?.focus();
  }

  _message(text, error = false) {
    this.message = text;
    this.messageError = error;
    const status = this.root.querySelector('#ws-export-status');
    if (status) { status.textContent = text; status.dataset.error = error ? '1' : '0'; }
  }

  _useBuild(value, message) {
    const next = normalizeWorkshopBuild(value, this.opts.data);
    const stats = this.opts.apply(next);
    this.render(stats);
    this._message(message);
  }

  _slider(id, label, min, max, step, value, unit, set) {
    const out = el('output', { for: id, text: `${value}${unit}` });
    const input = el('input', {
      type: 'range',
      id,
      min,
      max,
      step,
      value,
      oninput: (e) => {
        const v = Number(e.target.value);
        out.textContent = `${v}${unit}`;
        set(v);
        this._changed(false);
      },
    });
    return el('div', { class: 'ws-field' }, el('label', { for: id, text: label }), input, out);
  }

  _select(id, label, options, value, set, structural = false) {
    const sel = el('select', {
      id,
      onchange: (e) => {
        set(e.target.value);
        this._changed(structural);
      },
    });
    for (const [v, text] of options) {
      const o = el('option', { value: v, text });
      if (String(v) === String(value)) o.selected = true;
      sel.append(o);
    }
    return el('div', { class: 'ws-field' }, el('label', { for: id, text: label }), sel);
  }

  render(stats) {
    const build = this.opts.getBuild();
    const data = this.opts.data;
    stats = stats || this.opts.apply(build);
    const body = this.root.querySelector('#ws-body');
    body.textContent = '';
    this.readouts = [];
    const hull = data.vehicles[build.base].vehicle.hull;
    const L = hull.size_m[2];
    const W = hull.size_m[0];

    const practical = el('div', { class: 'ws-row' }, el('span', { class: 'lbl', text: '實用預設' }));
    const creative = el('div', { class: 'ws-row' }, el('span', { class: 'lbl', text: '創意預設' }));
    for (const p of this.presets) {
      (['hexa', 'twin', 'porcupine'].includes(p.id) ? creative : practical).append(
        el('button', {
          type: 'button',
          id: 'ws-preset-' + p.id,
          class: 'ws-btn',
          text: p.label,
          onclick: () => {
            this._useBuild(p.build, '已套用：' + p.label);
          },
        }),
      );
    }
    body.append(practical, creative, el('p', { class: 'ws-note', text: '預設使用現有武器資料生成新炮座；可保留原武器，再加裝新炮塔。' }));

    const baseSel = el('select', {
      id: 'ws-base',
      onchange: (e) => {
        build.base = e.target.value;
        const [w, , l] = data.vehicles[build.base].vehicle.hull.size_m;
        for (const t of build.turrets) { t.x = Math.max(-w / 2, Math.min(w / 2, t.x)); t.z = Math.max(-l / 2, Math.min(l / 2, t.z)); }
        this._changed(true);
      },
    });
    for (const id of data.order) {
      const o = el('option', { value: id, text: data.vehicles[id].vehicle.name });
      if (id === build.base) o.selected = true;
      baseSel.append(o);
    }
    const keep = el('input', {
      type: 'checkbox',
      id: 'ws-keep',
      onchange: (e) => {
        build.keepStock = e.target.checked;
        if (!build.turrets.length) build.keepStock = true;
        this._changed(true);
      },
    });
    keep.checked = !!build.keepStock;
    keep.disabled = !build.turrets.length;
    body.append(el('div', { class: 'ws-field' }, el('label', { for: 'ws-base', text: '底盤' }), baseSel), el('div', { class: 'ws-check' }, keep, el('label', { for: 'ws-keep', text: '保留原武器／炮塔' })));

    build.turrets.forEach((t, ti) => {
      const card = el('fieldset', { class: 'ws-card' });
      const info = el('span', { class: 'ws-info' });
      card.append(
        el(
          'legend',
          {},
          el('span', { text: `炮塔 ${ti + 1}` }),
          el('button', {
            type: 'button',
            id: `ws-t${ti}-del`,
            class: 'ws-x',
            text: '移除',
            onclick: () => {
              build.turrets.splice(ti, 1);
              if (!build.turrets.length) build.keepStock = true;
              this._changed(true);
            },
          }),
        ),
      );
      const p = `ws-t${ti}-`;
      card.append(
        this._slider(p + 'z', '前後', -Math.floor(L * 10) / 20, Math.floor(L * 10) / 20, 0.05, t.z, ' m', (v) => (t.z = v)),
        this._slider(p + 'x', '左右', -Math.floor(W * 10) / 20, Math.floor(W * 10) / 20, 0.05, t.x, ' m', (v) => (t.x = v)),
        this._slider(p + 'lift', '加高', 0, 1.5, 0.05, t.lift, ' m', (v) => (t.lift = v)),
        this._slider(p + 'ring', '炮塔環', 0.8, 2.4, 0.05, t.ring, ' m', (v) => (t.ring = v)),
        this._slider(p + 'facing', '朝向', -180, 180, 5, t.facing, '°', (v) => (t.facing = v)),
        this._select(p + 'roof', '型式', [['closed', '封閉式炮塔'], ['open', '開放式（無頂，看得到乘員）']], t.open ? 'open' : 'closed', (v) => (t.open = v === 'open'), true),
        this._select(p + 'arc', '射界', [[360, '360°'], [240, '240°'], [120, '120°']], t.arc, (v) => (t.arc = Number(v))),
        this._select(p + 'loaders', '裝填手', [[0, '無（炮手自己裝）'], [1, '1 人'], [2, '2 人'], [3, '3 人']], t.loaders, (v) => (t.loaders = Number(v))),
        this._select(p + 'rack', '彈藥架', [['ready', '炮塔內待發彈架（最近）'], ['hull_side', '車體側面'], ['hull_floor', '車體底板（最遠）']], t.rack, (v) => (t.rack = v)),
        this._select(p + 'sight', '瞄具', [['', '通用直瞄鏡（3×／6×）'], ...this.sights.map(s => [s.id, s.label])], t.sightSource || '', v => { if (v) t.sightSource = v; else delete t.sightSource; }, true),
        this._select(p + 'stabilizer', '穩定器', [['none', '無'], ['vertical', '垂直穩定'], ['both', '雙向穩定']], t.stabilizer || 'none', v => t.stabilizer = v),
      );
      const sight = this.sights.find(s => s.id === t.sightSource)?.sight;
      card.append(el('p', { class: 'ws-note', text: sight ? sight.levels.map(l => `${l.magnification}×／視場 ${l.fov_deg}°`).join(' · ') : '3×／視場 16° · 6×／視場 8°' }));
      t.guns.forEach((g, gi) => {
        const gp = `${p}g${gi}-`;
        const row = el('div', { class: 'ws-gun' });
        const ginfo = el('span', { class: 'ws-info' });
        row.append(
          el(
            'div',
            { class: 'ws-gun-head' },
            el('span', { text: `火炮 ${gi + 1}` }),
            ginfo,
            el('button', {
              type: 'button',
              id: gp + 'del',
              class: 'ws-x',
              text: '移除',
              onclick: () => {
                if (t.guns.length > 1) t.guns.splice(gi, 1);
                this._changed(true);
              },
            }),
          ),
          this._select(gp + 'weapon', '武器', [['custom', '設計火炮（口徑／倍徑）'], ...this.weapons.map(w => [w.id, w.label])], g.weapon || 'custom', v => {
            g.weapon = v;
            if (v === 'custom') { g.cal = g.cal || 75; g.len = g.len || 48; }
            else { delete g.cal; delete g.len; }
          }, true),
        );
        row.querySelector(`#${gp}del`).disabled = t.guns.length === 1;
        const source = this.weapons.find(w => w.id === g.weapon);
        if (!source) row.append(
          this._slider(gp + 'cal', '口徑', 20, 183, 1, g.cal ?? 75, ' mm', v => g.cal = v),
          this._slider(gp + 'len', '倍徑', 20, 80, 1, g.len ?? 48, '', v => g.len = v),
        );
        else {
          const gun = source.gun;
          const cycle = gun.missile ? `${gun.launcher?.muzzle_vectors_m?.length || 1} 管 · 再裝填 ${gun.reload_s} s` : gun.autocannon ? `${gun.autocannon.rate_rpm} 發／分 · 彈鏈 ${gun.autocannon.belt_rounds} 發 · 換鏈 ${gun.autocannon.belt_reload_s} s` : `沿用原始裝填 ${gun.reload_s} s`;
          row.append(el('p', { class: 'ws-note', text: `${gun.caliber_mm} mm · ${cycle} · 後座 ${gun.recoil_mm} mm` }),
            el('p', { class: 'ws-note', text: '彈種：' + source.shells.map(s => s.name || s.id).join('、') }));
          if (source.missile) row.append(el('p', { class: 'ws-note', text: `${source.missile.name} · 最大過載 ${source.missile.max_g.toFixed(1)} G · 射程 ${source.missile.min_range_m}–${source.missile.max_range_m} m` }));
        }
        card.append(row);
        this.readouts.push({ kind: 'gun', ti, gi, node: ginfo });
      });
      if (t.guns.length < MAX_GUNS_PER_TURRET) {
        card.append(
          el('button', {
            type: 'button',
            id: p + 'addgun',
            class: 'ws-btn',
            text: '＋ 火炮',
            onclick: () => {
              t.guns.push(structuredClone(t.guns[t.guns.length - 1]));
              this._changed(true);
            },
          }),
        );
      }
      card.append(info);
      this.readouts.push({ kind: 'turret', ti, node: info });
      body.append(card);
    });

    if (build.turrets.length < MAX_TURRETS) {
      body.append(
        el('button', {
          type: 'button',
          id: 'ws-addturret',
          class: 'ws-btn ws-wide',
          text: '＋ 炮塔',
          onclick: () => {
            build.turrets.push(newTurretSpec(0));
            this._changed(true);
          },
        }),
      );
    }

    this.summary = el('div', { class: 'ws-summary', id: 'ws-summary' });
    body.append(this.summary);

    const exportBox = el('textarea', { id: 'ws-export', readonly: '', rows: '4', 'aria-label': '匯出的載具資料' });
    const status = el('span', { class: 'ws-info', id: 'ws-export-status', role: 'status', 'aria-live': 'polite', text: this.message, 'data-error': this.messageError ? '1' : '0' });
    body.append(
      el(
        'details',
        { class: 'ws-export' },
        el('summary', { text: '匯出／匯入資料' }),
        el('p', { class: 'ws-note', text: '資料包包含工坊設定、載具文件、彈藥與所需模型；可貼回下方繼續編輯。安裝載具時須把 files 內文件及共享彈藥／導彈定義放到相應資料目錄。' }),
        el(
          'div',
          { class: 'ws-row' },
          el('button', {
            type: 'button',
            id: 'ws-export-btn',
            class: 'ws-btn',
            text: '產生匯出資料',
            onclick: () => {
              try {
                exportBox.value = this.opts.exportText();
                this._message(`已產生 ${(exportBox.value.length / 1024).toFixed(0)} KB`);
              } catch (err) { this._message('匯出失敗：' + err.message, true); }
            },
          }),
          el('button', {
            type: 'button',
            id: 'ws-copy-btn',
            class: 'ws-btn',
            text: '複製',
            onclick: async () => {
              try {
                if (!exportBox.value) exportBox.value = this.opts.exportText();
                await navigator.clipboard.writeText(exportBox.value);
                this._message('已複製');
              } catch {
                exportBox.select();
                this._message('已選取，請按 Ctrl+C');
              }
            },
          }),
          status,
        ),
        exportBox,
        el('label', { for: 'ws-import', class: 'ws-note', text: '貼上舊工坊設定或完整匯出資料包：' }),
        el('textarea', { id: 'ws-import', rows: '3', 'aria-label': '待匯入的工坊資料' }),
        el('button', {
          type: 'button',
          id: 'ws-import-btn',
          class: 'ws-btn',
          text: '匯入',
          onclick: () => {
            const box = this.root.querySelector('#ws-import');
            try {
              this._useBuild(JSON.parse(box.value), '已匯入工坊設定');
            } catch (err) {
              this._message('匯入失敗：' + err.message, true);
            }
          },
        }),
      ),
    );
    this._refresh(stats);
  }

  _refresh(stats) {
    if (!stats) return;
    for (const r of this.readouts) {
      if (r.kind === 'gun') {
        const t = stats.reloads[r.ti];
        r.node.textContent = t && t[r.gi] != null ? `裝填 ${t[r.gi].toFixed(1)} s` : '';
      } else {
        const tr = stats.traverse[r.ti];
        r.node.textContent = tr != null ? `迴轉 ${tr}°/s　重 ${(stats.turretMass[r.ti] / 1000).toFixed(1)} t` : '';
      }
    }
    const kick = stats.salvoMomentum / stats.mass;
    this.summary.textContent = `全重 ${(stats.mass / 1000).toFixed(1)} t　${stats.hpPerTon.toFixed(1)} hp/t　武器 ${stats.guns} 門　保留原炮座 ${stats.stockTurrets || 0} 個　新增武器理論齊射後座 ${kick.toFixed(2)} m/s`;
    this.summary.dataset.heavy = stats.hpPerTon < 8 ? '1' : '0';
  }
}

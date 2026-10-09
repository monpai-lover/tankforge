// Workshop: the in-page vehicle builder. Edits a compact "build" (base hull + turret specs);
// every change is converted to ordinary vehicle data by loadout.js and rebuilt live in the 3D view.
import { PRESETS, MAX_TURRETS, MAX_GUNS_PER_TURRET, newTurretSpec } from './loadout.js';

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
  }

  open() {
    this.root.hidden = false;
    this.render();
  }

  close() {
    this.root.hidden = true;
  }

  _changed(structural) {
    const stats = this.opts.apply(this.opts.getBuild());
    if (structural) this.render(stats);
    else this._refresh(stats);
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

  _select(id, label, options, value, set) {
    const sel = el('select', {
      id,
      onchange: (e) => {
        set(e.target.value);
        this._changed(false);
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

    const presets = el('div', { class: 'ws-row' }, el('span', { class: 'lbl', text: '範例' }));
    for (const [key, p] of Object.entries(PRESETS)) {
      presets.append(
        el('button', {
          type: 'button',
          id: 'ws-preset-' + key,
          class: 'ws-btn',
          text: p.label,
          onclick: () => {
            Object.assign(build, JSON.parse(JSON.stringify(p.build)));
            this._changed(true);
          },
        }),
      );
    }
    body.append(presets);

    const baseSel = el('select', {
      id: 'ws-base',
      onchange: (e) => {
        build.base = e.target.value;
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
        this._changed(true);
      },
    });
    keep.checked = !!build.keepStock;
    body.append(el('div', { class: 'ws-field' }, el('label', { for: 'ws-base', text: '車體' }), baseSel), el('div', { class: 'ws-check' }, keep, el('label', { for: 'ws-keep', text: '保留原廠炮塔' })));

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
              this._changed(true);
            },
          }),
        ),
      );
      const p = `ws-t${ti}-`;
      card.append(
        this._slider(p + 'z', '前後', -(L / 2 - 0.9).toFixed(1), (L / 2 - 0.9).toFixed(1), 0.05, t.z, ' m', (v) => (t.z = v)),
        this._slider(p + 'x', '左右', -(W / 2 - 0.6).toFixed(1), (W / 2 - 0.6).toFixed(1), 0.05, t.x, ' m', (v) => (t.x = v)),
        this._slider(p + 'lift', '加高', 0, 1.5, 0.05, t.lift, ' m', (v) => (t.lift = v)),
        this._slider(p + 'ring', '炮塔環', 0.8, 2.4, 0.05, t.ring, ' m', (v) => (t.ring = v)),
        this._slider(p + 'facing', '朝向', -180, 180, 5, t.facing, '°', (v) => (t.facing = v)),
        this._select(p + 'roof', '型式', [['closed', '封閉式炮塔'], ['open', '開放式（無頂，看得到乘員）']], t.open ? 'open' : 'closed', (v) => (t.open = v === 'open')),
        this._select(p + 'arc', '射界', [[360, '360°'], [240, '240°'], [120, '120°']], t.arc, (v) => (t.arc = Number(v))),
        this._select(p + 'loaders', '裝填手', [[0, '無（炮手自己裝）'], [1, '1 人'], [2, '2 人'], [3, '3 人']], t.loaders, (v) => (t.loaders = Number(v))),
        this._select(p + 'rack', '彈藥架', [['ready', '炮塔內待發彈架（最近）'], ['hull_side', '車體側面'], ['hull_floor', '車體底板（最遠）']], t.rack, (v) => (t.rack = v)),
      );
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
          this._slider(gp + 'cal', '口徑', 20, 183, 1, g.cal, ' mm', (v) => (g.cal = v)),
          this._slider(gp + 'len', '倍徑', 20, 80, 1, g.len, '', (v) => (g.len = v)),
        );
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
              t.guns.push({ ...t.guns[t.guns.length - 1] });
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
    const status = el('span', { class: 'ws-info', id: 'ws-export-status' });
    body.append(
      el(
        'details',
        { class: 'ws-export' },
        el('summary', { text: '匯出／匯入資料' }),
        el('p', { class: 'ws-note', text: '匯出內容就是專案的載具資料夾格式（vehicle.json、weapons.json…），可直接放進 data/vehicles/。' }),
        el(
          'div',
          { class: 'ws-row' },
          el('button', {
            type: 'button',
            id: 'ws-export-btn',
            class: 'ws-btn',
            text: '產生匯出資料',
            onclick: () => {
              exportBox.value = this.opts.exportText();
              status.textContent = `${(exportBox.value.length / 1024).toFixed(0)} KB`;
            },
          }),
          el('button', {
            type: 'button',
            id: 'ws-copy-btn',
            class: 'ws-btn',
            text: '複製',
            onclick: async () => {
              if (!exportBox.value) exportBox.value = this.opts.exportText();
              try {
                await navigator.clipboard.writeText(exportBox.value);
                status.textContent = '已複製';
              } catch {
                exportBox.select();
                status.textContent = '已選取，請按 Ctrl+C';
              }
            },
          }),
          status,
        ),
        exportBox,
        el('label', { for: 'ws-import', class: 'ws-note', text: '貼上工坊設定（build JSON）後按匯入：' }),
        el('textarea', { id: 'ws-import', rows: '3' }),
        el('button', {
          type: 'button',
          id: 'ws-import-btn',
          class: 'ws-btn',
          text: '匯入',
          onclick: () => {
            const box = this.root.querySelector('#ws-import');
            try {
              const b = JSON.parse(box.value);
              if (!data.vehicles[b.base] || !Array.isArray(b.turrets)) throw new Error('缺少 base 或 turrets');
              Object.assign(build, { base: b.base, keepStock: !!b.keepStock, turrets: b.turrets });
              this._changed(true);
            } catch (err) {
              status.textContent = '匯入失敗：' + err.message;
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
    this.summary.textContent = `全重 ${(stats.mass / 1000).toFixed(1)} t　${stats.hpPerTon.toFixed(1)} hp/t　火炮 ${stats.guns} 門　齊射後座讓車體退 ${kick.toFixed(2)} m/s`;
    this.summary.dataset.heavy = stats.hpPerTon < 8 ? '1' : '0';
  }
}

// Physics debug view (F3): what the tank model is doing, drawn over the picture so nothing has to
// be guessed. Layers can be switched on and off; the panel also holds a cruise control for the
// suspension test speeds and jumps to the test course lanes.
import { add, scale, len } from '../sim/tank/math3.js';

export const LAYERS = [
  ['com', '重心'],
  ['rays', '懸掛射線'],
  ['wheels', '負重輪接地'],
  ['contacts', '履帶接觸點'],
  ['normals', '地面法線'],
  ['susp', '懸掛力'],
  ['track', '履帶力'],
  ['vel', '速度'],
  ['ang', '角速度'],
  ['table', '各輪數值'],
];

export class PhysDebug {
  constructor(root, actions) {
    this.root = root;
    this.on = false;
    this.layers = Object.fromEntries(LAYERS.map(([k]) => [k, k !== 'normals']));
    this.cruise = null; // km/h held by the cruise control, or null
    this.actions = actions;
    this._build();
  }

  _build() {
    const r = this.root;
    r.textContent = '';
    const el = (tag, props = {}, ...kids) => {
      const e = document.createElement(tag);
      for (const [k, v] of Object.entries(props)) {
        if (k === 'text') e.textContent = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v);
      }
      e.append(...kids);
      return e;
    };
    r.append(el('h3', { text: '物理除錯（F3）' }));
    const grid = el('div', { class: 'pd-layers' });
    for (const [k, label] of LAYERS) {
      const cb = el('input', { type: 'checkbox', id: 'pd-' + k });
      cb.checked = this.layers[k];
      cb.addEventListener('change', () => (this.layers[k] = cb.checked));
      grid.append(el('label', { for: 'pd-' + k }, cb, document.createTextNode(label)));
    }
    r.append(grid);
    r.append(el('h4', { text: '定速（懸吊驗收）' }));
    const speeds = el('div', { class: 'pd-row' });
    for (const v of [5, 15, 30, 'max']) {
      speeds.append(el('button', { type: 'button', class: 'pd-btn', id: 'pd-cruise-' + v, text: v === 'max' ? '最高速' : `${v} km/h`, onclick: (e) => {
        this.cruise = this.cruise === v ? null : v;
        e.currentTarget.blur();
        this._sync();
      } }));
    }
    r.append(speeds);
    r.append(el('h4', { text: '懸吊測試場' }));
    const lanes = el('div', { class: 'pd-row' });
    (this.actions.lanes || []).forEach((l, i) =>
      lanes.append(el('button', { type: 'button', class: 'pd-btn', id: 'pd-lane-' + i, text: l.label, onclick: (e) => {
        e.currentTarget.blur();
        this.actions.goLane(i);
      } })),
    );
    r.append(lanes);
    r.append(el('div', { class: 'pd-row' }, el('button', { type: 'button', class: 'pd-btn', id: 'pd-clear', text: '清除車轍', onclick: (e) => {
      e.currentTarget.blur();
      this.actions.clearRuts();
    } })));
    this.readout = el('pre', { class: 'pd-readout' });
    r.append(this.readout);
    this._sync();
  }

  _sync() {
    this.root.hidden = !this.on;
    document.body.dataset.physdebug = this.on ? '1' : '0';
    for (const b of this.root.querySelectorAll('[id^="pd-cruise-"]')) b.setAttribute('aria-pressed', String(b.id === 'pd-cruise-' + this.cruise));
  }

  toggle(on = !this.on) {
    this.on = on;
    if (!on) this.cruise = null;
    this._sync();
  }

  /** Throttle that holds the cruise speed (a simple driver), or null when off. */
  cruiseThrottle(u, vTop) {
    if (this.cruise == null) return null;
    if (this.cruise === 'max') return 1;
    const v = this.cruise / 3.6;
    return Math.max(-0.2, Math.min(1, v / vTop + (v - u) * 1.5));
  }

  /**
   * Draws the enabled layers. g: 2D context; project(p) -> {x, y, ok}; veh: VehicleSim; s: px scale.
   */
  draw(g, project, veh, s = 1) {
    // (the suspension layers are drawn for tracked vehicles; an armoured car has none of them)
    if (!this.on || !veh || veh.wheeled) return;
    const L = this.layers;
    const b = veh.body;
    const t = veh.t;
    const sp = veh.tm.sp;
    const mass = veh.tm.mass;
    const fScale = 1.0 / ((mass * 9.81) / sp.stations.length); // one wheel's static load is drawn 1 m long
    const line = (a, c, color, w = 2) => {
      const p = project(a);
      const q = project(c);
      if (!p.ok || !q.ok) return;
      g.strokeStyle = color;
      g.lineWidth = w * s;
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(q.x, q.y);
      g.stroke();
    };
    const arrow = (a, v, color, w = 2) => {
      const c = add(a, v);
      line(a, c, color, w);
      const p = project(a);
      const q = project(c);
      if (!p.ok || !q.ok) return;
      const ang = Math.atan2(q.y - p.y, q.x - p.x);
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(q.x, q.y);
      g.lineTo(q.x - 9 * s * Math.cos(ang - 0.4), q.y - 9 * s * Math.sin(ang - 0.4));
      g.lineTo(q.x - 9 * s * Math.cos(ang + 0.4), q.y - 9 * s * Math.sin(ang + 0.4));
      g.fill();
    };
    const dot = (a, r, color) => {
      const p = project(a);
      if (!p.ok) return;
      g.fillStyle = color;
      g.beginPath();
      g.arc(p.x, p.y, r * s, 0, Math.PI * 2);
      g.fill();
    };
    g.save();
    if (L.rays || L.wheels || L.susp) {
      sp.units.forEach((u, ui) => {
        const mount = b.worldPoint(u.mount);
        for (const i of u.members) {
          const st = sp.stations[i];
          const top = b.worldPoint([st.x, st.y + sp.travel + st.r, st.z]);
          const c = t.ss.contact[i];
          if (L.rays) line(top, c, t.ss.grounded[i] ? 'rgba(120,200,255,0.9)' : 'rgba(255,120,90,0.9)', 1.5);
          if (L.wheels) dot(c, 4, t.ss.grounded[i] ? '#6fe08a' : '#ff6a4a');
        }
        if (L.susp && t.ss.force[ui] > 0) arrow(mount, scale(b.ey, (t.ss.force[ui] / u.members.length) * fScale), '#ffd54a', 3);
      });
    }
    const nScale = fScale;
    for (const c of t.contacts) {
      if (L.contacts) dot(c.p, 2 + Math.min(5, (c.N / (mass * 9.81)) * 40), c.side ? '#7fd6ff' : '#ff9f40');
      if (L.normals) arrow(c.p, scale(c.n, 0.6), 'rgba(255,255,255,0.8)', 1);
      if (L.track && c.tl) arrow(c.p, add(scale(c.tl, (c.fl || 0) * nScale), scale(c.tt, (c.ft || 0) * nScale)), '#ff5ad1', 2);
    }
    const com = b.pos;
    if (L.com) {
      dot(com, 7, '#ffffff');
      dot(com, 4, '#ff3b3b');
    }
    if (L.vel && len(b.v) > 0.05) arrow(com, scale(b.v, 0.5), '#9cff6a', 3);
    if (L.ang && len(b.w) > 0.01) arrow(com, scale(b.w, 6), '#c58cff', 3);
    g.restore();

    if (L.table) {
      const per = sp.stations.length / 2;
      const rows = [];
      const kN = (x) => (x / 1000).toFixed(0).padStart(4);
      rows.push('輪   負載t  壓縮%  彈簧kN 阻尼kN 接地');
      sp.units.forEach((u, ui) => {
        for (const i of u.members) {
          const side = i < per ? 'R' : 'L';
          const comp = ((t.ss.comp[i] + sp.rebound) / (sp.travel + sp.rebound)) * 100;
          rows.push(`${side}${(i % per) + 1}`.padEnd(5) + `${(t.ss.load[i] / 9810).toFixed(1).padStart(5)} ${comp.toFixed(0).padStart(6)} ${kN(t.ss.spring[ui] / u.members.length)} ${kN(t.ss.damper[ui] / u.members.length)}   ${t.ss.grounded[i] ? '●' : '○'}`);
        }
      });
      const a = b.attitude();
      rows.push('');
      rows.push(`速度 ${(t.info.u * 3.6).toFixed(1)} km/h  側滑 ${t.info.w.toFixed(2)} m/s  偏航 ${t.info.yawRateDeg.toFixed(1)}°/s`);
      rows.push(`俯仰 ${(a.pitch * 57.3).toFixed(1)}°  側傾 ${(a.roll * 57.3).toFixed(1)}°  角速度 ${(len(b.w) * 57.3).toFixed(1)}°/s`);
      rows.push(`履帶速度 左 ${t.ds.belts[-1].v.toFixed(2)}  右 ${t.ds.belts[1].v.toFixed(2)} m/s  打滑 ${(t.info.trackSlip * 100).toFixed(0)}%`);
      rows.push(`引擎 ${t.ds.rpm.toFixed(0)} rpm  檔 ${t.ds.gear + 1}  驅動 ${kN(t.ds.drive[-1])}/${kN(t.ds.drive[1])} kN`);
      this.readout.textContent = rows.join('\n');
    }
  }
}

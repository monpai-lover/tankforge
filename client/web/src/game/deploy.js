// The deploy screen of an online battle (after War Thunder's): the battle is entered first, then
// every player chooses a vehicle from the line-up along the bottom, sets how many rounds of each
// type it carries, picks one of the team's spawn points on the map and presses 加入戰鬥. It comes
// back after every death, so each life can be a different vehicle with a different load.
//
// The ammunition choice is kept per vehicle (localStorage, best effort) and is what the vehicle
// carries offline too: see applyAmmo().
import { shellIcon, shellKind, shellTypeLabel } from './shellicons.js';
import { penAt } from './hud.js';
import { syncGunShell, refillLauncher } from './loadout.js';

const STORE = 'tankforge.ammo.v1';
const CLASS_NAME = { light: '輕型坦克', medium: '中型坦克', heavy: '重型坦克', tank_destroyer: '坦克殲擊車', td: '坦克殲擊車', prototype: '原型車', armoured_car: '裝甲車', armored_car: '裝甲車', spaa: '防空車', custom: '自訂' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Saved ammunition loads: vehicle id -> { "turret.gun": [rounds of each type] }. */
export function loadAmmoConfig() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
export function saveAmmoConfig(cfg) {
  try {
    localStorage.setItem(STORE, JSON.stringify(cfg));
  } catch {
    /* private window: the choice lasts for this visit only */
  }
}

/** Every gun of a loadout with its ammunition types and how many rounds its racks hold. */
export function gunsOf(loadout) {
  const out = [];
  loadout.turrets.forEach((t, ti) =>
    t.guns.forEach((g, gi) => {
      const cap = g.capacity ?? g.ammo.reduce((s, a) => s + a.max, 0);
      out.push({ key: `${ti}.${gi}`, ti, gi, gun: g, cap, defaults: g.defaults ?? g.ammo.map((a) => a.max) });
    }),
  );
  return out;
}

/** A load that fits the racks: whole rounds, none negative, no more than the capacity. */
function fit(counts, cap, n) {
  const c = Array.from({ length: n }, (_, i) => Math.max(0, Math.round(Number(counts?.[i]) || 0)));
  let over = c.reduce((s, x) => s + x, 0) - cap;
  for (let i = n - 1; i >= 0 && over > 0; i--) {
    const k = Math.min(c[i], over);
    c[i] -= k;
    over -= k;
  }
  return c;
}

/**
 * Loads a vehicle's guns as the saved choice says (racks full of the default mix when there is
 * none): rounds of each type, the first type left in the breech.
 */
export function applyAmmo(loadout, cfg) {
  const mine = cfg?.[loadout.id];
  for (const { key, gun: g, cap, defaults } of gunsOf(loadout)) {
    g.capacity = cap;
    g.defaults = defaults;
    const counts = mine && Array.isArray(mine[key]) ? fit(mine[key], cap, g.ammo.length) : defaults;
    g.ammo.forEach((a, i) => {
      a.count = counts[i];
      a.max = counts[i];
    });
    const first = g.ammo.findIndex((a) => a.count > 0);
    g.loaded = first;
    g.selected = Math.max(0, first);
    syncGunShell(g);
    refillLauncher(g);
  }
}

export class DeployScreen {
  /**
   * el: the overlay; o: {
   *   lineup(): [{id, name, nation, kind, thumb (canvas|null), usable}],
   *   loadoutOf(id): a fresh loadout of the vehicle (for its guns and rounds),
   *   map(): {name, mode, picture (canvas|null), x0, z0, size, spawns: [{x,z,heading}], team, points, tickets, others: [{x,z,friend,alive}]},
   *   members(): [{name, team, vehicle, kills, deaths, alive, me}],
   *   vehicleName(id), deploy(id, spawn), chat(text), leave()
   * }
   */
  constructor(el, o) {
    this.el = el;
    this.o = o;
    this.visible = false;
    this.cfg = o.cfg || loadAmmoConfig();
    this.vehicle = null;
    this.spawn = 0;
    this.readyAt = 0;
    this.chatLines = [];
    el.addEventListener('click', (e) => this.click(e));
    el.addEventListener('input', (e) => this.input(e));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'dp-chat-in') {
        this.sendChat();
        e.preventDefault();
      }
      // keys typed here are not the tank's
      e.stopPropagation();
    });
  }

  /** Opens the screen; `wait`: seconds before 加入戰鬥 may be pressed. */
  open({ title = '選擇出戰載具', wait = 0, vehicle = null, spawn = null } = {}) {
    this.title = title;
    this.readyAt = performance.now() + wait * 1000;
    const usable = this.o.lineup().filter((v) => v.usable);
    if (vehicle && usable.some((v) => v.id === vehicle)) this.vehicle = vehicle;
    if (!this.vehicle || !usable.some((v) => v.id === this.vehicle)) this.vehicle = usable[0]?.id || null;
    if (spawn != null) this.spawn = spawn;
    this.visible = true;
    this.el.hidden = false;
    this.render();
  }

  close() {
    this.visible = false;
    this.el.hidden = true;
  }

  addChat(line) {
    this.chatLines.push(line);
    if (this.chatLines.length > 40) this.chatLines.shift();
    if (this.visible) this.renderChat();
  }

  sendChat() {
    const i = this.el.querySelector('#dp-chat-in');
    if (i && i.value.trim()) this.o.chat(i.value);
    if (i) i.value = '';
  }

  /** The rounds the chosen vehicle will carry, per gun (saved choice or the racks' default mix). */
  counts(lo) {
    const mine = this.cfg[lo.id] || {};
    return gunsOf(lo).map((g) => ({ ...g, counts: Array.isArray(mine[g.key]) ? fit(mine[g.key], g.cap, g.gun.ammo.length) : g.defaults.slice() }));
  }

  setCount(key, i, n) {
    const lo = this.loadout();
    const gs = this.counts(lo);
    const g = gs.find((x) => x.key === key);
    if (!g) return;
    const others = g.counts.reduce((s, x, j) => (j === i ? s : s + x), 0);
    g.counts[i] = Math.max(0, Math.min(g.cap - others, Math.round(n)));
    this.cfg[lo.id] = Object.fromEntries(gs.map((x) => [x.key, x.counts]));
    saveAmmoConfig(this.cfg);
  }

  loadout() {
    if (!this._lo || this._lo.id !== this.vehicle) this._lo = this.o.loadoutOf(this.vehicle);
    return this._lo;
  }

  click(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'veh') {
      this.vehicle = b.dataset.id;
      this.render();
    } else if (act === 'spawn') {
      this.spawn = Number(b.dataset.i);
      this.render();
    } else if (act === 'inc' || act === 'dec') {
      const lo = this.loadout();
      const g = this.counts(lo).find((x) => x.key === b.dataset.key);
      const i = Number(b.dataset.i);
      const step = e.shiftKey ? 10 : 1;
      this.setCount(b.dataset.key, i, g.counts[i] + (act === 'inc' ? step : -step));
      this.renderAmmo();
    } else if (act === 'preset') {
      const lo = this.loadout();
      const gs = this.counts(lo);
      for (const g of gs) {
        const n = g.gun.ammo.length;
        if (b.dataset.p === 'default') g.counts = g.defaults.slice();
        else if (b.dataset.p === 'even') g.counts = g.gun.ammo.map((_, i) => Math.floor(g.cap / n) + (i < g.cap % n ? 1 : 0));
        else {
          // all of one kind: armour-piercing first, else the first type
          const want = b.dataset.p === 'ap' ? (k) => !['he', 'smoke', 'heat', 'heat_fs', 'hesh'].includes(k) : (k) => k === 'he';
          let i = g.gun.ammo.findIndex((a) => want(shellKind(a.shell)));
          if (i < 0) i = 0;
          g.counts = g.gun.ammo.map((_, j) => (j === i ? g.cap : 0));
        }
      }
      this.cfg[lo.id] = Object.fromEntries(gs.map((x) => [x.key, x.counts]));
      saveAmmoConfig(this.cfg);
      this.renderAmmo();
    } else if (act === 'go') {
      if (performance.now() < this.readyAt || !this.vehicle) return;
      const lo = this.loadout();
      const empty = this.counts(lo).every((g) => g.counts.every((c) => c === 0));
      if (empty && !confirm('沒有帶任何炮彈，仍要出擊？')) return;
      this.o.deploy(this.vehicle, this.spawn);
    } else if (act === 'chat') this.sendChat();
    else if (act === 'leave') this.o.leave();
    b.blur?.();
  }

  input(e) {
    const t = e.target;
    if (t.dataset.act !== 'range') return;
    this.setCount(t.dataset.key, Number(t.dataset.i), Number(t.value));
    this.renderAmmo(t);
  }

  /** Every frame while open: the countdown on the button, the map's live marks. */
  update() {
    if (!this.visible) return;
    const go = this.el.querySelector('#dp-go');
    if (go) {
      const wait = (this.readyAt - performance.now()) / 1000;
      const text = wait > 0 ? `加入戰鬥！（${Math.ceil(wait)}）` : '加入戰鬥！';
      if (go.textContent !== text) go.textContent = text;
      go.disabled = wait > 0 || !this.vehicle;
    }
    this._mapT = (this._mapT || 0) + 1;
    if (this._mapT % 15 === 0) {
      this.drawMap();
      this.renderTop();
    }
  }

  render() {
    const o = this.o;
    const line = o.lineup();
    const m = o.map();
    this.el.innerHTML = `
      <header class="dp-top">
        <div class="dp-mode"><b>${esc(m.mode)}</b><span>${esc(m.name)}</span></div>
        <div class="dp-score" id="dp-score"></div>
        <button type="button" class="tool" data-act="leave">離開戰鬥</button>
      </header>
      <aside class="dp-left">
        <h3>${esc(this.title)}</h3>
        <div id="dp-teams"></div>
        <ol id="dp-chat" class="dp-chat"></ol>
        <div class="dp-chat-row"><input id="dp-chat-in" maxlength="200" placeholder="聊天" autocomplete="off"><button type="button" class="tool" data-act="chat">送出</button></div>
      </aside>
      <section class="dp-map">
        <div class="dp-map-box"><canvas id="dp-map" width="640" height="640"></canvas><div id="dp-spawns"></div></div>
        <p class="dp-hint">點地圖上的${m.team === 'red' ? '紅' : '藍'}色標記選擇出發點</p>
      </section>
      <aside class="dp-right" id="dp-ammo"></aside>
      <footer class="dp-bottom">
        <div class="dp-lineup" role="listbox" aria-label="出戰載具">${line
          .map(
            (v) => `<button type="button" class="dp-card" role="option" data-act="veh" data-id="${esc(v.id)}" aria-selected="${v.id === this.vehicle}" ${v.usable ? '' : `disabled title="${esc(v.why || '自訂與設計局的車只能在本機使用')}"`}>
              <canvas width="176" height="99" data-thumb="${esc(v.id)}"></canvas>
              <span class="dp-cn">${esc(v.name)}</span><span class="dp-ck">${esc(v.nation)}　${esc(v.kind)}${v.year ? `　${v.year}` : ""}</span></button>`,
          )
          .join('')}</div>
        <button type="button" id="dp-go" class="dp-go" data-act="go">加入戰鬥！</button>
      </footer>`;
    for (const c of this.el.querySelectorAll('canvas[data-thumb]')) {
      const v = line.find((x) => x.id === c.dataset.thumb);
      if (v && v.thumb) c.getContext('2d').drawImage(v.thumb, 0, 0, c.width, c.height);
    }
    this.el.querySelector('.dp-card[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.renderTop();
    this.renderAmmo();
    this.renderChat();
    this.drawMap();
    this.update();
  }

  renderTop() {
    const o = this.o;
    const m = o.map();
    const score = this.el.querySelector('#dp-score');
    if (score) {
      const pts = (m.points || [])
        .map((p) => `<span class="dp-pt" data-owner="${p.owner || ''}" data-id="${esc(p.id)}"></span>`)
        .join('');
      const t = m.tickets;
      score.innerHTML = t
        ? `<span class="dp-tk" data-team="blue">${Math.ceil(t[0])}</span>${pts}<span class="dp-tk" data-team="red">${Math.ceil(t[1])}</span>`
        : pts;
    }
    const teams = this.el.querySelector('#dp-teams');
    if (teams) {
      const ms = o.members();
      const col = (team) =>
        `<div class="dp-team" data-team="${team}"><h4>${team === 'blue' ? '藍方' : '紅方'}</h4><ul>${ms
          .filter((x) => x.team === team)
          .map((x) => `<li data-me="${x.me ? 1 : 0}" data-alive="${x.alive ? 1 : 0}"><span>${esc(x.name)}</span><small>${x.vehicle ? esc(o.vehicleName(x.vehicle)) : '選車中'}</small><b>${x.kills}/${x.deaths}</b></li>`)
          .join('')}</ul></div>`;
      const html = col('blue') + col('red');
      if (teams.innerHTML !== html) teams.innerHTML = html;
    }
  }

  renderChat() {
    const el = this.el.querySelector('#dp-chat');
    if (!el) return;
    el.innerHTML = this.chatLines.map((l) => `<li>${esc(l)}</li>`).join('');
    el.scrollTop = el.scrollHeight;
  }

  /** The chosen vehicle's guns: every round type with its picture, figures and how many to take. */
  renderAmmo(keepFocus) {
    const el = this.el.querySelector('#dp-ammo');
    if (!el) return;
    if (!this.vehicle) {
      el.innerHTML = '<p class="dp-note">沒有可以出戰的載具</p>';
      return;
    }
    const lo = this.loadout();
    const gs = this.counts(lo);
    const v = lo.vehicle;
    const t = (v.hull?.mass_kg || 0) / 1000;
    const hp = lo.engine?.engine?.horsepower || 0;
    const info = [CLASS_NAME[v.meta?.class] || '', t ? `${t.toFixed(1)} t` : '', hp && t ? `${(hp / t).toFixed(1)} hp/t` : ''].filter(Boolean).join('　');
    let html = `<h3>${esc(lo.name)}</h3><p class="dp-note">${esc(info)}</p>`;
    for (const g of gs) {
      const total = g.counts.reduce((s, x) => s + x, 0);
      const name = `${g.gun.def.name || String(g.gun.def.id).toUpperCase().replace(/_/g, '-')}（${g.gun.def.caliber_mm} mm）`;
      html += `<div class="dp-gun"><div class="dp-gun-h"><b>${esc(name)}</b><span data-full="${total >= g.cap ? 1 : 0}">${total} / ${g.cap} 發</span></div>`;
      g.gun.ammo.forEach((a, i) => {
        const s = a.shell;
        const k = shellKind(s);
        const pen = penAt(s, 100);
        html += `<div class="dp-round" data-key="${g.key}" data-i="${i}">
          <span class="dp-ico" data-ico="${esc(k)}"></span>
          <div class="dp-rn"><b>${esc(s.name)}</b><small>${esc(shellTypeLabel(k))}　${pen.toFixed(0)} mm@100 m　${Math.round(s.muzzle_velocity_ms)} m/s${s.explosive_mass_kg > 0 ? `　裝藥 ${(s.explosive_mass_kg * 1000).toFixed(0)} g` : ''}</small>
            <input type="range" min="0" max="${g.cap}" step="1" value="${g.counts[i]}" data-act="range" data-key="${g.key}" data-i="${i}" aria-label="${esc(s.name)} 數量"></div>
          <div class="dp-cnt"><button type="button" class="tool" data-act="dec" data-key="${g.key}" data-i="${i}" aria-label="減少">−</button><output>${g.counts[i]}</output><button type="button" class="tool" data-act="inc" data-key="${g.key}" data-i="${i}" aria-label="增加">+</button></div>
        </div>`;
      });
      html += '</div>';
    }
    html += `<div class="dp-presets"><button type="button" class="tool" data-act="preset" data-p="default">預設</button><button type="button" class="tool" data-act="preset" data-p="even">平均</button><button type="button" class="tool" data-act="preset" data-p="ap">全穿甲</button><button type="button" class="tool" data-act="preset" data-p="he">全高爆</button></div>
      <p class="dp-note">Shift + 點 ± 一次十發。設定按車保存，離線出擊也照這個裝彈。少帶彈時由下往上裝：上層與炮塔彈架留空，空彈架被擊中不會殉爆；開火打掉的彈也會讓彈架逐一變空。</p>`;
    if (keepFocus) {
      // dragging a slider: only the numbers change, the slider being dragged stays as it is
      for (const g of gs) {
        const total = g.counts.reduce((s, x) => s + x, 0);
        const head = el.querySelector(`.dp-round[data-key="${g.key}"]`)?.parentElement?.querySelector('.dp-gun-h span');
        if (head) {
          head.textContent = `${total} / ${g.cap} 發`;
          head.dataset.full = total >= g.cap ? '1' : '0';
        }
        g.counts.forEach((c, i) => {
          const row = el.querySelector(`.dp-round[data-key="${g.key}"][data-i="${i}"]`);
          if (!row) return;
          row.querySelector('output').textContent = c;
          const r = row.querySelector('input');
          if (r !== keepFocus) r.value = c;
          else if (Number(r.value) !== c) r.value = c;
        });
      }
      return;
    }
    el.innerHTML = html;
    for (const s of el.querySelectorAll('[data-ico]')) s.append(shellIcon(s.dataset.ico, 46));
  }

  /** The map: its picture, the capture points, our side's vehicles, and our spawn points to pick. */
  drawMap() {
    const c = this.el.querySelector('#dp-map');
    if (!c) return;
    const m = this.o.map();
    const g = c.getContext('2d');
    const S = c.width;
    g.fillStyle = '#2b3122';
    g.fillRect(0, 0, S, S);
    if (m.picture) g.drawImage(m.picture, 0, 0, S, S);
    const P = (x, z) => [((x - m.x0) / m.size) * S, (1 - (z - m.z0) / m.size) * S];
    // grid
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 1;
    const n = m.grid || 0;
    for (let i = 1; i < n; i++) {
      g.beginPath();
      g.moveTo((i * S) / n, 0);
      g.lineTo((i * S) / n, S);
      g.moveTo(0, (i * S) / n);
      g.lineTo(S, (i * S) / n);
      g.stroke();
    }
    for (const p of m.points || []) {
      const [x, y] = P(p.x, p.z);
      const r = Math.max(10, (p.r / m.size) * S);
      const col = p.owner === 'blue' ? '79,140,255' : p.owner === 'red' ? '232,70,58' : '240,236,220';
      g.fillStyle = `rgba(${col},0.18)`;
      g.strokeStyle = `rgba(${col},0.95)`;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = '#fff';
      g.font = '700 18px "Chakra Petch", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(p.id, x, y);
    }
    for (const e of m.others || []) {
      if (!e.friend) continue;
      const [x, y] = P(e.x, e.z);
      g.fillStyle = e.alive ? '#7fb0ff' : '#666';
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    }
    // the spawn points as buttons over the picture
    const box = this.el.querySelector('#dp-spawns');
    const key = JSON.stringify([m.spawns.map((s) => [s.x, s.z]), this.spawn, m.team]);
    if (box && box.dataset.key !== key) {
      box.dataset.key = key;
      box.innerHTML = m.spawns
        .map((s, i) => {
          const [x, y] = P(s.x, s.z);
          const deg = (s.heading * 180) / Math.PI;
          return `<button type="button" class="dp-spawn" data-team="${m.team}" data-act="spawn" data-i="${i}" aria-pressed="${i === this.spawn % m.spawns.length}" style="left:${((x / S) * 100).toFixed(2)}%;top:${((y / S) * 100).toFixed(2)}%" title="出發點 ${i + 1}"><i style="transform:rotate(${deg.toFixed(0)}deg)"></i><span>${i + 1}</span></button>`;
        })
        .join('');
    }
  }
}

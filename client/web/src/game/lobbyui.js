// The online lobby panel in the garage: connect to a server, see its rooms, create one (name,
// map, size) or join one, then in the room pick a side, mark ready and (the host) start the
// battle. The vehicle is the one chosen in the garage cards below; only the standard vehicles
// can go online, since every player needs the same data for them.
import { defaultServer, normalizeServer } from './net.js';

const STORE_SERVER = 'tankforge.server.v1';
const STORE_NAME = 'tankforge.name.v1';
const SIZES = [2, 4, 6, 8, 10, 12, 16];
/** Era limits a room can be created with: only vehicles of those years may be brought. */
export const ERAS = {
  any: { label: '不限', years: null },
  early: { label: '大戰初期 1935–1941', years: [1935, 1941] },
  ww2: { label: '二戰 1939–1945', years: [1939, 1945] },
  late: { label: '二戰後期 1943–1949', years: [1943, 1949] },
  cold: { label: '冷戰 1946–1970', years: [1946, 1970] },
  modern: { label: '現代 1960–2000', years: [1960, 2000] },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const load = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const save = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* a convenience only */
  }
};

export class LobbyUi {
  /**
   * el: the panel; net: NetClient; opts: {mapName(id), vehicleName(id), currentVehicle(),
   * usable(id) (may go online), onChange()}
   */
  constructor(el, net, opts) {
    this.el = el;
    this.net = net;
    this.o = opts;
    this.chat = [];
    this.error = '';
    this.board = null; // the scores of the last battle
    this.busy = false;
    this.server = load(STORE_SERVER) || defaultServer();
    this.name = load(STORE_NAME) || '';
    for (const t of ['status', 'rooms', 'room', 'left_room', 'welcome', 'closed']) net.on(t, () => this.render());
    // in a room the server always knows the vehicle on show in the garage
    net.on('room', () => {
      const me = this.me();
      if (me && me.vehicle !== this.o.currentVehicle()) this.sendVehicle();
    });
    net.on('error', (m) => {
      this.error = m.msg;
      this.render();
    });
    net.on('chat', (m) => {
      this.chat.push(m);
      if (this.chat.length > 40) this.chat.shift();
      this.renderChat();
    });
    net.on('ended', (m) => {
      this.board = m.members;
      this.render();
    });
    el.addEventListener('click', (e) => this.click(e));
    el.addEventListener('change', (e) => this.change(e));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'lb-chat-in') this.sendChat();
      if (e.key === 'Enter' && (e.target.id === 'lb-name' || e.target.id === 'lb-server') && !this.net.open) this.connect();
      e.stopPropagation();
    });
    this.render();
  }

  get visible() {
    return !this.el.hidden;
  }

  show(on = !this.visible) {
    this.el.hidden = !on;
    if (on) this.render();
    this.o.onChange?.();
  }

  async connect() {
    if (this.busy) return;
    const s = this.el.querySelector('#lb-server');
    const n = this.el.querySelector('#lb-name');
    this.server = normalizeServer(s ? s.value : this.server);
    this.name = (n ? n.value : this.name).trim();
    save(STORE_SERVER, this.server);
    save(STORE_NAME, this.name);
    this.error = '';
    this.busy = true;
    this.render();
    try {
      await this.net.connect(this.server, this.name);
      this.sendVehicle();
    } catch (e) {
      this.error = `${e.message}（${this.server}）。先在專案根目錄執行 cargo run --release -p tg-server`;
    }
    this.busy = false;
    this.render();
  }

  /** Tells the room which vehicle is chosen (after a change of card). */
  sendVehicle() {
    if (!this.net.inRoom) return;
    const id = this.o.currentVehicle();
    if (this.o.usable(id)) this.net.send({ t: 'vehicle', id });
  }

  sendChat() {
    const i = this.el.querySelector('#lb-chat-in');
    if (!i || !i.value.trim()) return;
    this.net.send({ t: 'chat', text: i.value });
    i.value = '';
  }

  click(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const net = this.net;
    this.error = '';
    switch (b.dataset.act) {
      case 'connect':
        this.connect();
        break;
      case 'disconnect':
        net.close();
        break;
      case 'refresh':
        net.send({ t: 'list' });
        break;
      case 'create': {
        const name = this.el.querySelector('#lb-room-name').value;
        const map = this.el.querySelector('#lb-map').value;
        const max = Number(this.el.querySelector('#lb-max').value);
        const era = ERAS[this.el.querySelector('#lb-era').value]?.years || null;
        this.board = null;
        net.send({ t: 'create', name, map, max, deploy: true, ...(era ? { era } : {}) });
        break;
      }
      case 'join':
        this.board = null;
        net.send({ t: 'join', room: Number(b.dataset.room) });
        break;
      case 'leave':
        net.send({ t: 'leave' });
        this.board = null;
        break;
      case 'team': {
        const me = this.me();
        if (me) net.send({ t: 'team', team: me.team === 'blue' ? 'red' : 'blue' });
        break;
      }
      case 'ready': {
        const me = this.me();
        if (me) net.send({ t: 'ready', ready: !me.ready });
        break;
      }
      case 'start':
        this.board = null;
        net.send({ t: 'start' });
        break;
      case 'chat':
        this.sendChat();
        break;
      case 'close':
        this.show(false);
        break;
      default:
        break;
    }
    b.blur();
    this.render();
  }

  change() {}

  me() {
    const r = this.net.room;
    return r ? r.members.find((m) => m.id === this.net.id) : null;
  }

  render() {
    this.o.onChange?.();
    if (this.el.hidden) return;
    const net = this.net;
    const head = `<header class="lb-head"><h2>聯機大廳</h2><span class="lb-state" data-on="${net.open ? 1 : 0}">${net.open ? `已連線 · ${esc(net.name)}${net.rtt ? ` · ${net.rtt.toFixed(0)} ms` : ''}` : net.status === 'connecting' ? '連線中…' : '未連線'}</span><button type="button" class="tool" data-act="close" aria-label="關閉">✕</button></header>`;
    let body = '';
    if (!net.open) {
      body = `
        <label class="lb-field">伺服器<input id="lb-server" value="${esc(this.server)}" spellcheck="false" autocomplete="off"></label>
        <label class="lb-field">車長名稱<input id="lb-name" value="${esc(this.name)}" maxlength="24" placeholder="不填則自動命名" autocomplete="off"></label>
        <button type="button" class="tool lb-main" data-act="connect" ${this.busy ? 'disabled' : ''}>${this.busy ? '連線中…' : '連線'}</button>
        <p class="lb-note">伺服器在專案根目錄啟動：<code>cargo run --release -p tg-server</code>；朋友用瀏覽器開 <code>http://你的IP:8787/</code> 就能進同一個大廳。</p>`;
    } else if (!net.room) {
      const rows = net.rooms.length
        ? net.rooms
            .map(
              (r) => `<li><span class="lb-rn">${esc(r.name)}</span><span class="lb-rm">${esc(this.o.mapName(r.map))} · ${r.players}/${r.max}${r.era ? ` · ${r.era[0]}–${r.era[1]}` : ''} · ${r.playing ? '<b class="lb-play">戰鬥中</b>' : '等待中'}</span><span class="lb-rh">房主 ${esc(r.host)}</span><button type="button" class="tool" data-act="join" data-room="${r.id}" ${r.players >= r.max ? 'disabled' : ''}>${r.players >= r.max ? '已滿' : '加入'}</button></li>`,
            )
            .join('')
        : '<li class="lb-empty">還沒有房間，建立一個吧</li>';
      const maps = (net.maps.length ? net.maps : ['range']).map((m) => `<option value="${esc(m)}">${esc(this.o.mapName(m))}</option>`).join('');
      body = `
        <div class="lb-row"><h3>房間</h3><button type="button" class="tool" data-act="refresh">重新整理</button><button type="button" class="tool" data-act="disconnect">斷線</button></div>
        <ul class="lb-rooms">${rows}</ul>
        <h3>建立房間</h3>
        <label class="lb-field">房名<input id="lb-room-name" maxlength="24" placeholder="${esc(net.name)} 的房間" autocomplete="off"></label>
        <div class="lb-row">
          <label class="lb-field">地圖<select id="lb-map">${maps}</select></label>
          <label class="lb-field">年代<select id="lb-era">${Object.entries(ERAS).map(([k, e]) => `<option value="${k}">${e.label}</option>`).join('')}</select></label>
          <label class="lb-field">人數<select id="lb-max">${SIZES.map((n) => `<option ${n === 8 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        </div>
        <button type="button" class="tool lb-main" data-act="create">建立房間</button>`;
    } else {
      const r = net.room;
      const me = this.me();
      const veh = this.o.currentVehicle();
      const side = (team) => {
        const list = (this.board || r.members).filter((m) => m.team === team);
        return `<div class="lb-team" data-team="${team}"><h3>${team === 'blue' ? '藍方' : '紅方'} <small>${list.reduce((a, m) => a + m.kills, 0)} 擊毀</small></h3><ul>${list
          .map(
            (m) => `<li data-me="${m.id === net.id ? 1 : 0}"><span class="lb-mn">${m.id === r.host ? '★ ' : ''}${esc(m.name)}</span><span class="lb-mv">${m.vehicle ? esc(this.o.vehicleName(m.vehicle)) : '<i>未選車</i>'}</span><span class="lb-mk">${m.ready ? '<b>準備</b> ' : ''}${m.kills}/${m.deaths}</span></li>`,
          )
          .join('') || '<li class="lb-empty">—</li>'}</ul></div>`;
      };
      const warn = !r.deploy && !this.o.usable(veh) ? `<p class="lb-err">「${esc(this.o.vehicleName(veh))}」不能聯機（自訂與設計局的車只在本機），請在下方選一般車輛</p>` : '';
      body = `
        <div class="lb-row"><h3 class="lb-title">${esc(r.name)}</h3><span class="lb-rm">${esc(this.o.mapName(r.map))} · ${r.members.length}/${r.max}${r.era ? ` · 限 ${r.era[0]}–${r.era[1]} 年` : ''}${r.playing ? ' · <b class="lb-play">戰鬥中</b>' : ''}</span></div>
        ${this.board ? '<p class="lb-note">上一場的戰績（擊毀/陣亡）</p>' : ''}
        <div class="lb-teams">${side('blue')}${side('red')}</div>
        ${warn}
        ${r.deploy ? '<p class="lb-note">開戰後先進入地圖，在出擊畫面選車、配置彈藥與出發點；每次被擊毀都能重新選。</p>' : `<p class="lb-note">我的車：<b>${esc(this.o.vehicleName(veh))}</b>（在下方卡片換車）</p>`}
        <div class="lb-row">
          <button type="button" class="tool" data-act="team" ${r.playing ? 'disabled' : ''}>換到${me && me.team === 'blue' ? '紅方' : '藍方'}</button>
          <button type="button" class="tool" data-act="ready">${me && me.ready ? '取消準備' : '準備'}</button>
          <button type="button" class="tool" data-act="leave">離開房間</button>
        </div>
        ${net.isHost ? `<button type="button" class="tool lb-main" data-act="start">${r.playing ? '戰鬥進行中' : '開始戰鬥'}</button>` : `<p class="lb-note">${r.playing ? '戰鬥進行中，按「開始戰鬥」加入' : '等待房主開始…'}</p>`}
        <div class="lb-chat"><ol id="lb-chat-log"></ol><div class="lb-row"><input id="lb-chat-in" maxlength="200" placeholder="聊天…" autocomplete="off"><button type="button" class="tool" data-act="chat">送出</button></div></div>`;
    }
    const err = this.error ? `<p class="lb-err">${esc(this.error)}</p>` : '';
    // keep what is being typed across a redraw
    const keep = {};
    for (const i of this.el.querySelectorAll('input, select')) keep[i.id] = i.value;
    const focus = document.activeElement && this.el.contains(document.activeElement) ? document.activeElement.id : null;
    this.el.innerHTML = head + err + body;
    for (const [id, v] of Object.entries(keep)) {
      const i = this.el.querySelector('#' + id);
      if (i && id !== 'lb-server' && id !== 'lb-name') i.value = v;
    }
    if (focus) this.el.querySelector('#' + focus)?.focus();
    this.renderChat();
  }

  renderChat() {
    const log = this.el.querySelector('#lb-chat-log');
    if (!log) return;
    log.innerHTML = this.chat.map((m) => `<li><b>${esc(m.name)}</b> ${esc(m.text)}</li>`).join('');
    log.scrollTop = log.scrollHeight;
  }
}

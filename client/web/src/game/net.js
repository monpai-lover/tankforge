// The connection to the online server (crates/server): JSON messages over a WebSocket, each
// tagged by "t". The server keeps the rooms, teams, hit points and scores; this side sends the
// player's own vehicle 20 times a second, the shots it fires and what they hit. If the connection
// drops in a battle the server holds the seat for a while: this side reconnects on its own and
// takes the seat back with the token from the welcome ('reconnecting', then 'resumed' or
// 'closed'). Pings carry the last round trip, which the server's lag compensation uses.
export const SEND_HZ = 20;

/** Where the server probably is: the page's own host when it was served by tg-server. */
export function defaultServer() {
  const l = typeof location !== 'undefined' ? location : null;
  if (l && /^https?:$/.test(l.protocol) && l.host) return `${l.protocol === 'https:' ? 'wss' : 'ws'}://${l.host}/ws`;
  return 'ws://localhost:8787/ws';
}

/** Accepts "host:port", "ws://host:port" or a full ".../ws" address. */
export function normalizeServer(text) {
  let s = String(text || '').trim();
  if (!s) return defaultServer();
  if (!/^wss?:\/\//.test(s)) s = (s.startsWith('https://') ? 'wss://' + s.slice(8) : 'ws://' + s.replace(/^http:\/\//, ''));
  if (!/\/ws\/?$/.test(s)) s = s.replace(/\/+$/, '') + '/ws';
  return s;
}

export class NetClient {
  constructor() {
    this.ws = null;
    this.status = 'off'; // off | connecting | open
    this.id = null;
    this.name = '';
    this.maps = [];
    this.rooms = [];
    this.room = null; // the room this player is in (RoomDetail)
    this.rtt = 0;
    this.handlers = new Map();
    this._ping = null;
    /** The seat token from the welcome, and the address, for a reconnect. */
    this.token = null;
    this.url = null;
    this.reconnecting = false;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  _emit(type, msg) {
    for (const fn of this.handlers.get(type) || []) {
      try {
        fn(msg);
      } catch (e) {
        console.error('net handler', type, e);
      }
    }
  }

  get open() {
    return this.status === 'open';
  }

  get inRoom() {
    return !!this.room;
  }

  get isHost() {
    return !!this.room && this.room.host === this.id;
  }

  /** Connects and says who we are; resolves on the server's welcome. */
  connect(url, name) {
    this.close();
    this.url = url;
    this.name = name;
    return this._open(url, { t: 'hello', name });
  }

  /** Opens the socket and sends `hello`; resolves on the welcome. */
  _open(url, hello) {
    this.status = 'connecting';
    this._emit('status', this.status);
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        this.status = 'off';
        this._emit('status', this.status);
        reject(e);
        return;
      }
      this.ws = ws;
      let welcomed = false;
      ws.onopen = () => {
        ws.send(JSON.stringify(hello));
      };
      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        // taking a seat back: the server welcomes every new socket first, then answers the hello
        // (with the old id if the seat was still held) -- the second welcome is the one that counts
        if (msg.t === 'welcome' && hello.resume && !ws.skippedFirst) {
          ws.skippedFirst = true;
          return;
        }
        this._receive(msg);
        if (msg.t === 'welcome' && !welcomed) {
          welcomed = true;
          this.status = 'open';
          this._emit('status', this.status);
          clearInterval(this._ping);
          this._ping = setInterval(() => this.send({ t: 'ping', at: performance.now(), rtt: this.rtt ? Math.round(this.rtt) : undefined }), 2000);
          resolve(msg);
        }
      };
      ws.onerror = () => {
        if (!welcomed) reject(new Error('連不上伺服器'));
      };
      ws.onclose = () => {
        if (this.ws !== ws) return;
        const was = this.status;
        if (!welcomed) {
          this.ws = null;
          this.status = 'off';
          reject(new Error('連不上伺服器'));
          return;
        }
        // in a battle: try to take the seat back before giving up
        if (was === 'open' && this.room && this.room.playing && this.token && !this.reconnecting) {
          this._reconnect();
          return;
        }
        this._reset();
        this._emit('status', this.status);
        if (was === 'open') this._emit('closed', {});
      };
    });
  }

  /** Tries for a while (the server holds the seat 20 s) to get back in with the token. */
  async _reconnect() {
    this.reconnecting = true;
    clearInterval(this._ping);
    this._ping = null;
    this.ws = null;
    this._emit('reconnecting', {});
    const oldId = this.id;
    const until = performance.now() + 18000;
    let wait = 500;
    while (this.reconnecting && performance.now() < until) {
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 4000);
      if (!this.reconnecting) return;
      try {
        const w = await this._open(this.url, { t: 'hello', name: this.name, resume: this.token });
        this.reconnecting = false;
        if (w.id === oldId) this._emit('resumed', {});
        else {
          // the seat was gone: we are a new player in the lobby
          this.room = null;
          this._emit('closed', {});
        }
        return;
      } catch {
        /* not yet: try again */
      }
    }
    if (!this.reconnecting) return;
    this.reconnecting = false;
    this._reset();
    this._emit('status', this.status);
    this._emit('closed', {});
  }

  _reset() {
    clearInterval(this._ping);
    this._ping = null;
    this.ws = null;
    this.status = 'off';
    this.room = null;
    this.rooms = [];
  }

  close() {
    this.reconnecting = false;
    if (!this.ws) return;
    const ws = this.ws;
    this._reset();
    try {
      ws.close();
    } catch {
      /* already closing */
    }
    this._emit('status', this.status);
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  _receive(msg) {
    switch (msg.t) {
      case 'welcome':
        this.id = msg.id;
        this.name = msg.name;
        this.maps = msg.maps || [];
        if (msg.token) this.token = msg.token;
        break;
      case 'rooms':
        this.rooms = msg.rooms;
        break;
      case 'room':
        this.room = msg.room;
        break;
      case 'left_room':
        this.room = null;
        break;
      case 'pong':
        this.rtt = Math.max(0, performance.now() - msg.at);
        break;
      default:
        break;
    }
    this._emit(msg.t, msg);
  }
}

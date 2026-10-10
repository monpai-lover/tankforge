// Cannon discharge is predicted locally. Only a matching rejection returns its one
// spent round; lost replies and timeouts never presume an accepted shot was rejected.
import { fired as queueReload } from '../sim/loading.js';

const MAX_PENDING = 1024;
const REPLY_LIFE = 30;

export class OnlineFires {
  constructor() { this.pending = []; }

  begin(request, now) {
    this.retire(now);
    if (this.pending.some(p => p.seq === request.seq)) return false;
    if (this.pending.length >= MAX_PENDING) this.pending.shift();
    this.pending.push({ ...request, at: now });
    return true;
  }

  retire(now, isCurrent = () => true) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (now - this.pending[i].at > REPLY_LIFE || !isCurrent(this.pending[i])) this.pending.splice(i, 1);
    }
  }

  _take(seq, gun, session, now) {
    this.retire(now);
    const i = this.pending.findIndex(p => p.seq === seq);
    if (i < 0) return null;
    const p = this.pending.splice(i, 1)[0];
    return p.gun === gun && p.session === session && p.gun.ammo.includes(p.ammo) ? p : null;
  }

  confirm(seq, gun, session, now) {
    return this._take(seq, gun, session, now);
  }

  reject(seq, gun, session, now) {
    const p = this._take(seq, gun, session, now);
    if (!p) return null;
    p.ammo.count = Math.min(p.ammo.max ?? Infinity, p.ammo.count + 1);
    // A last-round prediction may mark the gun empty. Queue only that idle case;
    // preserve selection, a later loaded round and any reload already in progress.
    if (p.loading.state[p.gi] === 'empty') queueReload(p.loading, p.gi);
    return p;
  }

  clear() { this.pending.length = 0; }
}

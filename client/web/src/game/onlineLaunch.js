// Online missile requests are committed only by a matching authoritative launch acknowledgement.
import { fireLauncherRound } from './loadout.js';

export class OnlineLaunches {
  constructor(pending = []) {
    this.pending = pending;
  }

  has(gun) {
    return this.pending.some(p => p.gun === gun);
  }

  begin(request, now) {
    const { gun: g, loading: L, gi } = request;
    if (this.has(g) || L.state[gi] !== 'ready' || !g.launcher?.ready || g.launcher.cooldown > 1e-9 || g.loaded < 0 || !(g.ammo[g.loaded]?.count > 0)) return false;
    this.pending.push({ ...request, sentAt: now });
    return true;
  }

  _take(seq) {
    const i = this.pending.findIndex(p => p.msg.seq === seq);
    return i < 0 ? null : this.pending.splice(i, 1)[0];
  }

  confirm(seq, missile, currentGun, session) {
    const p = this.pending.find(p => p.msg.seq === seq);
    if (!p || p.msg.missile !== missile) return null;
    if (p.gun !== currentGun || p.session !== session) {
      this._take(seq);
      return null;
    }
    this._take(seq);
    return fireLauncherRound(p.gun, p.loading, p.gi) ? p : null;
  }

  reject(seq, retryAfter, session) {
    const p = this._take(seq);
    if (!p || p.session !== session) return null;
    if (Number.isFinite(retryAfter) && retryAfter > 0) p.gun.launcher.cooldown = Math.max(p.gun.launcher.cooldown, retryAfter);
    return p;
  }

  retry(now, send, isCurrent = () => true, force = false) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (!isCurrent(p)) {
        this.pending.splice(i, 1);
        continue;
      }
      if (force || now - p.sentAt >= 1) {
        p.sentAt = now;
        send(p.msg);
      }
    }
  }

  clear() {
    this.pending.length = 0;
  }
}

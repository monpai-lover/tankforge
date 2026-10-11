// Online missile requests are committed only by a matching authoritative launch acknowledgement.
import { commitLauncherLaunch } from './loadout.js';

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
    this.pending.push({ ...request, ammoId: g.ammo[g.loaded].shell.id, scope: request.scope || request.msg.ammo_scope || null, sentAt: now });
    return true;
  }

  _take(seq) {
    const i = this.pending.findIndex(p => p.msg.seq === seq);
    return i < 0 ? null : this.pending.splice(i, 1)[0];
  }

  confirm(seq, missile, currentGun, session, { consumeAmmo = true, scope = null } = {}) {
    const p = this.pending.find(p => p.msg.seq === seq);
    if (!p || p.msg.missile !== missile) return null;
    if (scope && p.scope && (scope.battle !== p.scope.battle || scope.life !== p.scope.life)) return null;
    if (p.gun !== currentGun || p.session !== session) {
      this._take(seq);
      return null;
    }
    this._take(seq);
    return commitLauncherLaunch(p.gun, p.loading, p.gi, p.ammoId, p.gun.launchIntervalSeconds ?? .25, { consumeAmmo }) ? p : null;
  }

  reject(seq, retryAfter, session, scope = null) {
    const pending=this.pending.find(p=>p.msg.seq===seq);
    if(scope&&pending?.scope&&(scope.battle!==pending.scope.battle||scope.life!==pending.scope.life))return null;
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

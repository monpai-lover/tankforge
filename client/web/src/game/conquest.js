// Conquest (佔領模式) on a map with capture points: the same rules the server runs
// (crates/server/src/lobby.rs, Lobby::conquest), here for a battle against the computer and for
// the tests. Vehicles of one side alone in a circle turn it towards that side (faster with more
// of them, up to three); a point turned all the way belongs to that side; through the middle,
// whoever held it has lost it. Each side starts with TICKETS; a lost vehicle costs DEATH_COST,
// and holding fewer points than the enemy bleeds BLEED a second per point short. The side out of
// tickets has lost.
export const TICKETS = 1000;
export const DEATH_COST = 50;
export const BLEED = 1.5;
export const CAPTURE_TIME = 24;

export class Conquest {
  constructor(points) {
    this.points = points.map((p) => ({ id: p.id, x: p.x, z: p.z, r: p.r, owner: null, progress: 0, blue: 0, red: 0 }));
    this.tickets = [TICKETS, TICKETS];
    this.winner = null;
  }

  /** A vehicle of `team` lost. */
  death(team) {
    const i = team === 'red' ? 1 : 0;
    this.tickets[i] = Math.max(0, this.tickets[i] - DEATH_COST);
    this._check();
  }

  /** `dt` seconds with these vehicles on the field: [{team, x, z, alive}]. Events: [{id, owner, lost}]. */
  step(dt, vehicles) {
    const events = [];
    if (this.winner) return events;
    for (const pt of this.points) {
      const inside = (t) => vehicles.filter((v) => v.alive && v.team === t && Math.hypot(v.x - pt.x, v.z - pt.z) <= pt.r).length;
      pt.blue = inside('blue');
      pt.red = inside('red');
      let n = 0;
      let sign = 0;
      if (pt.blue > 0 && pt.red === 0) [n, sign] = [pt.blue, 1];
      else if (pt.red > 0 && pt.blue === 0) [n, sign] = [pt.red, -1];
      if (!n) continue;
      const rate = (dt / CAPTURE_TIME) * (1 + 0.5 * (Math.min(n, 3) - 1));
      const ours = sign > 0 ? 'blue' : 'red';
      if (pt.owner === ours && pt.progress * sign >= 1) continue;
      const before = pt.progress;
      pt.progress = Math.max(-1, Math.min(1, pt.progress + sign * rate));
      if (before * pt.progress <= 0 && before !== 0 && pt.owner) {
        events.push({ id: pt.id, owner: null, lost: pt.owner });
        pt.owner = null;
      }
      if (pt.progress >= 1 && pt.owner !== 'blue') {
        pt.owner = 'blue';
        events.push({ id: pt.id, owner: 'blue' });
      } else if (pt.progress <= -1 && pt.owner !== 'red') {
        pt.owner = 'red';
        events.push({ id: pt.id, owner: 'red' });
      }
    }
    const held = (t) => this.points.filter((p) => p.owner === t).length;
    const blue = held('blue');
    const red = held('red');
    this.tickets[0] = Math.max(0, this.tickets[0] - BLEED * Math.max(0, red - blue) * dt);
    this.tickets[1] = Math.max(0, this.tickets[1] - BLEED * Math.max(0, blue - red) * dt);
    this._check();
    return events;
  }

  _check() {
    if (this.winner) return;
    if (this.tickets[0] <= 0 || this.tickets[1] <= 0) this.winner = this.tickets[0] > this.tickets[1] ? 'blue' : 'red';
  }
}

/** What the HUD says about the point a vehicle of `team` at (x, z) stands in, or ''. */
export function captureMessage(points, team, x, z) {
  for (const p of points || []) {
    if (Math.hypot(x - p.x, z - p.z) > p.r) continue;
    const sign = team === 'red' ? -1 : 1;
    const pct = Math.round(Math.abs(p.progress) * 100);
    if (p.blue > 0 && p.red > 0) return `${p.id} 點爭奪中`;
    if (p.owner === team && p.progress * sign >= 1) return `${p.id} 點已在我方手中`;
    if (p.progress * sign < 0) return `正在中和 ${p.id} 點　${pct}%`;
    return `正在佔領 ${p.id} 點　${pct}%`;
  }
  return '';
}

import { useCombat } from './enemies.js';

const REVIVAL_DELAY = 15;
const REVIVAL_SPACING = 2;

/** Simulation-time revival of destroyed authored targets in the offline range. */
export class RangeTargetRevival {
  constructor() { this.reset(); }

  reset() {
    this.time = 0;
    this.nextAllowed = 0;
    this.dead = new Map();
  }

  step(dt, targets, revive) {
    if (!Number.isFinite(dt) || dt < 0) return null;
    this.time += dt;
    for (const e of this.dead.keys()) {
      if (!targets.includes(e) || !e.rangeTarget || e.remote || e.alive) this.dead.delete(e);
    }
    let selected = null, oldest = Infinity;
    for (const e of targets) {
      if (!e.rangeTarget || e.remote || e.alive) continue;
      if (!this.dead.has(e)) this.dead.set(e, this.time);
      const at = this.dead.get(e);
      if (this.time - at >= REVIVAL_DELAY && at < oldest) { selected = e; oldest = at; }
    }
    if (!selected || this.time < this.nextAllowed || !revive(selected)) return null;
    this.dead.delete(selected);
    this.nextAllowed = this.time + REVIVAL_SPACING;
    return selected;
  }
}

const copyPose = node => ({
  node,pos:node.pos.slice(),yaw:node.yaw,pitch:node.pitch,roll:node.roll,
  local:node.local && node.local.slice(),
});

/** Capture existing hull-relative joints once, after an authored target is posed and bound. */
export function captureRangeTargetRestPose(e) {
  return {
    fold:e.fold || 0,turretYaw:e.turretYaw,turretYaws:e.turretYaws && e.turretYaws.slice(),
    gunPitch:e.gunPitch.slice(),
    joints:e.model.turrets.flatMap(t=>[t.node,...t.guns.flatMap(g=>[g.node,g.barrel].filter(Boolean))]).map(copyPose),
  };
}

/** Restore one target's combat life and articulation, retaining its model, loadout and hull. */
export function reviveRangeTarget(e, combat = e.combat) {
  if (!e.rangeTarget || e.remote || e.alive || !e.rangeRestPose) return false;
  const rest = e.rangeRestPose;
  const fresh = combat ? combat.fresh(e.combatKey,e.sourceBundle || e.bundle,rest.fold) : null;
  if (combat && !fresh) return false;
  e.cstate = fresh ? fresh.state : null;
  e.caps = fresh ? fresh.caps : null;
  if (combat) useCombat(e,combat,e.combatKey);
  e.hp = 100; e.alive = true; e.toss = null; e.seen = null; e.hits.length = 0;
  e.fold = rest.fold; e.turretYaw = rest.turretYaw;
  e.turretYaws = rest.turretYaws && rest.turretYaws.slice();
  e.gunPitch = rest.gunPitch.slice();
  for (const saved of rest.joints) {
    const {node,pos,local,...angles} = saved;
    Object.assign(node,angles,{pos:pos.slice(),local:local && local.slice()});
  }
  e.pose();
  return true;
}

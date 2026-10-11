import policy from '../../../../config/ammo-resupply.json' with { type: 'json' };

if (policy.ammo_protocol_version !== 1 || !Number.isFinite(policy.resupply_seconds) || policy.resupply_seconds <= 0
  || !Number.isFinite(policy.pose_max_age_seconds) || policy.pose_max_age_seconds <= 0
  || Object.keys(policy).length !== 3) throw new Error('Invalid ammunition resupply policy');

export function newResupplyState() { return { elapsed: 0 }; }

/** First fully friendly, uncontested circle. Dwell belongs to the actor, not this id. */
export function eligiblePoint(points, actor) {
  if (!['blue', 'red'].includes(actor?.team) || !Number.isFinite(actor.x) || !Number.isFinite(actor.z)
    || !['alive', 'deployed', 'connected', 'active'].every(flag => actor[flag] === true)) return null;
  const sign = actor.team === 'red' ? -1 : 1;
  const enemy = actor.team === 'red' ? 'blue' : 'red';
  const point = (points || []).find(p => Number.isFinite(p.x) && Number.isFinite(p.z)
    && Number.isFinite(p.r) && p.r > 0 && Number.isFinite(p.progress)
    && Number.isInteger(p[enemy]) && p[enemy] === 0 && p.owner === actor.team
    && p.progress * sign >= 1 && Math.hypot(actor.x - p.x, actor.z - p.z) <= p.r);
  return point?.id ?? null;
}

export function stepResupply(state, dt, eligible, missing) {
  if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid resupply dt');
  if (!eligible || !missing) { state.elapsed = 0; return { progress: 0, complete: false }; }
  state.elapsed = Math.min(policy.resupply_seconds, state.elapsed + dt);
  const complete = state.elapsed + 1e-9 >= policy.resupply_seconds;
  const progress = Math.min(1, state.elapsed / policy.resupply_seconds);
  if (complete) state.elapsed = 0;
  return { progress, complete };
}

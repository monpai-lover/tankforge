// Runtime clutch/engine take-up, shared by tracked and wheeled vehicles. The speed lever
// still requests the same speed and gearing; the driveline cannot deliver peak launch
// torque in a single physics step. Brake forces and the suspension are independent.
const FORCE_RISE_ACCEL_S = 4; // m/s³ of requested tractive acceleration
const MAX_TAKEUP_S = 1.5; // high-reduction first gears must engage before the first upshift

export function advanceDriveForce(state, direction, available, mass, dt, takeupSeconds = MAX_TAKEUP_S) {
  if (direction && state.driveDirection && direction !== state.driveDirection) state.driveForce = 0;
  if (direction) state.driveDirection = direction;
  // Once engaged, a shift or governor cut must not disengage the clutch and restart launch.
  // Callers still cap delivered force by the engine's current output, including shift cuts.
  const target = direction ? Math.max(available, state.driveForce) : 0;
  const rise = Math.max(mass * FORCE_RISE_ACCEL_S, available / takeupSeconds);
  state.driveForce = Math.min(target, state.driveForce + rise * dt);
  return state.driveForce;
}

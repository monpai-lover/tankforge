/* Exact-input presentation cache for the intact, parked player's tank during local flight. */
var TFOfflineTankVisualCache = (() => {
  const states = new WeakMap();
  const sides = [1, -1];
  function count(name) {
    if (typeof TFOfflineFlightProfile !== "undefined" && TFOfflineFlightProfile) TFOfflineFlightProfile.count("tank.running_gear_cache_" + name);
  }
  function stateFor(model) {
    let state = states.get(model);
    if (state && model.updateRunningGear === state.tracked) return state;
    const original = model.updateRunningGear;
    state = { original, revision: 0, applied: -1, valid: false, numbers: new Float64Array(128), length: 0, index: 0, changed: false, finite: true, ground: { 1: new Map(), [-1]: new Map() } };
    state.tracked = function () {
      state.revision++;
      return Reflect.apply(original, this, arguments);
    };
    try { model.updateRunningGear = state.tracked; } catch { /* A sealed model fails open. */ }
    if (model.updateRunningGear !== state.tracked) return null;
    states.set(model, state); return state;
  }
  function number(state, value, write) {
    if (!Number.isFinite(value)) state.finite = false;
    if (write && state.index >= state.numbers.length) {
      const next = new Float64Array(state.numbers.length * 2); next.set(state.numbers); state.numbers = next;
    }
    if (write) state.numbers[state.index] = value;
    else if (state.index >= state.length || !Object.is(state.numbers[state.index], value)) state.changed = true;
    state.index++;
  }
  function list(state, values, write) {
    number(state, values?.length ?? -1, write);
    if (values) for (let i = 0; i < values.length; i++) number(state, values[i], write);
  }
  function scan(state, dyn, write) {
    state.index = 0; state.changed = false; state.finite = true;
    number(state, dyn.lod ?? 0, write);
    for (const side of sides) {
      list(state, dyn.lifts?.[side], write);
      number(state, dyn.travel?.[side] ?? 0, write);
      number(state, dyn.slack?.[side] ?? 1, write);
      number(state, typeof dyn.ground?.[side] === "function" ? 1 : 0, write);
    }
    number(state, dyn.wheels?.length ?? -1, write);
    if (dyn.wheels) for (let i = 0; i < dyn.wheels.length; i++) {
      const w = dyn.wheels[i];
      number(state, w?.lift ?? 0, write); number(state, w?.spin ?? 0, write); number(state, w?.steer ?? 0, write);
    }
    if (write) state.length = state.index;
    return state.finite && !state.changed && state.index === state.length;
  }
  function compareGroundSample(height, z) {
    if (!this.groundMatches) return;
    const current = this.currentGround(z);
    if (!Number.isFinite(current) || !Object.is(height, current)) this.groundMatches = false;
  }
  function finiteGroundSample(height) { if (!Number.isFinite(height)) this.valid = false; }
  function sameGround(state, dyn) {
    for (const side of sides) {
      const samples = state.ground[side], ground = dyn.ground?.[side];
      if (samples.size && typeof ground !== "function") return false;
      state.currentGround = ground; state.groundMatches = true;
      samples.forEach(compareGroundSample, state);
      if (!state.groundMatches) return false;
    }
    return true;
  }
  function update(model, dyn, eligible) {
    const state = stateFor(model);
    if (!state) return model.updateRunningGear(dyn);
    // Detached/unsupported/laid tracks contain clock-driven animation, so never cache them.
    if (!eligible || dyn.openBelts) {
      state.valid = false; count("bypass");
      return model.updateRunningGear(dyn);
    }
    if (state.valid && state.applied === state.revision && scan(state, dyn, false) && sameGround(state, dyn)) {
      count("hit"); return;
    }
    state.valid = false; count("miss");
    for (const side of sides) {
      const samples = state.ground[side], ground = dyn.ground?.[side]; samples.clear();
      if (typeof ground === "function") dyn.ground[side] = function (z) {
        const height = Reflect.apply(ground, this, arguments);
        samples.set(z, height); return height;
      };
    }
    const result = model.updateRunningGear(dyn);
    state.applied = state.revision; state.valid = scan(state, dyn, true);
    for (const side of sides) state.ground[side].forEach(finiteGroundSample, state);
    return result;
  }
  return { update };
})();

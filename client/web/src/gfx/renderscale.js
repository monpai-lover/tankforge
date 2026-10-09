// Dynamic resolution: the scene is rendered at a fraction of the canvas when frames run long and
// scaled back up when there is room again (the composite pass samples the smaller picture with
// linear filtering). Resolution is the first thing given up; only when it is at its floor does the
// game drop a quality tier. Adapted from the idea of Claude-of-Tanks' MIT
// src/engine/renderScalePolicy.ts / adaptiveQualityPolicy.ts: measure over windows, step down
// quickly, step up slowly, and wait longer before each new try after a step up had to be undone.

export class RenderScale {
  constructor({ min = 0.7, max = 1, step = 0.1, slowMs = 24, fastMs = 18.5, window = 1.5 } = {}) {
    Object.assign(this, { min, max, step, slowMs, fastMs, window });
    this.scale = max;
    this.t = 0;
    this.acc = 0;
    this.frames = 0;
    this.cool = 0;
    /** Seconds of good windows needed before stepping up; doubles when a step up is undone. */
    this.upHold = 6;
    this.good = 0;
    this.sinceUp = Infinity;
  }

  /** At the lowest scale: the next relief has to come from a quality tier. */
  get atFloor() {
    return this.scale <= this.min + 1e-6;
  }

  /** Feeds one frame (dt in seconds). Returns the new scale when it changed, else null. */
  sample(dt) {
    if (!(dt > 0) || dt > 0.25) return null; // a hitch or a background tab says nothing
    this.acc += dt;
    this.frames++;
    this.t += dt;
    this.sinceUp += dt;
    if (this.cool > 0) this.cool -= dt;
    if (this.t < this.window) return null;
    const ms = (this.acc / this.frames) * 1000;
    const span = this.t;
    this.t = 0;
    this.acc = 0;
    this.frames = 0;
    if (this.cool > 0) return null;
    if (ms > this.slowMs && this.scale > this.min + 1e-6) {
      // a step up that had to be undone soon: wait longer before the next try
      if (this.sinceUp < this.upHold) this.upHold = Math.min(60, this.upHold * 2);
      this.scale = Math.max(this.min, round(this.scale - this.step));
      this.cool = 2;
      this.good = 0;
      return this.scale;
    }
    this.good = ms < this.fastMs ? this.good + span : 0;
    if (this.good >= this.upHold && this.scale < this.max - 1e-6) {
      this.scale = Math.min(this.max, round(this.scale + this.step));
      this.good = 0;
      this.sinceUp = 0;
      this.cool = 2;
      return this.scale;
    }
    return null;
  }
}

const round = (v) => Math.round(v * 100) / 100;

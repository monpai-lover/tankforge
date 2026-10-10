const HOLD_SECONDS = 3;
const TAP_SECONDS = .35;

/** Input timing only; the existing combat core/server owns actual repair and death. */
export class VehicleActions {
  constructor() {
    this.pressed = new Set();
    this.repairTotal = 0;
    this.view = { kind: '', phase: '', progress: 0, seconds: 0 };
    this.cancel();
  }

  press(code, now) {
    if ((code !== 'KeyF' && code !== 'KeyJ') || this.pressed.has(code)) return false;
    this.pressed.add(code);
    this.active = code;
    this.startedAt = now;
    return true;
  }

  release(code, now, available, stopped) {
    if (!this.pressed.has(code)) return null;
    this.pressed.delete(code);
    if (this.active !== code) return null;
    const elapsed = Math.max(0, now - this.startedAt);
    const completed = this.tick(now, available, stopped);
    this.active = null;
    if (completed) return completed;
    return available && code === 'KeyF' && elapsed <= TAP_SECONDS ? 'range' : null;
  }

  tick(now, available, stopped) {
    if (!available) { this.cancel(); return null; }
    if (!this.active) return null;
    const elapsed = Math.max(0, now - this.startedAt);
    if (this.active === 'KeyF' && elapsed > TAP_SECONDS && !stopped) {
      this.active = null;
      return 'moving';
    }
    if (elapsed < HOLD_SECONDS) return null;
    const action = this.active === 'KeyF' ? 'repair' : 'abandon';
    this.active = null;
    return action;
  }

  cancel() {
    this.pressed.clear();
    this.active = null;
  }

  reset() {
    this.cancel();
    this.repairTotal = 0;
  }

  readout(now, remaining, available) {
    if (!available) return null;
    const v = this.view;
    if (this.active === 'KeyJ') {
      const elapsed = Math.max(0, now - this.startedAt);
      v.kind = 'abandon'; v.phase = 'prepare'; v.progress = Math.min(1, elapsed / HOLD_SECONDS); v.seconds = Math.max(0, HOLD_SECONDS - elapsed);
      return v;
    }
    if (remaining > 0) {
      this.repairTotal = Math.max(this.repairTotal, remaining);
      v.kind = 'repair'; v.phase = 'repair'; v.progress = Math.max(0, Math.min(1, 1 - remaining / this.repairTotal)); v.seconds = remaining;
      return v;
    }
    this.repairTotal = 0;
    if (this.active === 'KeyF') {
      const elapsed = Math.max(0, now - this.startedAt);
      if (elapsed <= TAP_SECONDS) return null;
      v.kind = 'repair'; v.phase = 'prepare'; v.progress = Math.min(1, elapsed / HOLD_SECONDS); v.seconds = Math.max(0, HOLD_SECONDS - elapsed);
      return v;
    }
    return null;
  }
}

/** Native SVG/DOM indicator, independent of the scene's rendering resolution. */
export class VehicleActionIndicator {
  constructor(root) {
    this.root = root;
    this.ring = root.querySelector('[data-action-ring]');
    this.title = root.querySelector('[data-action-title]');
    this.note = root.querySelector('[data-action-note]');
  }

  update(view) {
    this.root.hidden = !view;
    if (!view) return;
    const progress = Math.max(0, Math.min(1, view.progress));
    this.root.dataset.kind = view.kind;
    this.root.dataset.phase = view.phase;
    this.root.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
    this.ring.style.strokeDashoffset = String(1 - progress);
    if (view.kind === 'abandon') {
      this.title.textContent = 'J　放棄載具';
      this.note.textContent = `再按住 ${view.seconds.toFixed(1)} 秒 · 松開取消`;
    } else if (view.phase === 'repair') {
      this.title.textContent = '正在修復車輛';
      this.note.textContent = `剩餘 ${Math.ceil(view.seconds)} 秒 · 修復時無法移動`;
    } else {
      this.title.textContent = 'F　準備修復';
      this.note.textContent = `再按住 ${view.seconds.toFixed(1)} 秒 · 松開取消`;
    }
    this.root.setAttribute('aria-label', this.title.textContent);
  }
}

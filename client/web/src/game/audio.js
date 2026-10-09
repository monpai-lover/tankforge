// Small synthesised sound set (WebAudio, no assets): engine drone tied to rpm and load,
// track rumble tied to speed, gun report, impact and reload click.
// Sample slots. Put an audio file with one of these names (.ogg / .mp3 / .wav) in
// client/web/assets/sfx/ and rebuild: it is embedded in the page and replaces the synthesised sound.
export const SFX_SLOTS = ['engine_loop', 'track_loop', 'shot_light', 'shot_medium', 'shot_heavy', 'mg_light', 'mg_heavy', 'impact_ground', 'impact_metal', 'reload_done', 'rangefinder'];

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineOn = true;
    this.lastMg = 0;
    this.pending = {};
    this.samples = {};
  }

  /** urls: {slot: data-URL or URL}. Decoded when the audio context exists. */
  loadSamples(urls) {
    Object.assign(this.pending, urls || {});
    return this._decodePending();
  }

  async _decodePending() {
    if (!this.ctx) return;
    const entries = Object.entries(this.pending);
    this.pending = {};
    for (const [slot, url] of entries) {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        this.samples[slot] = await this.ctx.decodeAudioData(buf);
        if (slot === 'engine_loop') this._startLoop('engine_loop', this.engGain);
        if (slot === 'track_loop') this._startLoop('track_loop', this.trackGain);
      } catch (err) {
        console.warn('sound sample not usable:', slot, err.message);
      }
    }
  }

  _startLoop(slot, gainNode) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.samples[slot];
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 3;
    src.connect(g);
    g.connect(gainNode);
    src.start();
    this.loops = this.loops || {};
    this.loops[slot] = src;
    // the recorded loop takes over from the synthesised one
    if (slot === 'engine_loop') this.engFilter.disconnect();
    if (slot === 'track_loop') this.trackFilter.disconnect();
  }

  _play(slot, gain = 1, rate = 1) {
    const buf = this.samples[slot];
    if (!buf) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.master);
    src.start();
    return true;
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 300;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    this.osc1.connect(this.engFilter);
    this.osc2.connect(g2);
    g2.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.master);
    this.osc1.start();
    this.osc2.start();

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    this.trackFilter = ctx.createBiquadFilter();
    this.trackFilter.type = 'bandpass';
    this.trackFilter.frequency.value = 180;
    this.trackFilter.Q.value = 0.8;
    this.trackGain = ctx.createGain();
    this.trackGain.gain.value = 0;
    src.connect(this.trackFilter);
    this.trackFilter.connect(this.trackGain);
    this.trackGain.connect(this.master);
    src.start();
    this._decodePending();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  /** rpmFrac 0..1, load 0..1, speed m/s */
  drive(rpmFrac, load, speed) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 28 + rpmFrac * 62;
    this.osc1.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(180 + rpmFrac * 500 + load * 350, t, 0.08);
    // in the garage the engine is off
    const on = this.engineOn ? 1 : 0;
    this.engGain.gain.setTargetAtTime(on * (0.1 + 0.12 * load + 0.05 * rpmFrac), t, 0.1);
    this.trackGain.gain.setTargetAtTime(on * Math.min(0.22, Math.abs(speed) * 0.025), t, 0.1);
    this.trackFilter.frequency.setTargetAtTime(140 + Math.abs(speed) * 22, t, 0.1);
    if (this.loops?.engine_loop) this.loops.engine_loop.playbackRate.setTargetAtTime(0.7 + rpmFrac * 0.9, t, 0.08);
    if (this.loops?.track_loop) this.loops.track_loop.playbackRate.setTargetAtTime(0.6 + Math.min(1.2, Math.abs(speed) / 10), t, 0.1);
  }

  _burst(duration, f0, f1, gain) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(f1, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(t, Math.random());
    src.stop(t + duration + 0.05);
  }

  shot(caliber) {
    if (!this.ctx) return;
    const slot = caliber < 60 ? 'shot_light' : caliber <= 100 ? 'shot_medium' : 'shot_heavy';
    if (this._play(slot, 1, 0.94 + Math.random() * 0.12) || this._play('shot_medium', Math.min(1.4, caliber / 88), 88 / Math.max(40, caliber) * 0.5 + 0.5)) return;
    const k = Math.min(1.3, caliber / 88);
    this._burst(1.3, 2400, 90, 1.5 * k);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(1.1 * k, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.65);
  }

  /** One machine-gun round. Calls closer together than a few hundredths of a second share a report. */
  mg(caliber) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (t - this.lastMg < 0.035) return;
    this.lastMg = t;
    const heavy = caliber > 10;
    if (this._play(heavy ? 'mg_heavy' : 'mg_light', 0.7, 0.95 + Math.random() * 0.1)) return;
    this._burst(heavy ? 0.16 : 0.1, heavy ? 2200 : 3400, heavy ? 260 : 520, heavy ? 0.6 : 0.38);
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(heavy ? 120 : 190, t);
    o.frequency.exponentialRampToValueAtTime(heavy ? 55 : 90, t + 0.06);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(heavy ? 0.28 : 0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + 0.08);
  }

  impact(distance, metal = false) {
    if (!this.ctx) return;
    if (this._play(metal ? 'impact_metal' : 'impact_ground', Math.max(0.1, 1 / (1 + distance / 150)))) return;
    this._burst(0.5, 1400, 120, Math.max(0.08, 0.6 / (1 + distance / 150)));
  }

  ping() {
    if (!this.ctx) return;
    if (this._play('rangefinder', 0.6)) return;
    this._burst(0.05, 5000, 2500, 0.18);
  }

  click() {
    if (!this.ctx) return;
    if (this._play('reload_done', 0.8)) return;
    this._burst(0.07, 3000, 900, 0.35);
  }

  /** A missile or rocket leaving its tube or rail: the eject bang and the motor's rushing roar. */
  launch(distance, heavy = false) {
    if (!this.ctx) return;
    const k = Math.max(0.06, 1 / (1 + distance / 120));
    this._burst(heavy ? 0.6 : 0.35, 2600, 160, 0.9 * k);
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.Q.value = 0.7;
    filt.frequency.setValueAtTime(500, t);
    filt.frequency.exponentialRampToValueAtTime(heavy ? 900 : 2400, t + (heavy ? 2.2 : 1.4));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.7 * k, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, t + (heavy ? 2.6 : 1.8));
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 2.8);
  }

  /** A warhead going off in the air or on the ground. */
  blast(kg, distance) {
    if (!this.ctx) return;
    const k = Math.max(0.05, 1 / (1 + distance / 200)) * Math.min(1.6, 0.5 + Math.cbrt(Math.max(kg, 0.1)) * 0.5);
    this._burst(1.4, 1800, 60, 1.3 * k);
  }

  /**
   * An active protection gun, kept running: the barrel cluster's whine with its speed (spin 0..1),
   * and while it fires the buzz of the rounds at the cyclic rate (a 10,000 rpm gun hums at 167 Hz).
   */
  apsGun(spin, firing, rpm, distance) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (!this.aps) {
      const whine = ctx.createOscillator();
      whine.type = 'triangle';
      const wg = ctx.createGain();
      wg.gain.value = 0;
      whine.connect(wg);
      wg.connect(this.master);
      whine.start();
      const buzz = ctx.createOscillator();
      buzz.type = 'sawtooth';
      const bf = ctx.createBiquadFilter();
      bf.type = 'lowpass';
      bf.frequency.value = 1800;
      const bg = ctx.createGain();
      bg.gain.value = 0;
      buzz.connect(bf);
      bf.connect(bg);
      bg.connect(this.master);
      buzz.start();
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuf;
      noise.loop = true;
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = 900;
      nf.Q.value = 0.6;
      const ng = ctx.createGain();
      ng.gain.value = 0;
      noise.connect(nf);
      nf.connect(ng);
      ng.connect(this.master);
      noise.start();
      this.aps = { whine, wg, buzz, bg, ng };
    }
    const a = this.aps;
    const k = Math.max(0.03, 1 / (1 + distance / 60));
    a.whine.frequency.setTargetAtTime(180 + spin * 1300, t, 0.05);
    a.wg.gain.setTargetAtTime(spin * 0.05 * k, t, 0.05);
    a.buzz.frequency.setTargetAtTime(Math.max(20, rpm / 60), t, 0.02);
    a.bg.gain.setTargetAtTime(firing ? 0.42 * k : 0, t, firing ? 0.008 : 0.04);
    a.ng.gain.setTargetAtTime(firing ? 0.55 * k : 0, t, firing ? 0.008 : 0.05);
  }

  /** The protection system's tones: a track found, a lock, too hot, empty, a fault. */
  tone(kind) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const seq = {
      detect: [[1300, 0.06]],
      lock: [[1800, 0.05], [0, 0.04], [1800, 0.05]],
      overheat: [[700, 0.12], [500, 0.12], [700, 0.12], [500, 0.12]],
      empty: [[320, 0.25]],
      fault: [[200, 0.18], [0, 0.06], [200, 0.18]],
      on: [[900, 0.05], [1200, 0.07]],
      off: [[1200, 0.05], [900, 0.07]],
    }[kind];
    if (!seq) return;
    let t = t0;
    for (const [f, d] of seq) {
      if (f > 0) {
        const o = ctx.createOscillator();
        o.type = kind === 'fault' ? 'square' : 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + d);
        o.connect(g);
        g.connect(this.master);
        o.start(t);
        o.stop(t + d + 0.02);
      }
      t += d;
    }
  }
}

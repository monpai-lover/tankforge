// Small synthesised sound set (WebAudio, no assets): engine drone tied to rpm and load,
// track rumble tied to speed, gun report, impact and reload click.
// Sample slots. Put an audio file with one of these names (.ogg / .mp3 / .wav) in
// client/web/assets/sfx/ and rebuild: it is embedded in the page and replaces the synthesised sound.
import { ReloadAudio, reloadProfile, observeReloadWork, observeReloadStage, observeReloadReady } from './audioReload.js';
import { FullAudio, validateFullBank } from './audioFull.js';

export const SFX_SLOTS = ['engine_loop', 'track_loop', 'shot_light', 'shot_medium', 'shot_heavy', 'mg_light', 'mg_heavy', 'impact_ground', 'impact_metal', 'reload_done', 'rangefinder'];

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineOn = true;
    this.lastMg = 0;
    this.pending = {};
    this.samples = {};
    this.reloadSamples = {};
    this.reloadUrls = {};
    this.reloadWanted = new Set();
    this.reloadDecoded = new Set();
    this.reloadPressure = new Map();
    this.reloadVoices = new Set();
    this.reloadAudio = new ReloadAudio((cue, owner) => this._playReloadCue(cue, owner));
    this.reloadEnabled = false;
    this.reloadAudible = true;
    this.reloadDecodeEpoch = 0;
    this.reloadBytes = 0;
    this.reloadDecodeInFlight = 0;
    this.fullDecodeInFlight = 0;
    this.full = null;
    this.fullOwned = false;
    this.delayedReloads = new Map();
  }

  get fullEnabled() { return this.fullOwned; }
  loadFullBank(bank) {
    this.cancelReloads({retainBlocked:true});
    this.full?.dispose(); this.full = null;
    if (!validateFullBank(bank)) return false;
    // A generated bank owns all migrated moments, even while a clip is decoding.
    for (const loop of Object.values(this.loops || {})) { try { loop.stop(); loop.disconnect(); } catch {} }
    for (const node of [this.osc1, this.osc2, this.trackSource, this.aps?.whine, this.aps?.buzz, this.aps?.noise]) { try { node?.stop(); node?.disconnect(); } catch {} }
    this.fullOwned = true; this.full = new FullAudio(this, bank); return true;
  }
  prepareFullBank(loadout, bundle) { this.full?.prepare(loadout, bundle); }
  setListener(value) { this.full?.setListener(value); }
  remoteAudioTime(domain, at, time) { return this.full?.remoteTime(domain,at,time) ?? time; }
  confirmFire(seq) { this.full?.confirm(seq); }
  rejectFire(seq) { this.full?.pending.delete(seq); }
  rotaryState(event) { this.full?.rotaryState(event); }
  vehicleState(event) { this.full?.vehicle(event); }
  contact(event) { this.full?.contact(event); }
  resolvedContact(report, shell, body, event = {}) {
    if (!report || !body) return;
    const point = p => Array.isArray(p) ? p : [p.x, p.y, p.z];
    const layer = report.layers?.[0], local = layer?.point || report.impact;
    this.contact({ ...event, eventId:event.eventId ?? report, position:local ? body.worldPoint(point(local)) : event.position || body.origin?.(), outcome:report.outcome, material:layer?.material || layer?.crossing?.material, shellKind:shell?.kind, caliber:shell?.caliber_mm, bursts:(report.bursts || []).map(b=>({...b,worldPosition:body.worldPoint(point(b.pos))})), spall:report.fragments?.some(f=>f.kind==='spall'), debris:report.fragments?.some(f=>f.kind==='shell'||f.kind==='burst')?'metal_debris':null, cookoff:report.events?.includes('ammo_detonation'), ricochet:report.ricochet_dir && body.worldDir(point(report.ricochet_dir)) });
  }
  projectileSegment(event) { this.full?.segment(event); }
  removeProjectile(id) { this.full?.removeProjectile(id); }
  resetMissiles() { this.full?.resetMissiles(); }
  mgLoading(m, st, previous) { this.full?.mgLoading(m, st, previous); }
  uiCue(kind) { this.full?.ui(kind); }
  cancelFull() { for(const voice of [...this.delayedReloads.values()])voice.stop(); this.aircraftShots?.clear(); this.full?.cancel(); }
  cancelOwner(owner) { this.full?.cancelOwner(owner); }
  setFullAudible(on) { this.full?.suspend(!on); }
  dispose() {
    this.cancelReloads(); this.full?.dispose();
    for (const node of [this.osc1, this.osc2, this.trackSource, ...Object.values(this.loops || {}), this.aps?.whine, this.aps?.buzz, this.aps?.noise]) { try { node?.stop(); node?.disconnect(); } catch {} }
    for (const node of [this.master, this.compressor]) { try { node?.disconnect(); } catch {} }
    const ctx=this.ctx;this.ctx=null;this.master=null;this.compressor=null;this.full=null;this.reloadDecodeEpoch++;
    this.reloadSamples={};this.reloadWanted.clear();this.reloadDecoded.clear();this.reloadPressure.clear();this.reloadBytes=0;
    try { ctx?.close(); } catch {}
  }

  /** Build-verified reviewed selections only; raw/candidate banks remain silent. */
  loadReloadBank(bank) {
    this.cancelReloads({ retainBlocked: true });
    this.reloadDecodeEpoch++;
    this.reloadSamples = {};
    this.reloadUrls = {};
    this.reloadWanted.clear();
    this.reloadDecoded.clear();
    this.reloadPressure.clear();
    this.reloadBytes = 0;
    const manual = bank?.reviewState === 'reviewed';
    const automatic = bank?.automaticAdoption?.source === 'human-direct-instruction' && bank.automaticAdoption.scope === 'three-fitted-az-t72-stages' && bank.automaticAdoption.mechanism === 'az_t72';
    this.reloadEnabled = bank?.schemaVersion === 1 && (manual || automatic) && !!bank.cues;
    if (!this.reloadEnabled) return false;
    for (const [id, cue] of Object.entries(bank.cues)) {
      if ((manual && /^(de|su|us)_manual_(grab|load|lock)$/.test(id) || automatic && /^az_t72_(drive|ram|lock)$/.test(id)) && typeof cue.url === 'string') this.reloadUrls[id] = cue.url;
    }
    return true;
  }

  /** Pin only this loadout's compatible styles, never the entire detailed bank. */
  prepareReloadBank(loadout) {
    if (!this.reloadEnabled) return;
    for (const t of loadout.turrets) for (const gun of t.guns) for (const a of gun.ammo) {
      const p = reloadProfile(gun.def, a.shell, gun.mechanizedLoading);
      if (p) for (const stage of p.staged ? ['drive', 'ram', 'lock'] : ['grab', 'load', 'lock']) {
        const id = p.staged ? `az_t72_${stage}` : `${p.style}_manual_${stage}`;
        if (this.reloadUrls[id] && !this.reloadDecoded.has(id) && !this.reloadPressure.has(id)) this.reloadWanted.add(id);
      }
    }
    this._decodeReloadPending();
  }

  async _decodeReloadPending() {
    this.full?.syncContext();
    if (!this.ctx || this.reloadDecodeRunning) return;
    for (const [id, bytes] of this.reloadPressure) if (this._reloadCacheRoom(bytes)) {
      this.reloadPressure.delete(id);
      this.reloadWanted.add(id);
    }
    if (!this.ctx || this.reloadDecodeRunning || !this.reloadWanted.size) return;
    this.reloadDecodeRunning = true;
    const epoch = this.reloadDecodeEpoch;
    const ctx = this.ctx;
    const worker = async () => {
      while (epoch === this.reloadDecodeEpoch && this.reloadWanted.size) {
        if(this.fullOwned&&this.reloadDecodeInFlight+this.fullDecodeInFlight>=2)break;
        const id = this.reloadWanted.values().next().value;
        const url = this.reloadUrls[id];
        this.reloadWanted.delete(id);
        this.reloadDecoded.add(id);
        this.reloadDecodeInFlight++;
        try {
          const data = await (await fetch(url)).arrayBuffer();
          const buffer = await ctx.decodeAudioData(data);
          const bytes = buffer.length * buffer.numberOfChannels * 4;
          if (epoch !== this.reloadDecodeEpoch || ctx !== this.ctx) continue;
          if (Number.isFinite(bytes) && bytes > 0 && this._reloadCacheRoom(bytes)) {
            this.reloadSamples[id] = buffer;
            this.reloadBytes += bytes;
            this.reloadPressure.delete(id);
          } else if (Number.isFinite(bytes) && bytes > 0 && bytes <= 32 * 1024 * 1024) {
            // Pressure retains only the required size, never rejected decoded PCM.
            this.reloadDecoded.delete(id);
            if (this.reloadPressure.size < 96) this.reloadPressure.set(id, bytes);
          }
        } catch { /* A missing/undecodable selected cue is silent, never synthesized. */ }
        finally {
          if ((epoch !== this.reloadDecodeEpoch || ctx !== this.ctx) && this.ctx && this.reloadUrls[id] === url && !this.reloadSamples[id]) {
            this.reloadDecoded.delete(id);
            this.reloadWanted.add(id);
          }
          this.reloadDecodeInFlight--;
          this.full?.decode();
        }
      }
    };
    await Promise.all([worker(), worker()]);
    this.reloadDecodeRunning = false;
    if (epoch !== this.reloadDecodeEpoch) this._decodeReloadPending();
  }

  _reloadCacheRoom(bytes) {
    if (this.full) return this.full.makeCacheRoom(bytes);
    return Number.isFinite(bytes) && bytes > 0 && this.reloadBytes + bytes <= 32 * 1024 * 1024 && Object.keys(this.reloadSamples).length < 96;
  }

  _playReloadCue(id, owner, admitted = false) {
    this.full?.syncContext();
    const delayed=this.full&&owner&&/(_manual_grab|az_t72_drive)$/.test(id);
    if(delayed&&!admitted&&!this.full.fireTimes.has(owner)) {
      if(this.delayedReloads.size>=8)return null;
      let stopped=false,voice=null;
      const waiting={release:()=>{if(stopped)return;this.delayedReloads.delete(owner);voice=this._playReloadCue(id,owner,true);},stop:()=>{stopped=true;voice?.stop();if(this.delayedReloads.get(owner)===waiting)this.delayedReloads.delete(owner);}};
      this.delayedReloads.set(owner,waiting);return waiting;
    }
    const buffer = this.reloadSamples[id];
    if (!this.ctx || !this.master || !buffer || !this.reloadAudible || this.muted || this.ctx.state === 'suspended' || this.reloadVoices.size >= 8) return null;
    let source = null, gain = null, voice = null, ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      // Release admission and references before independently attempting node cleanup.
      const oldSource = source, oldGain = gain;
      this.reloadVoices.delete(voice);
      source = gain = voice = null;
      try { if (oldGain) oldGain.gain.value = 0; } catch { /* Continue teardown. */ }
      try { if (oldSource) oldSource.onended = null; } catch { /* Continue teardown. */ }
      try { oldSource?.disconnect(); } catch { /* Continue with the other node. */ }
      try { oldGain?.disconnect(); } catch { /* Admission is already released. */ }
    };
    const stop = () => {
      if (ended) return;
      try { source?.stop(); } catch { /* Partial setup, ended or unavailable node. */ }
      finally { finish(); }
    };
    try {
      source = this.ctx.createBufferSource();
      gain = this.ctx.createGain();
      source.buffer = buffer;
      source.loop = false;
      source.playbackRate.value = 1;
      gain.gain.value = .8;
      source.connect(gain);
      const bus=this.full?this.full.bus('loading'):this.master;
      if(!bus)throw new Error('Loading audio bus unavailable');
      gain.connect(bus);
      voice = { stop };
      source.onended = finish;
      this.reloadVoices.add(voice);
      const fireTime=delayed?this.full.fireTimes.get(owner):null;
      const startAt=Number.isFinite(fireTime)?Math.max(this.ctx.currentTime,(this.full.clock??this.ctx.currentTime-this.full.listener.time)+fireTime+1.5):this.ctx.currentTime;
      source.start(startAt);
      return ended ? null : voice;
    } catch {
      stop();
      return null; // Presentation failure must not abort actual loading work.
    }
  }

  reloadWork(gun, L, gi, rate) {
    this.full?.syncContext();
    if(this.full&&!this.reloadAudio.jobs.has(gun)&&this.reloadAudio.size+this.full.jobs.size>=8)return true;
    if (this.reloadEnabled && reloadProfile(gun.def,gun.ammo[gun.loaded>=0?gun.loaded:gun.selected]?.shell,gun.mechanizedLoading)) return observeReloadWork(this.reloadAudio, gun, L, gi, rate);
    return this.full?.work(gun,L,gi,rate) || false;
  }

  reloadStage(gun, L, gi, event) {
    this.full?.syncContext();
    return this.reloadEnabled && observeReloadStage(this.reloadAudio, gun, L, gi, event);
  }

  reloadReady(gun, L, gi) {
    this.full?.syncContext();
    if (!this.reloadEnabled) return this.full?.ready(gun) || false;
    // Completion policy belongs to this installed weapon/round, even if its job
    // was blocked, budget-limited or inaudible. Playback still requires actual ready.
    const round = gun.ammo[gun.loaded >= 0 ? gun.loaded : gun.selected];
    const owned = !!reloadProfile(gun.def, round?.shell, gun.mechanizedLoading);
    observeReloadReady(this.reloadAudio, gun, L, gi);
    return owned || this.full?.ready(gun) || false;
  }

  cancelReload(gun, blockCycle = false, cycle) { this.reloadAudio.cancel(gun, { blockCycle, cycle }); this.delayedReloads.get(gun)?.stop(); this.full?.cancelJob(gun); }
  setReloadAudible(on) {
    this.reloadAudible = !!on;
    if (!on) this.suspendReloads();
  }
  suspendReloads() {
    this.reloadAudio.suspend();
    for (const voice of this.reloadVoices) voice.stop();
    for(const voice of [...this.delayedReloads.values()])voice.stop();
  }
  cancelReloads(options) {
    this.reloadAudio.cancelAll(options);
    for (const voice of this.reloadVoices) voice.stop();
    for(const voice of [...this.delayedReloads.values()])voice.stop();
    if (this.full) for (const owner of this.full.jobs.keys()) this.full.cancelJob(owner);
  }

  /** urls: {slot: data-URL or URL}. Decoded when the audio context exists. */
  loadSamples(urls) {
    Object.assign(this.pending, urls || {});
    return this._decodePending();
  }

  async _decodePending() {
    if (!this.ctx || this.fullOwned) return;
    const entries = Object.entries(this.pending);
    this.pending = {};
    for (const [slot, url] of entries) {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const decoded = await this.ctx.decodeAudioData(buf);
        if(this.fullOwned)continue;
        this.samples[slot] = decoded;
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

  _buildOutputGraph(ctx) {
    for (const node of [this.master, this.compressor]) { try { node?.disconnect(); } catch {} }
    this.master = this.compressor = null;
    if (!ctx) return;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    if (this.fullOwned && ctx.createDynamicsCompressor) {
      try {
        this.compressor = ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -8;
        this.compressor.knee.value = 12;
        this.compressor.ratio.value = 8;
        this.compressor.attack.value = .001;
        this.compressor.release.value = .2;
        this.master.connect(this.compressor);
        this.compressor.connect(ctx.destination);
        return;
      } catch { try { this.compressor?.disconnect(); } catch {} this.compressor = null; }
    }
    this.master.connect(ctx.destination);
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx?.state === 'closed') this.ctx = null;
    if (this.ctx) { if(this.ctx.state==='suspended') { try { this.ctx.resume?.()?.catch?.(()=>{}); } catch {} } return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this._buildOutputGraph(ctx);

    if (this.fullOwned) { this.full?.decode(); this._decodeReloadPending(); return; }

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
    this.trackSource = src;
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
    this._decodeReloadPending();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  /** rpmFrac 0..1, load 0..1, speed m/s */
  drive(rpmFrac, load, speed) {
    if (this.fullOwned) return;
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

  shot(caliber, event) {
    if (caliber === 50 && event?.weaponId === 'air_cannon' && this.aircraftShots?.play('mk214a', event.eventId, event.position, event.velocity, event.time, event.emitterId)) return;
    if (this.fullOwned) return this.full?.weapon(caliber, event, 'weapon');
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
  mg(caliber, event) {
    if (this.fullOwned) return this.full?.weapon(caliber, event, event?.kind === 'weapon' ? 'weapon' : 'mg');
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

  impact(distance, metal = false, event) {
    if (this.fullOwned) { if (event) this.full?.contact(event); return; }
    if (!this.ctx) return;
    if (this._play(metal ? 'impact_metal' : 'impact_ground', Math.max(0.1, 1 / (1 + distance / 150)))) return;
    this._burst(0.5, 1400, 120, Math.max(0.08, 0.6 / (1 + distance / 150)));
  }

  ping() {
    if (this.fullOwned) return this.full?.ui('rangefinder');
    if (!this.ctx) return;
    if (this._play('rangefinder', 0.6)) return;
    this._burst(0.05, 5000, 2500, 0.18);
  }

  click(caliber = 75) {
    if (this.fullOwned) return this.full?.ui('ready',caliber);
    if (!this.ctx) return;
    if (this._play('reload_done', 0.8)) return;
    this._burst(0.07, 3000, 900, 0.35);
  }

  /** A missile or rocket leaving its tube or rail: the eject bang and the motor's rushing roar. */
  launch(distance, heavy = false, event) {
    if (this.fullOwned) { if (event) this.full?.launch(event); return; }
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
  blast(kg, distance, event) {
    if (this.fullOwned) { if (event) this.full?.contact({ ...event, bursts: [{ explosive_kg: kg, position:event.position }] }); return; }
    if (!this.ctx) return;
    const k = Math.max(0.05, 1 / (1 + distance / 200)) * Math.min(1.6, 0.5 + Math.cbrt(Math.max(kg, 0.1)) * 0.5);
    this._burst(1.4, 1800, 60, 1.3 * k);
  }

  /**
   * An active protection gun, kept running: the barrel cluster's whine with its speed (spin 0..1),
   * and while it fires the buzz of the rounds at the cyclic rate (a 10,000 rpm gun hums at 167 Hz).
   */
  apsGun(spin, firing, rpm, distance) {
    if (this.fullOwned) return;
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
      this.aps = { whine, wg, buzz, bg, ng, noise };
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
    if (this.fullOwned) return this.full?.ui(kind);
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

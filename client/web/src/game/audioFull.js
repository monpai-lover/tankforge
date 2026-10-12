// Generated-bank presentation only: these owners never change simulation state.
import { createRunningGearComposite } from './audioRunningGearComposite.js';
const ID = /^[A-Za-z][A-Za-z0-9_:-]{0,127}$/;
const BINDING = /^(gun|mg|missile|engine):[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const BINDING_PREFIXES = { weapon: ["gun", "mg"], mg: ["mg", "gun"], missile: ["gun", "missile"], engine: ["engine"], loading: ["gun"], runningGear: [], surface: [], impact: [], blast: [], flight: [], ui: [] };
const vec = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const massClass = (kg) => kg < 0.05 ? "micro" : kg < 0.25 ? "small" : kg < 1 ? "medium" : kg < 5 ? "large" : "very_heavy";
const safe = (fn) => {
  try {
    return fn();
  } catch {
    return null;
  }
};
const bindingKey = (kind, binding) => {
  if (kind === "weapon" || kind === "mg") {
    if (binding.startsWith("gun:")) kind = "weapon";
    else if (binding.startsWith("mg:")) kind = "mg";
  }
  return kind + ":" + binding;
};
function validateFullBank(bank) {
  if (bank?.schemaVersion !== 1 || bank.selectionState !== "user-directed" || bank.adoption?.source !== "human-direct-instruction" || bank.adoption.statement !== "\u540C\u6642\u5B8C\u6210\u6240\u6709\u7684\u97F3\u6548\u751F\u6210\u548C\u66FF\u63DB" || !Array.isArray(bank.profiles) || !bank.cues) return false;
  const ids = /* @__PURE__ */ new Set(), bindings = /* @__PURE__ */ new Set();
  for (const [id, c] of Object.entries(bank.cues)) if (!ID.test(id) || typeof c.url !== "string" || !/^[a-f0-9]{64}$/.test(c.sha256) || typeof c.loop !== "boolean" || !Number.isFinite(c.durationSeconds) || c.durationSeconds <= 0 || c.durationSeconds > 30) return false;
  for (const p of bank.profiles) {
    if (!p || typeof p.id !== "string" || !ID.test(p.id) || ids.has(p.id) || typeof p.kind !== "string" || !Object.hasOwn(BINDING_PREFIXES, p.kind) || !Array.isArray(p.bindings) || !p.cues || Object.values(p.cues).some((id) => !bank.cues[id] && !bank.externalCues?.[id])) return false;
    ids.add(p.id);
    for (const b of p.bindings) {
      const key = typeof b === "string" ? bindingKey(p.kind, b) : null;
      if (typeof b !== "string" || !BINDING.test(b) || !BINDING_PREFIXES[p.kind].includes(b.slice(0, b.indexOf(":"))) || bindings.has(key)) return false;
      bindings.add(key);
    }
  }
  return true;
}
class FullAudio {
  constructor(sound, bank) {
    this.sound = sound;
    this.bank = bank;
    this.profiles = bank.profiles;
    this.bindings = /* @__PURE__ */ new Map();
    this.buffers = /* @__PURE__ */ new Map();
    this.cache = /* @__PURE__ */ new Map();
    this.derivedCues = /* @__PURE__ */ new Map();
    this.wanted = /* @__PURE__ */ new Set();
    this.pinned = /* @__PURE__ */ new Set();
    this.failed = /* @__PURE__ */ new Set();
    this.voices = /* @__PURE__ */ new Set();
    this.loops = /* @__PURE__ */ new Map();
    this.rigs = /* @__PURE__ */ new Map();
    this.rotaries = /* @__PURE__ */ new Map();
    this.trackers = /* @__PURE__ */ new Map();
    this.motorReservations = /* @__PURE__ */ new Set();
    this.motorContext = sound.ctx;
    this.jobs = /* @__PURE__ */ new Map();
    this.pending = /* @__PURE__ */ new Map();
    this.seen = /* @__PURE__ */ new Map();
    this.epoch = 0;
    this.bytes = 0;
    this.decodeWorkers = 0;
    this.active = true;
    this.listener = { position: [0, 0, 0], forward: [0, 0, 1], up: [0, 1, 0], velocity: [0, 0, 0], time: 0 };
    this.clock = null;
    this.objectIds = /* @__PURE__ */ new WeakMap();
    this.nextObjectId = 0;
    this.selectors = /* @__PURE__ */ new Map();
    this.buses = new Map();
    this.cueKinds = new Map();
    this.byId = /* @__PURE__ */ new Map();
    this.remoteClocks = /* @__PURE__ */ new Map();
    this.fireTimes = /* @__PURE__ */ new WeakMap();
    this.decoding = /* @__PURE__ */ new Set();
    this.pressure = /* @__PURE__ */ new Set();
    for (const p of this.profiles) {
      for(const id of Object.values(p.cues))this.cueKinds.set(id,p.kind);
      this.byId.set(p.id, p);
      for (const b of p.bindings) this.bindings.set(bindingKey(p.kind, b), p);
      for (const key of [p.selector, p.family, p.identity, p.id].filter(Boolean)) {
        const index = p.kind + ":" + key, previous = this.selectors.get(index);
        this.selectors.set(index, { ...p, cues: { ...previous?.cues, ...p.cues } });
      }
    }
  }
  profile(kind, id) {
    return this.bindings.get(kind + ":" + id) || this.bindings.get(kind + ":" + ({ weapon: "gun", mg: "mg", missile: "missile", engine: "engine", loading: "gun" }[kind] || kind) + ":" + id);
  }
  effect(kind, id) {
    return this.selectors.get(kind + ":" + id) || this.selectors.get(kind + ":" + kind + "_" + id);
  }
  generic(cal) {
    return cal < 60 ? this.effect("weapon", "custom_light") : cal <= 100 ? this.profile("weapon", "gun_75") : this.effect("weapon", "custom_heavy");
  }
  loadingProfile(def, kind = "weapon") {
    const ref = this.bank.reloads?.[kind]?.[def.id]?.profile;
    return this.byId.get(ref) || this.profile("loading", def.id) || (kind === "weapon" && /^gun_custom_/.test(def.id) ? this.byId.get("loading_manual_us") : null);
  }
  remoteTime(domain, at, time) {
    if (!Number.isFinite(at) || !Number.isFinite(time)) return time;
    const sample = time - at, old = this.remoteClocks.get(domain);
    const offset = old === void 0 ? sample : Math.min(old, sample);
    this.remoteClocks.set(domain, offset);
    return at + offset;
  }
  request(id, pin = false) {
    this.syncContext();
    const defined = this.bank.cues[id] || this.bank.externalCues?.[id] || this.derivedCues.get(id);
    if (pin && defined) this.pinned.add(id);
    if (!defined?.url || this.buffers.has(id) || this.sound.reloadSamples?.[id] || this.sound.reloadWanted?.has(id) || this.sound.reloadDecoded?.has(id) || this.sound.reloadPressure?.has(id) || this.failed.has(id) || this.decoding.has(id) || this.pressure.has(id)) return;
    if (this.wanted.size < 96) this.wanted.add(id);
    this.decode();
  }
  prepare(loadout, bundle) {
    this.pinned.clear();
    this.pressure.clear();
    for (const t of loadout?.turrets || []) for (const g of t.guns) {
      for (const kind of ["weapon", "loading"]) {
        const p2 = kind === "loading" ? this.loadingProfile(g.def) : this.profile(kind, g.def.id) || this.generic(g.def.caliber_mm);
        if (p2) for (const id of Object.values(p2.cues)) this.request(id, true);
      }
      if (g.def.missile) {
        const p2 = this.profile("missile", g.def.missile);
        if (p2) for (const id of Object.values(p2.cues)) this.request(id, true);
      }
    }
    for (const m of loadout?.machineGuns || []) {
      for (const kind of ["mg", "mgLoading"]) {
        const p2 = kind === "mgLoading" ? this.loadingProfile(m.def, "mg") : this.profile(kind, m.def.id);
        if (p2) for (const id of Object.values(p2.cues)) this.request(id, true);
      }
    }
    const p = this.profile("engine", bundle?.engine?.audio_source_vehicle||loadout?.id) || this.profile("engine", bundle?.engine?.audio_kind) || this.effect("engine", "E15");
    if (p) for (const id of Object.values(p.cues)) this.request(id, true);
    for (const p2 of this.profiles) if (["ui", "impact", "blast", "flight"].includes(p2.kind)) for (const id of Object.values(p2.cues)) this.request(id, true);
  }
  decode() {
    this.syncContext();
    const ctx = this.sound.ctx;
    if (!ctx) return;
    if(this.sound.reloadWanted?.size)this.sound._decodeReloadPending();
    while ((this.sound.fullDecodeInFlight||0) + (this.sound.reloadDecodeInFlight||0) < 2 && this.wanted.size) {
      const id = this.wanted.values().next().value;
      this.wanted.delete(id);
      this.decoding.add(id);
      const epoch = this.epoch;
      this.decodeWorkers++;
      this.sound.fullDecodeInFlight++;
      (async () => {
        try {
          const bytes = await (await fetch((this.bank.cues[id] || this.bank.externalCues[id]).url)).arrayBuffer();
          const b = await ctx.decodeAudioData(bytes);
          if (epoch !== this.epoch || this.sound.ctx !== ctx) return;
          const size = b.length * b.numberOfChannels * 4;
          const limit = 32 * 1024 * 1024 - (this.sound.reloadBytes || 0);
          if (!Number.isFinite(size) || size <= 0 || size > limit) {
            this.failed.add(id);
            return;
          }
          if (this.makeCacheRoom(size)) {
            this.buffers.set(id, b);
            this.cache.set(id, { bytes: size });
            this.bytes += size;
          } else this.pressure.add(id);
        } catch {
          if (epoch === this.epoch && this.sound.ctx === ctx) this.failed.add(id);
        } finally {
          this.decodeWorkers--;
          this.sound.fullDecodeInFlight--;
          this.decoding.delete(id);
          if ((epoch !== this.epoch || this.sound.ctx !== ctx) && this.sound.full === this && this.sound.ctx && !this.buffers.has(id)) this.wanted.add(id);
          this.sound._decodeReloadPending();
          this.sound.full?.decode();
        }
      })();
    }
  }
  makeCacheRoom(size) {
    const limit = 32 * 1024 * 1024 - (this.sound.reloadBytes || 0), entries = 96 - Object.keys(this.sound.reloadSamples || {}).length;
    if (!Number.isFinite(size) || size <= 0 || size > limit || entries <= 0) return false;
    while (this.bytes + size > limit || this.buffers.size >= entries) {
      let victim;
      for (const entry of this.cache) {
        if (this.pinned.has(entry[0])) continue;
        let active = false;
        for (const voice of this.voices) if (voice.id === entry[0]) { active = true; break; }
        if (!active) { victim = entry; break; }
      }
      if (!victim) return false;
      this.cache.delete(victim[0]);
      this.buffers.delete(victim[0]);
      if (this.derivedCues.delete(victim[0])) this.cueKinds.delete(victim[0]);
      this.bytes -= victim[1].bytes;
    }
    return true;
  }
  runningGearCue(gearId, surfaceId) {
    if (!surfaceId) return gearId;
    const id = "runningGear:" + gearId + ":" + surfaceId;
    if (this.buffers.has(id)) return id;
    this.request(gearId); this.request(surfaceId);
    const gear = this.buffers.get(gearId), surface = this.buffers.get(surfaceId);
    if (!gear || !surface || gear.length !== surface.length || gear.numberOfChannels !== surface.numberOfChannels || gear.sampleRate !== surface.sampleRate || !this.sound.ctx?.createBuffer) return null;
    const size = gear.length * gear.numberOfChannels * 4;
    if (!this.makeCacheRoom(size)) return null;
    const level = cue => typeof cue.level === "number" ? cue.level : cue.level?.gain ?? 0.65;
    const composite = createRunningGearComposite(this.sound.ctx, gear, surface, {gearLevel:level(this.bank.cues[gearId]),surfaceLevel:level(this.bank.cues[surfaceId]),maxBytes:32*1024*1024-(this.sound.reloadBytes||0)-this.bytes});
    if (!composite) return null;
    this.buffers.set(id, composite.buffer);
    this.cache.set(id, {bytes:composite.bytes});
    this.bytes += composite.bytes;
    this.derivedCues.set(id, {loop:true,level:1});
    this.cueKinds.set(id, "runningGear");
    return id;
  }
  setListener(value) {
    this.syncContext();
    if (!vec(value?.position) || !Number.isFinite(value.time)) return;
    this.listener = { ...this.listener, ...value };
    const ctx = this.sound.ctx;
    if (!ctx) return;
    if (this.clock === null) this.clock = ctx.currentTime - value.time;
    const l = ctx.listener;
    if (l) {
      for (const [prefix, v] of [["position", value.position], ["forward", value.forward], ["up", value.up]]) if (vec(v)) for (let i = 0; i < 3; i++) safe(() => {
        const p = l[prefix + "XYZ"[i]];
        if (p) p.setValueAtTime(v[i], ctx.currentTime);
      });
    }
    for (const [id, p] of this.pending) if (value.time - p.created > 3) this.pending.delete(id);
    for (const [id, p] of this.trackers) if (value.time - p.time > 8) this.removeProjectile(id);
    for (const [id, p] of this.rigs) if (value.time - (p.time ?? value.time) > 1) this.cancelOwner(id);
    for (const [id, t] of this.seen) if (value.time - t > 30) this.seen.delete(id);
  }
  once(key, time) {
    if (key === void 0 || key === null) return true;
    if (this.seen.has(key)) return false;
    if (this.seen.size >= 2048) this.seen.delete(this.seen.keys().next().value);
    this.seen.set(key, Number.isFinite(time) ? time : this.listener.time);
    return true;
  }
  eventKey(prefix, id) {
    if (id === void 0 || id === null) return null;
    if (typeof id === "object") {
      if (!this.objectIds.has(id)) this.objectIds.set(id, ++this.nextObjectId);
      id = this.objectIds.get(id);
    }
    return prefix + ":" + id;
  }
  pose(voice, e) {
    if (!voice?.panner || !vec(e.position)) return;
    for (let i = 0; i < 3; i++) safe(() => voice.panner["position" + "XYZ"[i]].setValueAtTime(e.position[i], this.sound.ctx.currentTime));
    if (vec(e.direction)) for (let i = 0; i < 3; i++) safe(() => voice.panner["orientation" + "XYZ"[i]].setValueAtTime(e.direction[i], this.sound.ctx.currentTime));
  }
  bus(kind) {
    this.syncContext();
    const ctx=this.sound.ctx;if(!ctx||!this.sound.master)return null;
    if(this.busContext!==ctx){for(const node of this.buses.values())safe(()=>node.disconnect());this.buses.clear();this.busContext=ctx;}
    const group=kind==='mg'||kind==='weapon'||kind==='missile'?'weapons':kind==='surface'||kind==='runningGear'||kind==='engine'?'engine':kind==='blast'||kind==='impact'?'impact':kind==='loading'?'loading':kind==='ui'?'ui':'flight';
    if(!this.buses.has(group)){const node=safe(()=>{const gain=ctx.createGain();gain.gain.value=1;gain.connect(this.sound.master);return gain;});if(!node)return null;this.buses.set(group,node);}
    return this.buses.get(group);
  }
  play(id, e = {}, loop = false) {
    this.request(id);
    const s = this.sound, ctx = s.ctx, b = this.buffers.get(id) || s.reloadSamples?.[id], def = this.bank.cues[id] || this.bank.externalCues?.[id] || this.derivedCues.get(id);
    if (!this.active || s.muted || !ctx || ctx.state === "suspended" || !s.master || !b || !def) return null;
    const d = vec(e.position) ? distance(e.position, this.listener.position) : 0;
    if (d > 1800) return null;
    const priority = (e.ui ? 100 : String(e.emitterId || "").startsWith("player") ? 90 : loop ? 20 : 50) - d / 100;
    if (this.voices.size >= 52 || !loop && [...this.voices].filter((v) => !v.loop).length >= 24) {
      const candidate = [...this.voices].filter((v) => loop || !v.loop).sort((a, b2) => a.priority - b2.priority)[0];
      if (!candidate || candidate.priority >= priority) return null;
      candidate.stop();
    }
    let source, gain, panner, voice, ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      this.voices.delete(voice);
      if (voice?.key && this.loops.get(voice.key) === voice) this.loops.delete(voice.key);
      const oldSource = source, oldGain = gain, oldPanner = panner;
      source = gain = panner = null;
      if(voice){voice.source=voice.gain=voice.panner=null;}
      safe(() => {
        oldGain.gain.value = 0;
      });
      safe(() => {
        oldSource.onended = null;
      });
      safe(() => oldSource.disconnect());
      safe(() => oldGain.disconnect());
      safe(() => oldPanner?.disconnect());
    };
    const stop = () => {
      if (ended) return;
      safe(() => source?.stop());
      finish();
    };
    try {
      const bus=this.bus(this.cueKinds.get(id));if(!bus)return null;
      source = ctx.createBufferSource();
      gain = ctx.createGain();
      source.buffer = b;
      source.loop = loop;
      const level = typeof def.level === "number" ? def.level : def.level?.gain ?? 0.65;
      gain.gain.value = Math.max(0, Math.min(1, level)) * (e.gain ?? 1) / (1 + (d / 90) ** 2);
      source.playbackRate.value = clamp(e.rate ?? 1, 0.5, 2);
      source.connect(gain);
      if (vec(e.position) && ctx.createPanner) {
        panner = ctx.createPanner();
        panner.panningModel = "HRTF";
        panner.distanceModel = "inverse";
        panner.refDistance = 10;
        panner.maxDistance = 1800;
        panner.rolloffFactor = 0;
        panner.coneInnerAngle = 120;
        panner.coneOuterAngle = 270;
        panner.coneOuterGain = 0.5;
        gain.connect(panner);
        panner.connect(bus);
      } else gain.connect(bus);
      voice = { id, source, gain, panner, loop, owner: e.emitterId ?? e.owner, priority, stop };
      this.pose(voice, e);
      source.onended = finish;
      this.voices.add(voice);
      const time = Number.isFinite(e.time) ? e.time : this.listener.time;
      if (this.clock === null) this.clock = ctx.currentTime - time;
      const at = loop ? ctx.currentTime : Math.max(ctx.currentTime, this.clock + time + (e.ui ? 0 : d / 343));
      source.start(at);
      return voice;
    } catch {
      stop();
      return null;
    }
  }
  loop(key, id, e) {
    this.request(id);
    let v = this.loops.get(key);
    if (v?.id !== id) {
      v?.stop();
      v = null;
    }
    if (!v && this.loops.size >= 28) {
      if (!this.active || this.sound.muted || !this.sound.ctx || this.sound.ctx.state === "suspended" || !(this.buffers.has(id) || this.sound.reloadSamples?.[id])) return null;
      const d = vec(e.position) ? distance(e.position, this.listener.position) : 0;
      if (d > 1800) return null;
      const priority = (String(e.emitterId || "").startsWith("player") ? 90 : 20) - d / 100;
      let victim;
      for (const voice of this.loops.values()) if (!victim || voice.priority < victim.priority) victim = voice;
      if (!victim || victim.priority >= priority) return null;
      victim.stop();
    }
    if (!v) {
      v = this.play(id, e, true);
      if (v) {
        v.key = key;
        this.loops.set(key, v);
      }
    }
    if (v) {
      this.pose(v, e);
      safe(() => v.gain.gain.setTargetAtTime(clamp(e.gain ?? 0.2, 0, 1) / (1 + (distance(e.position || this.listener.position, this.listener.position) / 90) ** 2), this.sound.ctx.currentTime, 0.08));
      safe(() => v.source.playbackRate.setTargetAtTime(clamp(e.rate ?? 1, 0.5, 2), this.sound.ctx.currentTime, 0.08));
    }
    return v;
  }
  stopLoop(key) {
    this.loops.get(key)?.stop();
  }
  weapon(cal, e = {}, kind = "weapon") {
    this.syncContext();
    if (e.accepted === false) {
      if (Number.isSafeInteger(e.seq) && this.pending.size < 128) this.pending.set(e.seq, { cal, e: { ...e, accepted: true }, kind, created: this.listener.time });
      return;
    }
    const p = this.profile(kind, e.weaponId) || (/^gun_custom_|^gun_75$/.test(e.weaponId || "") || e.generic ? this.generic(cal) : null);
    if (!p) return;
    if (!this.once(e.eventId === void 0 ? null : "shot:" + e.emitterId + ":" + e.eventId, e.time)) return;
    if (e.owner && typeof e.owner === "object") {
      this.fireTimes.set(e.owner, Number.isFinite(e.time) ? e.time : this.listener.time);
      this.sound.delayedReloads?.get(e.owner)?.release();
    }
    if (p.mechanism === "rotary" || p.cues.fireLoop) {
      const r = this.rotaries.get(e.emitterId) || {};
      r.profile = p;
      r.event = e;
      r.fired = true;
      this.rotaries.set(e.emitterId, r);
      this.loop("rotary:" + e.emitterId, p.cues.fireLoop, { ...e, gain: 0.45 });
      return;
    }
    this.play(p.cues.report, e);
  }
  confirm(seq) {
    const p = this.pending.get(seq);
    this.pending.delete(seq);
    if (p) this.weapon(p.cal, p.e, p.kind);
  }
  rotaryState(e) {
    this.syncContext();
    const p = this.profile("weapon", e.weaponId);
    if (!p?.cues.fireLoop) return;
    let r = this.rotaries.get(e.emitterId);
    if (!r) {
      if (this.rotaries.size >= 6) return;
      r = { profile: p, spin: 0, fired: false };
      this.rotaries.set(e.emitterId, r);
    }
    if (e.spin > 0 && r.spin === 0) this.play(p.cues.spinUp, e);
    r.spin = e.spin;
    if (!e.firing) {
      this.stopLoop("rotary:" + e.emitterId);
      if (r.fired) this.play(p.cues.stop, e);
      r.fired = false;
    } else if (r.fired) this.loop("rotary:" + e.emitterId, p.cues.fireLoop, { ...e, gain: 0.45 });
    if (e.spin === 0 && !r.fired) this.rotaries.delete(e.emitterId);
  }
  launch(e) {
    this.syncContext();
    const p = this.profile("missile", e.missileId);
    if (!p || !this.once("launch:" + e.projectileId, e.time)) return;
    this.play(p.cues.launch, e);
    if (this.trackers.has(e.projectileId) || this.trackers.size < 128) {
      const tracker = { ...this.trackers.get(e.projectileId), ...e, motor: null, time: e.time ?? this.listener.time };
      this.trackers.set(e.projectileId, tracker);
      if (p.cues.motor && this.motorReservations.size < 4) {
        this.motorReservations.add(e.projectileId);
        tracker.motor = p.cues.motor;
        this.loop("motor:" + e.projectileId, p.cues.motor, { ...e, gain: 0.25 });
      }
    }
  }
  releaseMotor(id) {
    this.stopLoop("motor:" + id);
    this.motorReservations.delete(id);
    const tracker = this.trackers.get(id);
    if (tracker) tracker.motor = null;
  }
  syncContext() {
    if (this.motorContext === this.sound.ctx) return;
    const retired = this.motorContext;
    // Tag the replacement first: teardown and subsequent admissions may reenter.
    this.motorContext = this.sound.ctx;
    if (!retired) return;
    this.epoch++;
    this.sound.reloadDecodeEpoch++;
    for (const id of this.motorReservations) this.releaseMotor(id);
    for (const voice of [...this.voices]) voice.stop();
    this.loops.clear();
    this.rigs.clear();
    this.rotaries.clear();
    for (const job of this.jobs.values()) job.voices = [];
    this.sound.suspendReloads();
    for (const node of this.buses.values()) safe(() => node.disconnect());
    this.buses.clear();
    this.busContext = this.sound.ctx;
    this.clock = null;
    safe(() => this.sound._buildOutputGraph(this.sound.ctx));
  }
  resetMissiles() {
    for (const [id, tracker] of this.trackers) if (tracker.missileId) this.removeProjectile(id);
    for (const key of this.seen.keys()) if (key.startsWith("launch:")) this.seen.delete(key);
  }
  vehicle(e) {
    this.syncContext();
    const p = this.profile("engine", e.vehicleId) || this.profile("engine", e.engineKind) || this.effect("engine", e.engineFamily) || this.effect("engine", "E15");
    if (!p) return;
    let r = this.rigs.get(e.emitterId);
    if (!r) {
      if (this.rigs.size >= 6 || distance(e.position || this.listener.position, this.listener.position) > 400) return;
      r = { running: false, keys: /* @__PURE__ */ new Set() };
      this.rigs.set(e.emitterId, r);
    }
    if (!e.running) {
      if (r.running) this.play(p.cues.stop, e);
      for (const key of r.keys) this.stopLoop(key);
      this.rigs.delete(e.emitterId);
      return;
    }
    if (!r.running) this.play(p.cues.start, e);
    r.running = true;
    r.time = e.time;
    const f = clamp((e.rpm - e.idleRpm) / Math.max(1, e.maxRpm - e.idleRpm), 0, 1), x = f * 2, lo = Math.min(1, Math.floor(x)), mix = x - lo, bands = ["idle", "mid", "high"], want = /* @__PURE__ */ new Set();
    const movementRate=vec(e.velocity)&&vec(e.position)?this.doppler(e.velocity,e.position):1;
    const engineBands = [[lo, Math.cos(mix * Math.PI / 2)], [lo + 1, Math.sin(mix * Math.PI / 2)]];
    for (const [i, g] of engineBands) if (g > 0.01) want.add("engine:" + e.emitterId + ":" + bands[i]);
    if (e.load > 0.02) want.add("engine:" + e.emitterId + ":load");
    const speed = Math.max(Math.abs(e.track?.[0] || 0), Math.abs(e.track?.[1] || 0), Math.abs(e.speed || 0));
    const gear = this.effect("runningGear", e.runningGear || this.bank.vehicleRunningGear?.[e.vehicleId] || (e.wheeled ? "wheel_road" : "track_medium"));
    const surface = this.effect("surface", this.bank.surfaces?.[e.surface] || e.surface);
    if (speed > 0.05 && gear) want.add("gear:" + e.emitterId);
    // Release obsolete bands before any replacement source reaches WebAudio.
    for (const key of r.keys) if (!want.has(key)) this.stopLoop(key);
    for (const [i, g] of engineBands) if (g > 0.01) {
      const key = "engine:" + e.emitterId + ":" + bands[i];
      this.loop(key, p.cues[bands[i]], { ...e, gain: 0.12 * g, rate: (0.85 + f * 0.3)*movementRate });
    }
    if (e.load > 0.02) {
      const key = "engine:" + e.emitterId + ":load";
      this.loop(key, p.cues.load, { ...e, gain: 0.09 * e.load });
    }
    if (speed > 0.05) {
      if (gear) {
        const key = "gear:" + e.emitterId;
        const cue = this.runningGearCue(gear.cues.roll || gear.cues.loop, surface?.cues.texture || surface?.cues.loop);
        if (cue) this.loop(key, cue, { ...e, gain: Math.min(0.12, speed * 0.01), rate: clamp(0.75 + speed * 0.025, 0.75, 1.4) });
        else this.stopLoop(key);
      }
    }
    r.keys = want;
  }
  contact(e) {
    this.syncContext();
    if (!this.once(this.eventKey("contact", e.eventId), e.time)) return;
    if (e.outcome === "miss") return;
    const play = (kind, id, role) => {
      const p = this.effect(kind, id);
      if (p) this.play(p.cues[role] || p.cues.report || p.cues.attack || p.cues.tail || p.cues.debris || p.cues.blast || p.cues.cookoff, e);
    };
    if (e.outcome && e.outcome !== "unarmoured") play("impact", e.outcome, "attack");
    const material = this.bank.effectSelectors?.material?.[e.material] || e.material;
    if (material && e.outcome !== "unarmoured") play("impact", material, "tail");
    if (e.spall) play("impact", "armour_spall", "report");
    if (e.debris) play("impact", e.debris, "report");
    for (const b of e.bursts || []) {
      const kg = b.explosive_kg ?? b.explosive_mass_kg;
      if (!(kg > 0) || !Number.isFinite(kg)) continue;
      const pos = vec(b.worldPosition) ? b.worldPosition : vec(b.position) ? b.position : e.position;
      const ev = { ...e, position: pos };
      const p = this.effect("blast", massClass(kg));
      if (p) this.play(p.cues.blast || p.cues.report || p.cues.attack, ev);
      if (b.inside) {
        const p2 = this.effect("impact", "internal_filler_" + (kg < 0.1 ? "small" : "medium"));
        if (p2) this.play(p2.cues.internalBurst, ev);
      }
      if (e.shellKind === "heat" || e.shellKind === "heatfs") {
        const p2 = this.effect("impact", "heat_" + (kg < 0.5 ? "small" : "large"));
        if (p2) this.play(p2.cues.shapedCharge, ev);
      }
    }
    if (e.cookoff) play("blast", "ammo_detonation", "cookoff");
    if (e.ricochet) {
      const p = this.effect("flight", (e.caliber ?? 0) < 60 ? "small" : "large");
      this.play(p?.cues.ricochetPass || p?.cues.ricochet, { ...e, direction: e.ricochet });
    }
  }
  segment(e) {
    this.syncContext();
    if (!vec(e.p0) || !vec(e.p1) || !vec(e.velocity)) return;
    let r = this.trackers.get(e.id);
    if (!r) {
      if (this.trackers.size >= 128) return;
      r = { time: e.time, crack: false, approach: false, recede: false };
      this.trackers.set(e.id, r);
    }
    r.time = e.time;
    r.position = e.p1;
    if (e.motor === false) this.releaseMotor(e.id);
    else if (r.motor && this.motorReservations.has(e.id)) {
      this.loop("motor:" + e.id, r.motor, { position: e.p1, velocity: e.velocity, emitterId: r.emitterId, gain: 0.25, rate: this.doppler(e.velocity, e.p1) });
    }
    const p = this.effect("flight", e.caliber < 60 ? "small" : "large");
    if (!p || e.replayIllustration) return;
    const a = e.p0.map((v2, i) => v2 - this.listener.position[i]), v = e.p1.map((x, i) => x - e.p0[i]), len = Math.hypot(...v), speed = Math.hypot(...e.velocity);
    if (len <= 0) return;
    const u = v.map((x) => x / len), along = a.reduce((n, x, i) => n + x * u[i], 0), perp = Math.sqrt(Math.max(0, a.reduce((n, x) => n + x * x, 0) - along * along));
    if (perp > 80) return;
    const base = { position: e.p1, time: e.time, emitterId: "flight:" + e.id };
    if (!r.approach && along < 0 && distance(e.p1, this.listener.position) < 120) {
      r.approach = true;
      this.play(p.cues.approach, base);
    }
    if (!r.recede && along + len >= 0) {
      r.recede = true;
      this.play(p.cues.recede, base);
    }
    if (!r.crack && speed > 343) {
      const target = -perp * 343 / Math.sqrt(speed * speed - 343 * 343);
      if (target >= along && target <= along + len) {
        r.crack = true;
        const offset = (target - along) / speed;
        const point = e.p0.map((x, i) => x + u[i] * (target - along));
        this.play(p.cues.sonicCrack || p.cues.crack, { ...base, position: point, time: e.time - len / speed + offset });
      }
    }
  }
  doppler(velocity, pos) {
    const d = distance(pos, this.listener.position);
    const speed = Math.hypot(...velocity);
    if (d < 1e-3 || speed >= 343) return 1;
    const u = this.listener.position.map((v, i) => (v - pos[i]) / d), dot = (v) => v.reduce((s, x, i) => s + x * u[i], 0);
    return clamp((343 - dot(this.listener.velocity || [0, 0, 0])) / (343 - dot(velocity)), 0.5, 2);
  }
  removeProjectile(id) {
    this.releaseMotor(id);
    this.trackers.delete(id);
  }
  ui(kind, cal = 75) {
    this.syncContext();
    const p = this.effect("ui", "tone:" + kind) || this.effect("ui", kind === "ready" ? cal < 60 ? "light" : cal <= 100 ? "medium" : "heavy" : kind) || this.profiles.find((p2) => p2.kind === "ui" && p2.cues[kind]);
    if (p) this.play(p.cues.tone || p.cues[kind] || p.cues.report || p.cues.confirm || p.cues.action, { ui: true });
  }
  work(gun, L, gi, rate) {
    this.syncContext();
    const p = this.loadingProfile(gun.def);
    if (!p || gun.mechanizedLoading || p.mechanism === "az_t72") return false;
    const l = L.loaders.find((l2) => l2.gun === gi);
    if (L.state[gi] !== "loading" || !l || !gun.ammo.some((a) => a.count > 0) || gun.def.autocannon && !gun.beltChange) {
      this.cancelJob(gun);
      return true;
    }
    let job = this.jobs.get(gun);
    if (!job || job.cycle !== L.waitedSince[gi]) {
      this.cancelJob(gun);
      if (this.jobs.size + this.sound.reloadAudio.size >= 8) return true;
      job = { cycle: L.waitedSince[gi], phases: /* @__PURE__ */ new Set(), voices: [] };
      this.jobs.set(gun, job);
    }
    if (!(rate > 0)) {
      for (const v of job.voices) v.stop();
      job.voices = [];
      return true;
    }
    const f = 1 - l.remaining / l.total;
    for (const [role, at] of [["grab", 0], ["open", 0], ["load", 0.35], ["projectileGrab", 0], ["projectileLoad", 0.2], ["chargeGrab", 0.55], ["chargeLoad", 0.7]]) if (p.cues[role] && f >= at && !job.phases.has(role)) {
      job.phases.add(role);
      const manual = !gun.def.autocannon && !gun.def.missile, fireTime = this.fireTimes.get(gun);
      if (manual && !Number.isFinite(fireTime)) continue;
      const time = manual ? Math.max(this.listener.time, fireTime + 1.5) : this.listener.time;
      const v = this.play(p.cues[role], { owner: gun, ui: true, time });
      if (v) job.voices.push(v);
    }
    return true;
  }
  ready(gun) {
    this.syncContext();
    const p = this.loadingProfile(gun.def);
    if (!p || gun.mechanizedLoading || p.mechanism === "az_t72") return false;
    const ownedJob = this.jobs.has(gun);
    this.cancelJob(gun);
    if (ownedJob && gun.loaded >= 0 && gun.ammo[gun.loaded]?.count > 0) this.play(p.cues.lock || p.cues.ready, { owner: gun, ui: true });
    return true;
  }
  mgLoading(m, st, previous) {
    this.syncContext();
    const p = this.loadingProfile(m.def, "mg");
    if (!p || !Number.isFinite(previous) || !Number.isFinite(st.reload)) return;
    const consumed = previous > 0 && st.reload < previous;
    let job = this.jobs.get(st);
    if (job && job.cycle !== st.fired) { this.cancelJob(st); job = null; }
    if (st.reload > 0) {
      if (!consumed) {
        if (job) { for (const voice of job.voices) voice.stop(); job.voices = []; }
        return;
      }
      if (!job && this.jobs.size + this.sound.reloadAudio.size < 8) {
        job = { phases: /* @__PURE__ */ new Set(), voices: [], cycle: st.fired };
        this.jobs.set(st, job);
      }
      if (job) {
        for (const [role, at] of [["grab", 0], ["open", 0], ["load", 0.35]]) if (p.cues[role] && 1 - st.reload / m.def.reload_s >= at && !job.phases.has(role)) {
          job.phases.add(role);
          const v = this.play(p.cues[role], { owner: st, ui: true });
          if (v) job.voices.push(v);
        }
      }
    } else if (consumed) {
      this.cancelJob(st);
      if (st.belt > 0) this.play(p.cues.lock || p.cues.ready, { owner: st, ui: true });
    }
  }
  cancelJob(owner) {
    const j = this.jobs.get(owner);
    if (j) for (const v of j.voices) v.stop();
    this.jobs.delete(owner);
  }
  cancelOwner(owner) {
    for (const v of [...this.voices]) if (v.owner === owner) v.stop();
    for (const id of this.motorReservations) if (this.trackers.get(id)?.emitterId === owner) this.releaseMotor(id);
    this.cancelJob(owner);
    this.rotaries.delete(owner);
    this.rigs.delete(owner);
    for (const [id, p] of this.pending) if (p.e.emitterId === owner) this.pending.delete(id);
  }
  suspend(on) {
    this.active = !on;
    if (on) {
      for (const v of [...this.voices]) v.stop();
      this.rotaries.clear();
      for (const j of this.jobs.values()) j.voices = [];
    }
  }
  cancel() {
    for (const v of [...this.voices]) v.stop();
    this.loops.clear();
    this.rotaries.clear();
    this.rigs.clear();
    this.jobs.clear();
    this.pending.clear();
    this.trackers.clear();
    this.motorReservations.clear();
    this.seen.clear();
    this.clock = null;
  }
  dispose() {
    this.cancel();
    this.motorContext = null;
    this.epoch++;
    this.wanted.clear();
    this.buffers.clear();
    this.cache.clear();
    this.derivedCues.clear();
    this.bytes = 0;
    this.failed.clear();
    this.pressure.clear();
    for(const node of this.buses.values())safe(()=>node.disconnect());this.buses.clear();
  }
}
export {
  FullAudio,
  validateFullBank
};

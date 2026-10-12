// Presentation milestones for verified manual prototypes and a fitted AZ, never a reload clock.
// Weapon/ammo identity is independent of host nation, emitter instance and work duration.
const PROFILES = {
  kwk36_88_l56: { style: 'de', caliber: 88, ammo: ['apcbc_88_l56', 'he_88_sprgr', 'apcr_88_pzgr40'] },
  zis_s_53_85: { style: 'su', caliber: 85, ammo: ['aphe_85_br365', 'he_85_o365k', 'apcr_85_br365p'] },
  m3_75: { style: 'us', caliber: 75, ammo: ['apcbc_75_m61_m3', 'he_75_m48', 'ap_75_m72'] },
};

const AZ_PROFILE = Object.freeze({ style: 'az_t72', staged: true });
const AZ_AMMO = ['apfsds_125_3bm22', 'heatfs_125_3bk14', 'he_125_3of26'];
export function reloadProfile(definition, shell, mechanism = null) {
  if (mechanism) {
    return mechanism.mechanism === 'az_t72' && mechanism.gun_id === '2a46_1_125' && definition?.id === mechanism.gun_id &&
      definition.caliber_mm === 125 && !definition.autocannon && !definition.missile &&
      shell && AZ_AMMO.includes(shell.id) && mechanism.ammo?.includes(shell.id) && definition.ammo?.includes(shell.id) ? AZ_PROFILE : null;
  }
  const p = PROFILES[definition?.id];
  if (!p || !shell || definition.missile || definition.autocannon || definition.autoloader ||
      (definition.reload_mechanism && definition.reload_mechanism !== 'manual_unitary') ||
      definition.caliber_mm !== p.caliber || shell.caliber_mm !== p.caliber ||
      !definition.ammo?.includes(shell.id) || !p.ammo.includes(shell.id)) return null;
  return p;
}

/** Owns at most eight local jobs. `play` returns a cancellable one-shot, or null. */
export class ReloadAudio {
  constructor(play, { maxOwners = 8 } = {}) {
    if (typeof play !== 'function' || !Number.isInteger(maxOwners) || maxOwners < 1 || maxOwners > 8) throw new Error('Invalid loading audio owner');
    this.play = play;
    this.maxOwners = maxOwners;
    this.jobs = new Map();
    this.blocked = new WeakMap();
  }

  get size() { return this.jobs.size; }

  _stop(job) {
    for (const voice of job.voices) voice.stop();
    job.voices.length = 0;
  }

  _stage(job, phase) {
    this._stop(job);
    const cue = job.profile.staged ? `az_t72_${phase === 'select_lift' ? 'drive' : phase === 'lock' ? 'lock' : 'ram'}` : `${job.profile.style}_manual_${phase}`;
    const voice = this.play(cue, job.owner);
    if (voice) job.voices.push(voice);
  }

  work({ owner, cycle, definition, shell, mechanism = null, mechanicalStageIndex = 0, remaining, total, rate }) {
    const profile = reloadProfile(definition, shell, mechanism);
    if (!profile || !Number.isFinite(total) || total <= 0 || !Number.isFinite(remaining) || remaining < 0 || remaining > total || !Number.isFinite(cycle) ||
        profile.staged && (!Number.isInteger(mechanicalStageIndex) || mechanicalStageIndex < 0 || mechanicalStageIndex > mechanism.stages.length)) {
      this.cancel(owner); return false;
    }
    if (this.blocked.get(owner) === cycle) return false;
    let job = this.jobs.get(owner);
    if (job && (job.cycle !== cycle || job.weapon !== definition.id || job.ammo !== shell.id || job.mechanism !== mechanism)) {
      this.cancel(owner); job = null;
    }
    if (!job) {
      if (this.jobs.size >= this.maxOwners) {
        const completed = [...this.jobs.values()].find(j => j.complete);
        if (completed) this.cancel(completed.owner);
        else return false;
      }
      job = { owner, cycle, profile, mechanism, weapon: definition.id, ammo: shell.id, grabbed: false, loaded: false, nextStage: profile.staged ? mechanicalStageIndex : 0, complete: false, voices: [] };
      this.jobs.set(owner, job);
    }
    if (job.complete) return true;
    if (!(rate > 0) || !Number.isFinite(rate)) { this._stop(job); return true; }
    if (profile.staged) return true; // Only actual mechanical work events may emit handling.
    if (!job.grabbed) { job.grabbed = true; this._stage(job, 'grab'); }
    // Simulation has no measured insertion event: this is a single presentation milestone.
    if (!job.loaded && (total - remaining) / total >= .5) { job.loaded = true; this._stage(job, 'load'); }
    return true;
  }

  stage({ owner, cycle, definition, shell, mechanism, stage, workFraction, consumedFraction }) {
    const job = this.jobs.get(owner), index = mechanism?.stages?.findIndex(s => s.stage === stage);
    if (!job || job.complete || !job.profile.staged || job.cycle !== cycle || job.mechanism !== mechanism ||
        job.weapon !== definition?.id || job.ammo !== shell?.id || !reloadProfile(definition, shell, mechanism) ||
        index !== job.nextStage || index < 0 || mechanism.stages[index].at !== workFraction ||
        !Number.isFinite(consumedFraction) || consumedFraction < workFraction - 1e-9 || consumedFraction > 1 + 1e-9) return false;
    job.nextStage++;
    this._stage(job, stage);
    return true;
  }

  ready({ owner, cycle, definition, shell, mechanism = null, readyWithAmmo }) {
    const job = this.jobs.get(owner);
    if (!job) return false;
    if (!readyWithAmmo || job.cycle !== cycle || job.weapon !== definition?.id || job.ammo !== shell?.id || job.mechanism !== mechanism || !reloadProfile(definition, shell, mechanism)) {
      this.cancel(owner); return false;
    }
    if (!job.complete) { job.complete = true; this._stage(job, 'lock'); }
    return true;
  }

  cancel(owner, { blockCycle = false, cycle = this.jobs.get(owner)?.cycle } = {}) {
    if (blockCycle && Number.isFinite(cycle) && cycle >= (this.blocked.get(owner) ?? -Infinity)) this.blocked.set(owner, cycle);
    const job = this.jobs.get(owner);
    if (!job) return;
    // A delayed reply to an older predicted shot must not cancel newer work.
    if (blockCycle && Number.isFinite(cycle) && cycle !== job.cycle) return;
    this._stop(job);
    this.jobs.delete(owner);
  }

  suspend() { for (const job of this.jobs.values()) this._stop(job); }

  cancelAll({ retainBlocked = false } = {}) {
    this.suspend();
    this.jobs.clear();
    if (!retainBlocked) this.blocked = new WeakMap();
  }
}

/** Called inside the real loading.tick rate callback, after a loader is assigned. */
export function observeReloadWork(audio, gun, L, gi, rate) {
  if (L.state[gi] !== 'loading') { audio.cancel(gun); return false; }
  const loader = L.loaders.find(l => l.gun === gi);
  const ai = gun.ammo[gun.selected]?.count > 0 ? gun.selected : gun.ammo.findIndex(a => a.count > 0);
  if (!loader || ai < 0 || (gun.mechanizedLoading && loader.mechanism !== gun.mechanizedLoading)) { audio.cancel(gun); return false; }
  return audio.work({ owner: gun, cycle: L.waitedSince[gi], definition: gun.def, shell: gun.ammo[ai].shell,
    mechanism: gun.mechanizedLoading || null, mechanicalStageIndex: loader.stageIndex ?? 0, remaining: loader.remaining, total: loader.total, rate });
}

/** Called by the real fifth loading.tick callback while its fitted worker still owns the gun. */
export function observeReloadStage(audio, gun, L, gi, event) {
  const m = gun?.mechanizedLoading, worker = L.loaders.find(l => l.gun === gi);
  if (!m || !event || L.state[gi] !== 'loading' || event.gun !== gi || event.owner !== 'mechanized' ||
      event.mechanism !== m.mechanism || event.cycle !== L.waitedSince[gi] || worker?.cycle !== event.cycle || worker?.mechanism !== m) return false;
  const index = m.stages.findIndex(s => s.stage === event.stage);
  if (index < 0 || worker.stageIndex <= index) return false;
  const ai = gun.ammo[gun.selected]?.count > 0 ? gun.selected : gun.ammo.findIndex(a => a.count > 0);
  return audio.stage({ owner: gun, cycle: event.cycle, definition: gun.def, shell: gun.ammo[ai]?.shell, mechanism: m,
    stage: event.stage, workFraction: event.workFraction, consumedFraction: 1 - worker.remaining / worker.total });
}

/** Called only after game refill/nextAmmo/empty resolution; nominal completion is insufficient. */
export function observeReloadReady(audio, gun, L, gi) {
  const a = gun.loaded >= 0 ? gun.ammo[gun.loaded] : null;
  return audio.ready({ owner: gun, cycle: L.waitedSince[gi], definition: gun.def, shell: a?.shell,
    mechanism: gun.mechanizedLoading || null, readyWithAmmo: L.state[gi] === 'ready' && !!a && a.count > 0 });
}

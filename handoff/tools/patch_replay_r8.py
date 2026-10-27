"""Surgical R8 repair of the installed V3 replay; never rebuild stale source."""
from pathlib import Path
import argparse

ROOT = Path(__file__).resolve().parents[2]

def patch(text):
    if '// R8 replay continuity' in text:
        return patch_review_edges(text)
    def replace(old, new):
        nonlocal text
        if text.count(old) != 1:
            raise ValueError(f'replay anchor count {text.count(old)}: {old[:100]}')
        text = text.replace(old, new, 1)
    a = text.index('  // BEGIN RECORDED FOLLOWUP CLOCK\n')
    b = text.index('  // END RECORDED FOLLOWUP CLOCK\n', a)
    text = text[:a] + '  // BEGIN RECORDED FOLLOWUP CLOCK\n' + (ROOT/'handoff/tools/replay_followup_clock.js').read_text(encoding='utf-8') + text[b:]
    replace('  var ReplaySession = class {', '''  // R8 replay continuity: each source owns its sample time and trace share.
  function replayTraceShare(samples, key, budget) {
    const lists = samples.map(s => s[key] || []), result = [];
    for (let i = 0; result.length < budget; i++) {
      let any = false;
      for (const list of lists) if (i < list.length) {
        result.push(list[i]); any = true;
        if (result.length === budget) break;
      }
      if (!any) break;
    }
    return result;
  }
  var ReplaySession = class {''')
    replace('    append(raw) {\n', '''    eventPhysical(event, filmTimeS = this.filmTimeS) {
      const start = this.localStart.get(event.id);
      return start === void 0 ? this.clock.physicalAt(filmTimeS) : localReplayPhysical(event, filmTimeS - start);
    }
    append(raw) {
''')
    replace('this.summaries.filter((q) => visibleEnd(q) > physical)', 'this.summaries.filter((q) => visibleEnd(q) > this.eventPhysical(q))')
    replace('!this.events.some((q) => q !== this.pinned && q !== this.fatal && visibleEnd(q) <= physical)', '!this.events.some((q) => q !== this.pinned && q !== this.fatal && visibleEnd(q) <= this.eventPhysical(q))')
    replace('q !== this.pinned && q !== this.fatal && visibleEnd(q) <= physical);', 'q !== this.pinned && q !== this.fatal && visibleEnd(q) <= this.eventPhysical(q));')
    replace('      return { accepted: true, duplicate: false, late, terminal: result.terminal, source_status: result.source_status, aggregated: this.aggregated };', '''      const retainedIds = new Set([this.directorEvent, this.pinned, this.fatal, ...this.events, ...this.summaries].filter(Boolean).map(e => e.id));
      for (const id of this.localStart.keys()) if (!retainedIds.has(id)) this.localStart.delete(id);
      return { accepted: true, duplicate: false, late, terminal: result.terminal, source_status: result.source_status, aggregated: this.aggregated };''')
    replace('summaries: this.summaries.slice(), options:', 'summaries: this.summaries.slice(), localStart: new Map(this.localStart), options:')
    replace('["events", "summaries", "pinned", "fatal", "directorEvent", "endFilm", "evidenceEndFilm", "aggregated", "decorativeAggregated", "summaryPressure"]', '["events", "summaries", "localStart", "pinned", "fatal", "directorEvent", "endFilm", "evidenceEndFilm", "aggregated", "decorativeAggregated", "summaryPressure"]')
    replace('''      this.summaries = this.summaries.filter((e) => visibleEnd(e) > physicalS);
      const local = (e) => {
        const start = this.localStart.get(e.id);
        return start === void 0 ? physicalS : localReplayPhysical(e, filmTimeS - start);
      };''', '''      const local = (e) => this.eventPhysical(e, filmTimeS);
      this.summaries = this.summaries.filter((e) => visibleEnd(e) > local(e));''')
    replace('const all = samples.flatMap((s) => s.traces), traces = all.slice(0, 4096), staticTraces = samples.flatMap((s) => s.staticTraces).slice(0, Math.max(0, 4096 - traces.length)),', 'const all = samples.flatMap((s) => s.traces), traces = replayTraceShare(samples, "traces", 4096), staticTraces = replayTraceShare(samples, "staticTraces", Math.max(0, 4096 - traces.length)),')
    replace('      this.commits.length = 0;\n', '      this.commits.length = 0;\n      this.localStart.clear();\n')
    replace('if (current && purpose !== "analysis" && same(current.session.actor, evidence.actor)', 'if (current && !current.session.finished && purpose !== "analysis" && same(current.session.actor, evidence.actor)')
    replace('''        current.frame = null;
        this._summary''', '''        current.frame = null;
        this._remember(evidence);
        this._summary''')
    replace('const idle = current && (current.session.fatal || current.session.filmTimeS > current.session.endFilm);', 'const idle = current && (current.session.finished || current.session.filmTimeS >= current.session.endFilm);')
    replace('''      if (evidence.authority !== "analysis") {
        this.presented.delete(evidence.event_id);
        this.presented.set(evidence.event_id, deaths);
        if (this.presented.size > 256) this.presented.delete(this.presented.keys().next().value);
      }''', '      this._remember(evidence);')
    replace('''    showVictim(target, evidence, shell) {''', '''    _remember(evidence) {
      if (evidence.authority === "analysis") return;
      this.presented.delete(evidence.event_id);
      this.presented.set(evidence.event_id, evidence.deaths?.length || 0);
      if (this.presented.size > 256) this.presented.delete(this.presented.keys().next().value);
    }
    showVictim(target, evidence, shell) {''')
    replace('''      this.cur.session.tick(dt);
      if (this.cur.session.finished) {''', '''      this.cur.session.tick(dt);
      // The long same-target hold must never block a target already waiting.
      if (!this.victimActive && this.deferred.length && this.cur.session.filmTimeS >= this.cur.session.endFilm + .25) this.cur.session.finish("next_target");
      if (this.cur.session.finished) {''')
    return patch_review_edges(text)

def patch_review_edges(text):
    if '// R8 victim local clock and resilient acquisition' in text:
        return patch_fading_budget(text)
    def replace(old,new):
        nonlocal text
        if text.count(old)!=1:
            raise ValueError(f'review anchor count {text.count(old)}: {old[:90]}')
        text=text.replace(old,new,1)
    # Refresh only our owned compact-clock helper in an already integrated app.
    a=text.index('  // BEGIN RECORDED FOLLOWUP CLOCK\n')
    b=text.index('  // END RECORDED FOLLOWUP CLOCK\n',a)
    text=text[:a]+'  // BEGIN RECORDED FOLLOWUP CLOCK\n'+(ROOT/'handoff/tools/replay_followup_clock.js').read_text(encoding='utf-8')+text[b:]
    replace('filmTimeS >= this.clock.filmAt(this.fatal.launch_s)', 'local(this.fatal) >= this.fatal.launch_s')
    replace('''      const phase = directorPhase(selected, this.clock, physicalS, filmTimeS), cameraProjectile = cameraAnchor(selected, sample.projectile, physicalS);''', '''      // R8 victim local clock and resilient acquisition: a late fatal round owns its camera now.
      const selectedPhysical = local(selected), selectedStart = this.localStart.get(selected.id);
      const phase = selectedStart === void 0 ? directorPhase(selected, this.clock, selectedPhysical, filmTimeS)
        : Math.max(replayDirectorPhase(selected, selectedPhysical), selectedPhysical >= selected.contact_s ? 1.65 + Math.max(0, filmTimeS - selectedStart - followupReplayTiming(selected).contactFilm) : 0);
      const cameraProjectile = cameraAnchor(selected, sample.projectile, selectedPhysical);''')
    replace('filmTimeS - this.clock.filmAt(selected.launch_s)', 'filmTimeS - (selectedStart ?? this.clock.filmAt(selected.launch_s))')
    replace('id: frameId, filmTimeS, physicalS, directorPhase: phase,', 'id: frameId, filmTimeS, physicalS: selectedPhysical, sessionPhysicalS: physicalS, directorPhase: phase,')
    replace('''    tick(dt) {
      if (!this.cur) return;
      this.cur.session.tick(dt);
      // The long same-target hold must never block a target already waiting.
      if (!this.victimActive && this.deferred.length && this.cur.session.filmTimeS >= this.cur.session.endFilm + .25) this.cur.session.finish("next_target");
      if (this.cur.session.finished) {
        this.cur = null;
        this.projectile = null;
        this.suspendPresentation();
        const next2 = this.deferred.shift();
        if (next2) for (const row of next2.rows) this.show(row.target, row.rep, row.shell, row.dist, row.mg, row.detail, row.purpose);
      }
    }''', '''    tick(dt) {
      if (this.cur) {
        this.cur.session.tick(dt);
        // The long same-target hold must never block a target already waiting.
        if (!this.victimActive && this.deferred.length && this.cur.session.filmTimeS >= this.cur.session.endFilm + .25) this.cur.session.finish("next_target");
        if (this.cur.session.finished) {
          this.cur = null;
          this.projectile = null;
          this.suspendPresentation();
        }
      }
      // At most four groups exist. A failed acquisition must not strand the rest.
      for (let attempts = 0; !this.cur && this.deferred.length && attempts < 4; attempts++) {
        const next2 = this.deferred.shift();
        for (const row of next2.rows) this.show(row.target, row.rep, row.shell, row.dist, row.mg, row.detail, row.purpose);
      }
    }''')
    return patch_fading_budget(text)

def patch_fading_budget(text):
    marker='// R8 fading trails yield capacity to new physical rounds.'
    if marker in text:
        return text
    old='''      if (!previous && !reserve && ordinaryFull && summaries.length >= 64) {
        this.summaryPressure = true;'''
    new='''      // R8 fading trails yield capacity to new physical rounds.
      let faded = 0;
      if (!previous && !reserve && ordinaryFull) while (summaries.length >= 64) {
        const at = summaries.findIndex(q => this.eventPhysical(q) >= q.physicalEnd + .42);
        if (at < 0) break;
        const old = summaries.splice(at, 1)[0];
        faded += old.traces.length + old.unknown.length;
      }
      if (!previous && !reserve && ordinaryFull && summaries.length >= 64) {
        this.summaryPressure = true;'''
    if text.count(old)!=1:
        raise ValueError('Missing unique summary capacity gate')
    text=text.replace(old,new,1)
    old='      this.summaries = summaries;\n'
    if text.count(old)!=1:
        raise ValueError('Missing summary publication gate')
    return text.replace(old,old+'      this.decorativeAggregated += faded;\n',1)

if __name__ == '__main__':
    p=argparse.ArgumentParser(); p.add_argument('--input',type=Path,default=ROOT/'handoff/bundle/app.js.html'); p.add_argument('--output',type=Path)
    args=p.parse_args(); out=args.output or args.input
    out.write_text(patch(args.input.read_text(encoding='utf-8')),encoding='utf-8',newline='\n')
    print(f'R8 replay patched: {out}')

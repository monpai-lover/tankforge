/* TF_AUTO_TAKEOFF_RUNNER_BEGIN_20261027 */
// Opt-in product diagnostic. The driver only emits normal keyboard/mouse/toggle
// commands; state, aircraft physics, damage, AA, collision and replay stay real.
function createAutoTakeoffRunner(deps) {
  let params;
  try { params = new URLSearchParams(typeof location === 'object' ? location.search : ''); } catch { return null; }
  if (params.get('tfAutoTakeoff') !== '1') return null;
  const doc = deps.document || document, now = deps.now || (() => performance.now());
  const types = deps.types, defaults = ['p51d', 'me262', 'f15c'].filter(id => types[id]);
  const requested = params.get('tfAutoTakeoffTypes');
  const ids = requested === 'all' ? Object.keys(types).filter(id => types[id]?.fighter) : requested ? [...new Set(requested.split(',').map(id => id.trim()).filter(Boolean))] : defaults;
  const maxProfiles = requested === 'all' ? 4800 : 600;
  const scope = 'Actual browser lifecycle, pilot input, fixed-step flight, range AA, projectile/replay/surface counts and measured profiler reports. No synthetic FPS or guessed performance values.';
  const originalMap = deps.state().mapId;
  const results = [], profiles = [], events = [], owned = new WeakMap();
  let status = 'waiting', reason = '', current = null, index = 0, lastVisibleAt = null, startupSeconds = 0, stopped = false;
  const panel = doc.createElement('section'), text = doc.createElement('pre');
  panel.id = 'tf-auto-takeoff-panel';
  panel.style.cssText = 'position:fixed;right:8px;top:8px;z-index:2147483647;max-width:430px;padding:10px;background:rgba(0,0,0,.88);color:#c9ffd1;border:1px solid #8ba;font:12px/1.4 monospace;pointer-events:auto';
  text.style.cssText = 'margin:0 0 8px;white-space:pre-wrap';panel.appendChild(text);
  const download = doc.createElement('button');download.type = 'button';download.textContent = '下載起飛診斷 JSON';
  const stop = doc.createElement('button');stop.type = 'button';stop.textContent = '停止自動測試';
  panel.appendChild(download);panel.appendChild(stop);doc.body.appendChild(panel);
  const finite = value => Number.isFinite(value) ? value : null;
  const round = value => Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
  function visible(g) {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(doc.activeElement?.tagName) || doc.activeElement?.isContentEditable;
    return !g.paused && !doc.hidden && doc.visibilityState !== 'hidden' && g.airInputFocused !== false && (!doc.hasFocus || doc.hasFocus()) && !typing;
  }
  function event(kind, detail = {}) {
    const row = {kind, aircraft: current?.id || null, simSeconds: round(current?.simSeconds || 0), ...detail};
    events.push(row);if (events.length > 512) events.shift();
    try { if (deps.log) deps.log(row); else console.log('[TF_AUTO_TAKEOFF] ' + JSON.stringify(row)); } catch { /* Diagnostics cannot break the game. */ }
  }
  function key(plane, code, down) {
    let keys = owned.get(plane);if (!keys) owned.set(plane, keys = new Set());
    if (down) { if (!plane.keys.has(code)) { plane.keys.add(code);keys.add(code); } }
    else if (keys.has(code)) { plane.keys.delete(code);keys.delete(code); }
  }
  function neutral() {
    const g = deps.state(), p = g.air?.plane;
    if (p) for (const code of [...(owned.get(p) || [])]) key(p, code, false);
  }
  function snapshot() {
    const g = deps.state(), p = g.air?.plane, s = p?.cur;
    return {
      speedKmh: round(s ? s[14] * 3.6 : null), agl: round(s?.[35]), altitude: round(s?.[1]),
      pitchDeg: round(s ? s[19] * 180 / Math.PI : null), onGround: p?.onGround ?? null,
      crashed: p?.crashed ?? null, throttle: finite(p?.state?.throttle),
      shots: g.shots?.length || 0, bullets: g.bullets?.length || 0,
      rangeTargets: (g.enemies || []).filter(e => e.rangeTarget).length,
      activeAA: (g.enemies || []).filter(e => e.alive && (e.adState || e.adSam)).length,
      airDefenceEnabled: g.airDefenceOn !== false, ...deps.readCounts?.()
    };
  }
  function summary() {
    return {schema: 'TankForgeAutomaticTakeoffDiagnosticV1', revision: 'auto-takeoff-20261027-v1', status, reason, scope,
      selectedAircraft: ids.slice(), results, current: current ? {id:current.id,stage:current.stage,simSeconds:round(current.simSeconds),latest:current.latest} : null,
      measuredProfilerReports: profiles.length, events: events.slice(), limitations: ['Only completed visible in-app frames are measured.', 'AA is the actual range roster; a destroyed aircraft is never repaired or made invulnerable.', 'A green source test is not evidence of an actual browser takeoff or browser FPS.']};
  }
  function display() {
    const s = current?.latest;
    const report = current?.profiles.at(-1) || results.at(-1)?.profiles.at(-1), metrics = report?.metrics;
    const phases = metrics ? Object.entries(metrics).filter(([name])=>name.startsWith('phase.')).sort((a,b)=>b[1].total-a[1].total).slice(0,3) : [];
    text.textContent = ['自動跑道起飛診斷（保持前台）',`狀態：${status}${reason ? ' · ' + reason : ''}`,`${Math.min(index+1,ids.length)}/${ids.length} · ${current?.id || '等待'} · ${current?.stage || '初始化'}`,
      s ? `IAS ${s.speedKmh} km/h · AGL ${s.agl} m · ${round(current.simSeconds)} s` : '使用遊戲原有跑道出擊、油門、滑鼠拉起與防空流程',
      s ? `實際 AA ${s.activeAA} · 炮彈 ${s.shots} · 子彈 ${s.bullets} · 表面 ${s.surfaceActors ?? '—'}` : '',
      s ? `回放發射紀錄 ${s.replayDischarges ?? '—'} · actor history ${s.replayHistories ?? '—'}` : '',
      metrics ? `實測 CPU ${round(metrics['frame.cpu_ms']?.mean) ?? '—'} ms · surface query ${metrics['fn.surfaceCollisionQuery']?.calls ?? 0} 次／報告` : 'CPU phase：等待原 profiler 的實測窗口…',
      ...phases.map(([name,row])=>`${name.slice(6)} ${round(row.total/report.frames)} ms/frame`),
      `已完成 ${results.length} 架 · 實測 profiler 報告 ${profiles.length}`, 'FAIL／未運行都會保留，不會填入預測效能。'].filter(Boolean).join('\n');
  }
  function endRun(resultStatus, why) {
    neutral();
    if (current) {
      current.latest = snapshot();
      const result = {id:current.id,status:resultStatus,reason:why,takeoff:current.takeoffAt !== null,takeoffSeconds:round(current.takeoffAt),
        simSeconds:round(current.simSeconds),wallVisibleSeconds:round(current.visibleSeconds),spawn:current.spawn,last:current.latest,
        realAAObserved:current.sawAA && !current.aaDisabled,peakCounts:{...current.peaks},profiles:current.profiles.slice(),samples:current.samples.slice()};
      results.push(result);event('aircraft-finished',{status:resultStatus,reason:why});
    }
    current = null;index++;status = index >= ids.length ? 'complete' : 'waiting';
    deps.toGarage();
    if (status === 'complete') { stopped = true;deps.setMap(originalMap);event('complete',{passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length}); }
    lastVisibleAt = null;startupSeconds = 0;display();
  }
  function cancel(why = 'Cancelled by diagnostic control') {
    if (stopped) return;
    neutral();status = 'aborted';reason = why;stopped = true;event('aborted',{reason:why});display();
  }
  function onProfile(report) {
    if (!current || stopped || !visible(deps.state()) || report.kind !== 'sample' || report.aircraft !== current.id) return;
    if (profiles.length < maxProfiles) profiles.push(report);
    if (current.profiles.length < 180) current.profiles.push(report);
    display();
  }
  function beforeInput(dt) {
    if (stopped || !current || current.stage === 'launching') return;
    const g = deps.state(), p = g.air?.plane;
    if (!visible(g)) { neutral();return; }
    if (!p || !g.air.active || p.type.id !== current.id) return;
    if (p.crashed || p.damage?.pilotDead || p.damage?.broken) return;
    current.simSeconds += Math.max(0, Math.min(.05, Number.isFinite(dt) ? dt : 0));
    if (!current.configured) {
      if (p.state.brake) p.toggle('KeyB');
      // Command the existing up -> combat -> takeoff flap sequence.
      if (p.state.flaps !== true && p.state.flaps !== 'takeoff') {
        p.toggle('KeyF');if (p.state.flaps !== true && p.state.flaps !== 'takeoff') p.toggle('KeyF');
      }
      current.configured = true;event('runway-controls');
    }
    key(p, 'ShiftLeft', p.state.throttle < 1.0);
    const s = p.cur, speed = Math.max(0, (s?.[14] || 0)*3.6), agl = s?.[35] || 0;
    const rotate = Math.max(80, Number(p.type.rotateKmh) || 200);
    const targetPitch = speed >= rotate ? (agl > 180 ? .06 : .16) : 0;
    if (targetPitch) {
      // Same mouse-aim consumer as normal play, fed before the actual WASM step.
      // Read current aim to avoid accumulating mouse rotation once the target is reached.
      const aimPitch = p.aim ? Math.atan2(p.aim[1],Math.hypot(p.aim[0],p.aim[2])) : (s?.[19] || 0);
      g.mdy += Math.max(-3,Math.min(3,(aimPitch-targetPitch)/.0017));
      current.stage = current.takeoffAt === null ? 'rotation' : 'AA-observation';
    }
    if (!p.onGround && agl > 20 && p.state.gear) p.toggle('KeyG');
    if (!p.onGround && agl > 50 && p.state.flaps !== false && p.state.flaps !== 'up') {
      for (let i=0;i<3 && p.state.flaps !== false && p.state.flaps !== 'up';i++) p.toggle('KeyF');
    }
  }
  function afterFrame() {
    if (stopped) return;
    const g = deps.state();
    if (g.online || g.frontline?.active) { cancel('Refusing online/native-authority aircraft takeover');return; }
    if (!ids.length || ids.some(id=>!types[id])) { cancel('Unknown or empty aircraft selection');return; }
    if (!visible(g)) { neutral();lastVisibleAt = null;return; }
    const time = now(), elapsed = lastVisibleAt === null ? 0 : Math.max(0,(time-lastVisibleAt)/1000);lastVisibleAt = time;
    if (!current) {
      if (g.thumbs?.length || g.airThumbQ?.length) return;
      if (g.mode !== 'garage') { deps.toGarage();return; }
      current = {id:ids[index],stage:'launching',simSeconds:0,visibleSeconds:0,takeoffAt:null,configured:false,profiles:[],samples:[],peaks:{},sawAA:false,aaDisabled:false,latest:null,spawn:null,lastSample:-1};
      status = 'running';deps.setMap('range');event('launch-request');deps.launch(current.id);display();return;
    }
    current.visibleSeconds += elapsed;
    const p = g.air?.plane;
    if (current.stage === 'launching') {
      startupSeconds += elapsed;
      if (g.mode === 'battle' && g.air?.active && p?.type.id === current.id) {
        current.stage = 'takeoff-roll';current.spawn = snapshot();event('runway-spawn',{onGround:p.onGround});
        if (!p.onGround && (p.cur?.[35] || 0) > 5) { endRun('FAIL','Existing lifecycle did not produce a runway start');return; }
      } else if (startupSeconds > 45) { endRun('FAIL','Aircraft lifecycle did not become active within 45 visible seconds');return; }
      else { display();return; }
    }
    current.latest = snapshot();
    current.sawAA ||= current.latest.activeAA > 0;
    current.aaDisabled ||= !current.latest.airDefenceEnabled;
    for (const name of ['shots','bullets','activeAA','surfaceActors','ordnance','replayDischarges','replayHistories']) {
      const value = current.latest[name];if(Number.isFinite(value))current.peaks[name] = Math.max(current.peaks[name] || 0,value);
    }
    if (Math.floor(current.simSeconds) !== current.lastSample) { current.lastSample=Math.floor(current.simSeconds);if(current.samples.length < 180)current.samples.push({simSeconds:round(current.simSeconds),...current.latest}); }
    if (p.crashed || p.damage?.pilotDead || p.damage?.broken) { endRun('FAIL',current.takeoffAt === null ? 'Aircraft lost before takeoff' : 'Aircraft lost during real AA observation');return; }
    if (current.takeoffAt === null && !p.onGround && current.latest.agl >= 15) { current.takeoffAt=current.simSeconds;current.stage='AA-observation';event('airborne',{agl:current.latest.agl,speedKmh:current.latest.speedKmh}); }
    if (current.takeoffAt !== null && current.simSeconds-current.takeoffAt >= 15) {
      if (!current.sawAA || current.aaDisabled) endRun('FAIL','Real-AA observation invalid: AA disabled or no live AA units observed');
      else endRun('PASS','Real takeoff followed by 15 simulated seconds of unmodified range AA');
      return;
    }
    if (current.simSeconds >= 120 || current.visibleSeconds >= 180) { endRun('FAIL','Runway takeoff/observation timed out');return; }
    display();
  }
  download.onclick = () => {
    const blob = new Blob([JSON.stringify(summary(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=doc.createElement('a');
    a.href=url;a.download='tankforge-automatic-takeoff-diagnostic.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  stop.onclick = () => cancel();
  const resetVisibleClock = () => { lastVisibleAt = null;neutral(); };
  doc.addEventListener?.('visibilitychange', resetVisibleClock);
  const win = deps.window || (typeof window === 'object' ? window : null);
  win?.addEventListener?.('blur', resetVisibleClock);
  win?.addEventListener?.('focus', resetVisibleClock);
  display();event('ready',{selectedAircraft:ids.slice(),scope});
  return {beforeInput,afterFrame,onProfile,summary,cancel,wrapFrame(original){return function(){try{return Reflect.apply(original,this,arguments);}finally{try{afterFrame();}catch(error){cancel('Diagnostic exception: '+String(error?.message||error));}}};}};
}
/* TF_AUTO_TAKEOFF_RUNNER_END_20261027 */

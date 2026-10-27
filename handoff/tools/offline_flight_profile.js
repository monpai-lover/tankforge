/* Candidate-only diagnostic. No timers, method replacement or logging without URL opt-in. */
var TFOfflineFlightProfile = (() => {
  let params;
  try { params = new URLSearchParams(typeof location === "object" ? location.search : ""); } catch { return null; }
  if (params.get("tfOfflineProfile") !== "1") return null;
  const gpuWanted = params.get("tfOfflineProfileGpu") === "1";
  const prefix = "[TF_OFFLINE_PROFILE] ";
  const displayWanted = params.get("tfOfflineProfilePanel") === "1";
  const recentReports = [];
  let diagnosticPanel = null, diagnosticText = null;
  function displayReport(value) {
    if (!displayWanted || typeof document?.createElement !== "function" || !document.body) return;
    if (!diagnosticPanel) {
      diagnosticPanel = document.createElement("div");
      diagnosticPanel.style.cssText = "position:fixed;right:8px;top:70px;z-index:2147483647;max-width:390px;padding:10px;background:rgba(0,0,0,.86);color:#b8ffbf;font:13px/1.45 monospace;pointer-events:auto;border:1px solid #7a8";
      diagnosticText = document.createElement("pre"); diagnosticText.style.margin = "0 0 8px";
      diagnosticText.textContent = "起飛診斷：等待單人飛行畫面…";
      diagnosticPanel.appendChild(diagnosticText);
      const button = document.createElement("button"); button.textContent = "下載診斷 JSON";
      button.onclick = () => {
        const bytes = JSON.stringify({kind:"TankForgeOfflineFlightProfile",reports:recentReports},null,2);
        const blob = new Blob([bytes],{type:"application/json"}), link = document.createElement("a"), url = URL.createObjectURL(blob);
        link.href=url;link.download="tankforge-flight-profile.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      };
      diagnosticPanel.appendChild(button); document.body.appendChild(diagnosticPanel);
    }
    if (value.kind !== "sample") return;
    recentReports.push(value); if (recentReports.length > 120) recentReports.shift();
    const m=value.metrics,gap=m["raf.gap_ms"]?.mean,cpu=m["frame.cpu_ms"]?.mean,gpu=m["gpu.render_ms"]?.mean;
    const functions=Object.entries(m).filter(([name])=>name.startsWith("fn.")||name.startsWith("fx.")||name.startsWith("hitcam.")||name==="missiles.draw"||name==="replay.record_step").sort((a,b)=>b[1].total-a[1].total).slice(0,5);
    const phases=Object.entries(m).filter(([name])=>name.startsWith("phase.")).sort((a,b)=>b[1].total-a[1].total).slice(0,4);
    diagnosticText.textContent = ["單人起飛診斷（保持此頁在前台）",`FPS ${gap>0?(1000/gap).toFixed(1):"…"} | CPU ${cpu?.toFixed(1)??"…"} ms | GPU ${gpu?.toFixed(1)??"未支援"} ms`,`彈丸 ${value.state.shots} / 子彈 ${value.state.bullets}`,`${value.aircraft} · AGL ${value.state.agl} m · ${value.state.speedKmh} km/h`,`焦點 ${value.page.hasFocus} · ${value.page.visibilityState}`,`繪製 ${Math.round(value.counters["draw.main.calls"]/value.frames)||0} 次 · 三角形 ${Math.round(value.counters["draw.main.triangles"]/value.frames)||0}`,...phases.map(([name,row])=>`${name.slice(6)} ${(row.total/value.frames).toFixed(2)} ms/frame`),"函式耗時（含子呼叫）：",...functions.map(([name,row])=>`${name} ${(row.total/value.frames).toFixed(2)} ms/frame`)].join("\n");
  }
  const wrapped = new WeakSet(), preparedPlanes = new WeakSet(), preparedWorlds = new WeakSet();
  const metrics = new Map(), counters = Object.create(null);
  let active = false, frameAt = 0, phaseAt = 0, phaseName = "", lastRaf = null;
  let windowAt = null, frames = 0, reports = 0, stopped = false, latest = {};
  let gpu = null;
  const now = () => performance.now();
  const round = n => Math.round(n * 1000) / 1000;
  const log = value => { try { console.log(prefix + JSON.stringify(value)); displayReport(value); } catch { /* Diagnostics cannot stop the game. */ } };
  function record(name, value) {
    if (!Number.isFinite(value)) return;
    let m = metrics.get(name);
    if (!m) metrics.set(name, m = { count: 0, total: 0, max: 0, samples: [] });
    m.count++; m.total += value; m.max = Math.max(m.max, value);
    if (m.samples.length < 240) m.samples.push(value);
  }
  function count(name, value = 1) { if (active) counters[name] = (counters[name] || 0) + value; }
  function begin() { return active ? now() : null; }
  function end(name, start) { if (start !== null && active) record(name, now() - start); }
  function phase(name) {
    if (!active) return;
    const t = now();
    if (phaseName) record("phase." + phaseName, t - phaseAt);
    phaseAt = t; phaseName = name;
  }
  function wrap(name, original, counterOnly = false) {
    if (typeof original !== "function" || wrapped.has(original)) return original;
    function measured(...args) {
      if (!active) return Reflect.apply(original, this, args);
      if (counterOnly) { count(name); return Reflect.apply(original, this, args); }
      const start = begin();
      try { return Reflect.apply(original, this, args); }
      finally { end(name, start); }
    }
    wrapped.add(measured); return measured;
  }
  function instrument(object, key, name, counterOnly = false) {
    if (!object || typeof object[key] !== "function" || wrapped.has(object[key])) return;
    try { object[key] = wrap(name, object[key], counterOnly); } catch { /* Read-only exports stay intact. */ }
  }
  function prepare(g) {
    instrument(g.missiles, "draw", "missiles.draw");
    instrument(g.localReplay, "recordProjectileStep", "replay.record_step");
    const p = g.air?.plane;
    if (p && !preparedPlanes.has(p)) {
      preparedPlanes.add(p);
      instrument(p.damage, "step", "aircraft.damage");
      instrument(p, "pilotIntent", "aircraft.intent");
      instrument(p, "applyDamage", "aircraft.apply_damage");
      instrument(p, "_showParts", "aircraft.parts");
      instrument(p, "camera", "aircraft.camera");
    }
    const w = g.mapEntry?.world;
    if (w && !preparedWorlds.has(w)) {
      preparedWorlds.add(w);
      instrument(w, "update", "world.vegetation_update");
      instrument(w, "collide", "world.tank_collide");
    }
  }
  function pollGpu() {
    if (!gpu) return;
    const { gl, ext, pending } = gpu;
    try {
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      for (let i = pending.length - 1; i >= 0; i--) {
        const q = pending[i];
        if (!disjoint && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
        if (!disjoint) record("gpu.render_ms", gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        else count("gpu.disjoint_dropped");
        gl.deleteQuery(q); pending.splice(i, 1);
      }
    } catch { gpu.disabled = true; }
  }
  function gpuBegin(renderer) {
    if (!active || !gpuWanted || !renderer?.gl) return null;
    try {
      if (!gpu) {
        const gl = renderer.gl, ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
        gpu = { gl, ext, pending: [], disabled: !ext };
        log({ kind: "gpu", available: !!ext, asynchronous: true });
      }
      if (gpu.disabled || gpu.pending.length >= 8 || gpu.open || gpu.gl !== renderer.gl) return null;
      const { gl, ext } = gpu;
      if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return null;
      const q = gl.createQuery(); if (!q) return null;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q); gpu.open = q;
      return q;
    } catch { if (gpu) gpu.disabled = true; return null; }
  }
  function gpuEnd(renderer, query) {
    if (!query || !gpu || gpu.open !== query) return;
    try { gpu.gl.endQuery(gpu.ext.TIME_ELAPSED_EXT); gpu.pending.push(query); }
    catch { gpu.disabled = true; }
    finally { gpu.open = null; }
  }
  function renderWrap(renderer) {
    const original = renderer.render;
    renderer.render = wrap("render.cpu_submit", function (...args) {
      const query = gpuBegin(renderer);
      try { return Reflect.apply(original, this, args); }
      finally { gpuEnd(renderer, query); }
    });
  }
  function draw(pass, node) {
    if (!active) return;
    const m = node.mesh, instances = m?.instanced ? m.instances || 0 : 1;
    if (!instances) return;
    count("draw." + pass + ".calls"); count("draw." + pass + ".triangles", (m?.count || 0) * instances / 3);
    if (m?.aircraftGeometry) count("draw." + pass + ".aircraft_calls");
  }
  function sceneNodes(nodes) {
    if (!active) return;
    record("scene.visible_nodes", nodes.length);
  }
  function pageState() {
    const d = typeof document === "object" ? document : null;
    let focus = null;
    try { if (typeof d?.hasFocus === "function") focus = d.hasFocus(); } catch { /* Browser metadata can be unavailable. */ }
    return { visibilityState: d?.visibilityState || "unknown", hidden: d?.hidden === true, hasFocus: focus, fullscreen: !!d?.fullscreenElement };
  }
  function windowState() {
    const w = typeof window === "object" ? window : null;
    return { innerWidth: w?.innerWidth ?? null, innerHeight: w?.innerHeight ?? null, outerWidth: w?.outerWidth ?? null, outerHeight: w?.outerHeight ?? null, devicePixelRatio: w?.devicePixelRatio ?? null };
  }
  function resetWindow() {
    lastRaf = null; windowAt = null; frames = 0; phaseName = "";
    metrics.clear(); for (const key of Object.keys(counters)) delete counters[key];
  }
  function frameStart(rafNow, g, renderer) {
    const page = pageState();
    active = !stopped && g.mode === "battle" && !!g.air?.active && !g.frontline?.active && !g.paused && !page.hidden && page.visibilityState !== "hidden";
    if (!active) { resetWindow(); return; }
    prepare(g); frameAt = now();
    if (windowAt === null) windowAt = frameAt;
    if (lastRaf !== null) record("raf.gap_ms", Math.max(0, rafNow - lastRaf));
    lastRaf = rafNow; frames++;
    phaseAt = frameAt; phaseName = "frame.setup";
    pollGpu();
    const p = g.air.plane, s = p.cur || [];
    latest = { aircraft: p.type?.id, page, window: windowState(), state: { speedKmh: round((s[13] || 0) * 3.6), altitude: round(s[1] || 0), agl: round(s[35] || 0), onGround: p.onGround, camera: p.state?.camera, xray: !!p.xray, controls: p.controls?.length || 0, interiorBuilt: !!p.detailedInterior, interiorParts: p.detailedInterior?.parts?.length || 0, interiorBuilds: p.interiorUpgrade?.builds || 0, shots:g.shots?.length||0, bullets:g.bullets?.length||0 }, render: { quality: renderer.quality, scale: renderer.renderScale, width: renderer.canvas?.width, height: renderer.canvas?.height } };
  }
  function frameEnd(g, renderer) {
    if (!active) return;
    const page = pageState();
    if (page.hidden || page.visibilityState === "hidden") { active = false; resetWindow(); return; }
    latest.page = page; latest.window = windowState();
    const finish = now();
    if (phaseName) record("phase." + phaseName, finish - phaseAt);
    phaseName = ""; record("frame.cpu_ms", finish - frameAt);
    record("renderer.reported_draw_calls", renderer.drawCalls || 0);
    pollGpu();
    if (finish - windowAt >= 1000) {
      const values = {};
      for (const [name, m] of metrics) {
        const samples = m.samples.slice().sort((a, b) => a - b);
        values[name] = { calls: m.count, total: round(m.total), mean: round(m.total / m.count), p95: round(samples[Math.min(samples.length - 1, Math.floor(samples.length * .95))] || 0), max: round(m.max) };
      }
      log({ kind: "sample", revision: "offline-flight-profiler-20261026-v2", report: ++reports, frames, wallMs: round(finish - windowAt), ...latest, metrics: values, counters: { ...counters } });
      metrics.clear(); for (const key of Object.keys(counters)) delete counters[key];
      frames = 0; windowAt = finish;
      if (reports >= 120) { stopped = true; log({ kind: "stopped", reason: "120-report diagnostic limit; reload to restart" }); }
    }
    active = false;
  }
  function wrapFrame(original, state, renderer) {
    return function (rafNow) {
      frameStart(rafNow, state(), renderer);
      try { return Reflect.apply(original, this, arguments); }
      finally { frameEnd(state(), renderer); }
    };
  }
  log({ kind: "ready", revision: "offline-flight-profiler-20261026-v2", gpu: gpuWanted, scope: "visible single-player active aircraft", hiddenFrames: "discard partial window; do not consume report budget", maxReports: 120, intervalMs: 1000 });
  return { get active() { return active; }, begin, end, phase, count, wrap, instrument, renderWrap, draw, sceneNodes, frameStart, frameEnd, wrapFrame, gpuBegin, gpuEnd };
})();

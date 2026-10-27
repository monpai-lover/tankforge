// Real offline game paths. Only initial airborne placement and observation
// cameras are fixtures; no native state, damage, ammunition or gun overrides.
(() => {
  'use strict';
  const tf = window.__tf, x = window.__tfx, G = tf.G;
  const qa = window.__flightUpgradeQa = {};
  const fittedIds = new Set(['mig17f', 'f4e', 'f15c', 'su27', 'a10a', 'su25']);
  const spawned = new Set(), meshFacts = new WeakMap(), nodeIds = new WeakMap();
  let nextNodeId = 1, originalCamera = null, frozen = null, normalDraw = null, sourceNodes = [];
  const require = (value, message) => { if (!value) throw Error(message); };
  const uid = node => { if (!nodeIds.has(node)) nodeIds.set(node, nextNodeId++); return nodeIds.get(node); };
  const plane = () => { require(G.air?.active && G.air.plane, 'No actual boarded aircraft'); return G.air.plane; };
  const actualDraws = p => { p.pose(1); p.root.update(); return p.root.collect([]); };
  const state = p => JSON.stringify({cur: Array.from(p.cur), aero: Array.from(p.aero),
    guns: G.air.guns.map(g => ({id: g.id, ammo: g.ammo, fired: g.fired, spin: g.spin, cool: g.cool})),
    damageRevision: p.damage.revision, damageParts: p.damage.parts,
    broken: p.damage.broken, pilotDead: p.damage.pilotDead});
  const isGear = c => c.type === 'gear' || c.type === 'tailgear' || /^gear/.test(c.param || '');
  const isRoll = c => c.type === 'roll' || c.type === 'elevon' || c.param === 'roll' || !!c.mix?.roll;
  const isFlap = c => c.type === 'flap' || c.param === 'flap';
  const controls = (p, filter) => p.controls.filter(filter).map(c => ({name: c.name || c.node.name,
    type: c.type, param: c.param, mover: c.mover, local: Array.from(c.node.local || []),
    visible: c.node.visible, vertices: c.node.mesh?.count || 0}));
  const finiteMatrices = rows => rows.every(c => c.local.length === 16 && c.local.every(Number.isFinite));
  const changed = (before, after) => before.some((row, i) => after[i] && row.local.some((v, k) => Math.abs(v - after[i].local[k]) > 1e-6));
  function geometry(mesh) {
    if (meshFacts.has(mesh)) return meshFacts.get(mesh);
    const data = mesh._src?.data;
    let finite = !!data && data instanceof Float32Array && data.length % 39 === 0;
    let count = 0, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    if (data) for (let i = 0; i < data.length; i++) {
      if (!Number.isFinite(data[i])) finite = false;
      if (i % 13 < 3) { const k = i % 13; lo[k] = Math.min(lo[k], data[i]); hi[k] = Math.max(hi[k], data[i]); count++; }
    }
    const result = {finite, floats: data?.length || 0, vertices: mesh.count,
      lo: count ? lo : null, hi: count ? hi : null};
    meshFacts.set(mesh, result); return result;
  }
  function engineEvidence(p, drawn) {
    const id = p.type.id, model = p.type.model || x.AIRCRAFT_MODELS[id];
    const layout = x.engineLayout.describe(id, model), fit = x.mechanismFit.describe(id, model);
    if (!fittedIds.has(id)) return {expected: 'authored_source_interior', layoutGuarded: !layout && !fit,
      authoredNodes: p.sourceInternalNodes.length};
    const built = x.engineLayout.build(id, model, {palette: 'gray'});
    const data = p.internalNode?.mesh?._src?.data;
    const length = built?.modules.reduce((n, m) => n + m.data.length, 0) || 0;
    let offset = (data?.length || 0) - length, exactUploadedTail = !!built && !!data && offset >= 0;
    for (const module of built?.modules || []) {
      for (let i = 0; exactUploadedTail && i < module.data.length; i++) if (data[offset + i] !== module.data[i]) exactUploadedTail = false;
      offset += module.data.length;
    }
    return {expected: 'source_fitted_fallback', layout: !!layout, mechanismFit: !!fit,
      sourceSignature: layout?.signature, engineCount: built?.modules.length || 0,
      engines: (built?.modules || []).map(m => ({instance: m.instanceId, side: m.side, floats: m.data.length,
        finite: m.data.every(Number.isFinite)})), exactUploadedTail,
      internalCollected: drawn.has(p.internalNode)};
  }
  qa.ready = async () => {
    await tf.coreReady(); const api = await x.flightCoreP;
    tf.pause(true); tf.setQuality('low');
    G.airHelp = false; G.airAssist = false; G.airBotsOn = false; G.padBots = false;
    x.clearBots();
    require(x.engineLayout && x.mechanismFit && x.mechanismView, 'Missing actual upgrade helpers');
    return {core: api.core_version(), models: Object.keys(x.data.aircraftModels),
      engineRevision: x.engineLayout.revision, mechanismRevision: x.mechanismFit.revision,
      mechanismView: typeof x.mechanismView.apply === 'function', online: !!G.online};
  };
  qa.start = () => { tf.setMapChoice('range'); tf.startBattle(); tf.pause(true); x.clearBots(); return {mode: G.mode, online: !!G.online}; };
  qa.enter = async id => {
    require(!spawned.has(id), 'Initial airborne fixture may run only once for ' + id);
    if (G.air?.active) x.exitAircraft(true);
    await x.enterAircraft(false, id);
    const p = plane(); require(p.type.id === id, 'Actual enterAircraft failed for ' + id);
    spawned.add(id); originalCamera = p.camera.bind(p);
    p.spawn(-8000, 3000, -8000, 0, 140, false);
    G.airInputFocused = true; tf.advance(0.1, [], false); tf.pause(true);
    sourceNodes = p.sourceInternalNodes.map(n => ({node: n, mesh: n.mesh, data: n.mesh._src?.data, source: n.sourceModule?.data}));
    frozen = null; normalDraw = null;
    return qa.probe();
  };
  qa.probe = () => {
    const p = plane(), drawn = new Set(actualDraws(p)), gl = tf.renderer.gl;
    const binding = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    let meshes;
    try {
      meshes = p.meshes.map(m => {
        const gpu = gl.isBuffer(m.buf);
        let uploadedBytes = -1;
        if (gpu) { gl.bindBuffer(gl.ARRAY_BUFFER, m.buf); uploadedBytes = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE); }
        return {...geometry(m), gpu, vertexArray: gl.isVertexArray(m.vao), uploadedBytes,
          expectedBytes: m._src?.data?.byteLength || 0};
      });
    } finally { gl.bindBuffer(gl.ARRAY_BUFFER, binding); }
    const source = p.sourceInternalNodes.map(n => ({id: n.sourceModule?.id, node: uid(n),
      triangles: n.mesh.count / 3, dataIdentity: n.mesh._src?.data === n.sourceModule?.data,
      gpu: gl.isBuffer(n.mesh.buf), collected: drawn.has(n)}));
    const subsets = (p.mechanismGearView || []).filter(r => r.node).map(r => ({
      name: r.node.name, sourceParts: r.sourceParts, hitboxDisabled: r.node.hitboxDisabled === true,
      subsetFlag: r.node.aircraftMechanismSubset === true, collected: drawn.has(r.node),
      originalCollected: drawn.has(r.control.node), vertices: r.node.mesh?.count,
      originalVertices: r.control.node.mesh?.count, gpu: gl.isBuffer(r.node.mesh?.buf)}));
    const skins = [p.body, p.cockpit, p.glass, ...p.pieceNodes].filter(Boolean);
    const gearRecords = (p.mechanismGearView || []).map(r => ({name: r.control.name || r.control.node.name,
      keep: r.keep, collected: drawn.has(r.node || r.control.node), hasSubset: !!r.node}));
    return {id: p.type.id, core: p.api.core_version(), imported: !!p.imported,
      finiteState: p.cur.every(Number.isFinite) && p.aero.every(Number.isFinite), crashed: p.crashed,
      stateLength: p.cur.length, state: Array.from(p.cur), gear: p.cur[33], flaps: p.cur[34],
      contextLost: gl.isContextLost(), rendererLost: !!tf.renderer.lost,
      gearAxes: Array.from(p.aero.slice(36, 40)), xray: p.xray, meshes,
      meshCount: meshes.length, gpuBuffers: meshes.filter(m => m.gpu).length,
      skinCount: skins.length, collectedSkin: skins.filter(n => drawn.has(n)).map(n => n.name),
      source, sourcePreserved: sourceNodes.every(r => p.sourceInternalNodes.includes(r.node) && r.node.mesh === r.mesh && r.node.mesh._src?.data === r.data && r.node.sourceModule?.data === r.source),
      sourceTriangles: source.reduce((n, row) => n + row.triangles, 0),
      coarseDuplicates: p.partNodes.filter(n => p.sourceModuleParts.has(n.part.id)).map(n => n.part.id),
      generatedStructureCollected: (p.detailedInterior?.parts || []).filter(r => r.role === 'structure' && drawn.has(r.node)).map(r => r.id || r.instanceId),
      engine: engineEvidence(p, drawn), subsets, gearRecords,
      controls: {gear: controls(p, isGear), roll: controls(p, isRoll), flap: controls(p, isFlap)},
      drawn: [...drawn].map(n => ({id: uid(n), name: n.name, kind: n.kind, vertices: n.mesh.count})),
      guns: G.air.guns.map(g => ({id: g.id, ammo: g.ammo, fired: g.fired}))};
  };
  qa.freezeToggle = expected => {
    const p = plane(); tf.pause(true);
    if (expected) normalDraw = actualDraws(p).map(uid).sort((a, b) => a - b);
    frozen = {state: state(p), expected};
    return {xray: p.xray, nativeTime: p.cur[23], expected};
  };
  qa.afterToggle = () => {
    const p = plane(); require(frozen, 'Missing pre-toggle state');
    const unchanged = frozen.state === state(p), expected = frozen.expected;
    const after = actualDraws(p).map(uid).sort((a, b) => a - b);
    return {unchanged, actual: p.xray, expected, restoredDrawMembership: expected ? null : JSON.stringify(after) === JSON.stringify(normalDraw), probe: qa.probe()};
  };
  qa.camera = offset => {
    const p = plane();
    p.camera = () => { const centre = p.drawPos || p.position, length = Math.hypot(...offset);
      return {camPos: centre.map((v, i) => v + offset[i]), fwd: offset.map(v => -v / length), fovY: 0.85}; };
    // An ordinary native frame is advanced to capture an actual renderer frame.
    // This is separate from the frozen key-event identity comparison.
    tf.advance(1 / 60, [], true); tf.pause(true); return {xray: p.xray, nativeTime: p.cur[23]};
  };
  qa.advanceGear = target => {
    const p = plane(), before = controls(p, isGear), samples = [];
    for (let i = 0; i < 108; i++) {
      tf.advance(1 / 12, [], false);
      if (i % 9 === 0 || i === 107) samples.push({time: p.cur[23], gear: p.cur[33], axes: Array.from(p.aero.slice(36, 40)),
        controls: controls(p, isGear)});
    }
    tf.pause(true); const after = controls(p, isGear);
    return {target, end: p.cur[33], nativeAxes: Array.from(p.aero.slice(36, 40)),
      travelled: samples.some(s => s.gear > 0.01 && s.gear < 0.99),
      controlsMoved: changed(before, after), finiteControls: finiteMatrices(after) && samples.every(s => finiteMatrices(s.controls)),
      finiteState: p.cur.every(Number.isFinite) && p.aero.every(Number.isFinite), crashed: p.crashed, samples};
  };
  qa.surfaceBefore = kind => { const p = plane(); qa.surfaceSample = {kind, controls: controls(p, kind === 'roll' ? isRoll : isFlap), accepted: Array.from(p.cur.slice(24, 27)), flap: p.cur[34]}; return qa.surfaceSample; };
  qa.surfaceAfter = seconds => {
    const p = plane(), before = qa.surfaceSample; tf.advance(seconds, [], false); tf.pause(true);
    const after = controls(p, before.kind === 'roll' ? isRoll : isFlap);
    return {kind: before.kind, count: after.length, changed: changed(before.controls, after), finite: finiteMatrices(after),
      acceptedBefore: before.accepted, acceptedAfter: Array.from(p.cur.slice(24, 27)), flapBefore: before.flap, flapAfter: p.cur[34],
      localBefore: before.controls, localAfter: after, finiteState: p.cur.every(Number.isFinite), crashed: p.crashed};
  };
  qa.restoreCamera = () => { const p = plane(); p.camera = originalCamera; return true; };
  qa.cleanup = () => { tf.pause(true); x.clearBots(); if (G.air?.active) x.exitAircraft(true); tf.toGarage(); return {mode: G.mode, online: !!G.online, spawned: [...spawned]}; };
})();

// Trusted build-time authored associations. Geometry and visual material evidence are
// independent of armor resistance; no nearest-plate search occurs in this module.
import { createHash } from 'node:crypto';
import { STRIDE } from '../src/gfx/geo.js';
import { reviewedFleetSource, authoredPartBindings, authoredRunningGearBinding } from './fleet-authored-bindings.mjs';
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const bits = a => Array.from(new Uint32Array(a.buffer, a.byteOffset, a.length));
const REVISION = 't72a-authored-association-v1';
const INSTANCE_SIDE_BASIS = 'authored_running_gear_instance_side';
const instanceSideDeclaration = d => d.role === 'module' && d.moduleRef === null && d.declaration?.basis === INSTANCE_SIDE_BASIS;
function registeredTrackModule(anatomy, side) {
  if (side !== 1 && side !== -1) throw new Error('running gear owner side must be authored');
  // T72 names these anatomy owners explicitly. Geometry/centres never select a side.
  const id = side === 1 ? 'track_r' : 'track_l', matches = anatomy.modules.filter(m => m.id === id && m.kind === 'track');
  if (matches.length !== 1) throw new Error(`running gear registered track module missing: ${id}`);
  return matches[0].id;
}
function acceptedAnatomy(anatomy) {
  if (!anatomy || !Array.isArray(anatomy.armor) || !Array.isArray(anatomy.modules) || !Array.isArray(anatomy.crew)) throw new Error('accepted anatomy requires complete normalized arrays');
  // Preserve every normalized field and its original JSON number. The native
  // verifier hashes this canonical subtree verbatim before typed comparison.
  return structuredClone({ armor: anatomy.armor, modules: anatomy.modules, crew: anatomy.crew, weapons: anatomy.weapons || null });
}
export function validateBindingCatalog(text, expectedHash, result, anatomy) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 16 * 1024 * 1024 || createHash('sha256').update(text).digest('hex') !== expectedHash) throw new Error('binding catalog full-file hash mismatch');
  const c = JSON.parse(text), body = structuredClone(c); delete body.catalogHash;
  if (canonical(c) !== text || hash(body) !== c.catalogHash) throw new Error('binding catalog canonical content hash mismatch');
  const m = result.manifest;
  if (c.schema !== 'HitBindingCatalogV1' || c.manifestHash !== result.expectedHash || c.specId !== m.specId || c.buildHash !== m.buildHash || c.sourceGeneratorHash !== m.generator.sha256 || c.geometryBytesChanged !== 0) throw new Error('binding catalog manifest identity mismatch');
  const accepted = acceptedAnatomy(anatomy), anatomyHash = hash(accepted);
  if (!c.acceptedAnatomy || canonical(c.acceptedAnatomy) !== canonical(accepted) || hash(c.acceptedAnatomy) !== anatomyHash || c.anatomyHash !== anatomyHash || m.anatomyDataHash !== anatomyHash) throw new Error('binding catalog accepted anatomy hash/data mismatch');
  if (!Array.isArray(c.declarations) || c.declarations.length > 1_000_000 || !Array.isArray(c.layers) || c.layers.length > 16384) throw new Error('binding catalog declaration/layer limits');
  const unique = list => { const map = new Map(); for (const v of list) { if (typeof v.key !== 'string' || !v.key.length || v.key.length > 1024 || map.has(v.key)) throw new Error('binding catalog duplicate/invalid declaration key'); map.set(v.key, v); } return map; };
  const declarations = unique(c.declarations), layers = unique(c.layers), surfaces = new Map(m.surfaces.map(s => [s.key, s]));
  let coverage = 0, unknown = 0, ambiguous = 0;
  for (const d of c.declarations) {
    const original = structuredClone(d), declaredHash = original.declaration?.contentHash;
    delete original.key; delete original.declaration.contentHash;
    if (hash(original) !== declaredHash || d.key !== `decl:${declaredHash}`) throw new Error('binding declaration content hash mismatch');
    if (!['armor', 'module', 'crew', 'decoration', 'unknown'].includes(d.role) || !['declared', 'none', 'candidate', 'unknown'].includes(d.armorBinding?.status) || d.contactEligible !== true) throw new Error('binding declaration policy invalid');
    if (d.moduleRef !== null && !(anatomy.modules || []).some(m => m.id === d.moduleRef)) throw new Error('binding declaration unknown module reference');
    if (d.crewSlot !== null && (!Number.isInteger(d.crewSlot.index) || !anatomy.crew?.[d.crewSlot.index] || d.crewSlot.anatomyHash !== anatomyHash || d.crewSlot.role !== anatomy.crew[d.crewSlot.index].role)) throw new Error('binding declaration unknown crew slot');
    if (!Array.isArray(d.armorBinding.armorRefs) || d.armorBinding.armorRefs.some(id => !anatomy.armor?.some(a => a.id === id))) throw new Error('binding declaration unknown armor reference');
    if (d.role === 'armor' && (d.armorBinding.status !== 'declared' || d.armorBinding.armorRefs.length !== 1 || !layers.has(d.armorBinding.layerKey) || typeof d.armorBinding.materialRegionKey !== 'string' || !d.armorBinding.materialRegionKey || d.armorBinding.thicknessSource !== 'authored_engineering' || !['outer', 'inner', 'reveal'].includes(d.armorBinding.boundarySide))) throw new Error('armor declaration lacks a declared paired layer');
    if (d.armorBinding.status === 'none' && (d.armorBinding.armorRefs.length || d.armorBinding.layerKey !== null || d.armorBinding.materialRegionKey !== null || d.armorBinding.thicknessSource !== 'none')) throw new Error('nonarmor declaration borrows armor');
    if (d.declaration.basis === INSTANCE_SIDE_BASIS && (!instanceSideDeclaration(d) || d.armorBinding.status !== 'none' || d.crewSlot !== null || d.fuseEligible !== false || d.resistancePolicy !== 'no_authored_armor')) throw new Error('binding declaration instance-side policy invalid');
    if (d.role === 'module' && d.moduleRef === null && !instanceSideDeclaration(d) || d.role === 'crew' && d.crewSlot === null) throw new Error('binding declaration lacks anatomy owner');
    if (d.role === 'unknown' && d.resistancePolicy !== 'unsupported') throw new Error('unknown surface resistance cannot be invented');
    coverage += d.count; if (d.role === 'unknown') unknown += d.count; if (d.owners.length > 1) ambiguous += d.count;
  }
  for (const mesh of m.meshes) {
    const rows = c.declarations.filter(d => d.meshKey === mesh.key).sort((a, b) => a.first - b.first);
    if (rows.length !== mesh.ranges.length) throw new Error('binding catalog mesh range coverage mismatch');
    rows.forEach((d, i) => {
      const r = mesh.ranges[i], s = surfaces.get(r.surfaceKey);
      if (d.first !== r.first || d.count !== r.count || d.sourceKey !== r.sourceKey || d.role !== 'unknown' && s.responseRef !== d.key) throw new Error('binding catalog triangle/surface identity mismatch');
    });
  }
  for (const l of c.layers) {
    const a = anatomy.armor?.find(a => a.id === l.armorRef);
    if (!a || hash(a) !== l.authoredEngineeringHash || a.thickness_mm !== l.authoredThicknessMm || a.material !== l.authoredMaterial || l.chargePolicy !== 'once_per_material_region' || l.historicalMeasurement !== false) throw new Error('binding catalog authored layer data mismatch');
    if (!Array.isArray(l.declarationKeys) || !l.declarationKeys.length || new Set(l.declarationKeys).size !== l.declarationKeys.length || l.declarationKeys.some(key => declarations.get(key)?.armorBinding.layerKey !== l.key || declarations.get(key)?.armorBinding.materialRegionKey !== l.materialRegionKey)) throw new Error('binding catalog paired layer membership mismatch');
  }
  if (!Array.isArray(c.instances) || c.instances.length !== m.meshInstances.length || c.instances.length > 32768) throw new Error('binding catalog instance coverage mismatch');
  const manifestInstances = new Map(m.meshInstances.map(i => [i.key, i])), instanceKeys = new Set();
  const deferredByMesh = new Map();
  for (const d of c.declarations) if (instanceSideDeclaration(d)) {
    if (!deferredByMesh.has(d.meshKey)) deferredByMesh.set(d.meshKey, []);
    deferredByMesh.get(d.meshKey).push(d);
  }
  const deferredMeshesCovered = new Set();
  for (const i of c.instances) {
    if (!i || typeof i !== 'object' || Array.isArray(i)) throw new Error('binding catalog instance shape invalid');
    const emitted = manifestInstances.get(i.instanceKey);
    if (!emitted || instanceKeys.has(i.instanceKey) || i.assemblyKey !== emitted.assemblyKey || canonical(i.materialFeature) !== canonical(emitted.materialFeature)) throw new Error('binding catalog instance identity mismatch');
    if (Object.keys(i).some(key => !['instanceKey', 'assemblyKey', 'materialFeature', 'responseOverrides'].includes(key))) throw new Error('binding catalog instance shape invalid');
    instanceKeys.add(i.instanceKey);
    const expected = deferredByMesh.get(emitted.meshKey) || [], overrides = i.responseOverrides === undefined ? [] : i.responseOverrides;
    if (!Array.isArray(overrides) || overrides.length !== expected.length || i.responseOverrides !== undefined && !overrides.length) throw new Error('binding catalog instance override coverage mismatch');
    const seen = new Set();
    for (const o of overrides) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('binding catalog instance override shape invalid');
      const d = declarations.get(o.responseRef);
      if (Object.keys(o).sort().join(',') !== 'moduleRef,ownerSide,policy,responseRef,sourceKey' || seen.has(o.responseRef) || !d || !instanceSideDeclaration(d) || d.meshKey !== emitted.meshKey || d.sourceKey !== o.sourceKey || o.policy !== 'registered_module_kind') throw new Error('binding catalog instance override identity mismatch');
      if (emitted.materialFeature.status !== 'declared_identity' || !['track_link', 'running_gear_connection'].includes(emitted.materialFeature.kind) || o.ownerSide !== emitted.materialFeature.side || o.moduleRef !== registeredTrackModule(anatomy, o.ownerSide)) throw new Error('binding catalog instance override side/module mismatch');
      seen.add(o.responseRef); deferredMeshesCovered.add(emitted.meshKey);
    }
    if (expected.some(d => !seen.has(d.key))) throw new Error('binding catalog instance override missing declaration');
  }
  if ([...deferredByMesh.keys()].some(key => !deferredMeshesCovered.has(key))) throw new Error('binding catalog instance-side declaration has no instances');
  if (!Array.isArray(c.articulations) || c.articulations.length !== m.assemblies.length) throw new Error('binding catalog articulation coverage mismatch');
  const assemblies = new Map(m.assemblies.map(a => [a.key, a])), articulationKeys = new Set();
  for (const a of c.articulations) {
    const emitted = assemblies.get(a.assemblyKey);
    if (!emitted || articulationKeys.has(a.assemblyKey) || a.parent !== emitted.parent || canonical(a.restTransformBits) !== canonical(emitted.baseTransformBits) || canonical(a.joint) !== canonical(emitted.joint)) throw new Error('binding catalog articulation identity mismatch');
    articulationKeys.add(a.assemblyKey);
    if (a.joint.moduleRef != null && !anatomy.modules?.some(m => m.id === a.joint.moduleRef)) throw new Error('binding catalog articulation unknown module reference');
    if (a.joint.mountedWeaponKey != null && !anatomy.modules?.some(m => m.weapon_group === a.joint.mountedWeaponKey)) throw new Error('binding catalog articulation unknown mounted weapon');
  }
  if (coverage !== m.audits.triangleCoverage || unknown !== c.audit.unknownTriangles || ambiguous !== c.audit.ambiguousTriangles || coverage - unknown !== c.audit.declaredTriangles) throw new Error('binding catalog audit coverage mismatch');
  return true;
}

function normal(c, t) {
  const p = c.positions, o = t * 9, a = [0, 1, 2].map(k => p[o + 3 + k] - p[o + k]), b = [0, 1, 2].map(k => p[o + 6 + k] - p[o + k]);
  const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], len = Math.hypot(...n);
  return len ? n.map(v => v / len) : [0, 0, 0];
}
// These are the existing T72 author's named sector labels. They are a reviewed
// game-data association, explicitly not a survey of historical armor thickness.
function t72Armor(part, n, group) {
  const id = part?.name; let ref = null, side = null;
  if (id === 't72a_welded_hull') {
    ref = n[2] > .2 ? n[1] < 0 ? 'hull_lower' : 'hull_glacis' : n[2] < -.5 ? 'hull_rear' : Math.abs(n[0]) > .5 ? n[0] < 0 ? 'hull_side_l' : 'hull_side_r' : n[1] < 0 ? 'hull_floor' : 'hull_roof';
    side = 'outer';
  } else if (id === 't72a_cast_turret') {
    side = group === 2 ? 'inner' : group === 1 ? 'outer' : 'reveal';
    const outward = group === 2 ? n.map(v => -v) : n;
    ref = outward[1] > .7 ? 'turret_roof' : outward[2] > .50 ? 'turret_front' : outward[2] < -.55 ? 'turret_rear' : outward[0] < 0 ? 'turret_side_l' : 'turret_side_r';
  } else if (/^t72a_(commander|gunner)_(hatch|coaming)$/.test(id || '')) {
    ref = 'turret_roof'; side = n[1] > .5 ? 'outer' : n[1] < -.5 ? 'inner' : 'reveal';
  } else if (id === 't72a_driver_hatch') {
    ref = 'hull_roof'; side = n[1] > .5 ? 'outer' : n[1] < -.5 ? 'inner' : 'reveal';
  }
  return { ref, side };
}

/** Complete exact ownership partition, split only at emitted material/face-group/sector boundaries. */
export function capturedRanges(c) {
  const total = c.positions.length / 9;
  const authored = c.ranges?.length ? c.ranges : [{ first: 0, count: total, part: null }];
  let cursor = 0; const out = [];
  for (const r of authored) {
    if (r.first !== cursor || !Number.isInteger(r.first) || !Number.isInteger(r.count) || r.count <= 0 || r.first + r.count > total) throw new Error('invalid authored triangle ownership partition');
    const part = r.part || null;
    for (let t = r.first; t < r.first + r.count; t++) {
      const materialBits = [0, 1, 2].flatMap(v => bits(c.data.subarray((t * 3 + v) * STRIDE + 6, (t * 3 + v) * STRIDE + 11)));
      const faceGroup = part?.faceGroups?.[t - r.first] ?? null;
      const authoredBinding = c.authoredBindings?.find(b => t >= b.first && t < b.first + b.count) || null;
      const candidate = authoredBinding ? { ref: null, side: null } : t72Armor(part, normal(c, t), faceGroup);
      // GeoBuilder shades vertex colors by normal. That color variation is not a
      // different physical material; rough/metal slots retain true bore/rubber splits.
      const materialSlots = [0, 1, 2].flatMap(v => materialBits.slice(v * 5 + 3, v * 5 + 5));
      const identity = canonical([materialSlots, faceGroup, candidate, authoredBinding]);
      const prior = out.at(-1);
      if (prior && prior.ownerFirst === r.first && prior.identity === identity) prior.count++;
      else out.push({ first: t, count: 1, part: part && structuredClone(part), ownerFirst: r.first,
        ownerCount: r.count, materialBits, faceGroup, candidate, authoredBinding, identity });
    }
    cursor += r.count;
  }
  if (cursor !== total) throw new Error('incomplete authored triangle ownership partition');
  return out;
}

/** Use actual renderer node membership, never module-box proximity, for interior ownership. */
export function bindInteriorCapture(capture, interior, anatomy) {
  const nodes = new Map(capture.map(c => [c.node, c]));
  const mark = (node, owner) => {
    const c = nodes.get(node);
    if (c) {
      c.anatomyOwners ||= [];
      if (!c.anatomyOwners.some(o => canonical(o) === canonical(owner))) c.anatomyOwners.push(owner);
    }
    node.children.forEach(n => mark(n, owner));
  };
  for (const [moduleRef, list] of interior.byModule) {
    if (!anatomy.modules.some(m => m.id === moduleRef)) throw new Error(`unknown interior module ${moduleRef}`);
    list.forEach(n => mark(n, { kind: 'module', moduleRef }));
  }
  interior.byCrew.forEach((n, index) => {
    if (!anatomy.crew[index]) throw new Error('unknown interior crew slot');
    mark(n, { kind: 'crew', index, role: anatomy.crew[index].role });
  });
  return capture;
}

/** Attach reviewed source schedules to capture copies; never edit renderer buffers. */
export function bindAuthoredFleetCapture(capture, specId, anatomy) {
  const review = reviewedFleetSource(specId);
  if (!review) return capture;
  const sources = new Map(anatomy.visual.parts.map(p => [p.hitSource?.key, p]));
  for (const c of capture) {
    c.authoredBindings = [];
    for (const r of c.ranges || []) {
      if (!r.part?.source) continue;
      const source = r.part.source;
      const p = sources.get(source.key);
      // The immutable descriptor and original source bytes are checked again by
      // the registry. A donor part absent from this bundle cannot gain a role.
      if (!p || canonical(source) !== canonical(p.hitSource) || r.part.type !== p.type || r.part.mat !== (p.mat || null)) continue;
      c.authoredBindings.push(...authoredPartBindings(specId,p,anatomy,{first:r.first,count:r.count,mirrorOrdinal:r.part.mirrorOrdinal}));
    }
    const owner = c.physicalOwner || (c.joint?.kind === 'wheel' ? c.joint : null);
    c.authoredRunningGear = owner ? authoredRunningGearBinding(specId,owner,anatomy) : null;
    if (['track_link','running_gear_connection'].includes(c.instanceOwnership?.kind)) {
      // Defer a shared geometry's left/right owner to the actual instance tag.
      c.authoredInstanceSides = true;
    }
  }
  return capture;
}

const physicalClass = label => ['rubber', 'glass', 'canvas', 'wood'].includes(label) ? label : ['steel', 'paint', 'paint_dark', 'track'].includes(label) ? 'metal' : ['lamp', 'orange'].includes(label) ? 'glass' : 'unknown';
const noArmor = () => ({ status: 'none', armorRefs: [], layerKey: null, materialRegionKey: null, boundarySide: null, thicknessSource: 'none', pairing: 'none' });
const unknownArmor = () => ({ status: 'unknown', armorRefs: [], layerKey: null, materialRegionKey: null, boundarySide: null, thicknessSource: 'unknown', pairing: 'unknown' });
const t72Attachment = id => /^t72a_/.test(id || '') && /rubber_skirt|fender|skirt_|stowage|periscope|glass|hinge|handle|tpd_|view_|ir_|canvas|mantlet$|recoil_sleeve|thermal|evacuator|antenna|fuel_drum|drum_|lamp_|headlamp|tow_|engine_grille_brace|turret_lift/.test(id);
// tools/t72a_visual.mjs authors these as covers, shallow overlays, a port sleeve,
// or sponson supports around the closed hull/casting. It supplies no extra armor
// engineering layer. The bearing annulus is intentionally absent from this list.
const t72ReviewedOverlay = id => /^t72a_(sponson_[lr]|engine_grille|engine_louvre_\d+|rear_access_cover|rear_access_catch_.+|rear_fan_cover|rear_fan_bolt_\d+|driver_hatch_pad|pkt_port|ejection_hatch)$/.test(id);

function declaration(specId, c, r, sourceKey, anatomy, anatomyHash) {
  const partId = r.authoredBinding ? `${sourceKey}:feature:${r.authoredBinding.featureKey}` : r.part?.name || (r.part ? `${sourceKey}:part` : `${sourceKey}:unpartitioned`);
  let owners = c.anatomyOwners || [];
  const knownT72 = specId === 'su_t72a' && !c.hitSource;
  const physicalOwner = r.part?.physicalOwner || c.physicalOwner || (c.joint?.kind === 'wheel' ? { kind: 'running_gear', side: c.joint.side, role: c.joint.role, station: c.joint.index } : null);
  let role = 'unknown', moduleRef = null, crewSlot = null, armorBinding = unknownArmor(), topology = { status: 'unknown', kind: 'audit_pending', solidKey: null }, basis = 'unreviewed_source_partition';
  if (owners.length === 1) {
    const owner = owners[0]; role = owner.kind;
    moduleRef = owner.kind === 'module' ? owner.moduleRef : null;
    crewSlot = owner.kind === 'crew' ? { index: owner.index, anatomyHash, role: owner.role } : null;
    armorBinding = noArmor(); topology = { status: 'declared', kind: 'decorative_surface', solidKey: null }; basis = 'actual_interior_node_membership';
  } else if (!owners.length && r.authoredBinding) {
    const authored = r.authoredBinding;
    role = authored.role; moduleRef = authored.moduleRef;
    basis = role === 'unknown' ? 'reviewed_source_constructor_feature_unsupported' : 'reviewed_source_constructor_feature';
    owners = [{ kind:'source_constructor', sourceKey:authored.sourceKey, featureKey:authored.featureKey, weaponKey:authored.weaponKey, reason:authored.reason }];
    if (role === 'armor') {
      topology = { status:'declared',kind:'boundary_shell',solidKey:null };
      // Several source parts may expose the same accepted engineering layer.
      // Their common material region prevents charging that layer twice.
      const asset = r.part.source.assetHash;
      armorBinding = {status:'declared',armorRefs:[authored.armorRef],layerKey:`layer:visual:${asset}:${authored.armorRef}`,
        materialRegionKey:`region:visual:${asset}:${authored.armorRef}`,boundarySide:authored.boundarySide,
        thicknessSource:'authored_engineering',pairing:'same_material_region'};
    } else if (role !== 'unknown') {
      armorBinding = noArmor(); topology = { status:'declared',kind:'decorative_surface',solidKey:null };
    }
  } else if (!owners.length && c.authoredInstanceSides) {
    role = 'module'; armorBinding = noArmor(); topology = {status:'declared',kind:'decorative_surface',solidKey:null}; basis = INSTANCE_SIDE_BASIS;
    owners = [{kind:'module_instance',sideSource:'manifest_material_feature'}];
  } else if (!owners.length && c.authoredRunningGear?.role === 'module') {
    moduleRef = c.authoredRunningGear.moduleRef; role = 'module'; armorBinding = noArmor(); topology = {status:'declared',kind:'decorative_surface',solidKey:null}; basis = 'authored_running_gear_construction_side';
    owners = [{kind:'module',moduleRef,side:c.authoredRunningGear.ownerSide}];
  } else if (knownT72 && ['track_link', 'running_gear_connection'].includes(c.instanceOwnership?.kind)) {
    role = 'module'; armorBinding = noArmor(); topology = { status: 'declared', kind: 'decorative_surface', solidKey: null }; basis = INSTANCE_SIDE_BASIS;
    owners = [{ kind: 'module_instance', sideSource: 'manifest_material_feature' }];
  } else if (knownT72 && physicalOwner?.kind === 'running_gear') {
    moduleRef = registeredTrackModule(anatomy, physicalOwner.side);
    role = 'module'; armorBinding = noArmor(); topology = { status: 'declared', kind: 'decorative_surface', solidKey: null }; basis = 'authored_running_gear_construction_side';
    owners = [{ kind: 'module', moduleRef, side: physicalOwner.side, role: physicalOwner.role, station: physicalOwner.station }];
  } else if (knownT72 && r.candidate.ref) {
    if (!anatomy.armor.some(a => a.id === r.candidate.ref)) throw new Error(`T72 authored armor reference missing: ${r.candidate.ref}`);
    role = 'armor'; topology = { status: 'declared', kind: 'boundary_shell', solidKey: null };
    armorBinding = { status: 'declared', armorRefs: [r.candidate.ref], layerKey: `layer:${sourceKey}:${r.candidate.ref}`,
      materialRegionKey: `region:${sourceKey}${partId === 't72a_welded_hull' ? `:${r.candidate.ref}` : ''}`,
      boundarySide: r.candidate.side, thicknessSource: 'authored_engineering', pairing: 'same_material_region' };
    basis = 't72a_named_part_and_authored_face_group';
  } else if (knownT72 && /^(t72a_barrel|t72a_muzzle_collar)$/.test(partId)) {
    moduleRef = anatomy.modules.find(m => m.id === 'gun_barrel')?.id || null;
    if (moduleRef) { role = 'module'; armorBinding = noArmor(); topology = { status: 'declared', kind: 'decorative_surface', solidKey: null }; basis = 't72a_named_barrel_and_registered_module'; }
  } else if (knownT72 && (/^t72a_nsvt_(barrel|receiver)_/.test(partId) || partId === 't72a_pkt_barrel')) {
    const wanted = partId === 't72a_pkt_barrel' ? 'mg:coax_pkt:barrel' : partId.startsWith('t72a_nsvt_barrel_') ? 'mg:aa_nsvt:barrel' : 'mg:aa_nsvt:receiver';
    moduleRef = anatomy.modules.find(m => m.id === wanted)?.id || null;
    if (moduleRef) { role = 'module'; armorBinding = noArmor(); topology = { status: 'declared', kind: 'decorative_surface', solidKey: null }; basis = 't72a_named_weapon_primitive_and_registered_module'; }
  } else if (knownT72 && t72ReviewedOverlay(partId)) {
    role = 'decoration'; armorBinding = noArmor(); topology = { status: 'declared', kind: 'decorative_surface', solidKey: null }; basis = 't72a_reviewed_overlay_no_additional_armor';
  } else if (knownT72 && (t72Attachment(partId) || partId === 't72a_nsvt_mount')) {
    role = 'decoration'; armorBinding = noArmor(); topology = { status: 'declared', kind: 'decorative_surface', solidKey: null }; basis = 't72a_named_attachment_no_main_armor';
  }
  if (owners.length > 1) basis = 'ambiguous_interior_node_membership';
  const value = { meshKey: `mesh:${c.key}`, first: r.first, count: r.count, sourceKey, partId,
    material: { status: r.part?.packedMaterial ? 'render_parameters_only' : r.part?.mat ? 'authored_visual' : 'unknown', label: r.part?.mat ?? null,
      physicalClass: r.part?.physicalClass || physicalClass(r.part?.mat), renderMaterialBits: r.materialBits, renderMaterialSampleTriangle: r.first,
      packed: r.part?.packedMaterial || null },
    role, topology, armorBinding, moduleRef, crewSlot, contactEligible: true,
    fuseEligible: role === 'armor' ? true : role === 'unknown' ? null : false,
    resistancePolicy: armorBinding.status === 'declared' ? 'authored_thickness' : armorBinding.status === 'none' ? 'no_authored_armor' : 'unsupported',
    faceGroup: r.faceGroup, mirrorOrdinal: r.part?.mirrorOrdinal ?? null, owners,
    declaration: { revision: role === 'unknown' ? 'unreviewed-v1' : REVISION, basis } };
  value.declaration.contentHash = hash(value);
  value.key = `decl:${value.declaration.contentHash}`;
  return value;
}

/** Populate the native-compatible manifest and create a separate full-file-hash-pinned catalog. */
export function bindingCatalogFromCapture(result, capture, anatomy, articulations = result.manifest.assemblies, targetRegistrationHash = null) {
  const manifest = result.manifest, accepted = acceptedAnatomy(anatomy), anatomyHash = hash(accepted);
  const declarations = [], byLayer = new Map(), mapped = new Map(capture.map(c => [`mesh:${c.key}`, c]));
  const bindingKeys = new Set(manifest.bindings.map(b => b.key));
  const bind = value => { if (!bindingKeys.has(value.key)) { manifest.bindings.push(value); bindingKeys.add(value.key); } else Object.assign(manifest.bindings.find(b => b.key === value.key), value); };
  for (const mesh of manifest.meshes) {
    const c = mapped.get(mesh.key); if (!c) throw new Error('catalog capture/manifest mesh mismatch');
    const ranges = capturedRanges(c); if (ranges.length !== mesh.ranges.length) throw new Error('catalog triangle partition differs from manifest');
    ranges.forEach((r, i) => {
      const manifestRange = mesh.ranges[i], sourceKey = manifestRange.sourceKey;
      if (manifestRange.first !== r.first || manifestRange.count !== r.count) throw new Error('catalog triangle range mismatch');
      const d = declaration(manifest.specId, c, r, sourceKey, anatomy, anatomyHash); declarations.push(d);
      const surface = manifest.surfaces.find(s => s.key === manifestRange.surfaceKey);
      if (d.role !== 'unknown') {
        surface.role = d.role; surface.topology = d.topology.kind; surface.contactEligible = true; surface.fuseEligible = d.fuseEligible;
        surface.responseRef = d.key;
        if (d.moduleRef) { const key = `module:${d.moduleRef}`; bind({ key, kind: 'module', moduleId: d.moduleRef, status: 'declared_actual_render_geometry' }); surface.moduleKey = key; manifestRange.bindingKey = key; }
        if (d.crewSlot) { const key = `crew:${anatomyHash}:${d.crewSlot.index}`; bind({ key, kind: 'crew', crewIndex: d.crewSlot.index, crewRole: d.crewSlot.role, status: 'declared_actual_render_geometry' }); surface.crewKey = key; manifestRange.bindingKey = key; }
        if (d.armorBinding.layerKey) {
          const layerKey = d.armorBinding.layerKey, armorId = d.armorBinding.armorRefs[0], a = anatomy.armor.find(a => a.id === armorId);
          bind({ key: layerKey, kind: 'armor', armorId, authoredEngineeringHash: hash(a), status: 'declared_authored_surface_association' });
          surface.armorLayerKey = layerKey; manifestRange.bindingKey = layerKey;
          if (!byLayer.has(layerKey)) byLayer.set(layerKey, { key: layerKey, armorRef: armorId,
            materialRegionKey: d.armorBinding.materialRegionKey,
            authoredEngineeringHash: hash(a), authoredThicknessMm: a.thickness_mm, authoredMaterial: a.material,
            thicknessSource: 'authored_engineering', chargePolicy: 'once_per_material_region',
            historicalMeasurement: false, declarationKeys: [] });
          byLayer.get(layerKey).declarationKeys.push(d.key);
        }
      }
    });
  }
  const unknown = declarations.filter(d => d.role === 'unknown').reduce((n, d) => n + d.count, 0);
  manifest.anatomyDataHash = anatomyHash;
  manifest.audits.unclassifiedPhysicalTriangles = unknown; manifest.audits.missingBindings = unknown;
  manifest.audits.ambiguousBindings = declarations.filter(d => d.owners.length > 1).reduce((n, d) => n + d.count, 0);
  delete manifest.manifestHash; manifest.manifestHash = hash(manifest); result.text = canonical(manifest); result.expectedHash = createHash('sha256').update(result.text).digest('hex');
  const catalog = { schema: 'HitBindingCatalogV1', specId: manifest.specId, manifestHash: result.expectedHash,
    buildHash: manifest.buildHash, anatomyHash, acceptedAnatomy: accepted, targetRegistrationHash, declarationRevision: REVISION,
    sourceGeneratorHash: manifest.generator.sha256, geometryBytesChanged: 0,
    declarations, layers: Array.from(byLayer.values()), articulations: articulations.map(a => ({ assemblyKey: a.key, parent: a.parent, restTransformBits: a.baseTransformBits, joint: a.joint })),
    instances: manifest.meshInstances.map(i => {
      const relevant = declarations.filter(d => d.meshKey === i.meshKey && instanceSideDeclaration(d));
      return { instanceKey: i.key, assemblyKey: i.assemblyKey, materialFeature: i.materialFeature,
        ...(relevant.length ? { responseOverrides: relevant.map(d => ({ responseRef: d.key, sourceKey: d.sourceKey,
          moduleRef: registeredTrackModule(anatomy, i.materialFeature.side), ownerSide: i.materialFeature.side, policy: 'registered_module_kind' })) } : {}) };
    }),
    audit: { status: unknown ? 'reviewed_subset' : 'declared_authored_geometry', physicalTriangles: manifest.audits.triangleCoverage,
      declaredTriangles: manifest.audits.triangleCoverage - unknown, unknownTriangles: unknown,
      ambiguousTriangles: manifest.audits.ambiguousBindings, historicalArmorCertification: false,
      missingSemantics: Array.from(new Set(declarations.filter(d => d.role === 'unknown').map(d => d.partId))) } };
  catalog.catalogHash = hash(catalog); const text = canonical(catalog);
  return { catalog, text, expectedHash: createHash('sha256').update(text).digest('hex') };
}

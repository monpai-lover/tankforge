// The design document the bureau edits: a VehicleDesign (crates/design format) plus its
// construction history in `design.editor`:
//   editor.hull   = {params, ops}   base-shape parameters and the free edits made on top
//   editor.turret = {params, ops} | null
// Changing a base parameter regenerates the base mesh and replays the edits, so a player can
// lengthen a hull after extruding a superstructure on it. Face ids are stable through all of
// this, which is what keeps armour assignments attached to the right plates.
import * as M from './mesh.js';
import { genHull, genTurret, hullArmorFor, turretArmorFor } from './gen.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

/** Applies one recorded edit to a mesh in place. Returns the faces it created ({id, parent}). */
export function applyOp(mesh, op) {
  switch (op.t) {
    case 'move':
      M.move(mesh, op.v, op.d);
      return [];
    case 'rot': {
      const pivot = op.pivot || M.centroidOf(mesh, op.v);
      M.rotate(mesh, op.v, op.axis, op.a, pivot);
      return [];
    }
    case 'scale': {
      const pivot = op.pivot || M.centroidOf(mesh, op.v);
      M.scale(mesh, op.v, op.s, pivot);
      return [];
    }
    case 'extrude':
      return M.extrude(mesh, op.f, op.d).created;
    case 'inset':
      return M.inset(mesh, op.f, op.d).created;
    case 'bevel': {
      const out = [];
      for (const [a, b] of op.e) out.push(...M.bevelEdge(mesh, a, b, op.w).created);
      return out;
    }
    case 'split':
      return M.splitFace(mesh, op.f, op.axis, op.cuts).created;
    default:
      throw new Error('未知的編輯：' + op.t);
  }
}

/** Base mesh + history. Edits that no longer apply (their faces are gone) are skipped and counted. */
export function buildBody(kind, entry) {
  const base = kind === 'hull' ? genHull(entry.params) : genTurret(entry.params);
  const mesh = base.mesh;
  const created = [];
  let skipped = 0;
  for (const op of entry.ops || []) {
    const before = M.cloneMesh(mesh);
    try {
      created.push(...applyOp(mesh, op));
      if (!M.checkClosed(mesh).closed) throw new Error('open');
    } catch {
      skipped++;
      mesh.vertices = before.vertices;
      mesh.faces = before.faces;
    }
  }
  return { mesh, params: base.params, created, skipped };
}

/** Per-corner thickness of every face as vertex index -> mm, to carry it through topology changes. */
function cornerMaps(design, body) {
  const out = new Map();
  for (const a of design.armor_faces) {
    if (a.body !== body || !a.vertex_mm) continue;
    const mesh = body === 'hull' ? design.hull_geometry : design.turret_geometry;
    const f = mesh && M.findFace(mesh, a.face);
    if (!f || f.v.length !== a.vertex_mm.length) continue;
    out.set(a.face, new Map(f.v.map((vi, k) => [vi, a.vertex_mm[k]])));
  }
  return out;
}

/**
 * After a body's mesh changed: every face gets an armour entry (inherited from the face it was
 * cut or extruded from, else the default for its zone), per-corner lists follow the new corner
 * lists, and entries for faces that no longer exist are dropped.
 */
export function reconcileArmor(design, body, mesh, created, oldMaps) {
  const parentOf = new Map(created.map((c) => [c.id, c.parent]));
  const entries = new Map(design.armor_faces.filter((a) => a.body === body).map((a) => [a.face, a]));
  const stacks = new Map((design.armor_layers || []).filter((s) => s.body === body).map((s) => [s.face, s]));
  const outFaces = [];
  const outStacks = [];
  const defaults = body === 'hull' ? hullArmorFor : turretArmorFor;
  for (const f of mesh.faces) {
    let root = f.id;
    for (let k = 0; k < 64 && !entries.has(root) && parentOf.has(root); k++) root = parentOf.get(root);
    let e = entries.get(f.id) ? clone(entries.get(f.id)) : entries.get(root) ? { ...clone(entries.get(root)), face: f.id } : null;
    if (!e) e = { body, face: f.id, material: 'rha', thickness_mm: defaults(f.tag) };
    if (e.vertex_mm) {
      const map = oldMaps.get(f.id) || oldMaps.get(root);
      if (map) {
        const vals = f.v.map((vi) => map.get(vi));
        // corners that did not exist before (cut points) take the mean of their neighbours
        for (let pass = 0; pass < 3; pass++) {
          for (let k = 0; k < vals.length; k++) {
            if (vals[k] != null) continue;
            const a = vals[(k + vals.length - 1) % vals.length];
            const b = vals[(k + 1) % vals.length];
            if (a != null && b != null) vals[k] = (a + b) / 2;
            else if (a != null || b != null) vals[k] = a ?? b;
          }
        }
        e.vertex_mm = vals.map((v) => Math.round((v ?? e.thickness_mm) * 10) / 10);
      } else if (e.vertex_mm.length !== f.v.length) delete e.vertex_mm;
    }
    outFaces.push(e);
    const st = stacks.get(f.id) || stacks.get(root);
    if (st) outStacks.push({ ...clone(st), face: f.id });
  }
  design.armor_faces = design.armor_faces.filter((a) => a.body !== body).concat(outFaces);
  design.armor_layers = (design.armor_layers || []).filter((s) => s.body !== body).concat(outStacks);
}

export class DesignDoc {
  constructor(design) {
    this.design = design;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this.skipped = { hull: 0, turret: 0 };
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(kind) {
    for (const fn of this.listeners) fn(kind);
  }

  snapshot() {
    this.undoStack.push(JSON.stringify(this.design));
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(JSON.stringify(this.design));
    this.design = JSON.parse(this.undoStack.pop());
    this.emit('all');
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(JSON.stringify(this.design));
    this.design = JSON.parse(this.redoStack.pop());
    this.emit('all');
    return true;
  }

  mesh(body) {
    return body === 'hull' ? this.design.hull_geometry : this.design.turret_geometry;
  }

  entry(body) {
    return this.design.editor?.[body] || null;
  }

  /** Regenerates a body from its parameters and history. */
  rebuild(body) {
    const entry = this.entry(body);
    if (!entry) return;
    const oldMaps = cornerMaps(this.design, body);
    const r = buildBody(body, entry);
    entry.params = r.params;
    if (body === 'hull') this.design.hull_geometry = r.mesh;
    else this.design.turret_geometry = r.mesh;
    this.skipped[body] = r.skipped;
    reconcileArmor(this.design, body, r.mesh, r.created, oldMaps);
  }

  /** Base-shape parameters. A different topology (type) clears the free edits. */
  setParams(body, patch, { record = true } = {}) {
    const entry = this.entry(body);
    if (!entry) return;
    if (record) this.snapshot();
    const typeChanged = patch.type && patch.type !== entry.params.type;
    const shapeChanged = (patch.roof && patch.roof !== entry.params.roof) || (patch.floor && patch.floor !== entry.params.floor);
    if (typeChanged) {
      entry.ops = [];
      this.design.armor_faces = this.design.armor_faces.filter((a) => a.body !== body);
      this.design.armor_layers = (this.design.armor_layers || []).filter((s) => s.body !== body);
    }
    entry.params = { ...entry.params, ...patch };
    this.rebuild(body);
    this.emit(typeChanged || shapeChanged ? 'topology' : 'shape');
  }

  /** Records and applies one free edit. Throws (without recording) if it cannot be done. */
  edit(body, op, { record = true } = {}) {
    const entry = this.entry(body);
    const mesh = M.cloneMesh(this.mesh(body));
    const created = applyOp(mesh, op);
    if (!M.checkClosed(mesh).closed) throw new Error('這個編輯會讓網格不封閉');
    if (record) this.snapshot();
    const oldMaps = cornerMaps(this.design, body);
    entry.ops.push(op);
    if (body === 'hull') this.design.hull_geometry = mesh;
    else this.design.turret_geometry = mesh;
    reconcileArmor(this.design, body, mesh, created, oldMaps);
    this.emit(op.t === 'move' || op.t === 'rot' || op.t === 'scale' ? 'shape' : 'topology');
    return created;
  }

  /** Replaces the last recorded edit (live dragging): undo it by replaying, then apply the new one. */
  replaceLastEdit(body, op) {
    const entry = this.entry(body);
    entry.ops.pop();
    entry.ops.push(op);
    this.rebuild(body);
    this.emit('shape');
  }

  /** Any other change (armour, modules, components): snapshot, mutate, notify. */
  change(fn, kind = 'data') {
    this.snapshot();
    fn(this.design);
    this.emit(kind);
  }

  armor(body, face) {
    return this.design.armor_faces.find((a) => a.body === body && a.face === face) || null;
  }

  stack(body, face) {
    return (this.design.armor_layers || []).find((s) => s.body === body && s.face === face) || null;
  }

  /** Mirror partners of a selection when symmetric editing is on. */
  mirrorSelection(body, mode, items) {
    const mesh = this.mesh(body);
    if (!mesh) return items;
    if (mode === 'vertex') {
      const mm = M.mirrorMap(mesh);
      return [...new Set([...items, ...items.map((i) => mm[i]).filter((i) => i >= 0)])];
    }
    if (mode === 'edge') {
      const mm = M.mirrorMap(mesh);
      const key = (e) => (e[0] < e[1] ? e[0] + ',' + e[1] : e[1] + ',' + e[0]);
      const out = new Map(items.map((e) => [key(e), e]));
      for (const [a, b] of items) {
        const e = [mm[a], mm[b]];
        if (e[0] >= 0 && e[1] >= 0) out.set(key(e), e);
      }
      return [...out.values()];
    }
    if (mode === 'face') {
      const mf = M.mirrorFaces(mesh);
      return [...new Set([...items, ...items.map((f) => mf.get(f)).filter((f) => f != null)])];
    }
    return items;
  }
}

export function vertsOfSelection(mesh, mode, items) {
  if (mode === 'vertex') return items.slice();
  if (mode === 'edge') return [...new Set(items.flat())];
  if (mode === 'face') {
    const s = new Set();
    for (const id of items) {
      const f = M.findFace(mesh, id);
      if (f) for (const v of f.v) s.add(v);
    }
    return [...s];
  }
  return [...M.usedVertices(mesh)];
}

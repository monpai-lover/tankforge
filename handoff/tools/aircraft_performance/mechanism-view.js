/* O shows mechanisms without drawing the aircraft's skin or generated cage. */
var TFMechanismView = (() => {
  function mechanicalName(name) {
    // Imported controllers use both GearCover and leg_cover names. Panel words
    // must win over generic "gear", "leg" or "wheel"; DoorActuator/door_rod
    // still names a mechanism attached to a door, not the panel itself.
    const words = String(name || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    // Some source parts are all-lowercase compounds, e.g. geardoor_002.
    const panel = words.some(w => /door|cover|hatch|fairing|panel|skin|^caps?$/.test(w));
    const mechanism = words.some(w => /^(?:jack|ram|rod|link|scissor|fork|knee|strut|actuator|brace|crank|oleo|cylinder|piston|hinge)s?$/.test(w));
    return !panel || mechanism;
  }
  function isGearControl(control) {
    // Four-axis imported rigs distinguish leg/door channels (gear_main,
    // gear_nose, gear_main_doors, gear_nose_door) from legacy scalar gear.
    return [control?.type, control?.param].some(value => /^(?:gear|tailgear)(?:$|[_-])/i.test(String(value || '')));
  }
  function gearMechanism(control) {
    return isGearControl(control) && mechanicalName([control.name, control.type, control.param].filter(Boolean).join('_'));
  }
  function prepare(plane) {
    if (plane.mechanismGearView) return plane.mechanismGearView;
    const model = plane.type.model, records = [];
    for (const c of plane.controls) {
      if (!isGearControl(c)) continue;
      const parts = model?.buf && Number.isInteger(c.mover) ? model.parts.filter(p => p.mover === c.mover && p.group !== 'glass') : [];
      const kept = parts.filter(p => mechanicalName(p.name));
      if (!parts.length || kept.length === parts.length || !kept.length) {
        records.push({ control: c, keep: parts.length ? kept.length > 0 : gearMechanism(c), node: null });
        continue;
      }
      // One joint can carry both a door panel and its actuator. Draw an exact
      // subset as a child of that joint in O, retaining the original full mesh
      // as the sole physical collider in every view.
      const values = [], origin = model.movers[c.mover].p, k = model.posScale;
      for (const p of kept) {
        const pos = new Int16Array(model.buf, p.pos, p.vertices * 3), nor = new Int8Array(model.buf, p.nor, p.vertices * 3), uv = new Uint16Array(model.buf, p.uv, p.vertices * 2);
        const idx = p.idx32 ? new Uint32Array(model.buf, p.idx, p.triangles * 3) : new Uint16Array(model.buf, p.idx, p.triangles * 3), col = p.textured ? [1, 1, 1] : p.colour;
        for (const i of idx) values.push(pos[i*3]*k-origin[0],pos[i*3+1]*k-origin[1],pos[i*3+2]*k-origin[2],nor[i*3]/127,nor[i*3+1]/127,nor[i*3+2]/127,...col,p.rough??.6,p.metal??.2,uv[i*2]/65535,1-uv[i*2+1]/65535);
      }
      const node = c.node.add(new Node('aircraft_gear_mechanisms_' + c.mover));
      node.mesh = plane.renderer.mesh(new Float32Array(values));
      node.mesh.aircraftGeometry = true;
      plane.meshes.push(node.mesh);
      node.kind = node.baseKind = c.node.baseKind ?? 3;
      node.castShadow = false; node.visible = false;
      node.hitboxDisabled = true; // Original full source mesh remains physical.
      node.aircraftMechanismSubset = true;
      Object.defineProperty(node, 'texture', { get: () => c.node.texture });
      Object.defineProperty(node, 'normalTex', { get: () => c.node.normalTex });
      records.push({ control: c, keep: false, node, sourceParts: kept.map(p => p.name) });
    }
    return plane.mechanismGearView = records;
  }
  function apply(plane) {
    const on = !!plane.xray;
    const skins = [plane.body, plane.cockpit, plane.glass, ...plane.pieceNodes].filter(Boolean);
    for (const n of skins) n.aircraftHiddenSkin = on;
    for (const c of plane.controls) {
      c.node.aircraftHiddenSkin = on && !gearMechanism(c);
      if (on && !c.node.aircraftHiddenSkin) c.node.kind = c.node.baseKind ?? 3;
    }
    for (const r of prepare(plane)) {
      r.control.node.aircraftHiddenSkin = on && !r.keep;
      if (r.node) r.node.visible = on;
    }
    if (plane.prop && on) plane.prop.kind = plane.prop.baseKind ?? 3;
  }
  return { apply, gearMechanism, mechanicalName, isGearControl };
})();

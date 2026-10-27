/* O keeps the actual translucent airframe around opaque mechanisms.
 * The approximate procedural cage remains hidden by the interior builder.
 */
var TFMechanismView = (() => {
  function mechanicalName(name) {
    name = String(name || '').toLowerCase();
    if (/leg_cover/.test(name)) return false;
    if (/jack|ram|sleeve|rod|link|scissor|fork|knee|strut|wheel|tire|tyre|hub|leg|actuator|brace|crank|oleo|idler|shrink|housing/.test(name)) return true;
    return !/door|cover|cap|hatch|fairing|panel|skin/.test(name);
  }
  function gearMechanism(control) {
    if (control.type !== 'gear' && control.type !== 'tailgear' && control.param !== 'gear') return false;
    return mechanicalName(control.name);
  }
  function prepare(plane) {
    if (plane.mechanismGearView) return plane.mechanismGearView;
    const model = plane.type.model, records = [];
    for (const c of plane.controls) {
      if (c.type !== 'gear' && c.type !== 'tailgear' && c.param !== 'gear') continue;
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
    // Keep original meshes, joints, damage visibility and collision membership.
    // Kind 6 is the host's rim-lit transparent shell, not replacement geometry.
    for (const n of skins) {
      n.aircraftHiddenSkin = false;
      n.aircraftShell = on ? n === plane.glass ? .12 : n === plane.cockpit ? .20 : n === plane.body ? .25 : .48 : 0;
      if (on) n.kind = 6;
    }
    for (const c of plane.controls) {
      c.node.aircraftHiddenSkin = false;
      c.node.aircraftShell = on && !gearMechanism(c) ? .40 : 0;
      if (on) c.node.kind = gearMechanism(c) ? c.node.baseKind ?? 3 : 6;
    }
    for (const r of prepare(plane)) {
      r.control.node.aircraftHiddenSkin = false;
      r.control.node.aircraftShell = on && !r.keep ? .32 : 0;
      if (on) r.control.node.kind = r.keep ? r.control.node.baseKind ?? 3 : 6;
      if (r.node) r.node.visible = on;
    }
    if (plane.prop && on) plane.prop.kind = plane.prop.baseKind ?? 3;
  }
  const centers = new WeakMap();
  const roles = {
    en: {engine:'Engine',fuel:'Fuel tank',crew:'Pilot',weapon:'Cannon',ammunition:'Ammunition',avionics:'Avionics',cooling:'Cooling',control:'Flight controls'},
    zh: {engine:'发动机',fuel:'油箱',crew:'飞行员',weapon:'机炮',ammunition:'弹药',avionics:'航电设备',cooling:'冷却系统',control:'操纵机构'}
  };
  /** Aircraft-only labels: the parked tank's labels must never leak into O. */
  function labels(plane, language='zh') {
    if (!plane?.xray) return [];
    const interior=plane.ensureDetailedInterior?.() || plane.detailedInterior;
    if (!interior) return [];
    const words=roles[language==='en'?'en':'zh'],groups=new Map();
    for (const p of interior.parts) {
      if (!words[p.role] || !p.node?.visible || p.node.hitboxDisabled || !p.data?.length) continue;
      let center=centers.get(p);
      if (!center) {
        const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
        for(let i=0;i<p.data.length;i+=13)for(let k=0;k<3;k++){
          lo[k]=Math.min(lo[k],p.data[i+k]);hi[k]=Math.max(hi[k],p.data[i+k]);
        }
        center=lo.map((v,k)=>(v+hi[k])*.5);centers.set(p,center);
      }
      const m=p.node.world;
      if(!m)continue;
      const point=[0,1,2].map(k=>m[k]*center[0]+m[4+k]*center[1]+m[8+k]*center[2]+m[12+k]);
      if(!point.every(Number.isFinite))continue;
      const key=p.role+'|'+p.id+'|'+(p.owner||'');
      // Larger components provide a more useful label anchor than a wire or bolt.
      const old=groups.get(key);
      if(old&&old.vertices>=p.data.length)continue;
      const side=/_l(?:_out)?$/.test(p.id)?(language==='en'?' L':' 左'): /_r(?:_out)?$/.test(p.id)?(language==='en'?' R':' 右'):'';
      groups.set(key,{point,text:words[p.role]+side,crew:p.role==='crew',vertices:p.data.length});
    }
    return [...groups.values()].slice(0,14);
  }
  return { apply, gearMechanism, mechanicalName, labels };
})();

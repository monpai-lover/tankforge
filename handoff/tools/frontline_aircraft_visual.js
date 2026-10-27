// The original Aircraft/model/cockpit path. Remote actors interpolate accepted
// buffers; a controlled private life may bind the exact shared local C plant.
// Combat resources and damage always remain native accepted projections.
function syncFrontlineFittedMounts(plane, stores) {
  if (typeof TFMountedDetails === 'undefined') return;
  // Host layout keys select already-authored hardware. Released weapons retain
  // their carrier; public contacts explicitly remove it with mount_present.
  // Never derive a key, position, owner or loadout from local menu preferences.
  TFMountedDetails.attach(plane, stores.filter(store => store.mount_present !== false));
}

function createFrontlineAircraftVisual(renderer, aircraftId, callbacks = {}) {
  if (!AIRCRAFT_TYPES[aircraftId]) throw new Error(`未知飞机模型：${aircraftId}`);
  const memory = { buffer: new ArrayBuffer((80 + 48) * 4) };
  const api = {
    memory, state_ptr: () => 0, state_len: () => 80,
    aero_state_ptr: () => 80 * 4, aero_state_len: () => 48,
    // Aircraft.applyDamage updates coefficients; this remote buffer has no
    // plant. A private controlled actor binds a real shared instance later.
    set_damage() {},
    step() { throw new Error('Frontline aircraft presentation cannot step flight'); }
  };
  const plane = new Aircraft(renderer, api, aircraftId);
  const state = plane.state;
  let tick = -1, accepted = null, controlled = false, disposed = false, damageKey = '', mounted = null, loadout = null;
  let resourceRevision = null, serviceRevision = null;
  let publicStoreKey = '', acceptedStoreKey = '';
  let localFlight=null,localPending=null,localToken=0,localEpoch=null,failedEpoch=null;
  const interpolation=callbacks.interpolate&&typeof createFrontlineFlightInterpolation==='function'?createFrontlineFlightInterpolation(plane):null;
  Object.defineProperty(plane,'groundSpeed',{get(){return accepted?.sensed?accepted.ground_speed:Math.hypot(plane.cur[7],plane.cur[9]);}});
  plane.cur[6] = plane.prev[6] = plane.S[6] = 1;
  plane.update = () => { throw new Error('Frontline aircraft presentation cannot update flight'); };

  function initialiseIntent() {
    const s = accepted?.state||plane.cur;
    state.throttle = Math.max(0, Math.min(1.12, s[27]));
    state.instructor = true; state.gear = s[33] > .5;
    state.flaps = s[34] > .375 ? 'takeoff' : s[34] > .125 ? 'combat' : 'up';
    state.brake = plane.aero[23] > .5; state.level = false;
    plane.aim = [s[48], s[49], s[50]];
    if (Math.hypot(...plane.aim) < .5) plane.aim = [0, 0, 1];
    plane.camQ = aqLook(plane.aim);
  }
  function setControlled(on, keys) {
    if(on&&accepted?.sensed)throw new Error('A sensed aircraft cannot become local control');
    if (on && !controlled) initialiseIntent();
    if ((!on&&controlled)||(on&&accepted&&localEpoch!==accepted.epoch)) {
      localToken++;localPending=null;localFlight?.dispose();localFlight=null;failedEpoch=null;
      if(accepted&&!accepted.sensed)interpolation?.reset(accepted.state,accepted.aero);
    }
    if (!on && controlled) plane.keys = new Set();
    controlled = !!on;
    if (keys) plane.keys = keys;
    if (!controlled) state.camera = 0;
    if(controlled&&accepted&&!accepted.sensed&&accepted.alive!==false&&callbacks.createFlightCore&&failedEpoch!==accepted.epoch&&!localFlight&&!localPending){
      localEpoch=accepted.epoch;const token=++localToken,epoch=localEpoch;
      localPending=Promise.resolve().then(()=>callbacks.createFlightCore()).then(api=>{
        if(disposed||!controlled||token!==localToken||accepted?.epoch!==epoch)return;
        localFlight=createFrontlineLocalFlight({api,plane,unit:accepted,epoch,configure:callbacks.configureFlight});
      }).catch(error=>{if(token===localToken){failedEpoch=epoch;callbacks.flightError?.(error);}}).finally(()=>{if(token===localToken)localPending=null;});
    }
  }
  function accept(unit, nextTick) {
    if (disposed) return;
    if(unit.sensed)return acceptPublic(unit,nextTick);
    if (unit.aircraft !== aircraftId || !unit.state || unit.state.length !== 80 ||
        !unit.aero || unit.aero.length !== 48 ||
        !Array.from(unit.state).every(Number.isFinite) || !Array.from(unit.aero).every(Number.isFinite)) {
      throw new Error(`飞机状态格式错误：${aircraftId}`);
    }
    if (nextTick === tick && accepted === unit) return;
    if(unit.custom!=null&&!callbacks.mountAcceptedStores)throw new Error('Native accepted custom 外挂 renderer is unavailable');
    if(!Array.isArray(unit.stores||[]))throw new Error('Invalid accepted aircraft stores');
    const nextStoreKey=JSON.stringify({custom:unit.custom==null?null:Object.entries(unit.custom).sort(([a],[b])=>a.localeCompare(b)),stores:(unit.stores||[]).map(({id,owner,p,pylon,rack,sourceStore,sourceMount,side})=>({id,owner,p,pylon,rack,sourceStore,sourceMount,side}))});
    const first = accepted === null;
    if(!localFlight){
      plane.prev.set(first ? unit.state : plane.cur);
      plane.cur.set(unit.state); plane.S.set(unit.state); plane.aero.set(unit.aero);
    }
    accepted = unit; tick = nextTick;
    const nextLoadout = unit.loadout ?? 0;
    const nextResourceRevision = unit.resource_revision ?? null;
    const nextServiceRevision = unit.service_revision ?? unit.service?.revision ?? null;
    const serviceCompleted = unit.service?.status === 'complete' && nextServiceRevision !== null &&
      nextServiceRevision !== serviceRevision && nextResourceRevision !== null && nextResourceRevision !== resourceRevision;
    if (loadout !== nextLoadout || serviceCompleted || acceptedStoreKey!==nextStoreKey) {
      mounted = callbacks.mountAcceptedStores?callbacks.mountAcceptedStores(plane,aircraftId,unit.stores||[],unit):callbacks.mountStores?.(plane, aircraftId, nextLoadout) || null;
      loadout = nextLoadout;
      acceptedStoreKey=nextStoreKey;
    }
    // HUD readers consume accepted inventories. Rendering never burns fuel,
    // spends ammunition, releases a store, or advances AirDamage.step().
    plane.instrumentContext = { plane, guns: unit.guns || [], fuel: unit.fuel || null,
      stores: mounted || { items: [] }, resourceRevision: unit.resource_revision };
    if (!controlled) initialiseIntent();
    plane.pose(1);
    const damage = unit.damage;
    if (damage?.parts) {
      const ids = damage.part_ids;
      if (ids && (ids.length !== damage.parts.length || new Set(ids).size !== ids.length)) {
        throw new Error(`飞机部件标识错误：${aircraftId}`);
      }
      const byId = ids ? new Map(ids.map((id, i) => [id, damage.parts[i]])) : null;
      const aliases = damage.visual_aliases || {}, bindings = new Map();
      if (byId) for (const part of plane.damage.parts) {
        const source = byId.has(part.id) ? part.id : Object.hasOwn(aliases, part.id) ? aliases[part.id] : null;
        if (!source || !byId.has(source)) throw new Error(`飞机部件目录不匹配：${aircraftId}/${part.id}`);
        if (source !== part.id) {
          const max = damage.part_max_hp?.[ids.indexOf(source)];
          if (!Number.isFinite(max) || max <= 0) throw new Error(`飞机部件投影缺少上限：${aircraftId}/${part.id}`);
        }
        bindings.set(part.id, source);
      }
      if (!byId && damage.parts.length !== plane.damage.parts.length) {
        throw new Error(`飞机部件目录不匹配：${aircraftId}`);
      }
      const key = JSON.stringify(damage);
      if (key !== damageKey) {
        plane.damage.parts.forEach((part, i) => {
          const source = bindings.get(part.id), [hp, gone] = byId ? byId.get(source) : damage.parts[i];
          // Only an explicit host-declared visual alias may project an existing
          // aggregate component onto another visual node. No new damage body or
          // independent engine/fin state is inferred by this renderer.
          part.hp = byId && source !== part.id ? hp / damage.part_max_hp[ids.indexOf(source)] * part.max : hp;
          const detached = !!gone;
          if (detached !== part.detached) {
            part.detached = detached; plane.damage._alive = null;
            if (detached) {
              if (!plane.damage.detachedLog.includes(part.id)) plane.damage.detachedLog.push(part.id);
            } else plane.damage.detachedLog = plane.damage.detachedLog.filter(id => id !== part.id);
          }
        });
        plane.damage.fire = damage.fire ? Math.max(plane.damage.fire, .001) : 0;
        plane.damage.broken = !!damage.broken; plane.damage.revision++;
        for (const node of plane.pieceNodes) if (!plane.damage.gone(node.part)) node.fell = false;
        for (const control of plane.controls) if (!control.gonePart || !plane.damage.gone(control.gonePart)) control.fell = false;
        plane.damageRev = -1; plane.applyDamage(); plane.pose(1); damageKey = key;
        plane.frontlineDamageBindings = Object.fromEntries(bindings);
      }
    }
    if (serviceCompleted && plane.debris.length) {
      // _debris creates new cosmetic nodes sharing original mesh buffers; it
      // never removes the original surface node. Remove only those copies and
      // retain all original GPU meshes so repair and a later detachment work.
      const debrisNodes = new Set(plane.debris.map(piece => piece.node));
      plane.root.children = plane.root.children.filter(node => !debrisNodes.has(node));
      plane.debris = [];
    }
    const stores = unit.stores || [];
    if (stores.length && !mounted) throw new Error(`飞机外挂模型未接入：${aircraftId}`);
    if (mounted) {
      if (mounted.items.length !== stores.length) throw new Error(`飞机外挂目录不匹配：${aircraftId}`);
      for (let i = 0; i < stores.length; i++) {
        const host = stores[i], item = mounted.items[i];
        if (host.id !== item.id || host.owner !== item.owner || !host.p || host.p.length !== 3 || !host.p.every(Number.isFinite)) {
          throw new Error(`飞机外挂绑定不匹配：${aircraftId} #${i}`);
        }
        item.p = host.p.slice(); item.count = host.count; item.gone = !!host.gone; item.fuel = host.fuel;
        item.fittedMountKey = host.fittedMountKey || null;
        if (item.node) { item.node.local = quatMatrix(item.p, TFModelHardpoints.storeRotation(item)); item.node.visible = !item.gone; }
      }
    }
    resourceRevision = nextResourceRevision; serviceRevision = nextServiceRevision;
    syncFrontlineFittedMounts(plane, stores);
    projectStores();
    if(localFlight)localFlight.accept(unit,unit.epoch);
    else if(interpolation){interpolation.accept(unit.state,unit.aero);interpolation.pose(0);}
  }
  function acceptPublic(unit,nextTick){
    if(controlled||unit.aircraft!==aircraftId||!unit.quaternion||unit.quaternion.length!==4||!unit.pos||unit.pos.length!==3||!unit.gear_axes||unit.gear_axes.length!==4||![...unit.pos,...unit.quaternion,...unit.gear_axes,unit.speed,unit.ground_speed,unit.agl,unit.sample_time,unit.pitch_surface,unit.roll_surface,unit.yaw_surface,unit.gear,unit.flap,unit.airbrake,unit.slat].every(Number.isFinite)||!Array.isArray(unit.detached_parts)||!Array.isArray(unit.stores))throw new Error('Invalid sensed aircraft presentation');
    if(nextTick===tick&&accepted===unit)return;
    // A named public visual sample is mapped into the Aircraft renderer's
    // buffer layout. Unobserved physics, fuel, aim and pilot commands stay out
    // of the sample and can never be stepped or sent to the native authority.
    const sample=new Float32Array(80),aero=new Float32Array(48);
    sample.set(unit.pos,0);sample.set(unit.quaternion,3);sample[13]=unit.speed;sample[75]=unit.ground_speed;sample[35]=unit.agl;sample[23]=unit.sample_time;
    sample[24]=unit.pitch_surface;sample[25]=unit.roll_surface;sample[26]=unit.yaw_surface;sample[33]=unit.gear;sample[34]=unit.flap;sample[15]=.07+.14*unit.slat;sample[22]=unit.alive?0:1;
    const [x,y,z,w]=unit.quaternion;sample[18]=Math.atan2(2*(x*z+y*w),1-2*(x*x+y*y));
    aero[23]=unit.airbrake;aero.set(unit.gear_axes,36);
    plane.prev.set(accepted===null?sample:plane.cur);plane.cur.set(sample);plane.S.set(sample);plane.aero.set(aero);
    accepted=unit;tick=nextTick;state.camera=0;plane.instrumentContext=null;initialiseIntent();
    const detached=new Set(unit.detached_parts);let changed=false;
    for(const part of plane.damage.parts){const gone=detached.has(part.id);if(part.detached!==gone){part.detached=gone;changed=true;}part.hp=part.max;}
    if(changed){plane.damage._alive=null;plane.damage.detachedLog=unit.detached_parts.slice();plane.damage.revision++;plane.damageRev=-1;plane.applyDamage();}
    const storesKey=JSON.stringify(unit.stores);
    if(storesKey!==publicStoreKey){if(unit.stores.length&&!callbacks.mountPublicStores)throw Error('Public attachment renderer is unavailable');mounted=callbacks.mountPublicStores?.(plane,aircraftId,unit.stores)||null;publicStoreKey=storesKey;}
    syncFrontlineFittedMounts(plane, unit.stores);
    if(interpolation){interpolation.accept(sample,aero);interpolation.pose(0);}else plane.pose(1);projectStores();
  }
  function projectStores() {
    for (const item of mounted?.items || []) {
      const carrierGone = item.owner !== 'body' && (plane.damage.dead(item.owner) || plane.damage.gone(item.owner));
      if (item.node) item.node.visible = !item.gone && !carrierGone;
      if (item.pylonNode) item.pylonNode.visible = !carrierGone;
      if (item.rackNode) item.rackNode.visible = !carrierGone;
    }
  }
  function pose(dt = 0) {
    if (disposed || !accepted) return;
    // Detached mesh debris are cosmetic; their motion cannot register a hit or
    // change native combat state. Only the controlled local owner steps flight.
    if (plane.debris.length) plane._stepDebris(Math.max(0, Math.min(.1, dt)));
    if(localFlight)localFlight.pose();else if(interpolation)interpolation.pose(dt);else plane.pose(1);
    projectStores();
  }
  function input(elapsedSeconds) {
    const dt = Math.max(0, Math.min(.1, elapsedSeconds || 0));
    if (plane.keys.has('ShiftLeft') || plane.keys.has('ShiftRight')) plane.throttleBy(dt * .25);
    if (plane.keys.has('ControlLeft') || plane.keys.has('ControlRight')) plane.throttleBy(-dt * .25);
    const axes = plane._inputs(), manual = axes.some(v => Math.abs(v) > .02), free = plane.keys.has('KeyC');
    if (manual) state.level = false;
    if (free && manual) plane.aim = Array.from(plane.cur.slice(48, 51));
    const aim = free ? plane.aim : aqRot(plane.aimBias, plane.aim);
    const flags = (state.instructor ? 1 : 0) | (free ? 2 : 0) | (state.gear ? 4 : 0) |
      aircraftFlapSetting(state.flaps).flags | (state.brake ? 16 : 0) | (state.level ? 32 : 0);
    return { aim: aim.slice(), throttle: state.throttle, manual_pitch: axes[0],
      manual_roll: axes[1], manual_yaw: axes[2], flags };
  }
  function dispose() {
    if (disposed) return;
    disposed = true;localToken++;localPending=null;localFlight?.dispose();localFlight=null;plane.dispose();
  }
  return { plane, root: plane.root, accept, pose, input, setControlled, dispose,
    localStep:(dt,intent)=>localFlight?.step(dt,intent),localPose:seq=>localFlight?.packet(seq)||null,
    ackLocalPose:message=>localFlight?.ack(message)||false,rejectLocalPose:()=>localFlight?.reject(),
    get localReady(){return localPending||Promise.resolve();},get localFlight(){return localFlight;},
    get accepted() { return accepted; }, get stores() { return mounted; }, get tick() { return tick; } };
}

// Private telemetry uses the same source-checked geometry attachment builder as
// public presentation, but preserves the accepted owner inventories and metadata.
// It never consults or rewrites another player's local custom/preset preferences.
function mountFrontlineAcceptedStores({renderer,plane,aircraftId,stores,storeMesh,sourceStoreMesh,storeDefs}){
  if(!Array.isArray(stores))throw Error('Invalid accepted stores');
  const projected=stores.map(store=>{
    const def=storeDefs[store.id];
    if(!def||!Array.isArray(store.p)||store.p.length!==3||!store.p.every(Number.isFinite)||typeof store.owner!=='string')throw Error('Accepted store is not in the aircraft catalog');
    return {...store,mount_present:true,present:!store.gone,pylon_length:store.pylon?Math.min(1.4,def.len*.55):undefined};
  });
  const result=mountFrontlinePublicStores({renderer,plane,aircraftId,stores:projected,storeMesh,sourceStoreMesh});
  if(result.items.length!==stores.length)throw Error('Accepted store geometry count mismatch');
  result.items.forEach((item,i)=>Object.assign(item,{...stores[i],p:stores[i].p.slice(),def:storeDefs[stores[i].id]}));
  syncFrontlineFittedMounts(plane, stores);
  return result;
}

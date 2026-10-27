// Public sensor presentation only. These snapshots cannot become controls,
// ammunition, damage truth, target guidance or a local physics authority.
function createFrontlineContactPresentation(){
  let battle=null,groundCache=new Map(),airCache=new Map();
  const refKey=r=>{if(!r||![r.battle,r.unit,r.life].every(n=>Number.isSafeInteger(n)&&n>0))throw Error('Invalid sensed life identity');return `${r.battle}:${r.unit}:${r.life}`;};
  const vector=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(Number.isFinite);
  function accept({intel,units,aircrafts,battle:nextBattle}){
    if(!Number.isSafeInteger(nextBattle)||nextBattle<=0||!intel||!['blue','red'].includes(intel.team)||![units,aircrafts,intel.contacts,intel.visible_ground,intel.visible_aircrafts].every(Array.isArray))throw Error('Invalid team perception frame');
    const nextGround=battle===nextBattle?new Map(groundCache):new Map(),nextAir=battle===nextBattle?new Map(airCache):new Map();
    const seen=new Set(),contacts=new Map();
    const admitted=r=>{const key=refKey(r);if(r.battle!==nextBattle||seen.has(key))throw Error('Duplicate/foreign sensed life');seen.add(key);return key;};
    for(const u of [...units,...aircrafts]){admitted(u.unit);if(u.team!==intel.team)throw Error('Unfiltered hostile private state');}
    for(const contact of intel.contacts){const key=refKey(contact.unit);if(contact.unit.battle!==nextBattle||!['blue','red'].includes(contact.team)||contact.team===intel.team||!['ground','air'].includes(contact.kind)||!vector(contact.pos,3)||!['detected','last_known'].includes(contact.status)||!Number.isSafeInteger(contact.last_seen_tick)||contact.last_seen_tick<0||!Number.isFinite(contact.last_seen_at)||contacts.has(key))throw Error('Invalid last observation');contacts.set(key,{unit:contact.unit,team:contact.team,kind:contact.kind,pos:contact.pos,observed_alive:contact.observed_alive,last_seen_tick:contact.last_seen_tick,last_seen_at:contact.last_seen_at,status:contact.status});}
    const ground=[],air=[],currentGround=new Set(),currentAir=new Set();
    for(const [items,cache,out,current,kind]of [[intel.visible_ground,nextGround,ground,currentGround,'ground'],[intel.visible_aircrafts,nextAir,air,currentAir,'air']])for(const pose of items){
      const key=admitted(pose.unit),contact=contacts.get(key);
      if(!contact||contact.status!=='detected'||contact.kind!==kind||pose.team!==contact.team||!vector(pose.pos,3)||pose.pos.some((v,i)=>v!==contact.pos[i]))throw Error('Visual pose is not the detected sample');
      current.add(key);let cached=cache.get(key);
      if(!cached||cached.tick!==contact.last_seen_tick){
        if(kind==='ground'){
          if(typeof pose.vehicle!=='string'||![pose.yaw,pose.turret_yaw,pose.gun_pitch].every(Number.isFinite)||!pose.net||!['pos','ex','ez','v','w'].every(k=>vector(pose.net[k],3))||!vector(pose.net.track,2))throw Error('Invalid public ground pose');
          // RPM/gear are unavailable private values. Passive running-gear
          // reconstruction needs finite defaults; accepted pose/q stay exact.
          const role=pose.role||'combat',conversion=pose.campaign_conversion;
          if(!['combat','engineer','supply'].includes(role)||(role!=='combat'&&(conversion?.kind!=='campaign_support_conversion'||conversion.role!==role||conversion.chassis!==pose.vehicle||conversion.prototype!==true||conversion.mass_basis!=='registered_chassis')))throw Error('Invalid sensed support conversion');
          const campaign_conversion=role==='combat'?null:{kind:conversion.kind,role:conversion.role,chassis:conversion.chassis,prototype:true,mass_basis:conversion.mass_basis};
          const value={unit:pose.unit,vehicle:pose.vehicle,role,campaign_conversion,team:pose.team,alive:pose.alive,pos:pose.pos,yaw:pose.yaw,turret_yaw:pose.turret_yaw,gun_pitch:pose.gun_pitch,sensed:true,sampleTick:contact.last_seen_tick,company:null,controller:null,
            ammo:null,damage:null,caps:null,net:{pos:pose.net.pos,ex:pose.net.ex,ez:pose.net.ez,v:pose.net.v,w:pose.net.w,track:pose.net.track,rg:pose.net.rg,rpm:0,gear:0}};
          cached={tick:contact.last_seen_tick,value};
        }else{
          if(typeof pose.aircraft!=='string'||!vector(pose.quaternion,4)||!vector(pose.gear_axes,4)||!['speed','ground_speed','agl','sample_time','pitch_surface','roll_surface','yaw_surface','gear','flap','airbrake','slat'].every(k=>Number.isFinite(pose[k]))||!Array.isArray(pose.detached_parts)||!Array.isArray(pose.stores))throw Error('Invalid public aircraft pose');
          const [x,y,z,w]=pose.quaternion;
          const value={unit:pose.unit,aircraft:pose.aircraft,team:pose.team,alive:pose.alive,pos:pose.pos,quaternion:pose.quaternion,yaw:Math.atan2(2*(x*z+y*w),1-2*(x*x+y*y)),gear_axes:pose.gear_axes,detached_parts:pose.detached_parts,stores:pose.stores,sensed:true,sampleTick:contact.last_seen_tick,owner:null,controller:null};
          for(const k of ['speed','ground_speed','agl','sample_time','pitch_surface','roll_surface','yaw_surface','gear','flap','airbrake','slat'])value[k]=pose[k];
          // TF_AIRFRAME_LIMITS_PUBLIC_CONTACT: observable absence only, no HP/stress state.
          value.gear_failed=pose.gear_failed===true;
          cached={tick:contact.last_seen_tick,value};
        }
        cache.set(key,cached);
      }
      out.push(cached.value);
    }
    for(const key of nextGround.keys())if(!currentGround.has(key))nextGround.delete(key);
    for(const key of nextAir.keys())if(!currentAir.has(key))nextAir.delete(key);
    battle=nextBattle;groundCache=nextGround;airCache=nextAir;
    return {units:units.concat(ground),aircrafts:aircrafts.concat(air),contacts:[...contacts.values()],team:intel.team};
  }
  return {accept};
}

// Build only the externally observable store/rack meshes. A released weapon's
// former type/loadout and an empty pod's remaining feed never enter this path.
function mountFrontlinePublicStores({renderer,plane,aircraftId,stores,storeMesh,sourceStoreMesh}){
  for(const n of plane.storeNodes||[])plane.root.children=plane.root.children.filter(c=>c!==n);
  for(const mesh of plane.pylonMeshes||[]){renderer.freeMesh(mesh);plane.meshes=plane.meshes.filter(m=>m!==mesh);}
  plane.storeNodes=[];plane.pylonMeshes=[];
  const native=plane.type.geometry().imported,items=[],mounts=new Map();
  function sourcePiece(descriptor,kind){
    if(!descriptor)return null;
    const piece=native?.[kind]?.find(p=>p.id===descriptor.id);
    if(!piece||JSON.stringify(piece.sourceParts)!==JSON.stringify(descriptor.sourceParts))throw Error('Sensed source attachment is not in the model catalog');
    return piece;
  }
  for(const store of stores){
    if(!store.mount_present)continue;
    const item={id:store.id,owner:store.owner,gone:!store.present,weaponInstance:store.weapon_instance};
    if(store.present){
      const source=sourcePiece(store.sourceStore,'sourceStores'),node=plane.root.add(new Node('sensed_aircraft_store'));
      node.mesh=source?sourceStoreMesh(aircraftId,source):storeMesh(store.id);node.kind=3;node.local=quatMatrix(store.p,TFModelHardpoints.storeRotation(store,plane.type));
      item.node=node;plane.storeNodes.push(node);
    }
    const source=sourcePiece(store.sourceMount,'sourceMounts');
    if(source){let node=mounts.get('source:'+source.id);if(!node){node=plane.root.add(new Node('sensed_source_mount'));node.mesh=sourceStoreMesh(aircraftId,source);node.kind=3;node.local=quatMatrix(source.p,[0,0,0,1]);mounts.set('source:'+source.id,node);plane.storeNodes.push(node);}item.rackNode=node;}
    if(store.rack){const key='rack:'+store.rack.id+':'+store.rack.origin.join(',');let node=mounts.get(key);if(!node){node=plane.root.add(new Node('sensed_rack'));node.mesh=storeMesh('rack:'+store.rack.id);node.kind=3;node.local=quatMatrix(store.rack.origin,[0,0,0,1]);mounts.set(key,node);plane.storeNodes.push(node);}item.rackNode=node;}
    if(store.pylon){
      if(!(store.pylon_length>0)||!Number.isFinite(store.pylon_length))throw Error('Missing actual sensed pylon geometry');
      const key='pylon:'+JSON.stringify([store.pylon,store.pylon_length]);let node=mounts.get(key);
      if(!node){node=plane.root.add(new Node('sensed_pylon'));const mesh=renderer.mesh(aircraftGeometry.pylon(...store.pylon,store.pylon_length,plane.type.fighter?.spec.colors.base||'#9aa2a5'));node.mesh=mesh;node.kind=3;plane.meshes.push(mesh);plane.pylonMeshes.push(mesh);plane.storeNodes.push(node);mounts.set(key,node);}item.pylonNode=node;
    }
    items.push(item);
  }
  return {items};
}

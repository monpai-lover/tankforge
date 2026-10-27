// Offline QA scene setup/read-only observations. Physics uses the real WASM212
// and original update/pose/render; no accepted state arrays are fabricated.
(() => {
  const tf=window.__tf,x=window.__tfx,G=tf.G;
  const q=window.__publicQa={gearHistory:[],lastCamera:null,sceneChanges:[]};
  const originalRender=tf.renderer.render.bind(tf.renderer);
  tf.renderer.render=(nodes,camera,...rest)=>{
    q.lastCamera={pos:camera.pos.slice(),forward:camera.forward.slice(),viewProj:Array.from(camera.viewProj)};
    return originalRender(nodes,camera,...rest);
  };
  q.ready=async()=>{
    await tf.coreReady();const api=await x.flightCoreP;tf.pause(true);tf.setQuality('low');
    G.airHelp=false;G.airAssist=false;G.airBotsOn=false;G.padBots=true;
    return {core:api.core_version(),stateLength:api.state_len(),nativeModels:Object.keys(x.data.aircraftModels),
      vehicles:Object.keys(x.data.vehicles),actualFlightWasm:true,
      fixture:'Offline native scenes. Only garage thumbnails skipped; fixed-step QA advances call actual update/WASM/pose.'};
  };
  q.live=()=>tf.pause(false);
  q.pause=()=>tf.pause(true);
  q.draw=()=>{tf.advance(1/60,[],true);return q.probe();};
  q.probe=()=>{
    const pad=G.pad,p=G.air?.active&&G.air.plane,gl=tf.renderer.gl;
    return {mode:G.mode,id:G.id,online:!!G.online,brake:G.keys.has('brake'),time:G.time,
      pad:pad?{radar:!!pad.cfg.radar,mode:pad.radarMode||'search',contacts:pad.contacts.length,
        lock:pad.lock?.plane.type.id||null,radarTrack:!!pad.u.track?.radar,scanAt:pad.radarScanAt,
        hp:pad.u.radarHp,info:document.querySelector('.pad-info')?.innerText,scopeVisible:!document.querySelector('.pad-scope')?.hidden}:null,
      plane:p?{type:p.type.id,imported:!!p.imported,core:p.api.core_version(),state:Array.from(p.cur),aero:Array.from(p.aero),
        camera:p.state.camera,eye:p.cockpitEye?.slice(),sourceEye:p.type.model?.spec.eye,sightEye:p.type.model?.spec.sight?.eye,
        sightGlass:p.sightGlass?.length,clearLowerY:p.type.model?.spec.opticsCalibration?.clearLowerY,
        uploaded:p.meshes.filter(m=>gl.isBuffer(m.buf)).length,meshes:p.meshes.length,vertices:p.meshes.reduce((n,m)=>n+m.count,0),
        nativeParts:p.type.model?.parts.length,nativeMovers:p.type.model?.movers.length,
        controls:p.controls.filter(c=>c.param==='gear'||c.type==='gear').map(c=>({name:c.name,param:c.param,type:c.type,visible:c.node.visible,
          local:Array.from(c.node.local),world:Array.from(c.node.world)})),
        aimHidden:document.querySelector('.air-aim')?.hidden,noseHidden:document.querySelector('.air-nose')?.hidden,
        modernHud:!!x.AIR_EQUIP[p.type.id]?.hud,actualCamera:q.lastCamera}:null};
  };
  q.ground=async id=>{
    if(G.air?.active)x.exitAircraft(true);tf.toGarage();tf.select(id);tf.setMapChoice('range');tf.startBattle();tf.pause(true);
    G.padBots=true;x.airBots.next=G.time+100000;tf.advance(.1,[],false);x.clearBots();x.airBots.next=G.time+100000;
    // One real spawnBot/isolated WASM, held in an explicit offline test location.
    await x.spawnBot();x.airBots.next=G.time+100000;
    const b=x.airBots.list[0];if(!b)throw Error('Actual aircraft target did not spawn');
    const head=x.adHead(G.pad.pe);b.plane.spawn(head[0],head[1]+700,head[2]+5000,0,160,false);
    G.cam.yaw=0;G.cam.pitch=Math.atan2(700,5000);tf.advance(.12,[],true);
    q.sceneChanges.push({kind:'offline ground scene + native enemy spawn',id,target:b.plane.type.id});
    return q.probe();
  };
  q.scan=()=>{tf.advance(.5,[],true);return q.probe();};
  q.prepareAir=()=>{x.clearBots();G.airBotsOn=false;G.padBots=false;tf.pause(true);};
  q.airPosition=()=>{
    const p=G.air.plane;p.spawn(-8000,3000,-8000,0,160,false);G.airInputFocused=true;tf.advance(.1,[],false);
    q.sceneChanges.push({kind:'offline native air spawn for repeatable visual test',type:p.type.id,position:[-8000,3000,-8000]});
    return q.probe();
  };
  q.gearCamera=()=>{
    const p=G.air.plane;q.originalCamera=p.camera.bind(p);q.cameraPlane=p;
    p.camera=()=>{const centre=p.drawPos||p.position,offset=[10,-3.5,10],length=Math.hypot(...offset);
      return {camPos:centre.map((v,i)=>v+offset[i]),fwd:offset.map(v=>-v/length),fovY:.85};};
    q.sceneChanges.push({kind:'visual underside camera only; flight state unchanged',offset:[10,-3.5,10]});
  };
  q.advanceGear=(target,half=false)=>{
    const p=G.air.plane,states=[];
    for(let i=0;i<50;i++){
      tf.advance(1/12,[],false);const s=q.probe();states.push(s.plane);
      const v=p.cur[33];if(half?target===0?v<=.5:v>=.5:Math.abs(v-target)<.005)break;
    }
    tf.advance(1/60,[],true);q.gearHistory.push(...states);
    return {samples:states.map(p=>({gear:p.state[33],nativeTime:p.state[23],controls:p.controls})),end:q.probe()};
  };
  q.cockpit=async()=>{
    const p=G.air.plane;if(q.originalCamera&&q.cameraPlane===p)p.camera=q.originalCamera;
    q.originalCamera=null;q.cameraPlane=null;
    p._cockpitDetail(true);await p.cockpitHi?.loading;tf.advance(.12,[],true);
    q.designEye=p.cockpitEye.slice();return q.opticsProbe();
  };
  q.opticsProbe=()=>{
    const p=G.air.plane,c=q.lastCamera,cv=x.airEl.ov,aperture=x.aircraftSightAperture(p.sightGlass,p.type.model?.spec.opticsCalibration?.clearLowerY);
    let image=null;
    if(cv){const data=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let n=0,minX=cv.width,minY=cv.height,maxX=-1,maxY=-1;
      for(let i=0;i<data.length;i+=4)if(data[i+3]>20){const at=i/4,xx=at%cv.width,yy=Math.floor(at/cv.width);n++;minX=Math.min(minX,xx);minY=Math.min(minY,yy);maxX=Math.max(maxX,xx);maxY=Math.max(maxY,yy);}
      image={width:cv.width,height:cv.height,alphaPixels:n,bounds:[minX,minY,maxX,maxY]};}
    return {probe:q.probe(),apertureProjected:c?aperture.map(pt=>x.project(c.viewProj,p.worldPoint(pt))):null,
      actualEyeLocal:G.camPos?p.localPoint(G.camPos):null,overlay:image};
  };
  q.shiftEye=offset=>{const p=G.air.plane;p.cockpitEye=q.designEye.map((v,i)=>v+offset[i]);
    q.sceneChanges.push({kind:'visual head translation only; design sight eye and native flight unchanged',offset});
    tf.advance(1/60,[],true);return q.opticsProbe();};
  q.cleanup=()=>{tf.pause(true);x.clearBots();if(G.air?.active)x.exitAircraft(true);tf.toGarage();return {online:!!G.online,mode:G.mode};};
})();

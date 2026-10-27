  // Collimated sight rendering: geometry/deflection inputs stay owned by the aircraft.
  // Rounded pupil falloff and display brightness below are presentation estimates,
  // not a new equipment capability or a measured historical optical prescription.
  function aircraftCollimatedOptics(plane, cameraWorld, projectPoint, aperture, environment = {}) {
    const finite3 = a => (Array.isArray(a)||ArrayBuffer.isView(a)) && a.length === 3 && a.every(Number.isFinite);
    const unit = a => { const length=Math.hypot(...a); return length>1e-9&&Number.isFinite(length)?Array.from(a,v=>v/length):null; };
    const cross3 = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const smooth = (a,b,x) => { const t=Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };
    const prescription=plane.type.model?.spec?.sight,design=prescription?.eye||plane.cockpitEye||plane.type.eye;
    const designWorld=finite3(design)?plane.worldPoint(design):null;
    const actualWorld=finite3(cameraWorld)?Array.from(cameraWorld):designWorld;
    const actual=finite3(actualWorld)?plane.localPoint(actualWorld):null;
    const declaredBox=prescription?.eyeBox,defaults=[.13,.10,.40];
    const box=defaults.map((v,i)=>Number.isFinite(declaredBox?.[i])&&declaredBox[i]>.001?declaredBox[i]:v);
    let transmission=0;
    if(finite3(design)&&finite3(actual)){
      // A rounded exit pupil avoids the old rectangular max-axis brightness step.
      // The longitudinal window is separate: moving back also narrows the real pane's angular FOV.
      const d=actual.map((v,i)=>Math.abs(v-design[i])/box[i]);
      const lateral=Math.pow(d[0]**4+d[1]**4,.25);
      transmission=(1-smooth(.62,1.12,lateral))*(1-smooth(.55,1.15,d[2]));
    }
    const pane=Array.isArray(aperture)&&aperture.length>=3&&aperture.every(p=>p.length===2&&p.every(Number.isFinite))?aperture:null;
    const direction = vector => {
      const d=finite3(vector)&&unit(vector);
      if(!d||!finite3(actualWorld))return null;
      return projectPoint(actualWorld.map((v,i)=>v+d[i]*1e6));
    };
    const point = world => finite3(world)&&finite3(designWorld)?direction(world.map((v,i)=>v-designWorld[i])):null;
    const ring = (vector,halfAngle) => {
      const d=finite3(vector)&&unit(vector);
      if(!d||!Number.isFinite(halfAngle)||halfAngle<=0||halfAngle>=Math.PI/2)return null;
      const up=Math.abs(d[1])<.95?[0,1,0]:[1,0,0],side=unit(cross3(d,up));
      const center=direction(d),edge=direction(d.map((v,i)=>v*Math.cos(halfAngle)+side[i]*Math.sin(halfAngle)));
      return center&&edge?[center[0],center[1],Math.hypot(center[0]-edge[0],center[1]-edge[1])]:null;
    };
    const ringPoint=(world,halfAngle)=>finite3(world)&&finite3(designWorld)?ring(world.map((v,i)=>v-designWorld[i]),halfAngle):null;
    const daylight=smooth(-4,35,Number.isFinite(environment.elev)?environment.elev:27);
    return {pane,transmission,direction,point,ring,ringPoint,
      coreAlpha:.62+.34*daylight,haloAlpha:.055+.075*daylight,
      haloBlur:1.5+1.0*daylight,daylight};
  }
  function drawAircraftCollimatedSight(context,optics,colour,paint,pixelRatio=1){
    if(!optics.pane||!(optics.transmission>1e-4))return false;
    const g=context,base=Number.isFinite(g.globalAlpha)?g.globalAlpha:1;
    g.save();
    try{
      g.beginPath();g.moveTo(...optics.pane[0]);
      for(const p of optics.pane.slice(1))g.lineTo(...p);
      g.closePath();g.clip();
      // Small local bloom; the coloured core remains sharp in bright, tone-mapped skies.
      g.globalCompositeOperation='lighter';g.shadowColor=colour;
      g.globalAlpha=base*optics.transmission*optics.haloAlpha;
      g.shadowBlur=optics.haloBlur*Math.max(1,pixelRatio||1);paint();
      g.globalCompositeOperation='source-over';g.shadowBlur=0;
      g.globalAlpha=base*optics.transmission*optics.coreAlpha;paint();
    }finally{g.restore();}
    return true;
  }

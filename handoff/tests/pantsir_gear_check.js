// The Pantsir's running gear in numbers: each wheel node's position against the centre of the imported
// mesh it carries (they must agree, or the wheel turns off-centre), the track loop's lowest and highest
// pins against the wheels and the ground, after driving 5 s.
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
await tf.coreReady();tf.finishThumbs();
tf.select(window.__VEH||'ru_pantsir_sm_sv');
tf.startBattle();tf.pause(true);tf.advance(1,[],false);tf.advance(5,['fwd'],false);
const M=G.model,imp=G.loadout.imported;
out.wheels=M.wheels.filter(w=>w.side===-1).map(w=>{const n=w.node,c=n.children.find(c=>c.mesh);let lo=null,hi=null;
  const src=c?.mesh?._src;const v=src?.data||src?.positions||null;
  return {role:w.role,pos:n.pos.map(v=>+v.toFixed(3)),r:w.r,child:!!c,meshKeys:c?.mesh?Object.keys(c.mesh).slice(0,12):null};});
const pins=M.fixedPinSource[-1].pins;let ylo=1e9,yhi=-1e9,zlo=1e9,zhi=-1e9;for(let i=0;i<pins.length/3;i++){ylo=Math.min(ylo,pins[i*3+1]);yhi=Math.max(yhi,pins[i*3+1]);zlo=Math.min(zlo,pins[i*3+2]);zhi=Math.max(zhi,pins[i*3+2]);}
out.trackPins={ylo:+ylo.toFixed(3),yhi:+yhi.toFixed(3),zlo:+zlo.toFixed(3),zhi:+zhi.toFixed(3),count:M.linkCount,pitch:+M.linkPitch.toFixed(3)};
out.rg=M.runningGear?{sprocket:M.runningGear.sprocket,idler:M.runningGear.idler}:null;
out.body={y:G.ss.y,pitch:G.ss.pitch};out.groundAtHull=tf.terrain?.heightAt?.(G.s.x,G.s.z);
out.impParts=imp.parts.filter(p=>/road_wheel|sprocket|idler/.test(p.mount)).map(p=>[p.source_node||p.part_id,p.mount,p.side,p.index,p.lo&&p.lo.map(v=>+v.toFixed(3)),p.hi&&p.hi.map(v=>+v.toFixed(3))]).filter(r=>r[2]===-1);
out.hullParts=imp.parts.filter(p=>p.mount==='hull').map(p=>p.source_node);
return out;

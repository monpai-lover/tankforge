// Close garage views of the Pantsir's running gear (side, low), and whether each imported wheel mesh is
// centred on the node it turns about (its bounds' centre in the node frame, y and z, metres).
const tf=window.__tf,x=window.__tfx,G=tf.G,out={};
const frames=(n)=>new Promise(r=>{let k=0;const f=()=>(++k>=n?r():requestAnimationFrame(f));requestAnimationFrame(f);});
await tf.coreReady();tf.finishThumbs();
tf.select(window.__VEH||'ru_pantsir_sm_sv');await frames(3);
const hid=[];const walk=(el)=>{for(const e of el.children){if(e.tagName==='CANVAS')continue;if(e.querySelector('canvas'))walk(e);else if(getComputedStyle(e).visibility!=='hidden')hid.push(e);}};walk(document.body);hid.forEach(e=>e.style.visibility='hidden');document.querySelectorAll('.cards,.card-bar,#cards,[class*=card]').forEach(e=>{e.style.visibility='hidden';hid.push(e);});
for(const [name,yaw,pitch,zoom] of (window.__VIEWS||[['side',Math.PI/2,-0.05,1.0],['quarter',Math.PI/2+0.6,-0.12,1.0],['rear_q',-Math.PI/2-0.5,-0.1,0.9]])){
  G.cam.yaw=G.s.heading+yaw;G.cam.pitch=pitch;G.gzoom=zoom;for(let i=0;i<30;i++){G.cam.yaw=G.s.heading+yaw;G.cam.pitch=pitch;tf.advance(1/60,[],i===29);}await frames(1);
  await pyShot(name);
}
hid.forEach(e=>e.style.visibility='');
// wheel nodes: the imported mesh's centre relative to the node it spins about
const res=[];
const visit=(n,d=0)=>{if(/road_wheel|sprocket|idler/.test(n.name)&&n.children)for(const c of n.children){const m=c.mesh;const src=m?._src;if(src?.lo||m?.lo){const lo=m.lo||src.lo,hi=m.hi||src.hi;res.push([n.name,+((lo[1]+hi[1])/2).toFixed(3),+((lo[2]+hi[2])/2).toFixed(3)]);}}(n.children||[]).forEach(c=>visit(c,d+1));};
visit(G.model.root||G.model.node||{children:[]});
out.wheels=res.slice(0,20);out.keys=Object.keys(G.model).slice(0,40);
return out;

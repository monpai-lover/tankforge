import {buildTank} from 'tf:client/web/src/gfx/tankmodel.js';
import {m4,mul,lookAt,perspective,transformPoint,sub,add,scale,norm,cross} from 'tf:client/web/src/gfx/math.js';
const $=s=>document.querySelector(s),canvas=$('#view'),gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});
if(!gl)throw new Error('需要 WebGL 2 瀏覽器');
const vs=`#version 300 es
precision highp float;
layout(location=0) in vec3 pos;layout(location=1) in vec3 normal;layout(location=2) in vec3 color;
layout(location=3) in mat4 im;
uniform mat4 model, vp;uniform int instanced;out vec3 n;out vec3 col;
void main(){mat4 m=model;if(instanced==1)m=model*im;gl_Position=vp*m*vec4(pos,1);n=mat3(transpose(inverse(m)))*normal;col=color;}`;
const fs=`#version 300 es
precision highp float;in vec3 n;in vec3 col;uniform int mode;out vec4 frag;
void main(){
 if(mode==2){float v=floor(gl_FragCoord.z*16777215.0+.5);frag=vec4(floor(v/65536.0),mod(floor(v/256.0),256.0),mod(v,256.0),255)/255.0;return;}
 if(mode==1){frag=vec4(.28,.83,.78,1);return;}if(mode==3){frag=vec4(1,.35,.15,1);return;}
 vec3 nn=normalize(n);if(!gl_FrontFacing)nn=-nn;
 float l=.45+.55*max(dot(nn,normalize(vec3(-.4,1,.7))),0.0);frag=vec4(pow(col*l,vec3(1.0/2.2)),1);
}`;
function shader(t,s){const h=gl.createShader(t);gl.shaderSource(h,s);gl.compileShader(h);if(!gl.getShaderParameter(h,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(h));return h;}
const pr=gl.createProgram();gl.attachShader(pr,shader(gl.VERTEX_SHADER,vs));gl.attachShader(pr,shader(gl.FRAGMENT_SHADER,fs));gl.linkProgram(pr);if(!gl.getProgramParameter(pr,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(pr));
const u=Object.fromEntries(['model','vp','instanced','mode'].map(k=>[k,gl.getUniformLocation(pr,k)]));
function buffer(data){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);return b;}
const renderer={
 mesh(data){return {data:Float32Array.from(data),buffer:buffer(Float32Array.from(data)),count:data.length/13};},
 instancedMesh(data,maxInstances){const m=this.mesh(data);m.instanced=true;m.maxInstances=maxInstances;m.instances=0;m.ib=gl.createBuffer();return m;},
 setInstances(m,data,n){m.instances=Math.min(n,m.maxInstances);m.matrices=Float32Array.from(data.subarray(0,m.instances*16));gl.bindBuffer(gl.ARRAY_BUFFER,m.ib);gl.bufferData(gl.ARRAY_BUFFER,m.matrices,gl.DYNAMIC_DRAW);},
 freeMesh(m){gl.deleteBuffer(m.buffer);if(m.ib)gl.deleteBuffer(m.ib);if(m.lines)gl.deleteBuffer(m.lines);},
};
const loadout=window.REVIEW_LOADOUT,model=buildTank(renderer,loadout,()=>[]),hb=model.hitbox;
const armor=window.REVIEW_ARMOR;let yaw=.92,pitch=.28,dist=15.7,center=[0,1.1,1.1],eye,forward,right,up,vp;
let lastHit=null,lastFrame=null,lastRay=null,hitMesh=null,lineMesh=null;
const identity=m4();let wire=false;
function resize(){const r=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d);draw();}
function camera(){const fitDist=dist*Math.max(1,1.1/(canvas.width/canvas.height));eye=add(center,[Math.sin(yaw)*Math.cos(pitch)*fitDist,Math.sin(pitch)*fitDist,Math.cos(yaw)*Math.cos(pitch)*fitDist]);forward=norm(sub(center,eye));right=norm(cross(forward,[0,1,0]));up=cross(right,forward);vp=mul(perspective(.66,canvas.width/canvas.height,.05,200),lookAt(eye,center));}
function attrs(m,lines=false){
 gl.bindBuffer(gl.ARRAY_BUFFER,lines?m.lines:m.buffer);for(const [slot,offset]of [[0,0],[1,12],[2,24]]){gl.enableVertexAttribArray(slot);gl.vertexAttribPointer(slot,3,gl.FLOAT,false,52,offset);gl.vertexAttribDivisor(slot,0);}
 gl.uniform1i(u.instanced,m.instanced?1:0);
 if(m.instanced){gl.bindBuffer(gl.ARRAY_BUFFER,m.ib);for(let i=0;i<4;i++){gl.enableVertexAttribArray(3+i);gl.vertexAttribPointer(3+i,4,gl.FLOAT,false,64,i*16);gl.vertexAttribDivisor(3+i,1);}}
 else for(let i=0;i<4;i++){gl.disableVertexAttribArray(3+i);gl.vertexAttribDivisor(3+i,0);}
}
function drawMesh(mesh,matrix,mode=0,lines=false){
 if(!mesh.count)return;
 if(lines&&!mesh.lines){const d=[];for(let i=0;i<mesh.data.length;i+=39)for(const v of [0,1,1,2,2,0])for(let k=0;k<13;k++)d.push(mesh.data[i+v*13+k]);mesh.lines=buffer(Float32Array.from(d));}
 attrs(mesh,lines);gl.uniform1i(u.mode,mode);gl.uniformMatrix4fv(u.model,false,matrix);
 if(mesh.instanced)gl.drawArraysInstanced(lines?gl.LINES:gl.TRIANGLES,0,mesh.count*(lines?2:1),mesh.instances);else gl.drawArrays(lines?gl.LINES:gl.TRIANGLES,0,mesh.count*(lines?2:1));
}
function draw(mask=false){
 camera();model.root.update();gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.043,.059,.063,mask?0:1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(pr);gl.uniformMatrix4fv(u.vp,false,vp);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.depthFunc(gl.LESS);
 const nodes=model.root.collect([]);if(wire&&!mask){gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(1,1);}
 for(const n of nodes)drawMesh(n.mesh,n.world,mask?2:0);
 gl.disable(gl.POLYGON_OFFSET_FILL);
 if(wire&&!mask){gl.depthFunc(gl.LEQUAL);for(const n of nodes)drawMesh(n.mesh,n.world,1,true);}
 if(!mask&&(hitMesh||lineMesh)){
  gl.disable(gl.DEPTH_TEST);if(hitMesh)drawMesh(hitMesh,identity,3);
  if(lineMesh){attrs(lineMesh);gl.uniform1i(u.mode,3);gl.uniformMatrix4fv(u.model,false,identity);gl.drawArrays(gl.LINES,0,lineMesh.count);}gl.enable(gl.DEPTH_TEST);
 }
}
function pose(){
 const d=Math.PI/180;model.turrets[0].node.yaw=+$('#turret').value*d;model.turrets[0].guns[0].node.pitch=-$('#elev').value*d;model.turrets[0].guns[0].barrel.pos[2]=-.31*$('#recoil').value;
 for(const mg of model.mgs){mg.node.yaw=+$('#mg').value*d;mg.node.pitch=-$('#mge').value*d;}
 const zero=model.stations.map(()=>0),travel=+$('#track').value;
 model.updateRunningGear({lifts:{1:zero,[-1]:zero},travel:{1:travel,[-1]:travel}});model.root.update();
 for(const id of ['turret','elev','mg','mge'])$(`#${id}v`).textContent=$(`#${id}`).value+'°';$('#recoilv').textContent=(+$('#recoil').value*.31).toFixed(2)+' m';$('#trackv').textContent=travel+' m';
 clearShot();draw();
}
function plainMesh(points){const data=[];for(const p of points)data.push(...p,0,1,0,1,.1,.01,.8,.1,0,0);return renderer.mesh(Float32Array.from(data));}
function clearShot(){if(hitMesh)renderer.freeMesh(hitMesh);if(lineMesh)renderer.freeMesh(lineMesh);hitMesh=lineMesh=null;lastHit=null;lastFrame=null;lastRay=null;}
function ray(x,y){const px=(x/canvas.width*2-1)*Math.tan(.33)*canvas.width/canvas.height,py=(y/canvas.height*2-1)*Math.tan(.33);return norm(add(forward,add(scale(right,px),scale(up,py))));}
function fire(a,b){
 clearShot();const frame=hb.frame(),radius=+$('#radius').value,begin=performance.now(),result=hb.querySegment(a,b,{radiusM:radius,all:true,frame});
 lastFrame=frame;lastHit=result.hit;lastRay=[a,b];const h=result.hit;
 if(h){const entry=frame.entries.find(e=>e.id===h.entryId),triangle=entry.rec.bvh.triangle(h.triangleId).map(v=>transformPoint(entry.matrix,v));hitMesh=plainMesh(triangle);lineMesh=plainMesh([a,h.center,h.point,add(h.point,scale(h.normal,.28))]);}
 else lineMesh=plainMesh([a,b]);
 const def=h&&armor.find(p=>p.id===h.armorRef);
 $('#outcome').textContent=h?'命中真實三角面':'穿過空隙 · 未命中';$('#outcome').className=h?'hit':'miss';
 $('#contact').textContent=h?`${h.partId}\n${h.role} · triangle ${h.partTriangleId}\n接觸點 ${h.point.map(v=>v.toFixed(4)).join(', ')} m\n${def?`沿用裝甲標籤 ${def.id}（${def.thickness_mm} mm）`:'附件／模組表面，未賦予主裝甲抗性'}\n${h.moduleRef?'模組 '+h.moduleRef:''}`:'此段路徑沒有碰到模型表面。\n包圍盒相交不會算命中。';
 $('#stats').textContent=`${result.stats.trianglesTested} 個候選三角形 / ${(performance.now()-begin).toFixed(2)} ms · ${result.hits.length} 個接觸面`;
 draw();return result;
}
$('#fire').onclick=()=>fire(eye,add(eye,scale(forward,60)));
$('#bore').onclick=()=>{for(const id of ['turret','elev','recoil'])$('#'+id).value=0;pose();center=[0,1.86,5.8];yaw=0;pitch=.015;dist=2.2;draw();fire([0,1.86,6.4],[0,1.86,5.85]);};
$('#gap').onclick=()=>{for(const id of ['turret','elev','recoil'])$('#'+id).value=0;pose();center=[1.32,.46,1.61];yaw=Math.PI/2;pitch=.03;dist=3.2;draw();fire([3,.46,1.61],[1.18,.46,1.61]);};
$('#home').onclick=()=>{yaw=.92;pitch=.28;dist=15.7;center=[0,1.1,1.1];clearShot();draw();};
$('#wire').onchange=e=>{wire=e.target.checked;draw();};
for(const id of ['turret','elev','recoil','mg','mge','track'])$('#'+id).oninput=pose;
let drag=null;canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,oldX:e.clientX,oldY:e.clientY,moved:0};};
canvas.onpointermove=e=>{if(!drag)return;const dx=e.clientX-drag.oldX,dy=e.clientY-drag.oldY;drag.moved+=Math.hypot(dx,dy);drag.oldX=e.clientX;drag.oldY=e.clientY;yaw-=dx*.008;pitch=Math.max(-1.35,Math.min(1.35,pitch+dy*.006));draw();};
canvas.onpointerup=e=>{if(drag&&drag.moved<4){const r=canvas.getBoundingClientRect(),d=ray((e.clientX-r.left)*canvas.width/r.width,(r.bottom-e.clientY)*canvas.height/r.height);fire(eye,add(eye,scale(d,60)));}drag=null;};
canvas.onwheel=e=>{e.preventDefault();dist=Math.max(.5,Math.min(40,dist*Math.exp(e.deltaY*.001)));draw();};
window.addEventListener('resize',resize);
/** Independent GPU depth/coverage comparison. Mask uses the exact visible draw buffers;
 * CPU uses the hitbox BVHs. Sample pixel centres, no edge samples discarded. */
function verifyRaster(nx=24,ny=16){
 draw(true);const pix=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pix);
 const frame=hb.frame(),mismatch=[],depthErrors=[];let hits=0,maxDepthError=0;
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const px=Math.floor((x+.5)/nx*canvas.width),py=Math.floor((y+.5)/ny*canvas.height),o=(py*canvas.width+px)*4;
  const dir=ray(px+.5,py+.5),h=hb.querySegment(eye,add(eye,scale(dir,200)),{frame}).hit,gpu=pix[o+3]>0;
  if(!!h!==gpu){mismatch.push({px,py,gpu,cpu:!!h});continue;}if(!h)continue;hits++;
  const p=h.point,z=vp[2]*p[0]+vp[6]*p[1]+vp[10]*p[2]+vp[14],w=vp[3]*p[0]+vp[7]*p[1]+vp[11]*p[2]+vp[15];
  const depth=(z/w+1)/2,gpuDepth=(pix[o]*65536+pix[o+1]*256+pix[o+2])/16777215,error=Math.abs(depth-gpuDepth);maxDepthError=Math.max(maxDepthError,error);
  if(error>3e-6)depthErrors.push({px,py,error,part:h.partId});
 }
 draw();return {samples:nx*ny,hits,coverageMismatches:mismatch,depthMismatches:depthErrors,maxDepthError,source:'actual WebGL2 colour-encoded depth vs CPU triangle query; no edge samples excluded'};
}
window.__realHitReview={model,hitbox:hb,fire,verifyRaster,draw,pose,view:(y,p,d,c)=>{yaw=y;pitch=p;dist=d;center=c;clearShot();draw();},last:()=>({hit:lastHit,ray:lastRay}),data:loadout};
pose();resize();$('#loading').hidden=true;$('#meshinfo').textContent=`${model.triangles.toLocaleString()} 個唯一幾何三角形 · ${hb.frame().entries.length} 個姿態實例`;

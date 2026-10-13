// V3 trace/shard/field adaptation, Copyright (c) 2026 Replay Lab Contributors (MIT).
import * as S from './replayShaders.js';
import {poseProjectile} from '../game/projectileFlight.js';
const NO=[0,0,0,0];
const damageColor=dead=>dead?[.87,.012,.018,.78]:[.96,.39,.005,.6];
export class ReplayDraw{
  constructor(renderer,target,projectiles){this.renderer=renderer;this.target=target;this.projectiles=projectiles;this.bodyLeases=new Map();this.instances=new Float32Array(4096*12);this.nodes=[];this.prepared=null;}
  prepare(frame){
    if(this.prepared?.frameId===frame.id)return this.prepared;
    if(frame.event?.evidence.authority!=='analysis')this.target.applyAcceptedPose?.(frame.acceptedPose,frame.poseVersion);
    const inner=this.target.interior?.();if(inner){for(const n of inner.nodes)n.visible=true;inner.updateLaunchers?.();}
    this.nodes.length=0;this.target.model.root.collect(this.nodes);
    for(const n of this.nodes){const role=n.replayRole||'retained';n.kind=role==='armor'?10:role==='crew'?13:role==='furnishing'?15:14;n.highlight=NO;}
    for(const event of frame.records||[frame.event].filter(Boolean)){
      const report=event.evidence.report;if(frame.physicalS<event.contact_s)continue;
      const arrived=id=>{const timed=(event.traces||frame.traces).filter(t=>t.hit===id);return !timed.length||timed.some(t=>t.arrived||t.end_s<=frame.physicalS);};
      for(const m of report.modules||[]){if(!arrived(m.id))continue;const health=frame.state?.modules?.[m.index]??m.health;if(health>=m.max_health)continue;for(const n of inner?.byModule.get(m.id)||[])n.highlight=damageColor(health<=0);}
      for(const c of report.crew||[]){if(!arrived(`crew:${c.index}`))continue;const health=frame.state?.crew?.[c.index]??c.health;if(health>=100)continue;const n=inner?.byCrew[c.index];if(n)n.highlight=damageColor(c.killed||health<=0);}
    }
    const present=new Set();for(const p of frame.projectiles){if(!this.projectiles||!p.profile)continue;present.add(p.eventId);let h=this.bodyLeases.get(p.eventId);
      if(!h||h.node.projectileProfile!==p.profile||h.lease.stage.kind!==p.stage){const next=this.projectiles.acquire(p.profile,p.stage,'replay_projectile');h?.release();h=next;this.bodyLeases.set(p.eventId,h);}
      const scale=Math.max(1,Math.min(8,.04/Math.max(.001,p.profile.diameterM||.04)));poseProjectile(h.node,p.nose,p.tangent,p.profile,scale,scale);this.nodes.push(h.node);}
    for(const[id,h]of this.bodyLeases)if(!present.has(id)){h.release();this.bodyLeases.delete(id);}
    let count=0,dynamicCount=0;for(const list of [frame.traces,frame.staticTraces]){for(const t of list){if(count>=4096)break;const a=t.tail||t.from,b=t.head||t.to,c=t.color||[.35,.65,.72],i=count++*12;
      for(let k=0;k<3;k++){this.instances[i+k]=a[k];this.instances[i+3+k]=b[k];this.instances[i+6+k]=c[k];}this.instances[i+9]=t.alpha??.22;this.instances[i+10]=t.width??.62;this.instances[i+11]=t.kind??0;}
      if(list===frame.traces)dynamicCount=count;}
    this.prepared={frameId:frame.id,nodes:this.nodes,instances:this.instances,count,dynamicCount,physicalS:frame.physicalS};return this.prepared;
  }
  dispose(){for(const h of this.bodyLeases.values())h.release();this.bodyLeases.clear();this.nodes.length=0;this.prepared=null;}
}
export class ReplayGpu{
  constructor(gl,program){
    this.gl=gl;this.resources=[];this.programs=[];this.last=null;this.disposed=false;this.viewOrder=[];this.viewInstances=new Float32Array(4096*12);this.dynamicInstances=new Float32Array(4096*12);this.depths=new Float64Array(4096);this.viewLast=null;this.viewForward=[0,0,0];
    const create=(kind,fn)=>{const h=fn();if(!h)throw Error('replay GPU allocation failed');this.resources.push([kind,h]);return h;};
    try{
      this.trace=program(S.TRACEVS,S.TRACEFS);this.programs.push(this.trace);this.shard=program(S.SHARDVS,S.SHARDFS);this.programs.push(this.shard);this.field=program(S.FIELDVS,S.FIELDFS);this.programs.push(this.field);
      this.traceVao=create('vao',()=>gl.createVertexArray());this.buffer=create('buffer',()=>gl.createBuffer());gl.bindVertexArray(this.traceVao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferData(gl.ARRAY_BUFFER,4096*12*4,gl.DYNAMIC_DRAW);this.attributes();
      this.dynamicBuffer=create('buffer',()=>gl.createBuffer());gl.bindBuffer(gl.ARRAY_BUFFER,this.dynamicBuffer);gl.bufferData(gl.ARRAY_BUFFER,4096*12*4,gl.DYNAMIC_DRAW);
      this.shardVao=create('vao',()=>gl.createVertexArray());gl.bindVertexArray(this.shardVao);const geometry=[];
      const faces=[[[0,1,0],[-.7,-.4,.3],[.6,-.4,.3]],[[0,1,0],[.6,-.4,.3],[0,-.3,-.6]],[[0,1,0],[0,-.3,-.6],[-.7,-.4,.3]],[[-.7,-.4,.3],[0,-.3,-.6],[.6,-.4,.3]]];
      for(const[a,b,c]of faces){const u=b.map((x,k)=>x-a[k]),v=c.map((x,k)=>x-a[k]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],length=Math.hypot(...normal)||1;for(const p of [a,b,c])geometry.push(...p,...normal.map(x=>x/length));}
      this.shardBuffer=create('buffer',()=>gl.createBuffer());gl.bindBuffer(gl.ARRAY_BUFFER,this.shardBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(geometry),gl.DYNAMIC_DRAW);
      for(const[location,offset]of [[0,0],[1,12]]){gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,3,gl.FLOAT,false,24,offset);}
      gl.bindBuffer(gl.ARRAY_BUFFER,this.dynamicBuffer);this.attributes();gl.bindVertexArray(null);
    }catch(e){this.dispose();throw e;}
  }
  attributes(){const g=this.gl;for(const[location,size,offset]of [[2,3,0],[3,3,12],[4,4,24],[5,2,40]]){g.enableVertexAttribArray(location);g.vertexAttribPointer(location,size,g.FLOAT,false,48,offset);g.vertexAttribDivisor(location,1);}}
  upload(p){if(this.last===p)return;const g=this.gl;g.bindBuffer(g.ARRAY_BUFFER,this.buffer);g.bufferSubData(g.ARRAY_BUFFER,0,p.instances.subarray(0,p.count*12));const dynamic=p.dynamicCount??p.count;if(dynamic){g.bindBuffer(g.ARRAY_BUFFER,this.dynamicBuffer);g.bufferSubData(g.ARRAY_BUFFER,0,p.instances.subarray(0,dynamic*12));}this.last=p;this.viewLast=null;}
  sortView(p,forward){
    if(!forward||this.viewLast===p&&forward.every((v,i)=>v===this.viewForward[i]))return;
    const n=p.count,dynamic=p.dynamicCount??n,src=p.instances;this.viewOrder.length=n;
    for(let i=0;i<n;i++){this.viewOrder[i]=i;const at=i*12;this.depths[i]=((src[at]+src[at+3])*forward[0]+(src[at+1]+src[at+4])*forward[1]+(src[at+2]+src[at+5])*forward[2])*.5;}
    this.viewOrder.sort((a,b)=>this.depths[b]-this.depths[a]||a-b);let d=0;
    for(let i=0;i<n;i++){const source=this.viewOrder[i],at=source*12;for(let k=0;k<12;k++)this.viewInstances[i*12+k]=src[at+k];if(source<dynamic){for(let k=0;k<12;k++)this.dynamicInstances[d*12+k]=src[at+k];d++;}}
    const g=this.gl;g.bindBuffer(g.ARRAY_BUFFER,this.buffer);g.bufferSubData(g.ARRAY_BUFFER,0,this.viewInstances.subarray(0,n*12));if(dynamic){g.bindBuffer(g.ARRAY_BUFFER,this.dynamicBuffer);g.bufferSubData(g.ARRAY_BUFFER,0,this.dynamicInstances.subarray(0,dynamic*12));}
    this.viewLast=p;for(let i=0;i<3;i++)this.viewForward[i]=forward[i];
  }
  draw(vp,size,p,forward=null){const g=this.gl,n=p.count;if(!n||this.disposed)return;this.sortView(p,forward);g.enable(g.DEPTH_TEST);g.enable(g.BLEND);g.blendFunc(g.SRC_ALPHA,g.ONE_MINUS_SRC_ALPHA);g.depthMask(false);
    const t=this.trace;g.useProgram(t.p);g.uniformMatrix4fv(t.u.uVP,false,vp);g.uniform2f(t.u.uRes,...size);g.bindVertexArray(this.traceVao);g.uniform1f(t.u.uGlow,1);g.drawArraysInstanced(g.TRIANGLE_STRIP,0,4,n);g.uniform1f(t.u.uGlow,0);g.drawArraysInstanced(g.TRIANGLE_STRIP,0,4,n);
    const dynamic=p.dynamicCount??n;if(!dynamic)return;
    const s=this.shard;g.useProgram(s.p);g.uniformMatrix4fv(s.u.uVP,false,vp);g.uniform1f(s.u.uTime,p.physicalS);g.bindVertexArray(this.shardVao);g.drawArraysInstanced(g.TRIANGLES,0,12,dynamic);
    const f=this.field;g.useProgram(f.p);g.uniformMatrix4fv(f.u.uVP,false,vp);g.uniform1f(f.u.uPixel,1);g.bindVertexArray(this.shardVao);g.drawArraysInstanced(g.POINTS,0,18,dynamic);
  }
  dispose(){if(this.disposed)return;this.disposed=true;for(const[k,h]of this.resources)if(k==='vao')this.gl.deleteVertexArray(h);else this.gl.deleteBuffer(h);for(const p of this.programs)this.gl.deleteProgram(p.p);this.resources.length=0;this.programs.length=0;this.last=null;}
}

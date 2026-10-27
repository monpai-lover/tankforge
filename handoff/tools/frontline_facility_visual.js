// Host-authored infrastructure: visible positions are the very Float32 triangle
// list used for native finite contacts. Bounds only cull; they never fill holes.
function createFrontlineFacilityPresentation({renderer,crypto=globalThis.crypto}){
  const root=new Node('accepted-infrastructure'),entries=new Map();let installToken=0,battle=null;
  const finite=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
  const hex=b=>Array.from(new Uint8Array(b),n=>n.toString(16).padStart(2,'0')).join('');
  const digest=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
  function release(entry){if(!entry.nodes)return;for(const node of entry.nodes){root.children=root.children.filter(n=>n!==node);renderer.freeMesh(node.mesh);}entry.nodes=null;}
  async function install(catalog,{battle:nextBattle,mapId,layoutHash}){
    const token=++installToken;
    if(!Array.isArray(catalog)||catalog.length>4096||!Number.isSafeInteger(nextBattle)||nextBattle<=0||typeof mapId!=='string'||!crypto?.subtle)throw Error('Invalid facility catalog');
    const pending=new Map();let total=0;
    for(const geometry of catalog){
      const id=geometry.facility_id,hash=geometry.geometry_hash;
      if(typeof id!=='string'||!id.startsWith(mapId+':')||/[\0\r\n]/.test(id)||pending.has(id)||!(/^[a-f0-9]{64}$/).test(hash)||!Array.isArray(geometry.triangles)||geometry.triangles.length!==geometry.triangle_roles?.length||!Array.isArray(geometry.bounds)||geometry.bounds.length!==2||!geometry.bounds.every(finite))throw Error('Invalid registered facility geometry');
      total+=geometry.triangles.length;if(total>250000)throw Error('Facility triangle budget exceeded');
      const bytes=new Uint8Array(geometry.triangles.length*36),view=new DataView(bytes.buffer),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];let offset=0;
      for(const triangle of geometry.triangles){if(!Array.isArray(triangle)||triangle.length!==3||!triangle.every(finite))throw Error('Nonfinite facility triangle');for(const p of triangle)for(let k=0;k<3;k++){if(Math.fround(p[k])!==p[k])throw Error('Facility vertex is not the registered uploaded Float32');view.setFloat32(offset,p[k],true);offset+=4;lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}}
      if(geometry.triangles.length&&[lo,hi].some((p,i)=>p.some((v,k)=>v!==geometry.bounds[i][k])))throw Error('Facility bounds differ from actual triangles');
      pending.set(id,{geometry,nodes:null,variant:null,hashCheck:digest(bytes).then(actual=>{if(actual!==hash)throw Error('Facility visible/contact geometry hash mismatch');})});
    }
    await Promise.all([...pending.values()].map(e=>e.hashCheck));
    const layout=[...pending.keys()].sort().map(id=>id+'\0'+pending.get(id).geometry.geometry_hash+'\0').join('');
    if(await digest(new TextEncoder().encode(layout))!==layoutHash)throw Error('Facility layout identity mismatch');
    if(token!==installToken)return false;
    for(const entry of entries.values())release(entry);entries.clear();for(const [id,entry]of pending)entries.set(id,entry);battle=nextBattle;return true;
  }
  function construct(entry,state){
    const geometry=entry.geometry,top=new GeoBuilder(),shell=new GeoBuilder();
    const base=state.kind==='runway_patch'?'#454b4c':state.kind==='bridge'?'#77786e':state.kind==='fuel'?'#667858':state.kind==='arming'?'#8a795b':'#6a756b';
    const color=hexToLinear(base).map(v=>v*(state.damage_state==='damaged'?.68:1)),material={color,rough:.93,metal:.04};
    if(state.capabilities.geometry_active){for(let i=0;i<geometry.triangles.length;i++){const role=geometry.triangle_roles[i],builder=role==='bridge_top'||role==='runway_top'?top:shell;builder.tri(IDENTITY,false,...geometry.triangles[i],material);}}
    else if(state.kind!=='bridge'){
      // A flat scorch/status decal is an effect, never a fabricated river bed,
      // crater collider, invisible wall or surviving facility hit surface.
      const [a,b]=geometry.bounds,y=a[1]+.015;top.quad(IDENTITY,false,[a[0],y,a[2]],[a[0],y,b[2]],[b[0],y,b[2]],[b[0],y,a[2]],{color:[.025,.027,.022],rough:1,metal:0});
    }
    const nodes=[];
    try{for(const [name,builder]of [['top',top],['shell',shell]]){const data=builder.build();if(!data.length)continue;const node=new Node('facility:'+geometry.facility_id+':'+name);node.mesh=renderer.mesh(data);node.kind=21;node.castShadow=state.kind!=='runway_patch'&&!!state.capabilities.geometry_active;if(name==='top')node.polygonOffset=[-1,-1];nodes.push(node);}}
    catch(error){for(const node of nodes)renderer.freeMesh(node.mesh);throw error;}
    release(entry);entry.nodes=nodes;entry.variant=state.damage_state+':'+state.capabilities.geometry_active;for(const node of nodes)root.add(node);
  }
  function update(states,roi){
    if(battle===null)return;
    if(!Array.isArray(states)||!Array.isArray(roi?.center)||roi.center.length!==2||!roi.center.every(Number.isFinite)||!Number.isFinite(roi.radius)||roi.radius<0)throw Error('Invalid facility presentation region');
    const ids=new Set();for(const state of states){const entry=entries.get(state.facility_id);if(ids.has(state.facility_id)||!entry||state.geometry_hash!==entry.geometry.geometry_hash||typeof state.capabilities?.geometry_active!=='boolean'||!['intact','damaged','destroyed'].includes(state.damage_state))throw Error('Unregistered facility state');ids.add(state.facility_id);}
    const present=new Set();
    for(const state of states||[]){const entry=entries.get(state.facility_id);if(!entry||state.geometry_hash!==entry.geometry.geometry_hash||typeof state.capabilities?.geometry_active!=='boolean')throw Error('Unregistered facility state');present.add(state.facility_id);const [a,b]=entry.geometry.bounds,c=roi.center,x=Math.max(a[0],Math.min(c[0],b[0])),z=Math.max(a[2],Math.min(c[1],b[2])),visible=Math.hypot(x-c[0],z-c[1])<=roi.radius;
      if(visible&&(!entry.nodes||entry.variant!==state.damage_state+':'+state.capabilities.geometry_active))construct(entry,state);for(const node of entry.nodes||[])node.visible=visible;
    }
    for(const [id,entry]of entries)if(!present.has(id))for(const node of entry.nodes||[])node.visible=false;
  }
  function dispose(){installToken++;for(const entry of entries.values())release(entry);entries.clear();battle=null;}
  return {root,install,update,dispose,get ready(){return battle!==null},get registered(){return entries.size}};
}

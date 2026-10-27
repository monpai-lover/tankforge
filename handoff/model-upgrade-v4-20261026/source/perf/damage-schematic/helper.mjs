/* Aircraft damage plan view from the same triangles used by the airframe hitbox.
 * Geometry is rasterised once per hitbox/size. Damage changes recolour its ID map;
 * neither the display toggle nor this schematic changes physical membership. */
const surfaceCache=new WeakMap(), moduleCache=new WeakMap(), canvasState=new WeakMap();
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const ROLE_COLOURS={engine:[139,174,158],fuel:[194,170,111],ammunition:[171,149,183],crew:[204,190,155],avionics:[126,168,184],weapon:[170,156,181],control:[147,172,181]};
const HURT=[[196,209,206],[245,204,79],[244,133,53],[222,66,54]], GONE=[40,46,51];
const aliases={engine:'engine',fuel:'fuel',ammo:'ammunition',pilot:'crew',radar:'avionics',avionics:'avionics',gun:'weapon',controls:'control'};
const roleFor=id=>aliases[id]||aliases[String(id).split('_')[0]]||null;
function finiteData(a,stride){return a&&a.length>0&&a.length%stride===0;}
function transform(m,x,y,z){return m?[m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]]:[x,y,z];}
function localMatrices(root){
  const result=new Map(),identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const multiply=(a,b)=>{const out=new Float64Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];return out;};
  const visit=(n,parent)=>{
    let local=n.local;
    if(!local){
      local=identity.slice();local[12]=n.pos?.[0]||0;local[13]=n.pos?.[1]||0;local[14]=n.pos?.[2]||0;
      if(n.yaw){const c=Math.cos(n.yaw),s=Math.sin(n.yaw);local=multiply(local,[c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1]);}
      if(n.pitch){const c=Math.cos(n.pitch),s=Math.sin(n.pitch);local=multiply(local,[1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1]);}
      if(n.roll){const c=Math.cos(n.roll),s=Math.sin(n.roll);local=multiply(local,[c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1]);}
    }
    const matrix=n===root?identity:multiply(parent,local);result.set(n,matrix);
    for(const child of n.children||[])visit(child,matrix);
  };visit(root,identity);return result;
}
function moduleRecords(plane,engineLayout){
  const D=plane.damage,by=D.by||{},layout=plane.detailedInterior?.parts?.length?plane.detailedInterior.parts:plane.sourceInternalNodes?.length?plane.sourceInternalNodes:plane.internalNode?.mesh?._src?.data||plane.type;
  const existing=moduleCache.get(plane);if(existing&&existing.hb===plane.hitbox&&existing.layout===layout&&existing.layoutLength===layout.length&&existing.parts===D.parts&&existing.engineLayout===engineLayout)return existing.records;
  const records=[],matrices=localMatrices(plane.root);
  const add=(id,data,role,owner=null,node=null,damageIds=null)=>{
    if(!finiteData(data,39))return;
    const ids=(damageIds||[id]).filter(id=>by[id]);if(!ids.length)return;
    if(role==='structure'||!ROLE_COLOURS[role])return;
    records.push({id:ids[0],damageIds:ids,owner,data,role,matrix:node?matrices.get(node):null});
  };
  if(plane.detailedInterior?.parts?.length){
    for(const p of plane.detailedInterior.parts)add(p.id,p.data,p.role,p.owner,p.node,p.damageIds);
  }else if(plane.sourceInternalNodes?.length){
    for(const n of plane.sourceInternalNodes){
      const m=n.sourceModule;if(!m)continue;
      const ids=n.damageIds||[],role=roleFor(m.category)||roleFor(m.id)||roleFor(ids[0]);
      add(ids[0],m.data,role,null,n,ids);
    }
  }else{
    // The legacy fallback is a combined mesh. Its documented constant-colour
    // batches retain their original triangles after the position fitting pass.
    // Classifying that palette is display-only; existing accepted IDs own health.
    const data=plane.internalNode?.mesh?._src?.data,groups=new Map();
    const palette=[['fuel','#c99a36'],['ammo','#8f8a4a'],['radar','#3f7d86']].map(([id,hex])=>({id,c:[1,3,5].map(i=>(parseInt(hex.slice(i,i+2),16)/255)**2.2)}));
    if(finiteData(data,39))for(let i=0;i<data.length;i+=39){
      const match=palette.find(p=>p.c.every((v,k)=>Math.abs(v-data[i+6+k])<.0001));if(!match)continue;
      const centre=[0,1,2].map(k=>(data[i+k]+data[i+13+k]+data[i+26+k])/3);
      const family=D.parts.filter(p=>p.id===match.id||p.id.startsWith(match.id+'_')||match.id==='radar'&&p.id==='avionics');
      family.sort((a,b)=>Math.hypot(a.c[0]-centre[0],a.c[2]-centre[2])-Math.hypot(b.c[0]-centre[0],b.c[2]-centre[2]));
      const id=family[0]?.id;if(!id)continue;
      if(!groups.has(id))groups.set(id,[]);groups.get(id).push(...data.subarray(i,i+39));
    }
    for(const[id,values]of groups)add(id,new Float32Array(values),roleFor(id));
    const fitted=engineLayout?.build(plane.type.id,plane.type.model,{palette:'gray'});
    for(const m of fitted?.modules||[]){const side=`engine_${m.side<0?'l':'r'}`,id=m.side&&by[side]?side:'engine';add(id,m.data,'engine',by[id]?.parent||null);}
  }
  const represented=new Set(records.flatMap(r=>r.damageIds));
  // An unknown/procedural type still gets compact accepted-system symbols, never
  // the old overlapping envelope rectangles. Their positions use existing parts.
  for(const p of D.parts){const role=roleFor(p.id);if(!role||represented.has(p.id)||!p.c?.every(Number.isFinite))continue;records.push({id:p.id,damageIds:[p.id],owner:p.parent||null,role,marker:p.c});}
  moduleCache.set(plane,{layout,layoutLength:layout.length,parts:D.parts,hb:plane.hitbox,engineLayout,records});return records;
}
function triangle(ids,depth,size,bounds,a,b,c,id){
  const k=bounds.scale,ox=size/2-bounds.cx*k,oy=size/2+bounds.cz*k;
  const ax=a[0]*k+ox,ay=oy-a[2]*k,bx=b[0]*k+ox,by=oy-b[2]*k,cx=c[0]*k+ox,cy=oy-c[2]*k;
  const area=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);if(Math.abs(area)<1e-7)return;
  const x0=clamp(Math.floor(Math.min(ax,bx,cx)),0,size-1),x1=clamp(Math.ceil(Math.max(ax,bx,cx)),0,size-1),y0=clamp(Math.floor(Math.min(ay,by,cy)),0,size-1),y1=clamp(Math.ceil(Math.max(ay,by,cy)),0,size-1);
  const inverse=1/area,ux=(by-cy)*inverse,uy=(cx-bx)*inverse,vx=(cy-ay)*inverse,vy=(ax-cx)*inverse;
  let rowU=((bx-(x0+.5))*(cy-(y0+.5))-(by-(y0+.5))*(cx-(x0+.5)))*inverse,rowV=((cx-(x0+.5))*(ay-(y0+.5))-(cy-(y0+.5))*(ax-(x0+.5)))*inverse;
  const du=a[1]-c[1],dv=b[1]-c[1];
  for(let y=y0;y<=y1;y++,rowU+=uy,rowV+=vy){
    let u=rowU,v=rowV,index=y*size+x0;
    for(let x=x0;x<=x1;x++,index++,u+=ux,v+=vx){
      if(u<-.00001||v<-.00001||u+v>1.00001)continue;
      const height=c[1]+u*du+v*dv;
      if(!depth||height>=depth[index]){ids[index]=id;if(depth)depth[index]=height;}
    }
  }
}
/** Pure CPU, reusable by tests and the canvas presentation. */
export function buildProjection(plane,size=264,{engineLayout=null}={}){
  const hb=plane.hitbox;if(!finiteData(hb?.tris,9))return null;
  let sizes=surfaceCache.get(hb);if(!sizes){sizes=new Map();surfaceCache.set(hb,sizes);}
  let surface=sizes.get(size),builtSurface=false;
  if(surface?.mountRevision!==(hb.mountRevision||0))surface=null;
  if(!surface){
    const data=hb.tris,lo=[Infinity,Infinity],hi=[-Infinity,-Infinity];
    for(let i=0;i<data.length;i+=3){lo[0]=Math.min(lo[0],data[i]);hi[0]=Math.max(hi[0],data[i]);lo[1]=Math.min(lo[1],data[i+2]);hi[1]=Math.max(hi[1],data[i+2]);}
    if(![...lo,...hi].every(Number.isFinite))return null;
    const extent=Math.max(hi[0]-lo[0],hi[1]-lo[1]);if(!(extent>0))return null;
    const bounds={lo,hi,cx:(lo[0]+hi[0])*.5,cz:(lo[1]+hi[1])*.5,scale:(size-20*(size/264))/extent};
    const ids=new Int16Array(size*size);ids.fill(-1);const depth=new Float32Array(size*size);depth.fill(-Infinity);
    for(let i=0,t=0;i<data.length;i+=9,t++){const key=hb.pieces[hb.piece[t]]?.mountKey;if(key&&!hb.mountActive?.has(key))continue;triangle(ids,depth,size,bounds,data.subarray(i,i+3),data.subarray(i+3,i+6),data.subarray(i+6,i+9),hb.piece[t]);}
    surface={size,bounds,ids,pieces:hb.pieces,hash:hb.hash,triangleCount:data.length/9,mountRevision:hb.mountRevision||0};sizes.set(size,surface);builtSurface=true;
  }
  const records=moduleRecords(plane,engineLayout),modules=new Int16Array(size*size);modules.fill(-1);const depth=new Float32Array(size*size);depth.fill(-Infinity);
  for(let r=0;r<records.length;r++){
    const rec=records[r];
    if(rec.marker){
      const[x,,z]=rec.marker,px=Math.round((x-surface.bounds.cx)*surface.bounds.scale+size/2),py=Math.round(size/2-(z-surface.bounds.cz)*surface.bounds.scale),radius=Math.max(2,Math.round(size/100));
      for(let y=Math.max(0,py-radius);y<=Math.min(size-1,py+radius);y++)for(let x=Math.max(0,px-radius);x<=Math.min(size-1,px+radius);x++)if((x-px)**2+(y-py)**2<=radius**2)modules[y*size+x]=r;
      continue;
    }
    for(let i=0;i<rec.data.length;i+=39){const d=rec.data,a=transform(rec.matrix,d[i],d[i+1],d[i+2]),b=transform(rec.matrix,d[i+13],d[i+14],d[i+15]),c=transform(rec.matrix,d[i+26],d[i+27],d[i+28]);triangle(modules,depth,size,surface.bounds,a,b,c,r);}
  }
  let pixels=0;for(let i=0;i<surface.ids.length;i++){if(surface.ids[i]>=0)pixels++;else modules[i]=-1;}
  return {...surface,modules,records,pixels,builtSurface};
}
function condition(D,ids,owner){
  const parts=ids.map(id=>D.by?.[id]).filter(Boolean),gone=(owner&&D.gone?.(owner))||parts.some(p=>p.detached||D.gone?.(p.id));
  if(gone)return{colour:GONE,level:4,gone:true};
  const level=parts.reduce((n,p)=>Math.max(n,p.hp<=0?3:D.level(p)),0);return{colour:HURT[level]||HURT[0],level,gone:false};
}
export function paintProjection(projection,D){
  const{size,ids,pieces,modules,records}=projection,data=new Uint8ClampedArray(size*size*4);
  const surfaces=pieces.map(p=>condition(D,[p.part],p.carrier)),systems=records.map(r=>condition(D,r.damageIds,r.owner));
  for(let i=0;i<ids.length;i++){
    const id=ids[i];if(id<0)continue;
    const s=surfaces[id]||{colour:HURT[0],level:0,gone:false},m=modules[i],organ=m>=0?systems[m]:null;
    let col=s.colour,alpha=s.gone?125:210;
    if(organ&&!s.gone){col=organ.level?organ.colour:ROLE_COLOURS[records[m].role]||HURT[0];alpha=organ.gone?145:245;}
    const x=i%size,y=(i-x)/size,edge=x===0||x===size-1||y===0||y===size-1||ids[i-1]<0||ids[i+1]<0||ids[i-size]<0||ids[i+size]<0;
    if(edge){col=s.gone?[102,66,62]:s.level?s.colour:[224,236,230];alpha=245;}
    else if(m>=0&&(modules[i-1]!==m||modules[i+1]!==m||modules[i-size]!==m||modules[i+size]!==m)){col=organ.level?organ.colour:[198,218,210];alpha=245;}
    const p=i*4;data[p]=col[0];data[p+1]=col[1];data[p+2]=col[2];data[p+3]=alpha;
  }
  return data;
}
export function draw(plane,canvas,{language='zh',pixelRatio=globalThis.devicePixelRatio||1,engineLayout=null}={}){
  plane?.ensureDetailedInterior?.();
  const D=plane?.damage,hb=plane?.hitbox;if(!D||!hb)return false;
  const css=Math.max(64,Math.min(180,canvas.clientWidth||132)),ratio=clamp(pixelRatio,2,3),size=Math.round(css*ratio);
  let state=canvasState.get(canvas);
  const currentModules=moduleRecords(plane,engineLayout);
  const fire=D.fire>0;
  if(state&&state.plane===plane&&state.damage===D&&state.hb===hb&&state.revision===D.revision&&state.fire===fire&&state.size===size&&state.language===language&&state.projection.records===currentModules)return false;
  const old=state,geometryChanged=!state||state.plane!==plane||state.size!==size||state.hb!==hb||state.projection.records!==currentModules||state.projection.mountRevision!==(hb.mountRevision||0);
  const projection=geometryChanged?buildProjection(plane,size,{engineLayout}):state.projection;if(!projection)return false;
  if(canvas.width!==size||canvas.height!==size){canvas.width=size;canvas.height=size;}
  const g=canvas.getContext('2d'),pixels=paintProjection(projection,D),image=g.createImageData(size,size);image.data.set(pixels);g.putImageData(image,0,0);
  if(fire){g.save();g.fillStyle='#ff9d48';g.font=`600 ${10*ratio}px sans-serif`;g.fillText(language==='en'?'FIRE':'起火',4*ratio,size-4*ratio);g.restore();}
  const damaged=D.parts.filter(p=>p.hp<p.max||p.detached),headline=language==='en'?'Aircraft damage — top view':'飞机损伤示意（俯视）';
  canvas.title=headline+(damaged.length?'\n'+damaged.map(p=>`${p.name||p.id} ${p.detached?(language==='en'?'detached':'脱落'):Math.round(clamp(p.hp/p.max,0,1)*100)+'%'}`).join('\n'):'\n'+(language==='en'?'All systems intact':'各部件完好'));
  canvas.setAttribute?.('aria-label',canvas.title);canvas.setAttribute?.('role','img');
  canvasState.set(canvas,{plane,damage:D,revision:D.revision,fire,size,language,hb,projection});
  canvas.aircraftDamageStats={revision:'model-silhouette-v1',type:plane.type.id,size,sourceTriangles:projection.triangleCount,silhouettePixels:projection.pixels,moduleRecords:projection.records.length,geometryBuilt:geometryChanged,geometryReused:!!old&&!geometryChanged};
  return true;
}

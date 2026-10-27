/** Canonical-height visual terrain with conforming coarse/fine cell boundaries.
 * needsFine(x,z,coarseStep) receives the cell's MINIMUM world X/Z corner.
 * waterCutoutRegion must use the same canonical surface callback and cover ROI.
 * Existing fine cells retain their original two triangles per fine square.
 * Only coarse cells touching fine cells gain edge samples and a centre fan.
 * Heights, source water and native navigation are never changed.
 * Returns {data:Float32Array,stats}; caller uploads data with renderer.mesh().
 */
function buildFrontlineTerrainGeometry({GeoBuilder,roi,coarseStep,fineStep,needsFine,surface,waterCutoutRegion,material}) {
  if(typeof GeoBuilder!=='function'||typeof needsFine!=='function'||typeof surface!=='function'||typeof waterCutoutRegion?.clipTriangle!=='function')throw Error('Terrain geometry needs builder, selection, canonical surface and registered water cutout');
  if(!roi||!Array.isArray(roi.center)||roi.center.length!==2||!roi.center.every(Number.isFinite)||!Number.isFinite(roi.radius)||roi.radius<=0)throw Error('Invalid terrain ROI');
  if(![coarseStep,fineStep].every(Number.isFinite)||coarseStep<=0||fineStep<=0||fineStep>coarseStep)throw Error('Invalid terrain steps');
  const ratio=coarseStep/fineStep,count=roi.radius*2/coarseStep;
  if(!Number.isSafeInteger(ratio)||!Number.isSafeInteger(count)||ratio<1||count<1||count*count>262144)throw Error('Terrain steps must divide the bounded ROI and each other');
  if(!material||!Array.isArray(material.color)||material.color.length!==3||![...material.color,material.rough,material.metal].every(Number.isFinite))throw Error('Invalid terrain material');
  const minX=roi.center[0]-roi.radius,minZ=roi.center[1]-roi.radius,identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const fine=new Uint8Array(count*count),builder=new GeoBuilder(),points=new Map();
  const stats={coarseCells:0,fineCells:0,fanCells:0,stitchedEdges:0,sourceTriangles:0,clippedTriangles:0,sourceHeightSamples:0,vertices:0,sharedNormalVertices:0,degenerateUploadedTriangles:0};
  for(let z=0;z<count;z++)for(let x=0;x<count;x++){
    const selected=needsFine(minX+x*coarseStep,minZ+z*coarseStep,coarseStep);
    if(typeof selected!=='boolean')throw Error('Terrain needsFine must return a boolean');
    fine[z*count+x]=Number(selected);stats[selected?'fineCells':'coarseCells']++;
  }
  const isFine=(x,z)=>x>=0&&z>=0&&x<count&&z<count&&fine[z*count+x]===1;
  const point=(x,z)=>{
    const key=x+','+z;
    if(!points.has(key)){
      const h=surface(x,z);if(![x,h,z].every(Number.isFinite))throw Error('Nonfinite canonical terrain vertex');
      points.set(key,[x,h,z]);stats.sourceHeightSamples++;
    }
    return points.get(key);
  };
  const triangle=(a,b,c)=>{
    stats.sourceTriangles++;
    const clipped=waterCutoutRegion.clipTriangle([a,b,c]);
    if(!Array.isArray(clipped))throw Error('Invalid terrain water clip result');
    for(const t of clipped){
      if(!Array.isArray(t)||t.length!==3||t.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)))throw Error('Nonfinite clipped terrain vertex');
      builder.tri(identity,false,t[0],t[1],t[2],material);stats.clippedTriangles++;
    }
  };
  // Use one integer fine-grid coordinate formula on either side of an edge.
  // It preserves identical source positions even for fractional world origins.
  const vertex=(x,z)=>point(minX+x*fineStep,minZ+z*fineStep);
  for(let z=0;z<count;z++)for(let x=0;x<count;x++){
    const x0=x*ratio,z0=z*ratio,x1=x0+ratio,z1=z0+ratio;
    if(isFine(x,z)){
      for(let j=z0;j<z1;j++)for(let i=x0;i<x1;i++){
        const a=vertex(i,j),c=vertex(i,j+1),v=vertex(i+1,j),d=vertex(i+1,j+1);
        triangle(a,c,v);triangle(v,c,d);
      }
      continue;
    }
    const sides=[isFine(x-1,z),isFine(x,z+1),isFine(x+1,z),isFine(x,z-1)];
    if(ratio===1||!sides.some(Boolean)){
      const a=vertex(x0,z0),c=vertex(x0,z1),v=vertex(x1,z0),d=vertex(x1,z1);
      triangle(a,c,v);triangle(v,c,d);continue;
    }
    stats.fanCells++;stats.stitchedEdges+=sides.filter(Boolean).length;
    const ring=[],edges=[[x0,z0,x0,z1],[x0,z1,x1,z1],[x1,z1,x1,z0],[x1,z0,x0,z0]];
    for(let side=0;side<4;side++){
      const [ax,az,bx,bz]=edges[side],n=sides[side]?ratio:1;
      for(let i=0;i<n;i++)ring.push(vertex(ax+(bx-ax)*i/n,az+(bz-az)*i/n));
    }
    const centre=point(minX+(x+.5)*coarseStep,minZ+(z+.5)*coarseStep);
    for(let i=0;i<ring.length;i++)triangle(centre,ring[i],ring[(i+1)%ring.length]);
  }
  const data=builder.build();
  if(Object.prototype.toString.call(data)!=='[object Float32Array]'||data.length%39!==0)throw Error('Terrain builder must return triangle Float32 data at production stride13');
  // Smooth only this terrain mesh, AFTER registered water subtraction. The
  // same uploaded position receives the same area-weighted normal; there are
  // no extra derivative height queries and no smoothing of deck geometry.
  const normals=new Map(),key=i=>data[i]+','+data[i+1]+','+data[i+2];
  for(let i=0;i<data.length;i+=39){
    const ax=data[i],ay=data[i+1],az=data[i+2],bx=data[i+13],by=data[i+14],bz=data[i+15],cx=data[i+26],cy=data[i+27],cz=data[i+28];
    if(![ax,ay,az,bx,by,bz,cx,cy,cz].every(Number.isFinite))throw Error('Nonfinite uploaded Float32 terrain position');
    const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az,n=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx];
    if(n.every(v=>v===0))stats.degenerateUploadedTriangles++;
    for(const j of [i,i+13,i+26]){const k=key(j);let sum=normals.get(k);if(!sum)normals.set(k,sum=[0,0,0]);sum[0]+=n[0];sum[1]+=n[1];sum[2]+=n[2];}
  }
  for(const [k,n]of normals){const length=Math.hypot(...n);normals.set(k,length?[n[0]/length,n[1]/length,n[2]/length]:[0,1,0]);}
  for(let i=0;i<data.length;i+=13){const n=normals.get(key(i));data[i+3]=n[0];data[i+4]=n[1];data[i+5]=n[2];}
  stats.vertices=data.length/13;stats.sharedNormalVertices=normals.size;
  return {data,stats};
}

/** Registered water surfaces retain the authored hole-aware source triangles.
 * A triangle is visible when ANY part intersects the circular ROI: large sea
 * triangles can cover the camera while their centroid is many kilometres away.
 * Omit roi (or pass null) to upload the bounded source theatre once. No seabed,
 * coast, height or navigation geometry is inferred from the optical surface.
 */
function buildFrontlineWaterGeometry({GeoBuilder,waterAreas,roi=null,material,surfaceOffset=.02}) {
  if(typeof GeoBuilder!=='function'||!Array.isArray(waterAreas))throw Error('Water geometry needs builder and registered source areas');
  if(roi&&(!Array.isArray(roi.center)||roi.center.length!==2||!roi.center.every(Number.isFinite)||!Number.isFinite(roi.radius)||roi.radius<=0))throw Error('Invalid water ROI');
  if(!Number.isFinite(surfaceOffset))throw Error('Invalid water surface offset');
  if(!material||!Array.isArray(material.color)||material.color.length!==3||![...material.color,material.rough,material.metal].every(Number.isFinite))throw Error('Invalid water material');
  const builder=new GeoBuilder(),identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const stats={sourceTriangles:0,visibleTriangles:0,culledTriangles:0,vertices:0};
  const intersects=q=>{
    if(!roi)return true;
    const [x,z]=roi.center,r=roi.radius,r2=r*r;
    if(Math.max(q[0],q[2],q[4])<x-r||Math.min(q[0],q[2],q[4])>x+r||Math.max(q[1],q[3],q[5])<z-r||Math.min(q[1],q[3],q[5])>z+r)return false;
    let positive=false,negative=false;
    for(let i=0;i<6;i+=2){
      const j=(i+2)%6,dx=q[j]-q[i],dz=q[j+1]-q[i+1],px=x-q[i],pz=z-q[i+1];
      const side=dx*pz-dz*px;positive=positive||side>0;negative=negative||side<0;
      const length2=dx*dx+dz*dz,u=length2?Math.max(0,Math.min(1,(px*dx+pz*dz)/length2)):0;
      if((px-dx*u)**2+(pz-dz*u)**2<=r2)return true;
    }
    return !(positive&&negative);
  };
  for(const area of waterAreas){
    if(!Number.isFinite(area?.level))throw Error('Invalid registered water level');
    if(!Array.isArray(area.triangles))throw Error('Registered water needs authored hole-aware triangles');
    for(const q of area.triangles){
      if(!Array.isArray(q)||q.length!==6||!q.every(Number.isFinite))throw Error('Invalid registered water triangle');
      if(Math.abs((q[2]-q[0])*(q[5]-q[1])-(q[3]-q[1])*(q[4]-q[0]))<=1e-10)throw Error('Degenerate source water triangle');
      stats.sourceTriangles++;
      if(!intersects(q)){stats.culledTriangles++;continue;}
      const y=area.level+surfaceOffset;
      builder.tri(identity,false,[q[0],y,q[1]],[q[2],y,q[3]],[q[4],y,q[5]],material);stats.visibleTriangles++;
    }
  }
  const data=builder.build();
  if(Object.prototype.toString.call(data)!=='[object Float32Array]'||data.length%39!==0)throw Error('Water builder must return triangle Float32 data at production stride13');
  stats.vertices=data.length/13;
  return {data,stats};
}

/** Presentation-only distant terrain. Prepare once per map/material:
 * createFrontlineFarTerrainGeometry({GeoBuilder,terrain,bounds?,step:4000,
 *   createWaterCutout:createFrontlineWaterCutout,material}).
 * Then build({detailBounds,detailStep:200,detailSurface?}) as the near square moves.
 * Only the source base grid is sampled in the distance. Registered water is
 * subtracted once; subsequent builds bulk-copy cached dry triangles and cut out
 * the near rectangle. Optional detailSurface samples only its edge grid, so the
 * handoff matches the near mesh without running road/patch logic across a map.
 */
function createFrontlineFarTerrainGeometry({GeoBuilder,terrain,bounds=null,step=4000,createWaterCutout,material}) {
  if(typeof GeoBuilder!=='function'||typeof createWaterCutout!=='function')throw Error('Far terrain needs geometry and registered water cutout builders');
  const g=terrain;
  if(!g||![g.x0,g.z0,g.cellX,g.cellZ,g.width,g.height].every(Number.isFinite)||g.cellX<=0||g.cellZ<=0||!Number.isSafeInteger(g.width)||!Number.isSafeInteger(g.height)||g.width<2||g.height<2||!Array.isArray(g.heights)||g.heights.length!==g.width*g.height||!g.heights.every(Number.isFinite))throw Error('Invalid far source height grid');
  if(!Number.isFinite(step)||step<=0)throw Error('Invalid far terrain step');
  if(!material||!Array.isArray(material.color)||material.color.length!==3||![...material.color,material.rough,material.metal].every(Number.isFinite))throw Error('Invalid far terrain material');
  const validBounds=b=>b&&[b.minX,b.maxX,b.minZ,b.maxZ].every(Number.isFinite)&&b.minX<b.maxX&&b.minZ<b.maxZ;
  const extent={minX:g.x0,maxX:g.x0+(g.width-1)*g.cellX,minZ:g.z0,maxZ:g.z0+(g.height-1)*g.cellZ};
  if(bounds!==null&&!validBounds(bounds))throw Error('Invalid far terrain extent');
  const box=Object.freeze(bounds?{minX:Math.max(extent.minX,bounds.minX),maxX:Math.min(extent.maxX,bounds.maxX),minZ:Math.max(extent.minZ,bounds.minZ),maxZ:Math.min(extent.maxZ,bounds.maxZ)}:extent);
  if(!validBounds(box))throw Error('Far terrain extent does not intersect source heights');
  const nx=Math.ceil((box.maxX-box.minX)/step),nz=Math.ceil((box.maxZ-box.minZ)/step);
  if(!Number.isSafeInteger(nx*nz)||nx*nz>65536)throw Error('Far terrain grid exceeds bounded cell budget');
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],builder=new GeoBuilder(),heightCache=new Map();
  let baseHeightSamples=0,waterClipCalls=0;
  function baseHeight(x,z){
    const u=Math.max(0,Math.min(g.width-1,(x-g.x0)/g.cellX)),v=Math.max(0,Math.min(g.height-1,(z-g.z0)/g.cellZ));
    const i=Math.min(g.width-2,Math.floor(u)),j=Math.min(g.height-2,Math.floor(v)),a=u-i,b=v-j,k=j*g.width+i;
    return g.heights[k]*(1-a)*(1-b)+g.heights[k+1]*a*(1-b)+g.heights[k+g.width]*(1-a)*b+g.heights[k+g.width+1]*a*b;
  }
  function cachedHeight(x,z){
    const key=x+','+z;
    if(!heightCache.has(key)){heightCache.set(key,baseHeight(x,z));baseHeightSamples++;}
    return heightCache.get(key);
  }
  const cutout=createWaterCutout(g.waterAreas||[],cachedHeight).region(box);
  const point=(x,z)=>[x,cachedHeight(x,z),z];
  const triangle=(a,b,d)=>{
    waterClipCalls++;
    for(const t of cutout.clipTriangle([a,b,d]))builder.tri(identity,false,t[0],t[1],t[2],material);
  };
  for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){
    const x=box.minX+ix*step,z=box.minZ+iz*step,x1=Math.min(box.maxX,x+step),z1=Math.min(box.maxZ,z+step);
    const a=point(x,z),b=point(x,z1),d=point(x1,z),e=point(x1,z1);triangle(a,b,d);triangle(d,b,e);
  }
  const data=builder.build();
  if(Object.prototype.toString.call(data)!=='[object Float32Array]'||data.length%39!==0)throw Error('Far builder must return triangle Float32 data at production stride13');
  const count=data.length/39,boxes=new Float64Array(count*4);
  for(let i=0;i<count;i++){
    const k=i*39,b=i*4;boxes[b]=Math.min(data[k],data[k+13],data[k+26]);boxes[b+1]=Math.max(data[k],data[k+13],data[k+26]);boxes[b+2]=Math.min(data[k+2],data[k+15],data[k+28]);boxes[b+3]=Math.max(data[k+2],data[k+15],data[k+28]);
  }
  const stats=Object.freeze({gridCells:nx*nz,sourceTriangles:nx*nz*2,cachedTriangles:count,baseHeightSamples,waterClipCalls,cachedBytes:data.byteLength+boxes.byteLength});
  // Construction caches have served their purpose. Moving-edge coordinates
  // belong to each build and must not accumulate throughout a long flight.
  heightCache.clear();
  const side=(a,b,p)=>(b[0]-a[0])*(p[2]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
  const polygonArea=p=>p.slice(1,-1).reduce((sum,v,i)=>sum+(v[0]-p[0][0])*(p[i+2][2]-p[0][2])-(v[2]-p[0][2])*(p[i+2][0]-p[0][0]),0)/2;
  function halfplane(poly,a,b,positive){
    const out=[];
    for(let i=0;i<poly.length;i++){
      const p=poly[i],q=poly[(i+1)%poly.length],dp=side(a,b,p),dq=side(a,b,q),inside=positive?dp>=0:dp<=0,next=positive?dq>=0:dq<=0;
      if(inside)out.push(p);
      if(inside!==next){const u=dp/(dp-dq);out.push([p[0]+(q[0]-p[0])*u,p[1]+(q[1]-p[1])*u,p[2]+(q[2]-p[2])*u]);}
    }
    return out.filter((p,i)=>!i||Math.abs(p[0]-out[i-1][0])+Math.abs(p[2]-out[i-1][2])>1e-8);
  }
  function build({detailBounds,detailStep=200,detailSurface=null}){
    if(!validBounds(detailBounds))throw Error('Invalid far terrain detail rectangle');
    if(!Number.isFinite(detailStep)||detailStep<=0||Math.ceil((detailBounds.maxX-detailBounds.minX)/detailStep)+Math.ceil((detailBounds.maxZ-detailBounds.minZ)/detailStep)>4096)throw Error('Invalid far detail step or edge budget');
    if(detailSurface!==null&&typeof detailSurface!=='function')throw Error('Invalid far detail surface');
    const b=detailBounds,rect=[[b.minX,b.minZ],[b.maxX,b.minZ],[b.maxX,b.maxZ],[b.minX,b.maxZ]],ranges=[],changed=new GeoBuilder(),edgeCache=new Map(),localBase=new Map();
    const report={cachedTriangles:count,clippedSourceTriangles:0,omittedTriangles:0,detailHeightSamples:0,baseHeightSamplesAdded:0,outputTriangles:0,vertices:0};
    const sampleBase=(x,z)=>{
      const key=x+','+z;if(!localBase.has(key)){localBase.set(key,baseHeight(x,z));report.baseHeightSamplesAdded++;}return localBase.get(key);
    };
    const sampleDetail=(x,z)=>{
      const key=x+','+z;
      if(!edgeCache.has(key)){const h=detailSurface(x,z);if(!Number.isFinite(h))throw Error('Nonfinite near detail edge height');edgeCache.set(key,h);report.detailHeightSamples++;}
      return edgeCache.get(key);
    };
    const onEdge=p=>((Math.abs(p[0]-b.minX)<1e-6||Math.abs(p[0]-b.maxX)<1e-6)&&p[2]>=b.minZ-1e-6&&p[2]<=b.maxZ+1e-6)||((Math.abs(p[2]-b.minZ)<1e-6||Math.abs(p[2]-b.maxZ)<1e-6)&&p[0]>=b.minX-1e-6&&p[0]<=b.maxX+1e-6);
    function edgeHeight(x,z){
      if(!detailSurface)return sampleBase(x,z);
      const vertical=Math.abs(x-b.minX)<1e-6||Math.abs(x-b.maxX)<1e-6,origin=vertical?b.minZ:b.minX,end=vertical?b.maxZ:b.maxX,value=vertical?z:x;
      const a=origin+Math.min(Math.floor((value-origin)/detailStep),Math.max(0,Math.ceil((end-origin)/detailStep)-1))*detailStep,d=Math.min(end,a+detailStep),u=(value-a)/(d-a);
      return vertical?sampleDetail(x,a)*(1-u)+sampleDetail(x,d)*u:sampleDetail(a,z)*(1-u)+sampleDetail(d,z)*u;
    }
    function emit(poly){
      if(poly.length<3||Math.abs(polygonArea(poly))<=1e-8)return;
      const ring=[];
      for(let i=0;i<poly.length;i++){
        const a=poly[i],d=poly[(i+1)%poly.length];ring.push([a[0],onEdge(a)?edgeHeight(a[0],a[2]):sampleBase(a[0],a[2]),a[2]]);
        const vertical=Math.abs(a[0]-d[0])<1e-6,horizontal=Math.abs(a[2]-d[2])<1e-6;
        if(!onEdge(a)||!onEdge(d)||(!vertical&&!horizontal))continue;
        const origin=vertical?b.minZ:b.minX,start=vertical?a[2]:a[0],end=vertical?d[2]:d[0],marks=[];
        for(let k=Math.floor((Math.min(start,end)-origin)/detailStep)+1;origin+k*detailStep<Math.max(start,end)-1e-6;k++){
          const value=origin+k*detailStep;if(value>Math.min(start,end)+1e-6)marks.push(value);
        }
        if(start>end)marks.reverse();
        for(const value of marks){const x=vertical?a[0]:value,z=vertical?value:a[2];ring.push([x,edgeHeight(x,z),z]);}
      }
      const x=poly.reduce((sum,p)=>sum+p[0],0)/poly.length,z=poly.reduce((sum,p)=>sum+p[2],0)/poly.length,centre=[x,sampleBase(x,z),z];
      for(let i=0;i<ring.length;i++){
        const a=ring[i],d=ring[(i+1)%ring.length];
        if(Math.abs((a[0]-x)*(d[2]-z)-(a[2]-z)*(d[0]-x))>1e-8)changed.tri(identity,false,centre,a,d,material);
      }
    }
    let spanStart=0,keptFloats=0;
    const flush=end=>{if(end>spanStart){ranges.push([spanStart,end]);keptFloats+=end-spanStart;}};
    for(let i=0;i<count;i++){
      const k=i*39,j=i*4,minX=boxes[j],maxX=boxes[j+1],minZ=boxes[j+2],maxZ=boxes[j+3];
      if(maxX<b.minX||minX>b.maxX||maxZ<b.minZ||minZ>b.maxZ)continue;
      flush(k);spanStart=k+39;
      if(minX>=b.minX&&maxX<=b.maxX&&minZ>=b.minZ&&maxZ<=b.maxZ){report.omittedTriangles++;continue;}
      report.clippedSourceTriangles++;
      let inner=[[data[k],data[k+1],data[k+2]],[data[k+13],data[k+14],data[k+15]],[data[k+26],data[k+27],data[k+28]]];
      for(let e=0;e<4&&inner.length>=3;e++){
        const a=rect[e],d=rect[(e+1)%4];emit(halfplane(inner,a,d,false));inner=halfplane(inner,a,d,true);
      }
    }
    flush(data.length);
    const additions=changed.build(),out=new Float32Array(keptFloats+additions.length);let cursor=0;
    for(const[a,d]of ranges){out.set(data.subarray(a,d),cursor);cursor+=d-a;}out.set(additions,cursor);
    report.outputTriangles=out.length/39;report.vertices=out.length/13;
    return {data:out,stats:report};
  }
  return Object.freeze({bounds:box,stats,build});
}

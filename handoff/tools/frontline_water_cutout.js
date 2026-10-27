/** Visual terrain only: subtract the union of registered source water triangles.
 * Native height/navigation and water levels are unchanged. Source triangles
 * already exclude polygon holes. All output vertices sample canonical height.
 * API: createFrontlineWaterCutout(waterAreas,height).region(bounds).clipTriangle(xyz3).
 */
function createFrontlineWaterCutout(waterAreas, sampleHeight) {
  if (!Array.isArray(waterAreas) || typeof sampleHeight !== "function") throw Error("Water cutout needs source areas and canonical height");
  const GLOBAL = 16384, EPS_AREA = 1e-10;
  const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const area = p => p.length < 3 ? 0 : p.slice(1,-1).reduce((s,v,i)=>s+cross(p[0],v,p[i+2]),0)/2;
  const bbox = p => ({minX:Math.min(...p.map(v=>v[0])),maxX:Math.max(...p.map(v=>v[0])),minZ:Math.min(...p.map(v=>v[1])),maxZ:Math.max(...p.map(v=>v[1]))});
  const overlap = (a,b) => a.minX<=b.maxX&&a.maxX>=b.minX&&a.minZ<=b.maxZ&&a.maxZ>=b.minZ;
  function clean(p) {
    const out=[];
    for(const q of p) if(!out.length||q[0]!==out.at(-1)[0]||q[1]!==out.at(-1)[1])out.push(q);
    if(out.length>1&&out[0][0]===out.at(-1)[0]&&out[0][1]===out.at(-1)[1])out.pop();
    return out;
  }
  function halfplane(poly,a,b,positive) {
    const out=[];if(!poly.length)return out;
    for(let i=0;i<poly.length;i++) {
      const p=poly[i],q=poly[(i+1)%poly.length],dp=cross(a,b,p),dq=cross(a,b,q);
      const ip=positive?dp>=0:dp<=0,iq=positive?dq>=0:dq<=0;
      if(ip)out.push(p);
      if(ip!==iq) {const u=dp/(dp-dq);out.push([p[0]+(q[0]-p[0])*u,p[1]+(q[1]-p[1])*u]);}
    }
    return clean(out);
  }
  function subtract(poly,triangle) {
    let inner=poly;const result=[];
    for(let i=0;i<3&&inner.length>=3;i++) {
      const a=triangle[i],b=triangle[(i+1)%3],outer=halfplane(inner,a,b,false);
      if(Math.abs(area(outer))>EPS_AREA)result.push(outer);
      inner=halfplane(inner,a,b,true);
    }
    return result;
  }
  function cellBounds(b,size) {
    return [Math.floor(b.minX/size),Math.floor(b.maxX/size),Math.floor(b.minZ/size),Math.floor(b.maxZ/size)];
  }
  function insert(index,large,id,b,size,maxCells=256) {
    const [x0,x1,z0,z1]=cellBounds(b,size);
    if((x1-x0+1)*(z1-z0+1)>maxCells){large.push(id);return;}
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++) {
      const key=x+","+z;let list=index.get(key);if(!list)index.set(key,list=[]);list.push(id);
    }
  }
  function query(index,large,b,size,count) {
    const [x0,x1,z0,z1]=cellBounds(b,size);
    if((x1-x0+1)*(z1-z0+1)>4096)return Array.from({length:count},(_,i)=>i);
    const ids=new Set(large);
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++)for(const i of index.get(x+","+z)||[])ids.add(i);
    return [...ids];
  }
  const source=[],globalIndex=new Map(),globalLarge=[];
  for(const water of waterAreas) {
    if(!Array.isArray(water.triangles))throw Error("Registered water needs authored hole-aware triangles");
    for(const coords of water.triangles) {
      if(!Array.isArray(coords)||coords.length!==6||!coords.every(Number.isFinite))throw Error("Invalid registered water triangle");
      let p=[[coords[0],coords[1]],[coords[2],coords[3]],[coords[4],coords[5]]];
      const a=area(p);if(Math.abs(a)<=EPS_AREA)throw Error("Degenerate source water triangle");
      if(a<0)p=[p[0],p[2],p[1]];
      const b=bbox(p),id=source.length;source.push({points:p,bounds:b,area:Math.abs(a)});
      insert(globalIndex,globalLarge,id,b,GLOBAL);
    }
  }
  const stats={sourceTriangles:source.length,globalCells:globalIndex.size,globalLargeTriangles:globalLarge.length};
  function region(bounds) {
    if(!bounds||![bounds.minX,bounds.maxX,bounds.minZ,bounds.maxZ].every(Number.isFinite)||bounds.minX>=bounds.maxX||bounds.minZ>=bounds.maxZ)throw Error("Invalid terrain cutout ROI");
    const candidates=query(globalIndex,globalLarge,bounds,GLOBAL,source.length);
    const rect=[[bounds.minX,bounds.minZ],[bounds.maxX,bounds.minZ],[bounds.maxX,bounds.maxZ],[bounds.minX,bounds.maxZ]];
    const triangles=[],localIndex=new Map(),localLarge=[];
    // Local bins are bounded by ROI; a caller's very large overview cannot
    // allocate millions of tiny cells across the whole ocean.
    const cellSize=Math.max(256,Math.ceil(Math.max(bounds.maxX-bounds.minX,bounds.maxZ-bounds.minZ)/64));
    for(const id of candidates) {
      const entry=source[id];if(!overlap(entry.bounds,bounds))continue;
      let p=entry.points;
      for(let i=0;i<4&&p.length;i++)p=halfplane(p,rect[i],rect[(i+1)%4],true);
      for(let i=1;i+1<p.length;i++) {
        const points=[p[0],p[i],p[i+1]],a=area(points);if(Math.abs(a)<=EPS_AREA)continue;
        const b=bbox(points),n=triangles.length;triangles.push({points,bounds:b,area:Math.abs(a)});
        insert(localIndex,localLarge,n,b,cellSize);
      }
    }
    const heights=new Map();
    const regionStats={candidateSourceTriangles:candidates.length,clippedWaterTriangles:triangles.length,localCells:localIndex.size,localLargeTriangles:localLarge.length,cellSize,heightSamples:0};
    function vertex(p) {
      const key=p[0]+","+p[1];let h=heights.get(key);
      if(h===undefined){h=sampleHeight(p[0],p[1]);if(!Number.isFinite(h))throw Error("Nonfinite canonical terrain height");heights.set(key,h);regionStats.heightSamples++;}
      return [p[0],h,p[1]];
    }
    function clipTriangle(xyz) {
      if(!Array.isArray(xyz)||xyz.length!==3||xyz.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)))throw Error("Terrain triangle needs three finite XYZ vertices");
      const original=xyz.map(p=>[p[0],p[2]]),b=bbox(original);
      if(b.minX<bounds.minX-1e-8||b.maxX>bounds.maxX+1e-8||b.minZ<bounds.minZ-1e-8||b.maxZ>bounds.maxZ+1e-8)throw Error("Terrain triangle outside prepared water cutout ROI");
      if(Math.abs(area(original))<=EPS_AREA)return [];
      let remaining=[original];
      const ids=query(localIndex,localLarge,b,cellSize,triangles.length)
        .filter(i=>overlap(b,triangles[i].bounds)).sort((a,b)=>triangles[b].area-triangles[a].area||a-b);
      for(const id of ids) {
        if(!remaining.length)break;
        const water=triangles[id];
        remaining=remaining.flatMap(p=>overlap(bbox(p),water.bounds)?subtract(p,water.points):[p]);
      }
      const out=[];
      for(const p of remaining)for(let i=1;i+1<p.length;i++) {
        const q=[p[0],p[i],p[i+1]];if(Math.abs(area(q))>EPS_AREA)out.push(q.map(vertex));
      }
      return out;
    }
    return {clipTriangle,stats:regionStats};
  }
  return {region,stats};
}

// Visible bridge solids from the same registered rectangles and explicit joint
// wedges consumed by native ground policy. No GPU calls, inferred caps or Y lift.
// Separate top/shell meshes permit a draw-only polygonOffset on top faces.
function buildFrontlineBridgeGeometry({GeoBuilder,map,surface,roi=null,material}) {
  if(typeof GeoBuilder!=='function'||typeof surface!=='function')throw Error('Bridge geometry needs GeoBuilder and canonical surface');
  if(!material||!Array.isArray(material.color)||material.color.length!==3||![...material.color,material.rough,material.metal].every(Number.isFinite))throw Error('Invalid bridge material');
  if(roi&&(!Array.isArray(roi.center)||roi.center.length!==2||!roi.center.every(Number.isFinite)||!Number.isFinite(roi.radius)||roi.radius<0))throw Error('Invalid bridge ROI');
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],top=new GeoBuilder(),shell=new GeoBuilder(),sampled=new Map();
  const segments=map?.terrain?.roadbeds?.segments||[],bridges=map?.terrain?.bridges||[];
  const stats={bridges:0,rectangles:0,jointPolygons:0,jointHoles:0,jointTriangles:0,topTriangles:0,shellTriangles:0,culledRectangles:0,culledJointTriangles:0};
  const finitePoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
  const near=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<=1e-6;
  // Subtract a local origin before area products. Thin authored wedges at
  // theatre coordinates must not disappear through large-coordinate cancellation.
  const area=r=>r.reduce((sum,a,i)=>{const b=r[(i+1)%r.length],o=r[0];return sum+(a[0]-o[0])*(b[1]-o[1])-(b[0]-o[0])*(a[1]-o[1]);},0)/2;
  const ring=r=>{
    if(!Array.isArray(r)||r.length<4||!r.every(finitePoint)||!near(r[0],r.at(-1)))throw Error('Bridge joint ring must be finite and closed');
    const points=r.slice(0,-1).map(p=>p.slice());
    if(Math.abs(area(points))<1e-10)throw Error('Degenerate bridge joint ring');
    return points;
  };
  const relation=(p,r)=>{
    let inside=false;
    for(let i=0,j=r.length-1;i<r.length;j=i++){
      const a=r[j],b=r[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      if(length&&Math.abs((p[0]-a[0])*dz-(p[1]-a[1])*dx)<=1e-6*length&&(p[0]-a[0])*(p[0]-b[0])+(p[1]-a[1])*(p[1]-b[1])<=1e-12)return 2;
      if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }
    return inside?1:0;
  };
  const contains=(p,polygon)=>relation(p,polygon.ring)>0&&!polygon.holes.some(h=>relation(p,h)===1);
  const intersects=points=>{
    if(!roi)return true;
    const xs=points.map(p=>p[0]),zs=points.map(p=>p[1]),x=Math.max(Math.min(...xs),Math.min(roi.center[0],Math.max(...xs))),z=Math.max(Math.min(...zs),Math.min(roi.center[1],Math.max(...zs)));
    return Math.hypot(x-roi.center[0],z-roi.center[1])<=roi.radius;
  };
  const at=p=>{
    const key=`${p[0]},${p[1]}`;
    if(!sampled.has(key)){
      const h=surface(p[0],p[1]);if(!Number.isFinite(h))throw Error('Nonfinite canonical bridge surface');sampled.set(key,h);
    }
    return[p[0],sampled.get(key),p[1]];
  };
  const tri=(builder,a,b,c)=>builder.tri(identity,false,a,b,c,material);
  const sides=(points,thickness,hole=false)=>{
    // Outer is clockwise X/Z; a hole winds the other way. This controls side
    // normals only and does not move any supplied polygon point.
    let r=points;if((area(r)<0)===hole)r=r.slice().reverse();
    for(let i=0;i<r.length;i++){
      const j=(i+1)%r.length;if(near(r[i],r[j]))continue;
      const a=at(r[i]),b=at(r[j]),a0=[a[0],a[1]-thickness,a[2]],b0=[b[0],b[1]-thickness,b[2]];
      tri(shell,a,a0,b0);tri(shell,a,b0,b);stats.shellTriangles+=2;
    }
  };
  const solidTriangle=(points,thickness)=>{
    const [a,b,c]=points.map(at);tri(top,a,b,c);stats.topTriangles++;
    tri(shell,[a[0],a[1]-thickness,a[2]],[c[0],c[1]-thickness,c[2]],[b[0],b[1]-thickness,b[2]]);stats.shellTriangles++;
  };
  for(const bridge of bridges){
    if(!bridge||!Array.isArray(bridge.roadbedSegments)||!Number.isFinite(bridge.halfWidth)||bridge.halfWidth<=0||!Number.isFinite(bridge.deckThickness)||bridge.deckThickness<=0)throw Error('Invalid authored bridge dimensions');
    const registered=new Set(bridge.roadbedSegments);let visible=false;
    for(const index of registered){
      const s=segments[index];if(!Number.isSafeInteger(index)||!Array.isArray(s)||s.length!==8||!s.every(Number.isFinite))throw Error('Bridge references an invalid roadbed segment');
      const [ax,az,,bx,bz]=s,dx=bx-ax,dz=bz-az,length=Math.hypot(dx,dz);if(length<.001)throw Error('Degenerate bridge roadbed segment');
      const nx=-dz/length*bridge.halfWidth,nz=dx/length*bridge.halfWidth;
      const r=[[ax+nx,az+nz],[bx+nx,bz+nz],[bx-nx,bz-nz],[ax-nx,az-nz]];
      if(!intersects(r)){stats.culledRectangles++;continue;}
      solidTriangle([r[0],r[1],r[2]],bridge.deckThickness);solidTriangle([r[0],r[2],r[3]],bridge.deckThickness);sides(r,bridge.deckThickness);stats.rectangles++;visible=true;
    }
    const joint=bridge.jointGeometry;
    if(joint!=null){
      if(joint.version!==1||joint.source?.kind!=='authored_internal_deck_joint_wedges'||!Array.isArray(joint.sharedVertices)||!Array.isArray(joint.polygons)||!Array.isArray(joint.triangles))throw Error('Unsupported bridge joint geometry');
      const shared=joint.sharedVertices.map(v=>{
        if(!finitePoint(v.point)||!Array.isArray(v.roadbedSegments)||new Set(v.roadbedSegments).size<2||v.roadbedSegments.some((i,k)=>!registered.has(i)||k&&v.roadbedSegments[k-1]>=i))throw Error('Bridge joint must bind distinct sorted registered segments');
        for(const i of v.roadbedSegments){const s=segments[i];if(!near(v.point,[s[0],s[1]])&&!near(v.point,[s[3],s[4]]))throw Error('Bridge joint is not an actual shared endpoint');}
        return v.point;
      });
      const polygons=joint.polygons.map(p=>({ring:ring(p.ring),holes:(p.holes||[]).map(ring)}));
      const jointPoints=polygons.flatMap(p=>[p.ring,...p.holes]).flat();
      if(jointPoints.some(p=>!shared.some(s=>Math.hypot(p[0]-s[0],p[1]-s[1])<=bridge.halfWidth+2e-6)))throw Error('Joint polygon extends beyond its explicit internal junction');
      let triangleArea=0;
      const triangles=joint.triangles.map(t=>{
        if(!Array.isArray(t)||t.length!==6||!t.every(Number.isFinite))throw Error('Invalid bridge joint triangle');
        const p=[[t[0],t[1]],[t[2],t[3]],[t[4],t[5]]],a=area(p);
        if(a>=-1e-10)throw Error('Bridge top triangles must be nondegenerate clockwise X/Z');
        const probes=[...p,[(p[0][0]+p[1][0]+p[2][0])/3,(p[0][1]+p[1][1]+p[2][1])/3],...p.map((a,i)=>[(a[0]+p[(i+1)%3][0])/2,(a[1]+p[(i+1)%3][1])/2])];
        if(probes.some(q=>!polygons.some(poly=>contains(q,poly))))throw Error('Bridge triangle is outside the supplied joint polygon');
        triangleArea-=a;return p;
      });
      const polygonArea=polygons.reduce((sum,p)=>sum+Math.abs(area(p.ring))-p.holes.reduce((s,h)=>s+Math.abs(area(h)),0),0);
      if(Math.abs(triangleArea-polygonArea)>Math.max(1e-5,Math.abs(polygonArea)*1e-7))throw Error('Bridge joint triangles do not cover the supplied polygons');
      for(const p of triangles){if(!intersects(p)){stats.culledJointTriangles++;continue;}solidTriangle(p,bridge.deckThickness);stats.jointTriangles++;visible=true;}
      for(const p of polygons){if(!intersects(p.ring))continue;sides(p.ring,bridge.deckThickness);for(const h of p.holes)sides(h,bridge.deckThickness,true);stats.jointPolygons++;stats.jointHoles+=p.holes.length;}
    }
    if(visible)stats.bridges++;
  }
  return{top:top.build(),shell:shell.build(),stats};
}

// Apply only in the lit pass. The shared _draw also serves the shadow pass,
// whose own positive offset must not be changed by a bridge surface node.
function drawWithPolygonOffset(gl,offset,draw){
  if(!Array.isArray(offset)||offset.length!==2||!offset.every(Number.isFinite))return draw();
  const enabled=gl.isEnabled(gl.POLYGON_OFFSET_FILL),factor=gl.getParameter(gl.POLYGON_OFFSET_FACTOR),units=gl.getParameter(gl.POLYGON_OFFSET_UNITS);
  gl.enable(gl.POLYGON_OFFSET_FILL);gl.polygonOffset(offset[0],offset[1]);
  try{return draw();}
  finally{gl.polygonOffset(factor,units);if(!enabled)gl.disable(gl.POLYGON_OFFSET_FILL);}
}

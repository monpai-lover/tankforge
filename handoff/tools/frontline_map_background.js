/** Read-only tactical-map background from registered terrain/water geometry.
 * API: createFrontlineMapBackground(map).draw(ctx,
 *   {width,height,centre:[worldX,worldZ],scale:metresPerPixel}, colors?).
 * Positive world Z points down on this map, as in the production marker paths.
 * Coverage color describes the supplied terrain extent; water outlines retain
 * their source resolution. This helper infers neither coasts from heights nor
 * navigation permission from a painted land/water pixel.
 */
function createFrontlineMapBackground(map) {
  const finitePoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
  const validBounds=b=>b&&[b.minX,b.maxX,b.minZ,b.maxZ].every(Number.isFinite)&&b.minX<b.maxX&&b.minZ<b.maxZ;
  const overlap=(a,b)=>a.minX<=b.maxX&&a.maxX>=b.minX&&a.minZ<=b.maxZ&&a.maxZ>=b.minZ;
  if(!map||!map.terrain||!Array.isArray(map.terrain.waterAreas))throw Error('Map background needs registered terrain water areas');
  let bounds=map.bounds,extentSource='map.bounds';
  if(bounds==null){
    const t=map.terrain;
    if(![t.x0,t.z0,t.cellX,t.cellZ,t.width,t.height].every(Number.isFinite)||t.cellX<=0||t.cellZ<=0||!Number.isInteger(t.width)||!Number.isInteger(t.height)||t.width<2||t.height<2)throw Error('Map background needs finite terrain extent');
    bounds={minX:t.x0,maxX:t.x0+(t.width-1)*t.cellX,minZ:t.z0,maxZ:t.z0+(t.height-1)*t.cellZ};
    extentSource='terrain.vertexBounds';
  }
  if(!validBounds(bounds))throw Error('Invalid map background bounds');
  bounds=Object.freeze({minX:bounds.minX,maxX:bounds.maxX,minZ:bounds.minZ,maxZ:bounds.maxZ});
  const ring=input=>{
    if(!Array.isArray(input)||input.length<4||!input.every(finitePoint)||input[0][0]!==input.at(-1)[0]||input[0][1]!==input.at(-1)[1])throw Error('Map water rings must be finite and closed');
    return input.slice(0,-1).map(p=>[p[0],p[1]]);
  };
  const append=(target,rings)=>{for(const r of rings){target.moveTo(r[0][0],r[0][1]);for(let i=1;i<r.length;i++)target.lineTo(r[i][0],r[i][1]);target.closePath();}};
  const areas=map.terrain.waterAreas.map(w=>{
    if(w.holes!=null&&!Array.isArray(w.holes))throw Error('Map water holes must be rings');
    const rings=[ring(w.ring),...(w.holes||[]).map(ring)],outer=rings[0];
    const box={minX:Math.min(...outer.map(p=>p[0])),maxX:Math.max(...outer.map(p=>p[0])),minZ:Math.min(...outer.map(p=>p[1])),maxZ:Math.max(...outer.map(p=>p[1]))};
    const path=typeof Path2D==='function'?new Path2D():null;
    if(path)append(path,rings);
    return {rings,box,path};
  });
  const stats=Object.freeze({areas:areas.length,rings:areas.reduce((n,a)=>n+a.rings.length,0),points:areas.reduce((n,a)=>n+a.rings.reduce((m,r)=>m+r.length,0),0),cachedPaths:areas.filter(a=>a.path).length,extentSource});
  function fit(width,height,padding=1.08) {
    if(![width,height,padding].every(Number.isFinite)||width<=0||height<=0||padding<1)throw Error('Invalid map background fit');
    return {centre:[(bounds.minX+bounds.maxX)/2,(bounds.minZ+bounds.maxZ)/2],scale:Math.max((bounds.maxX-bounds.minX)/width,(bounds.maxZ-bounds.minZ)/height)*padding};
  }
  function draw(ctx,view,colors={}) {
    const {width,height,centre,scale}=view||{};
    if(![width,height,scale].every(Number.isFinite)||width<=0||height<=0||scale<=0||!finitePoint(centre))throw Error('Invalid map background view');
    const roi={minX:centre[0]-width*scale/2,maxX:centre[0]+width*scale/2,minZ:centre[1]-height*scale/2,maxZ:centre[1]+height*scale/2};
    const visible=overlap(bounds,roi),report={drawnAreas:0,drawnRings:0,viewBounds:roi,coverageBounds:bounds};
    ctx.save();
    try {
      ctx.fillStyle=colors.outside||'#0c171f';ctx.fillRect(0,0,width,height);
      if(!visible)return report;
      const x0=Math.max(0,(bounds.minX-centre[0])/scale+width/2),x1=Math.min(width,(bounds.maxX-centre[0])/scale+width/2);
      const z0=Math.max(0,(bounds.minZ-centre[1])/scale+height/2),z1=Math.min(height,(bounds.maxZ-centre[1])/scale+height/2);
      if(x1<=x0||z1<=z0)return report;
      ctx.beginPath();ctx.rect(x0,z0,x1-x0,z1-z0);ctx.clip();
      ctx.fillStyle=colors.land||'#3b493d';ctx.fillRect(x0,z0,x1-x0,z1-z0);
      ctx.translate(width/2-centre[0]/scale,height/2-centre[1]/scale);ctx.scale(1/scale,1/scale);
      ctx.fillStyle=colors.water||'#153847';
      for(const a of areas){
        if(!overlap(a.box,roi)||!overlap(a.box,bounds))continue;
        // Separate fills form a union across areas. One global even-odd path
        // would incorrectly erase overlaps between independent source waters.
        if(a.path)ctx.fill(a.path,'evenodd');
        else{ctx.beginPath();append(ctx,a.rings);ctx.fill('evenodd');}
        report.drawnAreas++;report.drawnRings+=a.rings.length;
      }
      return report;
    } finally {ctx.restore();}
  }
  return Object.freeze({draw,fit,bounds,stats});
}

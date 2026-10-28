/* TF_MINIMAP_AIRPORT_LABELS_R84_BEGIN */
// Map-content presentation only. The existing canvas, projection and 10 km
// visibility radius remain owned by the frontline map; labels never move icons.
var TFMinimapLabelsR84=(()=>{
  const font='bold 11px system-ui',padding=2,margin=4;
  const finite=Number.isFinite,hit=(a,b,gap=2)=>a.left<b.right+gap&&a.right>b.left-gap&&a.top<b.bottom+gap&&a.bottom>b.top-gap;
  function layout(rows,{width,height,measureText,scaleBarWidth=width/2}={}){
    if(!finite(width)||!finite(height)||width<40||height<88||typeof measureText!=='function'||!Array.isArray(rows))return [];
    const valid=rows.filter(r=>r&&typeof r.id==='string'&&typeof r.text==='string'&&r.text.length&&Array.isArray(r.point)&&r.point.length===2&&r.point.every(finite)&&r.point[0]>=0&&r.point[0]<=width&&r.point[1]>=0&&r.point[1]<=height).slice(0,64).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    const reserved=[{left:0,top:0,right:width,bottom:44},{left:10,top:height-39,right:Math.min(width-4,20+Math.max(0,scaleBarWidth)),bottom:height-2}];
    const markers=valid.map(r=>({left:r.point[0]-7,top:r.point[1]-7,right:r.point[0]+7,bottom:r.point[1]+7})),placed=[],seen=new Set();
    for(const row of valid){
      if(seen.has(row.id))continue;seen.add(row.id);
      let text=row.text,metrics=measureText(text),maxWidth=width-margin*2-padding*2;
      if(!metrics||!finite(metrics.width)||metrics.width<0)continue;
      if(metrics.width>maxWidth){const letters=Array.from(text);while(letters.length&&measureText(letters.join('')+'…').width>maxWidth)letters.pop();text=letters.join('')+'…';metrics=measureText(text);}
      if(!finite(metrics.width)||metrics.width>maxWidth)continue;
      const ascent=finite(metrics.actualBoundingBoxAscent)?Math.max(0,metrics.actualBoundingBoxAscent):9,descent=finite(metrics.actualBoundingBoxDescent)?Math.max(0,metrics.actualBoundingBoxDescent):3;
      const w=Math.ceil(metrics.width)+padding*2,h=Math.max(14,Math.ceil(ascent+descent)+padding*2),[x,y]=row.point,gap=10;
      const candidates=[[x+gap,y-gap-h],[x-gap-w,y-gap-h],[x+gap,y+gap],[x-gap-w,y+gap],[x-w/2,y-gap-h],[x-w/2,y+gap],[x+gap,y-h/2],[x-gap-w,y-h/2]];
      const box=candidates.map(([left,top])=>({left:Math.round(left),top:Math.round(top),right:Math.round(left)+w,bottom:Math.round(top)+h})).find(b=>b.left>=margin&&b.top>=margin&&b.right<=width-margin&&b.bottom<=height-margin&&!reserved.some(r=>hit(b,r))&&!markers.some(r=>hit(b,r))&&!placed.some(r=>hit(b,r)));
      if(box)placed.push({...box,id:row.id,text,team:row.team,width:w,height:h,x:box.left+padding,y:box.top+padding+ascent});
    }
    return placed;
  }
  function draw(g,fields,{width,height,point,nearby,scale,scaleBarWidth}={}){
    if(!g||typeof g.measureText!=='function'||typeof point!=='function'||typeof nearby!=='function')return [];
    const rows=[];for(const field of fields||[]){if(!field?.enabled||!field.runway||!Array.isArray(field.pos)||field.pos.length!==3||!field.pos.every(finite)||!nearby(field.pos))continue;rows.push({id:field.id,text:field.name||field.id,team:field.team,point:point(field.pos)});}
    g.save();g.font=font;g.textBaseline='alphabetic';g.textAlign='left';
    try{
      const bar=finite(scaleBarWidth)?scaleBarWidth:finite(scale)&&scale>0?(scale>500?100000:scale>50?10000:1000)/scale:width/2;
      const labels=layout(rows,{width,height,measureText:text=>g.measureText(text),scaleBarWidth:bar});
      for(const label of labels){g.fillStyle='rgba(7,17,25,.88)';g.fillRect(label.left,label.top,label.width,label.height);g.fillStyle=label.team===0||label.team==='blue'?'#76bdff':'#ff9984';g.fillText(label.text,label.x,label.y);}
      return labels;
    }finally{g.restore();}
  }
  return Object.freeze({font,layout,draw});
})();
/* TF_MINIMAP_AIRPORT_LABELS_R84_END */

// Hull-side running gear omitted by the old procedural renderer: bearing/final-drive
// castings, suspension links and small axles. Keep the open space between wheels
// and the track guide channel; only real mechanical connections bridge the gap.
import { GeoBuilder, IDENTITY, STRIDE } from './geo.js';
import { Node, translation } from './math.js';

// Closest point on a triangle (Ericson's vertex/edge/face regions). Construction only.
function closestTriangle(out, px, py, pz, data, i) {
  const ax=data[i], ay=data[i+1], az=data[i+2];
  const bx=data[i+STRIDE], by=data[i+STRIDE+1], bz=data[i+STRIDE+2];
  const cx=data[i+STRIDE*2], cy=data[i+STRIDE*2+1], cz=data[i+STRIDE*2+2];
  const abx=bx-ax, aby=by-ay, abz=bz-az, acx=cx-ax, acy=cy-ay, acz=cz-az;
  const apx=px-ax, apy=py-ay, apz=pz-az;
  const d1=abx*apx+aby*apy+abz*apz, d2=acx*apx+acy*apy+acz*apz;
  let u=0, v=0;
  if (!(d1<=0&&d2<=0)) {
    const bpx=px-bx, bpy=py-by, bpz=pz-bz;
    const d3=abx*bpx+aby*bpy+abz*bpz, d4=acx*bpx+acy*bpy+acz*bpz;
    if (d3>=0&&d4<=d3) u=1;
    else {
      const vc=d1*d4-d3*d2;
      if (vc<=0&&d1>=0&&d3<=0) u=d1/(d1-d3);
      else {
        const cpx=px-cx, cpy=py-cy, cpz=pz-cz;
        const d5=abx*cpx+aby*cpy+abz*cpz, d6=acx*cpx+acy*cpy+acz*cpz;
        if (d6>=0&&d5<=d6) v=1;
        else {
          const vb=d5*d2-d1*d6;
          if (vb<=0&&d2>=0&&d6<=0) v=d2/(d2-d6);
          else {
            const va=d3*d6-d5*d4;
            if (va<=0&&d4-d3>=0&&d5-d6>=0) { v=(d4-d3)/((d4-d3)+(d5-d6)); u=1-v; }
            else {
              const sum=va+vb+vc;
              if (Math.abs(sum)>1e-15) { u=vb/sum; v=vc/sum; }
            }
          }
        }
      }
    }
  }
  out[0]=ax+u*abx+v*acx; out[1]=ay+u*aby+v*acy; out[2]=az+u*abz+v*acz;
}

function hullAnchor(data, target, side, ceiling) {
  const scratch=[0,0,0], best=[0,0,0];
  for (let pass=0;pass<2;pass++) {
    let bestD=Infinity;
    for (let i=0;i<data.length;i+=STRIDE*3) {
      closestTriangle(scratch,...target,data,i);
      if (side*scratch[0]<.04 || side*scratch[0]>side*target[0]+.02 || (pass===0&&scratch[1]>ceiling)) continue;
      const d=(scratch[0]-target[0])**2+(scratch[1]-target[1])**2+(scratch[2]-target[2])**2;
      if (d<bestD) { bestD=d; for(let k=0;k<3;k++)best[k]=scratch[k]; }
    }
    if (Number.isFinite(bestD)) return best;
  }
  return null;
}

// Closed unit cylinder along Y, scaled and oriented between its two joint centres.
// Reuses the caller's matrix buffer; all radial axes have the same scale.
function rodMatrix(out, offset, a, b, radius) {
  let dx=b[0]-a[0], dy=b[1]-a[1], dz=b[2]-a[2];
  let length=Math.hypot(dx,dy,dz);
  if(length<1e-5) { dx=0;dy=1e-5;dz=0;length=1e-5; }
  const nx=dx/length, ny=dy/length, nz=dz/length;
  let rx,ry,rz;
  if(Math.abs(ny)<.9) { const h=Math.hypot(nx,nz);rx=nz/h;ry=0;rz=-nx/h; }
  else { const h=Math.hypot(ny,nz);rx=0;ry=-nz/h;rz=ny/h; }
  out[offset]=rx*radius;out[offset+1]=ry*radius;out[offset+2]=rz*radius;out[offset+3]=0;
  out[offset+4]=dx;out[offset+5]=dy;out[offset+6]=dz;out[offset+7]=0;
  out[offset+8]=(ry*nz-rz*ny)*radius;out[offset+9]=(rz*nx-rx*nz)*radius;out[offset+10]=(rx*ny-ry*nx)*radius;out[offset+11]=0;
  out[offset+12]=(a[0]+b[0])/2;out[offset+13]=(a[1]+b[1])/2;out[offset+14]=(a[2]+b[2])/2;out[offset+15]=1;
}

/** Procedural chassis only. Imported GLB suspension remains owned by its source model. */
export function buildGearSupports(renderer, running, hullData, wheels, rg, mats, meshes, suspensionKind) {
  const fixed=new GeoBuilder(), unit=new GeoBuilder(), matrix=new Float32Array(16), records=[], joints=[];
  const castings=new Set();
  unit.cylY(IDENTITY,false,1,1,1,10,mats.paint_dark);
  const roadStations=[...new Map(rg.wheels.map(w=>[w.z,w])).values()].sort((a,b)=>b.z-a.z);
  const addRod=(a,b,radius)=>records.push({a,b,radius});
  const groups=[];
  for(const side of [1,-1]) {
    const road=wheels.filter(w=>w.side===side&&w.role==='road_wheel');
    const stations=[...new Set(road.map(w=>w.station))];
    for(const station of stations)groups.push(road.filter(w=>w.station===station).sort((a,b)=>side*(a.node.pos[0]-b.node.pos[0])));
    for(const w of wheels.filter(w=>w.side===side&&w.role!=='road_wheel'))groups.push([w]);
  }
  for(const group of groups) {
    const first=group[0],side=first.side,road=first.role==='road_wheel',r=first.r;
    const spec=road?rg.wheels.find(w=>Math.abs(w.z-first.node.pos[2])<.001&&Math.abs((w.x||0)-(side*first.node.pos[0]-rg.track_x))<1e-6):first.role==='sprocket'?rg.sprocket:first.role==='idler'?rg.idler:(rg.rollers||[]).find(w=>w.z===first.node.pos[2]);
    const width=spec?.w || (first.role==='sprocket'?rg.track_width*.66:rg.track_width*.6);
    const armRadius=r*(road?.11:.18);
    // Interleaved adjacent wheels can extend inboard of this station. Put all
    // road-wheel arms behind the actual inner disc/bolt envelope of that side.
    const roadFace=road?Math.min(...wheels.filter(w=>w.side===side&&w.role==='road_wheel').map(w=>side*w.node.pos[0]+(side===1?w.node.mesh.gearFace[0]:-w.node.mesh.gearFace[1]))):0;
    const innerX=road?side*(roadFace-armRadius-.015):first.node.pos[0]-side*(width/2+.025);
    let pivotZ=first.node.pos[2],pivotY=first.node.pos[1];
    if(road) {
      pivotY+=r*.35;
      // Existing leaf/volute bogies attach two stations to a shared upper bracket.
      const bogie=suspensionKind==='leaf_bogie'||suspensionKind==='volute'||suspensionKind==='hvss';
      const pair=roadStations.slice(Math.floor(first.station/2)*2,Math.floor(first.station/2)*2+2);
      pivotZ=bogie&&pair.length===2?(pair[0].z+pair[1].z)/2:pivotZ+r*.4;
    }
    const anchor=hullAnchor(hullData,[innerX,pivotY,pivotZ],side,first.node.pos[1]+r*.85);
    if(!anchor)continue;
    const pivot=[innerX,anchor[1],anchor[2]],hub=[innerX,first.node.pos[1],first.node.pos[2]];
    const inset=[anchor[0]-side*.02,anchor[1],anchor[2]];
    const castingRadius=r*(first.role==='sprocket'?.5:first.role==='idler'?.32:.22);
    // The flange penetrates the measured hull skin slightly, so it stays attached.
    const castingKey=[...anchor,...pivot,castingRadius].map(v=>v.toFixed(6)).join(':');
    if(!castings.has(castingKey)) {
      castings.add(castingKey);
      fixed.cyl(translation(...anchor),false,'x',castingRadius,castingRadius,.06,12,mats.paint_dark);
      rodMatrix(matrix,0,inset,pivot,castingRadius*.8);
      fixed.cylY(matrix,false,1,1,1,12,mats.paint_dark);
    }
    addRod(pivot,hub,armRadius);
    joints.push({hub,wheel:first.node});
    let previous=hub;
    for(const w of group) {
      addRod(previous,w.node.pos,r*.17);
      previous=w.node.pos;
    }
  }
  const mount=running.add(new Node('gear_mounts'));
  mount.mesh=renderer.mesh(fixed.build());meshes.push(mount.mesh);
  const links=running.add(new Node('gear_connections'));
  links.mesh=renderer.instancedMesh(unit.build(),records.length);meshes.push(links.mesh);
  const matrices=new Float32Array(records.length*16);
  return { nodes:[mount,links], update() {
    for(const joint of joints) { joint.hub[1]=joint.wheel.pos[1];joint.hub[2]=joint.wheel.pos[2]; }
    for(let i=0;i<records.length;i++) { const link=records[i];rodMatrix(matrices,i*16,link.a,link.b,link.radius); }
    renderer.setInstances(links.mesh,matrices,records.length);
  }};
}

/** Detailed, component-coloured game interiors fitted to the authored aircraft.
 * These are readable structural game models, not manufacturing drawings or
 * historically surveyed internals. The exact uploaded triangles are retained
 * in parts[].data for the aircraft's contact scene. O affects rendering only.
 */
const PI = Math.PI;
const add = (a,b)=>a.map((v,i)=>v+b[i]);
const sub = (a,b)=>a.map((v,i)=>v-b[i]);
const mul = (a,k)=>a.map(v=>v*k);
const dot = (a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross = (a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm = a=>mul(a,1/(Math.hypot(...a)||1));
const mix = (a,b,k)=>a.map((v,i)=>v+(b[i]-v)*k);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const color=hex=>{const n=parseInt(hex.slice(1),16);return [16,8,0].map(s=>Math.pow(((n>>s)&255)/255,2.2));};
const C={engine:color('#58ad63'),engineDark:color('#285f3c'),engineLight:color('#a2d18b'),fuel:color('#e7a622'),fuelDark:color('#ac6d16'),fuelLight:color('#f4c94a'),gun:color('#a76ac0'),gunDark:color('#634277'),gunLight:color('#d0a0df'),avionics:color('#4e9dda'),avionicsDark:color('#285c85'),avionicsLight:color('#9fcde8'),frame:color('#9ca79b'),frameDark:color('#536b67'),seat:color('#c9cc88'),pilot:color('#78824d'),face:color('#e0c19a'),helmet:color('#d5d7b7'),black:color('#263630')};

class Mesh {
  constructor(){this.v=[];}
  tri(a,b,c,col,rough=.62,metal=.18){
    const n=norm(cross(sub(b,a),sub(c,a)));
    if(Math.hypot(...n)<.5)return;
    for(const p of [a,b,c])this.v.push(...p,...n,...col,rough,metal,p[0],p[2]);
  }
  quad(a,b,c,d,col,rough,metal){this.tri(a,b,c,col,rough,metal);this.tri(a,c,d,col,rough,metal);}
  box(c,size,col,axes=[[1,0,0],[0,1,0],[0,0,1]]){
    const point=(x,y,z)=>add(c,add(add(mul(axes[0],size[0]*x*.5),mul(axes[1],size[1]*y*.5)),mul(axes[2],size[2]*z*.5)));
    const p=[point(-1,-1,-1),point(1,-1,-1),point(1,1,-1),point(-1,1,-1),point(-1,-1,1),point(1,-1,1),point(1,1,1),point(-1,1,1)];
    for(const f of [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[0,1,5,4],[3,7,6,2]])this.quad(...f.map(i=>p[i]),col);
  }
  tube(a,b,r0,r1,col,segments=12,wall=0,caps=true,start=0,end=2*PI){
    const d=norm(sub(b,a));if(Math.hypot(...sub(b,a))<1e-7)return;
    const u=norm(cross(Math.abs(d[1])<.8?[0,1,0]:[1,0,0],d)),v=cross(d,u);
    const p=(c,r,t)=>add(c,add(mul(u,Math.cos(t)*r),mul(v,Math.sin(t)*r)));
    const step=(end-start)/segments;
    for(let i=0;i<segments;i++){
      const t=start+i*step,tn=t+step,A=p(a,r0,t),B=p(a,r0,tn),D=p(b,r1,t),E=p(b,r1,tn);
      this.quad(A,B,E,D,col);
      if(wall>0){
        const ai=p(a,Math.max(.001,r0-wall),t),bi=p(a,Math.max(.001,r0-wall),tn),di=p(b,Math.max(.001,r1-wall),t),ei=p(b,Math.max(.001,r1-wall),tn);
        this.quad(bi,ai,di,ei,col);
        if(caps){this.quad(B,A,ai,bi,col);this.quad(D,E,ei,di,col);}
      }else if(caps){this.tri(a,B,A,col);this.tri(b,D,E,col);}
    }
  }
  line(a,b,r,col,segments=6){this.tube(a,b,r,r,col,segments,0,true);}
  path(points,r,col,segments=6){for(let i=1;i<points.length;i++)this.line(points[i-1],points[i],r,col,segments);}
  sphere(c,r,col,segments=12,rings=7){
    const p=(t,a)=>[c[0]+r[0]*Math.sin(t)*Math.cos(a),c[1]+r[1]*Math.cos(t),c[2]+r[2]*Math.sin(t)*Math.sin(a)];
    for(let j=0;j<rings;j++)for(let i=0;i<segments;i++)this.quad(p(j/rings*PI,i/segments*2*PI),p((j+1)/rings*PI,i/segments*2*PI),p((j+1)/rings*PI,(i+1)/segments*2*PI),p(j/rings*PI,(i+1)/segments*2*PI),col);
  }
  ring(c,r,width,col,segments=18,thickness=.026){this.tube(add(c,[0,0,-width/2]),add(c,[0,0,width/2]),r,r,col,segments,thickness,true);}
  get data(){return new Float32Array(this.v);}
}

function turbojet(b,c,r,length,{centrifugal=false,afterburner=false,early=false,compressorStages=0}={}){
  const local=p=>add(c,p),rear=-length*.5,front=length*.5;
  // Axial compressor rotors/stators. Their casing is a lower-half cutaway,
  // leaving genuine open volume around the shaft and visible blade rows.
  const stages=compressorStages||(centrifugal?2:early?8:10),compLength=length*(centrifugal?.3:.46);
  b.tube(local([0,0,rear*.72]),local([0,0,front*.93]),r*.16,r*.22,C.engineDark,14,0,true);
  for(let j=0;j<stages;j++){
    const z=front*.91-j*(compLength/Math.max(1,stages-1)),rr=r*(1-.2*j/(stages||1));
    b.ring(local([0,0,z]),rr,.052,C.engineLight,20,.018);
    const blades=centrifugal?18:16;
    for(let k=0;k<blades;k++){
      const a=k/blades*2*PI+j*.14,an=a+.13;
      const p0=local([Math.cos(a)*r*.22,Math.sin(a)*r*.22,z-.025]);
      const p1=local([Math.cos(a+.09)*rr*.91,Math.sin(a+.09)*rr*.91,z+.045]);
      const p2=local([Math.cos(an+.09)*rr*.91,Math.sin(an+.09)*rr*.91,z+.015]);
      const p3=local([Math.cos(an)*r*.22,Math.sin(an)*r*.22,z-.05]);
      b.quad(p0,p1,p2,p3,j%2?C.engine:C.engineLight);
      b.quad(add(p3,[0,0,.012]),add(p2,[0,0,.012]),add(p1,[0,0,.012]),add(p0,[0,0,.012]),C.engineDark);
    }
  }
  const combustionZ=centrifugal?0:-length*.06;
  // Individual can combustors and fuel-manifold links, not a filled cylinder.
  for(let k=0;k<(centrifugal?9:8);k++){
    const a=k/(centrifugal?9:8)*2*PI,rr=r*.67,x=Math.cos(a)*rr,y=Math.sin(a)*rr;
    b.tube(local([x,y,combustionZ-length*.14]),local([x,y,combustionZ+length*.1]),r*.16,r*.13,C.engine,10,.012,true);
    b.ring(local([x,y,combustionZ]),r*.165,.035,C.engineLight,10,.014);
    b.path([local([x,y,combustionZ+length*.09]),local([x*1.12,y*1.12,combustionZ+length*.14]),local([x*.9,y*.9,front*.55])],r*.025,C.engineLight,5);
  }
  for(let j=0;j<3;j++){
    const z=rear*.67+j*length*.065;
    b.ring(local([0,0,z]),r*(.68+j*.025),.07,C.engineDark,20,.022);
    for(let k=0;k<17;k++){
      const a=k/17*2*PI,aa=a+.1,rr=r*.7;
      b.quad(local([Math.cos(a)*r*.21,Math.sin(a)*r*.21,z]),local([Math.cos(a+.08)*rr,Math.sin(a+.08)*rr,z+.025]),local([Math.cos(aa+.08)*rr,Math.sin(aa+.08)*rr,z+.025]),local([Math.cos(aa)*r*.21,Math.sin(aa)*r*.21,z]),C.engineLight);
    }
  }
  b.tube(local([0,0,rear]),local([0,0,rear+length*.19]),r*.7,r*.8,C.engineDark,22,.025,true);
  if(afterburner){
    for(let k=0;k<6;k++){const a=k/6*2*PI;b.line(local([Math.cos(a)*r*.25,Math.sin(a)*r*.25,rear+length*.08]),local([Math.cos(a)*r*.65,Math.sin(a)*r*.65,rear+length*.08]),.018,C.engineLight,5);}
    b.ring(local([0,0,rear+length*.08]),r*.45,.025,C.engineLight,20,.016);
  }
  // Segmented lower casing leaves the compressor and combustion cans legible.
  b.tube(local([0,0,rear+length*.19]),local([0,0,front*.93]),r*.91,r,C.engine,16,.018,true,PI,2*PI);
  for(const z of [rear+length*.2,0,front*.88])b.ring(local([0,0,z]),r*1.015,.045,C.engineLight,22,.024);
  for(const side of [-1,1]){
    b.path([local([side*r*.82,0,rear+length*.22]),local([side*r*1.03,-r*.2,0]),local([side*r*.88,-r*.32,front*.72])],r*.055,C.engineLight,7);
    b.box(local([side*r*.65,-r*.71,0]),[r*.42,r*.35,length*.14],C.engineDark);
    for(let i=0;i<4;i++)b.box(local([side*r*.66,-r*.71,-length*.055+i*length*.035]),[r*.46,r*.39,.025],C.engineLight);
  }
}

function pistonEngine(b,c,h,radial=false,cylindersPerRow=9){
  const r=Math.min(h[0],h[1])*.92,L=h[2]*1.8,at=p=>add(c,p);
  b.tube(at([0,0,-L*.5]),at([0,0,L*.5]),r*.3,r*.32,C.engineDark,14,0,true);
  if(radial){
    const rows=2;
    for(let row=0;row<rows;row++)for(let k=0;k<cylindersPerRow;k++){
      const a=k/cylindersPerRow*2*PI+(row?PI/cylindersPerRow:0),dir=[Math.sin(a),Math.cos(a),0],z=(row-.5)*L*.46;
      const lo=at(add(mul(dir,r*.28),[0,0,z])),hi=at(add(mul(dir,r*.88),[0,0,z]));
      b.tube(lo,hi,r*.18,r*.16,C.engine,9,0,true);
      for(let j=0;j<5;j++){
        const q=add(lo,mul(sub(hi,lo),.3+j*.13));b.tube(add(q,mul(dir,-.015)),add(q,mul(dir,.015)),r*.22,r*.22,C.engineLight,10,0,true);
      }
      b.line(at(add(mul(dir,r*.12),[0,0,z+L*.13])),add(hi,[0,0,.04]),.025,C.engineLight,5);
    }
  }else{
    b.box(at([0,-r*.13,0]),[r*.85,r*.62,L*.82],C.engineDark);
    for(const side of [-1,1]){
      for(let j=0;j<6;j++){
        const z=-L*.4+j*L*.16,base=at([side*r*.2,0,z]),top=at([side*r*.61,r*.62,z]);
        b.tube(base,top,r*.19,r*.18,C.engine,10,0,true);
        b.box(add(top,[0,.025,0]),[r*.31,r*.15,L*.125],C.engineLight);
        b.path([add(top,[side*r*.05,0,.015]),at([side*r*.88,r*.28,z]),at([side*r*.97,-r*.12,z-.05])],.045,C.engineDark,6);
        b.line(at([side*r*.1,r*.3,z]),add(top,[0,.03,0]),.015,C.engineLight,5);
      }
      b.box(at([side*r*.52,r*.76,0]),[r*.34,.09,L*.92],C.engineLight);
    }
    b.box(at([0,-r*.56,0]),[r*.75,r*.35,L*.8],C.engine);
  }
  b.tube(at([0,0,L*.46]),at([0,0,L*.68]),r*.37,r*.2,C.engineLight,14,0,true);
  b.ring(at([0,0,L*.47]),r*.42,.06,C.engineDark,16,.035);
  for(let i=0;i<4;i++)b.line(at([-r*.6,-r*.5,-L*.4+i*L*.25]),at([r*.6,-r*.5,-L*.4+i*L*.25]),.025,C.engineLight,5);
}

function roundedTank(b,c,h){
  // Bladder with a chamfered perimeter, end dishes, restraining straps and fittings.
  const x=h[0]*.9,y=h[1]*.86,z=h[2]*.9;
  const outline=[[-x,-y*.7],[-x*.75,-y],[x*.75,-y],[x,-y*.7],[x,y*.7],[x*.75,y],[-x*.75,y],[-x,y*.7]];
  for(let i=0;i<8;i++){
    const j=(i+1)%8,A=add(c,[outline[i][0],outline[i][1],-z]),B=add(c,[outline[j][0],outline[j][1],-z]),D=add(c,[outline[i][0],outline[i][1],z]),E=add(c,[outline[j][0],outline[j][1],z]);
    b.quad(A,B,E,D,C.fuel);b.tri(add(c,[0,0,-z]),B,A,C.fuelDark);b.tri(add(c,[0,0,z]),D,E,C.fuelLight);
  }
  for(const zz of [-z*.62,z*.62])for(let i=0;i<8;i++){
    const j=(i+1)%8;b.line(add(c,[outline[i][0]*1.008,outline[i][1]*1.008,zz]),add(c,[outline[j][0]*1.008,outline[j][1]*1.008,zz]),.016,C.fuelDark,5);
  }
  b.tube(add(c,[0,y,z*.3]),add(c,[0,y+.055,z*.3]),.045,.045,C.fuelDark,10,0,true);
  b.line(add(c,[x*.75,y*.4,z*.8]),add(c,[x*.75,y*.4,z+Math.min(.15,z*.15)]),.025,C.fuelDark,6);
}

function wingSection(spec,x){
  const a=spec.wing;
  let lo=a[0],hi=a[a.length-1];
  for(let i=1;i<a.length;i++)if(x<=a[i][0]){lo=a[i-1];hi=a[i];break;}
  const k=clamp((x-lo[0])/(hi[0]-lo[0]||1),0,1);
  return lo.map((v,i)=>v+(hi[i]-v)*k);
}
function wingPoint(spec,x,chordFraction,side,vertical=0){const s=wingSection(spec,x);return [side*x,s[1]+vertical,s[2]-s[3]*chordFraction];}
function wingTank(b,spec,x0,x1,side){
  const s0=wingSection(spec,x0),s1=wingSection(spec,x1),th0=Math.max(.018,s0[4]*.62),th1=Math.max(.012,s1[4]*.62);
  const p=[wingPoint(spec,x0,.22,side,th0),wingPoint(spec,x1,.22,side,th1),wingPoint(spec,x1,.66,side,th1),wingPoint(spec,x0,.66,side,th0),wingPoint(spec,x0,.22,side,-th0),wingPoint(spec,x1,.22,side,-th1),wingPoint(spec,x1,.66,side,-th1),wingPoint(spec,x0,.66,side,-th0)];
  for(const f of [[0,1,2,3],[4,7,6,5],[0,4,5,1],[3,2,6,7],[0,3,7,4],[1,5,6,2]])b.quad(...f.map(i=>p[i]),C.fuel);
  for(const k of [.2,.78]){const x=x0+(x1-x0)*k,s=wingSection(spec,x),h=s[4]*.66;b.line(wingPoint(spec,x,.22,side,h),wingPoint(spec,x,.66,side,h),.012,C.fuelDark,5);}
}

function pilotAndSeat(b,canopy){
  const [c,h]=canopy,scale=clamp(h[1]/.38,.6,1.2),p=[c[0],c[1]-.2*scale,c[2]-.12*h[2]],s=scale;
  const at=v=>add(p,mul(v,s));
  b.box(at([0,-.2,-.06]),[.43*s,.09*s,.45*s],C.seat);
  b.box(at([0,.16,-.25]),[.43*s,.7*s,.07*s],C.seat);
  b.box(at([0,.48,-.24]),[.3*s,.19*s,.1*s],C.black);
  for(const side of [-1,1]){
    b.line(at([side*.18,-.25,-.2]),at([side*.18,.47,-.2]),.022*s,C.frameDark,6);
    b.line(at([side*.22,-.06,-.1]),at([side*.22,-.06,.3]),.025*s,C.seat,6);
  }
  b.sphere(at([0,.05,.02]),[.16*s,.28*s,.12*s],C.pilot,12,8);
  b.sphere(at([0,.39,.035]),[.12*s,.145*s,.12*s],C.helmet,12,8);
  b.sphere(at([0,.37,.132]),[.084*s,.071*s,.018*s],C.face,10,6);
  b.box(at([0,.42,.137]),[.18*s,.055*s,.025*s],C.black);
  for(const side of [-1,1]){
    const hip=at([side*.1,-.16,.08]),knee=at([side*.14,-.28,.4]),foot=at([side*.14,-.57,.47]);
    b.tube(hip,knee,.07*s,.065*s,C.pilot,9,0,true);b.tube(knee,foot,.06*s,.045*s,C.pilot,9,0,true);b.box(add(foot,[0,0,.06*s]),[.1*s,.08*s,.2*s],C.black);
    const shoulder=at([side*.17,.22,.035]),elbow=at([side*.24,.02,.18]),hand=at([side*.09,-.01,.39]);
    b.tube(shoulder,elbow,.055*s,.045*s,C.pilot,8,0,true);b.tube(elbow,hand,.045*s,.035*s,C.pilot,8,0,true);b.sphere(hand,[.035*s,.035*s,.035*s],C.face,8,5);
    b.line(at([side*.11,.29,-.08]),at([-side*.11,-.12,.14]),.016*s,C.seat,5);
  }
  b.path([at([0,-.42,.22]),at([0,-.13,.33]),at([0,.01,.38])],.019*s,C.frameDark,6);
  // Harness reel, seat adjustment rails, cockpit rudder pedals.
  b.tube(at([-.11,.25,-.3]),at([.11,.25,-.3]),.045*s,.045*s,C.seat,10,0,true);
  for(const side of [-1,1])b.box(at([side*.14,-.58,.62]),[.12*s,.04*s,.12*s],C.frameDark);
}

function ammoFeed(b,start,end,scale=1){
  const middle=add(mix(start,end,.5),[0,.04*scale,-.08*scale]);
  let previous=null;
  for(let i=0;i<13;i++){
    const t=i/12,p=add(add(mul(start,(1-t)*(1-t)),mul(middle,2*t*(1-t))),mul(end,t*t));
    b.tube(add(p,[0,0,-.07*scale]),add(p,[0,0,.07*scale]),.019*scale,.019*scale,C.gunLight,7,0,true);
    b.tube(add(p,[0,0,.07*scale]),add(p,[0,0,.105*scale]),.019*scale,.002,C.gun,7,0,true);
    if(previous)b.line(previous,p,.009*scale,C.gunDark,5);previous=p;
  }
}

function fuselageProfile(spec,z){
  const a=spec.fuselage;let lo=a[0],hi=a[a.length-1];
  for(let i=1;i<a.length;i++)if(z<=a[i][0]){lo=a[i-1];hi=a[i];break;}
  const k=clamp((z-lo[0])/(hi[0]-lo[0]||1),0,1);
  return [lo[1]+(hi[1]-lo[1])*k,lo[2]+(hi[2]-lo[2])*k];
}

const sameColor=(data,i,col)=>col.every((v,k)=>Math.abs(v-data[i+6+k])<1e-5);
function mappedData(data,point){
  const b=new Mesh();
  for(let i=0;i<data.length;i+=39)b.tri(...[0,13,26].map(j=>point(Array.from(data.slice(i+j,i+j+3)))),Array.from(data.slice(i+6,i+9)));
  return b.data;
}
// A visual inspection opening, not a missing collision surface. The complete
// fitted tank remains in part.data; only the generated render mesh is opened.
function inspectFuel(data){
  const out=[];
  for(let i=0;i<data.length;i+=39){
    const opening=sameColor(data,i,C.fuel)&&data[i+4]>.65;
    if(!opening)for(let j=0;j<39;j++)out.push(data[i+j]);
  }
  return new Float32Array(out);
}
function fuelDetails(data){
  const b=new Mesh(),tops=[];
  const verticalSpan=(x,z)=>{
    const hits=[];
    for(let i=0;i<data.length;i+=39){
      // Restrict the query to the original cell hull, excluding straps/hoses.
      if(![C.fuel,C.fuelDark,C.fuelLight].some(c=>sameColor(data,i,c)))continue;
      const a=Array.from(data.slice(i,i+3)),p=Array.from(data.slice(i+13,i+16)),q=Array.from(data.slice(i+26,i+29));
      const den=(p[2]-q[2])*(a[0]-q[0])+(q[0]-p[0])*(a[2]-q[2]);if(Math.abs(den)<1e-9)continue;
      const u=((p[2]-q[2])*(x-q[0])+(q[0]-p[0])*(z-q[2]))/den,v=((q[2]-a[2])*(x-q[0])+(a[0]-q[0])*(z-q[2]))/den;
      if(u>=-1e-5&&v>=-1e-5&&u+v<=1+1e-5)hits.push(a[1]*u+p[1]*v+q[1]*(1-u-v));
    }
    if(hits.length<2)return null;
    const lo=Math.min(...hits),hi=Math.max(...hits);return hi-lo>.015?[lo,hi]:null;
  };
  for(let i=0;i<data.length;i+=39){
    if(!sameColor(data,i,C.fuel)||data[i+4]<.65)continue;
    const p=[0,13,26].map(j=>Array.from(data.slice(i+j,i+j+3))),c=mul(add(add(p[0],p[1]),p[2]),1/3),area=Math.hypot(...cross(sub(p[1],p[0]),sub(p[2],p[0])))*.5;
    if(area<.008)continue;
    tops.push({p,c,area});
  }
  tops.sort((a,b)=>b.area-a.area);
  const used=[];
  for(const t of tops){
    if(used.length>=4||used.some(c=>Math.hypot(c[0]-t.c[0],c[2]-t.c[2])<.14))continue;
    const span=verticalSpan(t.c[0],t.c[2]);if(!span)continue;
    const edgeClearance=Math.min(...t.p.map((a,j)=>{const d=sub(t.p[(j+1)%3],a),v=sub(t.c,a);return Math.abs(d[0]*v[2]-d[2]*v[0])/(Math.hypot(d[0],d[2])||1);}));
    const depth=span[1]-span[0],r=Math.min(.042,Math.sqrt(t.area)*.1,depth*.2,edgeClearance*.3);if(r<.005)continue;
    used.push(t.c);
    const c=[t.c[0],span[0]+depth*.48,t.c[2]],low=add(c,[0,-depth*.21,0]),high=add(c,[0,depth*.21,0]);
    // Immersed boost pump, strainer, shut-off valve and the short pickup pipe.
    b.tube(low,high,r*.8,r,C.fuelDark,10,0,true);
    for(let j=0;j<4;j++)b.tube(add(low,[0,j*depth*.03,0]),add(low,[0,(j+.35)*depth*.03,0]),r*1.1,r*1.1,C.fuelLight,10,0,true);
    b.line(high,add(high,[r*1.8,0,0]),r*.22,C.fuelDark,6);
    b.tube(add(high,[r*1.5,-r*.5,0]),add(high,[r*1.5,r*.5,0]),r*.45,r*.45,C.fuelLight,8,0,true);
    const inner=t.p.map(p=>mix(t.c,p,.38));
    for(let j=0;j<3;j++){
      const a=inner[j],d=inner[(j+1)%3],sa=verticalSpan(a[0],a[2]),sd=verticalSpan(d[0],d[2]);if(!sa||!sd)continue;
      const A=[a[0],sa[0]+(sa[1]-sa[0])*.18,a[2]],B=[d[0],sd[0]+(sd[1]-sd[0])*.18,d[2]],D=[a[0],sa[0]+(sa[1]-sa[0])*.7,a[2]],E=[d[0],sd[0]+(sd[1]-sd[0])*.7,d[2]];
      b.quad(A,B,E,D,C.fuelDark);b.quad(D,E,B,A,C.fuelDark);
    }
  }
  return b.data;
}
function engineServices(b){
  // Normalised inside the engine bay. These accessories remain presentation
  // only and follow their engine/pod carrier without adding damage volumes.
  b.box([0,-.45,.08],[.75,.25,.36],C.engineDark);
  for(const side of [-1,1]){
    b.tube([side*.27,-.45,-.24],[side*.27,-.45,.32],.115,.115,C.engineLight,12,0,true);
    b.ring([side*.27,-.45,.24],.13,.05,C.engineDark,12,.025);
    b.path([[side*.27,-.45,-.24],[side*.48,-.26,-.12],[side*.46,.12,.24]],.035,C.engineLight,6);
    for(let j=0;j<4;j++)b.box([side*.27,-.29,-.16+j*.105],[.2,.025,.035],C.engine);
  }
  b.tube([-.22,-.31,.1],[.22,-.31,.1],.06,.06,C.engineLight,10,0,true);
  for(const x of [-.14,0,.14])b.tube([x,-.4,.05],[x,-.24,.05],.028,.028,C.engineDark,7,0,true);
}
function hydraulicServices(b){
  for(const side of [-1,1]){
    b.tube([side*.16,.2,-.1],[side*.16,.2,.25],.08,.08,C.avionicsDark,10,0,true);
    b.sphere([side*.16,.2,-.1],[.08,.08,.06],C.avionicsLight,10,5);
    b.line([side*.16,.2,.25],[side*.16,-.02,.25],.022,C.engineLight,6);
  }
  b.box([0,-.04,.18],[.54,.12,.22],C.avionics);
  for(let j=0;j<5;j++){
    const x=-.2+j*.1;b.tube([x,-.04,.3],[x,-.04,.36],.032,.032,C.avionicsLight,7,0,true);
    b.path([[x,-.04,.36],[x,.05,.4],[x,.12,.3]],.015,C.avionicsDark,5);
  }
}


function sourceInterior(plane,byId){
  const model=plane.type.model;
  const authored=model?.buf&&model.parts?.filter(p=>p.group==='internal');
  if(!authored?.length)return null;
  const sp=plane.type.fighter?.spec,split=plane.hitbox?.split??plane.type._hitbox?.split??Infinity;
  const groups=new Map(),bodyWidth=sp?.fuselage?Math.max(...sp.fuselage.map(s=>s[1])):1;
  const wingOwner=(x)=>{const id=`wing_${x<0?'l':'r'}`;return Math.abs(x)>split&&byId.has(id+'_out')?id+'_out':id;};
  const moduleMeta=p=>typeof p.module==='object'&&p.module?p.module:{id:p.module};
  const roleOf=p=>{
    const m=moduleMeta(p),text=[m.category,m.id,m.label,p.name].filter(Boolean).join(' ');
    if(/ammo|ammun|belt|cartridge|drum|bullet/i.test(text))return 'ammunition';
    if(/Jumo|VK1|J47|J79|Avon|engine|compressor|impeller|combust|turbine|afterburn|exhaust|intake|duct/i.test(text))return 'engine';
    if(/fuel|tank|bladder/i.test(text))return 'fuel';
    if(/ANM3|MK108|NR23|N37|aden|cannon|weapon|gun(?:_|\b)|gsh|receiver/i.test(text))return 'weapon';
    if(/cooling|radiator|oil.?cool/i.test(text))return 'cooling';
    if(/control|hydraul|cable|actuator/i.test(text))return 'control';
    if(/avion|radar|battery|radio|oxygen|electr|equipment|sight/i.test(text))return 'avionics';
    return 'structure';
  };
  for(const p of authored){
    const pos=new Int16Array(model.buf,p.pos,p.vertices*3),nor=new Int8Array(model.buf,p.nor,p.vertices*3),uv=new Uint16Array(model.buf,p.uv,p.vertices*2),idx=new Uint16Array(model.buf,p.idx,p.triangles*3),role=roleOf(p);
    const metadata=moduleMeta(p),moduleId=metadata.id,text=[metadata.category,metadata.id,metadata.label,p.name].filter(Boolean).join(' ');
    for(let t=0;t<idx.length;t+=3){
      const center=[0,0,0];for(let j=0;j<3;j++)for(let k=0;k<3;k++)center[k]+=pos[idx[t+j]*3+k]*model.posScale/3;
      let owner=null,id=byId.has(moduleId)?moduleId:null;
      const side=/(?:_L\b|_left\b|port\b)/i.test(text)?-1:/(?:_R\b|_right\b|starboard\b)/i.test(text)?1:center[0]<0?-1:1;
      if(role==='engine'){
        id=byId.has(`engine_${side<0?'l':'r'}`)?`engine_${side<0?'l':'r'}`:'engine';
        owner=byId.get(id)?.parent||null;
      }else if(role==='fuel'){
        const wing=/wing/i.test(text)||Math.abs(center[0])>bodyWidth*1.05;
        id=wing&&byId.has(`fuel_${side<0?'l':'r'}`)?`fuel_${side<0?'l':'r'}`:'fuel';
        if(wing)owner=wingOwner(center[0]);
      }else if(role==='weapon'||role==='ammunition'){
        id=role==='weapon'?'gun':'ammo';
        if(Math.abs(center[0])>bodyWidth*1.08)owner=wingOwner(center[0]);
      }else if(role==='avionics')id=/radar/i.test(text)&&byId.has('radar')?'radar':'avionics';
      else if(role==='cooling')id=byId.has('cooling')?'cooling':'engine';
      else if(role==='control')id=byId.has('controls')?'controls':'fuselage';
      else {
        id=id&&byId.has(id)?id:'fuselage';
        if(sp?.wing&&Math.abs(center[0])>Math.max(bodyWidth*.8,sp.wing[0][0])){
          const sec=wingSection(sp,Math.abs(center[0]));
          if(center[2]>=sec[2]-sec[3]-.35&&center[2]<=sec[2]+.35)id=owner=wingOwner(center[0]);
        }
        if(id==='fuselage'&&byId.has('tail')&&center[2]<byId.get('tail').c[2]+byId.get('tail').h[2])id=owner='tail';
      }
      const key=[id,owner||'',role].join('|');
      let batch=groups.get(key);if(!batch){batch={id,owner,role,v:[],names:new Set()};groups.set(key,batch);}
      batch.names.add(p.name);
      const base=role==='engine'?C.engine:role==='fuel'?C.fuel:role==='weapon'||role==='ammunition'?C.gun:role==='avionics'||role==='cooling'?C.avionics:role==='control'?C.engineLight:C.frame;
      const shade=/dark|black/i.test(p.name)?.48:/silver|flange|rim|band|bolt|vane/i.test(p.name)?1.15:/hot|copper/i.test(p.name)?.7:1;
      const col=base.map(v=>Math.min(1,v*shade));
      for(let j=0;j<3;j++){
        const i=idx[t+j];
        // Match importedGeometry's final Float32 positions, normals and UVs exactly.
        batch.v.push(pos[i*3]*model.posScale,pos[i*3+1]*model.posScale,pos[i*3+2]*model.posScale,nor[i*3]/127,nor[i*3+1]/127,nor[i*3+2]/127,...col,p.rough??.6,p.metal??.2,uv[i*2]/65535,1-uv[i*2+1]/65535);
      }
    }
  }
  return [...groups.values()].map((g,i)=>({id:g.id,owner:g.owner,role:g.role,instanceId:`authored_${g.role}_${i}`,data:new Float32Array(g.v),sourceNames:[...g.names]}));
}

function finishInterior(plane,{root,nodes,parts,additionalDamageParts,preservedNodes,keepCockpit,preservesAuthoredInternal=false,modernDamage=false}){
  const renderer=plane.renderer;let shown=false,disposed=false;
  // The former procedural cage was an approximate diagram, not material from
  // the imported model. Actual outer skin still supplies structural contact.
  // Exclude that cage consistently, including when O is released; authored
  // internal structure retains its original physical membership.
  if(!preservesAuthoredInternal)for(const p of parts)if(p.role==='structure')p.enabled=false;
  function updateDamage(){
    const d=plane.damage;
    for(const p of parts){
      const detached=!!(p.owner&&(modernDamage?d?.gone(p.owner):d?.dead(p.owner))||modernDamage&&d?.gone(p.id));
      p.node.hitboxDisabled=detached||!!p.displayOnly;
      // Mechanisms-only O view. Visibility never controls physical membership.
      if(!p.preserved)p.node.visible=!detached&&p.role!=='structure';
      const state=d?.by?.[p.id],fraction=state?clamp(state.hp/state.max,0,1):1;
      const burning=!!(state?.fire||state?.burning),heat=burning?[1,.42,.015]:p.role==='fuel'?[1,.57,.03]:p.role==='avionics'||p.role==='control'?[.95,.26,.045]:[1,.16,.025];
      p.node.highlight=fraction<1||burning?[...heat,Math.min(.7,.15+(1-fraction)*.5+(burning?.12:0))]:[0,0,0,0];
      if(p.renderNode)p.renderNode.highlight=p.node.highlight;
    }
    root.visible=shown;
  }
  const triangles=parts.filter(p=>!p.preserved).reduce((sum,p)=>sum+p.data.length/39,0);
  const renderTriangles=parts.filter(p=>!p.preserved).reduce((sum,p)=>sum+(p.renderData||p.data).length/39,0);
  const uploadedTriangles=triangles+parts.filter(p=>p.renderNode).reduce((sum,p)=>sum+p.renderData.length/39,0);
  // Existing authored geometry is preserved in full. Never silently decimate a
  // user's internals to satisfy the newly generated geometry budget.
  if(!preservesAuthoredInternal&&uploadedTriangles>30000)throw Error(`Aircraft interior exceeds upload budget (${plane.type.id}: ${uploadedTriangles})`);
  return {root,nodes,parts,additionalDamageParts,preservedNodes,preservesCockpit:keepCockpit,preservesAuthoredInternal,replacesInternal:!!plane.internalNode,triangles,renderTriangles,uploadedTriangles,addedTriangles:preservesAuthoredInternal?0:uploadedTriangles,layoutRevision:'interior-v3-mechanisms-20261025',
    setVisible(on){shown=!!on;updateDamage();},updateDamage,
    dispose(){if(disposed)return;disposed=true;for(const p of parts){if(p.preserved)continue;for(const node of [p.node,p.renderNode]){if(!node)continue;const i=plane.meshes.indexOf(node.mesh);if(i>=0){renderer.freeMesh(node.mesh);plane.meshes.splice(i,1);}}}const i=plane.root.children.indexOf(root);if(i>=0)plane.root.children.splice(i,1);}
  };
}

/** @param plane authored Aircraft instance. Dependencies are supplied by bundle. */
export function buildAircraftInterior(plane,{Node,preserveCockpit=true,engineLayout=null,mechanismFit=null}={}){
  if(!Node||!plane?.renderer||!plane?.root)throw Error('Aircraft interior requires the authored plane, renderer and Node');
  const renderer=plane.renderer,type=plane.type,f=type.fighter,sp=f?.spec;
  const root=plane.root.add(new Node('aircraft_detailed_interior'));
  root.visible=false;
  const nodes=[],parts=[],additionalDamageParts=[];
  const byId=new Map((plane.damage?.parts||type.parts||[]).map(p=>[p.id,p]));
  const originalParts=new Map((type.parts||[]).map(p=>[p.id,p]));
  const modernDamage=typeof plane.damage?.gone==='function';
  const hasFigure=plane.pilotNode?.children?.some(n=>/^aircraft_pilot(?:_|$)/.test(n.name)&&n.mesh);
  const keepCockpit=!!(preserveCockpit&&(plane.detailCockpit||hasFigure||plane.pilotNode&&plane.pilotNode!==plane.cockpit));
  const noWingTanks=new Set(['bf109g','fw190a8','me262','spitfire9']);
  const split=Number.isFinite(type._hitbox?.split)?type._hitbox.split:Number.isFinite(plane.hitbox?.split)?plane.hitbox.split:Infinity;
  const wingOwner=(side,x=0)=>{const inner=`wing_${side<0?'l':'r'}`,outer=inner+'_out';return Math.abs(x)>split&&byId.has(outer)?outer:inner;};
  const preservedNodes=[];
  const preserve=(node,id,role)=>{
    if(!node)return;
    const data=node.mesh?._src?.data;
    if(data instanceof Float32Array&&data.length%39===0&&data.length){
      parts.push({id,node,data,role,owner:null,instanceId:`${type.id}/preserved/${node.name}`,stride:13,preserved:true});
      preservedNodes.push(node);
    }
    for(const child of node.children||[])preserve(child,id,role);
  };
  const preservePilot=()=>{if(plane.pilotNode===plane.cockpit){for(const n of plane.pilotNode?.children||[])if(/^aircraft_pilot(?:_|$)/.test(n.name))preserve(n,'pilot','crew');}else preserve(plane.pilotNode,'pilot','crew');};
  const uploadPart=(id,instanceId,role,owner,data)=>{
    if(!data.length)return null;
    if(mechanismFit)data=mechanismFit.fit(type.id,type.model,data,{id,instanceId,role,owner});
    if(data.some(v=>!Number.isFinite(v)))throw Error(`Nonfinite interior geometry ${type.id}/${instanceId}`);
    const displayOnly=instanceId.startsWith('deep_'),generatedFuel=role==='fuel'&&!displayOnly&&!type.model?.parts?.some(p=>p.group==='internal');
    const renderData=generatedFuel?inspectFuel(data):data;
    const node=root.add(new Node(`interior_${instanceId}`));node.kind=3;node.castShadow=false;
    node.mesh=renderer.mesh(data);plane.meshes.push(node.mesh);node.hitboxDisabled=displayOnly;
    node.interiorPartId=id;node.interiorRole=role;node.interiorOwner=owner||null;
    const part={id,node,data,renderData,role,owner:owner||null,instanceId:`${type.id}/interior/${instanceId}`,stride:13,displayOnly,inspectionCutaway:generatedFuel&&renderData.length<data.length};
    if(part.inspectionCutaway){
      // Keep the exact full uploaded contact mesh on the original node. A
      // display child supplies the cutaway and is explicitly nonphysical.
      node.aircraftHiddenSkin=true;
      const display=node.add(new Node(`interior_inspection_${instanceId}`));display.kind=3;display.castShadow=false;display.hitboxDisabled=true;
      display.mesh=renderer.mesh(renderData);plane.meshes.push(display.mesh);part.renderNode=display;
    }
    if(displayOnly)part.enabled=false;
    parts.push(part);nodes.push(node);return part;
  };
  // Generated frameworks were approximate cages and were hidden anyway. Do
  // not allocate/tessellate them: keep that budget for visible mechanisms.
  const module=(id,instanceId,role,owner,fn)=>{if(role==='structure')return null;const b=new Mesh();fn(b);return uploadPart(id,instanceId,role,owner,b.data);};
  const authored=sourceInterior(plane,byId);
  if(authored){
    for(const batch of authored){const part=uploadPart(batch.id,batch.instanceId,batch.role,batch.owner,batch.data);part.sourceNames=batch.sourceNames;}
    if(keepCockpit)preservePilot();
    const canopy=type.canopy||[[0,.7,1],[.3,.35,.8]],c=canopy[0],h=canopy[1];
    if(!byId.has('gun')&&parts.some(p=>p.id==='gun'))additionalDamageParts.push({id:'gun',name:'武器机构',c:[0,c[1]-.5,c[2]+.5],h:[.4,.3,.8],hp:50,color:'#a76ac0',fire:0});
    if(!byId.has('avionics')&&parts.some(p=>p.id==='avionics'))additionalDamageParts.push({id:'avionics',name:'仪表与机载设备',c:[0,c[1]-.2,c[2]+h[2]*.6],h:[h[0],.24,.5],hp:35,color:'#4e9dda',fire:0});
    return finishInterior(plane,{root,nodes,parts,additionalDamageParts,preservedNodes,keepCockpit,preservesAuthoredInternal:true,modernDamage});
  }
  const def=id=>byId.get(id);
  const jet=type.sound==='jet'||!!sp?.jet;
  const engine=def('engine')||originalParts.get('engine')||{c:[0,0,jet?-2:2],h:[.5,.5,1.5]};
  const fittedEngine=engineLayout?.build(type.id,type.model,{palette:'green'});
  if(fittedEngine){
    // Two render engines may share the existing single engine HP record.
    // Geometry repair never creates or renames accepted damage parts.
    for(const m of fittedEngine.modules){
      const sideId=`engine_${m.side<0?'l':'r'}`;
      const id=m.side&&byId.has(sideId)?sideId:'engine';
      uploadPart(id,m.instanceId,'engine',def(id)?.parent||null,m.data);
    }
  }else if(jet){
    const pods=sp?.jet?.pods;
    if(pods?.length){
      for(const pod of pods)for(const side of [-1,1]){
        const [x,y,front,rear,r]=pod;
        module(byId.has(`engine_${side<0?'l':'r'}`)?`engine_${side<0?'l':'r'}`:'engine',`engine_${side<0?'l':'r'}`,'engine',def(`engine_${side<0?'l':'r'}`)?.parent||(side<0?'wing_l':'wing_r'),b=>turbojet(b,[side*x,y,(front+rear)/2],r*.88,(front-rear)*.94,{early:true}));
      }
    }else if(byId.has('engine_l')||byId.has('engine_r')){
      for(const side of [-1,1]){
        const id=`engine_${side<0?'l':'r'}`,eng=def(id);if(!eng)continue;
        const nac=sp?.nacelles?.[0],profile=nac?.profile;
        const c=nac?[side*Math.abs(nac.x),nac.y,eng.c[2]]:eng.c;
        const r=nac?Math.min(Math.max(...profile.map(p=>Math.min(p[1],p[2])))*.85,eng.h[1]*.92):Math.min(eng.h[0],eng.h[1])*.9;
        const L=Math.min(eng.h[2]*1.88,6.2);
        module(id,id,'engine',eng.parent||null,b=>{
          turbojet(b,c,r,L,{early:true,afterburner:(type.airframe?.[13]||0)>.1});
          const rear=c[2]-L*.5,nozzle=nac?.nozzle?.z;
          if(Number.isFinite(nozzle)&&nozzle<rear-.1)b.tube([c[0],c[1],rear],[c[0],c[1],nozzle+.06],r*.7,(nac.nozzle.r||r*.7)*.88,C.engineDark,18,.02,true);
        });
      }
    }else module('engine','engine','engine',null,b=>{
      const r=Math.min(engine.h[0],engine.h[1])*.92,L=engine.h[2]*1.88;
      turbojet(b,engine.c,r,L,{centrifugal:/mig15|mig17/.test(type.id),afterburner:(type.airframe?.[13]||0)>.1,compressorStages:type.id==='f104g'?17:type.id==='f86f'?12:0});
      const rear=engine.c[2]-L*.5,nozzle=sp?.jet?.nozzle;
      if(Number.isFinite(nozzle)&&nozzle<rear-.1){
        b.tube([engine.c[0],engine.c[1],rear],[0,sp.fuseY||0,nozzle+.06],r*.68,(sp.jet.r||r*.7)*.88,C.engineDark,20,.018,true);
        for(const t of [.25,.75])b.ring([0,sp.fuseY||0,rear+(nozzle-rear)*t],r*.64,.04,C.engineLight,18,.02);
      }
    });
  }else module('engine','engine','engine',null,b=>pistonEngine(b,engine.c,engine.h,/fw190|a6m|f4u/.test(type.id)||/radial|BMW|Sakae|Double Wasp/i.test(f?.engineText||''),/fw190|a6m/.test(type.id)?7:9));
  const fuel=def('fuel');
  const wingEnvelopeFuel=!!(fuel&&sp?.wing&&fuel.h[0]>Math.max(...sp.fuselage.map(s=>s[1]))*1.5&&fuel.h[1]<.18);
  if(fuel&&!wingEnvelopeFuel)module('fuel','fuel_fuselage','fuel',null,b=>{
    const n=fuel.h[2]>1?3:2;
    for(let i=0;i<n;i++){
      const z=fuel.c[2]+((i+.5)/n*2-1)*fuel.h[2]*.92;
      const h=[fuel.h[0]*.9,Math.min(fuel.h[1]*.82,.46),fuel.h[2]/n*.88];
      roundedTank(b,[fuel.c[0],fuel.c[1]-.035,z],h);
    }
    b.path([[fuel.c[0]+fuel.h[0]*.78,fuel.c[1]+fuel.h[1]*.6,fuel.c[2]+fuel.h[2]*.6],[fuel.c[0]+fuel.h[0]*.8,fuel.c[1]+fuel.h[1]*.6,fuel.c[2]-fuel.h[2]*.6],add(engine.c,[0,Math.min(engine.h[1]*.8,.3),engine.h[2]*.6])],.018,C.fuelDark,5);
  });
  if(sp?.wing){
    const inner=sp.wing[0][0]+.12,outer=Math.min(sp.wing[sp.wing.length-1][0]*.72,split-.06);
    for(const side of [-1,1]){
      const owner=side<0?'wing_l':'wing_r';
      if(!noWingTanks.has(type.id)&&outer>inner)module(byId.has(`fuel_${side<0?'l':'r'}`)?`fuel_${side<0?'l':'r'}`:'fuel',`fuel_${owner}`,'fuel',owner,b=>{
        for(let i=0;i<3;i++){const x0=inner+(outer-inner)*i/3+.025,x1=inner+(outer-inner)*(i+1)/3-.025;if(x1>x0)wingTank(b,sp,x0,x1,side);}
        b.path([wingPoint(sp,inner,.43,side,.018),wingPoint(sp,outer,.43,side,.018)],.018,C.fuelDark,6);
      });
      const tip=sp.wing[sp.wing.length-1][0]*.96;
      const ranges=byId.has(owner+'_out')&&split>inner&&split<tip?[[inner,split-.012,owner],[split+.012,tip,owner+'_out']]:[[inner,tip,owner]];
      for(const [from,to,carrier] of ranges)module(carrier,`structure_${carrier}`,'structure',carrier,b=>{
        for(const frac of [.18,.7]){
          const p=[wingPoint(sp,from,frac,side,0),...sp.wing.filter(s=>s[0]>from&&s[0]<to).map(s=>wingPoint(sp,s[0],frac,side,s[4]*.18)),wingPoint(sp,to,frac,side,0)];
          b.path(p,.022,C.frameDark,6);
        }
        for(let j=0;j<7;j++){
          const x=from+(to-from)*j/6,s=wingSection(sp,x),h=s[4]*.7;
          b.line(wingPoint(sp,x,.12,side,h),wingPoint(sp,x,.82,side,h),.013,C.frame,5);
          if(j%2===0)b.line(wingPoint(sp,x,.16,side,-h),wingPoint(sp,x,.77,side,h),.011,C.frameDark,5);
        }
        b.path([wingPoint(sp,from,.74,side,-.01),wingPoint(sp,to,.74,side,-.01)],.009,C.gunDark,5);
      });
    }
  }
  const canopy=type.canopy||[[0,.7,1],[.3,.35,.8]];
  if(keepCockpit)preservePilot();
  else module('pilot','pilot','crew',null,b=>pilotAndSeat(b,canopy));
  const muzzles=sp?.muzzles||[[-.32,.4,3.2,.3,.04],[.32,.4,3.2,.3,.04]];
  const ammo=def('ammo')||{c:[0,-.2,2],h:[.35,.2,.45]};
  for(let i=0;i<muzzles.length;i++){
    const m=muzzles[i],tag=sp?.attachmentOwners?.muzzles?.[i],owner=tag&&tag!=='body'?wingOwner(m[0]<0?-1:1,m[0]):null;
    const receiver=[m[0],m[1],m[2]-.62],wing=!!owner,caliber=clamp((m[4]||.035)*1.3,.035,.085);
    module('gun',`gun_${i}`,'weapon',owner,b=>{
      b.box(add(receiver,[0,0,-.12]),[caliber*2.1,caliber*2.15,.58],C.gunDark);
      b.tube(add(receiver,[0,0,.12]),[m[0],m[1],m[2]+(m[3]||.15)],caliber*.5,caliber*.4,C.gun,12,.009,true);
      for(let j=0;j<5;j++)b.ring(add(receiver,[0,0,.08+j*.08]),caliber*.62,.025,C.gunLight,10,.012);
      b.line(add(receiver,[-caliber,caliber,-.3]),add(receiver,[-caliber,caliber,.1]),.012,C.gunLight,5);
    });
    const ac=wing?add(receiver,[Math.sign(m[0])*.21,.005,-.43]):[ammo.c[0]+(i-(muzzles.length-1)/2)*Math.min(.2,ammo.h[0]*1.4/muzzles.length),ammo.c[1],ammo.c[2]-.1*(i%2)];
    module('ammo',`ammo_${i}`,'ammunition',owner,b=>{
      const size=wing?[.25,.15,.42]:[Math.min(.32,ammo.h[0]*1.7/Math.max(2,muzzles.length/2)),Math.min(.3,ammo.h[1]*1.6),.45];
      b.box(ac,size,C.gun);b.box(add(ac,[0,size[1]*.5+.014,0]),[size[0]*1.04,.028,size[2]*1.03],C.gunLight);
      for(const zz of [-.13,.13])b.box(add(ac,[0,0,zz]),[size[0]*1.035,size[1]*1.04,.018],C.gunDark);
      ammoFeed(b,add(ac,[Math.sign(m[0]||1)*size[0]*.5,size[1]*.35,0]),add(receiver,[caliber,.025,-.1]),wing?.8:1);
    });
  }
  if(!byId.has('gun'))additionalDamageParts.push({id:'gun',name:'武器机构',c:ammo.c.slice(),h:[Math.max(.25,ammo.h[0]),.25,Math.max(.5,ammo.h[2])],hp:50,color:'#a76ac0',fire:0});
  // A radar-like antenna is only used for the radar-equipped supersonic jet;
  // early nose-intake aircraft retain a genuinely open central intake passage.
  const cp=canopy[0],ch=canopy[1],avCenter=[0,cp[1]-.26,cp[2]+ch[2]*.66];
  if(!keepCockpit)module('avionics','cockpit_instruments','avionics',null,b=>{
    b.box(avCenter,[ch[0]*1.55,.31,.055],C.avionicsDark);
    for(let j=0;j<2;j++)for(let i=0;i<4;i++){
      const p=add(avCenter,[(i-1.5)*ch[0]*.36,(j-.5)*.12,-.04]);
      b.tube(add(p,[0,0,-.01]),add(p,[0,0,-.035]),.037,.037,C.avionicsLight,12,.008,true);
      b.line(add(p,[-.016,0,-.038]),add(p,[.008,.018,-.038]),.004,C.black,4);
    }
    for(const side of [-1,1]){
      b.box([side*ch[0]*.79,cp[1]-.26,cp[2]],[.09,.15,ch[2]*1.1],C.avionicsDark);
      for(let i=0;i<7;i++)b.box([side*ch[0]*.8,cp[1]-.17,cp[2]-ch[2]*.45+i*ch[2]*.14],[.03,.03,.027],i%2?C.avionicsLight:C.frame);
    }
  });
  if(jet&&sp){
    const zMax=sp.fuselage[sp.fuselage.length-1][0],noseIntake=!!sp.jet?.intake;
    const z= noseIntake?cp[2]+ch[2]*.93:Math.min(zMax-.6,cp[2]+ch[2]*1.65);
    module(byId.has('radar')?'radar':'avionics','nose_equipment','avionics',null,b=>{
      const [rx,ry]=fuselageProfile(sp,z),center=[0,(sp.fuseY||0)+ry*.12,z];
      if(type.id==='f104g'||type.id==='mirage3e'){
        const rr=Math.min(rx,ry)*.7;b.tube(add(center,[0,0,-.2]),center,rr*.3,rr*.32,C.avionicsDark,14,0,true);
        b.tube(add(center,[0,0,.18]),add(center,[0,0,.23]),rr,rr*.93,C.avionics,24,.025,true);
        for(let k=0;k<6;k++){const a=k/6*2*PI;b.line(center,add(center,[Math.cos(a)*rr*.85,Math.sin(a)*rr*.85,.18]),.012,C.avionicsLight,5);}
      }
      for(const side of [-1,1]){
        const x=side*rx*(noseIntake?.65:.42),y=noseIntake?ry*.45:-ry*.12;
        const cc=[x,y+(sp.fuseY||0),z-.25];b.box(cc,[rx*.4,ry*.4,.46],C.avionics);
        for(let j=0;j<6;j++)b.box(add(cc,[0,ry*.22,-.2+j*.07]),[rx*.42,.018,.025],C.avionicsLight);
        b.path([add(cc,[0,-ry*.15,-.25]),[side*ch[0]*.82,cp[1]-.4,cp[2]+ch[2]*.8],[side*ch[0]*.8,cp[1]-.36,cp[2]]],.012,C.avionicsDark,5);
      }
    });
  }
  additionalDamageParts.push({id:'avionics',name:'仪表与机载设备',c:avCenter,h:[ch[0],.24,Math.max(.3,ch[2]*.6)],hp:35,color:'#4e9dda',fire:0});
  if(sp){
    const zMin=sp.fuselage[0][0],zMax=sp.fuselage[sp.fuselage.length-1][0];
    for(const aft of [false,true])module(aft?'tail':'fuselage',aft?'tail_frames':'fuselage_frames','structure',aft?'tail':null,b=>{
      const tailEnd=Math.min(cp[2]-ch[2]*1.4,-1.2),lo=aft?zMin+.25:tailEnd,hi=aft?tailEnd:zMax-.35;
      const count=Math.max(4,Math.ceil((hi-lo)/(byId.has('engine_l') ? 0.82 : 0.65)));
      for(let j=0;j<count;j++){
        const z=lo+(hi-lo)*j/(count-1),[rx,ry]=fuselageProfile(sp,z);if(rx<.09||ry<.1)continue;
        const points=[];for(let k=0;k<=16;k++){const a=k/16*2*PI;points.push([Math.cos(a)*rx*.87,(sp.fuseY||0)+Math.sin(a)*ry*.87,z]);}
        b.path(points,.009,C.frame,5);
      }
      for(let k=0;k<4;k++){
        const a=k/4*2*PI+PI/4,points=[];for(let j=0;j<count;j++){const z=lo+(hi-lo)*j/(count-1),[rx,ry]=fuselageProfile(sp,z);points.push([Math.cos(a)*rx*.85,(sp.fuseY||0)+Math.sin(a)*ry*.85,z]);}
        b.path(points,.012,C.frameDark,5);
      }

    });
    if(!sp.tailless&&sp.htail)for(const side of [-1,1]){
      const owner=byId.has(`htail_${side<0?'l':'r'}`)?`htail_${side<0?'l':'r'}`:'tail';
      module(owner==='tail'?'elevator':owner,`tailplane_spars_${side<0?'l':'r'}`,'structure',owner,b=>{
      const h=sp.htail;
      for(const frac of [.25,.7]){
        const points=h.sections.map(s=>[side*s[0],h.p[1]+s[1],h.p[2]+s[2]-s[3]*frac]);b.path(points,.013,C.frameDark,5);
      }
      b.line([0,.2,Math.min(cp[2]-ch[2]*1.4,-1.2)],h.p,.013,C.frameDark,5);
    });}
    // The old full-length guessed control rod crossed the MiG-21 nozzle and
    // several tail shells. Controls are represented by the local fitted pump
    // and valve mechanisms below; do not draw an invented fuselage-long run.
    const cooling=def('cooling');if(cooling)module('cooling','cooling','cooling',cooling.parent||null,b=>{const c=cooling.c,h=cooling.h;b.box(c,[h[0]*1.8,h[1]*1.75,h[2]*1.75],C.avionicsDark);for(let i=0;i<12;i++)b.box(add(c,[(i/11-.5)*h[0]*1.8,0,h[2]*.9]),[.012,h[1]*1.7,.035],C.avionicsLight);b.path([add(c,[h[0]*.9,0,0]),add(engine.c,[engine.h[0]*.7,-engine.h[1]*.7,0])],.025,C.engineDark,6);});
  }
  if(sp&&!byId.has('fuselage')){
    const z0=sp.fuselage[0][0],z1=sp.fuselage[sp.fuselage.length-1][0];
    additionalDamageParts.push({id:'fuselage',name:'机身框架',c:[0,sp.fuseY||0,(z0+z1)/2],h:[Math.max(...sp.fuselage.map(s=>s[1])),Math.max(...sp.fuselage.map(s=>s[2])),(z1-z0)/2],hp:180,color:'#9ca79b',fire:0});
  }
  // Detail only the generated paths. Authored internals return above unchanged.
  // Every accessory is explicitly excluded from contact/accepted damage data.
  const mechanicalParts=parts.slice(),descriptor=engineLayout?.describe?.(type.id,type.model);
  for(const p of mechanicalParts){
    if(p.role==='fuel'){
      const detail=fuelDetails(p.data);
      if(detail.length)uploadPart(p.id,'deep_'+p.instanceId.split('/').at(-1)+'_pumps','fuel',p.owner,detail);
    }
    if(p.role!=='engine')continue;
    const side=/_l$/.test(p.instanceId)?-1:/_r$/.test(p.instanceId)?1:0;
    const profile=descriptor?.engines?.find(e=>e.side===side)?.core;
    const defn=def(p.id)||engine;
    const point=v=>{
      if(profile?.length){
        const rear=profile[0].p[2],front=profile.at(-1).p[2],z=rear+(front-rear)*(.56+v[2]*.23);
        let i=1;while(i<profile.length&&profile[i].p[2]<z)i++;
        const a=profile[Math.max(0,i-1)],d=profile[Math.min(i,profile.length-1)],t=clamp((z-a.p[2])/(d.p[2]-a.p[2]||1),0,1),c=mix(a.p,d.p,t),r=a.r+(d.r-a.r)*t;
        return [c[0]+v[0]*r*.72,c[1]+v[1]*r*.72,z];
      }
      const r=Math.min(defn.h[0],defn.h[1])*.65,L=Math.min(defn.h[2]*.6,1.1),c=defn.c;
      return [c[0]+v[0]*r,c[1]+v[1]*r,c[2]+v[2]*L];
    };
    const service=new Mesh();engineServices(service);
    uploadPart(p.id,'deep_engine_accessory_'+side,'engine',p.owner,mappedData(service.data,point));
    const hydraulics=new Mesh();hydraulicServices(hydraulics);
    uploadPart(byId.has('controls')?'controls':p.id,'deep_hydraulic_manifold_'+side,'control',p.owner,mappedData(hydraulics.data,point));
  }
  const result=finishInterior(plane,{root,nodes,parts,additionalDamageParts,preservedNodes,keepCockpit,modernDamage});
  result.generatedMechanisms=true;result.inspectionCutaways=parts.filter(p=>p.inspectionCutaway).length;
  result.serviceModules=parts.filter(p=>p.displayOnly).length;
  result.radialCylinders=/fw190|a6m/.test(type.id)?14:/f4u/.test(type.id)?18:0;
  result.wingEnvelopeFuel=wingEnvelopeFuel;
  return result;
}

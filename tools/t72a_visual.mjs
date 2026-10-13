// Reproducible first-party exterior authoring, metres, +Z forward, +X vehicle-right.
// CLI writes visual.json ONLY. Gameplay vehicle/weapons/armor/modules/crew are inputs,
// never rewritten. Historical scope and approximations: docs/t72a-model-review-2026-10-13.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const q=x=>(+x.toFixed(6))||0, vec=a=>a.map(q);
const box=(name,size,pos,mount='hull',mat='paint',extra={})=>({name,type:'box',mount,mat,size:vec(size),pos:vec(pos),...extra});
const cyl=(name,r,len,pos,axis='y',mount='hull',mat='paint',extra={})=>({name,type:'cyl',mount,mat,r,len,pos:vec(pos),axis,segs:32,...extra});
const mesh=(name,vertices,faces,mount='hull',mat='paint',extra={})=>({name,type:'mesh',mount,mat,vertices:vertices.map(vec),faces,...extra});

/** Sealed material wall around an open bore. Annular end faces, never a black disc. */
function sleeve(name, rings, mount='gun', mat='paint', extra={}) {
  const n=32, verts=[], faces=[];
  // rings are [z, outerX, outerY, innerX, innerY, centreX, centreY].
  for(const ring of rings) for(let side=0;side<2;side++) for(let i=0;i<n;i++) {
    const a=i/n*Math.PI*2, [z,rx,ry,ix,iy,cx=0,cy=1.86]=ring;
    verts.push([cx+Math.cos(a)*(side?ix:rx),cy+Math.sin(a)*(side?iy:ry),z]);
  }
  const v=(j,s,i)=>j*2*n+s*n+(i+n)%n;
  const quad=(a,b,c,d)=>faces.push([a,b,c],[a,c,d]);
  for(let j=0;j<rings.length-1;j++) for(let i=0;i<n;i++) {
    quad(v(j,0,i),v(j,0,i+1),v(j+1,0,i+1),v(j+1,0,i));
    quad(v(j,1,i+1),v(j,1,i),v(j+1,1,i),v(j+1,1,i+1));
  }
  for(let i=0;i<n;i++) {
    quad(v(0,0,i+1),v(0,0,i),v(0,1,i),v(0,1,i+1));
    const j=rings.length-1;
    quad(v(j,0,i),v(j,0,i+1),v(j,1,i+1),v(j,1,i));
  }
  return mesh(name,verts,faces,mount,mat,extra);
}

/** Closed casting material with open ring access and a real gun aperture.
 * Eight deliberately authored sections; no third-party vertices or traced art.
 */
function casting() {
  const sections=[
    [1.505,1.067,1.067,1.067,0],
    [1.555,1.29,1.41,1.32,.30],
    [1.65,1.385,1.50,1.43,.31],
    [1.79,1.36,1.43,1.37,.30],
    [1.925,1.30,1.31,1.23,.28],
    [2.03,1.20,1.16,1.08,.24],
    [2.095,1.07,1.00,.98,.14],
    [2.11,1.01,.91,.91,.04],
  ];
  const n=48, vertices=[], faces=[], groups=[], outer=[];
  for(const [y,rx,front,back,notch] of sections) for(let i=0;i<n;i++) {
    const a=i/n*Math.PI*2, c=Math.cos(a), s=Math.sin(a), aa=Math.atan2(s,c);
    vertices.push([rx*s*(1+.024*Math.max(c,0)), y,
      .18+c*(c>=0?front:back)-notch*Math.exp(-Math.pow(aa/.225,2))]);
  }
  const count=vertices.length;
  for(let j=0;j<sections.length;j++) for(let i=0;i<n;i++) {
    const p=vertices[j*n+i];
    vertices.push([p[0]*(j===0?.9:.81), j===0?1.505:1.505+(p[1]-1.505)*.88, .18+(p[2]-.18)*.77]);
  }
  const tri=(f,g)=>{faces.push(f);groups.push(g);};
  const quad=(a,b,c,d,g)=>{tri([a,b,c],g);tri([a,c,d],g);};
  for(let j=0;j<sections.length-1;j++) for(let i=0;i<n;i++) {
    // Aperture is bounded by the +/-15 degree radial stations and two shoulder rows.
    if(j>=1&&j<6&&(i<2||i>=n-2)) continue;
    const a=j*n+i,b=j*n+(i+1)%n,c=(j+1)*n+(i+1)%n,d=(j+1)*n+i;
    outer.push([a,b,c],[a,c,d]);
  }
  for(const f of outer) tri(f,1);
  for(const f of outer) tri(f.map(v=>v+count).toReversed(),2);
  // Flat outer roof and its inner ceiling. Caps are convex fan boundaries.
  const top=(sections.length-1)*n, oc=vertices.length;
  vertices.push([0,2.11,.18]); const ic=vertices.length; vertices.push([0,1.505+(.605)*.88,.18]);
  for(let i=0;i<n;i++) {tri([oc,top+i,top+(i+1)%n],0);tri([ic,top+(i+1)%n+count,top+i+count],0);}
  // The remaining boundary edges form the aperture reveals and the bearing annulus.
  const edges=new Map();
  for(const f of outer) for(let i=0;i<3;i++) {
    const a=f[i],b=f[(i+1)%3],key=[a,b].sort((a,b)=>a-b).join(':');
    if(edges.has(key)) edges.delete(key); else edges.set(key,[a,b]);
  }
  for(const [a,b] of edges.values()) {
    if(a>=top&&b>=top) continue;
    quad(b,a,a+count,b+count,0);
  }
  return mesh('t72a_cast_turret',vertices,faces,'turret','paint',{t72a_smoothing:groups});
}

/** Thin fixed canvas perimeter overlaps the casting aperture, tapering to the
 * articulating boot. The centre remains open; it is not an armour filler box.
 */
function apertureCanvas(cast) {
  const perimeter=[];
  for(const i of [46,47,0,1,2]) perimeter.push(48+i);
  for(let j=2;j<=6;j++) perimeter.push(j*48+2);
  for(const i of [1,0,47,46]) perimeter.push(6*48+i);
  for(let j=5;j>=2;j--) perimeter.push(j*48+46);
  const n=perimeter.length, vertices=[], faces=[];
  for(const layer of [0,1]) {
    for(const index of perimeter) {
      const [x,y,z]=cast.vertices[index];
      vertices.push([x*1.03,1.86+(y-1.86)*1.04,z+(layer?-.014:-.004)]);
    }
    for(const index of perimeter) {
      const [x,y]=cast.vertices[index], a=Math.atan2(y-1.86,x);
      vertices.push([.22*Math.cos(a),1.86+.145*Math.sin(a),1.385-(layer?.010:0)]);
    }
  }
  const quad=(a,b,c,d)=>faces.push([a,b,c],[a,c,d]);
  for(let i=0;i<n;i++) {
    const j=(i+1)%n;
    quad(i,j,n+j,n+i);quad(2*n+j,2*n+i,3*n+i,3*n+j);
    quad(j,i,2*n+i,2*n+j);quad(n+i,n+j,3*n+j,3*n+i);
  }
  return mesh('t72a_mantlet_fixed_canvas',vertices,faces,'turret','canvas');
}

/** Small, readable fabrication details. Sizes/locations are authored estimates,
 * not surveyed factory data. No ERA, added weapons, decals or copied artwork. */
function appendDetails(parts) {
  const add=p=>parts.push(p);
  const tube=(name,points,r=.012,mount='hull',mat='paint_dark',closed=false)=>{
    const vertices=[],faces=[],sides=8;
    for(let j=0;j<points.length;j++){
      const before=points[(j+points.length-1)%points.length],after=points[(j+1)%points.length];
      const d=closed?after.map((v,k)=>v-before[k]):j===0?after.map((v,k)=>v-points[j][k]):j===points.length-1?points[j].map((v,k)=>v-before[k]):after.map((v,k)=>v-before[k]);
      const length=Math.hypot(...d),t=d.map(v=>v/length),u=Math.abs(t[1])<.9?[t[2],0,-t[0]]:[0,-t[2],t[1]],ul=Math.hypot(...u);
      for(let k=0;k<3;k++)u[k]/=ul;
      const v=[t[1]*u[2]-t[2]*u[1],t[2]*u[0]-t[0]*u[2],t[0]*u[1]-t[1]*u[0]];
      for(let k=0;k<sides;k++){const a=k/sides*2*Math.PI;vertices.push(points[j].map((x,i)=>x+r*(u[i]*Math.cos(a)+v[i]*Math.sin(a))));}
    }
    const runs=closed?points.length:points.length-1;
    for(let j=0;j<runs;j++)for(let k=0;k<sides;k++){
      const a=j*sides+k,b=j*sides+(k+1)%sides,c=((j+1)%points.length)*sides+(k+1)%sides,d=((j+1)%points.length)*sides+k;
      faces.push([a,b,c],[a,c,d]);
    }
    if(!closed)for(const end of [0,points.length-1]){
      const center=vertices.length;vertices.push(points[end]);
      for(let k=0;k<sides;k++){const a=end*sides+k,b=end*sides+(k+1)%sides;faces.push(end===0?[center,b,a]:[center,a,b]);}
    }
    return mesh(name,vertices,faces,mount,mat);
  };
  for(const sign of [-1,1]){
    const side=sign<0?'l':'r',x=sign*.91;
    // Two headlamps with open cage bars: the cage has real air between the bars.
    add(box(`t72a_lamp_foot_${side}`,[.19,.16,.16],[x,1.22,2.63]));
    add(cyl(`t72a_headlamp_${side}`,.093,.12,[x,1.325,2.69],'z','hull','paint_dark',{segs:24}));
    add(cyl(`t72a_headlamp_lens_${side}`,.082,.008,[x,1.325,2.754],'z','hull',sign<0?'lamp':'glass',{segs:24}));
    add(sleeve(`t72a_headlamp_rim_${side}`,[[2.747,.096,.096,.083,.083,x,1.325],[2.763,.096,.096,.083,.083,x,1.325]],'hull','paint'));
    const cage=[[-.14,1.18],[-.14,1.405],[-.105,1.475],[.105,1.475],[.14,1.405],[.14,1.18]].map(([dx,y])=>[x+dx,y,2.82]);
    add(tube(`t72a_lamp_guard_${side}`,cage,.013));
    for(const dx of [-.14,.14])add(tube(`t72a_lamp_guard_stay_${side}_${dx}`,[[x+dx,1.20,2.82],[x+dx,1.25,2.48]],.013));
    // Tow eyes at front and rear, with through holes. Not solid capped cylinders.
    for(const [end,z,y]of [['front',3.355,.738],['rear',-3.49,.49]]){
      add(box(`t72a_tow_pad_${end}_${side}`,[.15,.13,.16],[sign*.92,y,z+(end==='front'?-.075:.065)],'hull','paint'));
      const eye=sleeve(`t72a_tow_eye_${end}_${side}`,[[-.028,.092,.092,.05,.05,0,0],[.028,.092,.092,.05,.05,0,0]],'hull','steel');
      eye.vertices=eye.vertices.map(([a,b,c])=>vec([sign*.92+c,y+b,z+a]));add(eye);
    }
    // Stowage latches: broad enough to read, no field of decorative micro-bolts.
    for(const [i,z]of [[0,1.43],[1,.16],[2,-1.22]]){
      add(box(`t72a_stowage_latch_${side}_${i}`,[.024,.09,.065],[sign*1.74,1.445,z] ,'hull','steel'));
      add(box(`t72a_stowage_hinge_${side}_${i}`,[.19,.025,.042],[sign*1.48,1.508,z+.37],'hull','paint_dark'));
    }
    // Drum reinforcing rolls and a restrained filler cap; no fake fuel physics.
    for(const j of [-1,1]){
      const xx=sign*.575+j*.497;
      const roll=sleeve(`t72a_drum_end_roll_${side}_${j}`,[[xx-.012,.282,.282,.271,.271,0,0],[xx+.012,.282,.282,.271,.271,0,0]],'hull','paint');
      roll.vertices=roll.vertices.map(([a,b,c])=>vec([c,b+.98,-a-3.635]));add(roll);
    }
    add(cyl(`t72a_drum_fill_cap_${side}`,.043,.025,[sign*.575,1.26,-3.635],'y','hull','paint_dark',{segs:12}));
    // Front mudguard hinge and two large rubber-panel fastener straps.
    add(cyl(`t72a_mudguard_hinge_${side}`,.021,.55,[sign*1.445,1.241,3.15],'x','hull','paint_dark',{segs:12}));
    for(const z of [2.72,-2.8])add(box(`t72a_skirt_end_strap_${side}_${z}`,[.044,.17,.06],[sign*1.80,1.157,z],'hull','paint_dark'));
  }
  // Rear fan access cover and restrained fastening bosses, partly occluded by drums.
  add(cyl('t72a_rear_fan_cover',.30,.035,[0,.95,-3.445],'z','hull','paint_dark',{segs:24}));
  for(let i=0;i<5;i++){
    const a=(i+.25)/5*2*Math.PI;
    add(cyl(`t72a_rear_fan_bolt_${i}`,.018,.018,[Math.cos(a)*.263,.95+Math.sin(a)*.263,-3.47],'z','hull','steel',{segs:6}));
  }
  // Deck bracing and rear access catches, not another grille blocking the original slots.
  for(const x of [-.62,.62])add(box(`t72a_engine_grille_brace_${x}`,[.026,.018,1.035],[x,1.509,-2.56],'hull','paint_dark'));
  for(const x of [-.53,.53])add(box(`t72a_rear_access_catch_${x}`,[.07,.035,.10],[x,1.466,-3.05],'hull','steel'));
  // Lift eyes sit on the casting shoulder. Small bases make the attachment legible.
  for(const sign of [-1,1]){
    const side=sign<0?'l':'r',x=sign*.95,z=.53;
    add(box(`t72a_turret_lift_base_${side}`,[.10,.060,.13],[x,2.054,z],'turret','paint'));
    const ring=sleeve(`t72a_turret_lift_eye_${side}`,[[-.019,.066,.066,.035,.035,0,0],[.019,.066,.066,.035,.035,0,0]],'turret','paint_dark');
    ring.vertices=ring.vertices.map(([a,b,c])=>vec([x+c,2.112+b,z+a]));add(ring);
  }
  // Metal clamp latches belong to the recoiling barrel, not the fixed turret shell.
  for(const [i,z,r]of [[0,2.15,.116],[1,3.13,.116],[2,3.96,.116],[3,4.78,.111],[4,5.60,.111]])
    add(box(`t72a_thermal_clamp_latch_${i}`,[.036,.018,.055],[0,1.86+r,z],'gun','steel',{recoil:true}));
}

export function refineT72aVisual(original) {
  const v=structuredClone(original), parts=[], add=p=>{parts.push(p);return p;};
  const upperStart=3.43-.68*Math.tan(68*Math.PI/180);
  const lowerEnd=3.43-.42*Math.tan(60*Math.PI/180);
  add({name:'t72a_welded_hull',type:'prism',mount:'hull',mat:'paint',w:2.28,
    profile:[[-3.43,.4],[-3.43,1.40],[-1.55,1.50],[q(upperStart),1.50],[3.43,.82],[q(lowerEnd),.4]]});
  // Sponsons bridge the narrow lower hull and fenders; they also support the seat.
  for(const sign of [-1,1]) add({name:`t72a_sponson_${sign<0?'l':'r'}`,type:'prism',mount:'hull',mat:'paint',w:.46,x:sign*1.335,
    profile:[[-3.22,1.20],[-3.22,1.395],[-1.50,1.495],[1.55,1.495],[2.78,1.01],[2.69,.97],[1.43,1.21]]});
  add(box('t72a_fender',[.655,.045,6.12],[1.4475,1.233,-.15],'hull','paint',{mirror:true}));
  for(const sign of [-1,1]) {
    const side=sign<0?'l':'r';
    // Shallow, joined front mudguard, not a free-floating vertical slab.
    add({name:`t72a_front_fender_${side}`,type:'prism',mount:'hull',mat:'paint',w:.68,x:sign*1.44,
      profile:[[2.77,1.235],[3.20,1.22],[3.45,.90],[3.405,.89],[3.17,1.175],[2.77,1.19]]});
    for(let i=0;i<5;i++) add(box(`t72a_rubber_skirt_${side}_${i}`,[.032,.48,1.11],[sign*1.782,.972,2.24-i*1.14],'hull','rubber'));
    add(box(`t72a_skirt_rail_${side}`,[.048,.072,5.72],[sign*1.76,1.23,-.07]));
    for(const [i,z,len] of [[0,1.43,1.10],[1,.16,1.37],[2,-1.22,1.24]]) {
      add(box(`t72a_fender_stowage_${side}_${i}`,[.49,.24,len],[sign*1.485,1.372,z]));
      add(box(`t72a_fender_stowage_lid_${side}_${i}`,[.505,.022,len+.016],[sign*1.485,1.495,z],'hull','paint_dark'));
    }
  }
  add(box('t72a_engine_grille',[1.84,.023,1.08],[0,1.452,-2.55],'hull','paint_dark'));
  for(let i=0;i<7;i++) add(box(`t72a_engine_louvre_${i}`,[1.71,.037,.077],[0,1.483,-2.08-i*.143]));
  add(box('t72a_rear_access_cover',[1.50,.035,.38],[0,1.432,-3.12]));
  // Driver's small raised hatch pad is blended into the inclined front, not left at old deck height.
  add({name:'t72a_driver_hatch_pad',type:'prism',mount:'hull',mat:'paint',w:.65,
    profile:[[1.48,1.42],[1.48,1.50],[2.32,1.37],[2.33,1.245]]});
  add(box('t72a_driver_hatch',[.57,.048,.58],[0,1.450,1.985],'hull','paint',{rot:[8.8,0,0]}));
  add(box('t72a_driver_periscope',[.25,.076,.10],[0,1.438,2.20],'hull','paint_dark',{rot:[8.8,0,0]}));
  add(box('t72a_driver_glass',[.19,.035,.014],[0,1.455,2.248],'hull','glass',{rot:[8.8,0,0]}));
  const seat=sleeve('t72a_turret_ring',[[1.455,1.08,1.08,.94,.94,0,0],[1.51,1.08,1.08,.94,.94,0,0]],'hull','paint_dark');
  seat.vertices=seat.vertices.map(([x,y,z])=>vec([x,z,.18-y])); add(seat);
  const cast=casting();add(cast);add(apertureCanvas(cast));
  add(cyl('t72a_commander_coaming',.322,.145,[.68,2.0825,-.15],'y','turret','paint_dark'));
  add(cyl('t72a_commander_hatch',.302,.042,[.68,2.176,-.15],'y','turret'));
  add(cyl('t72a_gunner_coaming',.32,.097,[-.62,2.0815,-.17],'y','turret','paint_dark'));
  add(cyl('t72a_gunner_hatch',.300,.045,[-.62,2.1525,-.17],'y','turret'));
  for(const [side,x,z,y] of [['commander',.68,-.15,2.19],['gunner',-.62,-.17,2.17]]) {
    add(cyl(`t72a_${side}_hinge`,.032,.18,[x,y,z+.267],'x','turret','steel',{segs:16}));
    add(box(`t72a_${side}_handle`,[.13,.025,.027],[x,y+.031,z-.10],'turret','paint_dark'));
    for(const sx of [-.052,.052]) add(box(`t72a_${side}_handle_foot_${sx}`,[.022,.047,.027],[x+sx,y+.009,z-.10],'turret','paint_dark'));
  }
  add(box('t72a_tpd_k1_head',[.28,.17,.34],[-.51,2.155,.71],'turret','paint_dark'));
  add(box('t72a_tpd_k1_glass',[.177,.069,.012],[-.51,2.172,.886],'turret','glass'));
  add(box('t72a_tpd_k1_hood',[.305,.023,.135],[-.51,2.246,.83],'turret'));
  add(box('t72a_commander_view_head',[.16,.13,.14],[.68,2.215,.078],'turret','paint_dark'));
  add(box('t72a_commander_view_glass',[.114,.057,.013],[.68,2.244,.154],'turret','glass'));
  add(box('t72a_ir_bracket',[.115,.22,.32],[.74,1.866,1.386],'turret','paint_dark'));
  add(cyl('t72a_ir_searchlight',.18,.17,[.74,1.987,1.50],'z','turret','paint_dark'));
  add(cyl('t72a_ir_lens',.155,.008,[.74,1.987,1.589],'z','turret','glass'));
  add(cyl('t72a_ir_rim',.184,.013,[.74,1.987,1.581],'z','turret','steel'));
  // The rim is an annulus, not an opaque cylinder over the lens.
  parts.pop();add(sleeve('t72a_ir_rim',[[1.577,.184,.184,.158,.158,.74,1.987],[1.591,.184,.184,.158,.158,.74,1.987]],'turret','paint_dark'));
  // Canvas boot around a hollow socket. The whole boot lays about the original trunnion.
  add(sleeve('t72a_mantlet',[[1.12,.31,.23,.110,.110],[1.33,.33,.225,.112,.112],[1.53,.231,.166,.116,.116],[1.72,.150,.140,.119,.119]],'gun','canvas'));
  add(sleeve('t72a_recoil_sleeve',[[1.62,.148,.148,.118,.118],[1.77,.152,.152,.118,.118],[2.08,.137,.137,.112,.112]],'gun','paint_dark'));
  add(cyl('t72a_barrel',.086,4.65,[0,1.86,3.775],'z','gun','steel',{segs:32,recoil:true}));
  add(cyl('t72a_thermal_cover',.111,2.125,[0,1.86,3.0975],'z','gun','paint',{segs:32,recoil:true}));
  add(cyl('t72a_bore_evacuator',.154,.46,[0,1.86,4.41],'z','gun','paint',{segs:32,recoil:true}));
  add(cyl('t72a_evacuator_rear_taper',.111,.07,[0,1.86,4.185],'z','gun','paint',{r2:.154,segs:32,recoil:true}));
  add(cyl('t72a_evacuator_front_taper',.154,.085,[0,1.86,4.6525],'z','gun','paint',{r2:.105,segs:32,recoil:true}));
  add(cyl('t72a_thermal_forward',.105,1.065,[0,1.86,5.1975],'z','gun','paint',{segs:32,recoil:true}));
  for(const [i,z,r] of [[0,2.15,.116],[1,3.13,.116],[2,3.96,.116],[3,4.78,.111],[4,5.60,.111]])
    add(cyl(`t72a_thermal_clamp_${i}`,r,.028,[0,1.86,z],'z','gun','paint_dark',{segs:32,recoil:true}));
  add(cyl('t72a_muzzle_collar',.094,.115,[0,1.86,6.0425],'z','gun','steel',{segs:32,recoil:true}));
  // The coax runtime's position_m IS its muzzle, not an extra 1m barrel origin.
  add(sleeve('t72a_pkt_port',[[1.25,.047,.047,.020,.020,.27,1.86],[1.565,.036,.036,.020,.020,.27,1.86]],'gun','paint_dark'));
  add(sleeve('t72a_pkt_barrel',[[1.385,.018,.018,.00381,.00381,.27,1.86],[1.65,.015,.015,.00381,.00381,.27,1.86]],'gun','steel'));
  add(cyl('t72a_antenna_base',.055,.18,[.78,2.063,-.53],'y','turret','paint_dark'));
  add(cyl('t72a_antenna',.006,.95,[.78,2.618,-.53],'y','turret','black',{segs:8}));
  add(box('t72a_ejection_hatch',[.29,.18,.039],[0,1.981,-.972],'turret','paint_dark',{rot:[-35,0,0]}));
  for(const sign of [-1,1]) {
    const side=sign<0?'l':'r';
    add(cyl(`t72a_rear_fuel_drum_${side}`,.275,1.07,[sign*.575,.98,-3.635],'x','hull'));
    for(const i of [-1,1]) {
      const x=sign*.575+i*.34;
      add(box(`t72a_drum_support_${side}_${i}`,[.082,.105,.64],[x,.684,-3.44],'hull','paint_dark'));
      add(box(`t72a_drum_saddle_${side}_${i}`,[.09,.155,.24],[x,.725,-3.635],'hull','paint_dark'));
      // Flat bands are part of the drum assembly rather than separate rotating wheels.
      const band=sleeve(`t72a_drum_band_${side}_${i}`,[[x-.023,.281,.281,.272,.272,0,0],[x+.023,.281,.281,.272,.272,0,0]],'hull','paint_dark');
      band.vertices=band.vertices.map(([a,b,c])=>[c,b+.98,-a-3.635]); add(band);
    }
  }
  // No ERA, later appliqué, ATGM sight or smoke tubes of unproven 1979 factory date.
  appendDetails(parts);
  v.parts=parts;
  v.t72a_hitbox={schema_version:1,source:"render_vertex_buffers"};
  v.palette={...v.palette,paint:'#617052',paint_dark:'#414c38',steel:'#626a64',rubber:'#252824',track:'#555a50',glass:'#243e40',canvas:'#73735a'};
  v.mg_variants={...(v.mg_variants||{}),aa_nsvt:'nsvt_t72a'};
  return v;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const file=path.join(ROOT,'data/vehicles/su_t72a/visual.json');
  const out=refineT72aVisual(JSON.parse(fs.readFileSync(file,'utf8')));
  fs.writeFileSync(file,JSON.stringify(out,null,2)+'\n');
  console.log(`Wrote ONLY su_t72a/visual.json: ${out.parts.length} authored parts.`);
}

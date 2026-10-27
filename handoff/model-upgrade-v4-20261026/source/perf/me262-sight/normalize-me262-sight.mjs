// Operational placement of the current Me 262 family's indexed Revi assembly.
// The source v4 calibration moved the unit 12 cm aft of its original mounting.
// Refit the installation support on the windshield side of the main panel.
export const ME262_SIGHT_REVISION = 2;
const SOURCES = {
  me262: { bytes:1342720, parts:223, buffer:0xab938d41, metadata:0x3b3d09fd, main:'501fa3f895703caba6e6cd03f4e3c9c5068b9c541f91b6423df5d9b985617550' },
  me262a2a: { bytes:1278712, parts:143, buffer:0x3de0a913, metadata:0xe59c8c3d, main:'ab2bafe6b94cf0b0edc739b06c8c17b53dad174b5a473e46768b4207c2057a48' },
  me262u4: { bytes:1251592, parts:126, buffer:0x2e97235f, metadata:0xea957505, main:'122deddc160ad0070d63efa8084180dd00aacd50358b4bf3576201b642a3cad2' }
};
const FIELDS = ['name','group','vertices','triangles','pos','nor','uv','idx','idx32','mover'];
const fnv = bytes => { let h=2166136261; for(const b of bytes)h=Math.imul(h^b,16777619);return h>>>0; };
const meta = parts => { let h=2166136261;const s=JSON.stringify(parts.map(p=>FIELDS.map(k=>p[k])));for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return h>>>0; };
const same = (a,b) => Array.isArray(a)&&a.length===b.length&&a.every((v,i)=>v===b[i]);
const isRevi = p => /^REVI_|^HUD_GLASS:REVI_/.test(p.name);

/** Geometry fitting, not a claimed factory XYZ installation measurement.
 * Returns new model/position arrays while retaining every original source byte,
 * normal, UV, index, material, mover and all non-sight geometry unchanged.
 * Only the installation plate and its pedestal foot are fitted to the panel.
 */
export function normalizeMe262Sight(id,m,buf) {
  const unchanged = reason => ({model:m,buf,applied:false,reason});
  const source=SOURCES[id],cal=m?.spec?.opticsCalibration;
  if(!source)return unchanged('different_type');
  if(cal?.runtimePlacementCorrection)return unchanged('already_corrected');
  if(!buf||buf.byteLength!==source.bytes||m.posScale!==1/3000||m.parts?.length!==source.parts||m.sourceHashes?.main!==source.main||m.cockpitHi)return unchanged('different_source');
  if(cal?.version!==4||!same(cal.assemblyOffset,[0,0,-.12])||!same(m.spec.eye,[0,.925,-.195])||!same(m.spec.sight?.eye,[0,.925,-.195]))return unchanged('different_calibration');
  if(meta(m.parts)!==source.metadata||fnv(new Uint8Array(buf))!==source.buffer)return unchanged('different_geometry');
  const selected=m.parts.filter(isRevi);
  if(selected.length!==16||selected.some(p=>p.mover!=null))return unchanged('different_sight_assembly');
  const mount=selected.find(p=>p.name==='REVI_InstrumentMount::p0::cockpit');
  const glass=selected.find(p=>p.name==='HUD_GLASS:REVI_Combiner::p0::glass');
  if(!mount||!glass)return unchanged('missing_mount_or_combiner');
  const oldMount=new Int16Array(buf,mount.pos,mount.vertices*3);
  let rear=Infinity,anchor=-Infinity;
  for(let i=2;i<oldMount.length;i+=3){rear=Math.min(rear,oldMount[i]);anchor=Math.max(anchor,oldMount[i]);}
  // Measured panel rear face: Z=.4367, upper edge Y=.7613. The Revi main
  // housing/pedestal centres at Z=.447/.45 are on its windshield/nose side;
  // the source 45-degree combining glass naturally leans back towards the pilot.
  // Keep the authored seated eye, rather than shifting the camera to make the
  // installation appear nearer. The resulting physical eye relief is 495 mm.
  // An 80 mm top plate replaces the old 370 mm pilot-side cantilever. Lower
  // that plate 5 mm into contact with the actual curved panel header, extending
  // only the mounting-post foot by 1.667 mm to bear on its upper face.
  const dz=900,newRear=1260,newAnchor=1500,positionBytes=selected.reduce((n,p)=>n+p.vertices*6,0);
  if(newRear>=newAnchor)return unchanged('invalid_panel_anchor');
  const result=new ArrayBuffer(buf.byteLength+positionBytes),bytes=new Uint8Array(result);
  bytes.set(new Uint8Array(buf));let at=buf.byteLength;
  const replacement=new Map();
  for(const part of selected){
    const old=new Int16Array(buf,part.pos,part.vertices*3),pos=new Int16Array(old);
    for(let i=2;i<pos.length;i+=3)pos[i]=part===mount?Math.round(newRear+(old[i]-rear)*(newAnchor-newRear)/(anchor-rear)):old[i]+dz;
    if(part===mount)for(let i=1;i<pos.length;i+=3)pos[i]=old[i]-15;
    if(part.name==='REVI_Pedestal::p0::cockpit'){
      let foot=Infinity;for(let i=1;i<pos.length;i+=3)foot=Math.min(foot,old[i]);
      for(let i=1;i<pos.length;i+=3)if(old[i]===foot)pos[i]=foot-5;
    }
    bytes.set(new Uint8Array(pos.buffer),at);
    replacement.set(part,{...part,pos:at,me262SightPlacement:ME262_SIGHT_REVISION});at+=pos.byteLength;
  }
  const parts=m.parts.map(p=>replacement.get(p)||p),panePart=replacement.get(glass),pane=new Int16Array(result,panePart.pos,panePart.vertices*3),points=[];
  for(let i=0;i<pane.length;i+=3)points.push([pane[i]*m.posScale,pane[i+1]*m.posScale,pane[i+2]*m.posScale]);
  const eye=[0,.925,-.075],lo=[0,1,2].map(k=>Math.min(...points.map(p=>p[k]))),hi=[0,1,2].map(k=>Math.max(...points.map(p=>p[k]))),center=lo.map((v,k)=>(v+hi[k])*.5);
  const bounds=p=>{const a=new Int16Array(result,p.pos,p.vertices*3);return [0,1].map(high=>[0,1,2].map(k=>{let v=high?-Infinity:Infinity;for(let i=k;i<a.length;i+=3)v=high?Math.max(v,a[i]):Math.min(v,a[i]);return v*m.posScale;}));};
  const panel=parts.find(p=>p.name==='COCKPIT_MainInstrumentPanel::p0::cockpit'),panelBounds=bounds(panel),plateBounds=bounds(replacement.get(mount));
  const housingBounds=bounds(parts.find(p=>p.name==='REVI_OpticsHousing::p0::cockpit')),postBounds=bounds(parts.find(p=>p.name==='REVI_Pedestal::p0::cockpit'));
  const panelPos=new Int16Array(result,panel.pos,panel.vertices*3),panelIdx=new Uint16Array(result,panel.idx,panel.triangles*3),contactVertices=[];
  for(const i of new Set(panelIdx)){
    const p=[panelPos[i*3],panelPos[i*3+1],panelPos[i*3+2]].map(v=>v*m.posScale);
    if(p.every((v,k)=>v>=plateBounds[0][k]-1e-9&&v<=plateBounds[1][k]+1e-9))contactVertices.push(p);
  }
  const evidence={revision:ME262_SIGHT_REVISION,sourceBufferFnv:source.buffer.toString(16),translation:[0,0,.30],panelAnchorZ:newAnchor*m.posScale,mountRearZ:newRear*m.posScale,mountLength:(newAnchor-newRear)*m.posScale,panelRearFaceZ:panelBounds[0][2],panelTopY:panelBounds[1][1],mainHousingCenter:housingBounds[0].map((v,k)=>(v+housingBounds[1][k])*.5),pedestalCenter:postBounds[0].map((v,k)=>(v+postBounds[1][k])*.5),mountContact:{plateBounds,pedestalFootY:postBounds[0][1],pedestalFootTouchesPlateTop:Math.abs(postBounds[0][1]-plateBounds[1][1])<1e-9,indexedPanelVerticesInsidePlate:contactVertices.length,witnesses:contactVertices.slice(0,8)},eye:eye.slice(),combinerCenter:center,eyeReliefMeters:center[2]-eye[2],originalSourceBytesRetained:true,trianglesPreserved:true,reason:'Place the Revi main housing and pedestal on the windshield/nose side of the measured instrument panel; replace the pilot-side cantilever with an 80mm top mounting plate. Retain the actual seated eye, with measured eye-relief reported rather than changing the camera. Game geometry fit, not a factory XYZ datum.'};
  const mountPart=replacement.get(mount),mountPositions=new Int16Array(result,mountPart.pos,mountPart.vertices*3),mountPoints=[];
  for(let i=0;i<mountPositions.length;i+=3)mountPoints.push([mountPositions[i]*m.posScale,mountPositions[i+1]*m.posScale,mountPositions[i+2]*m.posScale]);
  const mountBounds=[0,1].map(hi=>[0,1,2].map(k=>(hi?Math.max:Math.min)(...mountPoints.map(p=>p[k]))));
  const spec={...m.spec,eye,sight:{...m.spec.sight,eye:eye.slice(),points,source:'Actual indexed REVI_Combiner vertices after panel-anchored operational placement'},opticsCalibration:{...cal,version:6,eyeOffset:eye.map((v,i)=>v-(cal.sourceEye?.[i]??v)),assemblyOffset:[0,0,.18],sourceGlassBounds:[lo,hi],sourceMountAdaptation:{...cal.sourceMountAdaptation,final_bounds:mountBounds,forward_anchor_final_z:newAnchor*m.posScale,final_positions:mountPoints,reason:'Fit the original indexed mounting plate over the main-panel upper edge, on its windshield side, without a pilot-side cantilever'},runtimePlacementCorrection:evidence,evidence:{...cal.evidence,correctedCombinerCentre:center,eyeReliefMeters:evidence.eyeReliefMeters,reason:evidence.reason,mountRule:'Rigid sight assembly and real seated eye; original indexed mounting plate refitted to the panel upper edge on its windshield side',status:'runtime_panel_anchor_and_source_eye_corrected'}}};
  return {model:{...m,parts,spec},buf:result,applied:true,evidence};
}

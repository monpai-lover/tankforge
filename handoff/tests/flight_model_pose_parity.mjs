// Exact production Aircraft.pose on accepted-state geometry fixtures; no DOM,
// alternate pose formula, browser/GPU, or simulation-state mutation.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
let text='';for await(const chunk of process.stdin)text+=chunk;
const input=JSON.parse(text),source=fs.readFileSync(input.app,'utf8');
const section=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);if(i<0||j<=i)throw Error('Missing production source '+a);return source.slice(i,j);};
const helpers=section('  var aqMul = ','  var AIRCRAFT_KEYS');
const defaults=section('  var MAIN_WHEEL_LOW = ','  function loadFlightCore(');
const method=section('    pose(alpha = 1) {','    /** Sends the damage model');
const context=vm.createContext({Float32Array,Math});
vm.runInContext(helpers+defaults+'\nvar productionPose=({'+method+'}).pose;globalThis.run=function(sample){'+
 'const state=Float32Array.from(sample.state);const plane={prev:Float32Array.from(state),cur:state,type:{gear:sample.gear,rotateKmh:sample.rotateKmh},'+
 'state:{camera:0,throttle:0},root:{local:null},controls:[],glass:{},cockpit:{},_canopyHold:true,canopyK:0,onGround:state[35]<2.3,groundSpeed:state[75]};'+
 'productionPose.call(plane,1);return {matrix:Array.from(plane.root.local),points:sample.points.map(p=>[0,1,2].map(k=>plane.root.local[k]*p[0]+plane.root.local[k+4]*p[1]+plane.root.local[k+8]*p[2]+plane.root.local[k+12]))};};',context);
const samples=input.samples.map(s=>context.run(s)),visibleProbes=[];
if(input.nativeRecord){
 const native=JSON.parse(fs.readFileSync(input.nativeRecord)),blob=zlib.inflateSync(Buffer.from(native.blob,'base64')),m=samples[0].matrix;
 const world=p=>[0,1,2].map(k=>m[k]*p[0]+m[k+4]*p[1]+m[k+8]*p[2]+m[k+12]);
 for(const part of native.parts.filter(p=>['EXT_AirframeShell','EXT_Nacelle_L','EXT_Nacelle_R'].includes(p.source_name)&&p.group==='body')){
  const points=Array.from({length:part.vertices},(_,i)=>[0,1,2].map(k=>Math.fround(blob.readInt16LE(part.pos+(i*3+k)*2)*native.posScale)));
  for(let i=0;i<part.triangles;i++){
   const t=[0,1,2].map(k=>points[blob.readUInt16LE(part.idx+(i*3+k)*2)]),p=[0,1,2].map(k=>(t[0][k]+t[1][k]+t[2][k])/3);
   const a=t[1].map((v,k)=>v-t[0][k]),b=t[2].map((v,k)=>v-t[0][k]),n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
   if(p[1]>-.35||Math.abs(p[0])>3||Math.abs(p[2])>3||Math.abs(n[1])<.7*Math.hypot(...n))continue;
   let sourceFace=i,offset=0;for(const [start,count]of part.source_faces){if(i<offset+count){sourceFace=start+i-offset;break;}offset+=count;}
   visibleProbes.push({part:part.source_name,sourceNode:part.source_node,sourceFace,local:p,a:world([p[0],p[1]+.075,p[2]]),b:world([p[0],p[1]-.075,p[2]])});
  }
 }
}
console.log(JSON.stringify({appSha256:crypto.createHash('sha256').update(source).digest('hex'),actualProductionPose:true,samples,visibleProbes}));

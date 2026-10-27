// Geometry-only worker. Accepted simulation/height/map data remain world-space.
// One in-flight job, one newest request, and an atomic scene swap after staged uploads.
function createFrontlineTerrainWorker({f,renderer,Node,build,definitions,grid,height,workerFactory}) {
  if(!workerFactory&&(typeof Worker!=='function'||typeof URL?.createObjectURL!=='function'))return null;
  const declarations=Object.entries(definitions).map(([name,value])=>`const ${name}=(${value.toString()});`).join('\n');
  const source=`'use strict';\n${declarations}\nconst STRIDE=13,IDENTITY=m4(),clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
    class Node {constructor(name){this.name=name;this.children=[];this.castShadow=true;}add(n){this.children.push(n);return n;}}
    const renderer={mesh(data){return {data}},freeMesh(){}};
    const f={root:new Node('root'),aircrafts:[],facilityPresentation:{ready:true}};
    const controlled=()=>f.aerial?{aircraft:'worker'}:null,unitKey=()=>'';
    const grid=(${grid.toString()}),height=(${height.toString()}),rebuild=(${build.toString()});
    self.onmessage=event=>{const m=event.data;try{
      if(m.op==='map'){f.map=m.map;if(f.map.id==='taiwan'){f.farTerrain=createFrontlineFarTerrainGeometry({GeoBuilder,terrain:f.map.terrain,bounds:f.map.bounds,step:4000,createWaterCutout:createFrontlineWaterCutout,material:{color:hexToLinear('#6e7954'),rough:1,metal:0}});f.farTerrainMap=f.map;}return;}
      if(m.op!=='build')return;
      f.focus=m.focus;f.aerial=m.aerial;if(f.facilityPresentation.ready!==m.facilityReady)f.terrainOrigin=null;f.facilityPresentation.ready=m.facilityReady;rebuild();
      const nodes=f.terrain.children.filter(n=>n.mesh).map(n=>({name:n.name,data:n.mesh.data,kind:n.kind,castShadow:n.castShadow,polygonOffset:n.polygonOffset}));
      self.postMessage({op:'built',key:m.key,nodes,origin:f.terrainOrigin,aerial:f.terrainAerial,stats:f.terrainStats,farStats:f.farTerrainStats},nodes.map(n=>n.data.buffer));
    }catch(error){self.postMessage({op:'error',message:String(error.stack||error)});}};`;
  let blobUrl=null,worker;
  try{if(workerFactory)worker=workerFactory(source);else{blobUrl=URL.createObjectURL(new Blob([source],{type:'application/javascript'}));worker=new Worker(blobUrl);}}
  catch{if(blobUrl)URL.revokeObjectURL(blobUrl);return null;}
  let disposed=false,failed=false,inFlight=null,desired=null,prepared=null,installedKey=null;
  const stats={requests:0,completed:0,discarded:0,uploads:0,swaps:0,errors:0};
  function releasePrepared(){if(prepared)for(const n of prepared.root.children)renderer.freeMesh(n.mesh);prepared=null;}
  function pump(){if(disposed||failed||inFlight||prepared||!desired||desired.key===installedKey)return;inFlight=desired.key;stats.requests++;worker.postMessage({op:'build',...desired});}
  worker.onmessage=event=>{
    if(disposed)return;const m=event.data;
    if(m.op==='error'){failed=true;stats.errors++;stats.error=m.message;inFlight=null;releasePrepared();return;}
    if(m.op!=='built'||m.key!==inFlight)return;inFlight=null;stats.completed++;
    if(m.key!==desired?.key){stats.discarded++;pump();return;}
    prepared={...m,root:new Node('frontline-terrain'),cursor:0};
  };
  worker.onerror=event=>{failed=true;stats.errors++;stats.error=String(event.message||event);inFlight=null;releasePrepared();};
  worker.postMessage({op:'map',map:f.map});
  function request({focus,aerial,facilityReady}){
    if(disposed||failed)return false;
    const cx=Math.floor(focus[0]/750)*750,cz=Math.floor(focus[2]/750)*750,key=`${cx}:${cz}:${aerial}:${facilityReady}`;
    desired={key,focus:focus.slice(),aerial,facilityReady};
    if(prepared&&prepared.key!==key){stats.discarded++;releasePrepared();}
    if(prepared){
      // Limit uploads to one mesh per drawn frame. Keep the complete previous
      // terrain visible until every new upload has succeeded.
      const packet=prepared.nodes[prepared.cursor];
      if(packet){const n=prepared.root.add(new Node(packet.name));try{n.mesh=renderer.mesh(packet.data);}catch(error){failed=true;stats.errors++;stats.error=String(error);releasePrepared();return false;}n.kind=packet.kind;n.castShadow=packet.castShadow;if(packet.polygonOffset)n.polygonOffset=packet.polygonOffset;prepared.cursor++;stats.uploads++;}
      if(prepared.cursor===prepared.nodes.length){
        const old=f.terrain;if(old){f.root.children=f.root.children.filter(n=>n!==old);for(const n of old.children)if(n.mesh)renderer.freeMesh(n.mesh);}
        f.terrain=prepared.root;f.root.add(f.terrain);f.terrainOrigin=prepared.origin;f.terrainAerial=prepared.aerial;f.terrainStats=prepared.stats;f.farTerrainStats=prepared.farStats;
        installedKey=prepared.key;prepared=null;stats.swaps++;
      }
    }
    pump();return true;
  }
  function dispose(){if(disposed)return;disposed=true;releasePrepared();worker.terminate();if(blobUrl)URL.revokeObjectURL(blobUrl);}
  return {request,dispose,stats,get failed(){return failed;},get pending(){return !!inFlight||!!prepared;}};
}

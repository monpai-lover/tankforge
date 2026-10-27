import fs from 'node:fs';
import {declaration} from '../hardpoints/actual-layout-fixture.mjs';
const [appFile,outFile,id='f4e',storeFile='perf/mount-v3/store-models.json']=process.argv.slice(2);
if(!appFile||!outFile)throw Error('app output');
const app=fs.readFileSync(appFile,'utf8'),a=app.indexOf('(() => {')+'(() => {'.length,b=app.indexOf('  // client/web/src/boot.js');
const model=JSON.parse(fs.readFileSync('perf/all-interior/current-catalog-fixture.json','utf8')).models[id]||null;
const pilot=JSON.parse(fs.readFileSync('perf/flight-ui/current-imported-models.json','utf8')).pilot;
const stores=JSON.parse(fs.readFileSync(storeFile,'utf8'));
const safe=v=>JSON.stringify(v).replace(/</g,'\\u003c');
const hpBegin=app.indexOf('    /* TF_MODEL_HARDPOINTS_BEGIN */'),hpEnd=app.indexOf('    /* TF_MODEL_HARDPOINTS_END */');
const hpHelper=hpBegin>=0?app.slice(hpBegin,hpEnd):'';
const funcs=[hpHelper,
 ...['AIR_STORE_DEFS','WEAPON_MIGRATION','WEAPON_COMPAT','AIR_LOADOUTS','AIR_WEAPON_KINDS','SLOT_ORDER','slotsClash','storeMeshes','airLoadouts','STORE_LOD_NEAR'].map(n=>declaration(app,n,'const')),
 'const migrateWeapon = id => AIR_STORE_DEFS[id] ? id : WEAPON_MIGRATION[id]?.to || null;',
 ...['airStations','pylonPoint','pylonRack','storeMountPosition','layoutStores','airSlots','customLoadout','storeMesh','sourceStoreMesh','mountStores','storeMassOf','airStoresMass','storeLodStep'].filter(n=>!['storeMassOf'].includes(n)).map(n=>declaration(app,n)),
 declaration(app,'storeMassOf','const')
].join('\n');
const html=`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#111;overflow:hidden}canvas{width:100vw;height:100vh;display:block}#tag{position:absolute;left:10px;top:10px;background:#162326d9;padding:8px;color:white;font:14px monospace}</style><canvas id="view"></canvas><div id="tag"></div><script type="application/json" id="model">${safe(model)}</script><script type="application/json" id="pilot">${safe(pilot)}</script><script type="application/json" id="stores">${safe(stores)}</script><script>(()=>{${app.slice(a,b)}
window.__f15={ready:false};
(async()=>{
 const data={storeModels:JSON.parse(document.getElementById('stores').textContent),projectiles:{}},G4={airCustom:{},airLoadout:{}};
 const rawModel=JSON.parse(document.getElementById('model').textContent);if(rawModel)await decodeAircraftModels({[${safe(id)}]:rawModel});await decodePilotModel(JSON.parse(document.getElementById('pilot').textContent));await decodeStoreModels(data.storeModels);
 const M=AIRCRAFT_TYPES[${safe(id)}].model||{};for(const img of[M.img,M.nimg])if(img)await img.decode().catch(()=>{});
 const renderer=new Renderer(document.getElementById('view'),{quality:'low',noiseSize:16});renderer._buildDome(64);renderer.setTime(1);
 ${funcs}
 if(typeof TFMountedDetails!=='undefined')TFMountedDetails.register(AIR_STORE_DEFS,data.storeModels);
 const airBots={list:[]},airOrdnance=[];const state=new Float32Array(80);state[6]=1;state[33]=1;state[35]=100;
 const api={memory:{buffer:state.buffer},state_ptr:()=>0,state_len:()=>80,set_damage(){},step(){},configure_airframe(){},configure_control(){},configure(){},configure_envelope(){},spawn(){},core_version:()=>213};
 const plane=new Aircraft(renderer,api,${safe(id)});plane.cur.set(state);plane.prev.set(state);let mounted=null;
 function mount(index){mounted=mountStores(plane,${safe(id)},index);window.__f15.current=mounted;return inspect();}
 function mountReview(loadout){AIR_LOADOUTS[${safe(id)}].push(loadout);try{mounted=mountStores(plane,${safe(id)},airLoadouts(${safe(id)}).length-2);window.__f15.current=mounted;return inspect();}finally{AIR_LOADOUTS[${safe(id)}].pop();}}
 function inspect(){plane.pose(1);plane.root.update(null);return {name:mounted?.name,index:mounted?.index,count:mounted?.items.length,mass:mounted?airStoresMass(mounted):0,pylonMeshes:plane.pylonMeshes.length,items:mounted?.items.map(it=>({id:it.id,station:it.station,side:it.side,p:Array.from(it.p),mount:it.mount&&Array.from(it.mount),modelHardpoint:it.modelHardpoint||null,mountBasis:it.modelMountBasis||null,fittedMountKey:it.fittedMountKey||null,storeRotation:it.storeRotation?Array.from(it.storeRotation):null,nodeLocal:it.node?.local?Array.from(it.node.local):null,owner:it.owner,pylon:it.pylon,world:Array.from(it.node.world).slice(12,15),releaseOrigin:plane.worldPoint(it.p),triangles:it.node.mesh.count/3}))};}
 function draw({eye=[-3,-1.2,6.5],target=[-2.93,-.48,1.38],fov=38,label=''}={}){G4.air={plane};G4.camPos=eye;storeLodStep();plane.setXray(false);plane.pose(1);plane.root.update(null);const nodes=plane.root.collect([]),[w,h]=renderer.resize(1),f=norm(sub(target,eye)),la=lookAtLH(eye,f),fy=fov*Math.PI/180,ty=Math.tan(fy/2),cam={pos:eye,viewProj:mul(perspective(fy,w/h,.05,2000),la.view),forward:la.forward,right:la.right,up:la.up,tanX:ty*w/h,tanY:ty,near:.05,far:2000};renderer.advance(1/60);renderer.render(nodes,cam,[0,0,0],null);document.getElementById('tag').textContent=${safe(id)}+' '+label+' / '+mounted.name;return inspect();}
 function drawStore(id){
  const d=AIR_STORE_DEFS[id],node=new Node('review_store_'+id);node.mesh=storeMesh(id,0);node.kind=3;node.update(null);
  const eye=[d.len*.85,d.len*.43,d.len*.95],target=[0,0,0],[w,h]=renderer.resize(1),f=norm(sub(target,eye)),la=lookAtLH(eye,f),fy=34*Math.PI/180,ty=Math.tan(fy/2),cam={pos:eye,viewProj:mul(perspective(fy,w/h,.05,2000),la.view),forward:la.forward,right:la.right,up:la.up,tanX:ty*w/h,tanY:ty,near:.05,far:2000};renderer.advance(1/60);renderer.render([node],cam,[0,0,0],null);document.getElementById('tag').textContent=id+' / actual store renderer';return {id,triangles:node.mesh.count/3,data:Array.from(node.mesh._src.data)};
 }
 Object.assign(window.__f15,{ready:true,plane,renderer,mount,mountReview,draw,drawStore,inspect,definitions:AIR_STORE_DEFS,layoutStores,airLoadouts,airSlots,storeSocket});mount(1);draw();
})().catch(e=>{window.__f15.error=String(e.stack||e);console.error(e)});
})();</script>`;
fs.writeFileSync(outFile,html);console.log(JSON.stringify({app:appFile,out:outFile,bytes:html.length}));

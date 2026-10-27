import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {chromium} from '../node_modules/playwright/index.mjs';
import {REVIEW_CASES} from './catalog.mjs';
const dir=fileURLToPath(new URL('.',import.meta.url)).replace(/\/$/,''),out=process.env.TF_AUDIT_OUT||dir+'/jets-audit';fs.mkdirSync(out,{recursive:true});
const ids=process.env.TF_AUDIT_TYPES?.split(',')||['mig15','f86f','mig17f','mig21','f104g','hunter6','mirage3e','f4e','f15c','mig29','f16v','su27','a10a','su25','me262','me262a2a','me262u4','nf02'];
const app=process.env.TF_AUDIT_APP||dir+'/app-fixed.html';
for(const id of ids)execFileSync(process.execPath,['perf/hardpoints/geometry-audit-build-view.mjs',app,out+'/'+id+'.html',id,dir+'/store-models.json'],{stdio:'ignore'});
const report=process.env.TF_AUDIT_TYPES?JSON.parse(fs.readFileSync(out+'/report.json')):{sourceApp:app,models:[],errors:[]},assets=new Map();
report.sourceAppSha256=createHash('sha256').update(fs.readFileSync(app)).digest('hex');
report.storeLod=0;
const b=await chromium.launch({executablePath:process.env.TF_CHROMIUM||[chromium.executablePath(),'/root/.cache/ms-playwright/chromium_headless_shell-1194/chrome-linux/headless_shell'].find(p=>fs.existsSync(p)),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--enable-webgl','--ignore-gpu-blocklist',...(process.env.TF_SINGLE_PROCESS==='1'?['--no-zygote','--single-process']:[])]});
try{for(const id of ids){
 const p=await b.newPage({viewport:{width:1400,height:950}}),row={id,cases:[],errors:[]};report.models=report.models.filter(r=>r.id!==id);report.models.push(row);p.on('pageerror',e=>row.errors.push(e.message));
 try{
  await p.goto('file://'+out+'/'+id+'.html');await p.waitForFunction(()=>window.__f15?.ready||window.__f15?.error,null,{timeout:120000});const err=await p.evaluate(()=>window.__f15.error);if(err)throw Error(err);
  const init=await p.evaluate(()=>{
   const r=window.__f15,P=r.plane;P.cur[33]=P.prev[33]=0;P.cur[34]=P.prev[34]=0;P.pose(1);P.root.update(null);
   function bytes(data){const u=new Uint8Array(data.buffer),a=[];for(let k=0;k<u.length;k+=32768)a.push(String.fromCharCode(...u.subarray(k,k+32768)));return btoa(a.join(''));}
   function positions(node,world=true){const d=node.mesh?._src?.data;if(!d)return null;const a=new Float32Array(d.length/13*3),m=node.world;let k=0;for(let i=0;i<d.length;i+=13)for(let j=0;j<3;j++)a[k++]=world?m[j]*d[i]+m[4+j]*d[i+1]+m[8+j]*d[i+2]+m[12+j]:d[i+j];return a;}
   Object.assign(r,{bytes,positions});
   const nodes=P.root.collect([]).filter(n=>!P.storeNodes.includes(n)&&!n.mountFitNode),all=nodes.map(n=>positions(n)).filter(Boolean),data=new Float32Array(all.reduce((n,x)=>n+x.length,0));let offset=0;for(const a of all){data.set(a,offset);offset+=a.length;}
   const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let i=0;i<data.length;i+=3)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],data[i+k]);hi[k]=Math.max(hi[k],data[i+k]);}
   const slots=r.airSlots(P.type.id);return{data:bytes(data),cases:r.airLoadouts(P.type.id).length,loadouts:r.airLoadouts(P.type.id),slots:slots.map(s=>({key:s.key,station:s.station,side:s.side,options:[...s.options],mirrorKey:slots.find(q=>s.pylon?q.pylon&&Math.abs(q.pylon.x+s.pylon.x)<.05:q.station===s.station&&q.side===-s.side)?.key})),lo,hi};
  });
  fs.writeFileSync(out+'/'+id+'-airframe.bin',Buffer.from(init.data,'base64'));row.bounds={lo:init.lo,hi:init.hi};
  const cases=[...Array.from({length:init.cases},(_,index)=>({index})),...(REVIEW_CASES[id]||[]).map((review,i)=>({index:'new'+i,review}))];
  const entries=[...init.loadouts,...(REVIEW_CASES[id]||[])].flatMap(lo=>lo[1]),seen=new Set();let count=0;
  for(const sl of init.slots)for(const[weapon,n]of sl.options){
   const key=sl.key+'|'+weapon;if(seen.has(key))continue;
   const covered=entries.some(e=>e[0]===weapon&&e[2]===sl.station&&(e[3]!=null?e[3]===sl.side&&e[1]===n:/^p\d+$/.test(sl.station)||sl.station==='center'?e[1]===n:Math.ceil(e[1]/2)===n));if(covered)continue;
   const picks=[[weapon,n,sl.station,sl.side]],mirror=init.slots.find(q=>q.key===sl.mirrorKey);
   if(mirror&&mirror.key!==sl.key&&mirror.options.some(([w,k])=>w===weapon&&k===n)&&!['sniper','litening'].includes(weapon)){picks.push([weapon,n,mirror.station,mirror.side]);seen.add(mirror.key+'|'+weapon);}
   seen.add(key);cases.push({index:'option'+count++,review:['Catalog '+weapon+' '+sl.station,picks],catalogOption:true});
  }
  for(const spec of cases){const index=spec.index;
   const c=await p.evaluate(spec=>{
    const r=window.__f15;spec.review?r.mountReview(spec.review):r.mount(spec.index);const state=r.draw({eye:[0,-4,20],target:[0,0,0]}),P=r.plane;
    const items=state.items.map(it=>{const n=P.storeNodes.find(n=>n.storeId===it.id&&Array.from(n.local).slice(12,15).every((v,k)=>Math.abs(v-it.p[k])<1e-4));return{...it,kind:r.definitions[it.id].kind,assetKey:it.id+':'+(n?.sourceStore?.id||'')+':'+(n?.mesh.count||0),data:n?r.bytes(r.positions(n,false)):null};});
    return{index:spec.index,review:!!spec.review,name:state.name,items,adapters:[...P.storeNodes.filter(n=>n.rackId||n.sourceMount||n.name==='aircraft_pylon'),...(P.mountFitNodes||[]).filter(n=>n.visible&&!n.hitboxDisabled)].map(n=>({name:n.name,mountFitNode:!!n.mountFitNode,mountKey:n.mountKey||null,data:r.bytes(r.positions(n))}))};
   },spec);
   for(const it of c.items){if(it.data&&!assets.has(it.assetKey)){const file='store-'+(process.env.TF_AUDIT_TYPES?id+'-':'')+assets.size+'.bin';fs.writeFileSync(out+'/'+file,Buffer.from(it.data,'base64'));assets.set(it.assetKey,file);}delete it.data;it.assetFile=assets.get(it.assetKey);}
   for(let k=0;k<c.adapters.length;k++){const n=c.adapters[k],file=id+'-'+index+'-adapter-'+k+'.bin';fs.writeFileSync(out+'/'+file,Buffer.from(n.data,'base64'));n.assetFile=file;delete n.data;}
   const size=Math.max(init.hi[0]-init.lo[0],init.hi[2]-init.lo[2]),center=init.lo.map((v,k)=>(v+init.hi[k])/2);center[1]=(init.lo[1]+Math.min(init.hi[1],.5))/2;
   if(process.env.TF_AUDIT_FAST!=='1'||id==='f15c'){
    await p.evaluate(args=>window.__f15.draw(args),{eye:[center[0]+size*.66,center[1]-size*.32,center[2]+size*.78],target:center,fov:44,label:'loaded station audit '+index});
    const counts={};for(const it of c.items)counts[it.id]=(counts[it.id]||0)+1;
    await p.evaluate(label=>document.getElementById('tag').textContent=label,(id==='f15c'?'F-15E':id==='a10a'?'A-10C':id.toUpperCase())+' | '+Object.entries(counts).map(([id,n])=>id.toUpperCase()+' x'+n).join(' / '));
    await p.screenshot({path:out+'/'+id+'-'+index+'-mounted.png'});
   }
   row.cases.push(c);
  }
 }catch(e){row.error=String(e.stack||e);report.errors.push({id,error:row.error});}finally{await p.close();fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));}
 console.log(id,row.cases.length,'loadouts',row.errors.length?'ERROR':'OK');
}}finally{await b.close();report.ok=!report.errors.length&&report.models.every(r=>!r.errors.length);fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));}
if(!report.ok)process.exitCode=1;

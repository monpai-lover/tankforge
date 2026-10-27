import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url)),dir=path.join(root,'handoff/bundle');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v),sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const raw=fs.existsSync(path.join(dir,'data.line'))?fs.readFileSync(path.join(dir,'data.line')):zlib.gunzipSync(Buffer.concat(fs.readdirSync(dir).filter(n=>n.startsWith('data.line.gz.part')).sort().map(n=>fs.readFileSync(path.join(dir,n)))));
function field(name){const marker=Buffer.from(JSON.stringify(name)+':');let i=raw.indexOf(marker)+marker.length,start=i,depth=0,q=false,e=false;for(;i<raw.length;i++){const b=raw[i];if(q){if(e)e=false;else if(b===92)e=true;else if(b===34)q=false;continue;}if(b===34)q=true;else if(b===123||b===91)depth++;else if((b===125||b===93)&&--depth===0)return JSON.parse(raw.subarray(start,i+1));}throw Error(name);}
const packets=field('surfaceCatalog'),vehicles=field('vehicles');Object.assign(packets,JSON.parse(fs.readFileSync(path.join(root,'handoff/qa/foldable-surface-packets-20261026.json'))));
const registry={schema:'VerifiedSourceSurfaceArmorRegistryV1',revision:'verified-source-feature-armor-20261026-v1',scope:'Game-data source constructor associations, not historical armor measurement. No normals, geometric proximity, visual wall thickness or arbitrary extra solid fill.',specs:{}};
const plans={de_pz3_j:{13:'plan8'},de_pz4_h:{25:'plan8'},su_t34_85:{28:'polar36',30:'mantlet'},us_m4a3_75w:{30:'polar36',31:'mantlet',32:'mantlet'},us_m4a2:{30:'polar36',31:'mantlet',32:'mantlet'},us_m4a1_76w:{32:'polar36',33:'mantlet',34:'mantlet'},us_m4a3_76w_hvss:{18:'polar36',19:'mantlet',20:'mantlet'}};
function schedule(part,kind){
  const list=[];let first=0;const add=(feature,count,ref=null,side='outer')=>{list.push({first,count,feature,armorRef:ref,boundarySide:ref?side:null});first+=count;};
  if(kind==='plan8')return null; // Existing emitted feature labels already pin each chamfer.
  if(part.type!=='loft')throw Error('reviewed constructor changed');
  const n=part.rings[0].length;
  if(kind==='polar36'&&(n!==36||part.rings.length!==7))throw Error('reviewed cast turret schedule changed');
  if(kind==='mantlet'&&n!==24)throw Error('reviewed cast mantlet schedule changed');
  for(let b=0;b<part.rings.length-1;b++)for(let e=0;e<n;e++){
    const a=part.rings[b][e],bb=part.rings[b][(e+1)%n],c=part.rings[b+1][(e+1)%n],d=part.rings[b+1][e],x=c.map((v,k)=>v-a[k]),y=d.map((v,k)=>v-bb[k]);
    if(Math.hypot(x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0])<=1e-12)continue;
    const ref=kind==='mantlet'?'gun_mantlet':b===5?'turret_roof':e>=22&&e<=31?'turret_front':e>=5&&e<=12?'turret_rear':e>=13&&e<=21?'turret_side_l':'turret_side_r';
    add(`loft:band:${b}:edge:${e}`,2,ref);
  }
  for(let cap=0;cap<2;cap++)if((part.caps||[true,true])[cap])for(let fan=0;fan<n;fan++)add(`loft:cap:${cap}:fan:${fan}`,1,kind==='mantlet'?'gun_mantlet':cap===1?'turret_roof':null,kind==='mantlet'&&cap===0?'inner':'outer');
  return list;
}
for(const[id,packet]of Object.entries(packets)){
  const c=JSON.parse(packet.catalog),m=JSON.parse(packet.manifest),entry={manifestHash:sha(packet.manifest),catalogHash:sha(packet.catalog),overrides:[],sourceParts:[],reviewedDeclarations:c.declarations.filter(d=>d.resistancePolicy!=='unsupported').length,unsupportedDeclarations:c.declarations.filter(d=>d.resistancePolicy==='unsupported').length};
  for(const[ordinalText,kind]of Object.entries(plans[id]||{})){
    const ordinal=Number(ordinalText),part=vehicles[id].visual.parts[ordinal],descriptors=c.declarations.filter(d=>d.sourceKey.endsWith(':part:'+ordinal));
    if(!descriptors.length)throw Error('source identity missing '+id+':'+ordinal);
    const sourceKey=descriptors[0].sourceKey,assetKey=sourceKey.replace(/:part:\d+$/,''),features=schedule(part,kind),ownerFirst=Math.min(...descriptors.map(d=>d.first));
    entry.sourceParts.push({ordinal,sourceKey,descriptorHash:sha(canonical(part)),descriptor:part,kind,review:'Exact source constructor feature order; existing authored engineering sector names. No spatial matching.'});
    for(const d of descriptors.filter(d=>d.resistancePolicy==='unsupported')){
      let runs;
      if(kind==='plan8'){
        const f=d.owners.find(o=>o.kind==='source_constructor')?.featureKey,match=/^plan:edge:([1357])$/.exec(f||'');
        if(!match)continue;const edge=Number(match[1]);runs=[{first:d.first,count:d.count,feature:f,armorRef:edge<4?'turret_side_r':'turret_side_l',boundarySide:'outer'}];
      }else{
        runs=features.filter(f=>ownerFirst+f.first<d.first+d.count&&ownerFirst+f.first+f.count>d.first).map(f=>({...f,first:Math.max(ownerFirst+f.first,d.first),count:Math.min(ownerFirst+f.first+f.count,d.first+d.count)-Math.max(ownerFirst+f.first,d.first)}));
        if(!runs.some(r=>r.armorRef))continue;
      }
      for(const r of runs)if(r.armorRef&&!c.acceptedAnatomy.armor.some(a=>a.id===r.armorRef))throw Error('authored plate absent '+id+':'+r.armorRef);
      entry.overrides.push({declarationKey:d.key,meshKey:d.meshKey,first:d.first,count:d.count,sourceKey:d.sourceKey,assetKey,runs});
    }
  }
  if(entry.manifestHash!==packet.manifestHash||entry.catalogHash!==packet.catalogHash||m.specId!==id)throw Error('source packet hash differs');
  registry.specs[id]=entry;
}
const target=path.join(root,'handoff/qa/verified-surface-armor-registry-20261026.json');fs.writeFileSync(target,JSON.stringify(registry,null,2)+'\n');
console.log(JSON.stringify({target,specs:Object.keys(registry.specs).length,overrides:Object.values(registry.specs).reduce((n,e)=>n+e.overrides.length,0),sha256:sha(fs.readFileSync(target))}));

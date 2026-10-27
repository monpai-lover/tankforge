// Extend the existing pinned registry from explicit source construction reviews.
// Run only against the original packets; it never reads a query ray or assigns
// engineering from a triangle's location, thickness, color or nearest plate.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {constructorFeatures} from './penetration_features.mjs';
import {review as sealedReview} from './penetration_sealed_plan.mjs';
import {review as openReview} from './penetration_open_plan.mjs';
import {reviewM8Declaration} from './penetration_m8_plan.mjs';
import {reviewDeclaration as generatedReview} from './penetration_generated_plan.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),dir=path.join(root,'handoff/bundle');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v),sha=v=>crypto.createHash('sha256').update(v).digest('hex');
let raw=fs.existsSync(path.join(dir,'data.line'))?fs.readFileSync(path.join(dir,'data.line')):zlib.gunzipSync(Buffer.concat(fs.readdirSync(dir).filter(n=>n.startsWith('data.line.gz.part')).sort().map(n=>fs.readFileSync(path.join(dir,n)))));
function field(name){const marker=Buffer.from(JSON.stringify(name)+':');let i=raw.indexOf(marker)+marker.length,start=i,depth=0,q=false,e=false;for(;i<raw.length;i++){const b=raw[i];if(q){if(e)e=false;else if(b===92)e=true;else if(b===34)q=false;continue;}if(b===34)q=true;else if(b===123||b===91)depth++;else if((b===125||b===93)&&--depth===0)return JSON.parse(raw.subarray(start,i+1));}throw Error(name);}
const packets=field('surfaceCatalog'),vehicles=field('vehicles');raw=null;
Object.assign(packets,JSON.parse(fs.readFileSync(path.join(root,'handoff/qa/foldable-surface-packets-20261026.json'))));
// This receipt remains the original, immutable additional-review input. Do not
// make generation depend on its own previous output.
const baseline=JSON.parse(fs.readFileSync(path.join(root,'handoff/qa/verified-surface-armor-registry-baseline-20261026.json')));
const registry={...baseline,revision:'verified-source-feature-penetration-20261027-v2',scope:'Pinned explicit game-data source constructor associations. Existing engineering and uploaded geometry unchanged; no historical measurement certification or runtime nearest-plate inference.',specs:{}};
const summary=[];
for(const[id,packet]of Object.entries(packets)){
 const c=JSON.parse(packet.catalog),m=JSON.parse(packet.manifest),prior=baseline.specs[id];
 if(sha(packet.manifest)!==prior.manifestHash||sha(packet.catalog)!==prior.catalogHash)throw Error('original packet changed '+id);
 const old=new Map(prior.overrides.map(d=>[d.declarationKey,d])),overrides=[],groups=new Map();
 for(const d of c.declarations){const k=d.meshKey+'\0'+d.sourceKey;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(d);}
 const partReviews=new Map();let changed=0;
 for(const d of c.declarations.filter(d=>d.resistancePolicy==='unsupported')){
  const match=/:part:(\d+)(?::mirror:(\d+))?$/.exec(d.sourceKey),ordinal=match?Number(match[1]):null,part=ordinal===null?null:vehicles[id].visual.parts[ordinal];
  const context={catalog:c,manifest:m,vehicleBundle:vehicles[id],declaration:d,mirrorOrdinal:d.mirrorOrdinal??(match?.[2]===undefined?null:Number(match[2]))};
  let runs=(id==='us_m8'?reviewM8Declaration(d,part,context):null)||generatedReview(d,part,context);
  if(!runs&&part){
   const group=groups.get(d.meshKey+'\0'+d.sourceKey),ownerFirst=Math.min(...group.map(d=>d.first)),ownerEnd=Math.max(...group.map(d=>d.first+d.count));
   const features=constructorFeatures(part,(vehicles[id].weapons.main_gun.caliber_mm||0)/2000);
   if(features){
    const total=features.reduce((n,f)=>n+f.count,0);
    if(total!==ownerEnd-ownerFirst)throw Error(`source feature emission changed ${id}:${ordinal} ${total}/${ownerEnd-ownerFirst}`);
    runs=features.filter(f=>ownerFirst+f.first<d.first+d.count&&ownerFirst+f.first+f.count>d.first).map(f=>{
     const binding=sealedReview(id,ordinal,f.feature,part,context)||openReview(id,ordinal,f.feature,part,context);
     return {first:Math.max(ownerFirst+f.first,d.first),count:Math.min(ownerFirst+f.first+f.count,d.first+d.count)-Math.max(ownerFirst+f.first,d.first),feature:f.feature,...(binding||{})};
    });
   }
  }
  // Preserve the earlier source review when the new review has no decision.
  const earlier=old.get(d.key);
  if(runs&&earlier){
   const split=[];
   for(const r of runs)for(const p of earlier.runs){const first=Math.max(r.first,p.first),end=Math.min(r.first+r.count,p.first+p.count);if(end>first)split.push({...(!r.armorRef&&!r.moduleRef&&!r.decoration?p:r),first,count:end-first});}
   runs=split;
  }else if(!runs&&earlier)runs=earlier.runs;
  if(!runs||!runs.some(r=>r.armorRef||r.moduleRef||r.decoration))continue;
  let cursor=d.first;
  for(const r of runs){
   if(r.first!==cursor||!Number.isInteger(r.count)||r.count<=0)throw Error('source feature partition gap '+id+':'+d.key);cursor+=r.count;
   const choices=Number(!!r.armorRef)+Number(!!r.moduleRef)+Number(!!r.decoration);if(choices>1)throw Error('ambiguous source feature response');
   if(r.armorRef&&!c.acceptedAnatomy.armor.some(p=>p.id===r.armorRef))throw Error('missing engineering '+id+':'+r.armorRef);
   if(r.moduleRef&&!c.acceptedAnatomy.modules.some(p=>p.id===r.moduleRef))throw Error('missing module '+id+':'+r.moduleRef);
   if(r.moduleRef&&!r.reason)r.reason='Explicit source weapon, bearing or mechanical-component assembly; resistance remains the registered module response.';
   if(r.decoration&&!r.reason)throw Error('unexplained nonarmor feature');
  }
  if(cursor!==d.first+d.count)throw Error('source feature incomplete coverage');
  overrides.push({declarationKey:d.key,meshKey:d.meshKey,first:d.first,count:d.count,sourceKey:d.sourceKey,assetKey:d.sourceKey.replace(/:part:\d+(?::mirror:\d+)?$/,''),runs});changed+=runs.filter(r=>r.armorRef||r.moduleRef||r.decoration).reduce((n,r)=>n+r.count,0);
  if(part&&!partReviews.has(ordinal))partReviews.set(ordinal,{ordinal,sourceKey:d.sourceKey,descriptorHash:sha(canonical(part)),descriptor:part,review:'Explicit source feature schedule, checked against captured triangle-count range.'});
 }
 registry.specs[id]={...prior,overrides,sourceParts:[...partReviews.values()]};
 summary.push({id,overrides:overrides.length,resolvedTriangles:changed,originalUnknownTriangles:c.declarations.filter(d=>d.role==='unknown').reduce((n,d)=>n+d.count,0)});
}
const target=path.join(root,'handoff/qa/verified-surface-armor-registry-20261026.json');fs.writeFileSync(target,JSON.stringify(registry,null,2)+'\n');
const report=path.join(root,'handoff/qa/penetration-binding-review-20261027.json');fs.writeFileSync(report,JSON.stringify({schema:'TankForgePenetrationBindingReviewV1',registrySHA256:sha(fs.readFileSync(target)),summary},null,2)+'\n');
console.log(JSON.stringify({target,report,summary}));

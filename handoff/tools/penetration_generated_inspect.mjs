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
const root=fileURLToPath(new URL('../../',import.meta.url)),dir=path.join(root,'handoff/bundle');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v),sha=v=>crypto.createHash('sha256').update(v).digest('hex');
let raw=fs.existsSync(path.join(dir,'data.line'))?fs.readFileSync(path.join(dir,'data.line')):zlib.gunzipSync(Buffer.concat(fs.readdirSync(dir).filter(n=>n.startsWith('data.line.gz.part')).sort().map(n=>fs.readFileSync(path.join(dir,n)))));
function field(name){const marker=Buffer.from(JSON.stringify(name)+':');let i=raw.indexOf(marker)+marker.length,start=i,depth=0,q=false,e=false;for(;i<raw.length;i++){const b=raw[i];if(q){if(e)e=false;else if(b===92)e=true;else if(b===34)q=false;continue;}if(b===34)q=true;else if(b===123||b===91)depth++;else if((b===125||b===93)&&--depth===0)return JSON.parse(raw.subarray(start,i+1));}throw Error(name);}
const packets=field('surfaceCatalog'),vehicles=field('vehicles');raw=null;
Object.assign(packets,JSON.parse(fs.readFileSync(path.join(root,'handoff/qa/foldable-surface-packets-20261026.json'))));
// This receipt remains the original, immutable additional-review input. Do not
// make generation depend on its own previous output.

for(const [id,p]of Object.entries(packets)){const c=JSON.parse(p.catalog);console.log(id);for(const d of c.declarations.filter(d=>d.role==='unknown'&&d.sourceKey.startsWith('generated:'))){console.log(JSON.stringify({mesh:d.meshKey,first:d.first,count:d.count,owners:d.owners}));}}

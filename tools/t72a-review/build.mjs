// New self-contained review only. Never writes the production/test HTML.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {loadData} from '../../client/web/tools/load-data.mjs';
import {runtimeParts} from '../../client/web/tools/procedural-fleet-audit.mjs';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),HERE=fileURLToPath(new URL('./',import.meta.url));
const out=process.argv[2];if(!out)throw new Error('Usage: node tools/t72a-review/build.mjs <new-output.html>');if(fs.existsSync(out))throw new Error('Review output already exists; choose a new path');
const sources={},read=relative=>{
 const id='tf:'+relative;if(sources[id])return;sources[id]='';
 const text=fs.readFileSync(path.join(ROOT,relative),'utf8').replace(/(\bfrom\s*|\bimport\s*)(['"])(\.[^'"\n]+)\2/g,(_,a,q,target)=>{
  const next=path.posix.normalize(path.posix.join(path.posix.dirname(relative),target));read(next);return `${a}${q}tf:${next}${q}`;
 });sources[id]=text;
};read('client/web/src/gfx/tankmodel.js');read('client/web/src/gfx/math.js');
const data=loadData(),rt=runtimeParts('su_t72a',data);
const encode=x=>JSON.stringify(x).replace(/</g,'\\u003c');
const boot=`<script>window.REVIEW_LOADOUT=${encode(rt.loadout)};window.REVIEW_ARMOR=${encode(data.vehicles.su_t72a.armor)};const sources=${encode(sources)};const imports=Object.fromEntries(Object.entries(sources).map(([id,code])=>[id,URL.createObjectURL(new Blob([code],{type:'text/javascript'}))]));const map=document.createElement('script');map.type='importmap';map.textContent=JSON.stringify({imports});document.head.append(map);</script><script type="module">${fs.readFileSync(path.join(HERE,'viewer.js'),'utf8')}</script>`;
fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,fs.readFileSync(path.join(HERE,'viewer.html'),'utf8').replace('<!-- BOOT -->',boot));console.log(out,fs.statSync(out).size);

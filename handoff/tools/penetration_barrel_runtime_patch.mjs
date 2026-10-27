// Reconstruct the reviewed descendants lazily; do not duplicate the fleet's
// existing payloads and catalogs in a second enormous inline asset table.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const here=path.dirname(fileURLToPath(import.meta.url));
export function runtimeSource(staged,receipt){
 const helper=fs.readFileSync(path.join(here,'penetration_barrel_variants.mjs'),'utf8');
 let body=helper.slice(helper.indexOf('const canonical='),helper.indexOf('\nfunction field('));
 body=body.replace("const hash=v=>crypto.createHash('sha256').update(v).digest('hex');","const hash=v=>sha256Text(v);")
  .replace('export function retargetPacketVariants','function retargetPacketVariants')
  .replace(/^    assert\.equal\(hash\(Buffer\.from\(next\.payloads.*\r?\n/m,'')
  .replace(/^    assert\.equal\(hash\(Buffer\.from\(next\.rendererUpload.*\r?\n/m,'');
 assert.ok(!/\bBuffer\b|\bcrypto\b/.test(body));
 const pins=Object.fromEntries(Object.entries(staged.specs).map(([id,s])=>[id,{
  parentManifestHash:s.parentManifestHash,parentCatalogHash:s.parentCatalogHash,
  variants:s.variants.map(v=>({recordHash:v.recordHash,manifestHash:v.manifestHash,catalogHash:v.catalogHash}))
 }]));
 return `// BEGIN REVIEWED PENETRATION BARREL DESCENDANTS\n`+
 `var TF_REVIEWED_BARREL_PACKET=(()=>{\n`+
 `const assert=(ok,m)=>{if(!ok)throw Error(m||'barrel descendant assertion');};assert.ok=assert;assert.equal=(a,b,m)=>assert(a===b,m);assert.deepEqual=(a,b,m)=>assert(canonicalJson(a)===canonicalJson(b),m);\n`+
 body+'\n'+
 `const pins=${JSON.stringify(pins)},sourceAppHash=${JSON.stringify(receipt.sourceAppHash)},bindingRegistryHash=${JSON.stringify(receipt.bindingRegistryHash)},helperHash=${JSON.stringify(receipt.helperHash)},cache=new WeakMap();\n`+
 `return function(original,stock){const id=JSON.parse(stock.manifest).specId,p=pins[id];if(!p||stock.manifestHash!==p.parentManifestHash||stock.catalogHash!==p.parentCatalogHash)return stock;\n`+
 `const prior=cache.get(original);if(prior?.stock===stock)return prior.packet;\n`+
 `const raw=original.sourceApprovedPacket||original;const result=retargetPacketVariants({originalPacket:raw,normalizedPacket:stock,bindingRegistryHash,sourceAppHash,helperHash});\n`+
 `assert.equal(result.packet.variants.length,p.variants.length,'reviewed barrel descendant count');\n`+
 `result.packet.variants.forEach((v,i)=>{for(const k of ['recordHash','manifestHash','catalogHash'])assert.equal(v[k],p.variants[i][k],'reviewed barrel descendant hash:'+id+':'+k);});\n`+
 `cache.set(original,{stock,packet:result.packet});return result.packet;};})();\n`+
 `var TF_STOCK_PACKET_NORMALIZER=normalizeSurfacePacket;normalizeSurfacePacket=function(packet){const stock=TF_STOCK_PACKET_NORMALIZER(packet);return stock?.manifest?TF_REVIEWED_BARREL_PACKET(packet,stock):stock;};\n`+
 `// END REVIEWED PENETRATION BARREL DESCENDANTS\n`;
}
export function patch(source,staged,receipt){
 const begin='// BEGIN REVIEWED PENETRATION BARREL DESCENDANTS',end='// END REVIEWED PENETRATION BARREL DESCENDANTS';
 if(source.includes(begin)){const a=source.indexOf(begin),b=source.indexOf(end,a);assert.ok(b>a);source=source.slice(0,a)+source.slice(b+end.length);}
 // Keep the approved original variants available for the three supplemental
 // engineering derivatives; no mesh/record identity is inferred from a name.
 const screen='const packet=buildScreenPacket(parent,v,r.targetRegistrationHash),plates=screenArmorFor(id,v);';
 assert.equal(source.split(screen).length,2);
 if(!source.includes(screen+'packet.sourceApprovedPacket=p;'))source=source.replace(screen,screen+'packet.sourceApprovedPacket=p;');
 const anchor='  // client/web/src/game/localReplayAdmission.js';assert.equal(source.split(anchor).length,2);
 return source.replace(anchor,runtimeSource(staged,receipt)+anchor);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const arg=n=>{const i=process.argv.indexOf(n);assert.ok(i>=0&&process.argv[i+1]);return process.argv[i+1];};
 const input=path.resolve(arg('--input')),output=path.resolve(arg('--output')),stage=path.resolve(arg('--stage'));
 assert.ok(input!==output&&!fs.existsSync(output));
 fs.writeFileSync(output,patch(fs.readFileSync(input,'utf8'),JSON.parse(fs.readFileSync(path.join(stage,'runtime-variants.json'),'utf8')),JSON.parse(fs.readFileSync(path.join(stage,'receipt.json'),'utf8'))),{flag:'wx'});
 console.log(JSON.stringify({input,output,stagedDescendants:stage}));
}

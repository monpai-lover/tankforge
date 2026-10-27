#!/usr/bin/env node
// Stages a separately reviewable bundle; never rewrites its input in place.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha,screenInstallSource,screenNormalizationSource} from './penetration_screens.mjs';
const demand=(ok,message)=>{if(!ok)throw Error(message);};
export function buildScreenPatch(source,records,parentSHA256) {
  demand(sha(source)===parentSHA256,'Frozen parent app hash differs');
  demand(!source.includes('// BEGIN SUPPLEMENTAL SCREEN ENGINEERING'),'Preserve existing supplemental block');
  const normalizer='const value = normalizeVerifiedSurfacePacket(packet, VERIFIED_SURFACE_ARMOR_REGISTRY, sha256Text, canonicalJson);';
  demand(source.split(normalizer).length===2,'Unique registry normalization anchor required');
  source=source.replace(normalizer,'const value = recognizeSupplementalScreenPacket(packet) || normalizeVerifiedSurfacePacket(packet, VERIFIED_SURFACE_ARMOR_REGISTRY, sha256Text, canonicalJson);');
  const start=source.indexOf('  function installReviewedFoldableSurfacePackets(data) {');
  const end=source.indexOf('  // END REVIEWED FOLDABLE SURFACE PACKETS',start);
  demand(start>=0&&end>start,'Unique folding install hook required');
  let body=source.slice(start,end);const close=body.lastIndexOf('  }');
  demand(close>0&&!body.includes('installSupplementalScreenEngineering(data)'),'Original folding hook required');
  body=body.slice(0,close)+'    installSupplementalScreenEngineering(data);\n'+body.slice(close);
  source=source.slice(0,start)+body+source.slice(end);
  const anchor='  // client/web/src/game/localReplayAdmission.js';
  demand(source.split(anchor).length===2,'Unique replay bootstrap anchor required');
  const block='  // BEGIN SUPPLEMENTAL SCREEN ENGINEERING\n'+screenInstallSource(records)+screenNormalizationSource(records)+'  // END SUPPLEMENTAL SCREEN ENGINEERING\n';
  return source.replace(anchor,block+anchor);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),arg=n=>{const i=args.indexOf(n);demand(i>=0&&args[i+1],'Required '+n);return args[i+1];};
  const input=path.resolve(arg('--input')),output=path.resolve(arg('--output'));
  demand(input!==output&&!fs.existsSync(output),'Output must be a new separate staged file');
  const records=JSON.parse(fs.readFileSync(arg('--records'),'utf8'));
  const result=buildScreenPatch(fs.readFileSync(input,'utf8'),records,arg('--parent-sha'));
  fs.writeFileSync(output,result,{flag:'wx'});
  console.log(JSON.stringify({input,output,sha256:sha(result),canonicalInputUntouched:true}));
}

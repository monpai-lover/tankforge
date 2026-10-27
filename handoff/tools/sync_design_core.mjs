#!/usr/bin/env node
// Install only a rebuilt core that retains the active rendered-surface ABI.
// The original asset prefix stays intact. The recovered core also retains the
// separately proven legacy triangle-armour API, so both combat routes get APHE.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=new URL('../../',import.meta.url);
const begin='  // BEGIN APHE SURFACE COMBAT CORE\n';
const end='  // END APHE SURFACE COMBAT CORE\n';
const revisionNames=['tg_replay_revision','tg_surface_revision','tg_barrel_revision','tg_weapon_bindings_revision'];
const required=['memory','tg_alloc','tg_call','tg_free',...revisionNames];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

export function validateSurfaceCore(bytes){
  const module=new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module),[],'The active combat ABI has no host imports');
  const names=new Set(WebAssembly.Module.exports(module).map(x=>x.name));
  for(const name of required)assert.ok(names.has(name),`Refuse combat-core downgrade: missing ${name}`);
  const api=new WebAssembly.Instance(module,{}).exports;
  for(const name of revisionNames)assert.equal(api[name](),1,`Unsupported active ABI: ${name}`);
  return {sha256:sha(bytes),bytes:bytes.length,exports:[...names].sort(),revisions:Object.fromEntries(revisionNames.map(name=>[name,api[name]()])),
    originalActiveSha256:'7095c82c373534c7590ca882f75005059f4f849586ad2b7154c0a5c524656c25'};
}
export function patchDesignCore(source,bytes){
  const receipt=validateSurfaceCore(bytes);
  const block=begin+'  var TF_APHE_SURFACE_CORE = '+JSON.stringify(Buffer.from(bytes).toString('base64'))+';\n'+end;
  let text=source;
  if(text.includes(begin)){
    assert.equal(text.split(begin).length,2);assert.equal(text.split(end).length,2);
    const a=text.indexOf(begin),b=text.indexOf(end,a)+end.length;text=text.slice(0,a)+block+text.slice(b);
  }else{
    const anchor='<script>(() => {\n';assert.ok(text.startsWith(anchor));text=anchor+block+text.slice(anchor.length);
  }
  const anchor='    const data = JSON.parse(document.getElementById("tf-data").textContent);';
  const old=anchor+'\n    data.designCore = TF_APHE_SURFACE_CORE;';
  const next=old+'\n    if (data.surfaceCore) data.surfaceCore = TF_APHE_SURFACE_CORE;';
  if(!text.includes(next)){
    assert.equal(text.split(anchor).length,2);
    text=text.replace(text.includes(old)?old:anchor,next);
  }
  return {text,receipt};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  const option=name=>{const at=process.argv.indexOf(name);return at<0?null:process.argv[at+1];};
  const wasm=option('--wasm')||fileURLToPath(new URL('target/wasm32-unknown-unknown/release/tg_design_wasm.wasm',root));
  const app=fileURLToPath(new URL('handoff/bundle/app.js.html',root));
  const source=fs.readFileSync(app,'utf8');const {text,receipt}=patchDesignCore(source,fs.readFileSync(wasm));
  if(process.argv.includes('--write'))fs.writeFileSync(app,text);
  else if(process.argv.includes('--check'))assert.equal(text,source,'Delivered combat core is stale');
  if(option('--receipt'))fs.writeFileSync(option('--receipt'),JSON.stringify({...receipt,appSha256:sha(text),preservedOriginalAssetPrefix:true,upgradedBothCombatRoutes:true,preservedLegacyTriangleGeometry:true},null,2)+'\n');
  console.log(JSON.stringify({...receipt,action:process.argv.includes('--write')?'installed':process.argv.includes('--check')?'checked':'validated'}));
}

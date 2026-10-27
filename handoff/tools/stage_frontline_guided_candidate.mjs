#!/usr/bin/env node
// Explicit candidate output only. Production synchronization remains the root integrator's job.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {patchFrontlineGuidedSourceHooks} from './sync_frontline_guided.mjs';
import {patchAirframeLimits} from './sync_airframe_limits.mjs';
const names=['frontline_lod.js','frontline_contact_visual.js','frontline_local_flight.js','frontline_aircraft_visual.js','frontline_existing_aircraft.js','frontline_guided_control.js','frontline_ordnance_visual.js','frontline_gun_tracer_visual.js','frontline_airwar_presentation.js','frontline_naval_visual.js','frontline_existing_runtime.js','frontline_render_gate.js','frontline_facility_visual.js','frontline_support_visual.js','frontline_shared_lobby.js','frontline_client.js'];
export function composeFrontlineGuidedCandidate(source){
  const start='    // BEGIN NATIVE FRONTLINE CLIENT\n',end='    // END NATIVE FRONTLINE CLIENT\n';
  const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,'Existing native frontend source block required');
  const block=start+names.map(name=>fs.readFileSync(new URL(name,import.meta.url),'utf8')).join('\n')+end;
  let candidate=source.slice(0,a)+block+source.slice(b+end.length);
  candidate=patchFrontlineGuidedSourceHooks(candidate);
  if(source.includes('/* TF_AIRFRAME_LIMITS_BEGIN */'))candidate=patchAirframeLimits(candidate);
  return candidate;
}
function main(){
  const args=process.argv.slice(2);let input,output;
  for(let i=0;i<args.length;i++){if(args[i]==='--input')input=args[++i];else if(args[i]==='--output')output=args[++i];else throw Error('Use --input <bundle> --output <new candidate.html>');}
  assert.ok(input&&output,'Explicit input and output candidate paths required');const read=fs.realpathSync(input),write=path.resolve(output),canonical=fileURLToPath(new URL('../bundle/app.js.html',import.meta.url));
  const normal=p=>path.resolve(p).replace(/\\/g,'/').toLowerCase();assert.notEqual(normal(read),normal(write),'Refusing in-place output');assert.notEqual(normal(write),normal(canonical),'Refusing canonical application output');assert.ok(!fs.existsSync(write),'Refusing existing candidate output');
  const candidate=composeFrontlineGuidedCandidate(fs.readFileSync(read,'utf8'));fs.mkdirSync(path.dirname(write),{recursive:true});fs.writeFileSync(write,candidate,{flag:'wx'});console.log(JSON.stringify({input:read,output:write,bytes:Buffer.byteLength(candidate)}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main();

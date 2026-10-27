#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
const assert=(value,message)=>{if(!value)throw Error(message);};
export function patchAirVortex(source,helper) {
  assert(!source.includes('TF_AIR_VORTEX_PRESENTATION'),'Preserve existing vortex integration');
  const once=(a,b)=>{assert(source.split(a).length===2,'Unique vortex anchor required:'+a.slice(0,70));source=source.replace(a,b);};
  const block='  // TF_AIR_VORTEX_PRESENTATION\n'+helper.replace(/^export /gm,'')+
    '\n  var TFAirVortex=Object.assign(createAirVortexPool(),{context:()=>null});\n';
  once('  var Aircraft = class {',block+'  var Aircraft = class {');
  once('    const fx = new Effects();','    const fx = new Effects();\n    TFAirVortex.context=()=>G4;');
  once('      // one flight core for whichever type flies: its airframe first (spawn resets the damage)',
    '      this._airVortexLife=(this._airVortexLife||0)+1;if(typeof TFAirVortex!=="undefined")TFAirVortex.remove(this);\n      // one flight core for whichever type flies: its airframe first (spawn resets the damage)');
  once('      if (this.debris?.length) this._poseDebris(pos, q);',
    '      if (this.debris?.length) this._poseDebris(pos, q);\n      if(typeof TFAirVortex!=="undefined")TFAirVortex.samplePlane(this,TFAirVortex.context());');
  once('      this.disposed = true;\n      TFAllAircraftInteriors.dispose(this);',
    '      this.disposed = true;\n      if(typeof TFAirVortex!=="undefined")TFAirVortex.remove(this);\n      TFAllAircraftInteriors.dispose(this);');
  const effectsStart=source.indexOf('  var Effects = class {'),effectsEnd=source.indexOf('    // ------------------------------------------------------------------ presets',effectsStart);
  assert(effectsStart>=0&&effectsEnd>effectsStart,'Canonical Effects build section missing');
  const original=source.slice(effectsStart,effectsEnd),anchor='      this.beams.length = 0;';
  assert(original.split(anchor).length===2,'Unique Effects beam-reset anchor required');
  source=source.slice(0,effectsStart)+original.replace(anchor,
    '      this.alphaCount=TFAirVortex.write(this.alpha,this.alphaCount,cam,TFAirVortex.context());\n'+anchor)+source.slice(effectsEnd);
  return source;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),get=n=>{const i=args.indexOf(n);assert(i>=0&&args[i+1],'Required '+n);return args[i+1];};
  const input=path.resolve(get('--input')),output=path.resolve(get('--output'));
  assert(input!==output&&!fs.existsSync(output),'Output must be a new staged path');
  const source=fs.readFileSync(input,'utf8'),helper=fs.readFileSync(new URL('air_vortex.js',import.meta.url),'utf8');
  const result=patchAirVortex(source,helper);fs.writeFileSync(output,result,{flag:'wx'});
  console.log(JSON.stringify({input,output,parentSHA256:sha(source),sha256:sha(result),inputUntouched:true}));
}

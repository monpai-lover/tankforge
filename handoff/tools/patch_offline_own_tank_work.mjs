#!/usr/bin/env node
// Stage two local-flight presentation optimizations into an explicit new candidate only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const BEGIN='/* TF_OFFLINE_TANK_VISUAL_CACHE_BEGIN */',END='/* TF_OFFLINE_TANK_VISUAL_CACHE_END */';
const helper=fs.readFileSync(new URL('./offline_tank_visual_cache.js',import.meta.url),'utf8');
export function patchOfflineOwnTankWork(source){
  const block=BEGIN+'\n'+helper+'\n'+END+'\n';
  const gearCall=`      M2.updateRunningGear({
        lod: camDist < 70 ? 0 : camDist < 220 ? 1 : 2,
        lifts,
        travel: G4.travel,
        slack: { 1: 1 + 0.3 * (G4.sag[1].x - 1), [-1]: 1 + 0.3 * (G4.sag[-1].x - 1) },
        ground: { 1: groundUnder(1), [-1]: groundUnder(-1) },
        wheels: G4.veh.wheelPose(),
        openBelts: G4.veh.runningGearPose()
      });`;
  const cachedGearCall=gearCall.replace('M2.updateRunningGear({','TFOfflineTankVisualCache.update(M2, {').replace('      });','      }, flying && !G4.veh.brokenTracks);');
  if(source.includes(BEGIN)){
    const start=source.indexOf('    function update(dt) {'),end=source.indexOf('    setMode("garage");',start);
    assert.ok(start>=0&&end>start,'Ordinary single-player update region required');
    const body=source.slice(start,end).replace(/\r\n/g,'\n');
    for(const hook of ['      if (!flying && !orbit && !G4.ret && !testing) {','      if (!flying && !inSight && !orbit && !testing) {',cachedGearCall])assert.equal(body.split(hook).length-1,1,'One own-tank hook required: '+hook.slice(0,120));
    const a=source.indexOf(BEGIN),b=source.indexOf(END,a)+END.length;
    assert.ok(b>a+END.length,'Complete existing own-tank helper required');
    return source.slice(0,a)+block+source.slice(b).replace(/^\r?\n/,'');
  }
  let text=source.replace(/\r\n/g,'\n');
  function updateReplace(needle,replacement){
    const a=text.indexOf('    function update(dt) {'),b=text.indexOf('    setMode("garage");',a);
    assert.ok(a>=0&&b>a,'Ordinary single-player update region required');
    const body=text.slice(a,b);assert.equal(body.split(needle).length-1,1,'One own-tank hook required: '+needle.slice(0,120));
    text=text.slice(0,a)+body.replace(needle,replacement)+text.slice(b);
  }
  updateReplace('      if (!orbit && !G4.ret && !testing) {','      if (!flying && !orbit && !G4.ret && !testing) {');
  updateReplace('      if (!inSight && !orbit && !testing) {','      if (!flying && !inSight && !orbit && !testing) {');
  updateReplace(gearCall,cachedGearCall);
  // Keep this block before the profiler so either patcher can refresh its own helper independently.
  const anchor=text.includes('/* TF_OFFLINE_FLIGHT_PROFILE_20261026 */')?'/* TF_OFFLINE_FLIGHT_PROFILE_20261026 */':'  var Node = class {';
  assert.equal(text.split(anchor).length-1,1,'One helper insertion anchor required');
  return text.replace(anchor,block+anchor);
}
function main(){
  const args=process.argv.slice(2);let input,output;
  for(let i=0;i<args.length;i++){if(args[i]==='--input')input=args[++i];else if(args[i]==='--output')output=args[++i];else throw Error('Use --input <existing bundle> --output <new candidate.html>');}
  assert.ok(input&&output,'Explicit --input and --output candidate paths are required');
  const inputPath=fs.realpathSync(input),outputPath=path.resolve(output),canonical=fileURLToPath(new URL('../bundle/app.js.html',import.meta.url));
  const normalize=p=>path.resolve(p).replace(/\\/g,'/').toLowerCase();
  assert.notEqual(normalize(inputPath),normalize(outputPath),'Refusing in-place write: input and candidate must be different');
  assert.notEqual(normalize(outputPath),normalize(canonical),'Refusing canonical application output; choose a new candidate path');
  assert.ok(!fs.existsSync(outputPath),'Refusing to replace an existing output; choose a new candidate path');
  const candidate=patchOfflineOwnTankWork(fs.readFileSync(inputPath,'utf8'));
  fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.writeFileSync(outputPath,candidate,{flag:'wx'});
  console.log(JSON.stringify({input:inputPath,output:outputPath,bytes:Buffer.byteLength(candidate)}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main();

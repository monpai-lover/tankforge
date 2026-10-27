#!/usr/bin/env node
// Compose an explicitly opted-in takeoff diagnostic into a NEW candidate only.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {patchOfflineFlightProfile} from './patch_offline_flight_profile.mjs';
const BEGIN='/* TF_AUTO_TAKEOFF_RUNNER_BEGIN_20261027 */',END='/* TF_AUTO_TAKEOFF_RUNNER_END_20261027 */';
const helper=fs.readFileSync(new URL('./auto_takeoff_runner.js',import.meta.url),'utf8').trim();
export function patchAutoTakeoffRunner(source){
  let text=source.replace(/\r\n/g,'\n');
  if(text.includes(BEGIN)){
    assert.equal(text.split(BEGIN).length-1,1,'One auto-takeoff helper');assert.equal(text.split(END).length-1,1,'One helper end');
    return text.slice(0,text.indexOf(BEGIN))+helper+text.slice(text.indexOf(END)+END.length);
  }
  text=patchOfflineFlightProfile(text);
  const replace=(needle,replacement)=>{assert.equal(text.split(needle).length-1,1,'One exact auto-takeoff consumer hook: '+needle.slice(0,140));text=text.replace(needle,replacement);};
  replace('  var Node = class {',helper+'\n  var Node = class {');
  replace('  if (params.get("tfOfflineProfile") !== "1") return null;','  if (params.get("tfOfflineProfile") !== "1" && params.get("tfAutoTakeoff") !== "1") return null;');
  replace('console.log(prefix + JSON.stringify(value)); displayReport(value);','console.log(prefix + JSON.stringify(value)); displayReport(value); if (typeof TFAutoTakeoffRunner !== "undefined" && TFAutoTakeoffRunner) TFAutoTakeoffRunner.onProfile(value);');
  const budget='(params.get("tfAutoTakeoffTypes") === "all" ? 4800 : 600)';
  replace('if (reports >= 120)', 'if (reports >= '+budget+')');
  replace('reason: "120-report diagnostic limit; reload to restart"','reason: "Automatic takeoff diagnostic report limit; reload to restart"');
  replace('maxReports: 120, intervalMs: 1000','maxReports: '+budget+', intervalMs: 1000');
  replace('  log({ kind: "ready", revision: "offline-flight-profiler-20261026-v2",',`  // A background tab may receive no RAF at all; discard cross-visibility windows.
  const __tfResetProfileVisibility = () => { active = false; resetWindow(); };
  if (typeof document === "object") document.addEventListener?.("visibilitychange", __tfResetProfileVisibility);
  if (typeof window === "object") { window.addEventListener?.("blur", __tfResetProfileVisibility); window.addEventListener?.("focus", __tfResetProfileVisibility); }
  log({ kind: "ready", revision: "offline-flight-profiler-20261026-v2",`);
  replace('      advanceAircraftInput(G4.air, dt, G4, pads, G4.airInputFocused && !document.hidden && !typing);','      if (TFAutoTakeoffRunner) TFAutoTakeoffRunner.beforeInput(dt);\n      advanceAircraftInput(G4.air, dt, G4, pads, G4.airInputFocused && !document.hidden && !typing);');
  const install=`    var TFAutoTakeoffRunner = createAutoTakeoffRunner({
      state: () => G4, types: AIRCRAFT_TYPES, document,
      launch: id => flyType(id), toGarage, setMap: setMapChoice,
      readCounts: () => ({ surfaceActors: G4.combat?.surfaceOwner?.actors?.size ?? null,
        ordnance: airOrdnance.length, hitcamActive: !!hitcam.active,
        replayDischarges: G4.localReplay?.discharges?.size ?? null,
        replayHistories: G4.localReplay?.histories?.size ?? null })
    });
    if (TFAutoTakeoffRunner) frame = TFAutoTakeoffRunner.wrapFrame(frame);
`;
  replace('    requestAnimationFrame(frame);\n    window.__tf = {',install+'    requestAnimationFrame(frame);\n    window.__tf = {');
  return text;
}
function main(){
  const argv=process.argv.slice(2);let input,output;
  for(let i=0;i<argv.length;i++){if(argv[i]==='--input')input=argv[++i];else if(argv[i]==='--output')output=argv[++i];else throw Error('Use --input <existing HTML> --output <new D: candidate.html>');}
  assert.ok(input&&output,'Explicit input/output required');
  const original=fs.realpathSync(input),candidate=path.resolve(output),canonical=fileURLToPath(new URL('../bundle/app.js.html',import.meta.url));
  const norm=p=>path.resolve(p).replaceAll('\\','/').toLowerCase();
  assert.notEqual(norm(original),norm(candidate),'Refusing in-place candidate write');assert.notEqual(norm(candidate),norm(canonical),'Refusing canonical bundle write');
  assert.ok(!fs.existsSync(candidate),'Refusing to replace existing output');assert.match(candidate,/^D:[\\/]/i,'Large diagnostic output must use D:');
  const result=patchAutoTakeoffRunner(fs.readFileSync(original,'utf8'));fs.mkdirSync(path.dirname(candidate),{recursive:true});fs.writeFileSync(candidate,result,{flag:'wx'});
  console.log(JSON.stringify({input:original,output:candidate,bytes:Buffer.byteLength(result),query:'?tfAutoTakeoff=1',allAircraftQuery:'?tfAutoTakeoff=1&tfAutoTakeoffTypes=all',scope:'Candidate tooling; no browser performance or successful takeoff claimed.'}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main();

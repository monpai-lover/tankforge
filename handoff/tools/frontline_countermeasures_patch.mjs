#!/usr/bin/env node
// Compose only a new candidate output. Root owns canonical bundle integration.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const sha=s=>createHash('sha256').update(s).digest('hex');
const PREVIOUS_CM_BLOCK_SHA256='127eebfb755925b59da905040072b41576ef472d6192d9c832c163f91adfb74c';
export function patchFrontlineCountermeasures(source,helper=fs.readFileSync(new URL('frontline_countermeasures.js',import.meta.url),'utf8')){
  let text=source.replace(/\r\n/g,'\n');helper=helper.replace(/\r\n/g,'\n');
  const block='  // TF_NATIVE_CM_BEGIN\n'+helper+'\n  var TFNativeCMVisual=Object.assign(createFrontlineCountermeasureVisual(),{context:()=>null});\n  // TF_NATIVE_CM_END\n';
  function once(a,b){assert.equal(text.split(a).length-1,1,'One native CM source anchor required: '+a.slice(0,110));text=text.replace(a,b);}
  function reasonHook(){
    const before="          const feedback=m.code==='service_rejected'?",after="          const feedback=m.code==='countermeasure_rejected'?frontlineCountermeasureReason(m.message,typeof LANG==='string'?LANG:'zh'):m.code==='service_rejected'?";
    if(text.includes(after))assert.equal(text.split(after).length-1,1,'One native CM feedback hook required');
    else once(before,after);
  }
  if(text.includes('// TF_NATIVE_CM_BEGIN')){
    const begin='  // TF_NATIVE_CM_BEGIN\n',end='  // TF_NATIVE_CM_END\n';
    assert.equal(text.split(begin).length-1,1,'One owned native CM block required');assert.equal(text.split(end).length-1,1,'One owned native CM block end required');
    const start=text.indexOf(begin),stop=text.indexOf(end,start)+end.length,prior=text.slice(start,stop);
    if(prior!==block){
      const accepted=[PREVIOUS_CM_BLOCK_SHA256];
      // Exact previous owned block after the reviewed optional render-origin
      // packing change, before the existing readable-reasons migration.
      if(text.includes('/* TF_RENDER_PRECISION_BEGIN */'))accepted.push('bcce82c4912d5ce84cbfb5bcf263499de486abca720b981752bf639857d7949c');
      assert.ok(accepted.includes(sha(prior)),'Installed native CM helper block hash differs; preserve source and review');
    }
    assert.ok(text.includes('TF_CM_ELIGIBLE_PAIR'),'Installed local decoy eligibility hook missing');
    const fxCamera=text.includes('/* TF_RENDER_PRECISION_BEGIN */')?'relativeCam':'cam';
    for(const hook of ['const nativeCM=createFrontlineCountermeasureControl','nativeCM.accept(air,unit','nativeCM.action(air,controlled(),name)','value.decoys=Array.isArray(pose.decoys)?pose.decoys:[];',
      'TFNativeCMVisual.accept(f.aircrafts',`TFNativeCMVisual.write(this.add,this.addCount,${fxCamera},TFNativeCMVisual.context(),'flares')`,
      `TFNativeCMVisual.write(this.alpha,this.alphaCount,${fxCamera},TFNativeCMVisual.context(),'chaff')`,'nativeCM.clear();TFNativeCMVisual.clear()',
      "if(air.nativeAuthority)return G4.frontline?.handleAircraftAction('cm')??false;"])
      assert.equal(text.split(hook).length-1,hook==='nativeCM.clear();TFNativeCMVisual.clear()'?3:1,'Installed native CM integration hook differs after source recomposition: '+hook);
    if(prior!==block)text=text.slice(0,start)+block+text.slice(stop);
    reasonHook();
    return text;
  }
  once('  var Aircraft = class {',block+'  var Aircraft = class {');
  once('    const fx = new Effects();','    const fx = new Effects();\n    TFNativeCMVisual.context=()=>G4;');
  const effectStart=text.indexOf('  var Effects = class {'),effectEnd=text.indexOf('    // ------------------------------------------------------------------ presets',effectStart);
  assert.ok(effectStart>=0&&effectEnd>effectStart,'Canonical Effects build required');
  const effects=text.slice(effectStart,effectEnd),beamReset='      this.beams.length = 0;';
  assert.equal(effects.split(beamReset).length-1,1,'One Effects build reset required');
  text=text.slice(0,effectStart)+effects.replace(beamReset,
    "      this.addCount=TFNativeCMVisual.write(this.add,this.addCount,cam,TFNativeCMVisual.context(),'flares');\n"+
    "      this.alphaCount=TFNativeCMVisual.write(this.alpha,this.alphaCount,cam,TFNativeCMVisual.context(),'chaff');\n"+beamReset)+text.slice(effectEnd);
  once('function createFrontlineExistingRuntime({f,mine,controlled,controlledAirModel,send,height,note,shared}) {',
    `function createFrontlineExistingRuntime({f,mine,controlled,controlledAirModel,send,height,note,shared}) {
  const nativeCM=createFrontlineCountermeasureControl({send,scope:()=>({unit:controlled(),epoch:f.epoch,nextSequence:()=>++f.seq}),now:()=>G4.time,control:airCtl,reason:airReason,
    onRelease:(air,event)=>{const ctl=airCtl(air),diag=ctl.cmDiag||(ctl.cmDiag={events:0,requests:0,started:0,dropped:{},last:null});diag.events++;diag.last={id:'NCM'+event.seq,t:G4.time,kinds:event.kinds};
      event.kinds.forEach((kind,index)=>{diag.requests++;const cue=kind==='flares'?'air_flare':'air_chaff',full=sound.full,voice=full?.play?.(cue,{position:air.plane.position,emitterId:'native:air:cm:'+key(controlled()?.unit)+':'+event.seq+':'+kind,gain:.85,time:G4.time+index*.04});if(voice)diag.started++;else diag.dropped.unavailable=(diag.dropped.unavailable||0)+1;});}});`);
  once('if(!unit?.aircraft||!model){bridge.unbind();shownLife=null;return;}',
    'if(!unit?.aircraft||!model){nativeCM.clear();bridge.unbind();shownLife=null;return;}');
  once('    const air=bridge.bind(model,unit);air.boardedAt??=performance.now();',
    '    const air=bridge.bind(model,unit);air.boardedAt??=performance.now();\n    nativeCM.accept(air,unit,{tick:f.lastTick,epoch:f.epoch});');
  once('  function action(name,stamp){\n    const air=bridge.getair();if(!air)return;',
    "  function action(name,stamp){\n    const air=bridge.getair();if(!air)return;\n    if(['cm','cmPeriodic','cmProgram'].includes(name))return nativeCM.action(air,controlled(),name);");
  once("if(['bots','jettison','engine','cm','cmPeriodic','cmProgram'].includes(name))", "if(['bots','jettison','engine'].includes(name))");
  once('    garageContext=context;bridge.unbind();shownLife=null;',
    '    garageContext=context;nativeCM.clear();TFNativeCMVisual.clear();bridge.unbind();shownLife=null;');
  once('    bridge.unbind();shownLife=null;garageContext=null;',
    '    nativeCM.clear();TFNativeCMVisual.clear();bridge.unbind();shownLife=null;garageContext=null;');
  once('  function release(leaving=false){guided?.clear();',
    '  function release(leaving=false){nativeCM.clear();TFNativeCMVisual.clear();guided?.clear();');
  once("          for(const k of ['speed','ground_speed','agl','sample_time','pitch_surface','roll_surface','yaw_surface','gear','flap','airbrake','slat'])value[k]=pose[k];",
    "          for(const k of ['speed','ground_speed','agl','sample_time','pitch_surface','roll_surface','yaw_surface','gear','flap','airbrake','slat'])value[k]=pose[k];\n          // Public observed decoys only; countermeasure stock remains private.\n          value.decoys=Array.isArray(pose.decoys)?pose.decoys:[];");
  once('          f.companies=m.companies;f.objectives=m.objectives;f.lastTick=m.tick||f.lastTick;',
    '          TFNativeCMVisual.accept(f.aircrafts,{battle:m.battle??f.room?.battle,tick:m.tick??f.lastTick,time:G4.time});\n          f.companies=m.companies;f.objectives=m.objectives;f.lastTick=m.tick||f.lastTick;');
  once("if(m.op==='left'){f.ordnancePresentation.clear();f.missiles=[];}",
    "if(m.op==='left'){TFNativeCMVisual.clear();f.ordnancePresentation.clear();f.missiles=[];}");
  once('frontlineDisposed=true;frontline.ordnancePresentation.dispose();',
    'frontlineDisposed=true;TFNativeCMVisual.clear();frontline.ordnancePresentation.dispose();');
  once('    function cmRelease(air) {\n      const ctl',
    "    function cmRelease(air) {\n      // Native manual and periodic releases send intent before any local mutation.\n      if(air.nativeAuthority)return G4.frontline?.handleAircraftAction('cm')??false;\n      const ctl");
  const begin=text.indexOf('    function decoysSeduce(o, half) {'),end=text.indexOf('    /** One step of a missile\'s own guidance',begin);
  assert.ok(begin>=0&&end>begin,'Original local decoy function required');
  let decoys=text.slice(begin,end);
  const mark='        (f.tested || (f.tested = /* @__PURE__ */ new Set())).add(o);\n';
  assert.equal(decoys.split(mark).length-1,1,'One original per-pair decoy test mark required');decoys=decoys.replace(mark,'');
  const eligible='        if (angleOf(fl, tl) > Math.max(half, 4 * D2R)) continue;';
  assert.equal(decoys.split(eligible).length-1,1,'One local decoy target-angle gate required');
  decoys=decoys.replace(eligible,eligible+"\n        // TF_CM_ELIGIBLE_PAIR: one chance after actual seeker FOV/range/LOS admission.\n        if(!missileSees(o,g.phase==='ir'?{flare:f}:{chaff:f},half))continue;\n"+mark.trimEnd());
  text=text.slice(0,begin)+decoys+text.slice(end);
  reasonHook();
  return text;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),get=n=>{const i=args.indexOf(n);assert.ok(i>=0&&args[i+1],'Required '+n);return args[i+1];};
  const input=path.resolve(get('--input')),output=path.resolve(get('--output')),canonical=fileURLToPath(new URL('../bundle/app.js.html',import.meta.url));
  const norm=p=>path.resolve(p).replace(/\\/g,'/').toLowerCase();
  assert.notEqual(norm(input),norm(output),'Refusing in-place output');assert.notEqual(norm(output),norm(canonical),'Root owns canonical bundle integration');assert.ok(!fs.existsSync(output),'Preserve existing output');
  const source=fs.readFileSync(input,'utf8'),candidate=patchFrontlineCountermeasures(source);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,candidate,{flag:'wx'});
  console.log(JSON.stringify({input,output,parentSha256:sha(source),sha256:sha(candidate),inputUntouched:true}));
}

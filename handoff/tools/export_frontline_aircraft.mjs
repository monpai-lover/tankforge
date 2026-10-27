#!/usr/bin/env node
import {aircraftPerformancePrelude} from './aircraft_performance/runtime.mjs';
// Export production configuration only. No browser, rendering, asset rewrite or combat simulation.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {Readable} from 'node:stream';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const BASELINE='/home/boyang/Desktop/worldbox/tankforge-jet-fixes/handoff/tests/out/parked-roll-f3c6d88-20261024/committed-data.line';
const PIN='56eaa206dfda19a831d1c82c869e411d1c3ba7e82d979ff6f96b13dd3a0366ee';
const CURRENT_PIN='7a35444f326a3234f7bdf6ad84ff8d2a561edc00d1824740ebc236dd6bf46bd4';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');

// Default: current tracked gzip parts. Explicit raw baseline remains a pinned historical audit.
// Capture only requested top-level values; never create a whole uncompressed data.line.
async function baselineValues(filename,names){
  const wanted=new Set(names),ranges={},captured={},hash=crypto.createHash('sha256');
  let input;
  if(filename)input=fs.createReadStream(filename,{highWaterMark:256*1024});
  else{
    const dir=path.join(ROOT,'handoff/bundle'),parts=fs.readdirSync(dir).filter(n=>/^data\.line\.gz\.part\d+$/.test(n)).sort();
    assert.ok(parts.length,'Current tracked gzip data parts are required');
    input=Readable.from((async function*(){for(const name of parts)for await(const chunk of fs.createReadStream(path.join(dir,name),{highWaterMark:256*1024}))yield chunk;})()).pipe(zlib.createGunzip({chunkSize:256*1024}));
  }
  let offset=0,depth=0,inString=false,escape=false,key='',state='key',collect=false,start=-1,active=null;
  for await(const chunk of input){const size=chunk.length;hash.update(chunk);let captureFrom=active?0:-1;
    for(let i=0;i<size;i++){
      const b=chunk[i],at=offset+i;
      if(inString){if(escape){escape=false;if(collect)key+=String.fromCharCode(b);continue;}if(b===92){escape=true;continue;}if(b===34){inString=false;if(collect){state='colon';collect=false;}else if(depth===1)state='after';}else if(collect)key+=String.fromCharCode(b);continue;}
      if(b===34){inString=true;if(depth===1&&state==='key'){key='';collect=true;}continue;}
      if(b===123||b===91){if(depth===1&&state==='value'){active=wanted.has(key)?key:null;start=at;state='after';if(active){captured[active]=[];captureFrom=i;}}depth++;continue;}
      if(b===125||b===93){depth--;if(depth===1&&active){captured[active].push(chunk.subarray(captureFrom,i+1));ranges[active]=[start,at+1];active=null;captureFrom=-1;}continue;}
      if(depth===1){if(b===58&&state==='colon')state='value';else if(b===44)state='key';}
    }if(active)captured[active].push(chunk.subarray(captureFrom));offset+=size;
  }
  const digest=hash.digest('hex');assert.equal(digest,filename?PIN:CURRENT_PIN,'Only the verified tracked data or explicit frozen baseline is accepted');
  const values={};for(const name of names){if(!ranges[name])continue;values[name]=JSON.parse(Buffer.concat(captured[name]).toString());delete captured[name];}
  return {values,sha256:digest,ranges};
}

export async function exportProfiles({baseline,appPath}={}){
  const app=fs.readFileSync(appPath||path.join(ROOT,'handoff/bundle/app.js.html'),'utf8'),sections={};
  const section=(name,a,b)=>{const start=app.indexOf(a),end=app.indexOf(b,start);assert.ok(start>=0&&end>start,`Production section missing:${name}`);const text=app.slice(start,end);sections[name]={startLine:app.slice(0,start).split('\n').length,sha256:sha(text)};return text;};
  const source=await baselineValues(baseline,['projectiles','machineGuns','aircraftModels','aircraftRebuilds','storeModels']);
  const data=source.values;
  const context=vm.createContext({console,atob,data,G4:{bulletShells:new Map(),airCustom:{},airLoadout:{}},RE_FACTOR:{},AIR_PARTS:[],AIR_SKIN:[],AIR_PARTS_JET:[],AIR_SKIN_JET:[],
    // The production decoder reads only metadata after inflation. Validate the actual compressed bytes,
    // but retain no GPU meshes/textures or model vertex arrays in the exported profile.
    inflate:async blob=>{const b=zlib.inflateSync(Buffer.from(blob,'base64'));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);},
    // Aircraft.spawn clears the cosmetic wingtip trail. It is not a physics
    // configuration input, and this metadata-only VM has no presentation pool.
    TFAirVortex:{remove:()=>{}},
    localStorage:{getItem:()=>null},Math:Object.assign(Object.create(Math),{random:()=>0.5})});
  const run=code=>vm.runInContext(code,context,{timeout:20000});
  if(!baseline&&app.includes('// BEGIN PRIMARY PROJECTILE FILLER CORRECTIONS')){
    run(section('primaryProjectileFillers','  // BEGIN PRIMARY PROJECTILE FILLER CORRECTIONS','  // END PRIMARY PROJECTILE FILLER CORRECTIONS'));
    run('applyPrimaryProjectileFillerCorrections(data.projectiles)');
  }
  // Execute the delivered model preludes rather than substitute empty helpers
  // or a previous source helper revision. Their functions remain source-bound
  // even though this exporter does not construct a renderer or playable plane.
  for(const [name,begin,end]of [
    ['me262Sight','/* TF_ME262_SIGHT_BEGIN */','/* TF_ME262_SIGHT_END */'],
    ['mig17Wing','/* TF_MIG17_WING_BEGIN */','/* TF_MIG17_WING_END */'],
    ['aircraftCull','/* TF_AIRCRAFT_CULL_BEGIN */','/* TF_AIRCRAFT_CULL_END */']
  ])if(app.includes(begin)){assert.equal(app.split(begin).length,2,`Ambiguous delivered prelude:${name}`);run(section(name,begin,end));}
  if(app.includes('/* TF_GUIDED_AIRCRAFT_VARIANTS_BEGIN */'))run(section('guidedAircraftVariants','/* TF_GUIDED_AIRCRAFT_VARIANTS_BEGIN */','/* TF_GUIDED_AIRCRAFT_VARIANTS_END */'));
  if(app.includes('var TFEngineLayout = '))run(section('modelUpgradePrelude','  var FLIGHT_FIXED = ','  var aircraftGeometry = '));
  else run(aircraftPerformancePrelude());
  run(section('aircraftGeometry','  var aircraftGeometry = (() => {','  // NF-01 gear'));
  for(const name of ['AIR_PARTS','AIR_SKIN','AIR_PARTS_JET','AIR_SKIN_JET']){
    const marker=`  var ${name} = [`,start=app.indexOf(marker),end=app.indexOf('\n  ];',start)+5;
    assert.ok(start>=0&&end>start);run(app.slice(start,end));
    sections[name]={startLine:app.slice(0,start).split('\n').length,sha256:sha(app.slice(start,end))};
  }
  run(section('AIRCRAFT_TYPES','  var AIRCRAFT_TYPES = {','  // ---- hangar fighters'));
  run(section('fightersAndTypeConstruction','  var AIR_FIGHTERS = {','  // Optional flight diagnostics'));
  run(section('registerAndDecodeModels','  function registerAircraftFrame(','  function aircraftInstrumentMeta('));
  run(section('aircraftInstrumentMeta','  function aircraftInstrumentMeta(','  /**\n   * A model\'s cockpit'));
  const sightGlass=app.match(/  var AIR_SIGHT_GLASS = [^\n]+/);assert.ok(sightGlass);run(sightGlass[0]);
  run(section('applyAircraftRebuilds','  function applyAircraftRebuilds(','  async function decodePilotModel('));
  await run('decodeAircraftModels(data.aircraftModels)');
  assert.deepEqual(Array.from(run('Object.keys(AIRCRAFT_MODELS)')).sort(),Object.keys(data.aircraftModels||{}).sort(),'Every pinned imported model must decode successfully; no silent procedural fallback');
  run('applyAircraftRebuilds(data.aircraftRebuilds)');
  if(app.includes('/* TF_GUIDED_AIRCRAFT_VARIANTS_BEGIN */'))run('TFGuidedAircraftVariants.installTypes(AIR_FIGHTERS,AIRCRAFT_TYPES)');
  run(section('configureAircraftSurfaces','  function configureAircraftSurfaces(','  /** Instruments read accepted flight/resource state'));
  run(section('bulletShell','  function bulletShell(mg,','  function shellDef('));
  run(section('guns','    const M61_DEF = ','    /**\n     * Gunnery aim'));
  const resourceSource=fs.readFileSync(path.join(ROOT,'handoff/tools/aircraft_resources.js'),'utf8');run(resourceSource);
  sections.aircraftResources={path:'handoff/tools/aircraft_resources.js',sha256:sha(resourceSource)};
  run(section('syncPodGuns','    function syncPodGuns(air)','    function stepAircraftGuns(dt)'));
  run(section('storeDefinitions','    const AIR_STORE_DEFS = ','    /**\n     * Each weapon\'s four separate states'));
  if(app.includes('TFMountedDetails.register(AIR_STORE_DEFS, data.storeModels);'))run(section('registerMountedStoreModels','    TFMountedDetails.register(AIR_STORE_DEFS, data.storeModels);','    const WEAPON_STATUS = '));
  run(section('tntEquivalentKg','  var RE_FACTOR = ','  function tntCharge('));
  run(section('weaponStatusCompatibilityLoadouts','    const WEAPON_STATUS = ','    /**\n     * Fire-control radars'));
  if(app.includes('/* TF_MODEL_HARDPOINTS_BEGIN */')){
    run(section('airStationsAndMountPosition','    function airStations(T)','/* TF_MODEL_HARDPOINTS_BEGIN */'));
    run(section('modelHardpoints','/* TF_MODEL_HARDPOINTS_BEGIN */','/* TF_MODEL_HARDPOINTS_END */'));
    // The intervening wrapNativeFactory assignment installs a renderer adapter;
    // only the actual pure layout declaration belongs in this data-export VM.
    run(section('layoutStores','    function layoutStores(','    /**\n     * Custom armament'));
  }else run(section('airStationsAndLayout','    function airStations(T)','    /**\n     * Custom armament'));
  run(section('slotsAndCustomLoadout','    const SLOT_ORDER = ','    const storeMeshes = '));
  run(section('storeSocket','  const storeSocket = ','  function partVertices('));
  run(section('airWingSplit','  function airWingSplit(T)','  /** The planes that separate'));
  run(section('fuel','    const AIR_FUEL = {',app.includes('    // TF_AIRCRAFT_FUEL_LOAD_CONTROLLER')?'    // TF_AIRCRAFT_FUEL_LOAD_CONTROLLER':'    /** The flight\'s fuel one step'));
  run(section('aircraftRadarDefinitions','    const AIR_RADARS = ','    const RADAR_SCALES = '));
  run(section('aircraftCountermeasureDefinitions','    const AIR_CM = {','    /**\n     * Where the radar'));
  run(section('aircraftSensorDefinitions','    const AIR_EQUIP = ','    const SEEKER_DEFAULTS = '));
  run(section('storeWarhead','    function storeWarhead(def)','    /**\n     * Station points of a type'));
  const control=app.match(/api\.configure_control\(([^)]+)\);/);assert.ok(control);const controlArgs=run('['+control[1]+']');
  sections.loadFlightCore= {startLine:app.slice(0,app.indexOf(control[0])).split('\n').length,sha256:sha(control[0])};
  const spawnSource=section('Aircraft.spawn','    spawn(x, y, z, heading, airspeed = 0, onGround = true) {','      this.api.spawn(x, y, z, heading, airspeed, onGround ? 1 : 0);');
  run('globalThis.exportApi={AIRCRAFT_TYPES,AIR_FIGHTERS,AIR_FUEL,AIR_STORE_DEFS,AIR_LOADOUTS,AIR_EQUIP,AIR_RADARS,AIR_CM,AIR_PODS,WEAPON_STATUS,WEAPON_COMPAT,WEAPON_MIGRATION,configureAircraftSurfaces,aircraftGuns,airStations,airSlots,customLoadout,layoutStores,fuelFlow,bulletShell,syncPodGuns,storeWarhead};');
  const a=context.exportApi,aircraft={},shells={};
  const clean=x=>JSON.parse(JSON.stringify(x));
  const storeItemProfile=it=>{
    const {def,sourceStore,sourceMount,...rest}=it;
    return clean({...rest,...(sourceStore?{sourceStore:{id:sourceStore.id,sourceParts:sourceStore.sourceParts}}:{}),...(sourceMount?{sourceMount:{id:sourceMount.id,sourceParts:sourceMount.sourceParts}}:{})});
  };
  for(const [id,T] of Object.entries(a.AIRCRAFT_TYPES)){
    const unknown=[],calls={};
    // Execute the real spawn configuration statements against a recording ABI; no physics state is fabricated.
    const recordApi={configure_airframe:(...v)=>calls.airframe=v,configure_surfaces:(...v)=>calls.surfaces=v,configure_gear_sequence:(...v)=>calls.gearSequence=v,configure:(...v)=>calls.configure=v,configure_envelope:(...v)=>calls.envelope=v};
    context.captureThis={type:T,api:recordApi};
    run('(function(){'+spawnSource.slice(spawnSource.indexOf('{')+1)+'}).call(captureThis)');
    if(!calls.surfaces)unknown.push('No production configure_surfaces call: NF test type has no fighter wing; kernel aero_defaults applies.');
    const gunProfile=g=>{
      const belt=g.kind==='cannon'?[...g.belt]:[context.G4.bulletShells.get(g.def.id)?.id||a.bulletShell(g.def).id];
      if(g.kind!=='cannon'){const shell=context.G4.bulletShells.get(g.def.id)||a.bulletShell(g.def);shells[shell.id]=clean(shell);}
      for(const sid of belt)if(data.projectiles[sid])shells[sid]=clean(data.projectiles[sid]);
      const mounts=g.mounts?.length?g.mounts:[g.mount];
      const directions=mounts.map(m=>{const d=[-m[0],-m[1],400-m[2]],l=Math.hypot(...d);return d.map(v=>v/l);});
      return {id:g.id,kind:g.kind,sound:g.sound,owner:g.owner??null,ammo:g.ammo,rpm:g.rpm,muzzle:[...g.mount],direction:directions[0],mount:[...g.mount],mounts:clean(mounts),directions,belt,definition:g.def?clean(g.def):null,rotary:g.rotary?clean(g.rotary):g.kind==='rotary'?{spinUpSeconds:.35}:null};
    };
    const gs=a.aircraftGuns(id).map(gunProfile);
    const loadouts=[['僅機砲',[]],...(a.AIR_LOADOUTS[id]||[])].map((lo,index)=>{
      const items=a.layoutStores(T,lo),podAir={guns:[],stores:{items},plane:{damage:{dead:()=>false,gone:()=>false}}};a.syncPodGuns(podAir);
      return {index,name:lo[0],entries:clean(lo[1]),items:items.map(storeItemProfile),gunPods:podAir.guns.map(gunProfile)};
    });
    const slots=a.airSlots(id).map(s=>({...clean(s),options:Object.fromEntries(s.options),...(s.defaultCounts?{defaultCounts:Object.fromEntries(s.defaultCounts)}:{}),incomplete:s.incomplete?Object.fromEntries(s.incomplete):{}}));
    const slotItems={},savedCustom=context.G4.airCustom,savedCounts=context.G4.airCustomCounts;
    try{
      // Some approved source sockets expose weapons absent from every preset.
      // Run the actual custom-choice/count path and fitted layout for each one;
      // do not infer a point from a neighbouring preset or a generic formula.
      for(const slot of slots){
        slotItems[slot.key]={};
        for(const [store,count]of Object.entries(slot.options)){
          context.G4.airCustom={...savedCustom,[id]:{[slot.key]:store}};
          context.G4.airCustomCounts={...savedCounts,[id]:{[slot.key]:count}};
          slotItems[slot.key][store]=a.layoutStores(T,a.customLoadout(id)).map(storeItemProfile);
        }
      }
    }finally{context.G4.airCustom=savedCustom;context.G4.airCustomCounts=savedCounts;}
    const f=a.AIR_FIGHTERS[id],rawModel=data.aircraftModels?.[id],inheritedModelId=T.variantSourceId&&data.aircraftModels?.[T.variantSourceId]?T.variantSourceId:null,modelEvidence=rawModel||data.aircraftModels?.[inheritedModelId];
    const year=/^\d{4}$/.test(String(f?.era))?Number(f.era):null;
    aircraft[id]={metadata:{name:T.name,year,nation:f?.nation??null,era:f?.era??null,role:f?.role??null,sound:T.sound,importedModel:!!rawModel,importedModelName:rawModel?.name??null,...(inheritedModelId?{inheritedModelId,inheritedModelName:modelEvidence?.name??null,variantProvenance:clean(T.variantProvenance)}:{}),specSha256:f?sha(JSON.stringify(f.spec)):null,modelMetadataSha256:modelEvidence?sha(JSON.stringify({spec:modelEvidence.spec,movers:modelEvidence.movers})):null},
      physics:{airframe:calls.airframe,configure:calls.configure,control:clean(controlArgs),envelope:calls.envelope,surfaces:calls.surfaces??null,gearSequence:calls.gearSequence??null,gear:clean(T.gear),rotateKmh:T.rotateKmh},
      sensors:{equipment:clean(a.AIR_EQUIP[id]||{}),radar:clean(a.AIR_RADARS[(a.AIR_EQUIP[id]||{}).radar]||null),countermeasures:clean(a.AIR_CM[id]||{flares:0,chaff:0}),pods:clean(a.AIR_PODS)},
      fuel:{sourceTuple:clean(a.AIR_FUEL[id]??null),capacityKg:a.AIR_FUEL[id]?.[0]??null,flowSamples:[0,.05,.5,1,1.006,1.12].map(throttle=>({throttle,kgPerSecond:a.fuelFlow({type:T,cur:{27:throttle}})}))},
      guns:gs,stores:{stations:clean(a.airStations(T)),slots,slotItems,loadouts,customLoadout:{runtimeLocalChoice:true,defaultEntries:clean(a.customLoadout(id)[1])}},unknown};
  }
  const storeDefinitions=clean(a.AIR_STORE_DEFS);
  for(const [id,def] of Object.entries(a.AIR_STORE_DEFS)){
    const shell=a.storeWarhead(def);
    if(shell){shells[shell.id]=clean(shell);storeDefinitions[id].projectile_id=shell.id;}
  }
  for(const def of Object.values(storeDefinitions))if(def.rockets)def.rocket_projectile_id=storeDefinitions[def.rockets]?.projectile_id??null;
  const wasm=Buffer.from(app.match(/var FLIGHT_CORE_WASM = "([^"]+)"/)[1],'base64');
  const flightApi = new WebAssembly.Instance(new WebAssembly.Module(wasm), {
    math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},
    world:{ground:()=>0,landable:()=>1}
  }).exports;
  return {schemaVersion:1,source:{appSha256:sha(app),baselineSha256:source.sha256,baselineRangeNames:Object.keys(source.ranges),physicalImportedModelCount:Object.keys(data.aircraftModels||{}).length,flightWasmSha256:sha(wasm),flightCoreVersion:flightApi.core_version(),sections},
    units:{frame:'aircraft body metres: +x right,+y up,+z nose',angles:'radians unless named otherwise',airframe:['massKg','wingAreaM2','chordM','spanM','pitchInertiaKgM2','yawInertiaKgM2','rollInertiaKgM2','zeroLiftDrag','inducedDragFactor','liftSlopePerRad','stallAoARad','jetFlag','dryThrustN','afterburnerGain'],control:['profile','handoff','releaseDelaySeconds','response'],configure:['windKnots','windDirectionDeg','response','positiveGLimit','protection'],envelope:['maxG','minG','maxAoARad','minAoARad'],surfaces:['wingRootM','wingTipM','wingYM','wingZM','tailZM','tailAreaM2','finZM','finAreaM2','rollTravelRad','pitchUpRad','pitchDownRad','yawTravelRad','flapTravelRad','sweepRad','taper','deltaFlag','stabilatorFlag']},
    conventions:{configuration:'Exact production host arguments before native ABI clamping; zero envelope AoA uses native automatic limit, not missing physical stall data.',gunDirection:'Production fixed400m body-frame convergence; muzzle ports alternate by max(1,fired)-1 modulo port count. Dispersion/recoil/aircraft world transform are runtime behavior.',ammo:'Each guns entry is one logical feed; shared rotary muzzle ports do not multiply ammo. Belt order and repeated shell IDs are preserved.',fuel:'sourceTuple=[internalCapacityKg,dryKgPerNewtonSecond,afterburningKgPerNewtonSecond?,pistonFullPowerKgPerSecond?]. eng=max(.05,throttle||0). Piston=tuple[3]*min(1.15,max(.08,eng)). Jet dry=tuple[1]*airframe[12]; eng>1.005 with tuple[2] gives dry+tuple[2]*airframe[12]*(1+airframe[13])*min(1,(eng-1)/.12), else dry*min(1,eng). Samples are actual fuelFlow results. stepAirFuel stops for engineOff/crash/broken/dead engine/prop or ground throttle<.06; live external tanks burn first. capacityKg is internal only; add actual live external remainder.',stores:'layoutStores evaluated against actual imported model specifications and original store socket metadata. storeWarhead and tntEquivalentKg execute unchanged to produce full projectile definitions; projectile_id links each applicable store and rocket_projectile_id links pods. Custom user choices are not imported; slots expose available options. Guided, cluster and electronics choices are open by default; native runtime owns acquisition, release, projectiles and damage. This data export alone is not an end-to-end test receipt.',scope:'Data export only, not native frontline flight integration or verified historical variant/store/sensor capability. Existing aircraft IDs and source variant mismatches are preserved.'},aircraft,shells,storeDefinitions,weaponStatus:clean(a.WEAPON_STATUS),weaponCompatibility:clean(a.WEAPON_COMPAT)};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  if(args.includes('--frozen')&&!option('--out'))throw new Error('--frozen is a historical audit; specify a separate --out');
  const value=await exportProfiles({baseline:option('--baseline')||(args.includes('--frozen')?BASELINE:undefined)});
  const output=path.resolve(ROOT,option('--out')||'data/aircraft/frontline.json');
  const text=JSON.stringify(value,null,2)+'\n';
  if(args.includes('--check')){assert.equal(fs.readFileSync(output,'utf8'),text,'Generated aircraft profile is stale');console.log('Aircraft profile source match:',Object.keys(value.aircraft).length,'types');}
  else {fs.mkdirSync(path.dirname(output),{recursive:true});const staged=output+`.new-${process.pid}`;try{fs.writeFileSync(staged,text);fs.renameSync(staged,output);}finally{if(fs.existsSync(staged))fs.unlinkSync(staged);}console.log('Wrote',path.relative(ROOT,output),Object.keys(value.aircraft).length,'types',Buffer.byteLength(text),'bytes');}
}

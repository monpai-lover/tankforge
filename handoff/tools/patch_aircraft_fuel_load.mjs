#!/usr/bin/env node
// Candidate-only fuel integration. ROOT owns shared application publication.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const helper=fs.readFileSync(new URL('./aircraft_fuel_load.js',import.meta.url),'utf8');
function once(source,old,next){
  const crlf=source.includes('\r\n')&&!/(?<!\r)\n/.test(source);
  if(crlf){old=old.replace(/\r?\n/g,'\r\n');next=next.replace(/\r?\n/g,'\r\n');}
  if(source.split(next).length===2)return source;
  assert.equal(source.split(old).length,2,'One reviewed fuel integration hook required: '+old.slice(0,100));
  return source.replace(old,next);
}
const clientEdits=[
  [
    "function createFrontlineSharedApi({f,net,send,ensureMapOptions,ensureMap,mine,controlled,clearInput,note})",
    "function createFrontlineSharedApi({f,net,send,ensureMapOptions,ensureMap,mine,controlled,clearInput,note,fuelPolicy=null,fuelIntent=null})"
  ],
  [
    "      function configuration(id,{loadout,custom}={}){\n        if(!option(id))deny('当前服务器未开放此飞机');\n        if(custom!==undefined&&custom!==null)return {loadout:0,custom:customChoice(id,custom)};\n        if(!Number.isSafeInteger(loadout)||!option(id).loadouts?.some(lo=>lo.index===loadout))deny('当前服务器未开放此挂载配置');\n        return {loadout};\n      }",
    "      function configuration(id,{loadout,custom,fuel_minutes}={}){\n        if(!option(id))deny('当前服务器未开放此飞机');\n        let cfg;\n        if(custom!==undefined&&custom!==null)cfg={loadout:0,custom:customChoice(id,custom)};\n        else{if(!Number.isSafeInteger(loadout)||!option(id).loadouts?.some(lo=>lo.index===loadout))deny('当前服务器未开放此挂载配置');cfg={loadout};}\n        if(fuel_minutes!==undefined){\n          if(option(id).fuel_load?.version===1&&fuelPolicy)cfg.fuel_minutes=fuelPolicy.normalize(fuel_minutes);\n          else if(fuel_minutes!==null)deny('当前服务器只支持满油；不能发送燃油选择');\n        }\n        return cfg;\n      }"
  ],
  [
    "deployAir({aircraft,loadout,custom,spawn}){",
    "deployAir({aircraft,loadout,custom,spawn,fuel_minutes}){"
  ],
  [
    "const cfg=configuration(aircraft,{loadout,custom});",
    "const pick=fuel_minutes===undefined?(fuelIntent?.(aircraft)||{}):{fuel_minutes},cfg=configuration(aircraft,{loadout,custom,...pick});"
  ],
  [
    "serviceAir({loadout,custom,cancel=false}={})",
    "serviceAir({loadout,custom,fuel_minutes,cancel=false}={})"
  ],
  [
    "const cfg=cancel?{}:configuration(unit.aircraft,{loadout,custom});",
    "const pick=fuel_minutes===undefined?(fuelIntent?.(unit.aircraft)||{}):{fuel_minutes},cfg=cancel?{}:configuration(unit.aircraft,{loadout,custom,...pick});"
  ],
  [
    "createFrontlineSharedApi({f,net,send,ensureMapOptions,ensureMap,mine,controlled,clearInput,note})",
    "createFrontlineSharedApi({f,net,send,ensureMapOptions,ensureMap,mine,controlled,clearInput,note,fuelPolicy:typeof TFAircraftFuelLoad!=='undefined'?TFAircraftFuelLoad:null,fuelIntent:id=>typeof aircraftFuelLoad!=='undefined'?aircraftFuelLoad.intentFor(id):{}})"
  ],
  [
    "custom:id=>({...G4.airCustom[id]}),openConfiguration:openNativeArmEditor,",
    "custom:id=>({...G4.airCustom[id]}),fuelHtml:id=>typeof aircraftFuelLoad!=='undefined'?aircraftFuelLoad.htmlFor(id):'',openConfiguration:openNativeArmEditor,"
  ],
  [
    "<div data-fl=\"air-service-panel\" hidden>",
    "<div data-fl=\"air-service-panel\" hidden><div data-fl=\"air-fuel-choice\"></div>"
  ],
  [
    "        const retained=f.aircrafts.find(u=>u.owner===net.id&&u.alive),requestedLoadout=",
    "        const fuelHtml=airOption&&typeof aircraftFuelLoad!=='undefined'?aircraftFuelLoad.htmlFor(airOption.id):'';if(el('air-fuel-choice').innerHTML!==fuelHtml)el('air-fuel-choice').innerHTML=fuelHtml;\n        const retained=f.aircrafts.find(u=>u.owner===net.id&&u.alive),requestedLoadout="
  ]
];
const lobbyEdits=[
  [
    ".join('')+`<button type=\"button\" class=\"tool\" data-act=\"configure-air\">",
    ".join('')+(aircraft.fuelHtml?.(id)||'')+`<button type=\"button\" class=\"tool\" data-act=\"configure-air\">"
  ]
];
const edits=(source,rows)=>rows.reduce((text,[old,next])=>once(text,old,next),source);
export function patchFrontlineFuelClient(source){return edits(source,clientEdits);}
export function patchFrontlineFuelLobby(source){return edits(source,lobbyEdits);}
export function patchAircraftFuelLoadHelper(source){
  const begin='/* TF_AIRCRAFT_FUEL_LOAD_BEGIN */',end='/* TF_AIRCRAFT_FUEL_LOAD_END */';
  for(const marker of [begin,end])assert.equal(source.split(marker).length,2,'One complete fuel helper boundary required: '+marker);
  const a=source.indexOf(begin),b=source.indexOf(end);assert.ok(b>a,'Ordered fuel helper boundaries required');
  const previous=source.slice(a,b+end.length),crlf=previous.includes('\r\n')&&!/(?<!\r)\n/.test(previous);
  const replacement=helper.trimEnd().replace(/\r?\n/g,crlf?'\r\n':'\n');
  return source.slice(0,a)+replacement+source.slice(b+end.length);
}
export function patchAircraftFuelLoad(source){
  let text=source;
  const begin='/* TF_AIRCRAFT_FUEL_LOAD_BEGIN */';
  if(text.includes(begin)){
    text=patchAircraftFuelLoadHelper(text);
  }else text=once(text,'  var FLIGHT_FIXED = ',helper.trimEnd()+'\n  var FLIGHT_FIXED = ');
  text=patchFrontlineFuelClient(text);text=patchFrontlineFuelLobby(text);
  text=once(text,'        plane.instrumentContext = air;\n        air.stores = mountStores(plane, typeId, G4.airLoadout[typeId] || 0);','        plane.instrumentContext = air;\n        aircraftFuelLoad.initializeAir(air, true);\n        air.stores = mountStores(plane, typeId, G4.airLoadout[typeId] || 0);');
  text=once(text,'if (!air.fuel || air.fuel.type !== P.type.id) air.fuel = { type: P.type.id, kg: F[0], max: F[0], told: F[0], low: false, bingo: false };','if (!air.fuel || air.fuel.type !== P.type.id) aircraftFuelLoad.initializeAir(air, true);');
  text=once(text,'      air.stores = mountStores(P, id2, next);\n      applyStoreLoad(air);\n      air.cm = loadCountermeasures(id2);\n      air.fuel = null;','      air.stores = mountStores(P, id2, next);\n      aircraftFuelLoad.initializeAir(air, true);\n      applyStoreLoad(air);\n      air.cm = loadCountermeasures(id2);');
  text=once(text,'"refuelled" : "加滿燃油"','"fuel load restored" : "按所选油量补给"');
  text=once(text,'+ airLoadoutHtml(id2) +','+ airLoadoutHtml(id2) + aircraftFuelLoad.htmlFor(id2) +');
  const from=text.indexOf('  var DeployScreen = class {'),to=text.indexOf('\n  // client/web/',from+1);assert.ok(from>=0&&to>from,'Actual original DeployScreen required');
  const screen=once(text.slice(from,to),'        return;\n      }\n      const lo = this.loadout();','        el4.innerHTML += this.o.airFuelHtml?.(this.vehicle.slice(4)) || "";\n        return;\n      }\n      const lo = this.loadout();');
  text=text.slice(0,from)+screen+text.slice(to);
  const marker='    // TF_AIRCRAFT_FUEL_LOAD_CONTROLLER';
  if(!text.includes(marker))text=once(text,"    /** The flight's fuel one step:",`    // TF_AIRCRAFT_FUEL_LOAD_CONTROLLER
    const aircraftFuelLoad=TFAircraftFuelLoad.create({game:G4,types:AIRCRAFT_TYPES,tuples:AIR_FUEL,flow:fuelFlow,storage:localStorage,document,
      native:()=>!!G4.frontline?.shared?.room(),nativeOption:id=>G4.frontline?.shared?.aircraftOptions().find(option=>option.id===id),language:()=>LANG,
      onChange:id=>{if(airGarage.on&&airGarage.sel===id)renderAirInfo(id);if(deploy.visible)deploy.renderAmmo();}});
    deploy.o.airFuelHtml=id=>aircraftFuelLoad.htmlFor(id);
    /** The flight's fuel one step:`);
  assert.equal(text.split(marker).length,2,'One source fuel controller required');
  return text;
}
function main(){
  const args=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
  const input=option('--input'),output=option('--output');assert.ok(input&&output,'Explicit --input and --output candidate paths are required');
  const source=fs.realpathSync(input),target=path.resolve(output),canonical=fileURLToPath(new URL('../bundle/app.js.html',import.meta.url));
  const normalized=p=>path.resolve(p).replaceAll('\\','/').toLowerCase();
  assert.notEqual(normalized(source),normalized(target),'Refusing in-place fuel integration');assert.notEqual(normalized(target),normalized(canonical),'ROOT owns canonical application integration');assert.ok(!fs.existsSync(target),'Refusing to overwrite an existing candidate');
  const value=patchAircraftFuelLoad(fs.readFileSync(source,'utf8'));new Function(value.slice(value.indexOf('<script>')+8,value.lastIndexOf('</script>')));
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value,{flag:'wx'});console.log(JSON.stringify({input:source,output:target,bytes:Buffer.byteLength(value)}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main();

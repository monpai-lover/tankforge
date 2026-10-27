import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {modelUpgradePrelude} from './fixture-model-upgrade.mjs';
import {patchAircraftFuelLoad} from '../tools/patch_aircraft_fuel_load.mjs';

const original=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const source=process.env.TF_FUEL_TEST_BASELINE==='1'?original:patchAircraftFuelLoad(original);
const section=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i,a);return source.slice(i,j);};

test('actual SINGLE boarding, existing K supply and reboarding use selected stock and real loaded mass without a free refill',async()=>{
 const bytes=fs.readFileSync(new URL('../flight/flight_core.wasm',import.meta.url)),{instance}=await WebAssembly.instantiate(bytes,{math:{sin:Math.sin,cos:Math.cos,atan2:Math.atan2,exp:Math.exp,asin:Math.asin,acos:Math.acos},world:{ground:()=>0,landable:()=>1}}),masses=[],api={...instance.exports,configure_airframe(...args){masses.push(args[0]);return instance.exports.configure_airframe(...args);}};
 const renderer={mesh:data=>({count:data.length/13,_src:{data}}),freeMesh(){}},game={mode:'battle',online:false,s:{x:0,z:0,heading:0},keys:new Set(),air:null,airLoadout:{f86f:0},airFuelMinutes:{f86f:10}},handlers={},document={body:{dataset:{}},addEventListener:(name,fn)=>handlers[name]=fn};let removed=0;
 const c=vm.createContext({performance,atob,console,renderer,G4:game,document,LANG:'en',localStorage:{getItem:()=>null,setItem(){}},airGarage:{on:false},deploy:{o:{},visible:false},hud:{toast(){}},airHud:{hidden:true},flightCoreP:Promise.resolve(api),scene:{add(){}},surfaceAt:()=>0,removeAircraft(){removed++;},mountStores:()=>({name:'Guns',index:0,items:[]}),loadCountermeasures:()=>({}),aircraftGuns:()=>[],airLoadouts:()=>[['Guns',[]],['Second',[]]],aircraftStoreAvailable:()=>true,aircraftUsableFuel:air=>air.fuel.kg,airVoice(){},airReason(){}});
 const start=source.indexOf('  // the C flight core'),end=source.indexOf('  // client/web/src/main.js',start);
 vm.runInContext(fs.readFileSync(new URL('../tools/aircraft_fuel_load.js',import.meta.url),'utf8')+modelUpgradePrelude(source)+section('  function m4()','  // client/web/src/game/relief.js')+source.slice(source.lastIndexOf('\n',start)+1,end),c);
 vm.runInContext(section('    const AIR_FUEL = {','    // ---- engine start and stop')+section('    const storeMassOf = ','    // the release programs')+section('    function applyStoreLoad(air) {','    G4.airLoadout = ')+section('    async function enterAircraft(','    // NF-01 armament')+section('    function rearmAircraft(air) {','    const loadCountermeasures = '),c);
 const policy=source.includes('// TF_AIRCRAFT_FUEL_LOAD_CONTROLLER')?null:'const aircraftFuelLoad=TFAircraftFuelLoad.create({game:G4,types:AIRCRAFT_TYPES,tuples:AIR_FUEL,flow:fuelFlow,document});';if(policy)vm.runInContext(policy,c);
 await c.enterAircraft(true,'f86f');const air=game.air;c.stepAirFuel(air,0);const cap=1300,rate=vm.runInContext('fuelFlow({type:AIRCRAFT_TYPES.f86f,cur:{27:.65}})',c),baseMass=air.plane.type.airframe[0];
 assert.equal(air.fuel.kg,Math.min(cap,600*rate));assert.equal(air.fuel.max,cap);assert.ok(Math.abs(masses.at(-1)-(baseMass-cap+air.fuel.kg))<.001,'actual configure_airframe receives the missing-fuel mass deduction');
 air.fuel.kg=77;game.airFuelMinutes.f86f=45;const before=JSON.stringify(air.fuel);await c.enterAircraft(true,'f86f');assert.equal(JSON.stringify(air.fuel),before);assert.equal(removed,1,'the original nearby aircraft is retained');
 game.airFuelMinutes.f86f=20;c.rearmAircraft(air);c.stepAirFuel(air,0);assert.equal(air.fuel.kg,Math.min(cap,1200*rate));assert.equal(air.fuel.max,cap);assert.ok(Math.abs(masses.at(-1)-(baseMass-cap+air.fuel.kg))<.001);air.plane.dispose();
});

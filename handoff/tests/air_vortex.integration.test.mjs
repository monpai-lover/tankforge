import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {patchAirVortex} from '../tools/air_vortex_patch.mjs';
import {createAirVortex} from '../tools/air_vortex.js';

const source=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const helper=fs.readFileSync(new URL('../tools/air_vortex.js',import.meta.url),'utf8');
const staged=source.includes('TF_AIR_VORTEX_PRESENTATION')?source:patchAirVortex(source,helper);
test('staged hooks preserve the actual embedded C215 WASM and install all lifecycle/reset hooks',()=>{
  assert.equal(staged.match(/var FLIGHT_CORE_WASM = "([^"]+)"/)[1],source.match(/var FLIGHT_CORE_WASM = "([^"]+)"/)[1]);
  for(const token of ['TFAirVortex.samplePlane(this,TFAirVortex.context())','TFAirVortex.remove(this)','TFAirVortex.context=()=>G4','this.alphaCount=TFAirVortex.write'])assert.ok(staged.includes(token),token);
  assert.throws(()=>patchAirVortex(staged,helper),/Preserve/);
});
test('actual Effects CPU buffer integration emits alpha ribbons with no additive or particle emissions',()=>{
  const end=staged.indexOf('  // client/web/src/main.js'),context=vm.createContext({console,atob,btoa,TextEncoder,TextDecoder,performance});
  vm.runInContext(staged.replace(/^<script>/,'').slice(0,end-'<script>'.length)+'\nglobalThis.testVortex={Effects,TFAirVortex};})();',context);
  const {Effects,TFAirVortex}=context.testVortex,fx=new Effects(256),scene={mode:'battle',time:0,airAtmosphere:{relativeHumidity:.92,temperatureC:15}};
  TFAirVortex.context=()=>scene;
  const S=new Float32Array(80),aero=new Float32Array(48),m=[1,0,0,0,0,1,0,0,0,0,1,0,0,2000,0,1];
  S[1]=2000;S[13]=150;S[17]=4;S[35]=2000;aero[0]=aero[1]=.2;aero[4]=aero[5]=65000;aero[15]=11000;
  const P={cur:S,aero,type:{fighter:{spec:{wing:[[.5,0,1,3],[6,.2,-1,.8]]}},airframe:[10000,30]},root:{local:m},damage:{dead:()=>false}};
  for(let k=0;k<30;k++){scene.time=S[23]=k/60;m[12]=S[0]=k*2.5;TFAirVortex.samplePlane(P,scene);}
  const state=Array.from(S),acceptedAero=Array.from(aero);fx.build({pos:[100,2100,100],right:[1,0,0],up:[0,1,0]});
  assert.ok(fx.alphaCount>0);assert.equal(fx.addCount,0);assert.equal(fx.particles.length,0);assert.ok(fx.alphaCount<=192*6);
  assert.deepEqual(Array.from(S),state);assert.deepEqual(Array.from(aero),acceptedAero);
});
test('actual decoded fleet planforms provide their own finite wingtip anchors',async()=>{
  const {api}=await import('./jet-fixture.mjs');const f=createAirVortex();let count=0;
  for(const T of Object.values(api.AIRCRAFT_TYPES)){const wing=T.fighter?.spec?.wing;if(!wing)continue;const p=f.tips(wing);assert.ok(p&&p.every(Number.isFinite),T.id);assert.equal(p[3],wing.at(-1)[0]);count++;}
  assert.ok(count>=25);console.log('measured wingtip metadata types',count,'source',createHash('sha256').update(source).digest('hex'));
});

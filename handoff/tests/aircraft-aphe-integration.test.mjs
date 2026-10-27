import {fuelSourceParts} from './fixtures/aircraft-fuel-source-fixture.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../',import.meta.url)),appPath=path.join(root,'handoff/bundle/app.js.html');
const original=fs.readFileSync(appPath,'utf8'),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const shell={id:'ap_50_mk214a',name:'50 mm APHE',kind:'apcbc',mass_kg:2.06,explosive_mass_kg:.017,explosive_type:'petn',fuse_sensitivity_mm:15,fuse_delay_s:.002};
let candidate;
function staged(){
 if(candidate)return candidate;const script=path.join(root,'handoff/tools/patch_aircraft_projectile_fuze.py');assert.ok(fs.existsSync(script),'Reproducible local APHE integration patch is required');
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'tf-aphe-integration-')),output=path.join(folder,'app.html'),python=process.env.TF_TEST_PYTHON||'python';
 try{for(const file of ['patch_projectile_filler_info.py','patch_aircraft_projectile_fuze.py']){const r=spawnSync(python,[path.join(root,'handoff/tools',file),'--input',fs.existsSync(output)?output:appPath,'--output',output],{encoding:'utf8'});assert.equal(r.status,0,r.stderr||r.stdout);}candidate=fs.readFileSync(output,'utf8');return candidate;}
 finally{fs.rmSync(folder,{recursive:true,force:true});}
}
function cut(source,a,b){const i=source.indexOf(a),j=source.indexOf(b,i);assert.ok(i>=0&&j>i,a);return source.slice(i,j);}
function damageFixture(mesh=false){
 const source=staged(),c=vm.createContext({});
 const math=cut(source,'  function airSlab(a, b, box)','  // ---- the aircraft\'s hitbox')+cut(source,'  function airSlabExit(a, b, box)','  /**\n   * The type\'s hitbox');
 vm.runInContext(fs.readFileSync(new URL('../tools/aircraft_projectile_fuze.js',import.meta.url),'utf8')+math+cut(source,'  var AircraftDamage = class {','  // NF-02: the same kinds of parts'),c);
 const parts=[{id:'skin',c:[0,0,1],h:[1,1,.1],hp:1000,armor:99},{id:'engine',c:[0,0,3],h:[.5,.5,.3],hp:1000},{id:'fuel',c:[0,0,5],h:[.5,.5,.3],hp:1000}];
 const hb=mesh?{pieces:[{part:'skin',name:'exact skin'}],piece:[0],surface:new Set(['skin'])}:null;
 if(mesh)c.airHitboxQuery=()=>[{t:.09,tri:0}];
 const damage=new c.AircraftDamage(parts,[{c:[0,0,3],h:[1,1,3]}],hb),blasts=[];damage._alive=new Uint8Array([1]);damage.blast=(at,tnt)=>blasts.push({at:[...at],tnt});
 return {c,damage,blasts,source};
}
test('staged helpers preserve actual app and embedded WASM and parse as one complete current application',()=>{
 const candidate=staged();assert.equal(hash(fs.readFileSync(appPath,'utf8')),hash(original));
 for(const marker of ['FLIGHT_CORE_WASM','WASM_B64']){const expression=new RegExp('(?:var|const) '+marker+' = "([^"]+)"'),a=original.match(expression),b=candidate.match(expression);if(a)assert.equal(hash(a[1]),hash(b[1]),marker);}
 new vm.Script(candidate.slice(candidate.indexOf('>')+1,candidate.lastIndexOf('</script>')));
});
for(const mesh of [false,true])test(`actual AircraftDamage ${mesh?'triangle':'box'} path keeps APHE kinetic traversal and refuses uncalibrated skin arming`,()=>{
 const f=damageFixture(mesh),r=f.damage.hit([0,0,0],[0,0,10],500000,.02822,false,()=>1,{shell,speedMS:500,time_s:2});
 assert.equal(r.fuze_status,'unarmed');assert.equal(r.limitation,'arming_contact_thickness_unrecorded');assert.equal(r.bursts.length,0);assert.equal(f.blasts.length,0);assert.ok(r.parts.length>1);assert.ok(f.damage.by.engine.hp<1000&&f.damage.by.fuel.hp<1000);
});
test('actual AircraftDamage records an in-segment delayed burst and never extrapolates an unresolved continuation',()=>{
 const f=damageFixture(),r=f.damage.hit([0,0,0],[0,0,10],500000,.02822,false,()=>1,{shell,speedMS:500,time_s:2,armableContacts:[{t:.2,thickness_mm:20}],detonation_id:'source:7/burst:0'});
 assert.equal(r.fuze_status,'detonated');assert.ok(Math.abs(f.blasts[0].at[2]-3)<1e-12);assert.equal(r.bursts[0].detonation_id,'source:7/burst:0');assert.equal(r.bursts[0].explosive_kg,.017);
 const g=damageFixture(),q=g.damage.hit([0,0,0],[0,0,1],500000,.02822,false,()=>1,{shell,speedMS:835,time_s:2,armableContacts:[{t:.2,thickness_mm:20}]});assert.equal(q.fuze_status,'armed_continuation_unresolved');assert.equal(g.blasts.length,0);
});
test('actual HE AircraftDamage path preserves immediate contact burst',()=>{
 const f=damageFixture(true),r=f.damage.hit([0,0,0],[0,0,10],500000,.02822,true,()=>1,{shell:{...shell,kind:'he'},speedMS:500,time_s:2});assert.equal(r.fuze_status,'contact_detonated');assert.equal(f.blasts.length,1);assert.equal(r.parts.length,1);
});
test('actual HUD ammo titles expose raw per-round filler grams',()=>{
 const source=staged(),nodes=[];const node=()=>({append(){},setAttribute(){},addEventListener(){},blur(){}});
 const c=vm.createContext({document:{createElement(){const n=node();nodes.push(n);return n;}},LANG:'en',shellKind:s=>s.kind,shellTypeLabel:k=>k,shellIcon:()=>node()});
 vm.runInContext(fs.readFileSync(new URL('../tools/projectile_filler_info.js',import.meta.url),'utf8')+'globalThis.build=({'+cut(source,'    buildAmmo(gun2, onPick) {','    /** Per frame: rounds left')+'}).buildAmmo;',c);
 c.build.call({el:{ammo:node()}},{ammo:[{shell:{...shell,penetration_curve:[{pen_mm:85}],muzzle_velocity_ms:835}}]},()=>{});assert.match(nodes[0].title,/Filler 17 g · PETN/);assert.ok(!nodes[0].title.includes('28.22 g'));
});

test('actual aircraft garage renders the equipped APHE belt with raw filler grams',()=>{
 const source=staged(),fuel=fuelSourceParts(source),panel={},handlers={},gun={kind:'cannon',belt:[shell.id,shell.id]},planeId='me262u4';
 const profile=JSON.parse(fs.readFileSync(new URL('../../data/aircraft/frontline.json',import.meta.url),'utf8')).aircraft[planeId];assert.ok(profile,'Actual Me262 U4 source profile');
 const c=vm.createContext({document:{getElementById:()=>panel,addEventListener:(name,fn)=>handlers[name]=fn},localStorage:{getItem:()=>null,setItem(){}},deploy:{o:{},visible:false},airGarage:{on:false,sel:planeId},LANG:'en',G4:{bulletShells:new Map()},data:{projectiles:{[shell.id]:shell}},aircraftGuns:()=>[gun],airTypeInfo:()=>({name:'MK214 prototype',guns:'1×50 mm',mass:'7 t',wing:'22 m²'}),AIRCRAFT_TYPES:{[planeId]:{id:planeId,airframe:profile.physics.airframe,gLimit:6,rotateKmh:150}},airLoadoutHtml:()=>'',bulletShell:()=>{throw new Error('Actual cannon belt must resolve source shells');}});
 vm.runInContext(cut(source,'/* TF_GUIDED_AIRCRAFT_VARIANTS_BEGIN */','/* TF_GUIDED_AIRCRAFT_VARIANTS_END */')+fuel.helper+fuel.pure+fuel.controller+fs.readFileSync(new URL('../tools/projectile_filler_info.js',import.meta.url),'utf8')+cut(source,'    function renderAirInfo(', '    /** The type\'s loadouts'),c);
 assert.equal(typeof handlers.change,'function','Actual complete fuel controller owns the delegated event');handlers.change({target:{dataset:{airFuel:planeId},value:'10'}});assert.equal(c.G4.airFuelMinutes[planeId],10);
 c.renderAirInfo(planeId);assert.match(panel.innerHTML,/彈鏈與裝藥/);assert.match(panel.innerHTML,/50 mm APHE ×2: Filler 17 g · PETN/);assert.ok(!panel.innerHTML.includes('28.22 g'));assert.match(panel.innerHTML,/data-air-fuel="me262u4"/);assert.match(panel.innerHTML,/value="10" selected/);
});

test('candidate staging is byte-idempotent and refuses the shared application as output',()=>{
 const script=path.join(root,'handoff/tools/patch_aircraft_projectile_fuze.py'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'tf-aphe-idempotence-')),input=path.join(folder,'input.html'),output=path.join(folder,'output.html'),python=process.env.TF_TEST_PYTHON||'python';
 try{fs.writeFileSync(input,staged());const r=spawnSync(python,[script,'--input',input,'--output',output],{encoding:'utf8'});assert.equal(r.status,0,r.stderr||r.stdout);assert.equal(fs.readFileSync(output,'utf8'),staged());const denied=spawnSync(python,[script,'--input',input,'--output',appPath],{encoding:'utf8'});assert.notEqual(denied.status,0);assert.match(denied.stderr,/ROOT owns shared application/);assert.equal(hash(fs.readFileSync(appPath,'utf8')),hash(original));}
 finally{fs.rmSync(folder,{recursive:true,force:true});}
});

function callerFixture(mesh=false){
 const f=damageFixture(mesh),explosions=[],impacts=[],sounds=[],messages=[];
 const P={root:{local:true},crashed:false,position:[0,0,5],cur:new Array(10).fill(0),damage:f.damage,localPoint:p=>p,worldPoint:p=>p.map((v,k)=>v+[10,20,30][k]),applyDamage(){},type:{name:'target'}};
 Object.assign(f.c,{G4:{online:null,air:{plane:P,active:false},camPos:[0,0,0],cam:{},time:10},LANG:'en',performance:{now:()=>10000},tntEquivalentKg:s=>(s.explosive_mass_kg||0)*1.66,airDown:()=>false,airPiecesFx(){},sub:(a,b)=>a.map((v,k)=>v-b[k]),dot:(a,b)=>a.reduce((v,x,k)=>v+x*b[k],0),airBots:{list:[{plane:P}],downed(){}},hud:{hitMarker(){},toast(){}},fx:{explosion:(at,_,tnt)=>explosions.push({at:[...at],tnt}),armorImpact:at=>impacts.push([...at])},sound:{full:{bank:{cues:{air_hit:1,air_hit_he:1}},play:(cue,options)=>sounds.push({cue,options})},contact(){},blast(){}},net:{send:message=>messages.push(message)}});
 vm.runInContext(cut(f.source,'    function aircraftHit(', '    function airPiecesFx(')+cut(f.source,'    function botHit(', '    // ==== air combat systems')+cut(f.source,'    function reportAirHit(', '    /** The seeker\'s tone'),f.c);
 return {...f,P,explosions,impacts,sounds,messages};
}

for(const method of ['aircraftHit','botHit'])test(`actual ${method} forwards selected raw shell and segment clock without fabricating APHE contact explosion`,()=>{
 const f=callerFixture(),args=method==='aircraftHit'?[null,{time_s:2}]:[{}, {time_s:2}];
 const point=f.c[method]([0,0,0],[0,0,10],shell,[0,0,500],...args);assert.ok(point);assert.equal(f.explosions.length,0);assert.equal(f.impacts.length,1);assert.equal(f.sounds[0].cue,'air_hit');assert.ok(f.damage.by.engine.hp<1000&&f.damage.by.fuel.hp<1000);assert.equal(f.damage.fire,0);
 const g=callerFixture(),opts={time_s:2,armableContacts:[{t:.2,thickness_mm:20}]},nextArgs=method==='aircraftHit'?[null,opts]:[{},opts];g.c[method]([0,0,0],[0,0,10],shell,[0,0,500],...nextArgs);assert.deepEqual(g.explosions[0].at,[10,20,33]);assert.equal(g.impacts.length,0);assert.equal(g.sounds[0].cue,'air_hit_he');
});

test('actual legacy online aircraft preview reports only and cannot fabricate a filled APHE explosion',()=>{
 const f=callerFixture(true);f.damage.hit=()=>{throw new Error('Client may not resolve online damage');};const b={plane:f.P,remote:7};
 assert.ok(f.c.reportAirHit(b,[0,0,0],[0,0,10],shell,[0,0,500],{seq:4}));assert.equal(f.messages.length,1);assert.equal(f.explosions.length,0);assert.equal(f.impacts.length,1);
 f.c.reportAirHit(b,[0,0,0],[0,0,10],{...shell,kind:'he'},[0,0,500],{seq:5});assert.equal(f.explosions.length,1);
});

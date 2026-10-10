import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadData} from '../tools/load-data.mjs';
import {loadCoreSync} from '../src/design/core.js';
import {Combat} from '../src/game/combat.js';
import {ammoKeyIndex} from '../src/game/weaponselection.js';
const path=new URL('../src/game/vehicleActions.js',import.meta.url);
const api=fs.existsSync(path)?await import(path):{};
const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const template=fs.readFileSync(new URL('../template.html',import.meta.url),'utf8');
const controller=()=>{assert.ok(api.VehicleActions,'long-press vehicle action owner exists');return new api.VehicleActions();};
const fn=name=>{const start=source.indexOf(`  function ${name}(`);assert.ok(start>=0,`${name} must exist`);return source.slice(start,source.indexOf('\n  }',start)+4);};

test('short F release ranges once without starting a repair',()=>{
 const v=controller();v.press('KeyF',0);assert.equal(v.tick(.1,true,true),null);
 assert.equal(v.release('KeyF',.2,true,true),'range');assert.equal(v.release('KeyF',.21,true,true),null);
});
test('F must reach three uninterrupted seconds and starts only one repair',()=>{
 const v=controller();v.press('KeyF',0);assert.equal(v.tick(2.99,true,true),null);
 assert.equal(v.readout(2.99,0,true).phase,'prepare');
 assert.equal(v.tick(3,true,true),'repair');assert.equal(v.tick(6,true,true),null);assert.equal(v.release('KeyF',6,true,true),null);
});
test('releasing a partial hold cancels it and the next press starts from zero',()=>{
 const v=controller();v.press('KeyF',0);assert.equal(v.release('KeyF',1,true,true),null);
 v.press('KeyJ',2);assert.equal(v.release('KeyJ',4.9,true,true),null);
 v.press('KeyJ',5);assert.equal(v.tick(7.99,true,true),null);assert.equal(v.tick(8,true,true),'abandon');
});
test('repeat presses, switching hold keys and cancellation cannot trigger hidden duplicate actions',()=>{
 const v=controller();v.press('KeyF',0);v.press('KeyJ',1);v.press('KeyJ',2.8);
 assert.equal(v.release('KeyF',3,true,true),null);assert.equal(v.tick(3.99,true,true),null);assert.equal(v.tick(4,true,true),'abandon');
 v.cancel();assert.equal(v.release('KeyJ',6,true,true),null);assert.equal(v.readout(6,0,true),null);
});
test('movement cancels repair preparation but not ranging or deliberate abandonment',()=>{
 const v=controller();v.press('KeyF',0);assert.equal(v.tick(.5,true,false),'moving');assert.equal(v.tick(3,true,true),null);
 assert.equal(v.release('KeyF',3,true,true),null);v.press('KeyF',4);assert.equal(v.release('KeyF',4.1,true,false),'range');
 v.press('KeyJ',5);assert.equal(v.tick(8,true,false),'abandon');
});
test('death or inactive gameplay cancels holds and authoritative repair time drives the visible ring',()=>{
 const v=controller();v.press('KeyJ',0);assert.equal(v.tick(4,false,true),null);
 assert.equal(v.readout(4,0,false),null);
 let r=v.readout(5,12,true);assert.equal(r.phase,'repair');assert.equal(r.progress,0);
 v.cancel();r=v.readout(6,6,true);assert.equal(r.progress,.5,'release or blur does not cancel actual repairs');
 assert.equal(v.readout(7,0,true),null);r=v.readout(8,4,true);assert.equal(r.progress,0,'new repairs get their own total');
});
test('a key release after a slow frame still recognizes a complete continuous three-second hold',()=>{
 const v=controller();v.press('KeyJ',0);assert.equal(v.release('KeyJ',3,true,true),'abandon');assert.equal(v.tick(4,true,true),null);
});

function inputRig(online=false) {
 const vehicleActions=controller(),events={},calls=[],hud={toast:(...a)=>calls.push(['toast',...a])};let now=0;
 const G={mode:'battle',thumbs:[],paused:false,workshop:false,caps:{destroyed:false},cstate:{},online:online?{dead:false,diedAt:0}:null,s:{u:0},keys:new Set(),loadout:{turrets:[]},cam:{},xray:false};
 const document={hidden:false,activeElement:{tagName:'CANVAS'},body:{},addEventListener:(key,callback)=>events[key]=callback};
 const deps={G,vehicleActions,vehicleActionIndicator:{update(){}},hud,document,deploy:{visible:false},chatIn:{hidden:true},net:{open:true,room:null,send:m=>{calls.push(['send',m]);return true;}},performance:{now:()=>now*1000},KEYMAP:{},ammoKeyIndex,HTMLButtonElement:class{},setFreeLook(){},setXray(){},startRanging:()=>calls.push(['range']),repairVehicle:()=>calls.push(['repair']),abandonVehicle:()=>calls.push(['abandon']),trigger:()=>calls.push(['rocket']),resetVehicle:()=>calls.push(['reset'])};
 const actionFunctions=['vehicleActionAllowed','performVehicleAction'].map(fn).join('\n');
 const keySource=source.slice(source.indexOf("  window.addEventListener('keydown'"),source.indexOf("  document.getElementById('help-toggle')"));
 const win={addEventListener:(key,callback)=>events[key]=callback};
 new Function(...Object.keys(deps),'window',`${actionFunctions}\n${keySource}`)(...Object.values(deps),win);
 return {G,events,calls,vehicleActions,document,deps,setTime:t=>now=t,event:(code,repeat=false)=>({code,repeat,target:{tagName:'CANVAS'},preventDefault(){}})};
}
test('real keydown and keyup distinguish short F from hold F and never call old J repair',()=>{
 const r=inputRig();r.events.keydown(r.event('KeyF'));assert.equal(r.calls.length,0);r.setTime(.15);r.events.keyup(r.event('KeyF'));assert.deepEqual(r.calls,[['range']]);
 r.setTime(1);r.events.keydown(r.event('KeyF'));r.setTime(4);r.events.keyup(r.event('KeyF'));assert.deepEqual(r.calls.at(-1),['repair']);
 r.setTime(5);r.events.keydown(r.event('KeyJ'));r.setTime(8);r.events.keyup(r.event('KeyJ'));assert.deepEqual(r.calls.at(-1),['abandon']);
});
test('real blur and hidden-page handlers cancel pending controls without a delayed action',()=>{
 const r=inputRig();r.events.keydown(r.event('KeyJ'));r.setTime(2);r.events.blur();r.setTime(4);r.events.keyup(r.event('KeyJ'));assert.equal(r.calls.length,0);
 r.setTime(5);r.events.keydown(r.event('KeyF'));r.document.hidden=true;assert.ok(r.events.visibilitychange);r.events.visibilitychange();r.document.hidden=false;r.setTime(9);r.events.keyup(r.event('KeyF'));assert.equal(r.calls.length,0);
 assert.ok(fn('openChat').includes('vehicleActions.cancel()'));
});
test('input focus, paused game and dead players cannot prepare an action',()=>{
 const r=inputRig(true);
 for(const change of [()=>r.document.activeElement={tagName:'INPUT'},()=>{r.document.activeElement={tagName:'CANVAS'};r.G.paused=true;},()=>{r.G.paused=false;r.G.online.dead=true;}]) {
   change();r.events.keydown(r.event('KeyJ'));r.setTime(5);r.events.keyup(r.event('KeyJ'));
 }
 assert.equal(r.calls.length,0);
});
test('input focus immediately interrupts an existing hold even if focus returns before the next frame',()=>{
 const r=inputRig();r.events.keydown(r.event('KeyJ'));r.setTime(2);assert.ok(r.events.focusin);
 r.events.focusin({target:{tagName:'INPUT'}});r.setTime(4);r.events.keyup(r.event('KeyJ'));assert.equal(r.calls.length,0);
});
test('the real R key retains live rocket firing and resets a destroyed rocket vehicle',()=>{
 const r=inputRig();r.G.loadout.turrets=[{guns:[{def:{trigger:'rocket'}}]}];
 r.events.keydown(r.event('KeyR'));assert.deepEqual(r.calls,[['rocket']]);
 r.G.caps.destroyed=true;r.events.keydown(r.event('KeyR'));assert.deepEqual(r.calls.at(-1),['reset']);
});
test('online abandonment submits the existing server request without declaring a client-side death',()=>{
 const G={mode:'battle',online:{dead:false},caps:{destroyed:false},cstate:{}},sent=[];
 const abandon=new Function('G','net','vehicleActions','hud',`${fn('abandonVehicle')}\nreturn abandonVehicle;`)(G,{send:m=>sent.push(m)},controller(),{toast(){}});
 abandon();assert.deepEqual(sent,[{t:'respawn'}]);assert.equal(G.online.dead,false);
});
test('offline abandonment uses the real combat core and stops movement and firing',()=>{
 const data=loadData(),core=loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm',import.meta.url)),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)}),combat=new Combat(core);
 const fresh=combat.fresh('de_hetzer',data.vehicles.de_hetzer);
 const G={mode:'battle',id:'de_hetzer',combatKey:'de_hetzer',combat,cstate:fresh.state,caps:fresh.caps,online:null,s:{u:0},fireHeld:true,mgHeld:true,keys:new Set(['fwd']),pending:[],cruise:2,view:'third'};
 const abandon=new Function('G','net','vehicleActions','hud','toggleSight',`${fn('abandonVehicle')}\nreturn abandonVehicle;`)(G,{send(){throw Error('offline cannot send');}},controller(),{toast(){}},()=>{});
 abandon();assert.equal(G.caps.destroyed,true);assert.equal(G.caps.can_move,false);assert.equal(G.caps.can_fire,false);assert.equal(G.fireHeld,false);assert.equal(G.mgHeld,false);assert.equal(G.keys.size,0);assert.equal(G.cruise,null);
});
test('a completed F hold starts the real timed repair and the ring follows actual core recovery',()=>{
 const data=loadData(),core=loadCoreSync(fs.readFileSync(new URL('../assets/tg_design.wasm',import.meta.url)),{materials:data.materials,catalog:data.designCatalog,terrains:Object.values(data.terrains)}),combat=new Combat(core);
 const id='su_t34_85',bundle=data.vehicles[id],fresh=combat.fresh(id,bundle);
 fresh.state.modules[bundle.modules.findIndex(m=>m.kind==='engine')]=0;
 const damaged=combat.advance(id,fresh.state,0,0);
 const G={id,combatKey:id,mode:'battle',combat,cstate:damaged.state,caps:damaged.caps,online:null,s:{u:0}},v=controller();
 const repair=new Function('G','net','hud',`${fn('repairVehicle')}\nreturn repairVehicle;`)(G,{send(){throw Error('offline repair');}},{toast(){}});
 v.press('KeyF',0);assert.equal(v.tick(2.99,true,true),null);assert.equal(G.caps.repair_s,0);
 assert.equal(v.tick(3,true,true),'repair');repair();const total=G.caps.repair_s;assert.ok(total>3);assert.equal(G.caps.can_move,false);
 assert.equal(v.readout(3,total,true).progress,0);
 const half=combat.advance(id,G.cstate,total/2,0);assert.ok(Math.abs(v.readout(4,half.caps.repair_s,true).progress-.5)<1e-6);
 const done=combat.advance(id,half.state,total,0);assert.equal(done.caps.repair_s,0);assert.equal(done.caps.can_move,true);assert.equal(v.readout(5,0,true),null);
});
test('living online R no longer scuttles while dead R retains server respawn delay',()=>{
 const G={online:{dead:false}},sent=[],messages=[];let now=0;
 const run=new Function('G','net','hud','performance','RESPAWN_DELAY','openDeploy',`${fn('onlineRespawn')}\nreturn onlineRespawn;`)(G,{room:null,send:m=>sent.push(m)},{toast:t=>messages.push(t)},{now:()=>now},5,()=>{});
 run();now=1000;run();assert.equal(sent.length,0);assert.ok(messages.at(-1).includes('J'));
 G.online.dead=true;G.online.diedAt=1000;now=2000;run();assert.equal(sent.length,0);now=6000;run();assert.deepEqual(sent,[{t:'respawn'}]);
});
test('indicator updates the real rim, wrench, progress ring and remaining-time labels',()=>{
 assert.ok(api.VehicleActionIndicator);
 const elements=new Map();const child=key=>{if(!elements.has(key))elements.set(key,{style:{},setAttribute(k,v){this[k]=v;},textContent:''});return elements.get(key);};
 const root={hidden:true,dataset:{},setAttribute(k,v){this[k]=v;},querySelector:child};
 const indicator=new api.VehicleActionIndicator(root),v=controller();
 indicator.update(v.readout(0,10,true));indicator.update(v.readout(1,5,true));
 assert.equal(root.hidden,false);assert.equal(root['aria-valuenow'],'50');assert.equal(child('[data-action-ring]').style.strokeDashoffset,'0.5');assert.ok(child('[data-action-title]').textContent.includes('修復'));assert.ok(child('[data-action-note]').textContent.includes('5'));
 indicator.update(null);assert.equal(root.hidden,true);
 assert.ok(template.includes('data-action-wrench')&&template.includes('data-action-rim')&&template.includes('data-action-ring'));
 assert.ok(template.includes('pathLength="1"'));
});

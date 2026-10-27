import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';

const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const visual=fs.readFileSync(new URL('../tools/frontline_aircraft_visual.js',import.meta.url),'utf8');
const bridgeURL=new URL('../tools/frontline_existing_aircraft.js',import.meta.url);
const plain=value=>JSON.parse(JSON.stringify(value));

function fixture(){
  const c=vm.createContext({performance,atob}),a=app.indexOf('  // the C flight core'),b=app.indexOf('  // client/web/src/main.js',a);
  assert.ok(a>0&&b>a);
  const source=fs.existsSync(bridgeURL)?fs.readFileSync(bridgeURL,'utf8'):'';
  vm.runInContext(app.slice(app.indexOf('  function m4()'),app.indexOf('  // client/web/src/game/relief.js'))+app.slice(app.lastIndexOf('\n',a)+1,b)+visual+'\n'+source,c);
  assert.equal(typeof c.createEstablishedAircraftBridge,'function','Original aircraft presentation bridge is required');
  const renderer={mesh(data){return{count:data.length/13,_src:{data}};},freeMesh(){}};
  const model=c.createFrontlineAircraftVisual(renderer,'f86f',{mountAcceptedStores(_plane,_id,stores){return {items:stores.map(store=>({...store,p:store.p.slice()}))};}}),plane=model.plane;
  const state=Array(80).fill(0);state[1]=1500;state[6]=1;state[9]=150;state[13]=150;state[17]=1;state[27]=.7;state[35]=1500;state[42]=state[46]=state[50]=1;
  const unit={unit:{battle:3,unit:5,life:1},aircraft:'f86f',alive:true,state,aero:Array(48).fill(0),damage:{parts:plane.damage.parts.map(part=>[part.max,0]),fire:false,broken:false},guns:[{id:'native_feed',ammo:117}],fuel:{kg:310,max:400,flow:2},stores:[{id:'fab250',owner:'wing_l',count:2,gone:false,p:[-2,-1,0]}],resource_revision:3};
  model.accept(unit,1);model.setControlled(true,new Set());
  const game={mode:'garage',air:null},document={body:{dataset:{mode:'garage',air:'0'}}},airHud={hidden:true};
  const events=[],input={touch:{throttle:0,steer:0},mdx:0,mdy:0},projection={guns:[{id:'native_feed',ammo:0}],fuel:{},stores:{items:[{id:'fab250',count:0}],groups:['fab250'],sel:0,program:{bomb:'single'}}};
  const hooks={
    game,document,airHud,
    project(u,m){assert.equal(m.plane,plane);projection.guns[0].ammo=u.guns[0].ammo;Object.assign(projection.fuel,u.fuel);projection.stores.items[0].count=u.stores[0].count;projection.resourceRevision=u.resource_revision;return projection;},
    clearInput(air){events.push(['clear',air]);c.clearAircraftInput(air,input.touch);},
    syncTouch(air,dt){events.push(['touch',air,dt]);},
    pilotStep(air,dt){events.push(['pilot',air,dt]);c.advanceAircraftInput(air,dt,input,[]);},
    systems(air,dt){events.push(['systems',air,dt]);},
    audio(air,dt){events.push(['audio',air,dt]);},
    effects(air,dt){events.push(['effects',air,dt]);},
    camera(air,dt,heightAt){events.push(['camera',air,dt,heightAt]);return {eye:[1,2,3],air};},
    drawHud(air,viewProj,cw,ch){events.push(['hud',air,viewProj,cw,ch]);return 'drawn';},
    selection(air,u,m){events.push(['selection',air,u,m]);return {selection:{kind:'group',id:air.stores.groups[air.stores.sel]},program:air.stores.program.bomb,gun_mode:'all'};}
  };
  const bridge=c.createEstablishedAircraftBridge(hooks);
  return {c,model,plane,unit,game,document,airHud,events,input,projection,hooks,bridge};
}

test('bind projects accepted resources onto a stable original air object and retains controls across host updates',()=>{
  const f=fixture(),{bridge,model,unit,game,plane}=f,air=bridge.bind(model,unit);
  assert.equal(air,game.air);assert.equal(bridge.getair(),air);assert.equal(air.plane,plane);assert.equal(air.active,true);assert.equal(air.nativeAuthority,true);
  assert.equal(game.mode,'battle');assert.equal(f.document.body.dataset.mode,'battle');assert.equal(f.document.body.dataset.air,'1');assert.equal(f.airHud.hidden,false);assert.equal(plane.instrumentContext,air);
  assert.equal(air.guns,f.projection.guns);assert.equal(air.stores,f.projection.stores);assert.equal(air.fuel,f.projection.fuel);assert.equal(air.resourceRevision,3);
  const ctl=air.ctl={view:'cockpit',selected:{id:7}},keys=plane.keys;keys.add('KeyS');plane.state.camera=1;const aim=plane.aim;
  const next={...unit,unit:{...unit.unit},guns:[{id:'native_feed',ammo:113}],fuel:{...unit.fuel,kg:308},stores:[{...unit.stores[0],count:1}],resource_revision:4};
  assert.equal(bridge.bind(model,next),air);assert.equal(air.ctl,ctl);assert.equal(plane.keys,keys);assert.ok(keys.has('KeyS'));assert.equal(plane.state.camera,1);assert.equal(plane.aim,aim);
  assert.equal(air.guns,f.projection.guns);assert.equal(air.guns[0].ammo,113);assert.equal(air.fuel.kg,308);assert.equal(air.stores.items[0].count,1);assert.equal(air.resourceRevision,4);assert.equal(f.events.length,0,'Host updates must not reset pilot controls');
});

test('frame bridge uses the original pilot-input path without advancing accepted flight damage or resources',()=>{
  const f=fixture(),{bridge,model,unit,plane,events,input}=f,air=bridge.bind(model,unit);
  for(const[name,owner,key]of [['flight update',plane,'update'],['flight step',plane.api,'step'],['damage step',plane.damage,'step']])owner[key]=()=>{throw Error('Forbidden local '+name);};
  const before=JSON.stringify({unit,cur:[...plane.cur],prev:[...plane.prev],S:[...plane.S],aero:[...plane.aero],time:plane.time,acc:plane.acc,guns:air.guns,stores:air.stores,fuel:air.fuel,revision:air.resourceRevision,damage:plane.damage.parts.map(p=>[p.hp,p.detached])});
  plane.keys.add('KeyS');plane.keys.add('ShiftLeft');input.mdx=15;input.mdy=-7;
  bridge.step(.04);
  assert.deepEqual(events.map(e=>e[0]),['touch','pilot','systems','audio']);assert.ok(events.every(e=>e[1]===air&&e[2]===.04));
  bridge.present(.04);assert.deepEqual(events.at(-1),['effects',air,.04],'attached FX belong to the explicit drawn-frame phase');
  const intent=bridge.intent();assert.equal(intent.manual_pitch,1);assert.ok(intent.throttle>.7);assert.ok(intent.aim[0]>0);assert.ok(intent.aim[1]>0);
  assert.equal(JSON.stringify({unit,cur:[...plane.cur],prev:[...plane.prev],S:[...plane.S],aero:[...plane.aero],time:plane.time,acc:plane.acc,guns:air.guns,stores:air.stores,fuel:air.fuel,revision:air.resourceRevision,damage:plane.damage.parts.map(p=>[p.hp,p.detached])}),before);
});

test('fire and release intent survives reads until transport consumption without spending inventory',()=>{
  const f=fixture(),{bridge,model,unit}=f,air=bridge.bind(model,unit);bridge.step(.01);
  const resources=JSON.stringify({guns:air.guns,stores:air.stores,fuel:air.fuel,unit});
  for(const flag of ['fireAll','inputFireAll','fireCannon','inputFireCannon']){air[flag]=true;assert.equal(bridge.intent().fire,true,flag);air[flag]=false;}
  assert.equal(bridge.intent().fire,false);air.storeTap=true;assert.equal(bridge.intent().release,true);assert.equal(bridge.intent().release,true);assert.equal(air.storeTap,true);
  const intent=bridge.intent(),cachedAim=[...air.nativeIntent.aim];intent.aim[0]=999;assert.deepEqual([...air.nativeIntent.aim],cachedAim,'Transport cannot edit cached pilot aim');
  bridge.consumeIntent();assert.equal(air.storeTap,false);assert.equal(bridge.intent().release,false);air.storeHeld=true;bridge.consumeIntent();assert.equal(bridge.intent().release,true,'Held release is not a consumed tap');
  assert.equal(JSON.stringify({guns:air.guns,stores:air.stores,fuel:air.fuel,unit}),resources);
});

test('selection camera and HUD delegate to original feature callbacks using latest accepted unit',()=>{
  const f=fixture(),{bridge,model,unit,events}=f,air=bridge.bind(model,unit),heightAt=()=>7,matrix=[1,0,0,1];
  const next={...unit,resource_revision:8};bridge.bind(model,next);
  assert.deepEqual(plain(bridge.selection()),{selection:{kind:'group',id:'fab250'},program:'single',gun_mode:'all'});
  air.stores.program.bomb='s4';assert.equal(bridge.selection().program,'s4','Original release counts must not be silently remapped');
  const selectionEvent=events.at(-1);assert.equal(selectionEvent[1],air);assert.equal(selectionEvent[2],next);assert.equal(selectionEvent[3],model);
  assert.equal(bridge.view(.02,heightAt).air,air);assert.deepEqual(events.at(-1),['camera',air,.02,heightAt]);
  assert.equal(bridge.draw(matrix,800,600),'drawn');assert.deepEqual(events.at(-1),['hud',air,matrix,800,600]);
});

test('unbind clears original pilot input and HUD without disposing a world-owned aircraft',()=>{
  const f=fixture(),{bridge,model,unit,plane,game,events}=f,air=bridge.bind(model,unit);let disposed=0;plane.dispose=()=>disposed++;
  plane.keys.add('KeyS');air.storeTap=air.storeHeld=air.fireAll=true;air.nativeIntent={aim:[0,0,1]};
  bridge.unbind();assert.equal(game.air,null);assert.equal(bridge.getair(),null);assert.equal(plane.instrumentContext,null);assert.equal(air.active,false);assert.equal(air.storeTap,false);assert.equal(air.storeHeld,false);assert.equal(plane.keys.size,0);assert.equal(disposed,0);
  assert.equal(f.airHud.hidden,true);assert.equal(f.document.body.dataset.air,'0');assert.deepEqual(events.map(e=>e[0]),['clear']);
  assert.equal(bridge.intent(),null);assert.equal(bridge.selection(),null);assert.equal(bridge.view(.01,()=>0),null);assert.equal(bridge.draw([],800,600),null);bridge.step(.01);bridge.unbind();assert.equal(events.length,1,'Unbound lifecycle is inert');
});

test('a new native life clears old input and starts a fresh air shell without disposing the plane',()=>{
  const f=fixture(),{bridge,model,unit,plane}=f,old=bridge.bind(model,unit);let disposed=0;plane.dispose=()=>disposed++;
  old.ctl={view:'radio'};plane.keys.add('KeyS');const next=bridge.bind(model,{...unit,unit:{...unit.unit,life:2}});
  assert.notEqual(next,old);assert.equal(old.active,false);assert.equal(next.plane,plane);assert.equal(next.ctl,undefined);assert.equal(plane.keys.size,0);assert.equal(disposed,0);assert.equal(plane.instrumentContext,next);
});

test('a refreshed model wrapper for the same plane and life retains the original air shell',()=>{
  const f=fixture(),{bridge,model,unit,plane,events}=f,air=bridge.bind(model,unit),ctl=air.ctl={view:'cockpit'};
  plane.keys.add('KeyS');const refreshed={...model};
  assert.equal(bridge.bind(refreshed,{...unit,unit:{...unit.unit}}),air);assert.equal(air.ctl,ctl);assert.ok(plane.keys.has('KeyS'));
  bridge.selection();assert.equal(events.at(-1)[3],refreshed,'Selection receives the latest world model wrapper');assert.equal(events.filter(e=>e[0]==='clear').length,0);
});

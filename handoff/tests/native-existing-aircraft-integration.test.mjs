import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const app=fs.readFileSync(process.env.TF_MAIN_HOOK_BASELINE||new URL('../bundle/app.js.html',import.meta.url),'utf8');
function original(name){
  const at=app.indexOf(`\n    function ${name}(`),a=at+1,b=app.indexOf('\n    }\n',a);
  assert.ok(a>=0&&b>a,`Actual production function ${name} is available`);
  return app.slice(a,b+6);
}
test('the actual hangar launch delegates an admitted native sortie without creating a local flight',()=>{
  const sent=[],G4={frontline:{shared:{room:()=>({battle_mode:'air_frontline'})},launchFromGarage:id=>sent.push(id)}};
  const c=vm.createContext({G4,net:{inRoom:false},hud:{toast(){throw Error('unexpected legacy gate');}}});
  vm.runInContext(original('flyType')+';flyType("mig15");',c);
  assert.deepEqual(sent,['mig15']);
});
test('the actual garage return releases native control without disposing its authoritative aircraft',()=>{
  let returned=0;
  const c=vm.createContext({G4:{frontline:{active:true,returnToGarage(){returned++;}},air:{nativeAuthority:true}},removeAircraft(){throw Error('native world owns this aircraft');}});
  vm.runInContext(original('toGarage')+';toGarage();',c);
  assert.equal(returned,1);
});
test('the actual shared height reader uses native theatre terrain for aircraft sights and cameras',()=>{
  const declaration=app.match(/    const surfaceAt = [^\n]+/)[0];
  const G4={mode:'battle',frontline:{active:true,map:{},heightAt:(x,z)=>200+x-z},map:null};
  const c=vm.createContext({G4,terrain:{height:()=>3}});
  vm.runInContext(declaration+';globalThis.result=surfaceAt(25,-30);',c);
  assert.equal(c.result,255);
  G4.frontline.active=false;
  assert.equal(vm.runInContext('surfaceAt(25,-30)',c),3);
});
test('the real animation callback enters the existing game update for native aircraft',()=>{
  let updates=0;
  const G4={mode:'battle',paused:false,thumbs:[],caps:null,qualityChosen:true};
  const c=vm.createContext({G4,sound:{setFullAudible(){},ambient(){},setReloadAudible(){},cancelReloads(){}},airShotAudioAudible:()=>true,
    document:{hidden:false},last:0,updateVehicleActions(){},frontline:{active:true,frame(){throw Error('separate operation mode bypassed the completed update');}},
    hud:{},update(){updates++;},renderScale:{sample:()=>null},renderer:{},requestAnimationFrame(){},lerp:(a,b,t)=>a+(b-a)*t});
  vm.runInContext(original('frame')+';frame(16.67);',c);
  assert.equal(updates,1);
});
test('native world presentation is dispatched inside the existing update before unrelated local tank simulation',()=>{
  let worlds=0;
  const G4={mode:'battle',frontline:{active:true,frame(){worlds++;}}};
  const c=vm.createContext({G4});
  vm.runInContext(original('update')+';update(1/60);',c);
  assert.equal(worlds,1);
});

test('the real native rejection path cancels pending weapon intent',async()=>{
  const client=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
  const a=client.indexOf('      async function receive(message){'),b=client.indexOf("      net.on('frontline'",a);
  const calls=[],f={airDeploymentPending:false,establishedFlight:{rejectWeaponControl:reason=>calls.push(['reject',reason])}};
  const c=vm.createContext({f,G4:{mode:'battle',air:{nativeAuthority:true}},note:message=>calls.push(['note',message])});
  vm.runInContext(client.slice(a,b),c);
  await c.receive({version:1,message:{op:'error',code:'weapon_control_rejected',message:'unsupported_release_program'}});
  assert.deepEqual(calls,[['reject','unsupported_release_program'],['note','unsupported_release_program']]);
});

test('the actual native armament editor disables host-unavailable stores and their quantity selectors',()=>{
  const armEd={dataset:{air:'f15c'},innerHTML:''},slot={key:'mid:-1',station:'mid',side:-1,options:new Map([['aim120c',2],['fab250',1]])};
  const G4={airCustom:{f15c:{'mid:-1':'aim120c'}},frontline:{shared:{room:()=>({})},aircraftOptions:[{id:'f15c',slots:[{key:'mid:-1',options:{aim120c:2,fab250:1},unsupported:{aim120c:'服务端尚未开放导引武器'}}]}]}};
  const c=vm.createContext({armEd,G4,airSlots:()=>[slot],AIR_STORE_DEFS:{aim120c:{name:'AMRAAM',kind:'aam',mass:150},fab250:{name:'FAB',kind:'bomb',mass:250}},customLoadout:()=>['Custom',[]],AIRCRAFT_TYPES:{f15c:{name:'F15'}},SLOT_NAME:{mid:'中段'},KIND_CLASS:{aam:'aam',bomb:'bomb'},TFMountedDetails:{quantity:()=>1,quantityEnabled:()=>true}});
  vm.runInContext(original('renderArmEditor')+';renderArmEditor();',c);
  assert.match(armEd.innerHTML,/disabled title="AMRAAM：未完成（服务端尚未开放导引武器）/);
  assert.ok(!armEd.innerHTML.includes('air-arm-count'),'Unrepresentable quantities for rejected stores cannot appear selectable');
  assert.match(armEd.innerHTML,/data-store="fab250"/,'Admitted native bomb remains selectable');
  G4.frontline.shared.room=()=>null;vm.runInContext('renderArmEditor();',c);
  assert.match(armEd.innerHTML,/air-arm-count/,'Local model upgrade retains its quantity controls');
});

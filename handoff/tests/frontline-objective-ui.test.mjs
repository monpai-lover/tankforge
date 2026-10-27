import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const helpers=source.slice(0,source.indexOf('    // Production client for the versioned native frontline world.'));

test('actual drawMap displays native contest/progress and team capture locks without advancing campaign state',()=>{
  const calls=[],g={};for(const name of ['fillRect','beginPath','arc','stroke','setLineDash','fillText','moveTo','lineTo','strokeRect','save','restore','rect','clip','translate','scale','closePath','fill'])g[name]=(...args)=>calls.push({name,args});
  const f={mapCentre:[0,0],map:{roads:[],airfields:[],terrain:{x0:-1000,z0:-1000,cellX:1000,cellZ:1000,width:3,height:3,waterAreas:[]}},facilities:[],units:[],aircrafts:[],companies:[],objectives:[
    {id:'C2',pos:[0,40,0],radius:100,owner:null,progress:.4,lane:'centre',contested:true,capturable:[true,true],supplied:[true,true],presence:[2,1]},
    {id:'E3',pos:[200,40,200],radius:100,owner:'red',progress:-1,lane:'east',contested:false,capturable:[false,true],supplied:[false,true],presence:[0,3]}]};
  const before=JSON.stringify(f),c=vm.createContext({f,mapCv:{width:480,height:340},mapG:g,el:()=>({value:'14'}),mine:()=>({team:'blue',observer:false}),net:{id:7}});
  vm.runInContext(fs.readFileSync(new URL('../tools/frontline_map_background.js',import.meta.url),'utf8'),c);
  const a=source.indexOf('      function drawMap(){'),b=source.indexOf('      function transmitInput(){',a);vm.runInContext(helpers+source.slice(a,b),c);
  c.drawMap();assert.ok(calls.some(x=>x.name==='fillText'&&x.args[0]==='C2 争夺 蓝40%'));
  assert.ok(calls.some(x=>x.name==='fillText'&&x.args[0]==='E3 锁定 红100%'));
  assert.ok(calls.some(x=>x.name==='setLineDash'&&JSON.stringify(x.args[0])==='[3,3]'));
  const arc=calls.find(x=>x.name==='arc'&&x.args[3]===-Math.PI/2);assert.ok(arc);assert.equal(arc.args[4],-Math.PI/2+.4*Math.PI*2);
  const after={...f};for(const key of ['mapScale','mapBackground','mapBackgroundMap'])delete after[key];assert.equal(JSON.stringify(after),before,'Only display scale/cache changes; native objective state is untouched');
  const old={id:'old',progress:0,owner:null};assert.equal(c.frontlineObjectivePresentation(old,'blue').locked,false,'Missing older capture metadata cannot invent a lock');
  assert.ok(!c.frontlineObjectivePresentation({...old,capturable:[true,true]},null).label.includes('己方'),'Neutral observer has no invented friendly ownership');
});

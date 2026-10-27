import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../bundle/app.js.html',import.meta.url),'utf8');
const lod=fs.readFileSync(new URL('../tools/frontline_lod.js',import.meta.url),'utf8');
function fixture(){
 const c=vm.createContext({});vm.runInContext(app.slice(app.indexOf('  function m4()'),app.indexOf('  // client/web/src/game/relief.js'))+lod+fs.readFileSync(new URL('../tools/frontline_support_visual.js',import.meta.url),'utf8'),c);
 const bundle=Object.fromEntries(['vehicle','weapons','visual'].map(k=>[k,JSON.parse(fs.readFileSync(new URL(`../../data/vehicles/su_t72a/${k}.json`,import.meta.url),'utf8'))]));
 let now=0,builds=0,disposed=0,frees=0,poses=0;
 const f={focus:[0,20,0],pitch:0,yaw:0,distance:20,lastTick:1,models:new Map(),root:new c.Node('world'),units:[]};
 const renderer={quality:'low',mesh:data=>({count:data.length/13,data}),freeMesh(){frees++;}};
 Object.assign(c,{f,renderer,data:{vehicles:{su_t72a:bundle}},performance:{now:()=>now},unitKey:r=>String(r.unit),same:(a,b)=>a?.unit===b?.unit,height:()=>0,generatedTurretParts:null,
  makeLoadout:(id,b)=>({id,b}),buildTank(){builds++;return{root:new c.Node('recorded-full-render-builder'),dispose(){disposed++;}};},VehicleSim:class{},poseModel(){poses++;}});
 const a=source.indexOf('      function releaseGroundDetail(item){'),b=source.indexOf('      function updateAircraftModels(',a);vm.runInContext(source.slice(a,b),c);
 return {c,f,get builds(){return builds},get disposed(){return disposed},get frees(){return frees},get poses(){return poses},clock(t){now=t}};
}
const unit=(id,x=1000)=>({unit:{battle:1,unit:id,life:1},vehicle:'su_t72a',pos:[x,20,1000],yaw:0,turret_yaw:0,gun_pitch:0});
test('actual manager keeps all sixty distant native snapshots as small real LODs without constructing sixty full renderers',()=>{
 const x=fixture();x.f.units=Array.from({length:60},(_,i)=>unit(i+1,1000+i*50));const original=JSON.stringify(x.f.units);x.c.updateModels();
 assert.equal(x.f.models.size,60);assert.equal(x.builds,0);assert.equal(x.poses,0);assert.equal(x.f.root.children.length,60);
 for(const item of x.f.models.values()){assert.equal(item.model,null);assert.ok(item.lod.meshes.reduce((n,m)=>n+m.count/3,0)<200);assert.equal(item.lod.root.visible,true);}
 assert.equal(JSON.stringify(x.f.units),original,'Visual LOD cannot move or modify native units');
 x.f.units=[];x.c.updateModels();assert.equal(x.f.root.children.length,0);assert.equal(x.frees,180);
});
test('following/control promotes the actual selected unit, preserves its accepted updates, and retires cached detail after leaving range',()=>{
 const x=fixture();x.f.units=[unit(1),unit(2)];x.c.updateModels();x.f.follow='1';x.c.updateModels();assert.equal(x.builds,1);assert.equal(x.poses,1);assert.equal(x.f.models.get('1').model.root.visible,true);
 x.f.control=x.f.units[1].unit;x.c.updateModels();assert.equal(x.builds,2);assert.equal(x.f.models.get('2').model.root.visible,true);
 x.f.follow=null;x.f.control=null;x.clock(6000);x.c.updateModels();assert.equal(x.disposed,2);assert.equal(x.f.models.get('1').model,null);
 x.f.follow='1';x.c.updateModels();assert.equal(x.builds,3);x.f.units=[];x.c.updateModels();assert.equal(x.disposed,3);assert.equal(x.frees,6);assert.equal(x.f.root.children.length,0);
});

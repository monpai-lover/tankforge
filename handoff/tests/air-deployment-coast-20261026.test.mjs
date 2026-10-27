import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../tools/frontline_client.js',import.meta.url),'utf8');
const helpers=source.slice(0,source.indexOf('    // Production client for the versioned native frontline world.'));
const map=JSON.parse(fs.readFileSync(new URL('../../data/frontline/taiwan.json',import.meta.url)));
test('Taiwan deployment fits both airfields and ABC in a readable coastal area',()=>{
 const c=vm.createContext({});vm.runInContext(helpers,c);
 assert.equal(typeof c.frontlineDeploymentMapView,'function');
 const view=c.frontlineDeploymentMapView(map);
 assert.ok(view.size>100000&&view.size<200000,`view size ${view.size}`);
 const points=[...map.airspawns.filter(a=>a.enabled).map(a=>[a.pos[0],a.pos[2]]),...map.airfields.filter(a=>a.enabled&&a.runway).map(a=>a.runway.center),...map.objectives.filter(a=>['W2','C2','E2'].includes(a.id)).map(a=>[a.pos[0],a.pos[2]])];
 for(const [x,z] of points){assert.ok(x>view.x0&&x<view.x0+view.size);assert.ok(z>view.z0&&z<view.z0+view.size);}
 assert.ok(36513-view.x0>view.size*.2,'West coast has visible strait space');
});
test('deployment coast picture is cached and flips the existing water renderer to the DeployScreen Z-up mapping',()=>{
 const calls=[],ctx={save(){},restore(){},translate(...p){calls.push(['translate',...p]);},scale(...p){calls.push(['scale',...p]);}},canvas={width:0,height:0,getContext:()=>ctx};
 const c=vm.createContext({document:{createElement:()=>canvas},createFrontlineMapBackground:()=>({draw:(g,view)=>calls.push(['draw',view])})});vm.runInContext(helpers,c);
 assert.equal(typeof c.frontlineDeploymentMapPicture,'function');
 const view={x0:0,z0:0,size:100};assert.equal(c.frontlineDeploymentMapPicture(map,view),canvas);assert.equal(c.frontlineDeploymentMapPicture(map,view),canvas);
 assert.equal(calls.filter(c=>c[0]==='draw').length,1);assert.ok(calls.some(c=>c[0]==='scale'&&c[1]===1&&c[2]===-1));
});

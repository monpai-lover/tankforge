import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as damageApi from '../src/game/weaponDamage.js';
import { loadData } from '../tools/load-data.mjs';
import { runtimeParts } from '../tools/procedural-fleet-audit.mjs';
import { transformPoint, transformDir, mul, translation, rotX, rotY, rotZ } from '../src/gfx/math.js';
import { RigidBody } from '../src/sim/tank/body.js';
import * as gunnery from '../src/sim/gunnery.js';
import * as ballistics from '../src/sim/ballistics.js';
import * as mgSim from '../src/sim/mg.js';
import { exportFolder, newTurretSpec } from '../src/game/loadout.js';

const data=loadData(),source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const functionSource=name=>{const start=source.indexOf(`  function ${name}(`);assert.ok(start>=0,name);return source.slice(start,source.indexOf('\n  }',start)+4);};
const dirFrom=(yaw,pitch)=>[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)];
const close=(a,b,message)=>assert.ok(Math.hypot(...a.map((v,k)=>v-b[k]))<2e-6,message);
function rig(id,bundles=data) {
  const rt=runtimeParts(id,bundles),M=rt.model;
  const G={model:M,loadout:rt.loadout,veh:{body:new RigidBody(1000,[1000,1000,1000],[0,0,0])},T:[{yaw:0}],sightM:0,zero:0,aimPoint:[0,3,500],MG:rt.loadout.machineGuns.map(m=>({m,aim:{yaw:0,pitch:0},bearing:true}))};
  G.sightM=M.mgs[0].index;
  const deps={...damageApi,G,gunnery,ballistics,mgSim,dirFrom};
  const muzzle=new Function(...Object.keys(deps),`${functionSource('layMg')}\n${functionSource('sightMuzzle')}\nreturn sightMuzzle;`)(...Object.values(deps));
  const yawStatement=source.match(/^      pm\.node\.yaw = [^\n]+;/m)[0];
  const pitchStatement=source.match(/^      pm\.node\.pitch = [^\n]+;/m)[0];
  const apply=new Function('pm','e','G',yawStatement+'\n'+pitchStatement);
  function pose(mainYaw,mgYaw,pitch,matrix=translation(0,0,0)) {
    const body=G.veh.body;
    body.ex=transformDir(matrix,[1,0,0]);body.ey=transformDir(matrix,[0,1,0]);body.ez=transformDir(matrix,[0,0,1]);body.pos=transformPoint(matrix,[0,0,0]);
    M.body.local=matrix;G.T[0].yaw=mainYaw;M.turrets[0].node.yaw=mainYaw;
    G.MG[G.sightM].aim={yaw:mgYaw,pitch};
    for(const pm of M.mgs)apply(pm,G.MG[pm.index],G);
    M.root.update();
  }
  const all=[];function walk(n){all.push(n);for(const c of n.children)walk(c);}walk(M.root);
  return {rt,M,G,muzzle,pose,post:all.find(n=>n.name==='mg_post'),gun:M.mgs[0]};
}

test('Hetzer remote MG pedestal stays fixed to the casemate during main-gun and independent MG traverse', () => {
  const r=rig('de_hetzer'),m=r.G.MG[0].m;
  for(const mainDeg of [-5,0,5,11])for(const mgDeg of [-150,-45,0,60,150]) {
    r.pose(mainDeg*Math.PI/180,mgDeg*Math.PI/180,.3);
    close(transformPoint(r.post.world,[0,-m.post,0]),[m.pos[0],m.pos[1]-m.post,m.pos[2]],'roof pedestal must never orbit the main gun trunnion');
  }
});

test('Hetzer selected MG sight and projectile muzzle match the real mesh on pitched and rolled hulls', () => {
  const r=rig('de_hetzer');
  for(const mainDeg of [-5,0,11])for(const yaw of [-1.4,.2,2.1])for(const pitch of [-.1,.4,1.1])for(const tilt of [0,.15]) {
    const matrix=mul(translation(4,.3,-7),mul(rotY(.7),mul(rotX(tilt),rotZ(-tilt/2))));
    r.pose(mainDeg*Math.PI/180,yaw,pitch,matrix);
    const mz=r.muzzle(),m=r.G.MG[0].m;
    close(mz.trunnion,r.G.veh.body.worldPoint(m.pos),'sight pivot remains the real fixed roof hinge');
    close(mz.pos,transformPoint(r.gun.node.world,r.gun.muzzleVector),'shot and sight originate at the visible MG bore');
    const expected=r.G.veh.body.worldDir(dirFrom(yaw,pitch));
    close(mz.dir,expected,'independent MG direction is unaffected by main-gun traverse');
  }
});

test('ordinary turret-mounted roof MGs still ride on their rotating turret', () => {
  const r=rig('su_is2'),m=r.G.MG[r.gun.index].m;
  for(const yaw of [-.7,0,1.2]) {
    r.pose(yaw,1.8,.4);
    const base=gunnery.muzzleLocal({pivot:r.G.loadout.turrets[0].pivot,trunnion:m.pos,muzzleOffset:0},{yaw,pitch:0}).trunnion;
    close(transformPoint(r.post.world,[0,0,0]),base,'normal pintle keeps its turret parent');
    close(r.muzzle().pos,transformPoint(r.gun.node.world,r.gun.muzzleVector),'normal MG muzzle stays aligned');
  }
});

test('Hetzer workshop builds retaining stock weapons preserve the fixed MG anchor with an added head', () => {
  const out=exportFolder({base:'de_hetzer',keepStock:true,turrets:[newTurretSpec()]},data,data.vehicles.de_hetzer,'hetzer_extra_head','extra head');
  const bundle=Object.fromEntries(['vehicle','weapons','visual','engine','armor','modules','crew'].map(k=>[k,out.files[k+'.json']]));
  assert.ok(bundle.weapons.extra_turrets.length>0,'replacement/added turret remains available');
  const r=rig('hetzer_extra_head',{...data,vehicles:{...data.vehicles,hetzer_extra_head:bundle}}),m=r.G.MG[0].m;
  for(const yaw of [-.1,.18]) {
    r.pose(yaw,.9,.3);
    close(transformPoint(r.post.world,[0,-m.post,0]),[m.pos[0],m.pos[1]-m.post,m.pos[2]],'retained stock pedestal stays on the workshop hull');
    close(r.muzzle().pos,transformPoint(r.gun.node.world,r.gun.muzzleVector),'workshop firing and rendered bore agree');
  }
});

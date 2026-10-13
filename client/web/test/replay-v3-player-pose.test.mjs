import test from 'node:test';
import assert from 'node:assert/strict';
import * as pose from '../src/game/replayPose.js';
import {Node,m4} from '../src/gfx/math.js';
function player(){const root=new Node('tank'),body=root.add(new Node('body')),turrets=[0,1].map(i=>{const node=body.add(new Node('turret'));return{node,guns:[0,1].map(j=>{const gun=node.add(new Node('gun')),barrel=gun.add(new Node('barrel'));return{node:gun,barrel};})};});turrets[1].node.pos=[0,2,0];root.update();return {model:{root,body,turrets,mgs:[],wheels:[],shellNodes:[body]},veh:{body:{worldPoint:p=>p.map((v,i)=>v+[10,2,30][i]),worldDir:p=>p.slice()}},loadout:{turrets:[{guns:[{},{}]},{parent:0,guns:[{},{}]}]},T:[{yaw:.7,guns:[{pitch:.1,recoil:.2,roll:.3},{pitch:-.2,recoil:.4,roll:.5}]},{yaw:1.1,guns:[{pitch:.6,recoil:.7},{pitch:.8,recoil:.9}]}],MG:[],fold:.25};}
test('actual Player adapter captures independent gun elevation/recoil and parent-relative turret pose',()=>{
  assert.equal(typeof pose.capturePlayerImpactPose,'function');const G=player(),saved=pose.capturePlayerImpactPose(G);
  assert.equal(saved.joints.get(G.model.turrets[1].node).yaw,1.1-.7);assert.equal(saved.joints.get(G.model.turrets[0].guns[1].node).pitch,.2);assert.deepEqual(saved.joints.get(G.model.turrets[1].guns[1].barrel).pos,[0,0,-.9]);assert.equal(saved.joints.get(G.model.turrets[0].guns[1].barrel).roll,.5);
  const renderer={retainMesh(){},releaseMesh(){},freeMesh(){}},report={};pose.rememberImpactPose(report,saved);G.model.turrets[0].node.yaw=9;G.model.turrets[1].guns[1].node.pitch=9;
  const target=pose.snapshotReplayTarget(renderer,{model:G.model,body:G.veh.body,length:6,width:3,height:3},report);
  assert.equal(target.model.turrets[0].node.yaw,.7);assert.equal(target.model.turrets[1].guns[1].node.pitch,-.8);assert.deepEqual(target.body.worldPoint([0,0,0]),[10,2,30]);assert.ok(target.hullBounds.max[2]>target.hullBounds.min[2]);target.dispose();
});
test('explicit historical accepted frame never falls back to the later live body or joint pose',()=>{
  const G=player(),renderer={retainMesh(){},releaseMesh(){},freeMesh(){}},accepted={trust:'legacy_receipt_pose',hull_origin:[1,2,3],ex:[1,0,0],ey:[0,1,0],ez:[0,0,1],joints:[{yaw:.25,guns:[{pitch:.4,recoil:.1},{pitch:.2,recoil:.3}]},{yaw:.65,guns:[{pitch:.1},{pitch:.2}]}],running_gear:[],payload:[],variants:[]};
  G.model.turrets[0].node.yaw=8;const snapshot=pose.snapshotReplayTarget(renderer,{model:G.model,body:G.veh.body,length:6,width:3,height:3,loadout:G.loadout},{},accepted);
  assert.deepEqual(snapshot.body.worldPoint([0,0,0]),[1,2,3]);assert.equal(snapshot.model.turrets[0].node.yaw,.25);assert.equal(snapshot.model.turrets[1].node.yaw,.4);assert.equal(snapshot.model.turrets[0].guns[0].node.pitch,-.4);snapshot.dispose();
});

test('pre-core running instance capture survives later live buffer mutation',()=>{
  const G=player(),running=G.model.body.add(new Node('running')),track=running.add(new Node('track'));
  G.model.running=running;track.mesh={instanced:true,_src:{data:new Float32Array(13),matrices:m4()},instances:1,maxInstances:1};track.mesh._src.matrices[12]=3;
  const saved=pose.capturePlayerImpactPose(G),rep={};pose.rememberImpactPose(rep,saved);track.mesh._src.matrices[12]=90;
  const r={instancedMesh:(data,maxInstances)=>({instanced:true,_src:{data},maxInstances}),setInstances(m,matrices,count){m._src.matrices=matrices.slice();m.instances=count;},freeMesh(){}};
  const snap=pose.snapshotReplayTarget(r,{model:G.model,body:G.veh.body,length:6,width:3,height:3},rep);
  assert.equal(snap.model.body.children.find(n=>n.name==='running').children[0].mesh._src.matrices[12],3);snap.dispose();
});

test('hull-only bounds transform measured corners and accepted timeline never reads later live death joints',()=>{
  const G=player(),r={freeMesh(){}},accepted={trust:'legacy_receipt_pose',hull_origin:[1,2,3],ex:[0,0,-1],ey:[0,1,0],ez:[1,0,0],joints:[],running_gear:[],payload:[],variants:[]};
  const snap=pose.snapshotReplayTarget(r,{model:G.model,body:G.veh.body,length:6,width:2,height:3,loadout:G.loadout},{},accepted);
  assert.deepEqual(snap.hullBounds,{min:[-2,2,2],max:[4,5,4]});G.model.turrets[0].node.yaw=9;
  assert.equal(typeof snap.applyAcceptedPose,'function');snap.applyAcceptedPose({...accepted,hull_origin:[4,2,3],joints:[{yaw:.3,guns:[{pitch:.2}]}]},2);
  assert.deepEqual(snap.body.worldPoint([0,0,0]),[4,2,3]);assert.equal(snap.model.turrets[0].node.yaw,.3);
  assert.equal(snap.applyAcceptedPose({...accepted,hull_origin:[90,2,3]},1),false,'older cause cannot roll the target back');
  assert.deepEqual(snap.body.worldPoint([0,0,0]),[4,2,3]);snap.dispose();
});
